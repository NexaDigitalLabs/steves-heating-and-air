// /api/diagnose.js — Vercel serverless function
// Receives form payload (incl. base64 photo), uploads to Supabase, calls Claude
// Sonnet vision, persists submission row, emails Steve via Resend, returns AI
// output to the client. Always inserts a row + emails Steve, even on AI errors,
// so no lead is silently dropped.

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
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ── System prompt — voice + structure rules for the vision triage ───────────
const SYSTEM_PROMPT = `You are a triage assistant for Steve's Air Conditioning & Heating, a residential HVAC contractor serving Murrieta, Temecula, and the surrounding Inland Empire area of California. A customer has uploaded a photo and a brief description of an issue with their AC, heater, or HVAC system. Your job:

1. Determine if the photo is usable for triage.
2. If usable, identify the equipment type/brand if you can, and surface 1-3 SOFT, hedged possibilities for what might be going on, based on what's visible AND what the customer described.
3. ALWAYS defer to Steve as the actual answer.
4. Output structured JSON only — no commentary.

VOICE RULES (strict):
- Casual, contractor-friendly. Sounds like Steve's dispatch desk, not a chatbot.
- NEVER say "I'm an AI," "I've analyzed," "as an AI assistant," or anything that signals a bot.
- ALWAYS hedge possibilities: "could be," "might be," "possibilities include," "this kind of thing sometimes points to..."
- ALWAYS close customer-facing messages by deferring to Steve.
- NEVER give a definitive diagnosis. Even if 95% confident, hedge.
- NEVER give DIY instructions. No "try cleaning the filter," no "check the breaker." That's Steve's job.
- For parts, use plain location-based language in customer_message, not technical part names. Customers don't know parts; Steve does.
- Be concise. 2-4 sentences max for customer_message.

PHOTO USABILITY:
A photo IS usable if you can identify what kind of equipment is in it (AC condenser, furnace, water heater, thermostat, ductwork, etc.) AND/OR something visibly relevant to the customer's described issue. A photo is NOT usable if it's too blurry/dark to identify subject, the subject is unrelated to HVAC, or framing leaves nothing useful visible. If unusable, set status to "needs_better_photo" and ask in customer_message for a specific better shot.

SAFETY AND URGENCY:
Mark estimated_priority as "urgent" and add corresponding safety_flags if the customer mentions or the photo shows: gas smell ("possible_gas_leak"), burning smell or visible electrical damage ("electrical_hazard"), visible refrigerant leak or major icing ("refrigerant_concern"), fire damage or scorch marks ("fire_damage"), no AC during heat wave or no heat during cold weather especially with vulnerable household members ("no_climate_control_vulnerable"), or active water damage ("water_damage"). For urgent cases, customer_message should mention you've flagged it as urgent and Steve will be reaching out as soon as possible — but still without diagnosing.

For gas-leak flags specifically, customer_message should include basic safety guidance: open a window for ventilation, don't use open flames or electrical switches near the unit, and if smell is strong, leave the area and call SoCal Gas at 800-427-2200. This is safety guidance, not diagnosis.

OUTPUT SCHEMA (JSON only, no preamble, no code fences):
{
  "status": "ready" | "needs_better_photo" | "needs_more_info",
  "customer_message": "Short message shown to customer in browser. 2-4 sentences.",
  "unit_identification": "Brief description of what's in the photo, or null.",
  "possibilities": ["1-3 soft hedged possibilities. Empty array if status is not ready."],
  "steve_summary": "Fuller summary for Steve's notification email. Can use technical part names since Steve is the audience. 2-5 sentences.",
  "estimated_priority": "standard" | "urgent",
  "safety_flags": ["List of safety tags from above. Empty array if none."]
}`;

