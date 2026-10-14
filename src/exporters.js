// Data exports (no DOM needed): CSV for issue trackers, JSON for structured data.

const CSV_COLUMNS = [
  ['ID', (f) => f.id],
  ['Area', (f) => f.area],
  ['Priority', (f) => f.priority],
  ['Title', (f) => f.title],
  ['Type', (f) => f.type],
  ['Lever', (f) => f.lever],
  ['Evidence', (f) => f.evidence],
  ['Segment', (f) => f.segment],
  ['Status', (f) => f.status],
  ['Observation', (f) => f.observation],
  ['Why it matters', (f) => f.why],
  ['How to fix', (f) => (f.fix || []).map((s, i) => `${i + 1}. ${s}`).join('\n')],
  ['Platform tip', (f) => f.platformTip || ''],
  ['Hypothesis', (f) => f.hypothesis || ''],
  ['Primary metric', (f) => f.metric || ''],
  ['Impact', (f) => f.impact],
  ['Confidence', (f) => f.confidence],
  ['References', (f) => (f.refs || []).map((r) => r.url).join(' ')],
  ['Note', (f) => f.note || ''],
  ['Page', (f, a) => a.url],
];

function cell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(audit) {
  const rows = [CSV_COLUMNS.map(([h]) => h)];
  for (const f of audit.findings.filter((x) => x.include !== false)) rows.push(CSV_COLUMNS.map(([, get]) => get(f, audit)));
  // BOM so Excel opens UTF-8 (₹, quotes) correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function toJSON(audit) {
  const views = {};
  for (const [name, v] of Object.entries(audit.views || {})) {
    if (!v) continue;
    const { shot, overlayShot, ...rest } = v; // screenshots are binary; export them via the HTML report
    const { redactions, salient, ...snap } = rest.snapshot || {};
    views[name] = { ...rest, snapshot: snap };
  }
  return JSON.stringify({
    schema: 'auditlens.audit/1',
    exportedAt: new Date().toISOString(),
    id: audit.id, url: audit.url, title: audit.title, createdAt: audit.createdAt,
    context: audit.context, options: audit.options,
    psi: audit.psi, findings: audit.findings, strengths: audit.strengths,
    checklist: audit.checklist, notes: audit.notes, ai: audit.ai,
    views,
  }, null, 2);
}
