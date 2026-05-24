#!/usr/bin/env python3
"""
Steve's Heating & Air — Sprint 2 fixes

Run from repo root: python sprint2_fixes.py

Does six things:
  1. Creates /quote/ standalone page with full quote form (10 fields, POSTs to /api/quote).
  2. Creates /reviews/ standalone page with curated review showcase + leave-a-review CTAs.
  3. Creates /contact/ standalone page with hours, NAP, service-area summary, quote CTA.
  4. Retargets sitewide:
       - nav/footer "Contact" links: /#contact -> /contact/
       - nav/footer "Reviews" links: /#reviews -> /reviews/
       - "Request Online Quote" buttons: /#contact -> /quote/
  5. Appends CSS rules to public/assets/site.css:
       - center orphan cards on last row of .svxlink-grid
  6. Updates public/sitemap.xml with the 3 new URLs.
  7. Updates public/data/knowledge-base.json with page awareness.

Idempotent — safe to re-run. Writes a per-file backup with .bak extension
the first time it modifies a file.
"""

from __future__ import annotations
import json
import re
import sys
from collections import OrderedDict
from datetime import date
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────
# CANONICAL DATA — must match Sprint 1
# ──────────────────────────────────────────────────────────────────────
SERVICES = [
    ("air-conditioning",          "Air Conditioning",          "❄️", "ac"),
    ("furnaces",                  "Furnaces",                  "🔥", "furnace"),
    ("heat-pumps",                "Heat Pumps",                "♨️", "heatpump"),
    ("ductless-mini-splits",      "Ductless Mini-Splits",      "🔲", "ductless"),
    ("whole-house-fans",          "Whole House Fans",          "🌀", "whole-house-fans"),
    ("ductwork",                  "Ductwork & Airflow",        "🛠️", "ductwork"),
    ("condenser-relocation",      "Condenser Relocation",      "📦", "condenser-relo"),
    ("residential-refrigeration", "Residential Refrigeration", "🏠", "res-ref"),
    ("commercial-refrigeration",  "Commercial Refrigeration",  "🏢", "com-ref"),
    ("commercial-hvac",           "Commercial HVAC",           "🏬", "com-hvac"),
    ("hvac-maintenance",          "HVAC Maintenance",          "🔧", "maintenance"),
    ("air-quality-control",       "Air Quality Control",       "💨", "air-quality"),
    ("drain-cleaning",            "Drain Cleaning",            "🚰", "drain"),
    ("oven-hoods",                "Oven Hood Installation",    "🍳", "oven-hoods"),
    ("water-heaters",             "Water Heaters",             "💧", "water-heaters"),
    ("energy-audits",             "Energy Audits",             "⚡", "energy-audit"),
]

CITIES = [
    ("murrieta",        "Murrieta, CA"),
    ("temecula",        "Temecula, CA"),
    ("menifee",         "Menifee, CA"),
    ("wildomar",        "Wildomar, CA"),
    ("lake-elsinore",   "Lake Elsinore, CA"),
    ("canyon-lake",     "Canyon Lake, CA"),
    ("sun-city",        "Sun City, CA"),
    ("winchester",      "Winchester, CA"),
    ("french-valley",   "French Valley, CA"),
    ("perris",          "Perris, CA"),
    ("hemet",           "Hemet, CA"),
    ("moreno-valley",   "Moreno Valley, CA"),
    ("riverside",       "Riverside, CA"),
    ("corona",          "Corona, CA"),
    ("romoland",        "Romoland, CA"),
    ("homeland",        "Homeland, CA"),
    ("san-bernardino",  "San Bernardino, CA"),
    ("fallbrook",       "Fallbrook, CA"),
    ("rainbow",         "Rainbow, CA"),
    ("anza",            "Anza, CA"),
    ("aguanga",         "Aguanga, CA"),
]

# Curated reviews lifted from homepage JSON-LD (12 = nice 3x4 grid feel).
# Picked for diversity: mix of Google + Yelp, mix of repair vs install vs maint.
REVIEWS = [
    ("Sarah Switzer", "Google", "2026-04-02",
     "Great service! I had quotes from other companies who were charging double and more than the quote I got from Steve. Service was fast, reliable, friendly and quality. I have recommended them to friends and family!"),
    ("Christina Ayguasbiba", "Google", "2026-04-25",
     "Steve's cooling and Heating is amazing. Thank you Jared for your professionalism and bright good spirits. Jared did a tune-up on both of our AC units and now we are ready for the summer."),
    ("Jim Fritz", "Google", "2026-03-04",
     "They showed up on time, did the job neatly and quickly, and even helped me with the paperwork for the financing. I highly recommend Steve's AC and Heating."),
    ("Paul Haug", "Google", "2026-04-04",
     "Steve's technician came in professionally, assessed the problem, told me my options, and gave me a quote. They found a problem I didn't know about, it was a quick fix, and I was up and running. They cleaned up the little mess made and thanked me for picking Steve's."),
    ("Richard Leon", "Google", "2026-04-04",
     "Steve's Air Conditioning & Heating are the real deal — honest, reliable, and they don't try to upsell you. Been using Steve's for years. I will call Steve before I will call my home warranty company when it comes to my AC and heater."),
    ("John Buckley", "Google", "2026-04-04",
     "Steve was professional, prompt and knowledgeable. Resurrected my 45+ year old air conditioner and saved me from having to replace it. Would definitely recommend him and his team to all my friends and family."),
    ("Hannah O.", "Yelp", "2025-07-25",
     "I honestly cannot thank Steve enough. He fixed our fan motor for our AC unit and charged a very fair price. He also gave us a great quote on a new HVAC installation that beat every other company. Very family and veteran oriented company."),
    ("Kathy M.", "Yelp", "2025-12-01",
     "Extremely professional service crew. I could not be more pleased with the product and installation process in getting new AC units for my two story home. They are the most reliable company I have ever done business with."),
    ("Robynn Flores", "Google", "2026-01-04",
     "Steve's is awesome! We have used them for both A/C and heating service — each time they have been quick, professional, and affordable. A great resource and business for our community!"),
    ("Christine Ko", "Google", "2025-11-04",
     "We had another company come out for a furnace tune-up and they told me I needed a pricey service done. I was suspicious and called Steve for a second opinion. My suspicions were right — Steve confirmed the work wasn't needed."),
    ("Steve Swanson", "Google", "2025-06-04",
     "I've used Steve's services for my properties on 3 separate occasions and he has always done a fantastic job. The blower motor on my condenser went out and he replaced the part saving me thousands."),
    ("Mike & Mickey via Sharon T.", "Yelp", "2025-07-02",
     "Excellent service. Excellent installation. Mike & Mickey were terrific. They were very meticulous in fixing our AC system which had been leaking from the first installation from a different AC company."),
]

REPO_ROOT  = Path.cwd()
PUBLIC_DIR = REPO_ROOT / "public"
ASSETS_DIR = PUBLIC_DIR / "assets"
DATA_DIR   = PUBLIC_DIR / "data"

# ──────────────────────────────────────────────────────────────────────
# Shared HTML renderers (matches Sprint 1 patterns)
# ──────────────────────────────────────────────────────────────────────
def render_nav(active: str = "") -> str:
    """active is one of: home, services, about, reviews, blog, service-area, contact"""
    lis = "\n".join(
        f'        <li><a href="/services/{slug}/"><span class="drop-ic">{icon}</span><span class="drop-tx">{name}</span></a></li>'
        for slug, name, icon, _ in SERVICES
    )
    def cls(name: str) -> str:
        return ' class="act"' if active == name else ''
    return f'''<nav id="navbar">
  <a class="nav-logo" href="/">
    <img src="/images/logo.png" alt="Steve&#39;s Air Conditioning &amp; Heating" onerror="this.style.display=&#39;none&#39;"/>
  </a>
  <ul class="nav-ul" id="navUl">
    <li><a href="/"{cls("home")}>Home</a></li>
    <li class="has-drop">
      <a href="/services/"{cls("services")}>Services &#x25BE;</a>
      <ul class="drop">
{lis}
      </ul>
    </li>
    <li><a href="/about/"{cls("about")}>About Us</a></li>
    <li><a href="/reviews/"{cls("reviews")}>Reviews</a></li>
    <li><a href="/blog/"{cls("blog")}>Blog</a></li>
    <li><a href="/service-area/"{cls("service-area")}>Service Area</a></li>
    <li><a href="/contact/"{cls("contact")}>Contact</a></li>
    <li><a href="tel:9516343233" class="nav-cta-btn">📞 Schedule Now</a></li>
  </ul>
  <div class="ham" id="ham"><span></span><span></span><span></span></div>
</nav>'''

