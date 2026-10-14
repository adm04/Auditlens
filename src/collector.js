// Injected on demand (chrome.scripting.executeScript) into the page being audited.
// Runs in the extension's isolated world: it can read the DOM but not page JS variables.
// It never reads form VALUES except to find areas to blur, and sends nothing anywhere;
// results are returned to the service worker only.
//
// API (called via executeScript({ func })):
//   __auditlens.prepare()          -> page metrics, overlays visible at load
//   __auditlens.scrollTo(y)        -> actual scrollY
//   __auditlens.hideFixed()/showFixed()
//   __auditlens.collect()          -> full snapshot (document coordinates, scrollY must be 0)

(() => {
  if (globalThis.__auditlens) return;

  const MAX_TEXT = 200_000;
  const hidden = [];

  // ---- Utilities -------------------------------------------------------------

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n = 120) => { s = clean(s); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return true;
  }

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  }

  function parseColor(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function luminance({ r, g, b }) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrast(c1, c2) {
    if (!c1 || !c2) return null;
    const a = luminance(c1), b = luminance(c2);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }

  /** First non-transparent background going up the tree. null if an image background is hit. */
  function effectiveBg(el, skipSelf = false) {
    let node = skipSelf ? el.parentElement : el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear-gradient(rgba(0, 0, 0, 0)')) {
        return null;
      }
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0.85) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function shortSelector(el) {
    if (el.id && /^[A-Za-z][\w-]{0,40}$/.test(el.id)) return `#${el.id}`;
    const parts = [];
    let node = el;
    for (let i = 0; node && node.nodeType === 1 && i < 4; i++) {
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter((c) => /^[A-Za-z][\w-]{0,30}$/.test(c)).slice(0, 2);
      if (cls.length) part += `.${cls.join('.')}`;
      parts.unshift(part);
      if (node.id) break;
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function accessibleName(el) {
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
      if (t) return t;
    }
    if (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type)) return clean(el.value);
    const text = clean(el.innerText);
    if (text) return text;
    const img = el.querySelector?.('img[alt]');
    if (img && clean(img.alt)) return clean(img.alt);
    return clean(el.getAttribute('title'));
  }

  function allElements() {
    return document.body ? document.body.getElementsByTagName('*') : [];
  }

  // ---- Fixed / sticky handling (for stitched screenshots) ---------------------

  function fixedElements() {
    const out = [];
    const els = allElements();
    for (let i = 0; i < els.length && i < 15000; i++) {
      const el = els[i];
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') out.push(el);
    }
    return out;
  }

  function hideFixed() {
    for (const el of fixedElements()) {
      if (hidden.some((h) => h.el === el)) continue;
      hidden.push({ el, value: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    return hidden.length;
  }

  function showFixed() {
    while (hidden.length) {
      const { el, value, priority } = hidden.pop();
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    }
    return true;
  }

  // Large fixed layers (modals, full-screen pop-ups). Their content isn't part of the page's
  // own layout, so CTAs/salient elements inside them are excluded from page analysis.
  function overlayRoots() {
    const vw = innerWidth, vh = innerHeight;
    return fixedElements().filter((el) => {
      if (!visible(el) || el.closest('header') === el) return false;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return (w * h) / (vw * vh) >= 0.3;
    });
  }

  let overlayCache = null;
  function inOverlay(el) {
    if (!overlayCache) overlayCache = overlayRoots();
    return overlayCache.some((o) => o.contains(el));
  }

  function hideOverlays() {
    let n = 0;
    for (const el of overlayRoots()) {
      if (hidden.some((h) => h.el === el)) continue;
      hidden.push({ el, value: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
      n++;
    }
    return n;
  }

  function overlaysAtLoad() {
    const vw = innerWidth, vh = innerHeight;
    const out = [];
    for (const el of fixedElements()) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const share = (w * h) / (vw * vh);
      if (share < 0.12) continue;
      const text = cut(el.innerText, 160);
      const isCookie = /cookie|consent|gdpr|privacy/i.test(text);
      out.push({ share: Math.round(share * 100), text, isCookie, selector: shortSelector(el), rect: docRect(el) });
    }
    return out.sort((a, b) => b.share - a.share).slice(0, 5);
  }

  function prepare() {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    const se = document.scrollingElement || document.documentElement;
    return {
      url: location.href,
      title: document.title,
      innerWidth, innerHeight, dpr: devicePixelRatio,
      scrollHeight: Math.max(se.scrollHeight, document.body?.scrollHeight || 0),
      scrollY,
      overlays: overlaysAtLoad(),
    };
  }

  function scrollToY(y) {
    window.scrollTo(0, y);
    return scrollY;
  }

  // ---- Sections of the snapshot ---------------------------------------------

  function metaContent(sel) {
    return clean(document.querySelector(sel)?.getAttribute('content'));
  }

  function collectSEO(text) {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter(visible)
      .slice(0, 80)
      .map((h) => ({ level: Number(h.tagName[1]), text: cut(h.innerText, 140), y: docRect(h).y }));

    const jsonld = [];
    let jsonldErrors = 0;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        for (const it of items) {
          const t = it && it['@type'];
          if (t) jsonld.push(...[].concat(t).map(String));
          if (it?.aggregateRating || it?.review) jsonld.push('AggregateRating');
        }
      } catch {
        jsonldErrors++;
      }
    }
    const microdata = [...document.querySelectorAll('[itemtype]')].map((e) => e.getAttribute('itemtype').split('/').pop()).slice(0, 20);

    const imgs = [...document.images];
    const missingAlt = imgs.filter((i) => !i.hasAttribute('alt') && visible(i));
    const host = location.host;
    const links = [...document.querySelectorAll('a[href]')];
    let internal = 0, external = 0, nofollow = 0, emptyAnchors = 0, genericAnchors = 0;
    const genericRe = /^(click here|here|read more|more|learn more|link|this)$/i;
    const genericExamples = [];
    for (const a of links) {
      let url;
      try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
      if (!/^https?:$/.test(url.protocol)) continue;
      if (url.host === host) internal++; else external++;
      if (/nofollow/i.test(a.rel)) nofollow++;
      const name = accessibleName(a);
      if (!name && visible(a)) emptyAnchors++;
      if (genericRe.test(name)) { genericAnchors++; if (genericExamples.length < 3) genericExamples.push(name); }
    }

    let mixed = 0;
    if (location.protocol === 'https:') {
      for (const el of document.querySelectorAll('img[src],script[src],link[href][rel~="stylesheet"],iframe[src],video[src],source[src]')) {
        const v = el.getAttribute('src') || el.getAttribute('href') || '';
        if (/^http:\/\//i.test(v)) mixed++;
      }
    }

    const words = text ? text.split(/\s+/).filter((w) => /[A-Za-zÀ-ɏऀ-ॿ]/.test(w)).length : 0;

    return {
      title: clean(document.title),
      metaDescription: metaContent('meta[name="description" i]'),
      canonical: document.querySelector('link[rel="canonical" i]')?.href || '',
      robots: metaContent('meta[name="robots" i]'),
      viewport: metaContent('meta[name="viewport" i]'),
      lang: document.documentElement.getAttribute('lang') || '',
      charset: document.characterSet,
      favicon: !!document.querySelector('link[rel~="icon" i]'),
      og: {
        title: metaContent('meta[property="og:title" i]'),
        description: metaContent('meta[property="og:description" i]'),
        image: metaContent('meta[property="og:image" i]'),
        type: metaContent('meta[property="og:type" i]'),
      },
      twitterCard: metaContent('meta[name="twitter:card" i]'),
      hreflang: document.querySelectorAll('link[rel="alternate" i][hreflang]').length,
      headings,
      h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
      structuredData: [...new Set([...jsonld, ...microdata])].slice(0, 30),
      jsonldErrors,
      images: { total: imgs.length, missingAlt: missingAlt.length, missingAltExamples: missingAlt.slice(0, 3).map((i) => cut(i.currentSrc || i.src, 90)) },
      links: { internal, external, nofollow, emptyAnchors, genericAnchors, genericExamples },
      mixedContent: mixed,
      wordCount: words,
      url: location.href,
    };
  }

  const DISMISS = /^(close|×|✕|x|dismiss|no,? thanks|not now|maybe later|skip|accept( all)?( cookies)?|reject( all)?|decline|got it|ok,? got it|allow( all)?|manage (cookies|preferences)|cookie settings)$/i;
  const CTA_GENERIC = /^(submit|send|go|ok|enter|click here|here|learn more|read more|more|find out more|see more|details|view more|shop now|buy now|continue|next)$/i;

  function collectCTAs() {
    const vh = innerHeight;
    const cands = new Set([
      ...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a'),
    ]);
    const out = [];
    for (const el of cands) {
      if (out.length >= 150) break;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 520 || r.height > 110 || r.height < 18) continue;
      const name = cut(accessibleName(el), 60);
      if (!name || name.length > 45) continue;
      if (DISMISS.test(name) || inOverlay(el)) continue;
      const cs = getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      const filled = !!(bg && bg.a > 0.5);
      const bordered = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none' && parseFloat(cs.paddingLeft) >= 8;
      const isButtonTag = el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.getAttribute('role') === 'button';
      const looksButton = filled || bordered || /\b(btn|button|cta)\b/i.test(el.className?.baseVal ?? el.className);
      if (!isButtonTag && !looksButton) continue;
      // Skip icon-only controls (menu, close, carousel arrows) — not conversion CTAs.
      if (r.width < 44 && r.height < 44 && name.length <= 2) continue;

      const surround = effectiveBg(el, true);
      const ownBg = filled ? { ...bg, a: 1 } : surround;
      const bgContrast = filled && surround ? contrast(ownBg, surround) : null;
      const textColor = parseColor(cs.color);
      const textContrast = ownBg && textColor ? contrast(textColor, ownBg) : null;
      const rect = docRect(el);
      const inNav = !!el.closest('nav, header, [role="navigation"]');
      out.push({
        text: name,
        tag: el.tagName.toLowerCase(),
        rect,
        inFold: r.top < vh && r.bottom > 0,
        filled,
        inNav,
        generic: CTA_GENERIC.test(name),
        bgContrast,
        textContrast,
        fontSize: parseFloat(cs.fontSize),
        sticky: ['fixed', 'sticky'].includes(cs.position) || !!el.closest('[style*="position: fixed"], [style*="position:fixed"]'),
        selector: shortSelector(el),
        href: el.tagName === 'A' ? el.getAttribute('href') : '',
        prominence: Math.round(r.width * r.height * (filled ? 1.6 : 1) * (bgContrast ? Math.min(bgContrast, 6) / 3 + 0.5 : 1)),
      });
    }
    // Detect sticky containers holding CTAs (common "sticky add to cart" bars).
    for (const fx of fixedElements()) {
      if (!visible(fx) || inOverlay(fx)) continue;
      const btn = fx.querySelector('button, a, input[type="submit"]');
      if (btn && /add to|buy|book|get|start|shop|order|sign up|try|call|whatsapp/i.test(accessibleName(btn))) {
        const hit = out.find((c) => c.selector === shortSelector(btn));
        if (hit) hit.sticky = true;
        else out.push({ text: cut(accessibleName(btn), 60), tag: 'sticky', rect: docRect(btn), inFold: true, filled: true, inNav: false, generic: false, bgContrast: null, textContrast: null, fontSize: 0, sticky: true, selector: shortSelector(btn), href: '', prominence: 0 });
      }
    }
    return out.sort((a, b) => b.prominence - a.prominence);
  }

  function labelFor(input) {
    if (input.labels && input.labels.length && clean(input.labels[0].innerText)) return clean(input.labels[0].innerText);
    const aria = clean(input.getAttribute('aria-label'));
    if (aria) return aria;
    const by = input.getAttribute('aria-labelledby');
    if (by) return clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
    return '';
  }

  function collectForms() {
    const groups = new Map();
    const fields = [...document.querySelectorAll('input, select, textarea')].filter((f) => {
      if (f.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset'].includes(f.type)) return false;
      return visible(f);
    });
    for (const f of fields) {
      const key = f.form || f.closest('[role="form"], form, section, div') || document.body;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const out = [];
    for (const [container, list] of groups) {
      if (out.length >= 12) break;
      const kinds = list.map((f) => (f.tagName === 'INPUT' ? f.type : f.tagName.toLowerCase()));
      const unlabeled = list.filter((f) => !labelFor(f));
      const emailLike = list.filter((f) => /e-?mail/i.test(`${f.name} ${f.id} ${f.placeholder} ${labelFor(f)}`));
      const submit = container.querySelector?.('button, input[type="submit"]');
      const isSearch = list.length <= 2 && list.some((f) => f.type === 'search' || /search|^q$|^s$/i.test(`${f.name} ${f.id} ${f.placeholder}`));
      const near = cut(container.innerText || '', 400).toLowerCase();
      out.push({
        fieldCount: list.length,
        required: list.filter((f) => f.required || f.getAttribute('aria-required') === 'true').length,
        unlabeled: unlabeled.length,
        unlabeledExamples: unlabeled.slice(0, 3).map((f) => clean(f.placeholder) || f.name || f.type),
        kinds: [...new Set(kinds)],
        emailWrongType: emailLike.filter((f) => f.tagName === 'INPUT' && f.type !== 'email').length,
        hasEmail: emailLike.length > 0,
        hasPhone: list.some((f) => f.type === 'tel' || /phone|mobile/i.test(`${f.name} ${f.id} ${f.placeholder}`)),
        autocomplete: list.filter((f) => f.getAttribute('autocomplete') && f.getAttribute('autocomplete') !== 'off').length,
        submitText: submit ? cut(accessibleName(submit), 40) : '',
        isSearch,
        incentive: /\d+\s?%|discount|free|coupon|code|offer|guide|e-?book|checklist|early access|bonus/i.test(near),
        rect: docRect(container.getBoundingClientRect ? container : list[0]),
      });
    }
    return out;
  }

  function collectSignals(text, ctas) {
    const lower = text.toLowerCase();
    const has = (re) => re.test(lower);
    const html = document.documentElement.outerHTML.slice(0, 600_000);
    const links = [...document.querySelectorAll('a[href]')];
    const linkText = links.map((a) => `${a.innerText} ${a.getAttribute('href')}`.toLowerCase()).join(' | ');
    const scripts = [...document.scripts].map((s) => s.src).join(' ') + ' ' + [...document.querySelectorAll('iframe[src]')].map((f) => f.src).join(' ');

    const priceMatches = text.match(/(?:₹|\$|€|£|rs\.?|inr|usd)\s?\d[\d,]*(?:\.\d{1,2})?/gi) || [];
    const addToCart = ctas.some((c) => /add to (cart|bag|basket)|buy now|add to order/i.test(c.text)) || has(/add to (cart|bag|basket)/);

    return {
      reviews: has(/\b\d[\d,.]*\s*(\+\s*)?(reviews?|ratings?)\b|★|⭐|testimonial|trustpilot|google reviews|verified (buyer|purchase)|out of 5/),
      ratingSchema: /aggregaterating|"review"/i.test(html),
      guarantee: has(/money[- ]back|guarantee|free returns?|easy returns?|\d+[- ]day returns?|refund|warranty|exchange policy/),
      shipping: has(/free (shipping|delivery)|ships? (in|within)|deliver(y|ed) (in|within|by)|dispatch(ed)? (in|within)|cash on delivery|\bcod\b/),
      security: has(/secure (checkout|payment)|ssl|256-bit|pci|safe (checkout|payment)/) || /visa|mastercard|paypal|razorpay|stripe|upi|rupay/i.test([...document.images].map((i) => i.alt + ' ' + i.src).join(' ')),
      contact: links.some((a) => /^(tel:|mailto:)|wa\.me|whatsapp/i.test(a.getAttribute('href'))) || /\bcontact\b/.test(linkText),
      phoneLink: links.some((a) => /^tel:/i.test(a.getAttribute('href'))),
      policies: {
        privacy: /privacy/.test(linkText),
        returns: /return|refund|exchange/.test(linkText),
        shipping: /shipping|delivery/.test(linkText),
        terms: /terms|conditions/.test(linkText),
      },
      press: has(/as (seen|featured) (in|on)|featured in|in the press|press coverage/),
      customerCount: (text.match(/\d[\d,.]*\s?(k|m|lakh|crore)?\+?\s+(happy |satisfied )?(customers|users|clients|businesses|students|members|downloads|orders|brands)/i) || [''])[0],
      urgency: (text.match(/only \d+ left|ends (in|today|tonight)|limited (time|stock|offer|period)|hurry|last chance|selling fast|offer ends/i) || [''])[0],
      chat: /intercom|crisp\.chat|tawk\.to|zendesk|zdassets|drift\.com|hs-scripts|livechat|freshchat|tidio|wa\.me|whatsapp/i.test(scripts + ' ' + linkText),
      search: !!document.querySelector('input[type="search"], [role="search"], input[name="q"], input[name="s"], input[name="search"], [aria-label*="search" i]'),
      priceCount: priceMatches.length,
      priceExamples: priceMatches.slice(0, 3),
      addToCart,
      freeTrial: has(/free trial|start (for )?free|try (it )?free|no credit card/),
      demo: has(/book a demo|request a demo|schedule a demo|get a demo|talk to sales/),
      quote: has(/get a quote|free quote|free consultation|book a call|enquire|enquiry/),
      faq: has(/frequently asked|faqs?\b/),
      video: !!document.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="wistia"]'),
    };
  }

  function detectPlatform() {
    const html = document.documentElement.outerHTML.slice(0, 400_000);
    const gen = metaContent('meta[name="generator" i]');
    if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return 'Shopify';
    if (/woocommerce/i.test(html)) return 'WooCommerce';
    if (/\/wp-content\/|\/wp-includes\//i.test(html) || /wordpress/i.test(gen)) return 'WordPress';
    if (document.documentElement.hasAttribute('data-wf-page') || /webflow/i.test(gen)) return 'Webflow';
    if (/static\.wixstatic\.com|wix\.com/i.test(html) || /wix/i.test(gen)) return 'Wix';
    if (/squarespace/i.test(html)) return 'Squarespace';
    if (/framerusercontent|framer\.com\/m\//i.test(html) || /framer/i.test(gen)) return 'Framer';
    if (document.getElementById('__NEXT_DATA__') || /\/_next\/static\//.test(html)) return 'Next.js';
    if (/magento/i.test(html)) return 'Magento';
    return gen ? cut(gen, 40) : '';
  }

  function guessPageType(seo, signals, forms) {
    const path = location.pathname.toLowerCase();
    const sd = seo.structuredData.join(' ').toLowerCase();
    if (/\/(cart|basket|bag|checkout)(\/|$)/.test(path)) return 'checkout';
    if (sd.includes('product') && !sd.includes('itemlist') && signals.addToCart) return 'product';
    if (/\/products?\/[^/]+/.test(path) && signals.addToCart) return 'product';
    if (/pricing|plans/.test(path)) return 'saas';
    if (/\/(collections?|category|categories|shop|catalog)(\/|$)/.test(path) || signals.priceCount >= 8) return 'collection';
    if (path === '/' || path === '' || /^\/(index\.html?|home)?$/.test(path)) return 'home';
    if (forms.some((f) => !f.isSearch && f.fieldCount >= 2)) return 'landing';
    if (signals.freeTrial || signals.demo) return 'saas';
    return 'other';
  }

  function guessBusinessModel(signals, platform) {
    if (signals.addToCart || ['Shopify', 'WooCommerce', 'Magento'].includes(platform) || signals.priceCount >= 4) return 'ecommerce';
    if (signals.freeTrial || signals.demo) return 'saas';
    if (signals.quote) return 'leadgen';
    return 'other';
  }

  function collectReadability() {
    const ps = [...document.querySelectorAll('p, li')].filter(visible).slice(0, 400);
    const sizes = [];
    let long = 0;
    let longExample = '';
    let wide = 0;
    for (const p of ps) {
      const t = clean(p.innerText);
      if (t.length < 40) continue;
      const cs = getComputedStyle(p);
      const fs = parseFloat(cs.fontSize) || 16;
      sizes.push(fs);
      const w = p.getBoundingClientRect().width;
      const cpl = Math.max(10, w / (fs * 0.5));
      const lines = t.length / cpl;
      if (cpl > 95) wide++;
      if (lines > (innerWidth < 600 ? 5 : 4)) {
        long++;
        if (!longExample) longExample = cut(t, 120);
      }
    }
    sizes.sort((a, b) => a - b);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;

    // Low-contrast text sample.
    const lowContrast = [];
    const textEls = [...document.querySelectorAll('p, li, a, span, h1, h2, h3, h4, button, label')].filter(visible).slice(0, 600);
    for (const el of textEls) {
      if (lowContrast.length >= 8) break;
      if (!clean(el.childNodes[0]?.nodeValue || el.innerText)) continue;
      if (el.children.length > 2) continue;
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      const bg = effectiveBg(el);
      if (!fg || !bg || fg.a < 0.5) continue;
      const ratio = contrast(fg, bg);
      const fs = parseFloat(cs.fontSize);
      const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio && ratio < (large ? 3 : 4.5)) {
        lowContrast.push({ text: cut(el.innerText, 60), ratio, fontSize: fs, rect: docRect(el), selector: shortSelector(el) });
      }
    }
    return { paragraphs: ps.length, medianFontSize: median, longParagraphs: long, longExample, wideLines: wide, lowContrast };
  }

  function collectImages() {
    const vh = innerHeight;
    const list = [...document.images].filter((i) => i.naturalWidth > 0).slice(0, 300);
    let oversized = 0, noDimensions = 0, eagerOffscreen = 0, legacyFormat = 0, lazyInFold = 0;
    const oversizedExamples = [];
    for (const img of list) {
      const r = img.getBoundingClientRect();
      const docTop = r.top + scrollY;
      if (r.width < 2) continue;
      const need = r.width * devicePixelRatio;
      if (img.naturalWidth > need * 2 && img.naturalWidth > 900) {
        oversized++;
        if (oversizedExamples.length < 3) oversizedExamples.push(`${cut(img.currentSrc || img.src, 70)} (${img.naturalWidth}px shown at ${Math.round(r.width)}px)`);
      }
      if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
        const cs = getComputedStyle(img);
        if (cs.aspectRatio === 'auto') noDimensions++;
      }
      if (docTop > vh * 2 && img.loading !== 'lazy') eagerOffscreen++;
      if (docTop < vh && img.loading === 'lazy') lazyInFold++;
      if (/\.(jpe?g|png|gif)(\?|$)/i.test(img.currentSrc || img.src) && !/format=(webp|avif)|fm=(webp|avif)|f_auto|auto=format/i.test(img.currentSrc || img.src)) legacyFormat++;
    }
    return { total: list.length, oversized, oversizedExamples, noDimensions, eagerOffscreen, lazyInFold, legacyFormat };
  }

  function collectPerf() {
    const out = {};
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        out.ttfb = Math.round(nav.responseStart - nav.startTime);
        out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
        out.load = Math.round(nav.loadEventEnd - nav.startTime) || null;
        out.htmlBytes = nav.transferSize || nav.encodedBodySize || 0;
      }
      const res = performance.getEntriesByType('resource');
      const sum = (filter) => res.filter(filter).reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0);
      out.requests = res.length;
      out.jsBytes = sum((r) => r.initiatorType === 'script' || /\.m?js(\?|$)/.test(r.name));
      out.cssBytes = sum((r) => /\.css(\?|$)/.test(r.name) || (r.initiatorType === 'link' && /css/.test(r.name)));
      out.imgBytes = sum((r) => r.initiatorType === 'img' || /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(r.name));
      out.totalBytes = sum(() => true) + (out.htmlBytes || 0);
      out.thirdPartyDomains = [...new Set(res.map((r) => { try { return new URL(r.name).host; } catch { return ''; } })
        .filter((h) => h && h !== location.host && !h.endsWith(`.${location.host.replace(/^www\./, '')}`)))].length;
      out.sizesKnown = res.some((r) => r.transferSize > 0);
    } catch { /* ignore */ }
    return out;
  }

  // LCP and CLS need observers with buffered entries.
  function observePaint() {
    return new Promise((resolve) => {
      const result = { lcp: null, lcpElement: '', cls: 0 };
      try {
        new PerformanceObserver((list) => {
          const e = list.getEntries().at(-1);
          if (e) {
            result.lcp = Math.round(e.startTime);
            result.lcpElement = e.element ? shortSelector(e.element) : (e.url ? cut(e.url, 80) : '');
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* unsupported */ }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) result.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* unsupported */ }
      setTimeout(() => { result.cls = Math.round(result.cls * 1000) / 1000; resolve(result); }, 250);
    });
  }

  function collectSalient(ctas) {
    const out = [];
    const push = (el, kind, extra = {}) => {
      if (out.length >= 600 || inOverlay(el)) return;
      const rect = docRect(el);
      if (rect.w < 8 || rect.h < 8) return;
      out.push({ kind, rect, ...extra });
    };
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (visible(h) && clean(h.innerText)) push(h, 'heading', { fontSize: parseFloat(getComputedStyle(h).fontSize) || 20, label: cut(h.innerText, 40) });
    }
    for (const c of ctas.slice(0, 60)) out.push({ kind: 'cta', rect: c.rect, contrast: c.bgContrast || 1.5, filled: c.filled, inNav: c.inNav, label: c.text });
    for (const img of document.querySelectorAll('img, picture, svg, video, iframe')) {
      if (!visible(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) {
        if (img.tagName === 'IMG' && img.closest('header') && r.width >= 30) push(img, 'logo');
        continue;
      }
      push(img, img.tagName === 'VIDEO' || img.tagName === 'IFRAME' ? 'video' : 'image', { label: cut(img.getAttribute?.('alt') || '', 40) });
    }
    for (const f of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      if (visible(f)) push(f, 'input');
    }
    for (const p of document.querySelectorAll('p')) {
      if (visible(p) && clean(p.innerText).length > 30) push(p, 'text', { fontSize: parseFloat(getComputedStyle(p).fontSize) || 16 });
    }
    const logo = document.querySelector('header a[href="/"] img, header [class*="logo" i], a[class*="logo" i]');
    if (logo && visible(logo)) push(logo, 'logo');
    return out;
  }

  // Emails, passwords, card-like numbers, long tokens — blurred in screenshots.
  function sensitiveRects() {
    const rects = [];
    const re = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, /\b(?:\d[ -]?){13,19}\b/g];
    for (const el of document.querySelectorAll('input, textarea')) {
      if (!visible(el)) continue;
      if ((el.type === 'password' && el.value) || re.some((r) => new RegExp(r.source, 'i').test(el.value || ''))) rects.push(docRect(el));
    }
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let n, count = 0;
    while ((n = walker.nextNode()) && count < 6000 && rects.length < 150) {
      count++;
      const t = n.nodeValue;
      if (t.length < 6) continue;
      for (const r of re) {
        for (const m of t.matchAll(new RegExp(r.source, r.flags))) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          for (const cr of range.getClientRects()) {
            rects.push({ x: Math.round(cr.left + scrollX - 2), y: Math.round(cr.top + scrollY - 2), w: Math.round(cr.width + 4), h: Math.round(cr.height + 4) });
          }
        }
      }
    }
    return rects;
  }


  // ---- Main-page discovery (for multi-page audits) -----------------------------

  const SKIP_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|account|my-account|logout|cart|basket|checkout|wp-admin|wp-login|admin|privacy|terms|cookie|policy|policies|legal|disclaimer|refund|feed|rss|tag|tags|author|search|page\/\d+)(\.[a-z]+)?(\/|$)/i;
  const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|pptx?|csv|xml|json)$/i;
  const IMPORTANT = /\b(about|contact|pricing|plans|services?|products?|shop|store|collections?|solutions?|features?|blog|work|portfolio|courses?|programs?|menu|book|booking|appointments?|case studies|how it works|faq)\b/i;

  function discoverLinks(limit = 14) {
    const here = new URL(location.href);
    const bareHost = (h) => h.replace(/^www\./, '');
    const seen = new Map();
    const add = (a, where, bonus) => {
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (!/^https?:$/.test(u.protocol) || bareHost(u.host) !== bareHost(here.host)) return;
      if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return;
      u.hash = '';
      u.search = '';
      const path = u.pathname.replace(/\/+$/, '') || '/';
      const key = path.toLowerCase();
      const label = cut(accessibleName(a), 50);
      const depth = path.split('/').filter(Boolean).length;
      let score = bonus + (IMPORTANT.test(`${label} ${path}`) ? 2 : 0) - Math.max(0, depth - 2);
      if (/\/(products?|p)\/[^/]+$/i.test(path)) score += 1; // one product page is worth auditing
      const prev = seen.get(key);
      if (prev) { prev.score = Math.max(prev.score, score) + 0.5; return; }
      seen.set(key, { url: `${u.origin}${path === '/' ? '/' : path}`, path, label: label || path, score, where });
    };
    document.querySelectorAll('header a[href], nav a[href], [role="navigation"] a[href]').forEach((a) => add(a, 'navigation', 3));
    document.querySelectorAll('main a[href], [role="main"] a[href]').forEach((a) => add(a, 'page', 1));
    document.querySelectorAll('footer a[href]').forEach((a) => add(a, 'footer', 1));
    const currentKey = (here.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    const homeKey = '/';
    const list = [...seen.values()].filter((l) => l.path.toLowerCase() !== currentKey);
    // Products: keep at most 2 so a shop doesn't fill the list with items.
    let products = 0;
    const filtered = list.sort((a, b) => b.score - a.score).filter((l) => {
      if (/\/(products?|p)\/[^/]+$/i.test(l.path)) return ++products <= 2;
      return true;
    });
    const current = { url: `${here.origin}${here.pathname.replace(/\/+$/, '') || '/'}`, path: here.pathname || '/', label: cut(document.title, 50) || 'This page', score: 99, where: 'current' };
    const out = [current, ...filtered];
    if (currentKey !== homeKey && !out.some((l) => l.path === '/')) out.splice(1, 0, { url: `${here.origin}/`, path: '/', label: 'Homepage', score: 50, where: 'home' });
    return out.slice(0, limit);
  }

  // ---- UI inventory (buttons, type, colour, icons, links, images) ------------------

  function rgbKey(c) {
    return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : '';
  }

  function collectUI(ctas) {
    const vh = innerHeight;
    const textEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,label,span,td,th,blockquote,figcaption,input,select,textarea')]
      .filter((el) => !inOverlay(el) && visible(el) && (el.matches('input,select,textarea') || clean(el.childNodes[0]?.nodeValue || '').length > 1))
      .slice(0, 2500);

    const fonts = new Map(), sizes = new Map(), colors = new Map();
    let tiny = 0;
    const tinyExamples = [];
    for (const el of textEls) {
      const cs = getComputedStyle(el);
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      fonts.set(fam, (fonts.get(fam) || 0) + 1);
      const fs = Math.round(parseFloat(cs.fontSize));
      sizes.set(fs, (sizes.get(fs) || 0) + 1);
      const col = parseColor(cs.color);
      if (col && col.a > 0.5) colors.set(rgbKey(col), (colors.get(rgbKey(col)) || 0) + 1);
      if (fs < 12 && clean(el.innerText).length > 3) { tiny++; if (tinyExamples.length < 3) tinyExamples.push({ text: cut(el.innerText, 40), size: fs, rect: docRect(el) }); }
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));

    // Headings: median size per level.
    const headingSizes = {};
    for (let l = 1; l <= 4; l++) {
      const arr = [...document.querySelectorAll(`h${l}`)].filter((h) => visible(h) && !inOverlay(h)).map((h) => parseFloat(getComputedStyle(h).fontSize)).sort((a, b) => a - b);
      if (arr.length) headingSizes[`h${l}`] = Math.round(arr[Math.floor(arr.length / 2)]);
    }

    // Buttons grouped by visual style.
    const groups = new Map();
    const buttonEls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')]
      .filter((el) => visible(el) && !inOverlay(el) && !el.closest('nav, header, [role="navigation"]'));
    for (const el of buttonEls) {
      const cs = getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      const filled = bg && bg.a > 0.5;
      const bordered = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none' && parseFloat(cs.paddingLeft) >= 8;
      if (!filled && !bordered) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.height > 110 || r.width > 520) continue;
      const name = cut(accessibleName(el), 40);
      if (!name || DISMISS.test(name)) continue;
      const radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
      const h = Math.round(r.height / 4) * 4;
      const key = [filled ? rgbKey(bg) : `outline ${cs.borderTopColor}`, radius >= 100 ? 'pill' : radius, h, cs.fontWeight, rgbKey(parseColor(cs.color))].join('|');
      if (!groups.has(key)) groups.set(key, { bg: filled ? rgbKey(bg) : 'transparent', border: bordered ? cs.borderTopColor : '', color: cs.color, radius, height: Math.round(r.height), fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, count: 0, example: name, rect: docRect(el) });
      groups.get(key).count++;
    }
    const buttonStyles = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    const radii = [...new Set(buttonStyles.map((b) => (b.radius >= 100 ? 'pill' : b.radius)))];

    // Icon-only controls with no name.
    const iconOnly = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (iconOnly.length >= 12 || !visible(el) || inOverlay(el)) continue;
      const name = accessibleName(el);
      const hasGraphic = el.querySelector('svg, img, i, [class*="icon" i]');
      if (!clean(name) && hasGraphic) iconOnly.push({ rect: docRect(el), selector: shortSelector(el), html: cut(el.outerHTML, 90) });
    }

    // Links inside paragraphs that don't look like links.
    let hiddenLinks = 0;
    const hiddenLinkExamples = [];
    for (const a of document.querySelectorAll('p a[href], li a[href]')) {
      if (!visible(a) || a.closest('nav, header, footer')) continue;
      const cs = getComputedStyle(a);
      const parent = getComputedStyle(a.parentElement);
      const underlined = /underline/.test(cs.textDecorationLine) || parseFloat(cs.borderBottomWidth) > 0;
      const sameColor = (contrast(parseColor(cs.color), parseColor(parent.color)) || 1) < 1.3;
      const bolder = Number(cs.fontWeight) > Number(parent.fontWeight) + 150;
      if (!underlined && sameColor && !bolder) { hiddenLinks++; if (hiddenLinkExamples.length < 3) hiddenLinkExamples.push(cut(a.innerText, 40)); }
    }

    // Stretched / squashed images.
    const distorted = [];
    for (const img of document.images) {
      if (distorted.length >= 6 || !visible(img) || !img.naturalWidth || inOverlay(img)) continue;
      const cs = getComputedStyle(img);
      if (cs.objectFit && cs.objectFit !== 'fill') continue;
      const r = img.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;
      const natural = img.naturalWidth / img.naturalHeight, shown = r.width / r.height;
      if (Math.abs(natural - shown) / natural > 0.12) distorted.push({ rect: docRect(img), src: cut(img.currentSrc || img.src, 80) });
    }

    // Centred long paragraphs and tight line height.
    let centred = 0, tight = 0, paraCount = 0;
    for (const p of document.querySelectorAll('p')) {
      if (!visible(p) || inOverlay(p)) continue;
      const t = clean(p.innerText);
      if (t.length < 60) continue;
      paraCount++;
      const cs = getComputedStyle(p);
      if (cs.textAlign === 'center' && t.length > 220) centred++;
      const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
      if (lh && lh < 1.3) tight++;
    }

    // Form fields: heights + style variety.
    const fieldHeights = [...new Set([...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), select, textarea')]
      .filter((f) => visible(f) && !inOverlay(f) && f.tagName !== 'TEXTAREA').map((f) => Math.round(f.getBoundingClientRect().height)))];

    return {
      fonts: top(fonts, 8),
      fontSizes: top(sizes, 30).sort((a, b) => b.value - a.value),
      textColors: top(colors, 14),
      headingSizes,
      buttonStyles,
      radii,
      iconOnly,
      hiddenLinks, hiddenLinkExamples,
      distorted,
      tiny, tinyExamples,
      centred, tight, paraCount,
      fieldHeights,
      ctaCount: ctas.filter((c) => c.filled && !c.inNav).length,
    };
  }

  async function collect() {
    overlayCache = null;
    const text = (document.body?.innerText || '').slice(0, MAX_TEXT);
    const ctas = collectCTAs();
    const seo = collectSEO(text);
    const forms = collectForms();
    const signals = collectSignals(text, ctas);
    const platform = detectPlatform();
    const paint = await observePaint();
    const se = document.scrollingElement || document.documentElement;

    // First-fold facts.
    const vh = innerHeight;
    const foldHeadings = seo.headings.filter((h) => h.y < vh);
    const bigText = [...document.querySelectorAll('h1, h2, [class*="hero" i] h1, [class*="hero" i] p')]
      .filter((el) => visible(el) && el.getBoundingClientRect().top < vh)
      .sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];

    return {
      url: location.href,
      host: location.host,
      title: document.title,
      capturedAt: Date.now(),
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      pageHeight: Math.max(se.scrollHeight, document.body?.scrollHeight || 0),
      platform,
      pageType: guessPageType(seo, signals, forms),
      businessModel: guessBusinessModel(signals, platform),
      fold: {
        headline: bigText ? cut(bigText.innerText, 160) : (foldHeadings[0]?.text || ''),
        headlineWords: bigText ? clean(bigText.innerText).split(/\s+/).length : 0,
        headlineFontSize: bigText ? parseFloat(getComputedStyle(bigText).fontSize) : 0,
        headingCount: foldHeadings.length,
      },
      ctas: ctas.slice(0, 80),
      forms,
      signals,
      seo,
      readability: collectReadability(),
      images: collectImages(),
      perf: { ...collectPerf(), ...paint },
      navLinks: document.querySelectorAll('header a, nav a').length,
      salient: collectSalient(ctas),
      ui: collectUI(ctas),
      links: discoverLinks(),
      redactions: sensitiveRects(),
      textSample: cut(text, 1500),
    };
  }

  globalThis.__auditlens = { prepare, scrollTo: scrollToY, hideFixed, hideOverlays, showFixed, collect, discoverLinks };
})();
