// /api/quote.js — Vercel serverless function
// Receives lead-capture-form submissions from /quote/ and emails them to Steve
// via Resend. No DB persistence (leads are short-lived; Steve calls back fast).
//
// All env vars are shared with /api/diagnose so no new infrastructure needed.

import { Resend } from 'resend';

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Steve's HVAC Leads <leads@nexadigitallabs.ai>";
const TO_EMAIL = process.env.STEVE_LEADS_EMAIL;

// ── Display labels for the email (form sends slugs) ────────────────────────
const SERVICE_LABELS = {
  'ac': 'Air Conditioning',
  'furnace': 'Furnace / Heating',
  'heatpump': 'Heat Pump',
  'res-ref': 'Residential Refrigeration',
  'com-ref': 'Commercial Refrigeration',
  'maintenance': 'Maintenance / Tune-Up',
  'air-quality': 'Air Quality / IAQ',
  'water-heaters': 'Water Heater',
  'energy-audit': 'Energy Audit',
  'other': 'Other / Not sure'
};
const URGENCY_LABELS = {
  'asap': 'ASAP — today if possible',
  'this-week': 'This week',
  'scheduled': 'Scheduled — flexible on timing',
  'exploring': 'Just exploring options'
};
const BEST_TIME_LABELS = {
  'anytime': 'Anytime',
  'morning': 'Morning (8am-12pm)',
  'afternoon': 'Afternoon (12pm-5pm)',
  'evening': 'Evening (5pm-8pm)'
};
const PROPERTY_LABELS = {
  'residential': 'Residential',
  'commercial': 'Commercial'
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTimestamp() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short'
  }) + ' PT';
}

function buildEmailHtml(d) {
  const isUrgent = d.urgency === 'asap';
  const accent = isUrgent ? '#C41E1E' : '#2255A4';

  const phoneDigits = (d.phone || '').replace(/\D/g, '');
  const phoneE164 = phoneDigits.length === 10 ? '1' + phoneDigits : phoneDigits;
  const phoneHref = `tel:+${phoneE164}`;

  const serviceLabel = SERVICE_LABELS[d.service] || d.service;
  const urgencyLabel = URGENCY_LABELS[d.urgency] || d.urgency;
  const propertyLabel = PROPERTY_LABELS[d.property_type] || d.property_type;
  const bestTimeLabel = BEST_TIME_LABELS[d.best_time] || d.best_time;

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#f5f7fa;color:#1a1a1a;">
  <div style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:${accent};color:#fff;padding:16px 24px;">
      <div style="font-size:13px;letter-spacing:.1em;text-transform:uppercase;opacity:.85;">${isUrgent ? '🚨 Urgent Quote Request' : 'New Quote Request'}</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px;">${escapeHtml(d.name)}</div>
    </div>
    <div style="padding:20px 24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr><td style="padding:6px 0;color:#666;width:120px;font-size:14px;">Phone</td><td style="padding:6px 0;"><a href="${phoneHref}" style="color:${accent};text-decoration:none;font-weight:600;font-size:16px;">${escapeHtml(d.phone)}</a></td></tr>
        ${d.email ? `<tr><td style="padding:6px 0;color:#666;font-size:14px;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(d.email)}" style="color:${accent};text-decoration:none;">${escapeHtml(d.email)}</a></td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#666;font-size:14px;">ZIP</td><td style="padding:6px 0;color:#1a1a1a;">${escapeHtml(d.zip)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:14px;">Best time</td><td style="padding:6px 0;color:#1a1a1a;">${escapeHtml(bestTimeLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:14px;">Submitted</td><td style="padding:6px 0;color:#333;font-size:14px;">${escapeHtml(formatTimestamp())}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;background:#f5f7fa;border-radius:6px;">
        <tr>
          <td style="padding:14px 16px;width:50%;border-right:1px solid #e0e6ed;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Service</div>
            <div style="color:#1a1a1a;font-weight:600;">${escapeHtml(serviceLabel)}</div>
          </td>
          <td style="padding:14px 16px;width:50%;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Property</div>
            <div style="color:#1a1a1a;font-weight:600;">${escapeHtml(propertyLabel)}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:14px 16px;border-top:1px solid #e0e6ed;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Urgency</div>
            <div style="color:#1a1a1a;font-weight:600;">${escapeHtml(urgencyLabel)}</div>
          </td>
        </tr>
      </table>
      ${d.message ? `<div style="background:#fff8e6;border-left:3px solid #D4A843;padding:14px 18px;border-radius:0 6px 6px 0;margin-bottom:18px;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Customer's description</div>
        <div style="color:#1a1a1a;line-height:1.55;white-space:pre-wrap;">${escapeHtml(d.message)}</div>
      </div>` : ''}
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e0e6ed;text-align:center;">
        <a href="${phoneHref}" style="display:inline-block;background:#2BB673;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">📞 Call ${escapeHtml((d.name || '').split(' ')[0])} Now</a>
      </div>
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RESEND_KEY || !TO_EMAIL) {
    console.error('Missing required env vars for /api/quote');
    // Don't leak the failure to the customer — pretend success and log loudly
    return res.status(200).json({ ok: true });
  }

  const { name, phone, email, zip, service, property_type, urgency, best_time, message, honeypot } =
    req.body || {};

  // Validation
  if (!name || !phone || !zip || !service || !property_type || !urgency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const phoneDigits = String(phone).replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return res.status(400).json({ error: 'Invalid phone' });
  if (!/^[0-9]{5}$/.test(zip)) return res.status(400).json({ error: 'Invalid ZIP' });

  // Honeypot — silently drop bots
  if (honeypot) {
    console.log('Honeypot triggered, dropping submission');
    return res.status(200).json({ ok: true });
  }

  const resend = new Resend(RESEND_KEY);
  const data = {
    name: String(name).slice(0, 80),
    phone: String(phone).slice(0, 20),
    email: email ? String(email).slice(0, 120) : null,
    zip: String(zip).slice(0, 5),
    service: String(service).slice(0, 32),
    property_type: String(property_type).slice(0, 16),
    urgency: String(urgency).slice(0, 16),
    best_time: best_time ? String(best_time).slice(0, 16) : 'anytime',
    message: message ? String(message).slice(0, 2000) : null
  };

  try {
    const subjectPrefix = data.urgency === 'asap' ? '[URGENT QUOTE] ' : '[QUOTE] ';
    const serviceLabel = SERVICE_LABELS[data.service] || data.service;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      reply_to: data.email || TO_EMAIL,
      subject: `${subjectPrefix}${data.name} — ${serviceLabel} (${data.zip})`,
      html: buildEmailHtml(data)
    });
  } catch (err) {
    console.error('Resend send failed:', err);
    // Still return 200 so customer sees success — they don't care about our infra
    // Steve loses this lead but we logged it for follow-up review
  }

  return res.status(200).json({ ok: true });
}