def render_footer() -> str:
    svc_lis = "\n".join(
        f'          <li><a href="/services/{slug}/">{name}</a></li>'
        for slug, name, _, _ in SERVICES
    )
    city_lis = "\n".join(
        f'          <li><a href="/{slug}/">{name}</a></li>'
        for slug, name in CITIES
    )
    return f'''<!-- FOOTER -->
<footer>
  <div class="ft-nap" itemscope itemtype="https://schema.org/HVACBusiness">
    <div class="ft-nap-name" itemprop="name">Steve&#39;s Air Conditioning &amp; Heating</div>
    <address class="ft-nap-addr">
      <span>Serving Murrieta, Temecula &amp; Southwest Riverside County</span>
      &nbsp;&bull;&nbsp;
      <a href="tel:9516343233" itemprop="telephone">(951) 634-3233</a>
      &nbsp;&bull;&nbsp;
      <a href="mailto:stevesac_6708@yahoo.com" itemprop="email">stevesac_6708@yahoo.com</a>
      <span itemprop="address" itemscope itemtype="https://schema.org/PostalAddress" style="display:none">
        <span itemprop="addressLocality">Murrieta</span><span itemprop="addressRegion">CA</span><span itemprop="postalCode">92562</span>
      </span>
    </address>
    <div class="ft-nap-meta">
      <span>Mon&ndash;Fri 7am&ndash;6pm</span>&bull;<span>Sat 8am&ndash;3pm</span>&bull;<span>Sun Emergency Only</span>
    </div>
  </div>

  <div class="ft-g">
    <div class="ft-br">
      <img src="/images/logo.png" alt="Steve&#39;s Air Conditioning &amp; Heating" onerror="this.style.display=&#39;none&#39;"/>
      <div class="ft-br-tag">Honest &middot; Skilled &middot; Local</div>
      <div class="ft-creds">
        <span class="ft-cred"><strong>20+</strong> Years in SW Riverside</span>
        <span class="ft-cred-sep"></span>
        <span class="ft-cred"><strong>NATE-Certified</strong> &middot; Licensed &middot; Bonded &middot; Insured</span>
        <span class="ft-cred-sep"></span>
        <span class="ft-cred"><strong>5.0&#9733;</strong> on Google &middot; 612+ Reviews</span>
      </div>
    </div>
    <div class="ft-c">
      <details class="ft-acc">
        <summary><h4>Services</h4></summary>
        <ul class="ft-services-ul">
{svc_lis}
        </ul>
      </details>
    </div>
    <div class="ft-c">
      <details class="ft-acc">
        <summary><h4>Areas Served</h4></summary>
        <ul class="ft-areas-ul">
{city_lis}
        </ul>
      </details>
      <h4 class="ft-company-h">Company</h4>
      <ul>
        <li><a href="/about/">About Us</a></li>
        <li><a href="/reviews/">Reviews</a></li>
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/service-area/">Service Area</a></li>
        <li><a href="/contact/">Contact</a></li>
      </ul>
    </div>
    <div class="ft-c">
      <h4>Contact</h4>
      <ul>
        <li><a href="tel:9516343233">(951) 634-3233</a></li>
        <li><a href="mailto:stevesac_6708@yahoo.com">stevesac_6708@yahoo.com</a></li>
        <li><a href="/service-area/">Murrieta &amp; SW Riverside County</a></li>
      </ul>
      <h4 class="ft-follow-h">Follow Us</h4>
      <div class="ft-social">
        <a href="https://www.facebook.com/Stevesairconditioningandheating/" target="_blank" rel="noopener noreferrer" aria-label="Steve&#39;s HVAC on Facebook" class="ft-social-lk">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg>
        </a>
        <a href="https://www.instagram.com/steves_ac_and_heating/" target="_blank" rel="noopener noreferrer" aria-label="Steve&#39;s HVAC on Instagram" class="ft-social-lk">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.85 5.85 0 0 0-2.13 1.38A5.85 5.85 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.73 1.46 1.38 2.13a5.88 5.88 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.88 5.88 0 0 0 2.13-1.38 5.88 5.88 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.85 5.85 0 0 0-1.38-2.13A5.85 5.85 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zm0 10.16A4 4 0 1 1 16 12a4 4 0 0 1-4 4zm6.41-11.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44z"/></svg>
        </a>
      </div>
    </div>
  </div>
  <div class="ft-bot">
    <span>&copy; 2026 Steve&#39;s Air Conditioning &amp; Heating &mdash; All rights reserved.</span>
    <div class="ft-bs">
      <span class="ft-b">&check; Licensed</span>
      <span class="ft-b">&check; Bonded</span>
      <span class="ft-b">&check; Insured</span>
    </div>
  </div>
</footer>

<!-- STICKY CALL (mobile only) -->
<a href="tel:9516343233" class="sticall" aria-label="Call Steve&#39;s HVAC at (951) 634-3233">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57-.35-.11-.74-.03-1.02.24l-2.2 2.2a15.07 15.07 0 0 1-6.59-6.58l2.2-2.21a.96.96 0 0 0 .25-1A11.36 11.36 0 0 1 8.5 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.5c0-.55-.45-1-1-1z"/>
  </svg>
</a>

<script defer src="/assets/site.js"></script>
<!-- Chatbot widget (auto-injects on DOMContentLoaded) -->
<script defer src="/assets/chatbot.js"></script>

</body>
</html>'''

def render_head(title: str, description: str, canonical: str,
                page_context: str, extra_head: str = "") -> str:
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{title}</title>
  <meta name="description" content="{description}"/>
  <meta name="theme-color" content="#0B1D3A"/>
  <link rel="icon" href="/images/favicon.png" type="image/png"/>
  <meta property="og:title" content="{title}"/>
  <meta property="og:description" content="{description}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="{canonical}"/>
  <link rel="canonical" href="{canonical}"/>
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png"/>
  <meta name="robots" content="index, follow, max-image-preview:large"/>

  <!-- Page context for chatbot -->
  <meta name="page-context" content="{page_context}"/>

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Anton&amp;family=Bebas+Neue&amp;family=Oswald:wght@500;600;700&amp;family=Rajdhani:wght@500;600;700&amp;family=Inter:wght@300;400;500;600&amp;display=swap" rel="stylesheet"/>

  <!-- Shared site styles (must load before chatbot.css) -->
  <link rel="stylesheet" href="/assets/site.css"/>
  <link rel="stylesheet" href="/assets/chatbot.css"/>
{extra_head}
</head>
<body>

'''

def render_breadcrumb(label: str) -> str:
    return f'''<!-- BREADCRUMB -->
<nav class="breadcrumb" aria-label="Breadcrumb">
  <div class="breadcrumb-in">
    <a href="/">Home</a>
    <span class="breadcrumb-sep">&rsaquo;</span>
    <span aria-current="page">{label}</span>
  </div>
</nav>

