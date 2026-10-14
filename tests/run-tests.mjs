// Run with:  node tests/run-tests.mjs
// Pure-logic tests (rules, PageSpeed parsing, heatmap maths, CSV/JSON export).
// Browser-only parts (capture, canvas rendering, UI) are covered by the manual test plan in HANDOFF.md.

import assert from 'node:assert/strict';
import { snapshot, psiSample } from './fixtures.mjs';

const { analyze, counts, siteSummary } = await import('../src/analyze.js');
const { GLOSSARY } = await import('../src/rules/plain.js');
const { buildReport, buildSiteReport } = await import('../src/report.js');
const { parsePSI, psiFindings, splitMarkdown, canUsePSI } = await import('../src/psi.js');
const { computeAttention, attentionInsights } = await import('../src/heatmap.js');
const { toCSV, toJSON } = await import('../src/exporters.js');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.stack}`); process.exitCode = 1; }
};

const audit = (extra = {}) => ({
  id: 'a1', url: 'https://shop.example.com/p', options: { mobile: true, pageType: 'auto', conversion: 'auto' },
  views: {
    desktop: { snapshot: snapshot(), shotMeta: { cssHeight: 4500 } },
    mobile: { snapshot: snapshot({ vw: 390, vh: 760 }), shotMeta: { cssHeight: 3800 } },
  },
  psi: {}, findings: [], checklist: {}, ...extra,
});

console.log('Rules');
await test('detects key CRO problems on a weak product page', () => {
  const { findings, context } = analyze(audit());
  const ids = findings.map((f) => f.ruleId);
  assert.equal(context.pageType, 'product');
  assert.equal(context.conversion, 'purchase');
  for (const id of ['cro.fold-headline-long', 'cro.fold-cta-missing', 'cro.cta-generic', 'cro.cta-contrast', 'cro.popup-at-load', 'cro.social-proof', 'cro.guarantee', 'cro.shipping', 'cro.contact', 'cro.form-long', 'cro.form-labels', 'cro.form-email-type', 'cro.email-incentive', 'cro.text-size', 'cro.text-contrast', 'cro.urgency-check', 'cro.sticky-cta']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});
await test('detects SEO problems', () => {
  const ids = analyze(audit()).findings.map((f) => f.ruleId);
  for (const id of ['seo.title-length', 'seo.description-missing', 'seo.h1-multiple', 'seo.heading-order', 'seo.img-alt', 'seo.lang', 'seo.canonical', 'seo.mixed', 'seo.og', 'seo.schema-invalid', 'seo.schema-product', 'seo.thin', 'seo.anchors', 'seo.url']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});
await test('every finding is complete and labelled', () => {
  for (const f of analyze(audit()).findings) {
    assert.match(f.id, /^F-\d{2}$/);
    assert.ok(f.title && f.observation && f.why, `${f.ruleId} missing text`);
    assert.ok(f.fix.length >= 1, `${f.ruleId} has no fix steps`);
    assert.ok(['DATA', 'OBSERVED', 'HEURISTIC', 'HYPOTHESIS'].includes(f.evidence));
    assert.ok(['P1', 'P2', 'P3'].includes(f.priority));
    if (f.type === 'A/B test') assert.ok(f.hypothesis, `${f.ruleId} test without hypothesis`);
  }
});
await test('findings sorted P1 → P3', () => {
  const p = analyze(audit()).findings.map((f) => f.priority);
  assert.deepEqual(p, [...p].sort());
});
await test('platform tips attach for Shopify', () => {
  const f = analyze(audit()).findings.find((x) => x.ruleId === 'speed.img-oversized');
  assert.match(f.platformTip, /image_url/);
});
await test('a strong page produces strengths and few findings', () => {
  const good = snapshot({
    fold: { headline: 'Linen shirts for hot days', headlineWords: 5, headlineFontSize: 48, headingCount: 2 },
    ctas: [{ text: 'Add to cart', tag: 'button', rect: { x: 900, y: 500, w: 260, h: 52 }, inFold: true, filled: true, inNav: false, generic: false, bgContrast: 4.2, textContrast: 7, fontSize: 16, sticky: false, prominence: 30000 },
      { text: 'Add to cart', tag: 'sticky', rect: { x: 0, y: 0, w: 390, h: 52 }, inFold: true, filled: true, inNav: false, generic: false, bgContrast: null, textContrast: null, sticky: true, prominence: 0 }],
    forms: [],
    overlays: [],
    signals: { ...snapshot().signals, reviews: true, guarantee: true, shipping: true, contact: true, chat: true, search: true, faq: true, urgency: '', policies: { privacy: true, returns: true, shipping: true, terms: true } },
    readability: { paragraphs: 10, medianFontSize: 16, longParagraphs: 0, longExample: '', wideLines: 0, lowContrast: [] },
  });
  const a = audit();
  a.views.desktop.snapshot = good;
  a.views.mobile.snapshot = { ...good, viewport: { w: 390, h: 760, dpr: 3 } };
  const { findings, strengths } = analyze(a);
  const cro = findings.filter((f) => f.area === 'CRO').map((f) => f.ruleId);
  assert.ok(!cro.includes('cro.fold-cta-missing'));
  assert.ok(!cro.includes('cro.social-proof'));
  assert.ok(strengths.length >= 4, `only ${strengths.length} strengths`);
});
await test('auditor edits survive re-analysis; manual findings kept', () => {
  const a = audit();
  const first = analyze(a);
  const target = first.findings.find((f) => f.ruleId === 'cro.contact');
  target.status = 'fixed';
  target.priority = 'P3';
  first.findings.push({ ruleId: 'manual.1', source: 'manual', title: 'Hero video autoplays with sound', priority: 'P1', area: 'CRO', type: 'Quick win', fix: ['Mute it'], status: 'open', include: true });
  a.findings = first.findings;
  const second = analyze(a);
  const again = second.findings.find((f) => f.ruleId === 'cro.contact');
  assert.equal(again.status, 'fixed');
  assert.equal(again.priority, 'P3');
  assert.ok(second.findings.some((f) => f.ruleId === 'manual.1'));
});
await test('checklist pre-fills only what can be detected', () => {
  const { checklist } = analyze(audit());
  assert.equal(checklist['g-popups'].status, 'missing');
  assert.equal(checklist['g-search'].status, '');
  assert.ok('p-reviews' in checklist);
});

await test('UI element rules fire on an inconsistent page', () => {
  const ids = analyze(audit()).findings.map((f) => f.ruleId);
  for (const id of ['ui.button-styles', 'ui.radius', 'ui.fonts', 'ui.type-scale', 'ui.heading-hierarchy', 'ui.tiny-text', 'ui.line-height', 'ui.centred-text', 'ui.text-colours', 'ui.icon-buttons', 'ui.hidden-links', 'ui.distorted-images', 'ui.field-sizes']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});
await test('every auto finding has a plain-language summary and no CTA jargon in titles', () => {
  for (const f of analyze(audit()).findings) {
    assert.ok(f.simple && f.simple.length > 10, `${f.ruleId} has no simple summary`);
    assert.ok(!/\bCTA\b/.test(f.title), `${f.ruleId} title has jargon: ${f.title}`);
    assert.ok(!/\bCTA\b/.test(f.fix.join(' ')), `${f.ruleId} fix has jargon`);
  }
  assert.ok(GLOSSARY.length >= 10);
});
await test('quoted page text is never rewritten', () => {
  const a = audit();
  a.views.desktop.snapshot.ctas[0].text = 'Our CTA';
  const f = analyze(a).findings.find((x) => x.ruleId === 'cro.cta-contrast');
  assert.ok(f.observation.includes('“Our CTA”'));
});
await test('site summary finds issues repeated across pages', () => {
  const a1 = audit(); a1.id = 'p1'; Object.assign(a1, analyze(a1));
  const a2 = audit(); a2.id = 'p2'; a2.url = 'https://shop.example.com/about'; Object.assign(a2, analyze(a2));
  const s = siteSummary([a1, a2]);
  assert.equal(s.pageCount, 2);
  assert.ok(s.siteWide.length > 5);
  assert.equal(s.siteWide[0].pages.length, 2);
  assert.equal(s.total, a1.findings.length + a2.findings.length);
});
await test('page and site reports build', () => {
  const a1 = audit(); a1.id = 'p1'; a1.title = 'Home'; a1.createdAt = Date.now(); Object.assign(a1, analyze(a1));
  const a2 = audit(); a2.id = 'p2'; a2.title = 'About'; a2.createdAt = Date.now(); Object.assign(a2, analyze(a2));
  const html = buildReport(a1, {});
  assert.ok(html.includes('In simple words') && html.includes('UI design') && html.includes('Glossary'));
  const site = { id: 's1', host: 'shop.example.com', title: 'Shop', createdAt: Date.now(), pageIds: ['p1', 'p2'], errors: [] };
  const sh = buildSiteReport(site, [a1, a2], {});
  assert.ok(sh.includes('Fix once, improve every page') && sh.includes('Home') && sh.includes('About'));
  assert.ok(!sh.includes('undefined'), 'report contains "undefined"');
});

console.log('PageSpeed');
await test('parses scores, lab, field and opportunities', () => {
  const p = parsePSI(psiSample(), 'mobile');
  assert.equal(p.scores.performance, 38);
  assert.equal(p.lab.LCP.display, '6.1 s');
  assert.equal(p.field.metrics.LCP.category, 'SLOW');
  assert.equal(p.field.metrics.CLS.value, 0.15);
  assert.equal(p.opportunities[0].id, 'image-delivery-insight');
  assert.ok(!p.opportunities.some((o) => o.id === 'dom-size-insight'), 'informative audits excluded');
  assert.equal(p.failed.accessibility.length, 2);
  assert.equal(p.failed.seo.length, 1);
});
await test('PSI findings: field data is DATA, opportunities get fix steps, local overlap removed', () => {
  const psi = { mobile: parsePSI(psiSample(), 'mobile') };
  const { findings } = psiFindings(psi, { platform: 'Shopify' });
  const field = findings.find((f) => f.ruleId === 'psi.cwv-field');
  assert.equal(field.evidence, 'DATA');
  assert.equal(field.priority, 'P1');
  const img = findings.find((f) => f.ruleId === 'psi.image-delivery-insight');
  assert.equal(img.priority, 'P1');
  assert.ok(img.fix.length >= 2 && img.platformTip);
  assert.ok(img.refs[0].url.startsWith('https://'));
  assert.ok(findings.some((f) => f.area === 'Accessibility'));
  assert.ok(findings.some((f) => f.ruleId === 'psi.seo.robots-txt'));
  const all = analyze(audit({ psi })).findings.map((f) => f.ruleId);
  assert.ok(!all.includes('speed.lcp-local'));
});
await test('markdown links become refs', () => {
  const { text, refs } = splitMarkdown('Do X. [Learn more](https://a.dev/x) and `code`.');
  assert.equal(text, 'Do X. Learn more and code.');
  assert.equal(refs[0].url, 'https://a.dev/x');
});
await test('PSI refused for private hosts', () => {
  assert.equal(canUsePSI('http://localhost:3000'), false);
  assert.equal(canUsePSI('https://staging.local/x'), false);
  assert.equal(canUsePSI('https://example.com'), true);
});

console.log('Heatmap');
await test('attention concentrates on the first screen and sums to ~100%', () => {
  const s = snapshot();
  const att = computeAttention(s.salient, { pageW: 1440, pageH: 4500, viewportH: 900 });
  const total = att.screenShare.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 1, `total ${total}`);
  assert.ok(att.screenShare[0] > att.screenShare[1]);
  assert.ok(att.max > 0);
});
await test('a high-contrast CTA outranks a faint one', () => {
  const page = { pageW: 1440, pageH: 900, viewportH: 900 };
  const base = [{ kind: 'image', rect: { x: 700, y: 100, w: 600, h: 600 } }];
  const strong = computeAttention([...base, { kind: 'cta', rect: { x: 100, y: 400, w: 240, h: 56 }, contrast: 6, filled: true }], page);
  const faint = computeAttention([...base, { kind: 'cta', rect: { x: 100, y: 400, w: 240, h: 56 }, contrast: 1.1, filled: false }], page);
  assert.ok(strong.sumIn({ x: 100, y: 400, w: 240, h: 56 }) > faint.sumIn({ x: 100, y: 400, w: 240, h: 56 }));
});
await test('insights identify primary CTA', () => {
  const s = snapshot({ ctas: [{ text: 'Buy', rect: { x: 100, y: 400, w: 200, h: 50 }, filled: true, inNav: false }] });
  const att = computeAttention([...s.salient, { kind: 'cta', rect: { x: 100, y: 400, w: 200, h: 50 }, contrast: 4, filled: true }], { pageW: 1440, pageH: 4500, viewportH: 900 });
  const ins = attentionInsights(att, s);
  assert.equal(ins.primaryCta, 'Buy');
  assert.ok(ins.primaryCtaRank >= 1);
});

console.log('Export');
await test('CSV escapes quotes, commas and newlines', () => {
  const a = audit();
  a.findings = analyze(a).findings;
  a.findings[0].title = 'He said "hi", then\nleft';
  const csv = toCSV(a);
  assert.ok(csv.startsWith('﻿ID,Area'));
  assert.ok(csv.includes('"He said ""hi"", then\nleft"'));
  assert.equal(csv.split('\r\n').length, a.findings.length + 1);
});
await test('JSON export drops screenshots and keeps findings', () => {
  const a = audit();
  a.views.desktop.shot = { size: 123 };
  a.findings = analyze(a).findings;
  const data = JSON.parse(toJSON(a));
  assert.equal(data.findings.length, a.findings.length);
  assert.equal(data.views.desktop.shot, undefined);
  assert.equal(data.schema, 'auditlens.audit/1');
});

console.log('Billing');
const billing = await import('../backend/supabase/functions/_shared/billing.js');
const SECRET = 'whsec_' + Buffer.from('super-secret-test-key-1234567890').toString('base64');
await test('valid Dodo (Standard Webhooks) signature is accepted', async () => {
  const body = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await billing.signStandardWebhook(SECRET, 'msg_1', ts, body);
  assert.equal(await billing.verifyStandardWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: `v1,bogus ${sig}` }, body), true);
});
await test('tampered body, wrong secret and old timestamps are rejected', async () => {
  const body = '{"type":"subscription.active"}';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await billing.signStandardWebhook(SECRET, 'msg_2', ts, body);
  assert.equal(await billing.verifyStandardWebhook(SECRET, { id: 'msg_2', timestamp: ts, signature: sig }, body + ' '), false);
  const other = 'whsec_' + Buffer.from('another-key').toString('base64');
  assert.equal(await billing.verifyStandardWebhook(other, { id: 'msg_2', timestamp: ts, signature: sig }, body), false);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const oldSig = await billing.signStandardWebhook(SECRET, 'msg_3', old, body);
  assert.equal(await billing.verifyStandardWebhook(SECRET, { id: 'msg_3', timestamp: old, signature: oldSig }, body), false);
  assert.equal(await billing.verifyStandardWebhook('', { id: 'x', timestamp: ts, signature: sig }, body), false);
});
await test('subscription events map to the right plan', () => {
  const ev = (type, extra = {}) => ({ type, data: { subscription_id: 'sub_1', product_id: 'pdt_pro', customer: { customer_id: 'cus_1', email: 'a@b.co' }, metadata: { user_id: 'u1' }, next_billing_date: '2026-11-12T00:00:00Z', ...extra } });
  const opts = { proProductId: 'pdt_pro' };
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.active'), opts).plan, 'pro');
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.renewed'), opts).current_period_end, '2026-11-12T00:00:00Z');
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.active', { product_id: 'pdt_other' }), opts).plan, 'free');
  const hold = billing.mapSubscriptionEvent(ev('subscription.on_hold'), opts);
  assert.equal(hold.status, 'on_hold'); assert.equal(hold.keepPlan, true);
  const cancel = billing.mapSubscriptionEvent(ev('subscription.cancelled'), opts);
  assert.equal(cancel.keepPlan, true); assert.equal(cancel.cancel_at_period_end, true);
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.expired'), opts).plan, 'free');
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.failed'), opts).plan, 'free');
  assert.equal(billing.mapSubscriptionEvent(ev('subscription.active'), opts).user_id, 'u1');
  assert.equal(billing.mapSubscriptionEvent({ type: 'payment.succeeded', data: {} }, opts), null);
});
await test('free-plan limits in config match the SQL migration', async () => {
  const fs = await import('node:fs');
  const sql = fs.readFileSync(new URL('../backend/supabase/migrations/20261012000000_billing.sql', import.meta.url), 'utf8');
  const limits = [...sql.matchAll(/free_limit constant int := (\d+)/g)].map((m) => Number(m[1]));
  const cfg = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  const cfgLimit = Number(cfg.match(/auditsPerMonth: (\d+)/)[1]);
  assert.ok(limits.length === 2 && limits.every((l) => l === cfgLimit), `SQL ${limits} vs config ${cfgLimit}`);
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
