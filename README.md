# Steve's Air Conditioning & Heating

Static HTML site + AI chatbot. Hosted on Vercel.

## Repo structure

```
steves-heating-and-air/
├── public/                     ← Vercel serves this folder as the site root
│   ├── index.html              ← main site (single-page app router)
│   └── images/                 ← all photo + video assets
│       ├── flag-bg.jpg         (hero/footer background)
│       ├── truck-hero.mp4      (hero video)
│       ├── truck-hero-poster.jpg  (hero video freeze frame — pre-generated)
│       ├── logo.png            (navbar/footer)
│       └── ... (other photos)
├── api/
│   └── chat.js                 ← Vercel serverless fn for chatbot
├── data/
│   └── knowledge-base.json     ← chatbot's source of truth
├── package.json                ← module type + node version
├── vercel.json                 ← function config
├── .gitignore
└── README.md                   ← you are here
```

**Important:** Because we have a `public/` folder, Vercel serves files from `public/` at the URL root. So `public/images/logo.png` is accessed at `/images/logo.png` (NOT `/public/images/logo.png`). The `index.html` MUST be inside `public/` for Vercel to serve it as the homepage.

## How to update

1. Drop new files into the repo locally.
2. `git add . && git commit -m "what changed" && git push`
3. Vercel auto-deploys on push to `main` (~30 seconds).

## Environment variables

The chatbot calls the Anthropic API. Set this in Vercel:

| Name | Value | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Vercel → Project → Settings → Environment Variables |

Get a key at [console.anthropic.com](https://console.anthropic.com). Set it for **Production**, **Preview**, and **Development**. After adding, redeploy (Vercel → Deployments → ⋯ → Redeploy) so the function picks it up.

**Local development:** create `.env.local` (gitignored) at the repo root with `ANTHROPIC_API_KEY=sk-ant-...` and run `vercel dev`.

## Image & video assets needed

Drop these in `public/images/`:

| Filename | Used for | Status |
|---|---|---|
| `flag-bg.png` | Hero left column + footer overlay | ✅ Uploaded |
| `truck-hero.mp4` | Hero video (right column, plays once then freezes) | ✅ Uploaded (rename `hero-truck.mp4` → `truck-hero.mp4`) |
| `truck-hero-poster.jpg` | Freeze frame for hero video | ✅ Pre-generated, in repo |
| `top-flag-banner.jpg` | Top page banner (replacing stars row) | ✅ Uploaded — wiring TBD |
| `5-star-rating.png` | Reviews section graphic | ✅ Uploaded — wiring TBD |
| `leave-review.png` | Reviews CTA | ✅ Uploaded — wiring TBD |
| `logo.png` | Navbar + footer | ✅ Uploaded |
| `team.jpg` | "Why Steve's" section | ✅ Uploaded |
| `ac-service.jpg` | Service grid: AC card | ✅ Uploaded |
| `furnace.png` | Service grid: Furnace card | ✅ Uploaded |
| `heat-pump.png` | Service grid: Heat Pump card | ✅ Uploaded |
| `res-ref.png` | Service grid: Residential Refrigeration | ✅ Uploaded |
| `commercial.png` | Service grid: Commercial Refrigeration | ✅ Uploaded |
| `maintenance.jpg` | Service grid: Maintenance | ⏳ TBD |
| `about.jpg` | About page portrait (vertical 3:4) | ⏳ TBD |
| `favicon.png` | Browser tab icon (32×32) | ⏳ TBD |
| `og-image.jpg` | Social sharing preview (1200×630) | ⏳ TBD |

If a photo is missing, the site gracefully falls back to gradient cards with emoji icons. Deploy first, swap in photos as you get them — nothing breaks.

## Hero video specifics

- Plays once on page load, then **freezes on the last frame** (no looping)
- Poster image (`truck-hero-poster.jpg`) shows instantly while video buffers
- On mobile, the hero stacks vertically: text on top, video below
- Respects `prefers-reduced-motion` — users with motion sensitivity see only the poster
- If autoplay is blocked (iOS Low Power Mode, etc.), the poster carries the hero alone

**To swap the video:** drop a new `truck-hero.mp4` in `public/images/`. To regenerate the poster from a different frame, use ffmpeg:
```bash
ffmpeg -i public/images/truck-hero.mp4 -ss 0.7 -frames:v 1 -vf "scale=1920:-2" -q:v 2 public/images/truck-hero-poster.jpg
```
(Adjust `-ss 0.7` to the second of the desired freeze frame.)

## Chatbot — how it works

1. User clicks the floating bubble (bottom-right), types a question.
2. Browser POSTs to `/api/chat` with the conversation history.
3. The serverless function loads `data/knowledge-base.json`, builds a system prompt that includes ALL business info, then calls the Anthropic API (Claude Haiku 4.5).
4. Response gets shown in the chat bubble.

The KB stays server-side — never exposed to the browser. Cost is roughly $0.001-0.003 per conversation depending on length.

### Updating the knowledge base

Edit `data/knowledge-base.json`. The chatbot picks it up on the next cold start. Push to git → Vercel rebuilds → done. No code changes needed.

The KB has these sections:
- `business` — name, phone, email, address, hours, credentials (now includes NATE-certified)
- `serviceArea` — cities served + region
- `services` — each service with details and feature bullets
- `brands` — brands serviced
- `pricingApproach` — how you handle pricing/estimates
- `values` — what you stand for
- `faqs` — Q&A pairs the bot will pull from
- `troubleshootingTips` — DIY tips by issue
- `seasonalTips` — seasonal advice

When Steve gives you a new piece of info, just open the JSON, add it, push.

## Routes / pages

Single-page app — `index.html` contains all six "pages" and JS swaps which one is visible:

- Home
- Services with sub-views: `ac`, `furnace`, `heatpump`, `res-ref`, `com-ref`, `maintenance`
- About Us
- Reviews
- Service Area
- Contact

## Costs

| Service | Free tier | Likely cost |
|---|---|---|
| Vercel | 100GB bandwidth/month | $0 unless site goes viral |
| Anthropic API | None — pay per use | ~$1-5/month for typical small-business chatbot traffic |

## Testing locally

```bash
npm install -g vercel
vercel dev
```

Open `http://localhost:3000`. The chat bubble works locally if `.env.local` has your `ANTHROPIC_API_KEY`.

## What's NOT done yet (future work)

- [ ] Real photos beyond flag + truck video
- [ ] Connect the contact form to a real submission handler
- [ ] Google Analytics / Vercel Analytics
- [ ] Sitemap + robots.txt for SEO
- [ ] Real Google Maps embed with Steve's actual pin
- [ ] Migration to Next.js when scale demands it
