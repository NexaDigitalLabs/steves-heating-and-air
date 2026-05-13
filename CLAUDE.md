# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing site + lead-gen tooling for **Steve's Air Conditioning & Heating** (Murrieta, CA). Static HTML served by Vercel out of `public/`, plus five serverless functions in `api/`. No build step, no framework, no bundler — edits are deploy-ready as soon as they're saved.

## Business context

- **Phone:** (951) 634-3233 — hardcoded in chat fallback responses and across `public/`. Grep both directories if it ever changes.
- **Owner email:** stevesac_6708@yahoo.com — used in lead routing; Steve's wife is the primary recipient for `/diagnose` submissions.
- **Credentials:** NATE-certified. **612 five-star Google reviews** (as of last update — feel free to refresh from the live profile if a section calls for it).
- **Service area:** Murrieta, Temecula, Wildomar, Lake Elsinore, Menifee, Canyon Lake, Sun City, Winchester, French Valley, Perris.

### Service Area Business (SAB) rules — hard

Steve has no storefront and no public address. Treat the business as service-area-only:

- **40960 California Oaks Rd is a PO box. Never display it anywhere** — not in NAP, not in JSON-LD, not in footers, not in schema markup, not in metadata.
- Footer NAP must read exactly: **"Serving Murrieta, Temecula & SW Riverside County."**
- The chat system prompt forbids handing out a physical address or inviting in-person visits — preserve that if you touch the prompt.

## Locked language patterns

These are content conventions established across the build. Do not invent new variants:

- **FAQ + general CTA buttons:** `Call Steve`
- **Service card / category buttons:** `Call for [Service Name] Service` (e.g. `Call for AC Repair Service`)
- **Footer NAP:** `Serving Murrieta, Temecula & SW Riverside County.` (verbatim)
- **Image path convention:** `/images/...` — never `/public/images/...` (Vercel serves `public/` as root).

## Current build state

- **Sessions 1+2:** done. Core multi-page structure, shared assets, chatbot, quote, diagnose, all live.
- **Session 3 (in progress):** 4 city pages + 5 neighborhood pages + `/service-area/` hub.
- **Session 4 (planned):** strip remaining SPA patterns from homepage; final robots.txt and sitemap.xml pass.
- **Phase 3 (planned):** `/diagnose` AI photo triage upgrade — Pattern B: no diagnosis text shown to customer; structured JSON dispatched to stevesac_6708@yahoo.com; photos to Supabase Pro storage; liability disclaimers locked (do not soften without an explicit decision).

## Commands

```bash
# Local dev (requires `npm i -g vercel` once)
vercel dev                # serves public/ + /api at http://localhost:3000

# Deploy
git push                  # Vercel auto-deploys main (~30s)
```

There is **no test suite, no linter, and no build step**. Don't add one without asking — the simplicity is deliberate.

`npm install` only fetches deps used by the serverless functions (`@anthropic-ai/sdk`, `@supabase/supabase-js`, `resend`). The static pages have zero npm dependencies.

## Required environment variables

Set these in Vercel (Production/Preview/Development) and in `.env.local` for `vercel dev`:

| Var | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `chat.js`, `diagnose.js` | Claude API access |
| `RESEND_API_KEY` | `quote.js`, `diagnose.js` | Outbound email |
| `STEVE_LEADS_EMAIL` | `quote.js`, `diagnose.js` | Inbox that receives leads |
| `FROM_EMAIL` | `quote.js`, `diagnose.js` | Optional override; defaults to `leads@nexadigitallabs.ai` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `diagnose.js`, `get-upload-url.js`, `cleanup-old-submissions.js` | Photo/video storage + submission rows |
| `CRON_SECRET` | `cleanup-old-submissions.js` | Bearer token Vercel cron sends to authorize the daily cleanup |

After editing env vars in Vercel, redeploy so functions pick them up.

## Architecture

### Static site (`public/`)

Vercel serves `public/` as the site root, so `public/images/logo.png` is reachable at `/images/logo.png` (never `/public/...`).

The site is a **multi-page static site** — each route is its own hand-written `index.html`. Top level: `/`, `/about/`, `/quote/`, `/diagnose/`, `/service-area/`, `/services/`, `/blog/`. Services have subpages (`/services/air-conditioning/`, `/services/furnaces/`, etc.), and city pages have neighborhood subpages (`/murrieta/bear-creek/`, `/temecula/redhawk/`, …). The homepage `public/index.html` is a self-contained file with inline styles; every other page links to the **shared bundle** in `public/assets/`:

- `site.css` / `site.js` — shared nav, layout, page chrome for non-homepage pages
- `chatbot.css` / `chatbot.js` — floating chat widget, auto-injects on `DOMContentLoaded`

