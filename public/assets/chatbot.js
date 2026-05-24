/* ===================================================================
   STEVE'S HEATING & AIR - CHATBOT WIDGET
   Self-contained: auto-injects the widget HTML on DOMContentLoaded.
   Hits /api/chat for replies. Pairs with /assets/chatbot.css.
   Pure ASCII source - encoding-proof.
   =================================================================== */

(function () {
  'use strict';

  // Paper plane SVG. Pure ASCII path data - cannot be corrupted.
  var SEND_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

  var WIDGET_HTML = [
    '<div id="chatbot-launcher" aria-label="Ask Steve - open chat">',
    '  <div class="cb-icon-wrap">',
    '    <img src="/images/steve-avatar.png" alt="Steve" class="cb-launcher-img"/>',
    '  </div>',
    '  <span class="cb-close">X</span>',
    '</div>',
    '<div id="chatbot-window" role="dialog" aria-label="Chat with Steve">',
    '  <div class="cb-head">',
    '    <div class="cb-head-av"><img src="/images/steve-avatar.png" alt="Steve"/></div>',
    '    <div class="cb-head-tx">',
    '      <strong>Steve\'s Assistant</strong>',
    '      <span>Online - typically replies in seconds</span>',
    '    </div>',
    '  </div>',
    '  <div class="cb-body" id="cb-body">',
    '    <div class="cb-msg bot">Hey there! I\'m Steve\'s AI assistant. Ask me about HVAC, our service area, hours, brands we work with, troubleshooting tips, or anything else.\n\nWhat can I help you with?</div>',
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
    '  </div>',
    '  <div class="cb-foot">Powered by AI - Call (951) 634-3233 for urgent service</div>',
    '</div>'
  ].join('');

  var cbState = {
    history: [],
    busy: false,
    opened: false
  };

  function cbToggle() {
    var launcher = document.getElementById('chatbot-launcher');
    var win = document.getElementById('chatbot-window');
    cbState.opened = !cbState.opened;
    launcher.classList.toggle('open', cbState.opened);
    win.classList.toggle('open', cbState.opened);
    if (cbState.opened) {
      setTimeout(function () {
        var inp = document.getElementById('cb-input');
        if (inp) inp.focus();
      }, 250);
    }
  }

  function cbAddMsg(role, text, isError) {
    var body = document.getElementById('cb-body');
    if (!body) return;
    var el = document.createElement('div');
    el.className = 'cb-msg ' + (role === 'user' ? 'user' : 'bot' + (isError ? ' error' : ''));
    if (role !== 'user') {
      var safe = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      var phoneRe = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
      var linked = safe.replace(phoneRe, function (match) {
        var digits = match.replace(/\D/g, '');
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
    var body = document.getElementById('cb-body');
    if (!body) return;
    var el = document.createElement('div');
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
    var body = document.getElementById('cb-body');
    if (!body) return;
    var el = document.createElement('div');
    el.className = 'cb-typing';
    el.id = 'cb-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function cbHideTyping() {
    var el = document.getElementById('cb-typing');
    if (el) el.remove();
  }

  function cbHideSuggestions() {
    var s = document.getElementById('cb-suggest');
    if (s) s.style.display = 'none';
  }

  function cbSend() {
    if (cbState.busy) return;
    var input = document.getElementById('cb-input');
    var text = input.value.trim();
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
    var sendBtn = document.getElementById('cb-send');
    if (sendBtn) sendBtn.disabled = true;
    cbShowTyping();

    try {
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: cbState.history })
      });
      cbHideTyping();
      if (!res.ok) {
        var errData = await res.json().catch(function () { return {}; });
        cbAddMsg('bot', errData.error || 'Something went wrong. Please call (951) 634-3233 directly.', true);
      } else {
        var data = await res.json();
        var reply = data.reply || "Sorry, I didn't catch that. Could you try again?";
        cbAddMsg('bot', reply);
        cbState.history.push({ role: 'assistant', content: reply });
        if (data.lead && data.lead.name && data.lead.phone) {
          cbAddLeadPill(data.lead);
        }
        if (cbState.history.length > 20) cbState.history = cbState.history.slice(-20);
      }
    } catch (err) {
      cbHideTyping();
      cbAddMsg('bot', "Sorry - I'm having a quick hiccup on my end. For immediate help, give Steve a call at (951) 634-3233 or try again in a moment.", true);
    } finally {
      cbState.busy = false;
      if (sendBtn) sendBtn.disabled = false;
      var inp = document.getElementById('cb-input');
      if (inp) inp.focus();
    }
  }

  window.cbAsk = cbAsk;
  window.cbToggle = cbToggle;

  function init() {
    if (document.getElementById('chatbot-launcher')) return;

    var wrap = document.createElement('div');
    wrap.innerHTML = WIDGET_HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    var launcher = document.getElementById('chatbot-launcher');
    if (launcher) launcher.addEventListener('click', cbToggle);

    var sendBtn = document.getElementById('cb-send');
    if (sendBtn) sendBtn.addEventListener('click', cbSend);

    var input = document.getElementById('cb-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') cbSend();
      });
    }

    document.querySelectorAll('#cb-suggest button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.dataset.q;
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