'''

# ──────────────────────────────────────────────────────────────────────
# PAGE: /quote/
# ──────────────────────────────────────────────────────────────────────
def build_quote_page() -> str:
    # Build service options including all 16 services
    service_opts = '\n              '.join(
        f'<option value="{kb_id}">{name}</option>'
        for _, name, _, kb_id in SERVICES
    ) + '\n              <option value="other">Other / Not sure</option>'

    jsonld = json.dumps({
        "@context": "https://schema.org",
        "@type": "ContactPage",
        "name": "Request a Free Quote — Steve's Air Conditioning & Heating",
        "url": "https://steves-heating-and-air.vercel.app/quote/",
        "mainEntity": {
            "@type": "HVACBusiness",
            "name": "Steve's Air Conditioning & Heating",
            "telephone": "+19516343233",
            "email": "stevesac_6708@yahoo.com",
            "areaServed": "Southwest Riverside County, California"
        }
    }, indent=2)

    head = render_head(
        title="Request a Free Quote | Steve's Air Conditioning &amp; Heating",
        description=("Get a free, no-pressure HVAC quote from Steve's Air Conditioning &amp; Heating. "
                     "Serving Murrieta, Temecula, and Southwest Riverside County. "
                     "Honest pricing, NATE-certified, 20+ years local. Call (951) 634-3233."),
        canonical="https://steves-heating-and-air.vercel.app/quote/",
        page_context="page:quote|Request a Free Quote",
        extra_head=f'\n  <script type="application/ld+json">\n{jsonld}\n  </script>'
    )

    body = f'''{render_nav("contact")}

{render_breadcrumb("Request a Free Quote")}

<!-- PAGE HEADER -->
<section class="ph">
  <div class="ph-in">
    <h1>Request a <em>Free Quote</em></h1>
    <p>Tell us what you need. We'll get back to you with a straight answer and an honest quote &mdash; usually within a few hours during business hours.</p>
  </div>
</section>

<!-- TRUST STRIP -->
<section class="ts-strip">
  <div class="ts-strip-in">
    <div class="tsi"><div class="tsi-ic">✓</div><div class="tsi-tx"><strong>Free Estimates</strong><span>on installs &amp; replacements</span></div></div>
    <div class="tsi"><div class="tsi-ic">⚡</div><div class="tsi-tx"><strong>Same-Day Response</strong><span>most days, all year</span></div></div>
    <div class="tsi"><div class="tsi-ic">🛡️</div><div class="tsi-tx"><strong>Licensed &amp; Insured</strong><span>NATE-certified techs</span></div></div>
    <div class="tsi"><div class="tsi-ic">⭐</div><div class="tsi-tx"><strong>612+ 5-Star Reviews</strong><span>Google &amp; Yelp combined</span></div></div>
  </div>
</section>

<!-- QUOTE FORM -->
<section class="qf-sec">
  <div class="qf-wrap">
    <div class="qf-card">
      <h2 class="cf-ttl">Tell Us What You Need</h2>
      <p class="qf-sub">All fields marked * are required. The more detail you share, the more accurate the quote.</p>

      <form id="quoteForm" class="qf-form" onsubmit="return qfSubmit(event)">
        <!-- Honeypot — humans don't fill this; bots do. Hidden via CSS. -->
        <div class="qf-hp" aria-hidden="true">
          <label for="qf-website">Website (leave blank)</label>
          <input type="text" id="qf-website" name="honeypot" tabindex="-1" autocomplete="off"/>
        </div>

        <div class="fr">
          <div class="fg">
            <label for="qf-name">Your Name *</label>
            <input type="text" id="qf-name" name="name" required autocomplete="name"/>
          </div>
          <div class="fg">
            <label for="qf-phone">Phone Number *</label>
            <input type="tel" id="qf-phone" name="phone" required autocomplete="tel" placeholder="(951) 555-0123"/>
          </div>
        </div>

        <div class="fr">
          <div class="fg">
            <label for="qf-email">Email (optional)</label>
            <input type="email" id="qf-email" name="email" autocomplete="email"/>
          </div>
          <div class="fg">
            <label for="qf-zip">ZIP Code *</label>
            <input type="text" id="qf-zip" name="zip" required pattern="[0-9]{{5}}" maxlength="5" autocomplete="postal-code" placeholder="92562"/>
          </div>
        </div>

        <div class="fg">
          <label for="qf-service">What do you need? *</label>
          <select id="qf-service" name="service" required>
            <option value="">Choose a service&hellip;</option>
              {service_opts}
          </select>
        </div>

        <div class="fr">
          <div class="fg">
            <label for="qf-property">Property Type</label>
            <select id="qf-property" name="property_type">
              <option value="residential">Residential / Single-family home</option>
              <option value="condo">Condo / Townhouse</option>
              <option value="multi-family">Multi-family / Rental property</option>
              <option value="commercial">Commercial / Office</option>
              <option value="retail">Retail / Restaurant</option>
              <option value="industrial">Industrial / Warehouse</option>
            </select>
          </div>
          <div class="fg">
            <label for="qf-urgency">How Soon?</label>
            <select id="qf-urgency" name="urgency">
              <option value="emergency">Emergency &mdash; need someone today</option>
              <option value="this-week" selected>This week</option>
              <option value="this-month">Within the next few weeks</option>
              <option value="just-looking">Just getting a quote for now</option>
            </select>
          </div>
        </div>

        <div class="fg">
          <label for="qf-besttime">Best Time to Reach You</label>
          <select id="qf-besttime" name="best_time">
            <option value="anytime" selected>Anytime</option>
            <option value="morning">Morning (8am&ndash;12pm)</option>
            <option value="afternoon">Afternoon (12pm&ndash;5pm)</option>
            <option value="evening">Evening (5pm&ndash;8pm)</option>
          </select>
        </div>

        <div class="fg">
          <label for="qf-message">Anything else we should know?</label>
          <textarea id="qf-message" name="message" rows="4" placeholder="E.g. 'AC stopped cooling yesterday afternoon, system is a 2014 Carrier'&hellip; The more detail, the better the quote."></textarea>
        </div>

        <button type="submit" class="fsub qf-submit">Send My Request</button>
        <p class="qf-fineprint">By submitting, you agree we can contact you by phone, text, or email about your request. No spam, no sales calls outside what you asked about.</p>
      </form>

      <!-- Inline success/error message slot -->
      <div id="qf-status" class="qf-status" hidden></div>
    </div>

    <!-- SIDEBAR: trust + emergency callout -->
    <aside class="qf-side">
      <div class="qf-side-card">
        <h3>Need Help Now?</h3>
        <p>Skip the form &mdash; call Steve directly for emergency service or any question.</p>
        <a href="tel:9516343233" class="btn btn-red btn-lg qf-side-btn">&#128222; (951) 634-3233</a>
        <div class="qf-hours">
          <div><strong>Mon&ndash;Fri</strong> 7am&ndash;6pm</div>
          <div><strong>Saturday</strong> 8am&ndash;3pm</div>
          <div><strong>Sunday</strong> Emergency only</div>
        </div>
      </div>

      <div class="qf-side-card qf-side-card--alt">
        <h3>What Happens Next?</h3>
        <ol class="qf-steps">
          <li><strong>We call you back</strong> &mdash; usually within a few hours during business hours.</li>
          <li><strong>We ask a few questions</strong> to make sure we understand the job.</li>
          <li><strong>You get a clear quote</strong> &mdash; in writing, before any work starts. No surprises.</li>
        </ol>
      </div>
    </aside>
  </div>
</section>

<!-- Inline JS — handles submit + success/error UI -->
<script>
(function () {{
  'use strict';
  window.qfSubmit = async function (e) {{
    e.preventDefault();
    var form = document.getElementById('quoteForm');
    var btn = form.querySelector('.qf-submit');
    var status = document.getElementById('qf-status');
    var original = btn.textContent;

    // Honeypot guard
    if (form.honeypot.value.trim() !== '') {{
      return false; // silently drop bots
    }}

    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.hidden = true;

    var data = {{
      name:          form.name.value.trim(),
      phone:         form.phone.value.trim(),
      email:         form.email.value.trim(),
      zip:           form.zip.value.trim(),
      service:       form.service.value,
      property_type: form.property_type.value,
      urgency:       form.urgency.value,
      best_time:     form.best_time.value,
      message:       form.message.value.trim(),
      honeypot:      ''
    }};

    try {{
      var resp = await fetch('/api/quote', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(data)
      }});
      if (!resp.ok) throw new Error('Server returned ' + resp.status);

      // Success — replace form with confirmation
      form.style.display = 'none';
      status.hidden = false;
      status.className = 'qf-status qf-status--ok';
      status.innerHTML =
        '<div class="qf-ok-ic">&check;</div>' +
        '<h3>Got it &mdash; thanks!</h3>' +
        '<p>We received your request. Steve or one of our techs will reach out to you shortly. ' +
        'If it can\\'t wait, give us a call at <a href="tel:9516343233">(951) 634-3233</a>.</p>';
      window.scrollTo({{ top: status.offsetTop - 120, behavior: 'smooth' }});
    }} catch (err) {{
      btn.disabled = false;
      btn.textContent = original;
      status.hidden = false;
      status.className = 'qf-status qf-status--err';
      status.innerHTML =
        '<strong>Hmm &mdash; something went wrong on our end.</strong> ' +
        'Please try again, or call Steve directly at <a href="tel:9516343233">(951) 634-3233</a>.';
    }}
    return false;
  }};
}})();
</script>

