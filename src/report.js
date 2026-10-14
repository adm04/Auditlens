// Builds the client report as one self-contained HTML document (also printed to PDF).
// Structure follows the CRO method's report template:
//   Cover → 1 Snapshot → 2 Evidence & limits → 3 Strengths → 4 Ranked findings →
//   5 Finding details (with how-to-fix) → 6 Attention heatmap → 7 Page speed → 8 SEO →
//   9 A/B test plan → 10 Quick wins → 11 AI copy ideas → 12 CRO checklist →
//   13 Data to collect next → Methodology & disclaimer.
// Pure string building: images arrive pre-rendered as data URLs from the workspace.

import { PAGE_TYPES, BUSINESS_MODELS, CONVERSIONS, EVIDENCE, AREA_LABELS } from './rules/common.js';
import { GLOSSARY } from './rules/plain.js';
import { checklistFor } from './checklists.js';
import { counts, siteSummary } from './analyze.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P_LABEL = { P1: 'P1 · Fix first', P2: 'P2 · Next', P3: 'P3 · Polish' };
const STATUS = { open: 'Open', progress: 'In progress', fixed: 'Fixed', wontfix: 'Won’t fix' };
const scoreClass = (v) => (v == null ? 'na' : v >= 90 ? 'good' : v >= 50 ? 'ok' : 'bad');
const catClass = (c) => ({ FAST: 'good', AVERAGE: 'ok', SLOW: 'bad' }[c] || 'na');
const catText = (c) => ({ FAST: 'Good', AVERAGE: 'Needs improvement', SLOW: 'Poor' }[c] || '—');
const fmt = (m) => (m.unit === 'cls' ? m.value.toFixed(2) : m.value >= 1000 ? `${(m.value / 1000).toFixed(1)} s` : `${Math.round(m.value)} ms`);

export function autoVerdict(audit) {
  const c = counts(audit.findings);
  const lc = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
  const p1 = audit.findings.filter((f) => f.include !== false && f.priority === 'P1').slice(0, 3).map((f) => lc(f.title));
  const strengths = (audit.strengths || []).slice(0, 2).map((s) => lc(s.title));
  const parts = [];
  parts.push(`This desk audit of ${audit.views.desktop.snapshot.host} found ${c.total} improvement${c.total === 1 ? '' : 's'}: ${c.P1} to fix first, ${c.P2} next and ${c.P3} to polish.`);
  if (strengths.length) parts.push(`Worth keeping: ${strengths.join(' and ')}.`);
  if (p1.length) parts.push(`The biggest leaks: ${p1.join('; ')}.`);
  parts.push('Start with the quick wins, then run the A/B tests in the order listed, and collect the data in section 13 to confirm the hypotheses.');
  return parts.join(' ');
}

function chips(f) {
  return `<span class="pill ${f.priority}">${esc(f.priority)}</span><span class="pill area">${esc(AREA_LABELS[f.area] || f.area)}</span><span class="pill">${esc(f.type)}</span><span class="pill ev">${esc(f.evidence)}</span>${f.segment && f.segment !== 'All' ? `<span class="pill">${esc(f.segment)}</span>` : ''}`;
}

function findingCard(f, img, detailed) {
  const steps = (f.fix || []).filter(Boolean);
  return `<article class="finding ${detailed ? '' : 'compact'}" id="${esc(f.id)}">
    <header><span class="fid">${esc(f.id)}</span><h3>${esc(f.title)}</h3></header>
    ${f.simple ? `<p class="simple"><strong>In simple words:</strong> ${esc(f.simple)}</p>` : ''}
    <div class="chips">${chips(f)}<span class="lever">Focus: ${esc(f.lever)}</span>${f.status && f.status !== 'open' ? `<span class="lever">Status: ${esc(STATUS[f.status] || f.status)}</span>` : ''}</div>
    ${img && detailed ? `<figure><img src="${img}" alt="Evidence for ${esc(f.id)}"><figcaption>Evidence (${esc(f.element?.view || f.segment || 'page')} view${f.element ? ', highlighted' : ''})</figcaption></figure>` : ''}
    <dl>
      <dt>What we found</dt><dd>${esc(f.observation)}</dd>
      ${detailed ? `<dt>Why it matters</dt><dd>${esc(f.why)}</dd>` : ''}
      <dt>What to do</dt><dd><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${f.platformTip ? `<p class="tip"><strong>On ${esc(f._platform || 'your platform')}:</strong> ${esc(f.platformTip)}</p>` : ''}</dd>
      ${detailed && f.type === 'A/B test' && f.hypothesis ? `<dt>What to test</dt><dd>${esc(f.hypothesis)}${f.metric ? `<br><span class="muted">Primary metric: ${esc(f.metric)}</span>` : ''}</dd>` : ''}
      ${f.note ? `<dt>Auditor note</dt><dd>${esc(f.note)}</dd>` : ''}
      ${detailed && f.refs?.length ? `<dt>Learn more</dt><dd>${f.refs.slice(0, 3).map((r) => `<a href="${esc(r.url)}">${esc(r.label)}</a>`).join(' · ')}</dd>` : ''}
    </dl>
  </article>`;
}

function psiBlock(p, label) {
  if (!p) return '';
  const cats = [['performance', 'Performance'], ['accessibility', 'Accessibility'], ['best-practices', 'Best practices'], ['seo', 'SEO']];
  const field = p.field || p.originField;
  return `<div class="psi">
    <h3>${esc(label)}</h3>
    <div class="scores">${cats.map(([k, l]) => `<div class="score ${scoreClass(p.scores[k])}"><b>${p.scores[k] ?? '–'}</b><span>${l}</span></div>`).join('')}</div>
    ${field ? `<table class="cwv"><caption>Real visitors (Chrome UX Report, 75th percentile, last 28 days${p.field ? '' : ' — whole site'})</caption>
      <tr><th>Metric</th><th>Value</th><th>Rating</th></tr>
      ${Object.values(field.metrics).map((m) => `<tr><td>${esc(m.label)}</td><td>${fmt(m)}</td><td><span class="dot ${catClass(m.category)}"></span>${catText(m.category)}</td></tr>`).join('')}
    </table>` : '<p class="muted">Not enough real-visitor data in the Chrome UX Report for this page or site.</p>'}
    <table class="lab"><caption>Lab test (simulated ${label.toLowerCase().includes('mobile') ? 'mid-range phone on slow 4G' : 'desktop'})</caption>
      <tr>${Object.entries(p.lab).map(([k]) => `<th>${k}</th>`).join('')}</tr>
      <tr>${Object.values(p.lab).map((m) => `<td>${esc(m.display)}</td>`).join('')}</tr>
    </table>
  </div>`;
}