Pages declare context to the chatbot via a `<meta name="page-context" content="type:slug|Display Name"/>` tag (e.g. `service:air-conditioning|Air Conditioning`, `city:murrieta|Murrieta`). The `/api/chat` handler accepts this and sanitizes it (whitelist of types, slug regex, length caps) before injecting it into the system prompt — **never trust the type/slug/name without re-validating** when changing the chat handler.

`sitemap.xml` and `robots.txt` are hand-maintained at the public root.

### Blog

Blog posts live at `public/blog/<slug>/index.html`. The blog index (`public/blog/index.html`) is regenerated when posts are added — recent commits show a pattern of `blog: publish <title>` followed by `blog: regenerate index (N posts)`. Don't hand-edit the index page in a way that would conflict with regeneration.

### Serverless functions (`api/`)

All functions are Vercel Node functions, `"type": "module"` (ESM), Node 22.

- **`chat.js`** — Floating chatbot. Loads `data/knowledge-base.json` once per cold start (Vercel's File Trace bundles the JSON automatically because of the static `fs.readFileSync` call from `process.cwd()` — don't make that path dynamic). Builds the system prompt from KB + live Pacific Time context + sanitized page context. Calls Claude Haiku (`claude-haiku-4-5-20251001`). Parses a trailing `[LEAD_CAPTURED:NAME=…|PHONE=…|TOPIC=…]` tag out of model output to detect captured leads and logs them; the cleaned reply is returned to the browser. The lead capture protocol is defined in the system prompt — change it in lockstep with `extractLead()`.
- **`quote.js`** — `/quote` form handler. Validates fields, applies a honeypot, renders an HTML email via `escapeHtml`, sends via Resend. No DB. On Resend failure, **still returns 200** so the customer sees success — the lead is logged for manual recovery.
- **`diagnose.js`** — `/diagnose` upload flow. Accepts up to 3 photos (base64 in body) or 1 video (uploaded to Supabase Storage out-of-band via `get-upload-url.js`, then referenced by path). Uses Claude Sonnet (`claude-sonnet-4-6`) vision with a strict JSON schema; the system prompt enforces hedged-language voice rules and explicitly suppresses email + DB writes for `inappropriate_content` status (deletes uploaded files on detection). Persists to `diagnose_submissions` table in Supabase.
- **`get-upload-url.js`** — Issues a Supabase presigned upload URL so the browser can `PUT` videos directly to storage, bypassing Vercel's 4.5 MB function body limit.
- **`cleanup-old-submissions.js`** — Vercel cron (`vercel.json` schedules `0 10 * * *` daily). Deletes `diagnose_submissions` rows older than 48 h plus their storage objects. Auth: requires `Authorization: Bearer ${CRON_SECRET}`; rejects everything else, so external callers can't trigger it.

### Knowledge base (`data/knowledge-base.json`)

Single source of truth for the chatbot — business info, hours, services, FAQs, troubleshooting tips, seasonal advice. Loaded by `chat.js` at cold start and stitched into the system prompt. **Editing this file requires no code changes** — push and Vercel rebuilds. Keys are referenced by `buildSystemPrompt()` and `buildPageContextBlock()` in `chat.js`; if you rename a key, update the handler.

## Things to watch out for

- **Service-area business framing.** Steve has no storefront. Chat system prompt explicitly forbids giving out a physical address or inviting visits — preserve that if you touch the prompt.
- **Lead-capture tag is parsed by regex.** The `[LEAD_CAPTURED:...]` tag must remain the *last* thing in model output, and the regex in `extractLead()` is anchored to end-of-string. Any prompt change that lets the model add trailing text will break lead detection.
- **Resilience on failure.** `quote.js` and `diagnose.js` deliberately return 200 to the user even when downstream sends fail, so the customer-facing flow never breaks. Failures are logged; don't change this to leak errors to the customer without a deliberate decision.
- **Vercel function body limit.** 4.5 MB. Videos must go through `get-upload-url.js` → Supabase Storage. Photos under that limit are OK as base64.
- **Phone number `(951) 634-3233` is hardcoded** as a fallback in chat error responses. If the business phone changes, grep for it across `api/` and `public/`.
- **The chatbot widget doesn't currently forward `page-context` to `/api/chat`** — the meta tag is set on every non-homepage page and the API accepts a `pageContext` parameter, but `public/assets/chatbot.js` only sends `{ messages }`. This is a logged bug; see "Known issues" below.

## Known issues to revisit

- **chatbot.js page-context wiring gap.** Frontend sets the `<meta name="page-context">` tag on every non-homepage page, and `api/chat.js` is fully wired to accept and sanitize it, but `public/assets/chatbot.js` doesn't read the meta tag or include `pageContext` in the POST body. Result: per-page context never reaches the model. Fix is small (read the meta tag in the chatbot init, include it in fetch body) but should be its own commit with localhost:3000 verification before pushing.
