// Plain-language layer. Every finding gets a one-line "In simple words" summary a business
// owner understands without any marketing, SEO or developer vocabulary. Technical terms
// that remain are explained in the glossary printed at the end of the report.

const SIMPLE = {
  // CRO
  'cro.fold-headline-missing': 'Visitors can’t tell what you offer in the first few seconds.',
  'cro.fold-headline-long': 'Your main headline is too long to read at a glance — shorten it.',
  'cro.fold-cta-missing': 'People can’t see what to do next without scrolling.',
  'cro.fold-cta-competing': 'Too many buttons fight for attention, so people hesitate.',
  'cro.cta-generic': 'Button text like “Submit” doesn’t tell people what they’ll get.',
  'cro.cta-contrast': 'Your main buttons blend into the page and are easy to miss.',
  'cro.tap-targets': 'Buttons are fiddly to tap on a phone.',
  'cro.sticky-cta': 'On a long phone page, the button disappears once people scroll.',
  'cro.popup-at-load': 'A pop-up blocks the page before people have even looked at it.',
  'cro.cookie-banner': 'The cookie notice hides too much of the first screen.',
  'cro.social-proof': 'Nothing shows that other people bought from you and were happy.',
  'cro.guarantee': 'People don’t see what happens if they’re not happy (returns, guarantee).',
  'cro.shipping': 'Delivery cost and time aren’t clear, so people worry about surprises.',
  'cro.contact': 'There’s no obvious way to contact you, which lowers trust.',
  'cro.policies': 'Returns, shipping or privacy pages are hard to find.',
  'cro.security': 'Checkout doesn’t reassure people that paying is safe.',
  'cro.chat': 'There’s no quick way to ask a question before buying.',
  'cro.search': 'Shoppers can’t search for what they want.',
  'cro.faq': 'Common questions aren’t answered on the page.',
  'cro.urgency-check': 'Make sure “only 3 left” or “ends soon” messages are true.',
  'cro.form-long': 'The form asks for too much, so fewer people finish it.',
  'cro.form-labels': 'Form boxes lose their name once you start typing.',
  'cro.form-email-type': 'Phones show the wrong keyboard for the email box.',
  'cro.form-autocomplete': 'Browsers can’t auto-fill the form, so typing takes longer.',
  'cro.email-incentive': 'There’s no reason given to join your email list.',
  'cro.text-size': 'Text is small and hard to read on a phone.',
  'cro.long-paragraphs': 'Big blocks of text get skipped.',
  'cro.text-contrast': 'Some text is too light to read easily.',
  'heat.cta-attention-mobile': 'Your main button probably isn’t the first thing people notice on a phone.',
  'heat.cta-attention-desktop': 'Your main button probably isn’t the first thing people notice.',
  // SEO
  'seo.noindex': 'Google has been told not to show this page.',
  'seo.title-missing': 'The page has no headline for Google results.',
  'seo.title-length': 'The page’s Google headline is the wrong length.',
  'seo.description-missing': 'There’s no summary written for Google results.',
  'seo.description-length': 'The Google summary is the wrong length.',
  'seo.h1-missing': 'The page has no main heading for Google to read.',
  'seo.h1-multiple': 'The page has several main headings, which confuses Google.',
  'seo.heading-order': 'Headings are out of order, which makes the structure unclear.',
  'seo.img-alt': 'Images have no text description for Google and blind visitors.',
  'seo.viewport': 'The page isn’t set up to fit phone screens.',
  'seo.lang': 'The page doesn’t say what language it’s in.',
  'seo.canonical': 'Google isn’t told which address is the “official” one for this page.',
  'seo.canonical-other': 'This page tells Google to show a different page instead.',
  'seo.mixed': 'Some files load insecurely, which can trigger browser warnings.',
  'seo.og': 'Links shared on WhatsApp or social media won’t show a nice preview.',
  'seo.schema-invalid': 'Extra information for Google is broken, so it’s ignored.',
  'seo.schema-product': 'Google can’t show price and star ratings for this product.',
  'seo.schema-none': 'Google gets no extra details about your business.',
  'seo.thin': 'There isn’t enough text for Google (or visitors) to understand the page.',
  'seo.anchors': 'Some links don’t say where they go.',
  'seo.url': 'The page address is messy.',
  // Speed
  'speed.img-oversized': 'Images are far bigger than needed, which slows the page.',
  'speed.img-format': 'Images use older, heavier file types.',
  'speed.lazy': 'Images far down the page load too early and slow the start.',
  'speed.lazy-hero': 'The main image waits too long to load.',
  'speed.img-dimensions': 'The page jumps around while images load.',
  'speed.ttfb': 'Your server is slow to respond.',
  'speed.lcp-local': 'The main content takes too long to appear.',
  'speed.cls-local': 'Things move around while the page loads.',
  'speed.weight': 'The page is heavy to download, especially on mobile data.',
  'speed.third-party': 'Lots of outside tools (chat, tracking, ads) slow the page.',
  'psi.cwv-field': 'Real visitors find this page slow — Google measures this too.',
  'psi.performance-score': 'Google’s speed test rates this page as slow.',
  // UI
  'ui.button-styles': 'Buttons look different all over the page, so none feels like “the” button.',
  'ui.radius': 'Button corners don’t match, which looks unfinished.',
  'ui.no-filled-button': 'No button stands out as the main action.',
  'ui.fonts': 'Too many fonts make the page look busy.',
  'ui.type-scale': 'Too many text sizes make the page look uneven.',
  'ui.heading-hierarchy': 'Smaller headings look more important than the main one.',
  'ui.tiny-text': 'Some text is too tiny to read.',
  'ui.line-height': 'Lines of text are squeezed together.',
  'ui.centred-text': 'Long centred paragraphs are hard to read.',
  'ui.text-colours': 'Too many text colours make the design feel inconsistent.',
  'ui.icon-buttons': 'Some buttons are just icons that people may not understand.',
  'ui.hidden-links': 'Links look like normal text, so people miss them.',
  'ui.distorted-images': 'Some images are stretched out of shape.',
  'ui.field-sizes': 'Form boxes are different sizes.',
  'ui.mobile-buttons': 'Buttons look different on phones than on computers.',
};

