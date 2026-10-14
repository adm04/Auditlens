// AI tasks for audits (bring-your-own-key, via ai.js).
//
// Rules: the model only rewrites and suggests. It receives text facts the extension
// measured (headline, CTA labels, title/description, finding titles) and must not invent
// data, test results or numbers. Output is stored separately and labelled
// "AI suggestion — review before using" in the UI and report. Screenshots are never sent.

import { complete, parseJSON } from './ai.js';

const SYSTEM = [
  'You are a senior conversion copywriter and CRO consultant helping an agency write an audit for a client.',
  'Rules:',
  '- Use ONLY the facts provided. Never invent traffic, conversion rates, test results, reviews or statistics.',
  '- Keep the brand’s product and claims; don’t promise things the page doesn’t.',
  '- Headlines: 3–6 words, benefit-led, natural speech. CTAs: up to ~3 words, state the benefit or destination.',
  '- SEO title 50–60 characters with the main topic first and the brand last; meta description 120–155 characters.',
  '- Plain text, no markdown. Reply with ONLY valid JSON matching the schema given.',
].join('\n');

function facts(audit) {
  const D = audit.views.desktop.snapshot;
  const top = audit.findings.filter((f) => f.include !== false).slice(0, 12);
  return {
    url: audit.url,
    brandOrSite: D.host,
    pageType: audit.context.pageType,
    businessModel: audit.context.businessModel,
    primaryConversion: audit.context.conversion,
    currentHeadline: D.fold.headline,
    currentCTAs: [...new Set((D.ctas || []).filter((c) => !c.inNav).map((c) => c.text))].slice(0, 8),
    seoTitle: D.seo.title,
    metaDescription: D.seo.metaDescription,
    h1: D.seo.h1s[0] || '',
    pageTextSample: (D.textSample || '').slice(0, 1200),
    findings: top.map((f) => ({ id: f.id, priority: f.priority, area: f.area, title: f.title, lever: f.lever })),
    pageSpeed: audit.psi?.mobile ? { mobilePerformance: audit.psi.mobile.scores.performance } : undefined,
  };
}

export async function suggestCopy(audit) {
  const user = [
    'Suggest improved copy for this page.',
    'Schema: {"headlines":["",""," "],"subheadline":"","ctas":["","",""],"seoTitle":"","metaDescription":"","notes":"one or two sentences on the reasoning"}',
    'Facts:',
    JSON.stringify(facts(audit)),
  ].join('\n');
  const out = parseJSON(await complete({ system: SYSTEM, user, maxTokens: 1500 }));
  const arr = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 5) : []);
  return {
    headlines: arr(out.headlines),
    subheadline: String(out.subheadline || '').trim(),
    ctas: arr(out.ctas),
    seoTitle: String(out.seoTitle || '').trim(),
    metaDescription: String(out.metaDescription || '').trim(),
    notes: String(out.notes || '').trim(),
    createdAt: Date.now(),
  };
}

export async function writeVerdict(audit) {
  const user = [
    'Write the "Snapshot" verdict for the top of the audit report: 3–4 sentences for a business owner.',
    'Say what the page does well, the biggest conversion leaks (refer to the P1 findings), and what to do first.',
    'Do not include numbers that are not in the facts. Say this is a desk audit based on the page itself (no analytics).',
    'Schema: {"verdict":""}',
    'Facts:',
    JSON.stringify({ ...facts(audit), strengths: (audit.strengths || []).map((s) => s.title) }),
  ].join('\n');
  const out = parseJSON(await complete({ system: SYSTEM, user, maxTokens: 900 }));
  return String(out.verdict || '').trim();
}