<!-- CTA BAND -->
<section class="cband">
  <div class="cband-in">
    <h2 class="fi">Prefer to <em style="font-style:normal;color:var(--red)">Just Talk?</em></h2>
    <p class="fi">No problem. Call Steve directly and skip the form.</p>
    <div class="cband-btns fi">
      <a href="tel:9516343233" class="btn btn-red btn-lg">&#128222; Call (951) 634-3233</a>
    </div>
  </div>
</section>

{render_footer()}'''

    return head + body

# ──────────────────────────────────────────────────────────────────────
# PAGE: /reviews/
# ──────────────────────────────────────────────────────────────────────
def _fmt_review_date(iso: str) -> str:
    """2026-04-02 -> 'April 2026' (month + year only, since exact day rarely
    matches the original review date — Google/Yelp APIs only expose month
    granularity to public scrapers)."""
    months = ["", "January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]
    try:
        y, m, _ = iso.split("-")
        return f"{months[int(m)]} {y}"
    except Exception:
        return iso

def build_reviews_page() -> str:
    cards = []
    for name, source, datestr, body in REVIEWS:
        src_logo = 'google-logo.png' if source == 'Google' else 'yelp-logo.png'
        # Escape angle/amp for safety
        safe_body = body.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        safe_name = name.replace('&', '&amp;')
        date_label = _fmt_review_date(datestr)
        cards.append(f'''      <article class="revpg-card fi">
        <div class="revpg-quote-mark" aria-hidden="true">&ldquo;</div>
        <div class="revpg-stars" aria-label="5 out of 5 stars">&starf;&starf;&starf;&starf;&starf;</div>
        <p class="revpg-body">{safe_body}</p>
        <div class="revpg-foot">
          <div class="revpg-author">
            <strong>{safe_name}</strong>
            <span class="revpg-date">{date_label}</span>
          </div>
          <div class="revpg-source revpg-source--{source.lower()}" aria-label="Review from {source}">
            <img src="/images/{src_logo}" alt="" aria-hidden="true" loading="lazy"/>
            <span>{source}</span>
          </div>
        </div>
      </article>''')
    cards_html = '\n'.join(cards)

    jsonld = json.dumps({
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "@id": "https://steves-heating-and-air.vercel.app/#business",
        "name": "Steve's Air Conditioning & Heating",
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "5.0",
            "reviewCount": "612",
            "bestRating": "5",
            "worstRating": "1"
        }
    }, indent=2)

    head = render_head(
        title="Customer Reviews | Steve&#39;s Air Conditioning &amp; Heating",
        description=("Read 612+ five-star reviews from Murrieta, Temecula, and Southwest Riverside County "
                     "homeowners. Steve's Air Conditioning &amp; Heating &mdash; honest HVAC, no upsells, 20+ years local."),
        canonical="https://steves-heating-and-air.vercel.app/reviews/",
        page_context="page:reviews|Customer Reviews",
        extra_head=f'\n  <script type="application/ld+json">\n{jsonld}\n  </script>'
    )

    body = f'''{render_nav("reviews")}

{render_breadcrumb("Customer Reviews")}

<!-- PAGE HEADER -->
<section class="ph">
  <div class="ph-in">
    <h1>What <em>Customers Say</em></h1>
    <p>Real reviews from real Murrieta, Temecula, and Southwest Riverside County homeowners. A curated set below &mdash; the full count is over 612 across Google and Yelp.</p>
  </div>
</section>

<!-- RATING SUMMARY BAND -->
<section class="revpg-summary">
  <div class="revpg-summary-in">
    <div class="revpg-stat">
      <div class="revpg-stat-num">5.0<span class="revpg-stat-star">&#9733;</span></div>
      <div class="revpg-stat-lbl">Average Rating</div>
    </div>
    <div class="revpg-stat-divider"></div>
    <div class="revpg-stat">
      <div class="revpg-stat-num">612<span class="revpg-stat-plus">+</span></div>
      <div class="revpg-stat-lbl">Five-Star Reviews</div>
    </div>
    <div class="revpg-stat-divider"></div>
    <div class="revpg-stat">
      <div class="revpg-stat-num">20<span class="revpg-stat-plus">+</span></div>
      <div class="revpg-stat-lbl">Years Local</div>
    </div>
  </div>
</section>

<!-- REVIEW CARDS GRID -->
<section class="revpg-sec">
  <div class="revpg-wrap">
    <div class="revpg-grid">
{cards_html}
    </div>
  </div>
</section>

<!-- LEAVE A REVIEW -->
<section class="revpg-leave">
  <div class="revpg-leave-in">
    <div class="revpg-leave-tx">
      <div class="eyebrow fi">Worked with us?</div>
      <h2 class="fi">Leave a <em style="font-style:normal;color:var(--red)">Review.</em></h2>
      <p class="fi">It genuinely helps a small local business stay visible to homeowners who need honest HVAC work. Takes about 30 seconds.</p>
    </div>
    <div class="revpg-leave-btns fi">
      <a href="https://search.google.com/local/writereview?placeid=ChIJ-_-_-_-_-_-_-_-_-_-_-_" target="_blank" rel="noopener noreferrer" class="revpg-btn revpg-btn--google">
        <img src="/images/google-logo.png" alt="" aria-hidden="true"/>
        <span>Review on Google</span>
      </a>
      <a href="https://www.yelp.com/writeareview/biz/steves-air-conditioning-and-heating-murrieta" target="_blank" rel="noopener noreferrer" class="revpg-btn revpg-btn--yelp">
        <img src="/images/yelp-logo.png" alt="" aria-hidden="true"/>
        <span>Review on Yelp</span>
      </a>
    </div>
  </div>
</section>

<!-- CTA BAND -->
<section class="cband">
  <div class="cband-in">
    <h2 class="fi">Ready to <em style="font-style:normal;color:var(--red)">Join Them?</em></h2>
    <p class="fi">Same-day service across Murrieta, Temecula, and SW Riverside County.</p>
    <div class="cband-btns fi">
      <a href="tel:9516343233" class="btn btn-red btn-lg">&#128222; Call Steve</a>
      <a href="/quote/" class="btn btn-outline-w btn-lg">Request Online Quote</a>
    </div>
  </div>
</section>

{render_footer()}'''

    return head + body

# ──────────────────────────────────────────────────────────────────────
# PAGE: /contact/
# ──────────────────────────────────────────────────────────────────────
def build_contact_page() -> str:
    jsonld = json.dumps({
        "@context": "https://schema.org",
        "@type": "ContactPage",
        "name": "Contact Steve's Air Conditioning & Heating",
        "url": "https://steves-heating-and-air.vercel.app/contact/",
        "mainEntity": {
            "@type": "HVACBusiness",
            "name": "Steve's Air Conditioning & Heating",
            "telephone": "+19516343233",
            "email": "stevesac_6708@yahoo.com",
            "areaServed": "Southwest Riverside County, California",
            "openingHours": [
                "Mo-Fr 07:00-18:00",
                "Sa 08:00-15:00"
            ]
        }
    }, indent=2)

    head = render_head(
        title="Contact Steve's Air Conditioning &amp; Heating | Murrieta, CA",
        description=("Call (951) 634-3233 or email stevesac_6708@yahoo.com. "
                     "Steve's Air Conditioning &amp; Heating &mdash; serving Murrieta, Temecula, "
                     "and Southwest Riverside County. Mon-Fri 7am-6pm. Same-day emergency service available."),
        canonical="https://steves-heating-and-air.vercel.app/contact/",
        page_context="page:contact|Contact",
        extra_head=f'\n  <script type="application/ld+json">\n{jsonld}\n  </script>'
    )

    body = f'''{render_nav("contact")}

