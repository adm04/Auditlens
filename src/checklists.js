// Manual CRO checklist, from the page checklists in the CRO method. The auditor marks each
// item Pass / Weak / Missing / N/A (mobile view first). A few items are pre-filled from
// what the collector detected; pre-fills are suggestions the auditor can change.

const g = (id, text, lever, auto) => ({ id, text, lever, auto });

const GLOBAL = [
  g('g-announce', 'Announcement bar carries a service USP (free shipping threshold, returns, delivery time, honest offer)', 'Reciprocity'),
  g('g-nav', 'Navigation is logical; top categories within 2 clicks; shop by need/occasion reachable', 'Product discovery'),
  g('g-search', 'Search is easy to find and use', 'Product discovery', (s) => (s.signals.search ? 'pass' : '')),
  g('g-identity', 'Clear, consistent logo and visual identity', 'Trust'),
  g('g-contact', 'Contact options visible; policies (returns, shipping, privacy) easy to find', 'Trust', (s) => (s.signals.contact && s.signals.policies.privacy ? 'pass' : '')),
  g('g-quality', 'No typos, broken layouts or dead clicks; works on all screen sizes', 'Trust'),
  g('g-speed', 'Page loads in about 1.5–2 s on mobile and desktop; images compressed', 'Friction'),
  g('g-consistent', 'Consistent fonts, colours, spacing, buttons and tone of voice', 'Clarity'),
  g('g-popups', 'Pop-ups easy to close and not blocking the first view', 'Friction', (s) => ((s.overlays || []).some((o) => !o.isCookie && o.share >= 30) ? 'missing' : '')),
  g('g-feedback', 'Feedback channel or chat available', 'Trust', (s) => (s.signals.chat ? 'pass' : '')),
];

