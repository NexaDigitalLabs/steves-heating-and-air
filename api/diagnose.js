// /api/diagnose.js — Vercel serverless function
// Phase 3 build: handles 1-3 photos OR 1 video (with first-frame extracted
// client-side). Implements inappropriate_content suppression — when AI flags
// the upload as NSFW/non-business, the email + DB write are both skipped and
// the uploaded files are deleted immediately.
//
// All real leads still hit Steve's inbox even on AI failure (resilience
// preserved from v1).

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ── Config / env ────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Steve's HVAC Leads <leads@nexadigitallabs.ai>";
const TO_EMAIL = process.env.STEVE_LEADS_EMAIL;

const MODEL = 'claude-sonnet-4-6';
const STORAGE_BUCKET = 'diagnose-photos';
const SIGNED_URL_TTL_SECONDS = 48 * 60 * 60; // 48 hours — matches retention

// ── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a triage assistant for Steve's Air Conditioning & Heating, a residential HVAC contractor serving Murrieta, Temecula, and the surrounding Inland Empire area of California. A customer has uploaded one or more photos (or a single frame from a short video) and a brief description of an issue. Your job:

1. Determine if the imagery is appropriate (no NSFW/violent/non-business content) and usable for triage.
2. If usable, identify the equipment type/brand if you can, and surface 1-3 SOFT, hedged possibilities for what might be going on, based on what's visible AND what the customer described.
3. ALWAYS defer to Steve as the actual answer.
4. Output structured JSON only — no commentary, no code fences.

VOICE RULES (strict):
- Casual, contractor-friendly. Sounds like Steve's dispatch desk, not a chatbot.
- NEVER say "I'm an AI," "I've analyzed," "as an AI assistant," or anything signaling a bot.
- ALWAYS hedge possibilities: "could be," "might be," "possibilities include."
- ALWAYS close customer-facing messages by deferring to Steve.
- NEVER give a definitive diagnosis. Even if 95% confident, hedge.
- NEVER give DIY instructions. No "try cleaning the filter," no "check the breaker."
- For parts in customer_message, use plain location-based language not technical part names.
- Be concise. 2-4 sentences max for customer_message.

CONTENT SAFETY (highest priority):
If the imagery contains NSFW content, violence, illegal activity, or anything clearly non-business in a way that suggests deliberate abuse — set status="inappropriate_content", customer_message="Please upload a photo of the equipment you're having trouble with." Leave all other fields null/empty arrays. DO NOT describe what was in the image. DO NOT engage with the content. The steve_summary field stays empty for this status.

USABILITY STATUSES:
A photo IS usable if you can identify HVAC equipment (AC condenser, furnace, water heater, thermostat, ductwork, mini-split, ductless head, etc.) AND/OR something visibly relevant to the customer's issue. Multiple photos should be evaluated together — they may show different angles, the unit + close-up of an issue, or unit + nameplate.

If imagery is not usable, choose the right status:

- "needs_better_photo" — equipment is identifiable but quality is poor (blurry, dark, bad framing) to triage well. Customer is engaged correctly but the shot needs help. Ask for a specific better shot in customer_message.

- "not_relevant" — clearly not HVAC equipment (living room shot, pet, furniture, exterior with no visible unit, etc.) and appears to be an honest mis-upload. Use friendly, inclusive language: "Please upload a photo of the equipment you're having trouble with — your AC, heater, water heater, thermostat, or anything else giving you the issue." Do NOT name only AC/furnace — keep it broad so customers with mini-splits, water heaters, or other systems feel addressed.

- "ready" — usable photos, equipment identified, generate possibilities.

SAFETY AND URGENCY:
Mark estimated_priority as "urgent" and add corresponding safety_flags if customer mentions or photos show: gas smell ("possible_gas_leak"), burning smell or visible electrical damage ("electrical_hazard"), visible refrigerant leak or major icing ("refrigerant_concern"), fire damage or scorch marks ("fire_damage"), no AC during heat wave or no heat during cold weather especially with vulnerable household members ("no_climate_control_vulnerable"), or active water damage ("water_damage").

For urgent cases, customer_message should mention you've flagged it as urgent and Steve will be reaching out as soon as possible — but still without diagnosing.

For gas-leak flags specifically, customer_message must include basic safety guidance: open a window for ventilation, don't use open flames or electrical switches near the unit, and if smell is strong, leave the area and call SoCal Gas at 800-427-2200. This is safety guidance, not diagnosis.

