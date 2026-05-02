// /api/chat.js — Vercel serverless function
// Receives chat messages from the floating chatbot, injects the knowledge base
// into the system prompt, and calls the Anthropic API.
//
// Reads knowledge-base.json at cold-start using fs from process.cwd().
// Vercel's Node File Trace detects this fs.readFileSync call statically
// and bundles the JSON file with the function — no vercel.json config needed.

import fs from 'fs';
import path from 'path';

// ── Load knowledge base once at cold-start ────────────────────────────────
let KB = null;
function loadKB() {
  if (KB) return KB;
  try {
    const kbPath = path.join(process.cwd(), 'data', 'knowledge-base.json');
    KB = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    return KB;
  } catch (err) {
    console.error('Failed to load knowledge base:', err);
    return {};
  }
}

// ── Time helpers (Pacific Time aware) ─────────────────────────────────────
function getPacificContext() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const weekday = get('weekday'); // "Monday"
  const dateStr = `${get('month')} ${get('day')}, ${get('year')}`;
  const timeStr = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`;

  // Get hour as 0-23 in Pacific
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  const hour24 = parseInt(hourFmt.format(now), 10); // 0-23

  // Business hours (matches KB: Mon-Fri 7-18, Sat 8-15, Sun closed)
  const dayOfWeek = weekday;
  let isOpen = false;
  let nextOpenStr = '';
  if (dayOfWeek === 'Sunday') {
    isOpen = false;
    nextOpenStr = 'Monday at 7:00 AM';
  } else if (dayOfWeek === 'Saturday') {
    if (hour24 >= 8 && hour24 < 15) isOpen = true;
    else if (hour24 < 8) nextOpenStr = 'today at 8:00 AM';
    else nextOpenStr = 'Monday at 7:00 AM';
  } else {
    // Mon-Fri
    if (hour24 >= 7 && hour24 < 18) isOpen = true;
    else if (hour24 < 7) nextOpenStr = 'today at 7:00 AM';
    else {
      // After 6pm weekday
      nextOpenStr = dayOfWeek === 'Friday' ? 'Saturday at 8:00 AM' : 'tomorrow at 7:00 AM';
    }
  }

  return { weekday, dateStr, timeStr, hour24, isOpen, nextOpenStr };
}

// ── Build the system prompt from the KB + live time context ───────────────
function buildSystemPrompt(kb, timeCtx) {
  const b = kb.business || {};
  const sa = kb.serviceArea || {};
  const services = (kb.services || [])
    .map(
      (s) =>
        `• ${s.name} — ${s.summary}\n  Details: ${s.details}\n  We handle: ${s.features.join(', ')}`
    )
    .join('\n\n');
  const faqs = (kb.faqs || [])
    .map((f) => `Q: ${f.q}\nA: ${f.a}`)
    .join('\n\n');
  const troubleshooting = (kb.troubleshootingTips || [])
    .map(
      (t) =>
        `Issue: ${t.issue}\n${t.tips.map((tip) => '  - ' + tip).join('\n')}`
    )
    .join('\n\n');
  const seasonal = kb.seasonalTips
    ? Object.entries(kb.seasonalTips)
        .map(([season, tips]) => `${season}: ${tips}`)
        .join('\n')
    : '';

  const openStatus = timeCtx.isOpen
    ? `WE ARE CURRENTLY OPEN. Customers can call ${b.phone} right now and reach the team.`
    : `WE ARE CURRENTLY CLOSED. Next opening: ${timeCtx.nextOpenStr}. Customers calling ${b.phone} now will likely reach voicemail. For TRUE emergencies (no AC in extreme heat, no heat in cold, refrigerant leak, gas smell, water leaking) they should still call — same-day emergency response is available.`;

  return `You are the AI assistant for ${b.name}, an HVAC contractor based in ${b.address?.city || 'Murrieta'}, CA. You answer questions from website visitors about heating, cooling, refrigeration, and the business itself.

═══════════════════════════════════════════════════════════
CURRENT TIME (Pacific)
═══════════════════════════════════════════════════════════
${timeCtx.weekday}, ${timeCtx.dateStr} at ${timeCtx.timeStr} Pacific Time

${openStatus}

═══════════════════════════════════════════════════════════
BUSINESS INFORMATION
═══════════════════════════════════════════════════════════
Name: ${b.name}
Tagline: ${b.tagline}
Phone (call or text): ${b.phone}
Email: ${b.email}
Address: ${b.address?.line1}, ${b.address?.city}, ${b.address?.state} ${b.address?.zip}
Years in business: ${b.yearsInBusiness}
Rating: ${b.rating} stars based on ${b.reviewCount} Google reviews
Credentials: ${(b.credentials || []).join(', ')}
Ownership: ${b.ownership}