function seoTable(s) {
  const row = (label, ok, value) => `<tr><td>${ok ? '<span class="ok">✓</span>' : '<span class="no">✕</span>'}</td><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
  return `<table class="checks">
    <tr><th></th><th>Check</th><th>Found</th></tr>
    ${row('Title tag (50–60 chars)', s.title.length >= 30 && s.title.length <= 60, `${s.title || '—'} (${s.title.length})`)}
    ${row('Meta description (120–155 chars)', s.metaDescription.length >= 70 && s.metaDescription.length <= 160, s.metaDescription ? `${s.metaDescription.slice(0, 90)}… (${s.metaDescription.length})` : '—')}
    ${row('One H1', s.h1s.length === 1, s.h1s.join(' | ') || '—')}
    ${row('Indexable', !/noindex/i.test(s.robots), s.robots || 'default (index)')}
    ${row('Canonical URL', !!s.canonical, s.canonical || '—')}
    ${row('Mobile viewport', !!s.viewport, s.viewport || '—')}
    ${row('Language declared', !!s.lang, s.lang || '—')}
    ${row('Image alt text', s.images.missingAlt === 0, `${s.images.missingAlt} of ${s.images.total} missing`)}
    ${row('Structured data', s.structuredData.length > 0 && !s.jsonldErrors, s.structuredData.join(', ') || '—')}
    ${row('Social previews (Open Graph)', !!(s.og.title && s.og.image), s.og.title ? 'og:title set' : '—')}
    ${row('HTTPS without mixed content', s.mixedContent === 0, s.mixedContent ? `${s.mixedContent} http files` : 'OK')}
    ${row('Enough content', s.wordCount >= 250, `${s.wordCount} words`)}
  </table>`;
}

function serpPreview(s) {
  let url = s.url;
  try { const u = new URL(s.url); url = `${u.host}${u.pathname === '/' ? '' : ` › ${u.pathname.split('/').filter(Boolean).join(' › ')}`}`; } catch { /* keep */ }
  const t = s.title.length > 60 ? `${s.title.slice(0, 58)}…` : s.title || '(no title)';
  const d = s.metaDescription ? (s.metaDescription.length > 158 ? `${s.metaDescription.slice(0, 155)}…` : s.metaDescription) : 'No meta description — Google will pick text from the page.';
  return `<div class="serp"><div class="serp-url">${esc(url)}</div><div class="serp-title">${esc(t)}</div><div class="serp-desc">${esc(d)}</div></div>`;
}


export function uiSection(audit, images = {}) {
  const u = audit.views.desktop.snapshot.ui;
  if (!u) return '';
  const btns = (u.buttonStyles || []).slice(0, 8);
  const sw = (c) => `<span class="swatch" style="background:${esc(c)}"></span>`;
  return `
    <p>How the building blocks of the page look and behave. Consistent buttons, text and colours make a site feel trustworthy and easy to use.</p>
    <div class="ui-grid">
      <div class="ui-card"><h3>Buttons <span class="muted">(${btns.length} style${btns.length === 1 ? '' : 's'})</span></h3>
        <p class="muted small">Ideally 2–3 styles: one main button, one secondary, one text link.</p>
        <div class="btn-list">${btns.map((b, i) => `<div class="btn-item">${images.buttons?.[i] ? `<img src="${images.buttons[i]}" alt="">` : ''}<div><strong>“${esc(b.example)}”</strong><br><span class="muted small">${b.count}× · ${b.height}px tall · ${b.radius >= 100 ? 'pill' : `${b.radius}px corners`} · ${sw(b.bg)}${esc(b.bg === 'transparent' ? 'outline' : b.bg)}</span></div></div>`).join('')}</div></div>
      <div class="ui-card"><h3>Fonts</h3>
        <p class="muted small">Ideally 1–2 fonts.</p>
        <ul class="plain">${(u.fonts || []).slice(0, 5).map((f) => `<li><span style="font-family:'${esc(f.value)}',sans-serif;font-size:18px">${esc(f.value)}</span> <span class="muted small">used ${f.count}×</span></li>`).join('')}</ul>
        <h3>Text sizes</h3><p class="muted small">Ideally a set of 5–7 sizes.</p>
        <p>${(u.fontSizes || []).filter((x) => x.count >= 2).map((x) => `<span class="chip-size">${x.value}px</span>`).join(' ')}</p>
        <h3>Headings</h3><p>${Object.entries(u.headingSizes || {}).map(([k, v]) => `<span class="chip-size">${k.toUpperCase()} ${v}px</span>`).join(' ') || '—'}</p>
      </div>
      <div class="ui-card"><h3>Text colours</h3><p class="muted small">Ideally 3–4.</p>
        <p class="swatches">${(u.textColors || []).slice(0, 12).map((c) => `<span title="${esc(c.value)}">${sw(c.value)}</span>`).join('')}</p>
        <h3>Other checks</h3>
        <ul class="plain small">
          <li>${u.iconOnly?.length ? `<span class="no">✕</span> ${u.iconOnly.length} icon buttons without a label` : '<span class="ok">✓</span> Icon buttons have labels'}</li>
          <li>${u.hiddenLinks >= 2 ? `<span class="no">✕</span> ${u.hiddenLinks} links look like plain text` : '<span class="ok">✓</span> Links are recognisable'}</li>
          <li>${u.distorted?.length ? `<span class="no">✕</span> ${u.distorted.length} stretched images` : '<span class="ok">✓</span> No stretched images'}</li>
          <li>${u.tiny > 5 ? `<span class="no">✕</span> ${u.tiny} bits of tiny text (&lt;12px)` : '<span class="ok">✓</span> No tiny text'}</li>
          <li>${(u.fieldHeights || []).length > 2 ? `<span class="no">✕</span> Form fields in ${u.fieldHeights.length} sizes` : '<span class="ok">✓</span> Form fields are consistent'}</li>
        </ul>
      </div>
    </div>`;
}

function glossarySection(H) {
  return `<section class="glossary">${H('Glossary')}<p>Plain explanations of the terms used in this report.</p><dl class="gl">${GLOSSARY.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl></section>`;
}

const DATA_TO_COLLECT = [
  'Analytics (GA4 or similar): conversion rate, AOV, device split, new vs returning, funnel drop-off by step, bounce and conversion by page type, traffic source by page — plus backend order/lead counts to check tracking.',
  'Real heatmaps, scroll maps and a sample of session recordings for this page (Microsoft Clarity is free; Hotjar also works).',
  'Reviews, support tickets, chat/WhatsApp questions and social comments — repeated questions show missing information.',
  'An on-page or exit survey: “What stopped you from completing today?”',
  'The 2–3 competitors the team watches most closely.',
  'Monthly conversions on this page (around 800+ per month supports several A/B tests a month; below that, test bigger changes or use micro-conversions).',
];

/**
 * @param {object} audit
 * @param {{settings:object, pro:boolean, images:{heat?:{desktop?:string,mobile?:string}, crops?:Object<string,string>, attachments?:{src:string,caption:string}[], firstScreens?:{desktop?:string,mobile?:string}}, sections?:Object<string,boolean>, heatInfo?:object}} opts
 */
export function buildReport(audit, { settings = {}, pro = false, images = {}, sections = {}, heatInfo = {}, lockedCount = 0 } = {}) {
  const on = (k) => sections[k] !== false;
  const D = audit.views.desktop.snapshot;
  const M = audit.views.mobile?.snapshot;
  const ctx = audit.context || {};
  const brand = pro
    ? { color: settings.brandColor || '#FF6B3D', logo: settings.logoDataUrl || '', agency: settings.agencyName || '', footer: settings.footerText || '', watermark: false }
    : { color: '#FF6B3D', logo: '', agency: '', footer: '', watermark: true };
  const list = audit.findings.filter((f) => f.include !== false).map((f) => ({ ...f, _platform: ctx.platform }));
  const c = counts(audit.findings);
  const date = new Date(audit.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const leaks = list.filter((f) => f.area === 'CRO' && f.priority === 'P1').concat(list.filter((f) => f.priority === 'P1' && f.area !== 'CRO')).slice(0, 3);
  const tests = list.filter((f) => f.type === 'A/B test');
  const quick = list.filter((f) => f.type === 'Quick win');
  const psiMain = audit.psi?.mobile || audit.psi?.desktop;
  let n = 0;
  const H = (title) => `<h2><span class="sec">${++n}</span>${esc(title)}</h2>`;

  const toc = [];
  const body = [];

  // Cover
  body.push(`<section class="cover">
    ${brand.logo || brand.agency ? `<div class="brand">${brand.logo ? `<img src="${brand.logo}" alt="">` : ''}${brand.agency ? `<span>${esc(brand.agency)}</span>` : ''}</div>` : ''}
    <div class="eyebrow">Conversion, SEO &amp; speed audit</div>
    <h1>${esc(audit.title || D.host)}</h1>
    <p class="url">${esc(audit.url)}</p>
    <dl class="meta">
      <div><dt>Date</dt><dd>${esc(date)}</dd></div>
      ${settings.auditorName && pro ? `<div><dt>Auditor</dt><dd>${esc(settings.auditorName)}</dd></div>` : ''}
      <div><dt>Page type</dt><dd>${esc(PAGE_TYPES[ctx.pageType] || ctx.pageType)}</dd></div>
      <div><dt>Business</dt><dd>${esc(BUSINESS_MODELS[ctx.businessModel] || ctx.businessModel)}</dd></div>
      <div><dt>Primary conversion</dt><dd>${esc(CONVERSIONS[ctx.conversion] || ctx.conversion)}</dd></div>
      <div><dt>Mode</dt><dd>Desk audit (page + public data)</dd></div>
    </dl>
    <div class="summary-bar">
      <div><b>${c.P1}</b><span>Fix first</span></div><div><b>${c.P2}</b><span>Next</span></div><div><b>${c.P3}</b><span>Polish</span></div>
      <div><b>${c.quickWins}</b><span>Quick wins</span></div><div><b>${c.tests}</b><span>Tests</span></div>
      ${psiMain?.scores?.performance != null ? `<div><b>${psiMain.scores.performance}</b><span>Speed (${psiMain.strategy})</span></div>` : ''}
    </div>
  </section>`);

  // 1 Snapshot
  body.push(`<section>${H('Snapshot')}
    <p class="verdict">${esc(audit.verdict || autoVerdict(audit))}</p>
    ${leaks.length ? `<h3>Top conversion leaks</h3><ol class="leaks">${leaks.map((f) => `<li><a href="#${esc(f.id)}">${esc(f.id)}</a> ${esc(f.title)} <span class="muted">— ${esc(f.lever)}</span></li>`).join('')}</ol>` : ''}
  </section>`);
  toc.push('Snapshot');

  // 2 Evidence & limits
  body.push(`<section>${H('Evidence and limits')}
    <p><strong>Seen:</strong> desktop view (${D.viewport.w}px wide${audit.views.desktop.shotMeta?.truncated ? ', first part of a long page' : ''})${M ? `, mobile view (${M.viewport.w}px wide)` : ''}${psiMain ? ', Google PageSpeed Insights (lab test + Chrome UX Report real-visitor data where available)' : ''}, and the page’s HTML, text, links, forms and load timing.</p>
    <p><strong>Not seen:</strong> analytics, real heatmaps or recordings, customer feedback, logged-in or checkout flows beyond this page, and competitors. Findings about visitor behaviour are therefore hypotheses until data confirms them.</p>
    ${M ? '<p class="muted">The mobile view is a 390px-wide browser window. Sites that detect phones by device type may look different on real phones; PageSpeed’s mobile test uses true phone emulation.</p>' : ''}
    <table class="legend"><tr><th>Label</th><th>Meaning</th></tr>${Object.entries(EVIDENCE).map(([k, v]) => `<tr><td><span class="pill ev">${k}</span></td><td>${esc(v)}</td></tr>`).join('')}</table>
  </section>`);
  toc.push('Evidence and limits');

  // 3 Strengths
  if (on('strengths') && audit.strengths?.length) {
    body.push(`<section>${H('Strengths to keep and amplify')}<ul class="strengths">${audit.strengths.map((s) => `<li><strong>${esc(s.title)}</strong> ${esc(s.detail)} <span class="muted">(${esc(s.lever)})</span></li>`).join('')}</ul></section>`);
    toc.push('Strengths');
  }

  // 4 Ranked findings
  body.push(`<section>${H('All findings, ranked')}
    <table class="ranked"><tr><th>ID</th><th>Finding</th><th>Area</th><th>Focus</th><th>Evidence</th><th>Type</th><th>Priority</th></tr>
    ${list.map((f) => `<tr><td><a href="#${esc(f.id)}">${esc(f.id)}</a></td><td>${esc(f.title)}${f.segment && f.segment !== 'All' ? ` <span class="muted">(${esc(f.segment)})</span>` : ''}${f.simple ? `<br><span class="muted small">${esc(f.simple)}</span>` : ''}</td><td>${esc(AREA_LABELS[f.area] || f.area)}</td><td>${esc(f.lever)}</td><td>${esc(f.evidence)}</td><td>${esc(f.type)}</td><td><span class="pill ${f.priority}">${f.priority}</span></td></tr>`).join('')}
    </table>
    ${lockedCount ? `<p class="callout"><strong>${lockedCount} more finding${lockedCount === 1 ? '' : 's'}</strong> with step-by-step fixes are available in the full audit (AuditLens Pro).</p>` : ''}
    </section>`);
  toc.push('All findings');

  // 5 Details
  body.push(`<section class="details">${H('Findings and how to fix them')}
    ${['P1', 'P2', 'P3'].map((p) => {
      const group = list.filter((f) => f.priority === p);
      return group.length ? `<h3 class="group">${P_LABEL[p]}</h3>${group.map((f) => findingCard(f, images.crops?.[f.id], p !== 'P3')).join('')}` : '';
    }).join('')}
  </section>`);
  toc.push('Findings and fixes');

  // 6 Heatmap
  if (on('heatmap') && (images.heat?.desktop || images.heat?.mobile)) {
    body.push(`<section class="heat">${H('Predicted attention heatmap')}
      <p class="callout"><strong>This is a prediction, not visitor data.</strong> It models where attention is likely to go from the layout (size, contrast, position and content type), based on common eye-tracking patterns. Confirm with a real heatmap tool before acting on it.</p>
      ${heatInfo.mobile || heatInfo.desktop ? `<ul>${['mobile', 'desktop'].filter((v) => heatInfo[v]).map((v) => {
        const i = heatInfo[v];
        return `<li><strong>${v === 'mobile' ? 'Mobile' : 'Desktop'}:</strong> about ${i.firstScreenShare}% of predicted attention lands on the first screen.${i.primaryCta ? ` The main button “${esc(i.primaryCta)}” ranks ${i.primaryCtaRank ? `#${i.primaryCtaRank}` : 'outside the top 12'} among first-screen elements.` : ' No primary button on the first screen.'}</li>`;
      }).join('')}</ul>` : ''}
      <div class="heat-grid">
        ${images.heat?.mobile ? `<figure><img src="${images.heat.mobile}" alt="Predicted attention, mobile"><figcaption>Mobile (predicted)</figcaption></figure>` : ''}
        ${images.heat?.desktop ? `<figure><img src="${images.heat.desktop}" alt="Predicted attention, desktop"><figcaption>Desktop (predicted)</figcaption></figure>` : ''}
      </div>
      ${(images.attachments || []).length ? `<h3>Real heatmaps / recordings supplied</h3>${images.attachments.map((a) => `<figure><img src="${a.src}" alt=""><figcaption>${esc(a.caption || 'Attached evidence')}</figcaption></figure>`).join('')}` : ''}
    </section>`);
    toc.push('Attention heatmap');
  }

  // UI elements
  if (on('ui') && D.ui) {
    body.push(`<section class="ui">${H('UI elements review')}${uiSection(audit, images)}</section>`);
    toc.push('UI elements');
  }

  // 7 Speed
  if (on('speed')) {
    const p = D.perf || {};
    body.push(`<section>${H('Page speed')}
      ${audit.psi?.mobile || audit.psi?.desktop
        ? `<div class="psi-grid">${psiBlock(audit.psi.mobile, 'Mobile (PageSpeed Insights)')}${psiBlock(audit.psi.desktop, 'Desktop (PageSpeed Insights)')}</div>`
        : `<p class="muted">${esc(audit.psi?.error || 'PageSpeed Insights was not run for this page (it only works for public URLs).')}</p>`}
      <h3>Measured in the auditor’s browser</h3>
      <table class="lab"><tr><th>Server response</th><th>LCP</th><th>CLS</th><th>Requests</th><th>Transferred</th><th>Third-party domains</th></tr>
      <tr><td>${p.ttfb != null ? `${p.ttfb} ms` : '–'}</td><td>${p.lcp ? `${(p.lcp / 1000).toFixed(1)} s` : '–'}</td><td>${p.cls ?? '–'}</td><td>${p.requests ?? '–'}</td><td>${p.sizesKnown ? `${(p.totalBytes / 1024 / 1024).toFixed(1)} MB` : 'unknown'}</td><td>${p.thirdPartyDomains ?? '–'}</td></tr></table>
      <p class="muted">One page load on the auditor’s connection and device; use PageSpeed and real-visitor data for decisions.</p>
    </section>`);
    toc.push('Page speed');
  }

  // 8 SEO
  if (on('seo')) {
    body.push(`<section>${H('On-page SEO')}
      <h3>How it can look in Google</h3>${serpPreview(D.seo)}
      ${seoTable(D.seo)}
      <p class="muted">On-page checks only. Rankings also depend on content quality, search intent, links and site-wide technical health.</p>
    </section>`);
    toc.push('On-page SEO');
  }

  // 9 Test plan
  if (tests.length) {
    body.push(`<section>${H('A/B test plan')}
      <p>Run one test at a time on the same journey. No traffic data was supplied, so tests are ranked by impact and confidence rather than expected extra conversions. Typical test win rates are 30–40%; a test that doesn’t win still teaches something.</p>
      <table class="plan"><colgroup><col style="width:4%"><col style="width:24%"><col style="width:38%"><col style="width:14%"><col style="width:12%"><col style="width:8%"></colgroup><tr><th>#</th><th>Test</th><th>Hypothesis &amp; primary metric</th><th>Lever · segment</th><th>Impact · confidence</th><th>Priority</th></tr>
      ${tests.map((f, i) => `<tr><td>${i + 1}</td><td><a href="#${esc(f.id)}">${esc(f.id)}</a> ${esc(f.title)}</td><td>${esc(f.hypothesis || '')}${f.metric ? `<br><span class="muted">Metric: ${esc(f.metric)}</span>` : ''}</td><td>${esc(f.lever)} · ${esc(f.segment)}</td><td>${f.impact} · ${f.confidence}</td><td><span class="pill ${f.priority}">${f.priority}</span></td></tr>`).join('')}
      </table></section>`);
    toc.push('A/B test plan');
  }

  // 10 Quick wins
  if (quick.length) {
    body.push(`<section>${H('Quick wins (ship without testing)')}<ul class="quick">${quick.map((f) => `<li><a href="#${esc(f.id)}">${esc(f.id)}</a> <strong>${esc(f.title)}</strong> — ${esc(f.fix[0] || '')}</li>`).join('')}</ul></section>`);
    toc.push('Quick wins');
  }

  // 11 AI copy ideas
  const ai = audit.ai?.copy;
  if (on('ai') && ai && (ai.headlines?.length || ai.ctas?.length || ai.seoTitle)) {
    body.push(`<section>${H('Copy ideas to test')}
      <p class="callout">AI-generated suggestions based on this page’s current copy. Review and edit before using; they are ideas for A/B tests, not results.</p>
      ${ai.headlines?.length ? `<h3>Headline options</h3><ul>${ai.headlines.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>${ai.subheadline ? `<p><strong>Sub-headline:</strong> ${esc(ai.subheadline)}</p>` : ''}` : ''}
      ${ai.ctas?.length ? `<h3>Button label options</h3><ul>${ai.ctas.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      ${ai.seoTitle || ai.metaDescription ? `<h3>Search listing</h3><p><strong>Title:</strong> ${esc(ai.seoTitle)} <span class="muted">(${ai.seoTitle.length} chars)</span><br><strong>Description:</strong> ${esc(ai.metaDescription)} <span class="muted">(${ai.metaDescription.length} chars)</span></p>` : ''}
      ${ai.notes ? `<p class="muted">${esc(ai.notes)}</p>` : ''}
    </section>`);
    toc.push('Copy ideas');
  }

  // 12 Checklist
  if (on('checklist')) {
    const LABEL = { pass: 'Pass', weak: 'Weak', missing: 'Missing', na: 'N/A', '': 'Not reviewed' };
    const sectionsHtml = checklistFor(ctx.pageType).map((sec) => `<h3>${esc(sec.title)}</h3><table class="checklist"><tr><th>Item</th><th>Status</th><th>Lever</th><th>Note</th></tr>${sec.items.map((it) => {
      const r = audit.checklist?.[it.id] || {};
      return `<tr><td>${esc(it.text)}</td><td><span class="st ${r.status || 'none'}">${LABEL[r.status || '']}</span></td><td>${esc(it.lever)}</td><td>${esc(r.note || '')}</td></tr>`;
    }).join('')}</table>`).join('');
    body.push(`<section>${H('CRO checklist')}<p class="muted">Reviewed mobile-first. “Not reviewed” items still need a manual check.</p>${sectionsHtml}</section>`);
    toc.push('CRO checklist');
  }

  // 13 Data to collect
  body.push(`<section>${H('Data to collect next')}<p>These would turn the hypotheses in this report into evidence-backed findings:</p><ul>${DATA_TO_COLLECT.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></section>`);
  toc.push('Data to collect');

  body.push(glossarySection(H));
  toc.push('Glossary');

  // Methodology
  body.push(`<section class="method"><h2>Methodology and scope</h2>
    <p>Findings combine automated checks of the live page (desktop and a 390px mobile window), Google PageSpeed Insights (Lighthouse ${esc(psiMain?.lighthouseVersion || '')}) and a structured conversion review covering friction, clarity, trust, social proof, urgency, reciprocity, product discovery and order value. Each finding states its evidence level and whether to ship it directly (quick win) or validate it with an A/B test.</p>
    <p>Automated accessibility checks cover only part of accessibility; keyboard, screen-reader and cognitive testing need a human. This report is not a certification of accessibility, legal or search-engine compliance, and no specific conversion lift is promised.</p>
    ${audit.notes ? `<h3>Auditor notes</h3><p>${esc(audit.notes).replace(/\n/g, '<br>')}</p>` : ''}
  </section>`);

  const footerLeft = brand.footer || (brand.agency ? `Prepared by ${brand.agency}` : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Audit — ${audit.title || D.host}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400..800;1,400..800&display=swap">
<style>${CSS(brand.color)}</style></head>
<body><main class="doc">
${body[0]}
<nav class="toc"><h2>Contents</h2><ol>${toc.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></nav>
${body.slice(1).join('\n')}
<footer><span>${esc(footerLeft)}</span><span>${brand.watermark ? 'Made with AuditLens' : ''}</span></footer>
</main></body></html>`;
}

// ---- Site report (multi-page) ------------------------------------------------------

export function autoSiteVerdict(site, summary) {
  const top = summary.siteWide.slice(0, 3).map((g) => g.simple || g.title);
  const parts = [`We reviewed ${summary.pageCount} main page${summary.pageCount === 1 ? '' : 's'} of ${site.host} and found ${summary.total} improvements (${summary.P1} to fix first).`];
  if (summary.siteWide.length) parts.push(`${summary.siteWide.length} issues repeat across pages, so fixing them once in the site’s template improves every page at the same time.`);
  if (top.length) parts.push(`The biggest themes: ${top.map((t) => t.replace(/\.$/, '')).join('; ')}.`);
  parts.push('Start with section 3 (fix once, improve every page), then work through each page’s own list.');
  return parts.join(' ');
}

/**
 * @param {object} site
 * @param {object[]} audits   page audits in site order
 * @param {{settings, pro, images:Object<string,{crops?,shot?,heat?,buttons?}>, sections}} opts
 */
export function buildSiteReport(site, audits, { settings = {}, pro = false, images = {}, sections = {} } = {}) {
  const on = (k) => sections[k] !== false;
  const summary = siteSummary(audits);
  const siteWideIds = new Set(summary.siteWide.map((g) => g.ruleId));
  const brand = pro
    ? { color: settings.brandColor || '#FF6B3D', logo: settings.logoDataUrl || '', agency: settings.agencyName || '', footer: settings.footerText || '', watermark: false }
    : { color: '#FF6B3D', logo: '', agency: '', footer: '', watermark: true };
  const date = new Date(site.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const speeds = summary.pages.map((p) => p.speed).filter((v) => v != null);
  const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null;
  const pageName = (a) => a.title || a.url;
  let n = 0;
  const H = (t) => `<h2><span class="sec">${++n}</span>${esc(t)}</h2>`;
  const toc = [];
  const body = [];

  body.push(`<section class="cover">
    ${brand.logo || brand.agency ? `<div class="brand">${brand.logo ? `<img src="${brand.logo}" alt="">` : ''}${brand.agency ? `<span>${esc(brand.agency)}</span>` : ''}</div>` : ''}
    <div class="eyebrow">Website audit · conversion, UI, SEO &amp; speed</div>
    <h1>${esc(site.title || site.host)}</h1>
    <p class="url">${esc(site.host)} · ${summary.pageCount} pages reviewed</p>
    <dl class="meta">
      <div><dt>Date</dt><dd>${esc(date)}</dd></div>
      ${settings.auditorName && pro ? `<div><dt>Auditor</dt><dd>${esc(settings.auditorName)}</dd></div>` : ''}
      <div><dt>Pages</dt><dd>${summary.pageCount}</dd></div>
      <div><dt>Mode</dt><dd>Desk audit (pages + public data)</dd></div>
    </dl>
    <div class="summary-bar">
      <div><b>${summary.P1}</b><span>Fix first</span></div>
      <div><b>${summary.total}</b><span>Improvements</span></div>
      <div><b>${summary.siteWide.length}</b><span>Site-wide issues</span></div>
      ${avgSpeed != null ? `<div><b>${avgSpeed}</b><span>Avg speed score</span></div>` : ''}
    </div>
  </section>`);

  body.push(`<section>${H('Summary')}<p class="verdict">${esc(site.verdict || autoSiteVerdict(site, summary))}</p></section>`);
  toc.push('Summary');

  body.push(`<section>${H('Pages reviewed')}
    <table class="pages"><tr><th>Page</th><th>Type</th><th>Fix first</th><th>Next</th><th>Polish</th><th>Speed (mobile)</th></tr>
    ${summary.pages.map((p, i) => `<tr><td><a href="#page-${i + 1}"><strong>${esc(p.title || p.url)}</strong></a><br><span class="muted small">${esc(p.url)}</span></td><td>${esc(PAGE_TYPES[p.pageType] || p.pageType || '')}</td><td><span class="pill P1">${p.counts.P1}</span></td><td><span class="pill P2">${p.counts.P2}</span></td><td><span class="pill P3">${p.counts.P3}</span></td><td>${p.speed ?? '–'}</td></tr>`).join('')}
    </table>
    ${(site.errors || []).length ? `<p class="muted">Couldn’t audit: ${site.errors.map((e) => `${esc(e.url)} (${esc(e.error)})`).join('; ')}</p>` : ''}
  </section>`);
  toc.push('Pages reviewed');

  if (summary.siteWide.length) {
    body.push(`<section>${H('Fix once, improve every page')}
      <p>These issues appear on several pages. They usually come from the site’s shared template, theme or components, so one fix improves every page listed.</p>
      ${summary.siteWide.slice(0, 18).map((g) => `<div class="site-issue">
        <div class="chips"><span class="pill ${g.priority}">${g.priority}</span><span class="pill area">${esc(AREA_LABELS[g.area] || g.area)}</span><span class="pill">${esc(g.type)}</span><span class="pill">${g.pages.length} pages</span></div>
        <h3>${esc(g.title)}</h3>
        ${g.simple ? `<p class="simple"><strong>In simple words:</strong> ${esc(g.simple)}</p>` : ''}
        <p>${esc(g.why)}</p>
        <strong>What to do</strong><ol class="steps">${(g.fix || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        ${g.platformTip ? `<p class="tip">${esc(g.platformTip)}</p>` : ''}
        <p class="affected">Found on: ${g.pages.map((pg) => esc(pg.title || pg.url)).join(' · ')}</p>
      </div>`).join('')}
    </section>`);
    toc.push('Fix once, improve every page');
  }

  // Page by page
  const pageSec = ++n;
  toc.push('Page by page');
  audits.forEach((a, i) => {
    const img = images[a.id] || {};
    const own = (a.findings || []).filter((f) => f.include !== false && !siteWideIds.has(f.ruleId))
      .map((f) => ({ ...f, id: `${i + 1}·${f.id}`, _platform: a.context?.platform }));
    const shared = (a.findings || []).filter((f) => f.include !== false && siteWideIds.has(f.ruleId)).length;
    const c = counts(a.findings || []);
    const main = a.psi?.mobile || a.psi?.desktop;
    body.push(`<section class="site-page" id="page-${i + 1}">
      ${i === 0 ? `<h2><span class="sec">${pageSec}</span>Page by page</h2>` : ''}
      <div class="page-head"><div><div class="eyebrow">Page ${i + 1} · ${esc(PAGE_TYPES[a.context?.pageType] || '')}</div><h2>${esc(pageName(a))}</h2><p class="muted small">${esc(a.url)}</p></div>
        <div class="summary-bar"><div><b>${c.P1}</b><span>Fix first</span></div><div><b>${c.total}</b><span>Total</span></div>${main?.scores?.performance != null ? `<div><b>${main.scores.performance}</b><span>Speed</span></div>` : ''}</div></div>
      ${img.shot ? `<img class="page-shot" src="${img.shot}" alt="First screen of ${esc(pageName(a))}">` : ''}
      ${shared ? `<p class="muted">Also affected by ${shared} site-wide issue${shared === 1 ? '' : 's'} (see section 3).</p>` : ''}
      ${own.length ? ['P1', 'P2', 'P3'].map((p) => {
        const g = own.filter((f) => f.priority === p);
        return g.length ? `<h3 class="group">${P_LABEL[p]}</h3>${g.map((f) => findingCard(f, img.crops?.[f.id.split('·')[1]], p !== 'P3')).join('')}` : '';
      }).join('') : '<p>No issues specific to this page beyond the site-wide ones.</p>'}
      ${on('heatmap') && img.heat ? `<figure class="page-heat"><img src="${img.heat}" alt="Predicted attention" style="max-width:260px;border-radius:10px;border:1px solid var(--line)"><figcaption>Predicted attention on mobile (a model, not visitor data)</figcaption></figure>` : ''}
    </section>`);
  });

  if (on('ui') && audits[0]?.views?.desktop?.snapshot?.ui) {
    body.push(`<section class="ui site-page">${H('UI elements review')}<p class="muted">Based on ${esc(pageName(audits[0]))}; site-wide UI issues are listed in section 3.</p>${uiSection(audits[0], images[audits[0].id] || {})}</section>`);
    toc.push('UI elements');
  }

  // Test plan (deduped by rule)
  const seen = new Set();
  const tests = [];
  for (const a of audits) for (const f of a.findings || []) {
    if (f.include === false || f.type !== 'A/B test' || seen.has(f.ruleId)) continue;
    seen.add(f.ruleId);
    const pagesWith = audits.filter((x) => (x.findings || []).some((y) => y.ruleId === f.ruleId && y.include !== false)).map(pageName);
    tests.push({ ...f, pagesWith });
  }
  tests.sort((a, b) => a.priority.localeCompare(b.priority) || b.pagesWith.length - a.pagesWith.length);
  if (tests.length) {
    body.push(`<section>${H('What to test (A/B test plan)')}
      <p>Changes that could help or hurt, so prove them with a test first. Run one test at a time per page. Typical tests win 30–40% of the time; a losing test still teaches you something.</p>
      <table class="plan"><colgroup><col style="width:4%"><col style="width:26%"><col style="width:40%"><col style="width:22%"><col style="width:8%"></colgroup>
      <tr><th>#</th><th>Test</th><th>What we expect &amp; how to measure</th><th>Pages</th><th>Priority</th></tr>
      ${tests.slice(0, 15).map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.title)}</td><td>${esc(f.hypothesis || '')}${f.metric ? `<br><span class="muted">Measure: ${esc(f.metric)}</span>` : ''}</td><td class="small">${f.pagesWith.map(esc).join(', ')}</td><td><span class="pill ${f.priority}">${f.priority}</span></td></tr>`).join('')}
      </table></section>`);
    toc.push('What to test');
  }

  // Quick wins
  const quick = summary.siteWide.filter((g) => g.type === 'Quick win').map((g) => ({ title: g.title, step: g.fix?.[0] || '', where: `${g.pages.length} pages` }));
  audits.forEach((a) => (a.findings || []).filter((f) => f.include !== false && f.type === 'Quick win' && !siteWideIds.has(f.ruleId) && f.priority !== 'P3')
    .forEach((f) => quick.push({ title: f.title, step: f.fix?.[0] || '', where: pageName(a) })));
  if (quick.length) {
    body.push(`<section>${H('Quick wins (do these now)')}<ul class="quick">${quick.slice(0, 25).map((q) => `<li><strong>${esc(q.title)}</strong> <span class="muted">(${esc(q.where)})</span> — ${esc(q.step)}</li>`).join('')}</ul></section>`);
    toc.push('Quick wins');
  }

  body.push(`<section>${H('Data to collect next')}<ul>${DATA_TO_COLLECT.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></section>`);
  toc.push('Data to collect');
  body.push(glossarySection(H));
  toc.push('Glossary');
  body.push(`<section class="method"><h2>Methodology and scope</h2>
    <p>Each page was checked automatically on desktop and in a 390px mobile window, with Google PageSpeed Insights where available, and reviewed for conversion, UI consistency, SEO and speed. Every finding says how sure we are (evidence label) and whether to fix it directly or test it first.</p>
    <p>Automated checks cover only part of accessibility and SEO. This report is not a certification, and no specific increase in sales is promised.</p>
    ${site.notes ? `<h3>Auditor notes</h3><p>${esc(site.notes).replace(/\n/g, '<br>')}</p>` : ''}
  </section>`);

  const footerLeft = brand.footer || (brand.agency ? `Prepared by ${brand.agency}` : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Website audit — ${site.title || site.host}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400..800;1,400..800&display=swap">
<style>${CSS(brand.color)}</style></head>
<body><main class="doc">
${body[0]}
<nav class="toc"><h2>Contents</h2><ol>${toc.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></nav>
${body.slice(1).join('\n')}
<footer><span>${esc(footerLeft)}</span><span>${brand.watermark ? 'Made with AuditLens' : ''}</span></footer>
</main></body></html>`;
}

const CSS = (accent) => `
:root{--accent:${accent};--ink:#14213D;--ink2:#3A4560;--muted:#6A7186;--line:#E3E1DA;--paper:#fff;--bg:#F7F6F2;--p1:#C8341F;--p2:#B26A00;--p3:#5B6474;--good:#0F8A5F;--ok:#B26A00;--bad:#C8341F}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{max-width:980px;margin:0 auto;padding:48px 36px 64px}
a{color:var(--ink);text-decoration-color:var(--accent);text-underline-offset:2px}
h2{font-size:24px;letter-spacing:-.01em;margin:0 0 14px;display:flex;align-items:center;gap:12px}
h2 .sec{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--ink);color:#fff;font-size:14px}
h3{font-size:16px;margin:22px 0 8px}
section{margin:0 0 44px}
.muted{color:var(--muted)}
.cover{min-height:72vh;display:flex;flex-direction:column;justify-content:center;border-left:6px solid var(--accent);padding:24px 0 24px 32px}
.cover .brand{display:flex;align-items:center;gap:12px;margin-bottom:36px;font-weight:600;color:var(--ink2)}
.cover .brand img{max-height:46px;max-width:200px;object-fit:contain}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;color:var(--accent)}
.cover h1{font-size:40px;line-height:1.1;letter-spacing:-.02em;margin:10px 0 6px}
.cover .url{color:var(--muted);word-break:break-all;margin:0 0 24px}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px 24px;margin:0 0 28px}
.meta dt{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.meta dd{margin:2px 0 0;font-weight:600}
.summary-bar{display:flex;flex-wrap:wrap;gap:10px}
.summary-bar div{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 16px;min-width:96px}
.summary-bar b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.summary-bar span{font-size:12px;color:var(--muted)}
.toc{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:22px 28px;margin:0 0 44px}
.toc h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.toc ol{margin:0;columns:2;padding-left:20px}.toc li{margin:4px 0}
.verdict{font-size:17px;line-height:1.6;background:var(--paper);border-left:4px solid var(--accent);padding:16px 20px;border-radius:0 12px 12px 0}
.leaks li{margin:6px 0}
.callout{background:#FFF4EC;border:1px solid #F6D3BF;border-radius:10px;padding:12px 16px}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13.5px;margin:8px 0 16px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#F1EFE9;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2)}
caption{caption-side:top;text-align:left;font-size:12px;color:var(--muted);padding:0 0 6px}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#ECEAE3;color:var(--ink2);margin:0 4px 4px 0;white-space:nowrap}
.pill.P1{background:var(--p1);color:#fff}.pill.P2{background:var(--p2);color:#fff}.pill.P3{background:var(--p3);color:#fff}
.pill.area{background:var(--ink);color:#fff}.pill.ev{background:#fff;border:1px solid var(--line)}
.finding{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:12px 0;break-inside:avoid}
.finding header{display:flex;gap:10px;align-items:baseline}.finding h3{margin:0;font-size:17px}
.fid{font:700 12px/1 ui-monospace,monospace;color:var(--muted);white-space:nowrap}
.ranked td:first-child,.plan td:nth-child(2) a{white-space:nowrap}
.chips{margin:8px 0 4px}.lever{font-size:12px;color:var(--muted);margin-right:10px}
.finding figure{margin:12px 0}.finding img{width:100%;border-radius:8px;border:1px solid var(--line)}
figcaption{font-size:12px;color:var(--muted);margin-top:4px}
.finding dl{margin:8px 0 0;display:grid;grid-template-columns:150px 1fr;gap:6px 16px}
.finding dt{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-top:2px}
.finding dd{margin:0}.steps{margin:0;padding-left:20px}.steps li{margin:3px 0}
.tip{margin:8px 0 0;padding:8px 12px;background:#F2F6FF;border-radius:8px;font-size:13.5px}
.finding.compact dl{grid-template-columns:150px 1fr}
.group{margin-top:26px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.heat-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr);gap:16px;align-items:start}
.heat-grid img,.heat figure img{width:100%;border-radius:10px;border:1px solid var(--line)}
.heat figure{margin:0 0 12px}
.psi-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.psi h3{margin-top:0}
.scores{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.score{flex:1;min-width:80px;text-align:center;border-radius:12px;padding:10px 6px;background:var(--paper);border:2px solid var(--line)}
.score b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.score span{font-size:11px;color:var(--muted)}
.score.good{border-color:var(--good);color:var(--good)}.score.ok{border-color:var(--ok);color:var(--ok)}.score.bad{border-color:var(--bad);color:var(--bad)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:var(--muted)}.dot.good{background:var(--good)}.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
.serp{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 18px;max-width:640px;font-family:Arial,sans-serif}
.serp-url{font-size:13px;color:#202124}.serp-title{font-size:20px;color:#1a0dab;margin:4px 0}.serp-desc{font-size:14px;color:#4d5156;line-height:1.5}
.ok{color:var(--good);font-weight:700}.no{color:var(--bad);font-weight:700}
.st{font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:#ECEAE3}
.st.pass{background:#DDF3E9;color:var(--good)}.st.weak{background:#FFF0D6;color:var(--ok)}.st.missing{background:#FBE1DC;color:var(--bad)}
.strengths li,.quick li{margin:6px 0}
.method{border-top:1px solid var(--line);padding-top:24px;font-size:14px;color:var(--ink2)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;color:var(--muted);font-size:13px}
.simple{margin:8px 0 4px;padding:8px 12px;background:#FFF4EC;border-radius:8px;font-size:15px}
.small{font-size:12.5px}
.ui-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:14px}
.ui-card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 16px;break-inside:avoid}
.ui-card h3{margin:4px 0 4px;font-size:14px}
.btn-list{display:grid;gap:8px}.btn-item{display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;font-size:13px}
.btn-item img{max-width:120px;max-height:56px;border-radius:6px;border:1px solid var(--line);object-fit:contain;background:#fff}
.swatch{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.15);vertical-align:-2px;margin-right:4px}
.swatches .swatch{width:26px;height:26px;margin:0 4px 4px 0}
.chip-size{display:inline-block;padding:2px 8px;border-radius:999px;background:#ECEAE3;font-size:12px;margin:0 4px 4px 0}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{margin:4px 0}
.gl{display:grid;grid-template-columns:200px 1fr;gap:6px 16px}.gl dt{font-weight:700}.gl dd{margin:0;color:var(--ink2)}
.pages td:first-child{max-width:320px}
.site-issue{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0;break-inside:avoid}
.site-issue h3{margin:0 0 4px;font-size:16px}.affected{font-size:12.5px;color:var(--muted)}
.page-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid var(--line);padding-bottom:10px;margin-bottom:12px}
.page-head h2{margin:0}.page-shot{float:right;width:190px;margin:0 0 10px 16px;border:1px solid var(--line);border-radius:10px}
@page{size:A4;margin:14mm 12mm 16mm}
@page{@bottom-right{content:counter(page) " / " counter(pages);font:11px system-ui,sans-serif;color:#6A7186}}
@media print{
  body{background:#fff;font-size:12.5px}.doc{max-width:none;padding:0}
  .cover{min-height:0;height:250mm;break-after:page}.toc{break-after:page}
  section{break-inside:auto}h2{break-after:avoid}h3{break-after:avoid}
  .details{break-before:page}.heat{break-before:page}.site-page{break-before:page}.page-shot{width:150px}.page-heat img{max-height:105mm;width:auto!important}
  tr{break-inside:avoid}
  .finding img{max-height:110mm;width:auto;max-width:100%}
  .heat-grid img{max-height:230mm;width:auto;max-width:100%}
  a{text-decoration:none}
}
@media (max-width:720px){.psi-grid,.heat-grid,.ui-grid{grid-template-columns:1fr}.gl{grid-template-columns:1fr}.finding dl{grid-template-columns:1fr}.toc ol{columns:1}}
`;