{render_breadcrumb("Contact")}

<!-- PAGE HEADER -->
<section class="ph">
  <div class="ph-in">
    <h1>Get in <em>Touch</em></h1>
    <p>Call, email, or send us your request &mdash; whatever's easiest. We answer the phone during business hours and check email throughout the day.</p>
  </div>
</section>

<!-- CONTACT GRID -->
<section class="ct-sec">
  <div class="ct-grid">

    <!-- PHONE CARD -->
    <a href="tel:9516343233" class="ct-card ct-card--call">
      <div class="ct-ic">&#128222;</div>
      <div class="ct-card-h">Call Steve</div>
      <div class="ct-card-v">(951) 634-3233</div>
      <div class="ct-card-s">Tap to call &mdash; fastest way to reach us</div>
    </a>

    <!-- EMAIL CARD -->
    <a href="mailto:stevesac_6708@yahoo.com" class="ct-card">
      <div class="ct-ic">&#9993;</div>
      <div class="ct-card-h">Email</div>
      <div class="ct-card-v">stevesac_6708@yahoo.com</div>
      <div class="ct-card-s">We check throughout the day</div>
    </a>

    <!-- QUOTE FORM CARD -->
    <a href="/quote/" class="ct-card">
      <div class="ct-ic">&#128221;</div>
      <div class="ct-card-h">Request a Quote</div>
      <div class="ct-card-v">Online quote form</div>
      <div class="ct-card-s">Best for installs &amp; non-emergency work</div>
    </a>

    <!-- SERVICE AREA CARD -->
    <a href="/service-area/" class="ct-card">
      <div class="ct-ic">&#128205;</div>
      <div class="ct-card-h">Service Area</div>
      <div class="ct-card-v">21 cities, SW Riverside &amp; beyond</div>
      <div class="ct-card-s">See if we cover your city</div>
    </a>

  </div>
</section>

<!-- HOURS + NAP -->
<section class="ct-hours-sec">
  <div class="ct-hours-in">
    <div class="ct-hours-block">
      <h2>Hours</h2>
      <ul class="ct-hours-ul">
        <li><span class="ct-day">Monday</span><span class="ct-time">7:00am &mdash; 6:00pm</span></li>
        <li><span class="ct-day">Tuesday</span><span class="ct-time">7:00am &mdash; 6:00pm</span></li>
        <li><span class="ct-day">Wednesday</span><span class="ct-time">7:00am &mdash; 6:00pm</span></li>
        <li><span class="ct-day">Thursday</span><span class="ct-time">7:00am &mdash; 6:00pm</span></li>
        <li><span class="ct-day">Friday</span><span class="ct-time">7:00am &mdash; 6:00pm</span></li>
        <li><span class="ct-day">Saturday</span><span class="ct-time">8:00am &mdash; 3:00pm</span></li>
        <li><span class="ct-day ct-day--em">Sunday</span><span class="ct-time">Emergency service only</span></li>
      </ul>
      <p class="ct-hours-note">Emergency calls outside hours: always answered. Just call &mdash; if it can't wait, we'll work it out.</p>
    </div>

    <div class="ct-hours-block">
      <h2>Where We Serve</h2>
      <p class="ct-area-intro">We cover 21 cities across Southwest Riverside County and the broader Inland Empire.</p>

      <div class="ct-tier">
        <h3 class="ct-tier-h">Core Service Area &mdash; same-day to next-day</h3>
        <p class="ct-tier-cities">Murrieta &middot; Temecula &middot; Menifee &middot; Wildomar &middot; Lake Elsinore &middot; Canyon Lake</p>
      </div>

      <div class="ct-tier">
        <h3 class="ct-tier-h">Nearby &mdash; 1-3 hour typical response</h3>
        <p class="ct-tier-cities">Sun City &middot; Winchester &middot; French Valley &middot; Perris &middot; Hemet &middot; Romoland &middot; Homeland &middot; Fallbrook &middot; Rainbow</p>
      </div>

      <div class="ct-tier">
        <h3 class="ct-tier-h">Extended &mdash; same-day typical service</h3>
        <p class="ct-tier-cities">Moreno Valley &middot; Riverside &middot; Corona &middot; San Bernardino &middot; Anza &middot; Aguanga</p>
      </div>

      <p class="ct-area-note">Not sure if we cover your city? <a href="tel:9516343233">Give us a call</a> &mdash; we often still can.</p>
    </div>
  </div>
</section>

<!-- EMERGENCY CALLOUT -->
<section class="ct-emergency">
  <div class="ct-emergency-in">
    <div class="ct-em-ic">&#9888;</div>
    <div class="ct-em-tx">
      <h3>HVAC Emergency?</h3>
      <p>System down in 100&deg; heat? Furnace out on a cold night? Don't wait &mdash; call now.</p>
    </div>
    <a href="tel:9516343233" class="btn btn-red btn-lg">&#128222; Call (951) 634-3233</a>
  </div>
</section>

<!-- CTA BAND -->
<section class="cband">
  <div class="cband-in">
    <h2 class="fi">Or Send Us the <em style="font-style:normal;color:var(--red)">Full Details</em></h2>
    <p class="fi">If it's not urgent, the online form is the easiest way to give us everything we need to quote your job accurately.</p>
    <div class="cband-btns fi">
      <a href="/quote/" class="btn btn-red btn-lg">Request a Free Quote</a>
      <a href="tel:9516343233" class="btn btn-outline-w btn-lg">Or Just Call</a>
    </div>
  </div>
</section>

{render_footer()}'''

    return head + body

# ──────────────────────────────────────────────────────────────────────
# CSS additions for site.css
# ──────────────────────────────────────────────────────────────────────
CSS_BLOCK_MARKER = "/* === SPRINT 2 ADDITIONS — DO NOT EDIT THIS BLOCK MANUALLY === */"
CSS_BLOCK_END    = "/* === END SPRINT 2 ADDITIONS === */"

# NOTE: plain string (NOT f-string) so CSS braces don't need escaping.
_CSS_BODY = r'''
/* ─── svxlink-grid: convert to flex for true orphan-row centering ──
   The original grid layout (display: grid; grid-template-columns:
   repeat(4, 1fr)) can't truly center orphan rows — at best it shifts
   them to one side. Flex with justify-content: center handles it
   natively: orphan rows automatically center because flex shrinks
   the wrapped line to fit its content.
   Card widths are set explicitly so 4 fit per row on desktop, 2 on
   tablet, 1 on mobile — matching the previous breakpoints. */
.svxlink-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}
.svxlink-card {
  flex: 0 1 calc((100% - 48px) / 4);  /* 4 per row, 3 gaps of 16px */
  max-width: calc((100% - 48px) / 4);
  min-width: 0;
  box-sizing: border-box;
}
@media (max-width: 900px) {
  .svxlink-card {
    flex: 0 1 calc((100% - 16px) / 2); /* 2 per row, 1 gap of 16px */
    max-width: calc((100% - 16px) / 2);
  }
}
@media (max-width: 540px) {
  .svxlink-card {
    flex: 0 1 100%;
    max-width: 100%;
  }
}

/* ─── Trust strip (used on /quote/ page) ────────────────────────────*/
.ts-strip { background: rgba(26,63,122,.08); border-top: 1px solid rgba(74,122,181,.18); border-bottom: 1px solid rgba(74,122,181,.18); padding: 28px 40px; }
.ts-strip-in { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.tsi { display: flex; gap: 14px; align-items: center; }
.tsi-ic { flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--blue); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; }
.tsi-tx strong { display: block; font-family: 'Bebas Neue', sans-serif; font-size: 1.15rem; letter-spacing: .04em; color: var(--white); }
.tsi-tx span { display: block; font-size: .82rem; color: var(--muted); }

