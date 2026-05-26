// /api/portfolio-feed.ts
//
// Vercel serverless function (classic format) for Steve's HVAC plain HTML site.
// Same-origin proxy that fetches recent job photos from the Nexa Content Engine
// using a server-side env var, so the public portfolio page doesn't expose the
// API key in the browser.
//
// FILE LOCATION (in steves-heating-and-air repo):
//   /api/portfolio-feed.ts
//   (NOT /src/app/api/... — Steve's site is not Next.js)
//
// REQUIRED VERCEL ENV VAR:
//   NEXA_API_KEY  (server-side only, do NOT prefix with NEXT_PUBLIC_)
//
// CALLED FROM:
//   /portfolio/index.html  via  fetch('/api/portfolio-feed')

import type { VercelRequest, VercelResponse } from "@vercel/node";

const NEXA_BASE = "https://nexa-content-engine-eta.vercel.app/api";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET only
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.NEXA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server not configured (NEXA_API_KEY missing)",
      photos: [],
      count: 0,
    });
  }

  const limit =
    typeof req.query.limit === "string" ? req.query.limit : "30";
  const category =
    typeof req.query.category === "string" ? req.query.category : null;

  let url = `${NEXA_BASE}/job-photos/recent?limit=${encodeURIComponent(limit)}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({
        error: `Upstream ${upstream.status}: ${text.slice(0, 200)}`,
        photos: [],
        count: 0,
      });
    }

    const data = await upstream.json();

    // Cache for 60 seconds at the edge, allow stale for 5 minutes
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    return res.status(200).json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg, photos: [], count: 0 });
  }
}
