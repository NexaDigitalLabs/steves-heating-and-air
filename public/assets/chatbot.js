/* ═══════════════════════════════════════════════════════════════════
   STEVE'S HEATING & AIR — CHATBOT WIDGET
   Self-contained: auto-injects the widget HTML on DOMContentLoaded so
   pages only need a single <script defer src="/assets/chatbot.js">.
   Hits /api/chat for replies. Pairs with /assets/chatbot.css.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const WIDGET_HTML = [
    '<div id="chatbot-launcher" aria-label="Ask Steve — open chat">',
    '  <div class="cb-icon-wrap">',
    '    <img src="/images/steve-avatar.png" alt="Steve" class="cb-launcher-img"/>',
    '  </div>',
    '  <span class="cb-close">✕</span>',
    '</div>',
    '<div id="chatbot-window" role="dialog" aria-label="Chat with Steve">',
    '  <div class="cb-head">',
    '    <div class="cb-head-av"><img src="/images/steve-avatar.png" alt="Steve"/></div>',
    '    <div class="cb-head-tx">',
    '      <strong>Steve\'s Assistant</strong>',
    '      <span>Online — typically replies in seconds</span>',
    '    </div>',
    '  </div>',
    '  <div class="cb-body" id="cb-body">',
    '    <div class="cb-msg bot">Hey there! 👋 I\'m Steve\'s AI assistant. Ask me about HVAC, our service area, hours, brands we work with, troubleshooting tips, or anything else.\n\nWhat can I help you with?</div>',
    '  </div>',
    '  <div class="cb-suggest" id="cb-suggest">',
    '    <button data-q="Do you offer emergency service?">Emergency service?</button>',
    '    <button data-q="What areas do you serve?">Service area?</button>',
    '    <button data-q="My AC is not cooling, what should I check?">AC not cooling</button>',
    '    <button data-q="Do you give free estimates?">Free estimates?</button>',
    '  </div>',
    '  <div class="cb-input-row">',
  '    <input id="cb-input" type="text" placeholder="Ask about HVAC..." maxlength="500"/>',
  '    <button id="cb-send" aria-label="Send">' + SEND_ICON_SVG + '</button>',
  '</div>',
    '  <div class="cb-foot">Powered by AI • Call (951) 634-3233 for urgent service</div>',
    '</div>'
  ].join('');

  const cbState = {
    history: [],
    busy: false,
    opened: false,
  };

  function cbToggle() {
    const launcher = document.getElementById('chatbot-launcher');
    const win = document.getElementById('chatbot-window');
    cbState.opened = !cbState.opened;
    launcher.classList.toggle('open', cbState.opened);
    win.classList.toggle('open', cbState.opened);
    if (cbState.opened) {
      setTimeout(function () {
        const inp = document.getElementById('cb-input');
        if (inp) inp.focus();
      }, 250);
    }
  }

  function cbAddMsg(role, text, isError) {
    const body = document.getElementById('cb-body');
    if (!body) return;
    const el = document.createElement('div');
    el.className = 'cb-msg ' + (role === 'user' ? 'user' : 'bot' + (isError ? ' error' : ''));
    if (role !== 'user') {
      const safe = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const phoneRe = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
      const linked = safe.replace(phoneRe, function (match) {
        const digits = match.replace(/\D/g, '');
        if (digits.length !== 10) return match;
        return '<a href="tel:' + digits + '" class="cb-phone-link">' + match + '</a>';
      });
      el.innerHTML = linked;
    } else {
      el.textContent = text;
    }
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function cbAddLeadPill(lead) {
    const body = document.getElementById('cb-body');
    if (!body) return;
    const el = document.createElement('div');
    el.className = 'cb-lead-pill';
    el.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12 10 17 19 8"/></svg>' +
      '<div><strong>Got it!</strong> Steve will call ' +
      escapeHtml(lead.name) + ' at ' + escapeHtml(lead.phone) + ' shortly.</div>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function cbShowTyping() {
    const body = document.getElementById('cb-body');
    if (!body) return;
    const el = document.createElement('div');
    el.className = 'cb-typing';
    el.id = 'cb-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function cbHideTyping() {
    const el = document.getElementById('cb-typing');
    if (el) el.remove();
  }

  function cbHideSuggestions() {
    const s = document.getElementById('cb-suggest');
    if (s) s.style.display = 'none';
  }

  function cbSend() {
    if (cbState.busy) return;
    const input = document.getElementById('cb-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    cbAsk(text);
  }

  async function cbAsk(text) {
    if (cbState.busy) return;
    cbHideSuggestions();
    cbAddMsg('user', text);
    cbState.history.push({ role: 'user', content: text });
    cbState.busy = true;
    const sendBtn = document.getElementById('cb-send');
    if (sendBtn) sendBtn.disabled = true;
    cbShowTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: cbState.history }),
      });
      cbHideTyping();
      if (!res.ok) {
        const errData = await res.json().catch(function () { return {}; });
        cbAddMsg('bot', errData.error || "Something went wrong. Please call (951) 634-3233 directly.", true);
      } else {
        const data = await res.json();
        const reply = data.reply || "Sorry, I didn't catch that. Could you try again?";
        cbAddMsg('bot', reply);
        cbState.history.push({ role: 'assistant', content: reply });
        if (data.lead && data.lead.name && data.lead.phone) {
          cbAddLeadPill(data.lead);
        }
        if (cbState.history.length > 20) cbState.history = cbState.history.slice(-20);
      }
    } catch (err) {
      cbHideTyping();
      cbAddMsg('bot', "Sorry — I'm having a quick hiccup on my end. For immediate help, give Steve a call at (951) 634-3233 or try again in a moment.", true);
    } finally {
      cbState.busy = false;
      if (sendBtn) sendBtn.disabled = false;
      const inp = document.getElementById('cb-input');
      if (inp) inp.focus();
    }
  }

  // Expose cbAsk so external buttons (e.g., page CTAs) can pre-seed
  // a question. cbToggle exposed for completeness.
  window.cbAsk = cbAsk;
  window.cbToggle = cbToggle;

  // ─── INIT ──────────────────────────────────────────────────────────
  function init() {
    // If something else has already mounted the widget, skip
    if (document.getElementById('chatbot-launcher')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = WIDGET_HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    // Wire up event handlers
    const launcher = document.getElementById('chatbot-launcher');
    if (launcher) launcher.addEventListener('click', cbToggle);

    const sendBtn = document.getElementById('cb-send');
    if (sendBtn) sendBtn.addEventListener('click', cbSend);

    const input = document.getElementById('cb-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') cbSend();
      });
    }

    // Suggestion chips
    document.querySelectorAll('#cb-suggest button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const q = btn.dataset.q;
        if (q) cbAsk(q);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