const BY_TYPE = {
  home: [
    g('h-fold', 'First screen states what the brand sells and its main differentiator within seconds', 'Clarity'),
    g('h-heading', 'Heading short and benefit-led (3–6 words); one clear primary CTA naming the destination', 'Clarity'),
    g('h-hero', 'Hero image/video shows the product or outcome, positive and on-brand', 'Motivation'),
    g('h-discovery', 'Bestsellers or featured products and categories visible; shop by concern/occasion', 'Product discovery'),
    g('h-proof', 'Social proof near the top: review/customer counts, press logos, UGC', 'Social proof', (s) => (s.signals.reviews || s.signals.customerCount ? 'pass' : '')),
    g('h-story', 'Short, personal brand-story section linking to About', 'Trust'),
    g('h-offers', 'Offers and rewards surfaced honestly', 'Reciprocity'),
    g('h-folds', 'Each section fits in one fold and previews the next', 'Clarity'),
    g('h-sliders', 'Sliders show dots/peek; nothing important hides behind auto-rotation', 'Clarity'),
    g('h-email', 'Email capture gives a reason to sign up', 'Reciprocity'),
  ],
  collection: [
    g('c-filters', 'Filters and sort easy to find, use and clear', 'Friction'),
    g('c-cards', 'Product cards show benefit-led name, price, rating/count, badges', 'Social proof'),
    g('c-diff', 'Differences between similar products are visible', 'Product discovery'),
    g('c-tags', 'Concern/need tags on cards', 'Motivation'),
    g('c-usp', 'Shipping or service USP callouts where relevant', 'Clarity'),
    g('c-offers', 'Offers shown as a featured card or banner', 'Reciprocity'),
    g('c-quickadd', 'Quick add-to-cart where it suits the category', 'Friction'),
  ],
  product: [
    g('p-name', 'Product name clear and benefit-led; variants (size/colour/pack) clear', 'Clarity'),
    g('p-gallery', 'Image gallery works as a pitch: hero, in-use video, texture, results, how-to, sizes', 'Trust'),
    g('p-usps', 'Key features as short USPs in the first fold (bullets/icons)', 'Clarity'),
    g('p-cta', 'Add-to-cart visible without hunting; sticky after scroll on mobile', 'Friction', (s) => ((s.ctas || []).some((c) => c.sticky) ? 'pass' : '')),
    g('p-service', 'Service USPs under the CTA: shipping, returns, guarantee, COD, warranty', 'Trust', (s) => (s.signals.guarantee && s.signals.shipping ? 'pass' : '')),
    g('p-delivery', 'Delivery time clear (pincode/estimate where relevant)', 'Motivation'),
    g('p-reviews', 'Reviews with star breakdown, names, photos; UGC', 'Social proof', (s) => (s.signals.reviews ? 'pass' : '')),
    g('p-accordions', 'Details in accordions (not horizontal tabs): how to use, materials, origin, studies', 'Friction'),
    g('p-faq', 'FAQ answers real customer questions', 'Trust', (s) => (s.signals.faq ? 'pass' : '')),
    g('p-size', 'Size chart / suitability info where the category needs it', 'Clarity'),
    g('p-aov', 'Bundles, complete-the-look, quantity discounts, subscribe-and-save', 'AOV'),
    g('p-authority', 'Awards, press, expert endorsements where real', 'Authority'),
    g('p-urgency', 'Honest stock/offer urgency only', 'Urgency'),
    g('p-copy', 'Description copy skimmable: short paragraphs, bold key words, bullets', 'Clarity'),
  ],
  checkout: [
    g('k-costs', 'All costs (shipping, tax, fees) shown before the final step', 'Friction'),
    g('k-progress', 'Free-shipping or discount progress bar', 'AOV'),
    g('k-gift', 'Sample/gift eligibility reminded in cart', 'Reciprocity'),
    g('k-upsell', 'Upsell or complementary products with easy add', 'AOV'),
    g('k-guest', 'Guest checkout available', 'Friction'),
    g('k-fields', 'Form fields minimal, labelled, with validation and progress indicator', 'Friction'),
    g('k-trust', 'Payment options, security badges and return policy visible', 'Trust', (s) => (s.signals.security ? 'pass' : '')),
    g('k-recovery', 'Abandoned-cart recovery in place (email/SMS/exit offer)', 'Urgency'),
    g('k-support', 'Support/chat reachable at this stage', 'Trust', (s) => (s.signals.chat ? 'pass' : '')),
  ],
  landing: [
    g('l-match', 'Message match: the heading continues the ad’s promise', 'Clarity'),
    g('l-goal', 'One primary goal and CTA; minimal distracting navigation', 'Friction'),
    g('l-fold', 'Benefit-led heading, quick proof and clear next step in the first fold', 'Clarity'),
    g('l-objections', 'Objections answered: price, risk, how it works, who it’s for', 'Trust'),
    g('l-form', 'Short form or low-effort conversion; incentive stated', 'Reciprocity'),
    g('l-fast', 'Fast on mobile', 'Friction'),
  ],
  saas: [
    g('s-value', 'Value proposition clear in the first fold: who it’s for, the outcome, the next step', 'Clarity'),
    g('s-pricing', 'Pricing clear; plans comparable; objections addressed', 'Clarity'),
    g('s-trial', 'Free trial / demo / resource offered; CTA states the benefit', 'Reciprocity', (s) => (s.signals.freeTrial || s.signals.demo ? 'pass' : '')),
    g('s-proof', 'Customer logos, quantified case studies, named testimonials', 'Social proof', (s) => (s.signals.reviews ? 'pass' : '')),
    g('s-authority', 'Expert content, awards, credentials', 'Authority'),
    g('s-form', 'Sign-up/demo form short; progress indicator if multi-step', 'Friction'),
    g('s-voc', 'Feedback button or chat; exit/on-page survey on pricing', 'Trust', (s) => (s.signals.chat ? 'pass' : '')),
    g('s-security', 'Security, compliance and contact information visible', 'Trust'),
  ],
};
BY_TYPE.other = BY_TYPE.landing;

export function checklistFor(pageType) {
  return [
    { title: 'Every page', items: GLOBAL },
    { title: { home: 'Homepage', collection: 'Collection / listing', product: 'Product page', checkout: 'Cart & checkout', landing: 'Landing page', saas: 'SaaS & lead-gen', other: 'Landing page' }[pageType] || 'Page', items: BY_TYPE[pageType] || BY_TYPE.landing },
  ];
}

/** Pre-fill statuses the collector can support. Never overwrites the auditor's choice. */
export function prefillChecklist(pageType, snapshot, existing = {}) {
  const out = { ...existing };
  for (const section of checklistFor(pageType)) {
    for (const item of section.items) {
      if (out[item.id]?.status) continue;
      const auto = item.auto ? item.auto(snapshot) : '';
      out[item.id] = { status: auto || '', note: auto ? 'Pre-filled from automatic detection — please confirm.' : '', auto: !!auto };
    }
  }
  return out;
}