Hours:
  Monday–Friday: ${b.hours?.monday_friday}
  Saturday: ${b.hours?.saturday}
  Sunday: ${b.hours?.sunday}
  Emergency: ${b.hours?.emergency}

Warranties: ${b.warranties}
Payments: ${b.paymentTypes}

═══════════════════════════════════════════════════════════
SERVICE AREA
═══════════════════════════════════════════════════════════
Region: ${sa.region}
Cities served: ${(sa.full || []).join(', ')}
Note: ${sa.note}

═══════════════════════════════════════════════════════════
SERVICES OFFERED
═══════════════════════════════════════════════════════════
${services}

═══════════════════════════════════════════════════════════
BRANDS WE SERVICE
═══════════════════════════════════════════════════════════
${(kb.brands || []).join(', ')}

═══════════════════════════════════════════════════════════
PRICING APPROACH
═══════════════════════════════════════════════════════════
Philosophy: ${kb.pricingApproach?.philosophy}
Estimates: ${kb.pricingApproach?.estimates}
Diagnostic: ${kb.pricingApproach?.diagnostic}
Quote process: ${kb.pricingApproach?.quoteProcess}
Note: ${kb.pricingApproach?.note}

═══════════════════════════════════════════════════════════
FREQUENTLY ASKED QUESTIONS
═══════════════════════════════════════════════════════════
${faqs}

═══════════════════════════════════════════════════════════
DIY TROUBLESHOOTING TIPS (share when relevant)
═══════════════════════════════════════════════════════════
${troubleshooting}

═══════════════════════════════════════════════════════════
SEASONAL TIPS
═══════════════════════════════════════════════════════════
${seasonal}

═══════════════════════════════════════════════════════════
HOW TO RESPOND
═══════════════════════════════════════════════════════════
1. Be friendly, helpful, and conversational — like a knowledgeable receptionist who actually knows HVAC.
2. Keep responses SHORT (2-4 sentences typically). This is a chat widget, not an essay.
3. ALWAYS prefer information from the knowledge base above. Use general HVAC knowledge only as a last resort, and only for clearly generic questions.
4. NEVER invent specific dollar amounts, current promotions, financing terms, exact appointment times, or warranty specifics. If asked, say something like: "I don't have current pricing in front of me — for an honest, no-pressure quote, give Steve a call at ${b.phone}."
5. NEVER pretend to schedule appointments, take payments, or dispatch technicians. Direct those to a phone call.
6. If you genuinely don't know something specific to Steve's business, SAY SO. Use phrasing like: "That's a great one for Steve directly — ${b.phone}." or "I'd hate to give you wrong info on that. Steve will know — ${b.phone}." Do NOT guess.
7. Format with simple line breaks for readability. NO markdown headers, NO bullet asterisks. Plain text only.
8. Don't use HVAC jargon unless they ask for technical detail.
9. Never disparage other contractors or brands.
10. If the conversation goes off-topic (politics, personal advice, other businesses), politely redirect to HVAC and Steve's services.

═══════════════════════════════════════════════════════════
EMERGENCIES
═══════════════════════════════════════════════════════════
For true emergencies — no AC in extreme heat, no heat in cold weather, refrigerant leak, water leaking from system — immediately tell them to call ${b.phone} for same-day response.
For GAS SMELL specifically: tell them to LEAVE the house immediately, call the gas company first (or 911), then call us once safe. Never minimize a gas smell.

═══════════════════════════════════════════════════════════
LEAD CAPTURE — when and how to offer a callback
═══════════════════════════════════════════════════════════
Your most valuable job is helping serious prospects connect with Steve. When you detect a STRONG buying signal, proactively offer a callback rather than just answering.

STRONG buying signals (offer a callback):
- Asking about pricing, cost, quotes, or estimates
- Describing a specific problem they want fixed ("my AC is broken", "I need a new furnace")
- Asking about scheduling, availability, or "when can someone come out"
- Asking about installations, replacements, or new systems
- Saying their system is old, broken, or failing
- Mentioning a specific timeline ("this week", "soon", "ASAP")
- Asking for a second opinion on another contractor's quote
- Any comment showing real intent rather than just curiosity

