/* ═══════════════════════════════════════════════════════════════════
   STEVE'S HEATING & AIR — SHARED SITE SCRIPT
   Loaded on every non-homepage page. Provides:
   - Mobile hamburger toggle
   - Navbar shadow on scroll
   - Fade-in for `.fi` elements as they enter viewport
   - Inline contact form submit handler (visual feedback only)
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── HAMBURGER ─────────────────────────────────────────────────────
  const ham = document.getElementById('ham');
  const navUl = document.getElementById('navUl');
  if (ham && navUl) {
    ham.addEventListener('click', function () {
      this.classList.toggle('open');
      navUl.classList.toggle('open');
    });
  }

  // ─── NAVBAR SCROLL SHADOW ─────────────────────────────────────────
  const navbar = document.getElementById('navbar');
  function onScroll() {
    if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 30);
    fi();
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ─── FADE-IN ON SCROLL ────────────────────────────────────────────
  function fi() {
    document.querySelectorAll('.fi:not(.in)').forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight - 60) {
        el.classList.add('in');
      }
    });
  }
  // First pass after layout settles
  setTimeout(fi, 120);
  // Also run on resize (orientation changes etc.)
  window.addEventListener('resize', fi);

  // Expose for any inline handlers that want to re-trigger
  window.fi = fi;

  // ─── CONTACT FORM — visual confirmation handler ───────────────────
  // Pages that include a contact form set onsubmit="return fSub(event)"
  // on the <form>. Real submission to a backend endpoint can be added
  // later; for now this gives the user feedback that the form fired.
  window.fSub = function (e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('.fsub');
    if (!btn) return false;
    btn.textContent = "✓ Sent! We'll be in touch very soon.";
    btn.style.background = 'var(--blue)';
    btn.disabled = true;
    return false;
  };
})();