OUTPUT SCHEMA (JSON only, no preamble, no code fences):
{
  "status": "ready" | "needs_better_photo" | "needs_more_info" | "not_relevant" | "inappropriate_content",
  "customer_message": "Short message shown to customer in browser. 2-4 sentences.",
  "unit_identification": "Brief description of what's in the imagery, or null.",
  "possibilities": ["1-3 soft hedged possibilities. Empty array unless status is ready."],
  "steve_summary": "Fuller summary for Steve's notification email. Can use technical part names. 2-5 sentences. Empty string if status is inappropriate_content.",
  "estimated_priority": "standard" | "urgent",
  "safety_flags": ["List of safety tags from above. Empty array if none."]
}`;

// ── Helpers ────────────────────────────────────────────────────────────────
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function safeParseJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short'
    }) + ' PT';
  } catch { return iso; }
}

function buildEmailHtml({ submissionId, customerName, customerPhone, customerEmail, description, photoUrls, videoUrl, ai, createdAt }) {
  const isUrgent = ai?.estimated_priority === 'urgent';
  const accent = isUrgent ? '#C41E1E' : '#2255A4';
  const possibilities = (ai?.possibilities || []).map(p => `<li style="margin: 4px 0; color: #333;">${escapeHtml(p)}</li>`).join('');
  const safetyFlags = (ai?.safety_flags || []).map(f => `<span style="display: inline-block; background: #C41E1E; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0;">${escapeHtml(f.toUpperCase().replace(/_/g, ' '))}</span>`).join('');

  const phoneDigitsOnly = (customerPhone || '').replace(/\D/g, '');
  const phoneNormalized = phoneDigitsOnly.length === 10 ? '1' + phoneDigitsOnly : phoneDigitsOnly;
  const phoneHref = `tel:+${phoneNormalized}`;
  const emailHref = customerEmail ? `mailto:${customerEmail}` : null;

  let mediaSection = '';
  if (videoUrl) {
    mediaSection = `<div style="margin-bottom: 18px;">
      <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px;">Customer's video <span style="text-transform: none; color: #999; font-weight: normal;">(expires in 48 hours)</span></div>
      <a href="${videoUrl}" target="_blank" style="display: inline-block; background: ${accent}; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">▶ Watch Video</a>
      <div style="font-size: 12px; color: #888; margin-top: 8px;">Save a copy if you'll need it after 48h.</div>
    </div>`;
  } else if (photoUrls && photoUrls.length > 0) {
    const imgs = photoUrls.map((url, i) => `
      <a href="${url}" target="_blank" style="display: block; flex: 1; min-width: 0;"><img src="${url}" alt="Photo ${i + 1}" style="width: 100%; max-width: 100%; border-radius: 6px; border: 1px solid #e0e6ed; display: block;"/></a>
    `).join('');
    const photoCount = photoUrls.length;
    mediaSection = `<div style="margin-bottom: 18px;">
      <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px;">${photoCount} photo${photoCount > 1 ? 's' : ''} <span style="text-transform: none; color: #999; font-weight: normal;">(expire in 48 hours)</span></div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">${imgs}</div>
      <div style="font-size: 12px; color: #888; margin-top: 6px;">Tap any photo to view full size. Save copies if you'll need them after 48h.</div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: #f5f7fa; color: #1a1a1a;">
  <div style="background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1);">
    <div style="background: ${accent}; color: #fff; padding: 16px 24px;">
      <div style="font-size: 13px; letter-spacing: .1em; text-transform: uppercase; opacity: .85;">${isUrgent ? '🚨 Urgent Lead' : 'New Photo Lead'}</div>
      <div style="font-size: 22px; font-weight: 600; margin-top: 4px;">${escapeHtml(customerName)}</div>
    </div>
    <div style="padding: 20px 24px;">
      ${safetyFlags ? `<div style="margin-bottom: 16px;">${safetyFlags}</div>` : ''}
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
        <tr><td style="padding: 6px 0; color: #666; width: 90px; font-size: 14px;">Phone</td><td style="padding: 6px 0;"><a href="${phoneHref}" style="color: ${accent}; text-decoration: none; font-weight: 600; font-size: 16px;">${escapeHtml(customerPhone)}</a></td></tr>
        ${customerEmail ? `<tr><td style="padding: 6px 0; color: #666; font-size: 14px;">Email</td><td style="padding: 6px 0;"><a href="${emailHref}" style="color: ${accent}; text-decoration: none;">${escapeHtml(customerEmail)}</a></td></tr>` : ''}
        <tr><td style="padding: 6px 0; color: #666; font-size: 14px;">Submitted</td><td style="padding: 6px 0; color: #333; font-size: 14px;">${escapeHtml(formatTimestamp(createdAt))}</td></tr>
        <tr><td style="padding: 6px 0; color: #666; font-size: 14px;">Status</td><td style="padding: 6px 0;"><span style="display: inline-block; background: ${ai?.status === 'ready' ? '#2BB673' : '#D4A843'}; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml((ai?.status || 'received').toUpperCase().replace(/_/g, ' '))}</span></td></tr>
      </table>
      ${description ? `<div style="background: #f5f7fa; border-left: 3px solid ${accent}; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 18px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px;">Customer's description</div>
        <div style="color: #1a1a1a;">${escapeHtml(description)}</div>
      </div>` : ''}
      ${mediaSection}
      ${ai?.unit_identification ? `<div style="margin-bottom: 14px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;">Unit identification</div>
        <div style="color: #1a1a1a; font-weight: 500;">${escapeHtml(ai.unit_identification)}</div>
      </div>` : ''}
      ${possibilities ? `<div style="margin-bottom: 14px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;">Possibilities to investigate</div>
        <ul style="padding-left: 20px; margin: 0;">${possibilities}</ul>
      </div>` : ''}
      ${ai?.steve_summary ? `<div style="background: #fff8e6; border-left: 3px solid #D4A843; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 18px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px;">Steve's notes</div>
        <div style="color: #1a1a1a; line-height: 1.55;">${escapeHtml(ai.steve_summary)}</div>
      </div>` : ''}
      <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid #e0e6ed; text-align: center;">
        <a href="${phoneHref}" style="display: inline-block; background: #2BB673; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">📞 Call ${escapeHtml(customerName.split(' ')[0])} Now</a>
      </div>
      <div style="margin-top: 18px; font-size: 11px; color: #999; text-align: center;">Submission ID: ${escapeHtml(submissionId)}</div>
    </div>
  </div>