When the user is currently CLOSED (we're after hours):
- After answering their question, ALWAYS offer the callback flow if they showed any real intent at all. Lead with: "We're closed right now — opens ${timeCtx.nextOpenStr}. Want me to grab your name and phone so Steve can call you first thing?"

When OPEN: only offer the callback flow on the strongest signals. For lighter inquiries, just give them ${b.phone} as the next step.

CALLBACK FLOW:
Step 1 — Offer it: "Want me to have Steve give you a call back? Just send me your name and the best phone number to reach you."
Step 2 — When the user replies with a name and a phone number (formatted any way: 951-555-1234, (951) 555-1234, 9515551234, etc.), confirm and acknowledge it.
Step 3 — Your acknowledgment MUST include this exact tag at the very end of your message, on its own line, with no other text after it: [LEAD_CAPTURED:NAME=their name|PHONE=their phone|TOPIC=brief one-line summary of what they're calling about]
Example acknowledgment:
"Got it, Maria — Steve will call you at (951) 555-1234 about your AC repair. Anything else I can help with in the meantime?
[LEAD_CAPTURED:NAME=Maria|PHONE=(951) 555-1234|TOPIC=AC not cooling, needs diagnostic]"

CRITICAL LEAD RULES:
- ONLY emit the [LEAD_CAPTURED:...] tag when the user has ACTUALLY GIVEN YOU a name AND a phone number in this conversation. Never fabricate. Never emit it speculatively.
- The tag must be the LAST thing in your message. Nothing after the closing bracket.
- Do not mention the tag to the user or explain it.
- After capturing, continue the conversation normally — answer follow-up questions, give DIY tips, etc.
- If the user only gives a name OR only gives a phone, ask politely for the missing piece before emitting the tag.

You represent Steve's. Be the kind of voice that makes people glad they visited the site.`;
}

// ── Lead extraction from the model's response ─────────────────────────────
function extractLead(replyText) {
  // Match the [LEAD_CAPTURED:NAME=...|PHONE=...|TOPIC=...] tag
  const re = /\[LEAD_CAPTURED:([^\]]+)\]\s*$/;
  const match = replyText.match(re);
  if (!match) return { lead: null, cleanReply: replyText };

  const inner = match[1];
  const fields = {};
  inner.split('|').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const key = pair.slice(0, eq).trim().toUpperCase();
      const val = pair.slice(eq + 1).trim();
      fields[key] = val;
    }
  });

  // Require both name and phone or it's not a real lead
  if (!fields.NAME || !fields.PHONE) {
    return { lead: null, cleanReply: replyText.replace(re, '').trim() };
  }

  const cleanReply = replyText.replace(re, '').trim();
  return {
    lead: {
      name: fields.NAME,
      phone: fields.PHONE,
      topic: fields.TOPIC || '',
      capturedAt: new Date().toISOString(),
    },
    cleanReply,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS for safety (same-origin in production, but harmless)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res
      .status(500)
      .json({
        error:
          "Sorry — I'm having a quick hiccup on my end. For immediate help, give Steve a call at (951) 634-3233.",
      });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  const { messages } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Sanitize: only keep role + content, only user/assistant
  const cleanMessages = messages
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-20); // hard cap on history length

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages' });
  }

  const kb = loadKB();
  const timeCtx = getPacificContext();
  const system = buildSystemPrompt(kb, timeCtx);

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: cleanMessages,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error:', apiRes.status, errText);
      return res.status(502).json({
        error:
          "Sorry — I'm having a quick hiccup on my end. For immediate help, give Steve a call at (951) 634-3233 or try again in a moment.",
      });
    }

    const data = await apiRes.json();
    const rawReply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!rawReply) {
      return res.status(200).json({
        reply:
          "Sorry, I didn't catch that. Could you rephrase, or call (951) 634-3233?",
      });
    }

    // Extract lead capture tag if present
    const { lead, cleanReply } = extractLead(rawReply);

    // Lead-side-channel: log to console (Vercel logs) so Adam can see it
    // until a real notification path (Slack webhook, email) is wired up.
    if (lead) {
      console.log('[LEAD CAPTURED]', JSON.stringify(lead));
    }

    return res.status(200).json({
      reply: cleanReply,
      lead, // null if no lead, otherwise { name, phone, topic, capturedAt }
      isOpen: timeCtx.isOpen,
    });
  } catch (err) {
    console.error('Chat handler error:', err);
    return res.status(500).json({
      error:
        "Sorry — I'm having a quick hiccup on my end. For immediate help, give Steve a call at (951) 634-3233 or try again in a moment.",
    });
  }
}