const PSI_SIMPLE = [
  [/image|webp|avif|offscreen/i, 'Images could be smaller and load faster.'],
  [/render.?blocking|preconnect|critical|network-dependency/i, 'Some files block the page from showing until they finish loading.'],
  [/javascript|bootup|main-?thread|reflow|inp|long-tasks/i, 'Too much code runs on the page, making it slow to respond.'],
  [/css/i, 'The page loads styling it doesn’t use.'],
  [/server|latency|redirect/i, 'The server is slow to send the page.'],
  [/cache/i, 'Returning visitors re-download files they already have.'],
  [/font/i, 'Fonts delay or shift the text while loading.'],
  [/lcp|largest/i, 'The main content takes too long to appear.'],
  [/cls|layout|unsized/i, 'Things jump around while the page loads.'],
  [/third/i, 'Outside tools (chat, tracking, ads) slow the page.'],
  [/dom/i, 'The page is built with too many parts, which slows it down.'],
  [/compression|byte-weight/i, 'Files are sent bigger than they need to be.'],
];

export function simpleFor(f) {
  if (SIMPLE[f.ruleId]) return SIMPLE[f.ruleId];
  if (f.ruleId?.startsWith('psi.a11y.')) return 'Some people using assistive technology (like screen readers) will struggle here.';
  if (f.ruleId?.startsWith('psi.seo.')) return 'Google flagged a basic search issue on this page.';
  if (f.ruleId?.startsWith('psi.')) {
    const hit = PSI_SIMPLE.find(([re]) => re.test(f.ruleId));
    return hit ? hit[1] : 'Google’s speed test found something that slows this page down.';
  }
  return '';
}

// Jargon → everyday words, applied to titles, explanations and fix steps (never to quoted page text).
const JARGON = [
  [/\bprimary CTA\b/gi, 'main button'],
  [/\bCTAs\b/g, 'buttons'],
  [/\bCTA\b/g, 'button'],
  [/\babove the fold\b/gi, 'on the first screen'],
  [/\bbelow the fold\b/gi, 'below the first screen'],
  [/\bfirst fold\b/gi, 'first screen'],
  [/\bclick-through( rate)?\b/gi, 'clicks'],
  [/\bbounce\b(?! rate)/gi, 'leave right away'],
];

function plainify(text) {
  if (!text || typeof text !== 'string') return text;
  // Protect quoted page text (“…”) from replacement.
  const parts = text.split(/(“[^”]*”)/);
  return parts.map((p, i) => (i % 2 ? p : JARGON.reduce((t, [re, rep]) => t.replace(re, rep), p))).join('');
}

/** Adds f.simple and softens jargon. Leaves auditor-edited findings untouched. */
export function applyPlainLanguage(findings) {
  for (const f of findings) {
    if (!f.simple) f.simple = simpleFor(f);
    if (f.edited || f.source === 'manual') continue;
    f.title = plainify(f.title);
    f.why = plainify(f.why);
    f.hypothesis = plainify(f.hypothesis);
    f.fix = (f.fix || []).map(plainify);
  }
  return findings;
}

export const GLOSSARY = [
  ['A/B test', 'Showing two versions of a page to different visitors at the same time to see which gets more sales or sign-ups.'],
  ['Quick win', 'A safe, low-effort fix you can make straight away without testing.'],
  ['P1 / P2 / P3', 'Priority: P1 = fix first (biggest impact), P2 = fix next, P3 = polish.'],
  ['Conversion', 'A visitor doing what you want — buying, booking, signing up or sending an enquiry.'],
  ['First screen', 'What visitors see before they scroll.'],
  ['Social proof', 'Signs that other people use and like you: reviews, ratings, customer logos, testimonials.'],
  ['Core Web Vitals', 'Google’s three speed measures from real visitors: how fast the main content appears (LCP), how quickly the page reacts to taps (INP), and how much things jump around (CLS).'],
  ['LCP', 'Largest Contentful Paint — the moment the main content (usually the big image or headline) appears. Good: under 2.5 s.'],
  ['INP', 'Interaction to Next Paint — how quickly the page reacts when someone taps or clicks. Good: under 200 ms.'],
  ['CLS', 'Cumulative Layout Shift — how much things move while loading. Good: under 0.1.'],
  ['PageSpeed score', 'Google’s 0–100 rating of a simulated load on a mid-range phone. 90+ is good, under 50 is poor.'],
  ['Meta description', 'The short summary shown under your page title in Google results.'],
  ['Title tag', 'The clickable headline of your page in Google results and browser tabs.'],
  ['Alt text', 'A short text description of an image, read by Google and screen readers.'],
  ['Structured data (schema)', 'Hidden labels that tell Google facts like price, rating or opening hours, so it can show them in results.'],
  ['Canonical URL', 'A tag telling Google which web address is the main version of a page.'],
  ['Contrast', 'How much text or buttons stand out from the background. Low contrast is hard to read.'],
  ['Heatmap (predicted)', 'A colour map estimating where people look first, based on the layout — not on real visitor tracking.'],
  ['Evidence labels', 'DATA = measured from real visitors · OBSERVED = seen on the page · HEURISTIC = a proven best practice that’s missing · HYPOTHESIS = a likely issue to confirm with testing.'],
];