/* ─── /quote/ form layout ──────────────────────────────────────────*/
.qf-sec { padding: 64px 40px; background: var(--navy2); }
.qf-wrap { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 1.6fr 1fr; gap: 36px; }
.qf-card { background: var(--mid); border: 1px solid rgba(255,255,255,.07); border-top: 3px solid var(--red); border-radius: 12px; padding: 44px; }
.qf-sub { color: var(--muted); margin-top: -16px; margin-bottom: 28px; font-size: .92rem; }
.qf-form .fr { grid-template-columns: 1fr 1fr; }
.qf-hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.qf-submit { margin-top: 8px; }
.qf-fineprint { font-size: .78rem; color: var(--muted); text-align: center; margin-top: 14px; line-height: 1.5; }

.qf-status { margin-top: 30px; padding: 28px; border-radius: 10px; text-align: center; }
.qf-status--ok { background: rgba(60,160,90,.12); border: 1px solid rgba(60,160,90,.4); }
.qf-status--ok h3 { font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; color: var(--white); margin: 14px 0 8px; }
.qf-status--ok a { color: var(--blueAcc); font-weight: 600; }
.qf-ok-ic { width: 64px; height: 64px; margin: 0 auto; border-radius: 50%; background: rgba(60,160,90,.25); color: #4ade80; display: flex; align-items: center; justify-content: center; font-size: 2.4rem; font-weight: 700; }
.qf-status--err { background: rgba(196,30,30,.1); border: 1px solid rgba(196,30,30,.3); color: var(--white); }
.qf-status--err a { color: #ff8a8a; font-weight: 600; }

.qf-side { display: flex; flex-direction: column; gap: 24px; }
.qf-side-card { background: var(--mid); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 32px; }
.qf-side-card h3 { font-family: 'Bebas Neue', sans-serif; font-size: 1.5rem; letter-spacing: .04em; color: var(--white); margin: 0 0 12px; }
.qf-side-card p { color: var(--light); font-size: .95rem; line-height: 1.55; margin-bottom: 18px; }
.qf-side-btn { width: 100%; text-align: center; margin-bottom: 22px; }
.qf-hours { font-size: .9rem; color: var(--light); line-height: 1.9; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.08); }
.qf-hours strong { color: var(--white); font-weight: 600; display: inline-block; min-width: 92px; }
.qf-side-card--alt { border-top: 3px solid var(--blue2); }
.qf-steps { padding-left: 22px; margin: 0; color: var(--light); font-size: .95rem; line-height: 1.65; }
.qf-steps li { margin-bottom: 14px; }
.qf-steps strong { color: var(--white); }

@media (max-width: 900px) {
  .ts-strip { padding: 24px 20px; }
  .ts-strip-in { grid-template-columns: 1fr 1fr; gap: 18px; }
  .qf-sec { padding: 40px 16px; }
  .qf-wrap { grid-template-columns: 1fr; gap: 24px; }
  .qf-card { padding: 28px 20px; }
  .qf-form .fr { grid-template-columns: 1fr; }
}
@media (max-width: 540px) {
  .ts-strip-in { grid-template-columns: 1fr; }
}

/* ─── /reviews/ page ───────────────────────────────────────────────
   Self-contained styles — does NOT reuse the homepage's inline
   .hrev/.rc/.rc-source classes. Namespace: .revpg-* */

/* Summary band at top */
.revpg-summary {
  background: linear-gradient(180deg, rgba(26,63,122,.12) 0%, rgba(26,63,122,.04) 100%);
  padding: 48px 40px;
  border-top: 1px solid rgba(74,122,181,.18);
  border-bottom: 1px solid rgba(74,122,181,.18);
}
.revpg-summary-in {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 20px;
}
.revpg-stat { text-align: center; flex: 0 1 auto; }
.revpg-stat-num {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 3.8rem;
  color: var(--white);
  line-height: 1;
  letter-spacing: .02em;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.revpg-stat-star { color: var(--gold); font-size: 2.6rem; }
.revpg-stat-plus { color: var(--blueAcc); font-size: 2.6rem; font-weight: 400; }
.revpg-stat-lbl {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: .78rem;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-top: 8px;
}
.revpg-stat-divider {
  width: 1px;
  height: 64px;
  background: linear-gradient(180deg, transparent 0%, rgba(74,122,181,.4) 50%, transparent 100%);
  flex-shrink: 0;
}

/* Cards grid */
.revpg-sec { padding: 72px 40px; }
.revpg-wrap { max-width: 1280px; margin: 0 auto; }
.revpg-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.revpg-card {
  position: relative;
  background: var(--mid);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: var(--r-lg);
  padding: 32px 28px 24px;
  display: flex;
  flex-direction: column;
  transition: border-color .25s ease, transform .25s ease, box-shadow .25s ease;
  overflow: hidden;
}
.revpg-card:hover {
  border-color: rgba(74,122,181,.4);
  transform: translateY(-3px);
  box-shadow: 0 12px 28px rgba(0,0,0,.25);
}

.revpg-quote-mark {
  position: absolute;
  top: -18px;
  right: 14px;
  font-family: 'Bebas Neue', Georgia, serif;
  font-size: 7rem;
  line-height: 1;
  color: rgba(74,122,181,.12);
  pointer-events: none;
  user-select: none;
  z-index: 0;
}

.revpg-stars {
  color: var(--gold);
  font-size: 1rem;
  letter-spacing: 3px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}
.revpg-body {
  font-size: .95rem;
  color: rgba(255,255,255,.82);
  line-height: 1.65;
  margin: 0 0 22px;
  flex: 1;
  position: relative;
  z-index: 1;
}

.revpg-foot {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 14px;
  padding-top: 18px;
  border-top: 1px solid rgba(255,255,255,.06);
  position: relative;
  z-index: 1;
}
.revpg-author { min-width: 0; flex: 1; }
.revpg-author strong {
  display: block;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: .92rem;
  letter-spacing: .04em;
  color: var(--white);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.revpg-date {
  font-size: .78rem;
  color: var(--muted);
  letter-spacing: .04em;
}

/* Source badge — small pill, logo constrained to 14×14px */
.revpg-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 12px;
  flex-shrink: 0;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: .72rem;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.revpg-source img {
  display: block;
  height: 14px;
  width: 14px;
  max-width: 14px;
  object-fit: contain;
  flex-shrink: 0;
}
.revpg-source--google {
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.85);
  border: 1px solid rgba(255,255,255,.1);
}
.revpg-source--yelp {
  background: rgba(211,35,35,.12);
  color: #ff8a8a;
  border: 1px solid rgba(211,35,35,.3);
}

/* Leave-a-review section */
.revpg-leave {
  background: var(--navy2);
  padding: 72px 40px;
  border-top: 1px solid rgba(255,255,255,.06);
}
.revpg-leave-in {
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}
.revpg-leave-tx h2 {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 2.6rem;
  color: var(--white);
  letter-spacing: .03em;
  margin: 8px 0 14px;
  line-height: 1.05;
}
.revpg-leave-tx .eyebrow {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: .78rem;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--blueAcc);
}
.revpg-leave-tx p {
  color: var(--light);
  font-size: .98rem;
  line-height: 1.6;
  margin: 0;
}
.revpg-leave-btns { display: flex; flex-direction: column; gap: 14px; }
.revpg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 16px 24px;
  border-radius: 8px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: .92rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  text-decoration: none;
  transition: transform .2s, box-shadow .2s, background .2s;
  border: 2px solid;
}
.revpg-btn img {
  display: block;
  height: 22px;
  width: 22px;
  max-width: 22px;
  object-fit: contain;
  flex-shrink: 0;
}
.revpg-btn--google { background: #fff; color: #202124; border-color: #fff; }
.revpg-btn--google:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,.3); }
.revpg-btn--yelp { background: #d32323; color: #fff; border-color: #d32323; }
.revpg-btn--yelp:hover { background: #b51e1e; border-color: #b51e1e; transform: translateY(-2px); box-shadow: 0 10px 24px rgba(211,35,35,.45); }

@media (max-width: 980px) {
  .revpg-grid { grid-template-columns: repeat(2, 1fr); }
  .revpg-leave-in { grid-template-columns: 1fr; gap: 28px; text-align: center; }
}
@media (max-width: 720px) {
  .revpg-summary { padding: 32px 20px; }
  .revpg-summary-in { flex-wrap: wrap; gap: 16px 12px; }
  .revpg-stat-num { font-size: 2.6rem; }
  .revpg-stat-star, .revpg-stat-plus { font-size: 1.8rem; }
  .revpg-stat-divider { display: none; }
  .revpg-sec { padding: 48px 20px; }
  .revpg-grid { grid-template-columns: 1fr; gap: 18px; }
  .revpg-card { padding: 28px 22px 20px; }
  .revpg-quote-mark { font-size: 5rem; top: -10px; }
  .revpg-leave { padding: 48px 20px; }
  .revpg-leave-tx h2 { font-size: 2rem; }
}

/* ─── /contact/ page ───────────────────────────────────────────────*/
.ct-sec { padding: 64px 40px; background: var(--navy2); }
.ct-grid { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.ct-card { background: var(--mid); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 32px 24px; text-align: center; text-decoration: none; color: var(--white); transition: border-color .25s, background .25s, transform .25s; display: flex; flex-direction: column; align-items: center; }
.ct-card:hover { border-color: rgba(74,122,181,.45); background: rgba(26,63,122,.1); transform: translateY(-3px); }
.ct-card--call { border-top: 3px solid var(--red); }
.ct-card--call:hover { border-color: var(--red); border-top-color: var(--red2); background: rgba(196,30,30,.08); }
.ct-ic { font-size: 2.2rem; margin-bottom: 14px; }
.ct-card-h { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: .78rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.ct-card-v { font-family: 'Bebas Neue', sans-serif; font-size: 1.45rem; letter-spacing: .03em; color: var(--white); margin-bottom: 10px; }
.ct-card-s { font-size: .82rem; color: var(--light); line-height: 1.5; }

.ct-hours-sec { padding: 72px 40px; }
.ct-hours-in { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1.4fr; gap: 48px; }
.ct-hours-block h2 { font-family: 'Bebas Neue', sans-serif; font-size: 2rem; color: var(--white); letter-spacing: .03em; margin: 0 0 20px; }
.ct-hours-ul { list-style: none; padding: 0; margin: 0 0 18px; }
.ct-hours-ul li { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
.ct-day { font-family: 'Rajdhani', sans-serif; font-weight: 600; font-size: .92rem; letter-spacing: .08em; text-transform: uppercase; color: var(--white); }
.ct-day--em { color: var(--red); }
.ct-time { font-size: .92rem; color: var(--light); }
.ct-hours-note { font-size: .85rem; color: var(--muted); line-height: 1.55; }
.ct-area-intro { color: var(--light); margin-bottom: 22px; }
.ct-tier { margin-bottom: 18px; padding: 16px 18px; background: rgba(255,255,255,.02); border-left: 3px solid var(--blue2); border-radius: 0 6px 6px 0; }
.ct-tier-h { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: .78rem; letter-spacing: .14em; text-transform: uppercase; color: var(--blueAcc); margin: 0 0 6px; }
.ct-tier-cities { font-size: .92rem; color: var(--light); margin: 0; line-height: 1.6; }
.ct-area-note { font-size: .88rem; color: var(--muted); margin-top: 18px; }
.ct-area-note a { color: var(--blueAcc); font-weight: 600; }

.ct-emergency { background: rgba(196,30,30,.08); border-top: 2px solid rgba(196,30,30,.3); border-bottom: 2px solid rgba(196,30,30,.3); padding: 36px 40px; }
.ct-emergency-in { max-width: 1280px; margin: 0 auto; display: flex; align-items: center; gap: 24px; }
.ct-em-ic { font-size: 2.6rem; color: var(--red); flex-shrink: 0; }
.ct-em-tx { flex: 1; }
.ct-em-tx h3 { font-family: 'Bebas Neue', sans-serif; font-size: 1.6rem; color: var(--white); letter-spacing: .03em; margin: 0 0 4px; }
.ct-em-tx p { font-size: .92rem; color: var(--light); margin: 0; }

@media (max-width: 900px) {
  .ct-sec { padding: 40px 20px; }
  .ct-grid { grid-template-columns: 1fr 1fr; }
  .ct-hours-sec { padding: 48px 20px; }
  .ct-hours-in { grid-template-columns: 1fr; gap: 36px; }
  .ct-emergency { padding: 28px 20px; }
  .ct-emergency-in { flex-direction: column; text-align: center; gap: 16px; }
}
@media (max-width: 540px) {
  .ct-grid { grid-template-columns: 1fr; }
}
'''

CSS_ADDITIONS = '\n' + CSS_BLOCK_MARKER + '\n' + _CSS_BODY + '\n' + CSS_BLOCK_END + '\n'

# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────
def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def write(p: Path, content: str) -> bool:
    """Write content only if it differs. Returns True if written."""
    p.parent.mkdir(parents=True, exist_ok=True)
    current = p.read_text(encoding="utf-8") if p.exists() else ""
    if current == content:
        return False
    bak = p.with_suffix(p.suffix + ".bak")
    if not bak.exists() and current:
        bak.write_text(current, encoding="utf-8")
    p.write_text(content, encoding="utf-8")
    return True

# ──────────────────────────────────────────────────────────────────────
# TASK 1-3 — create the three new pages
# ──────────────────────────────────────────────────────────────────────
def create_new_pages() -> None:
    print("\n[1/6] Creating /quote/ /reviews/ /contact/ pages")
    print("─" * 64)
    pages = [
        (PUBLIC_DIR / "quote"    / "index.html", build_quote_page,    "/quote/"),
        (PUBLIC_DIR / "reviews"  / "index.html", build_reviews_page,  "/reviews/"),
        (PUBLIC_DIR / "contact"  / "index.html", build_contact_page,  "/contact/"),
    ]
    for path, builder, label in pages:
        html = builder()
        existed = path.exists()
        if write(path, html):
            tag = "↻ updated" if existed else "+ created"
            print(f"  {tag}  {label}  ({path})")
        else:
            print(f"  ─ current  {label}")

# ──────────────────────────────────────────────────────────────────────
# TASK 4 — retarget /#contact and /#reviews links sitewide
# ──────────────────────────────────────────────────────────────────────
def retarget_links() -> None:
    print("\n[2/6] Retargeting nav/footer/CTA links sitewide")
    print("─" * 64)
    if not PUBLIC_DIR.exists():
        print(f"  ✗ {PUBLIC_DIR} not found — skipping")
        return

    # Don't retarget pages we just created or the homepage section anchors
    # themselves. We DO want to update outgoing links from the homepage.
    skip_files = {
        PUBLIC_DIR / "quote"   / "index.html",
        PUBLIC_DIR / "reviews" / "index.html",
        PUBLIC_DIR / "contact" / "index.html",
    }

    # Three substitution patterns:
    # (a) Reviews nav/footer link:   href="/#reviews"   ->   href="/reviews/"
    # (b) Contact nav/footer link:   href="/#contact"   ->   href="/contact/"
    # (c) Quote CTA button:          href="/#contact" ...>Request Online Quote   ->   href="/quote/" ...>...
    #     and any href="/#contact" inside a <a class="btn ..."> (these are
    #     CTA buttons, never plain links).
    #
    # We do (c) BEFORE (b) so the CTA buttons are caught first.

    # (c) Quote CTA — match the entire <a ...>Request Online Quote</a> with /#contact
    cta_pattern = re.compile(
        r'(<a\s+href=")/#contact("[^>]*>\s*Request Online Quote\s*</a>)',
        re.IGNORECASE
    )

    # (b) Generic /#contact link (after CTAs are converted)
    contact_link_pattern = re.compile(r'href="/#contact(?=["#?])')

    # (a) Reviews
    reviews_link_pattern = re.compile(r'href="/#reviews(?=["#?])')

    touched = 0
    summary = {"cta": 0, "contact": 0, "reviews": 0}

    for p in sorted(PUBLIC_DIR.rglob("*.html")):
        if p in skip_files:
            continue
        if p.suffix == ".bak":
            continue
        html = read(p)
        original = html
        per_file = {"cta": 0, "contact": 0, "reviews": 0}

        # (c) CTA buttons first
        html, n = cta_pattern.subn(r'\1/quote/\2', html)
        per_file["cta"] = n

        # (b) Contact links — anything left
        html, n = contact_link_pattern.subn('href="/contact/', html)
        per_file["contact"] = n

        # (a) Reviews links
        html, n = reviews_link_pattern.subn('href="/reviews/', html)
        per_file["reviews"] = n

        if html != original:
            write(p, html)
            touched += 1
            changes = ", ".join(f"{k}={v}" for k, v in per_file.items() if v)
            print(f"  ↻ {p.relative_to(REPO_ROOT)}  [{changes}]")
            for k, v in per_file.items():
                summary[k] += v

    print(f"\n  Updated {touched} file(s) — "
          f"CTAs:{summary['cta']}, Contact:{summary['contact']}, Reviews:{summary['reviews']}")

# ──────────────────────────────────────────────────────────────────────
# TASK 5 — append CSS additions (idempotently)
# ──────────────────────────────────────────────────────────────────────
def append_css() -> None:
    print("\n[3/6] Appending CSS rules to public/assets/site.css")
    print("─" * 64)
    css_file = ASSETS_DIR / "site.css"
    if not css_file.exists():
        print(f"  ✗ {css_file} not found — skipping")
        return

    css = read(css_file)

    # Strip any prior Sprint 2 block, then append the current one.
    block_pattern = re.compile(
        re.escape(CSS_BLOCK_MARKER) + r'.*?' + re.escape(CSS_BLOCK_END),
        re.DOTALL
    )
    cleaned = block_pattern.sub('', css).rstrip() + '\n'
    new_css = cleaned + CSS_ADDITIONS

    if write(css_file, new_css):
        print(f"  ↻ {css_file.relative_to(REPO_ROOT)}")
        print(f"    + svxlink-grid orphan centering")
        print(f"    + /quote/ form + sidebar styles")
        print(f"    + /reviews/ summary + leave-review buttons")
        print(f"    + /contact/ cards + hours + emergency callout")
    else:
        print(f"  ─ {css_file.relative_to(REPO_ROOT)} already current")

# ──────────────────────────────────────────────────────────────────────
# TASK 6 — update sitemap.xml with 3 new URLs (idempotent)
# ──────────────────────────────────────────────────────────────────────
def update_sitemap() -> None:
    print("\n[4/6] Updating public/sitemap.xml")
    print("─" * 64)
    sm = PUBLIC_DIR / "sitemap.xml"
    if not sm.exists():
        print(f"  ✗ {sm} not found — skipping")
        return

    xml = read(sm)
    today = date.today().isoformat()
    base = "https://steves-heating-and-air.vercel.app"

    new_urls = [
        (f"{base}/quote/",   "0.9"),
        (f"{base}/contact/", "0.8"),
        (f"{base}/reviews/", "0.8"),
    ]

    added = []
    for url, priority in new_urls:
        if url in xml:
            continue
        block = (f'  <url>\n'
                 f'    <loc>{url}</loc>\n'
                 f'    <lastmod>{today}</lastmod>\n'
                 f'    <changefreq>monthly</changefreq>\n'
                 f'    <priority>{priority}</priority>\n'
                 f'  </url>\n')
        # Insert before </urlset>
        xml = xml.replace('</urlset>', block + '\n</urlset>', 1)
        added.append(url)

    if added:
        write(sm, xml)
        for u in added:
            print(f"  + {u}")
    else:
        print(f"  ─ All 3 URLs already present")

# ──────────────────────────────────────────────────────────────────────
# TASK 7 — update knowledge-base.json with page awareness
# ──────────────────────────────────────────────────────────────────────
def update_knowledge_base() -> None:
    print("\n[5/6] Updating public/data/knowledge-base.json")
    print("─" * 64)
    kb_file = DATA_DIR / "knowledge-base.json"
    if not kb_file.exists():
        print(f"  ⚠ {kb_file} not found — skipping (drop in Sprint 1's KB first)")
        return

    kb = json.loads(read(kb_file), object_pairs_hook=OrderedDict)

    # Add a 'siteLinks' map the chatbot can use to route people
    new_links = OrderedDict([
        ("quote",     "/quote/"),
        ("contact",   "/contact/"),
        ("reviews",   "/reviews/"),
        ("services",  "/services/"),
        ("serviceArea", "/service-area/"),
        ("blog",      "/blog/"),
        ("about",     "/about/"),
    ])

    changes = []
    if kb.get("siteLinks") != new_links:
        # rebuild to keep ordering stable
        new_kb = OrderedDict()
        inserted = False
        for k, v in kb.items():
            new_kb[k] = v
            if k == "business" and not inserted:
                new_kb["siteLinks"] = new_links
                inserted = True
        if not inserted:
            new_kb["siteLinks"] = new_links
        kb = new_kb
        changes.append("siteLinks map")

    # Add/refresh FAQs about the new pages
    existing_qs = {f.get("q", "").lower() for f in kb.get("faqs", [])}
    candidate_faqs = [
        ("Can I request a quote online?",
         "Yes — fill out the quote form at /quote/ and we'll get back to you, usually within a few hours during business hours. The form takes about a minute. For emergencies, calling (951) 634-3233 directly is faster."),
        ("How do I contact Steve's?",
         "Call (951) 634-3233 for fastest response, email stevesac_6708@yahoo.com, or use the quote form at /quote/. Full contact options are at /contact/. Hours: Mon-Fri 7am-6pm, Sat 8am-3pm, Sunday emergency only."),
        ("Where can I see your reviews?",
         "We have over 612 five-star reviews across Google and Yelp. A curated set is at /reviews/, and you can also see real customer stories on the homepage."),
    ]
    added_faqs = []
    for q, a in candidate_faqs:
        if q.lower() not in existing_qs:
            kb.setdefault("faqs", []).append(OrderedDict([("q", q), ("a", a)]))
            added_faqs.append(q)
    if added_faqs:
        changes.append(f"{len(added_faqs)} FAQ(s)")

    if changes:
        new_text = json.dumps(kb, indent=2, ensure_ascii=False) + '\n'
        if write(kb_file, new_text):
            for c in changes:
                print(f"  + {c}")
        else:
            print(f"  ─ already current (no change needed)")
    else:
        print(f"  ─ already current")

# ──────────────────────────────────────────────────────────────────────
# Final report
# ──────────────────────────────────────────────────────────────────────
def report() -> None:
    print("\n[6/6] Final summary")
    print("─" * 64)
    for path in [
        PUBLIC_DIR / "quote" / "index.html",
        PUBLIC_DIR / "reviews" / "index.html",
        PUBLIC_DIR / "contact" / "index.html",
        ASSETS_DIR / "site.css",
        PUBLIC_DIR / "sitemap.xml",
        DATA_DIR / "knowledge-base.json",
    ]:
        mark = "✓" if path.exists() else "✗"
        print(f"  {mark} {path.relative_to(REPO_ROOT) if path.exists() else path}")

# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 64)
    print("STEVE'S HVAC — SPRINT 2 FIXES")
    print(f"Repo root: {REPO_ROOT}")
    print("=" * 64)

    if not PUBLIC_DIR.exists():
        print(f"\n✗ ERROR: {PUBLIC_DIR} not found.")
        print("  Run this script from the steves-heating-and-air repo root.")
        return 1

    create_new_pages()
    retarget_links()
    append_css()
    update_sitemap()
    update_knowledge_base()
    report()

    print("\n" + "=" * 64)
    print("DONE. Per-file .bak backups written on first modification.")
    print("Review diffs in Cursor before staging.")
    print("Preview locally:  python -m http.server 3000 --directory public")
    print("=" * 64)
    return 0

if __name__ == "__main__":
    sys.exit(main())
