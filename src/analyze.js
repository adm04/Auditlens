// Turns captured snapshots (+ optional PageSpeed results) into findings, strengths,
// attention insights and checklist pre-fills. Pure apart from the inputs, so it can be
// unit-tested in Node with fixture snapshots.

import { croRules, defaultConversion } from './rules/cro.js';
import { seoRules } from './rules/seo.js';
import { speedRules } from './rules/speed.js';
import { uiRules } from './rules/ui.js';
import { applyPlainLanguage } from './rules/plain.js';
import { psiFindings } from './psi.js';
import { computeAttention, attentionInsights } from './heatmap.js';
import { finding, sortFindings, assignIds } from './rules/common.js';
import { prefillChecklist } from './checklists.js';

export function resolveContext(audit) {
  const D = audit.views.desktop.snapshot;
  const ctx = audit.context || {};
  const pageType = ctx.pageType || (audit.options?.pageType && audit.options.pageType !== 'auto' ? audit.options.pageType : D.pageType);
  const businessModel = ctx.businessModel || D.businessModel;
  const conversion = ctx.conversion || (audit.options?.conversion && audit.options.conversion !== 'auto' ? audit.options.conversion : defaultConversion(businessModel, pageType));
  return { pageType, businessModel, conversion, platform: ctx.platform ?? D.platform };
}

export function attentionFor(view) {
  if (!view?.snapshot) return null;
  const s = view.snapshot;
  const att = computeAttention(s.salient || [], {
    pageW: s.viewport.w,
    pageH: view.shotMeta?.cssHeight || s.pageHeight,
    viewportH: s.viewport.h,
  });
  return { att, insights: attentionInsights(att, s) };
}

function heatmapFindings(audit, context) {
  const out = [];
  for (const name of ['mobile', 'desktop']) {
    const view = audit.views[name];
    if (!view) continue;
    const { insights } = attentionFor(view);
    if (insights.primaryCta && insights.primaryCtaRank && insights.primaryCtaRank > 5) {
      out.push(finding({
        ruleId: `heat.cta-attention-${name}`, area: 'CRO', lever: 'Clarity',
        title: `Primary CTA may not draw the eye (${name})`,
        observation: `In the predicted attention map, ${`“${insights.primaryCta}”`} ranks #${insights.primaryCtaRank} among first-screen elements; images and headings around it are predicted to pull attention first.`,
        why: 'If the button doesn’t stand out from nearby visuals, visitors who are ready to act take longer to find it.',
        fix: [
          'Increase the button’s visual weight: stronger accent colour, larger size, more white space around it.',
          'Reduce competing elements next to it (busy imagery, secondary buttons).',
          'Validate with a real heatmap (Microsoft Clarity is free) before redesigning.',
        ],
        evidence: 'HYPOTHESIS', priority: 'P2', type: 'A/B test', segment: name === 'mobile' ? 'Mobile' : 'Desktop',
        hypothesis: 'If the primary CTA is the most visually prominent element on the first screen, more visitors will click it.',
        metric: 'Primary CTA clicks that lead to a conversion',
      }));
    }
    break; // one view is enough (mobile preferred)
  }
  return out;
}

/** Full analysis. Keeps manual findings and auditor edits when re-run. */
export function analyze(audit) {
  const D = audit.views.desktop.snapshot;
  const M = audit.views.mobile?.snapshot || null;
  const context = resolveContext(audit);
  const input = { desktop: D, mobile: M, context };

  const parts = [croRules(input), uiRules(input), seoRules(input), speedRules(input), psiFindings(audit.psi || {}, context)];
  let generated = parts.flatMap((p) => p.findings).concat(heatmapFindings(audit, context));

  // If PageSpeed measured real speed, drop overlapping local speed estimates.
  if ((audit.psi?.mobile || audit.psi?.desktop) && generated.some((f) => f.source === 'psi' && f.area === 'Speed')) {
    generated = generated.filter((f) => !['speed.lcp-local', 'speed.cls-local'].includes(f.ruleId));
  }

  // Preserve auditor edits for findings that still apply; keep manual ones.
  const previous = new Map((audit.findings || []).filter((f) => f.source !== 'manual').map((f) => [f.ruleId, f]));
  const merged = generated.map((f) => {
    const old = previous.get(f.ruleId);
    return old?.edited ? { ...f, ...old, observation: old.observation ?? f.observation } : old ? { ...f, status: old.status, include: old.include, note: old.note, priority: old.priority, type: old.type } : f;
  });
  const manual = (audit.findings || []).filter((f) => f.source === 'manual');

  const findings = assignIds(sortFindings(applyPlainLanguage([...merged, ...manual])));
  const strengths = parts.flatMap((p) => p.strengths);
  const checklist = prefillChecklist(context.pageType, M || D, audit.checklist);
  return { context, findings, strengths, checklist };
}

export function counts(findings) {
  const list = findings.filter((f) => f.include !== false);
  const by = (k, v) => list.filter((f) => f[k] === v).length;
  return {
    total: list.length,
    P1: by('priority', 'P1'), P2: by('priority', 'P2'), P3: by('priority', 'P3'),
    CRO: by('area', 'CRO'), UI: by('area', 'UI'), SEO: by('area', 'SEO'), Speed: by('area', 'Speed'), Accessibility: by('area', 'Accessibility'),
    quickWins: by('type', 'Quick win'), tests: by('type', 'A/B test'),
    open: list.filter((f) => f.status === 'open' || f.status === 'progress').length,
  };
}

// ---- Site level (multi-page audits) ---------------------------------------------

/**
 * Groups findings across pages. A rule that fires on 2+ pages is a "site-wide" issue:
 * fix it once in the template/theme instead of page by page.
 */
export function siteSummary(audits) {
  const byRule = new Map();
  for (const a of audits) {
    for (const f of a.findings || []) {
      if (f.include === false || f.source === 'manual') continue;
      if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, { ruleId: f.ruleId, title: f.title, simple: f.simple, area: f.area, lever: f.lever, priority: f.priority, type: f.type, fix: f.fix, platformTip: f.platformTip, why: f.why, pages: [] });
      const g = byRule.get(f.ruleId);
      g.pages.push({ auditId: a.id, url: a.url, title: a.title, findingId: f.id });
      if (f.priority < g.priority) g.priority = f.priority; // P1 < P2 lexically
    }
  }
  const order = { P1: 0, P2: 1, P3: 2 };
  const siteWide = [...byRule.values()].filter((g) => g.pages.length >= 2)
    .sort((a, b) => (b.pages.length - a.pages.length) || (order[a.priority] - order[b.priority]));
  const pages = audits.map((a) => {
    const c = counts(a.findings || []);
    const main = a.psi?.mobile || a.psi?.desktop;
    return { id: a.id, url: a.url, title: a.title, pageType: a.context?.pageType, counts: c, speed: main?.scores?.performance ?? null, status: a.status };
  });
  const total = pages.reduce((n, p) => n + p.counts.total, 0);
  const P1 = pages.reduce((n, p) => n + p.counts.P1, 0);
  return { siteWide, pages, total, P1, pageCount: audits.length };
}