// ── Helpers ────────────────────────────────────────────────────────────────
function parseDataUrl(dataUrl) {
  // Expects "data:image/jpeg;base64,XXXX"
  const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function safeParseJson(raw) {
  if (!raw) return null;
  // Strip code fences if model added them despite the instruction
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function buildEmailHtml({ submissionId, customerName, customerPhone, customerEmail, description, photoUrl, ai, createdAt }) {
  const isUrgent = ai?.estimated_priority === 'urgent';
  const accent = isUrgent ? '#C41E1E' : '#2255A4';
  const possibilities = (ai?.possibilities || []).map(p => `<li style="margin: 4px 0; color: #333;">${escapeHtml(p)}</li>`).join('');
  const safetyFlags = (ai?.safety_flags || []).map(f => `<span style="display: inline-block; background: #C41E1E; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0;">${escapeHtml(f.toUpperCase().replace(/_/g, ' '))}</span>`).join('');
  const phoneDigitsOnly = (customerPhone || '').replace(/\D/g, '');
  // Normalize to E.164 (+1XXXXXXXXXX) for reliable tel: link behavior across
  // email clients. If 11 digits and starts with 1, use as-is; if 10, prepend 1.
  const phoneNormalized = phoneDigitsOnly.length === 10
    ? '1' + phoneDigitsOnly
    : phoneDigitsOnly;
  const phoneHref = `tel:+${phoneNormalized}`;
  const emailHref = customerEmail ? `mailto:${customerEmail}` : null;

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

      ${photoUrl ? `<div style="margin-bottom: 18px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px;">Photo</div>
        <a href="${photoUrl}" target="_blank" style="display: block;"><img src="${photoUrl}" alt="Customer photo" style="width: 100%; max-width: 560px; border-radius: 6px; border: 1px solid #e0e6ed; display: block;"/></a>
        <div style="font-size: 12px; color: #888; margin-top: 6px;"><a href="${photoUrl}" target="_blank" style="color: ${accent};">View full size →</a></div>
      </div>` : ''}

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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) + ' PT';
  } catch { return iso; }
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate env
  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !RESEND_KEY || !TO_EMAIL) {
    console.error('Missing required env vars');
    return res.status(500).json({
      status: 'ready',
      customer_message: "Got your photo and info — Steve will reach out within 1-2 hours."
    });
  }

  const { customerName, customerPhone, customerEmail, description, photoDataUrl } = req.body || {};

  // Server-side validation
  if (!customerName || !customerPhone || !photoDataUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const phoneDigits = String(customerPhone).replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return res.status(400).json({ error: 'Invalid phone' });
  }

  const photo = parseDataUrl(photoDataUrl);
  if (!photo) {
    return res.status(400).json({ error: 'Invalid photo data' });
  }
  // Cap server-side at ~6MB base64 to be safe with Vercel body limits
  if (photo.base64.length > 6_000_000) {
    return res.status(413).json({ error: 'Photo too large — please use a smaller image.' });
  }

  // Init clients
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const resend = new Resend(RESEND_KEY);

  // Generate IDs/paths
  const submissionId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = (photo.mediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const photoPath = `${new Date().toISOString().slice(0, 10)}/${submissionId}.${ext}`;
  const createdAt = new Date().toISOString();

  // ── 1. Upload photo to Supabase ──────────────────────────────────────────
  const photoBuffer = Buffer.from(photo.base64, 'base64');
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(photoPath, photoBuffer, { contentType: photo.mediaType, upsert: false });

  if (uploadErr) {
    console.error('Supabase upload failed:', uploadErr);
    // Don't bail — try to email Steve with what we have
  }

  // Generate signed URL for the email (and dashboard later)
  let signedPhotoUrl = null;
  if (!uploadErr) {
    const { data: signedData } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(photoPath, SIGNED_URL_TTL_SECONDS);
    signedPhotoUrl = signedData?.signedUrl || null;
  }

  // ── 2. Call Claude vision ────────────────────────────────────────────────
  let ai = null;
  try {
    const userText = description
      ? `Customer description: ${description}`
      : `Customer description: (none provided)`;

    const aiResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: photo.mediaType, data: photo.base64 } },
          { type: 'text', text: userText }
        ]
      }]
    });

    const textBlock = aiResponse.content.find(b => b.type === 'text');
    ai = safeParseJson(textBlock?.text);
  } catch (err) {
    console.error('Anthropic call failed:', err);
  }

  // Fallback if AI failed or returned malformed JSON
  if (!ai || typeof ai !== 'object') {
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

  // ── 3. Insert submission row in Supabase ─────────────────────────────────
  const dbRow = {
    id: undefined, // let DB generate uuid
    customer_name: customerName.slice(0, 80),
    customer_phone: customerPhone.slice(0, 20),
    customer_email: customerEmail ? customerEmail.slice(0, 120) : null,
    description: description ? description.slice(0, 2000) : null,
    photo_path: uploadErr ? null : photoPath,
    ai_output: ai,
    status: 'new',
    notes: null
  };
  // Strip undefined id so DB default applies
  delete dbRow.id;

  const { data: insertedRow, error: insertErr } = await supabase
    .from('diagnose_submissions')
    .insert(dbRow)
    .select('id, created_at')
    .single();

  if (insertErr) {
    console.error('Supabase insert failed:', insertErr);
    // Continue — still try to email Steve
  }

  const dbId = insertedRow?.id || submissionId;
  const dbCreatedAt = insertedRow?.created_at || createdAt;

  // ── 4. Email Steve via Resend ────────────────────────────────────────────
  try {
    const subjectPrefix = ai.estimated_priority === 'urgent' ? '[URGENT] ' : '[NEW LEAD] ';
    const emailSubject = `${subjectPrefix}${customerName} — ${ai.unit_identification || 'photo submitted'}`;
    const emailHtml = buildEmailHtml({
      submissionId: dbId,
      customerName, customerPhone, customerEmail, description,
      photoUrl: signedPhotoUrl,
      ai,
      createdAt: dbCreatedAt
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
    // Don't fail the response — customer still gets their AI message
  }

  // ── 5. Return AI output to client ────────────────────────────────────────
  return res.status(200).json({
    status: ai.status,
    customer_message: ai.customer_message,
    unit_identification: ai.unit_identification,
    possibilities: ai.possibilities,
    estimated_priority: ai.estimated_priority,
    safety_flags: ai.safety_flags
    // Note: steve_summary intentionally NOT returned to client — that's for Steve only
  });
}
