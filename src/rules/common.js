// Shared vocabulary for findings, taken from the CRO method in the user's skill:
// evidence labels, psychology levers, P1–P3 priority, quick win vs A/B test.

export const EVIDENCE = {
  DATA: 'A number from real data (e.g. Chrome UX Report field data via PageSpeed Insights).',
  OBSERVED: 'Directly measured or seen on the page.',
  HEURISTIC: 'A proven pattern that is missing or weak here; not yet proven for this site.',
  HYPOTHESIS: 'A guess about visitor behaviour that research or an A/B test should confirm.',
};

export const LEVERS = {
  Friction: 'Effort, confusion or anxiety that stops people acting.',
  Motivation: 'The reason or occasion that brings a visitor here.',
  Urgency: 'A genuine reason to act now.',
  Clarity: 'How quickly people understand what this is and what to do.',
  Trust: 'Confidence that the site, brand and product are safe and genuine.',
  Authority: 'Being seen as the expert.',
  'Social proof': 'Evidence that other people chose and liked this.',
  Reciprocity: 'Giving something first so people give back.',
  'Product discovery': 'How fast people find the right product.',
  AOV: 'Average order value.',
  Speed: 'Load and response time.',
  Visibility: 'How easily search engines find, understand and show the page.',
  Accessibility: 'Whether everyone, including people using assistive tech, can use the page.',
};

export const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };
export const AREAS = ['CRO', 'UI', 'SEO', 'Speed', 'Accessibility'];
export const AREA_LABELS = { CRO: 'Conversion', UI: 'UI design', SEO: 'SEO', Speed: 'Speed', Accessibility: 'Accessibility' };

export const PAGE_TYPES = {
  home: 'Homepage',
  product: 'Product page',
  collection: 'Collection / listing',
  checkout: 'Cart / checkout',
  landing: 'Landing page',
  saas: 'SaaS / lead-gen',
  other: 'Other page',
};

export const BUSINESS_MODELS = {
  ecommerce: 'E-commerce',
  saas: 'SaaS',
  leadgen: 'Lead-gen / services',
  other: 'Content / other',
};

export const CONVERSIONS = {
  purchase: 'Purchase',
  signup: 'Sign-up / free trial',
  lead: 'Lead form / enquiry',
  demo: 'Demo or call booked',
  email: 'Email capture',
};

/**
 * @typedef {Object} Finding
 * @property {string} id            e.g. "F-03" (assigned after sorting)
 * @property {string} ruleId
 * @property {'CRO'|'UI'|'SEO'|'Speed'|'Accessibility'} area
 * @property {string} [simple]    one-line plain-language summary
 * @property {string} title
 * @property {string} observation   what is on the page / what the data shows
 * @property {string} why           why it costs conversions / visibility
 * @property {string[]} fix         numbered, concrete steps
 * @property {string} lever
 * @property {'DATA'|'OBSERVED'|'HEURISTIC'|'HYPOTHESIS'} evidence
 * @property {'P1'|'P2'|'P3'} priority
 * @property {'Quick win'|'A/B test'} type
 * @property {string} [hypothesis]
 * @property {string} [metric]
 * @property {'H'|'M'|'L'} impact
 * @property {'H'|'M'|'L'} confidence
 * @property {string} segment       'All' | 'Mobile' | 'Desktop'
 * @property {{view:'desktop'|'mobile', rect:{x,y,w,h}, label?:string}} [element]
 * @property {{label:string,url:string}[]} [refs]
 * @property {string} [platformTip]
 * @property {'auto'|'psi'|'manual'} source
 * @property {'open'|'progress'|'fixed'|'wontfix'} status
 * @property {boolean} include      include in the report
 * @property {string} note          auditor note
 */
export function finding(f) {
  return {
    id: '',
    area: 'CRO',
    lever: 'Clarity',
    evidence: 'OBSERVED',
    priority: 'P2',
    type: 'Quick win',
    impact: f.priority === 'P1' ? 'H' : f.priority === 'P3' ? 'L' : 'M',
    confidence: f.evidence === 'OBSERVED' || f.evidence === 'DATA' ? 'H' : f.evidence === 'HEURISTIC' ? 'M' : 'L',
    segment: 'All',
    source: 'auto',
    status: 'open',
    include: true,
    note: '',
    fix: [],
    refs: [],
    ...f,
  };
}

export function strength(title, detail, lever) {
  return { title, detail, lever };
}

export function sortFindings(list) {
  const areaOrder = { CRO: 0, UI: 1, Speed: 2, SEO: 3, Accessibility: 4 };
  return list.sort((a, b) =>
    (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
    ((areaOrder[a.area] ?? 9) - (areaOrder[b.area] ?? 9)) ||
    ((a.type === 'Quick win' ? 0 : 1) - (b.type === 'Quick win' ? 0 : 1))
  );
}

export function assignIds(list) {
  list.forEach((f, i) => { f.id = `F-${String(i + 1).padStart(2, '0')}`; });
  return list;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const quote = (s) => `“${s}”`;