</body></html>`;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !RESEND_KEY || !TO_EMAIL) {
    console.error('Missing required env vars');
    return res.status(500).json({
      status: 'ready',
      customer_message: "Got your photo and info — Steve will reach out within 1-2 hours."
    });
  }

  const {
    customerName, customerPhone, customerEmail, description,
    mediaType,           // 'photos' or 'video'
    photoDataUrls,       // array of base64 photos (mediaType='photos')
    videoPath,           // pre-uploaded supabase path (mediaType='video')
    videoFrameDataUrl    // base64 first frame for AI vision (mediaType='video')
  } = req.body || {};

  // Server-side validation
  if (!customerName || !customerPhone) return res.status(400).json({ error: 'Missing required fields' });
  const phoneDigits = String(customerPhone).replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return res.status(400).json({ error: 'Invalid phone' });
  if (!['photos', 'video'].includes(mediaType)) return res.status(400).json({ error: 'Invalid mediaType' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const resend = new Resend(RESEND_KEY);

  const submissionId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  // Resolve media → upload paths + AI image data
  let photoPaths = [];
  let aiImages = [];
  let videoStoragePath = null;

  if (mediaType === 'photos') {
    if (!Array.isArray(photoDataUrls) || photoDataUrls.length === 0 || photoDataUrls.length > 3) {
      return res.status(400).json({ error: 'Provide 1-3 photos' });
    }
    for (const dataUrl of photoDataUrls) {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(400).json({ error: 'Invalid photo data' });
      if (parsed.base64.length > 4_000_000) {
        return res.status(413).json({ error: 'A photo is too large — please use smaller images.' });
      }
      const ext = (parsed.mediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `${createdAt.slice(0, 10)}/${submissionId}_${photoPaths.length + 1}.${ext}`;
      const buffer = Buffer.from(parsed.base64, 'base64');
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, buffer, { contentType: parsed.mediaType, upsert: false });
      if (!upErr) photoPaths.push(path);
      aiImages.push(parsed);
    }
  } else {
    // video — already uploaded by client to videoPath; we have first frame for AI
    if (!videoPath || typeof videoPath !== 'string') return res.status(400).json({ error: 'Missing videoPath' });
    const parsedFrame = parseDataUrl(videoFrameDataUrl);
    if (!parsedFrame) return res.status(400).json({ error: 'Missing videoFrameDataUrl' });
    if (parsedFrame.base64.length > 2_000_000) return res.status(413).json({ error: 'Frame too large' });
    videoStoragePath = videoPath;
    aiImages.push(parsedFrame);
  }

  // Call Claude vision with all images
  let ai = null;
  try {
    const userText = description ? `Customer description: ${description}` : `Customer description: (none provided)`;
    const imageBlocks = aiImages.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
    }));
    const aiResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [...imageBlocks, { type: 'text', text: userText }]
      }]
    });
    const textBlock = aiResponse.content.find(b => b.type === 'text');
    ai = safeParseJson(textBlock?.text);
  } catch (err) {
    console.error('Anthropic call failed:', err);
  }

  // Fallback if AI failed or returned malformed JSON
  if (!ai || typeof ai !== 'object' || !ai.status) {
    ai = {
      status: 'ready',
      customer_message: "Got your photo and info — Steve will personally review and reach out within 1-2 hours.",
      unit_identification: null,
      possibilities: [],
      steve_summary: 'AI triage unavailable for this submission. Photo and customer info captured normally — please review the photo and follow up directly.',
      estimated_priority: 'standard',
      safety_flags: []
    };
  }

  // ── INAPPROPRIATE CONTENT BRANCH ─────────────────────────────────────────
  // Suppress email + DB write + delete uploaded media. Customer just gets the
  // message and can re-upload. Steve's inbox stays clean.
  if (ai.status === 'inappropriate_content') {
    const allPaths = [...photoPaths, ...(videoStoragePath ? [videoStoragePath] : [])];
    if (allPaths.length > 0) {
      try { await supabase.storage.from(STORAGE_BUCKET).remove(allPaths); }
      catch (err) { console.error('Failed to delete inappropriate media:', err); }
    }
    return res.status(200).json({
      status: 'inappropriate_content',
      customer_message: ai.customer_message || "Please upload a photo of the equipment you're having trouble with."
    });
  }

  // Insert submission row in Supabase
  const dbRow = {
    customer_name: customerName.slice(0, 80),
    customer_phone: customerPhone.slice(0, 20),
    customer_email: customerEmail ? customerEmail.slice(0, 120) : null,
    description: description ? description.slice(0, 2000) : null,
    media_type: mediaType,
    photo_paths: photoPaths.length > 0 ? photoPaths : null,
    video_path: videoStoragePath,
    ai_output: ai,
    status: 'new',
    notes: null
  };

  const { data: insertedRow, error: insertErr } = await supabase
    .from('diagnose_submissions')
    .insert(dbRow)
    .select('id, created_at')
    .single();

  if (insertErr) console.error('Supabase insert failed:', insertErr);
  const dbId = insertedRow?.id || submissionId;
  const dbCreatedAt = insertedRow?.created_at || createdAt;

  // Generate signed URLs for the email
  let signedPhotoUrls = [];
  let signedVideoUrl = null;
  for (const path of photoPaths) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (data?.signedUrl) signedPhotoUrls.push(data.signedUrl);
  }
  if (videoStoragePath) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(videoStoragePath, SIGNED_URL_TTL_SECONDS);
    signedVideoUrl = data?.signedUrl || null;
  }

  // Email Steve via Resend
  try {
    const subjectPrefix = ai.estimated_priority === 'urgent' ? '[URGENT] ' : '[NEW LEAD] ';
    const emailSubject = `${subjectPrefix}${customerName} — ${ai.unit_identification || (mediaType === 'video' ? 'video submitted' : 'photo submitted')}`;
    const emailHtml = buildEmailHtml({
      submissionId: dbId, customerName, customerPhone, customerEmail, description,
      photoUrls: signedPhotoUrls, videoUrl: signedVideoUrl,
      ai, createdAt: dbCreatedAt
    });
    await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      reply_to: customerEmail || TO_EMAIL,
      subject: emailSubject,
      html: emailHtml
    });
  } catch (err) {
    console.error('Resend send failed:', err);
  }

  return res.status(200).json({
    status: ai.status,
    customer_message: ai.customer_message,
    unit_identification: ai.unit_identification,
    possibilities: ai.possibilities,
    estimated_priority: ai.estimated_priority,
    safety_flags: ai.safety_flags
    // steve_summary intentionally NOT returned to client — server-only field
  });
}
