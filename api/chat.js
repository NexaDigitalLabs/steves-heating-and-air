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

// ── Build the system prompt from the KB ───────────────────────────────────
function buildSystemPrompt(kb) {
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

  return `You are the AI assistant for ${b.name}, an HVAC contractor based in ${b.address?.city || 'Murrieta'}, CA. You answer questions from website visitors about heating, cooling, refrigeration, and the business itself.

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
3. ALWAYS prefer information from the knowledge base above. If the visitor asks something not in the KB, you can answer with general HVAC knowledge — but be honest if you're not sure of a Steve's-specific answer and direct them to call ${b.phone}.
4. For pricing questions: never invent specific dollar amounts. Explain we provide free estimates on installations and direct them to call for current rates.
5. For emergencies (no AC in heat, no heat in cold, refrigerant leak, gas smell, water leaking): immediately tell them to call ${b.phone} for same-day emergency service. For gas smell specifically, tell them to leave the house and call the gas company first, then us.
6. When relevant, naturally include the phone number ${b.phone} as a clickable next step.
7. If asked about a service you don't see in the KB, say you'll need them to call to confirm — don't make up new services.
8. Don't pretend to schedule appointments, take payment, or send technicians directly. Direct those to a phone call.
9. Use plain language — no jargon-y HVAC acronyms unless they ask for technical detail.
10. Never disparage other contractors or brands. Stay positive and focused on what Steve's offers.
11. Format with simple line breaks for readability. NO markdown headers, NO bullet asterisks. Plain text only — this renders in a chat bubble.
12. If the conversation goes off-topic (politics, personal advice, other businesses), politely redirect to HVAC and Steve's services.

You represent Steve's. Be the kind of voice that makes people glad they visited the site.`;
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
      .json({ error: 'Server is missing its API key. Please call (951) 634-3233 directly.' });
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
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-20); // hard cap on history length

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages' });
  }

  const kb = loadKB();
  const system = buildSystemPrompt(kb);

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
        error: "I'm having trouble connecting right now. Please call (951) 634-3233 — we'll take care of you.",
      });
    }

    const data = await apiRes.json();
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({
      reply: reply || "Sorry, I didn't catch that. Could you rephrase, or call (951) 634-3233?",
    });
  } catch (err) {
    console.error('Chat handler error:', err);
    return res.status(500).json({
      error: "Something went wrong on our end. Please call (951) 634-3233 directly.",
    });
  }
}
