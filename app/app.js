// AuditLens workspace: runs analysis + PageSpeed after capture, and lets the auditor review,
// edit, and export the audit. Everything stays local except the PageSpeed URL request and
// optional AI text requests (both disclosed in the UI).

import { getAudit, putAudit, deleteAudit, listAudits, uid, getSite, putSite, deleteSite, listSites } from '../src/db.js';
import { analyze, counts, attentionFor, siteSummary } from '../src/analyze.js';
import { fetchPSI, parsePSI, canUsePSI } from '../src/psi.js';
import { renderHeatmap } from '../src/heatmap.js';
import { buildReport, autoVerdict, buildSiteReport, autoSiteVerdict } from '../src/report.js';
import { toCSV, toJSON } from '../src/exporters.js';
import { checklistFor } from '../src/checklists.js';
import { getSettings, saveSettings } from '../src/settings.js';
import { getEntitlement, setPlanForTesting, openBillingPortal, DEV_MODE } from '../src/entitlements.js';
import { getSession, signOut } from '../src/auth.js';
import { renderAuth, renderUpgrade } from '../src/ui/account-ui.js';
import { PLANS, CONFIG } from '../src/config.js';
import { PROVIDERS, getAIConfig, saveAIConfig, hasKey, testConnection } from '../src/ai.js';
import { suggestCopy, writeVerdict } from '../src/ai-audit.js';
import { PAGE_TYPES, BUSINESS_MODELS, CONVERSIONS, LEVERS, EVIDENCE, AREA_LABELS } from '../src/rules/common.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  audit: null,
  session: null,
  ent: null,
  site: null,        // open multi-page site record
  siteAudits: [],    // its page audits
  sites: [],
  sitePSI: { running: false, done: 0, total: 0 },
  list: [],
  settings: null,
  pro: false,
  ai: null,
  tab: 'overview',
  bitmaps: {},       // view -> ImageBitmap
  heat: {},          // view -> { canvas, att, insights, opacity }
  att: {},           // view -> { att, insights } (memoised attention model)
  crops: new Map(),  // key -> dataURL
  expanded: new Set(),
  filters: { area: '', priority: '', status: '', type: '', q: '' },
  heatView: 'mobile',
  heatOpacity: 0.62,
  psiRunning: false,
  aiBusy: false,
};

// ---- DOM helpers -------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

/** append() that skips null/false placeholders (append(null) would print the text “null”). */
function appendKids(parent, ...kids) {
  parent.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
}

function debounce(fn, ms = 400) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function slug(s) {
  return String(s || 'audit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'audit';
}

function printHtml(html) {
  return new Promise((resolve) => {
    const frame = $('printFrame');
    frame.onload = () => setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); resolve(); }, 500);
    frame.srcdoc = html;
  });
}

const saveSoon = debounce(() => saveNow(), 500);
async function saveNow() {
  if (!state.audit) return;
  try {
    await putAudit(state.audit);
  } catch (err) {
    console.error(err);
    toast('Couldn’t save changes (storage error). Free up disk space and try again.', 6000);
  }
}

const scoreClass = (v) => (v == null ? '' : v >= 90 ? 'good' : v >= 50 ? 'ok' : 'bad');
const KIND = { cta: 'Button', heading: 'Heading', image: 'Image', video: 'Video', logo: 'Logo', input: 'Form field', text: 'Text' };
const STATUS = { open: 'Open', progress: 'In progress', fixed: 'Fixed', wontfix: 'Won’t fix' };

// ---- Sidebar -------------------------------------------------------------------

async function refreshList() {
  state.list = await listAudits();
  state.sites = await listSites();
  const ul = $('auditList');
  ul.innerHTML = '';
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const pageLabel = (a) => { try { const u = new URL(a.url); return u.pathname === '/' ? 'Homepage' : u.pathname; } catch { return a.url; } };
  const items = [
    ...state.sites.map((x) => ({ kind: 'site', t: x.createdAt, x })),
    ...state.list.filter((a) => !a.siteId).map((x) => ({ kind: 'page', t: x.createdAt, x })),
  ].sort((p, q) => q.t - p.t);
  if (!items.length) { ul.append(h('li', { class: 'none', text: 'No audits yet' })); return; }
  for (const it of items) {
    if (it.kind === 'site') {
      const site = it.x;
      const activeSite = state.site?.id === site.id;
      ul.append(h('li', { class: 'site-entry' }, h('button', {
        type: 'button', class: activeSite && !state.audit ? 'active' : '', title: site.host, onclick: () => openSite(site.id),
      }, h('span', { class: 't', text: site.host }), h('span', { class: 'd', text: `${fmtDate(site.createdAt)} · ${site.pageIds.length} pages` }))));
      if (activeSite || state.audit?.siteId === site.id) {
        for (const pid of site.pageIds) {
          const a = state.list.find((x) => x.id === pid);
          if (!a) continue;
          ul.append(h('li', { class: 'sub' }, h('button', {
            type: 'button', class: state.audit?.id === a.id ? 'active' : '', title: a.url, onclick: () => openAudit(a.id),
          }, h('span', { class: 't', text: pageLabel(a) }), h('span', { class: 'd', text: `${a.openCount} open` }))));
        }
      }
    } else {
      const a = it.x;
      let label = a.url;
      try { const u = new URL(a.url); label = u.host + (u.pathname === '/' ? '' : u.pathname); } catch { /* keep */ }
      ul.append(h('li', {}, h('button', {
        type: 'button', class: state.audit?.id === a.id ? 'active' : '', title: a.url, onclick: () => openAudit(a.id),
      }, h('span', { class: 't', text: label }), h('span', { class: 'd', text: `${fmtDate(a.createdAt)}${a.openCount ? ` · ${a.openCount} open` : ''}` }))));
    }
  }
}

function renderPlan() {
  const box = $('accountBox');
  box.innerHTML = '';
  const e = state.ent || {};
  if (!state.session) {
    box.append(h('span', { class: 'meta', text: 'Not signed in' }), h('button', { class: 'ghost dark', type: 'button', text: 'Sign in', onclick: showAuth }));
    return;
  }
  const left = Math.max(0, (e.limit ?? PLANS.free.auditsPerMonth) - (e.used ?? 0));
  [
    h('span', { class: 'email', text: state.session.user?.email || '' }),
    h('span', { class: 'meta' }, h('span', { class: `plan-badge ${state.pro ? 'pro' : ''}`, text: state.pro ? 'PRO' : 'FREE' }), ' ',
      state.pro
        ? (e.cancel_at_period_end && e.current_period_end ? `Ends ${new Date(e.current_period_end).toLocaleDateString()}` : e.current_period_end ? `Renews ${new Date(e.current_period_end).toLocaleDateString()}` : DEV_MODE ? 'Developer mode' : 'Active')
        : `${left} of ${e.limit ?? PLANS.free.auditsPerMonth} free audits left this month`),
    e.status === 'on_hold' ? h('span', { class: 'meta', style: 'color:#FFB4A1', text: 'Payment failed — update your card to keep Pro.' }) : null,
    h('div', { class: 'row' },
      state.pro
        ? (DEV_MODE ? null : h('button', { class: 'ghost dark', type: 'button', text: 'Manage subscription', onclick: manageBilling }))
        : h('button', { class: 'accent', type: 'button', text: `Upgrade · ${CONFIG.PRO_PRICE_LABEL}/mo`, onclick: () => openUpgrade('') }),
      DEV_MODE ? null : h('button', { class: 'ghost dark', type: 'button', text: 'Sign out', onclick: doSignOut })),
  ].filter(Boolean).forEach((n) => box.append(n));
}

async function refreshPlan(force = false) {
  state.session = await getSession();
  state.ent = state.session ? await getEntitlement({ force }) : null;
  const wasPro = state.pro;
  state.pro = state.ent?.plan === 'pro';
  renderPlan();
  return wasPro !== state.pro;
}

function showAuth() {
  showView('authView');
  renderAuth($('authRoot'), { onSignedIn: () => location.reload() });
}

async function doSignOut() {
  if (!confirm('Sign out of AuditLens? Your saved audits stay on this computer.')) return;
  await signOut();
  location.reload();
}

async function manageBilling() {
  try { await openBillingPortal(); } catch (err) { toast(err.message, 5000); }
}

function openUpgrade(reason) {
  renderUpgrade($('upgradeRoot'), {
    reason,
    onUpgraded: async () => { await refreshPlan(true); $('upgradeDialog').close(); toast('You’re on Pro — everything is unlocked.'); rerenderCurrent(); },
  });
  $('upgradeDialog').showModal();
}

function rerenderCurrent() {
  if (state.audit) renderAudit();
  else if (state.site) renderSite();
}

/** Free plan: only the top N findings are unlocked. */
function unlockedIds(a = state.audit) {
  const list = (a.findings || []).filter((f) => f.include !== false);
  if (state.pro) return new Set(a.findings.map((f) => f.id));
  return new Set(list.slice(0, PLANS.free.findingsShown).map((f) => f.id));
}

function lockedPanel(title, text) {
  return h('div', { class: 'locked-panel' },
    h('span', { class: 'lock-tag', text: 'PRO' }),
    h('h2', { text: title }),
    h('p', { class: 'muted', text }),
    h('button', { class: 'primary', type: 'button', text: `Unlock with Pro · ${CONFIG.PRO_PRICE_LABEL}/${CONFIG.PRO_PERIOD_LABEL}`, onclick: () => openUpgrade('') }));
}

function showView(name) {
  for (const id of ['emptyView', 'statusView', 'auditView', 'siteView', 'authView']) $(id).hidden = id !== name;
}

// ---- Open / analyse ------------------------------------------------------------

async function openAudit(id) {
  const audit = await getAudit(id);
  if (!audit) { showEmpty(); return; }
  state.audit = audit;
  releaseBitmaps(audit.id);
  if (audit.siteId && state.site?.id !== audit.siteId) state.site = await getSite(audit.siteId);
  if (!audit.siteId) state.site = null;
  state.heat = {};
  state.att = {};
  state.crops = new Map();
  state.expanded = new Set();
  history.replaceState(null, '', `?audit=${encodeURIComponent(id)}`);

  if (audit.status === 'capturing') {
    showView('statusView');
    $('statusText').textContent = 'This audit didn’t finish capturing. Delete it and run the audit again.';
    return;
  }
  if (audit.status === 'analyzing' || !audit.findings?.length && audit.status !== 'ready') {
    showView('statusView');
    $('statusText').textContent = 'Analysing the page…';
    try {
      reanalyze();
      audit.status = 'ready';
      await saveNow();
    } catch (err) {
      console.error(err);
      $('statusText').textContent = `Analysis failed: ${err.message}`;
      return;
    }
  }
  if (!audit.views.mobile) state.heatView = 'desktop';
  renderAudit();
  refreshList();

  if (!audit.siteId && audit.options?.psi && !audit.psi?.mobile && !audit.psi?.desktop && !audit.psi?.error && canUsePSI(audit.url)) {
    runPSI();
  }
}

function reanalyze() {
  const r = analyze(state.audit);
  state.audit.context = r.context;
  state.audit.findings = r.findings;
  state.audit.strengths = r.strengths;
  state.audit.checklist = r.checklist;
  state.crops = new Map();
}

async function runPSI() {
  const a = state.audit;
  if (!canUsePSI(a.url)) { toast('PageSpeed only works for public URLs.'); return; }
  state.psiRunning = true;
  rerenderTabs(['overview', 'speed']);
  const key = state.settings.psiKey?.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  const [m, d] = await Promise.allSettled([
    fetchPSI(a.url, 'mobile', key, ctrl.signal),
    fetchPSI(a.url, 'desktop', key, ctrl.signal),
  ]);
  clearTimeout(timer);
  if (state.audit?.id !== a.id) return; // user switched audits
  const psi = { ranAt: Date.now() };
  if (m.status === 'fulfilled') psi.mobile = parsePSI(m.value, 'mobile');
  if (d.status === 'fulfilled') psi.desktop = parsePSI(d.value, 'desktop');
  if (!psi.mobile && !psi.desktop) {
    const err = (m.reason || d.reason);
    psi.error = err?.name === 'AbortError' ? 'PageSpeed took too long. Try again.' : (err?.message || 'PageSpeed failed.');
  }
  a.psi = psi;
  reanalyze();
  state.psiRunning = false;
  await saveNow();
  renderAudit();
  toast(psi.error ? psi.error : 'PageSpeed results added.', psi.error ? 6000 : 3000);
}


// ---- Multi-page sites ----------------------------------------------------------

function analyzeInPlace(a) {
  const r = analyze(a);
  a.context = r.context; a.findings = r.findings; a.strengths = r.strengths; a.checklist = r.checklist;
  a.status = 'ready';
}

async function loadSiteAudits(site) {
  const out = [];
  for (const id of site.pageIds) { const a = await getAudit(id); if (a) out.push(a); }
  return out;
}

async function openSite(id) {
  const site = await getSite(id);
  if (!site) { showEmpty(); return; }
  state.site = site;
  state.audit = null;
  history.replaceState(null, '', `?site=${encodeURIComponent(id)}`);
  showView('statusView');
  $('statusText').textContent = 'Loading pages…';
  state.siteAudits = await loadSiteAudits(site);
  releaseBitmaps('none');
  state.crops = new Map();

  const pending = state.siteAudits.filter((a) => a.status !== 'ready' || !a.findings?.length);
  for (let i = 0; i < pending.length; i++) {
    $('statusText').textContent = `Analysing page ${i + 1} of ${pending.length}…`;
    await new Promise((r) => setTimeout(r, 0));
    try { analyzeInPlace(pending[i]); await putAudit(pending[i]); } catch (err) { console.error(err); }
  }
  if (site.status !== 'ready') { site.status = 'ready'; await putSite(site); }
  renderSite();
  refreshList();

  const needPSI = site.options?.psi && state.siteAudits.some((a) => !a.psi?.mobile && !a.psi?.error && canUsePSI(a.url));
  if (needPSI && !state.sitePSI.running) runSitePSI();
}

/** PageSpeed for every page (mobile only, 2 at a time, to save quota). */
async function runSitePSI() {
  const site = state.site;
  if (!state.pro) { openUpgrade('Site audits are part of Pro.'); return; }
  const todo = state.siteAudits.filter((a) => canUsePSI(a.url) && !a.psi?.mobile);
  if (!todo.length) { toast('PageSpeed already ran for every page.'); return; }
  state.sitePSI = { running: true, done: 0, total: todo.length, errors: 0 };
  renderSiteStatus();
  const key = state.settings.psiKey?.trim();
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      try {
        const json = await fetchPSI(a.url, 'mobile', key);
        a.psi = { ...(a.psi || {}), mobile: parsePSI(json, 'mobile'), ranAt: Date.now(), error: '' };
      } catch (err) {
        a.psi = { ...(a.psi || {}), error: err.message };
        state.sitePSI.errors++;
      }
      analyzeInPlace(a);
      await putAudit(a);
      state.sitePSI.done++;
      if (state.site?.id === site.id && !state.audit) renderSite(); else renderSiteStatus();
    }
  };
  await Promise.all([worker(), worker()]);
  state.sitePSI.running = false;
  if (state.site?.id === site.id && !state.audit) renderSite();
  toast(state.sitePSI.errors ? `PageSpeed finished with ${state.sitePSI.errors} error(s). Add a PageSpeed key in Settings if you hit the quota.` : 'PageSpeed results added for all pages.', 5000);
}

function renderSiteStatus() {
  const st = state.sitePSI;
  if (!$('siteStatus')) return;
  $('siteStatus').textContent = st.running ? `Running PageSpeed: ${st.done} of ${st.total} pages done…` : '';
}

function renderSite() {
  const site = state.site;
  const audits = state.siteAudits;
  const sum = siteSummary(audits);
  showView('siteView');
  $('siteTitle').textContent = site.title || site.host;
  $('siteHost').textContent = `${site.host} · ${sum.pageCount} pages`;
  $('siteDate').textContent = new Date(site.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  renderSiteStatus();
  const root = $('siteBody');
  root.innerHTML = '';
  if (site.errors?.length) root.append(h('p', { class: 'notice', text: `Couldn’t audit ${site.errors.length} page(s): ${site.errors.map((e) => `${e.url} (${e.error})`).join('; ')}` }));

  const speeds = sum.pages.map((p) => p.speed).filter((v) => v != null);
  root.append(h('div', { class: 'cards' },
    h('div', { class: 'card' }, h('h3', { text: 'Pages reviewed' }), h('div', { class: 'big', text: sum.pageCount })),
    h('div', { class: 'card' }, h('h3', { text: 'Improvements' }), h('div', { class: 'big', text: sum.total }), h('p', { class: 'small muted', text: `${sum.P1} to fix first` })),
    h('div', { class: 'card' }, h('h3', { text: 'Site-wide issues' }), h('div', { class: 'big', text: sum.siteWide.length }), h('p', { class: 'small muted', text: 'Fix once in the template, every page improves.' })),
    h('div', { class: 'card' }, h('h3', { text: 'Average speed (mobile)' }), h('div', { class: 'big', text: speeds.length ? Math.round(speeds.reduce((x, y) => x + y, 0) / speeds.length) : '–' }),
      h('p', { class: 'small muted', text: speeds.length ? `PageSpeed for ${speeds.length} of ${sum.pageCount} pages` : 'PageSpeed not run yet (More → Run PageSpeed).' })),
  ));

  const verdict = h('textarea', { class: 'verdict', 'aria-label': 'Site summary', placeholder: autoSiteVerdict(site, sum) });
  verdict.value = site.verdict || '';
  verdict.addEventListener('input', () => { site.verdict = verdict.value; saveSiteSoon(); });

  const pagesTable = h('table', { class: 'compact' }, h('tr', {}, [['Page', ''], ['P1', 'Fix first'], ['P2', 'Next'], ['P3', 'Polish'], ['Speed', 'Mobile PageSpeed score']].map(([t, title]) => h('th', { text: t, title }))),
    sum.pages.map((p) => h('tr', { class: 'page-row', tabindex: '0', onclick: () => openAudit(p.id), onkeydown: (e) => { if (e.key === 'Enter') openAudit(p.id); } },
      h('td', {}, h('strong', { text: p.title || p.url }), h('span', { class: 'small muted', text: `${PAGE_TYPES[p.pageType] || ''} · ${(() => { try { return new URL(p.url).pathname; } catch { return p.url; } })()}` })),
      h('td', {}, h('span', { class: 'pill P1', text: p.counts.P1 })), h('td', {}, h('span', { class: 'pill P2', text: p.counts.P2 })), h('td', {}, h('span', { class: 'pill P3', text: p.counts.P3 })),
      h('td', { text: p.speed ?? (state.sitePSI.running ? '…' : '–') }))));

  const issues = sum.siteWide.slice(0, 25).map((g) => h('div', { class: 'site-issue' },
    h('div', { class: 'row' }, h('span', { class: `pill ${g.priority}`, text: g.priority }), h('span', { class: 'pill area', text: AREA_LABELS[g.area] || g.area }), h('span', { class: 'pill', text: g.type }), h('span', { class: 'pill', text: `${g.pages.length} of ${sum.pageCount} pages` })),
    h('h3', { text: g.title }),
    g.simple ? h('p', { class: 'simple' }, h('strong', { text: 'In simple words: ' }), g.simple) : null,
    h('details', {}, h('summary', { text: 'What to do' }), h('p', { class: 'small', text: g.why }), h('ol', {}, (g.fix || []).map((x) => h('li', { text: x }))), g.platformTip ? h('p', { class: 'tip', text: g.platformTip }) : null),
    h('div', { class: 'pages-hit' }, h('span', { class: 'small muted', text: 'Found on:' }), g.pages.map((pg) => h('button', { type: 'button', text: pg.title || pg.url, onclick: () => { openAudit(pg.auditId).then(() => goToFinding(pg.findingId)); } }))),
  ));

  const notes = h('textarea', { class: 'verdict', 'aria-label': 'Site notes', placeholder: 'Notes for the whole site (included in the report)…' });
  notes.value = site.notes || '';
  notes.addEventListener('input', () => { site.notes = notes.value; saveSiteSoon(); });

  root.append(h('div', { class: 'split' },
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', { text: 'Summary (top of the report)' }), verdict, h('p', { class: 'small muted', text: 'Leave empty to use the automatic summary shown in grey.' })),
      h('h2', { text: 'Fix once, improve every page', style: 'margin:8px 0 0;font-size:18px' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'These issues show up on several pages — they usually come from the shared template or theme.' }),
      issues.length ? issues : h('p', { class: 'muted', text: 'No issue repeats across pages.' }),
    ),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', { text: 'Pages (click to open)' }), pagesTable),
      h('div', { class: 'card' }, h('h3', { text: 'Notes' }), notes),
    ),
  ));
}

const saveSiteSoon = debounce(() => state.site && putSite(state.site), 500);

async function siteReportHtml(progress) {
  const site = state.site;
  const audits = state.siteAudits;
  const sum = siteSummary(audits);
  const siteWideIds = new Set(sum.siteWide.map((g) => g.ruleId));
  const images = {};
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    progress?.(`Preparing page ${i + 1} of ${audits.length}…`);
    const img = { crops: {} };
    img.shot = await firstScreen(a, 380).catch(() => null);
    for (const f of a.findings.filter((x) => x.include !== false && x.priority !== 'P3' && !siteWideIds.has(x.ruleId))) {
      const url = await cropFor(f, a).catch(() => null);
      if (url) img.crops[f.id] = url;
    }
    if ((site.reportSections || {}).heatmap !== false) img.heat = await heatImage(a, a.views.mobile ? 'mobile' : 'desktop', 420).catch(() => null);
    if (i === 0) img.buttons = await buttonImages(a);
    images[a.id] = img;
    releaseBitmaps('none');
  }
  return buildSiteReport(site, audits, { settings: state.settings, pro: state.pro, images, sections: site.reportSections || {} });
}

async function doSiteExport(kind) {
  const site = state.site;
  if (!state.pro) { openUpgrade('Site reports are part of Pro.'); return; }
  const name = slug(`${site.host}-site-audit-${new Date(site.createdAt).toISOString().slice(0, 10)}`);
  try {
    if (kind === 'csv') {
      const parts = state.siteAudits.map((a, i) => toCSV(a).replace(/^﻿/, '').split('\r\n').slice(i === 0 ? 0 : 1).join('\r\n')).filter(Boolean);
      download(new Blob(['﻿' + parts.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
      toast('CSV downloaded');
      return;
    }
    toast('Preparing site report…', 0);
    const html = await siteReportHtml((m) => toast(m, 0));
    if (kind === 'html') { download(new Blob([html], { type: 'text/html' }), `${name}.html`); toast('Site report downloaded'); }
    else { toast('Choose “Save as PDF” in the print dialog'); await printHtml(html); }
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, 6000);
  }
}

// ---- Images (screenshots, crops, heatmaps) ---------------------------------------------

function attFor(view) {
  if (!state.att[view]) state.att[view] = attentionFor(state.audit.views[view]);
  return state.att[view];
}

async function bitmapFor(view, a = state.audit) {
  const key = `${a.id}:${view}`;
  if (state.bitmaps[key]) return state.bitmaps[key];
  const shot = a.views[view]?.shot;
  if (!shot) return null;
  state.bitmaps[key] = await createImageBitmap(shot);
  return state.bitmaps[key];
}

function releaseBitmaps(keepId) {
  for (const [k, bmp] of Object.entries(state.bitmaps)) {
    if (!k.startsWith(`${keepId}:`)) { bmp.close?.(); delete state.bitmaps[k]; }
  }
}

function cropSpec(f, a = state.audit) {
  const views = a.views;
  if (f.element?.rect && views[f.element.view]) return { view: f.element.view, rect: f.element.rect, box: true };
  if (/^(cro\.(fold|popup|cookie)|heat\.)/.test(f.ruleId || '')) {
    const view = f.segment === 'Mobile' && views.mobile ? 'mobile' : f.segment === 'Desktop' || !views.mobile ? 'desktop' : 'mobile';
    const meta = views[view].shotMeta;
    return { view, rect: { x: 0, y: 0, w: meta.cssWidth, h: meta.viewportHeight }, box: false };
  }
  return null;
}

/** Crop a region of a page screenshot. mode 'context' = element with surroundings + box; 'tight' = element only; 'screen' = rect as-is. */
async function cropRect(a, view, r, { mode = 'context', maxW = 900 } = {}) {
  const key = `${a.id}:${view}:${mode}:${r.x},${r.y},${r.w},${r.h}:${maxW}`;
  if (state.crops.has(key)) return state.crops.get(key);
  const bmp = await bitmapFor(view, a);
  if (!bmp) return null;
  const meta = a.views[view].shotMeta;
  const k = meta.k;
  let x0, y0, x1, y1;
  if (mode === 'context') {
    const padX = Math.max(160, (600 - r.w) / 2), padY = 140;
    x0 = Math.max(0, r.x - padX); x1 = Math.min(meta.cssWidth, r.x + r.w + padX);
    y0 = Math.max(0, r.y - padY); y1 = Math.min(meta.cssHeight, r.y + r.h + padY);
    if (meta.cssWidth <= 480) { x0 = 0; x1 = meta.cssWidth; }
  } else if (mode === 'tight') {
    x0 = Math.max(0, r.x - 8); x1 = Math.min(meta.cssWidth, r.x + r.w + 8);
    y0 = Math.max(0, r.y - 8); y1 = Math.min(meta.cssHeight, r.y + r.h + 8);
  } else {
    x0 = Math.max(0, r.x); y0 = Math.max(0, r.y); x1 = Math.min(meta.cssWidth, r.x + r.w); y1 = Math.min(meta.cssHeight, r.y + r.h);
  }
  const sw = (x1 - x0) * k, sh = (y1 - y0) * k;
  if (sw < 4 || sh < 4 || y0 * k > bmp.height) return null;
  const scale = Math.min(1, maxW / sw);
  const c = h('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, x0 * k, y0 * k, sw, sh, 0, 0, c.width, c.height);
  if (mode === 'context') {
    const sc = k * scale;
    ctx.strokeStyle = '#FF6B3D';
    ctx.lineWidth = Math.max(3, 3 * sc);
    ctx.fillStyle = 'rgba(255,107,61,0.12)';
    ctx.beginPath();
    ctx.roundRect((r.x - x0 - 6) * sc, (r.y - y0 - 6) * sc, (r.w + 12) * sc, (r.h + 12) * sc, 8 * sc);
    ctx.fill(); ctx.stroke();
  }
  const url = c.toDataURL('image/jpeg', 0.84);
  state.crops.set(key, url);
  return url;
}

async function cropFor(f, a = state.audit) {
  if (f.ruleId === 'cro.popup-at-load') {
    const view = f.segment === 'Mobile' ? 'mobile' : 'desktop';
    const blob = a.views[view]?.overlayShot || a.views.desktop.overlayShot;
    if (blob) {
      const key = `${a.id}:overlay:${view}`;
      if (!state.crops.has(key)) state.crops.set(key, await blobToDataUrl(blob));
      return state.crops.get(key);
    }
  }
  const spec = cropSpec(f, a);
  if (!spec) return null;
  return cropRect(a, spec.view, spec.rect, { mode: spec.box ? 'context' : 'screen' });
}

/** First screen of a page (mobile if captured), for thumbnails. */
async function firstScreen(a, maxW = 420) {
  const view = a.views.mobile ? 'mobile' : 'desktop';
  const meta = a.views[view].shotMeta;
  return cropRect(a, view, { x: 0, y: 0, w: meta.cssWidth, h: meta.viewportHeight }, { mode: 'screen', maxW });
}

async function heatImage(a, view, maxW) {
  const v = a.views[view];
  if (!v?.shot) return null;
  const bmp = await bitmapFor(view, a);
  const { att } = attentionFor(v);
  const canvas = renderHeatmap(bmp, att, { k: v.shotMeta.k, viewportHeight: v.shotMeta.viewportHeight }, { opacity: 0.62 });
  return canvasToDataUrl(canvas, maxW);
}

async function buttonImages(a) {
  const styles = a.views.desktop.snapshot.ui?.buttonStyles || [];
  const out = [];
  for (const b of styles.slice(0, 10)) out.push(await cropRect(a, 'desktop', b.rect, { mode: 'tight', maxW: 260 }).catch(() => null));
  return out;
}

async function heatFor(view) {
  const cached = state.heat[view];
  if (cached && cached.opacity === state.heatOpacity) return cached;
  const v = state.audit.views[view];
  if (!v?.shot) return null;
  const bmp = await bitmapFor(view);
  const { att, insights } = attFor(view);
  const canvas = renderHeatmap(bmp, att, { k: v.shotMeta.k, viewportHeight: v.shotMeta.viewportHeight }, { opacity: state.heatOpacity });
  state.heat[view] = { canvas, att, insights, opacity: state.heatOpacity };
  return state.heat[view];
}

function canvasToDataUrl(canvas, maxW = 1000) {
  const scale = Math.min(1, maxW / canvas.width);
  if (scale === 1) return canvas.toDataURL('image/jpeg', 0.8);
  const c = h('canvas');
  c.width = Math.round(canvas.width * scale); c.height = Math.round(canvas.height * scale);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---- Render: frame -------------------------------------------------------------

function fillSelect(sel, options, value) {
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(options)) sel.append(h('option', { value: k, text: v }));
  sel.value = value;
}

function renderAudit() {
  const a = state.audit;
  showView('auditView');
  $('backToSite').hidden = !state.site;
  if (state.site) $('backBtn').textContent = `← ${state.site.host} · all ${state.site.pageIds.length} pages`;
  $('auditTitle').textContent = a.title || a.url;
  $('auditUrl').textContent = a.url;
  $('auditUrl').href = a.url;
  $('auditDate').textContent = new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  fillSelect($('ctxPageType'), PAGE_TYPES, a.context.pageType);
  fillSelect($('ctxBusiness'), BUSINESS_MODELS, a.context.businessModel);
  fillSelect($('ctxConversion'), CONVERSIONS, a.context.conversion);
  $('ctxPlatform').textContent = a.context.platform ? `Built with ${a.context.platform}` : '';
  $('ctxPlatform').hidden = !a.context.platform;
  $('findCount').textContent = counts(a.findings).total;
  selectTab(state.tab, false);
}

function rerenderTabs(names) {
  for (const n of names) if (state.tab === n) renderTab(n);
}

function selectTab(name, focus = true) {
  state.tab = name;
  for (const b of document.querySelectorAll('.tabs [role="tab"]')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
  for (const p of document.querySelectorAll('.tab')) p.hidden = p.id !== `tab-${name}`;
  renderTab(name);
}

function renderTab(name) {
  const fn = { overview: renderOverview, findings: renderFindings, ui: renderUI, heatmap: renderHeat, speed: renderSpeed, seo: renderSEO, checklist: renderChecklist, report: renderReportTab }[name];
  fn?.();
}

function goToFinding(id) {
  state.expanded.add(id);
  state.filters = { area: '', priority: '', status: '', type: '', q: '' };
  selectTab('findings');
  requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ---- Overview ------------------------------------------------------------------

function psiStatusNode() {
  const a = state.audit;
  if (state.psiRunning) return h('p', { class: 'inline-status' }, h('span', { class: 'spinner', style: 'width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px;border-width:2px' }), 'Running PageSpeed Insights (up to a minute)…');
  if (a.psi?.error) return h('div', {}, h('p', { class: 'inline-status', text: a.psi.error }), h('button', { class: 'ghost small', type: 'button', onclick: runPSI, text: 'Try again' }));
  if (!canUsePSI(a.url)) return h('p', { class: 'inline-status', text: 'Not available: PageSpeed needs a public URL.' });
  return h('button', { class: 'ghost small', type: 'button', onclick: runPSI, text: 'Run PageSpeed Insights' });
}

function scoresNode(p) {
  const cats = [['performance', 'Performance'], ['accessibility', 'Accessibility'], ['best-practices', 'Best practices'], ['seo', 'SEO']];
  return h('div', { class: 'score-row' }, cats.map(([k, l]) => h('div', { class: `score ${scoreClass(p.scores[k])}` }, h('b', { text: p.scores[k] ?? '–' }), h('span', { text: l }))));
}

function renderOverview() {
  const a = state.audit;
  const c = counts(a.findings);
  const root = $('tab-overview');
  root.innerHTML = '';

  if (a.mobileError) root.append(h('p', { class: 'notice', text: `The mobile view couldn’t be captured (${a.mobileError}). Desktop results are complete.` }));
  if (a.views.desktop.shotMeta?.truncated) root.append(h('p', { class: 'notice info', text: `This page is long, so screenshots cover the first ${a.views.desktop.shotMeta.screens} screens. Page checks still cover the whole page.` }));

  const main = a.psi?.mobile || a.psi?.desktop;
  const heatView = a.views.mobile ? 'mobile' : 'desktop';
  const ins = attFor(heatView).insights;

  root.append(h('div', { class: 'cards' },
    h('div', { class: 'card' }, h('h3', { text: 'Priorities' }),
      h('div', { class: 'prio-row' },
        h('div', { class: 'P1' }, h('b', { text: c.P1 }), h('span', { text: 'Fix first' })),
        h('div', { class: 'P2' }, h('b', { text: c.P2 }), h('span', { text: 'Next' })),
        h('div', { class: 'P3' }, h('b', { text: c.P3 }), h('span', { text: 'Polish' }))),
      h('p', { class: 'small muted', text: `${c.quickWins} quick wins · ${c.tests} A/B tests · ${c.open} open` })),
    h('div', { class: 'card' }, h('h3', { text: 'By area' }),
      h('div', { class: 'prio-row' }, [['CRO', 'Conversion'], ['UI', 'UI'], ['Speed', 'Speed'], ['SEO', 'SEO'], ['Accessibility', 'A11y']].map(([k, l]) => h('div', {}, h('b', { text: c[k] }), h('span', { text: l }))))),
    h('div', { class: 'card' }, h('h3', { text: `PageSpeed${main ? ` · ${main.strategy}` : ''}` }), main ? scoresNode(main) : psiStatusNode(),
      main ? h('p', { class: 'small muted' }, (main.field ? 'Includes real-visitor data. ' : 'No real-visitor data yet. '), h('button', { class: 'linkish small', type: 'button', onclick: () => selectTab('speed'), text: 'Details' })) : null),
    h('div', { class: 'card' }, h('h3', { text: 'Predicted attention' }),
      h('div', { class: 'big', text: `${ins.firstScreenShare}%` }),
      h('p', { class: 'small muted', text: `of predicted attention on the first ${heatView} screen. ${ins.primaryCta ? `Main button “${ins.primaryCta}” ranks #${ins.primaryCtaRank ?? '>12'}.` : 'No main button on the first screen.'}` }),
      h('button', { class: 'linkish small', type: 'button', onclick: () => selectTab('heatmap'), text: 'View heatmap' })),
  ));

  // Verdict + leaks | strengths
  const verdict = h('textarea', { class: 'verdict', 'aria-label': 'Snapshot verdict', placeholder: autoVerdict(a) });
  verdict.value = a.verdict || '';
  verdict.addEventListener('input', () => { a.verdict = verdict.value; saveSoon(); });
  const aiBtn = h('button', { class: 'ghost small', type: 'button', text: 'Write with AI', onclick: async () => {
    if (!(await aiReady())) return;
    aiBtn.disabled = true; aiBtn.textContent = 'Writing…';
    try { a.verdict = await writeVerdict(a); verdict.value = a.verdict; await saveNow(); toast('Summary written. Review and edit it before sharing.'); }
    catch (err) { toast(err.message, 6000); }
    finally { aiBtn.disabled = false; aiBtn.textContent = 'Write with AI'; }
  } });

  const leaks = a.findings.filter((f) => f.include !== false && f.priority === 'P1');
  root.append(h('div', { class: 'split' },
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', { text: 'Snapshot verdict (top of the report)' }), verdict,
        h('div', { class: 'row', style: 'margin-top:8px' }, aiBtn, h('span', { class: 'small muted', text: 'Leave empty to use the automatic summary shown in grey.' }))),
      h('div', { class: 'card' }, h('h3', { text: 'Fix first (P1)' }),
        leaks.length ? h('ol', { class: 'leaks' }, leaks.map((f) => h('li', {}, h('button', { class: 'linkish', type: 'button', onclick: () => goToFinding(f.id), text: f.id }), ` ${f.title} `, h('span', { class: 'muted small', text: `· ${f.area} · ${f.lever}` }))))
          : h('p', { class: 'muted', text: 'No P1 issues. Nice.' })),
    ),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', { text: 'Strengths to amplify' }),
        (a.strengths || []).length ? h('ul', { class: 'strength-list' }, a.strengths.map((s) => h('li', {}, h('strong', { text: s.title }), ' ', h('span', { class: 'muted', text: s.detail })))) : h('p', { class: 'muted', text: 'No clear strengths detected automatically. Add them in the verdict.' })),
      h('div', { class: 'card' }, h('h3', { text: 'Evidence and limits' }),
        h('p', { class: 'small', text: `Desk audit of the live page: desktop (${a.views.desktop.snapshot.viewport.w}px)${a.views.mobile ? ` and mobile (${a.views.mobile.snapshot.viewport.w}px)` : ''}${main ? ', plus PageSpeed Insights' : ''}. No analytics or real heatmaps, so behaviour findings are hypotheses.` }),
        h('p', { class: 'small muted', text: 'Labels: DATA = real measurements · OBSERVED = seen on the page · HEURISTIC = proven pattern missing · HYPOTHESIS = needs testing.' })),
      h('div', { class: 'card' }, h('h3', { text: 'Auditor notes (included in report)' }),
        (() => { const t = h('textarea', { class: 'verdict', 'aria-label': 'Auditor notes', placeholder: 'Context from the client, scope, things to check…' }); t.value = a.notes || ''; t.addEventListener('input', () => { a.notes = t.value; saveSoon(); }); return t; })()),
    ),
  ));
}

// ---- Findings ----------------------------------------------------------------

function filteredFindings() {
  const { area, priority, status, type, q } = state.filters;
  const query = q.trim().toLowerCase();
  return state.audit.findings.filter((f) =>
    (!area || f.area === area) && (!priority || f.priority === priority) && (!status || f.status === status) && (!type || f.type === type) &&
    (!query || `${f.id} ${f.title} ${f.simple || ''} ${f.observation} ${f.lever}`.toLowerCase().includes(query)));
}

function sel(options, value, onchange, label) {
  const s = h('select', { 'aria-label': label });
  for (const [k, v] of Object.entries(options)) s.append(h('option', { value: k, text: v }));
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

function renderFindings() {
  const root = $('tab-findings');
  root.innerHTML = '';
  const f = state.filters;
  const setF = (k) => (v) => { f[k] = v; renderFindingList(); };
  const search = h('input', { type: 'search', placeholder: 'Search findings', 'aria-label': 'Search findings', value: f.q });
  search.addEventListener('input', debounce(() => { f.q = search.value; renderFindingList(); }, 200));

  root.append(h('div', { class: 'filters' },
    sel({ '': 'All areas', CRO: 'Conversion', UI: 'UI design', Speed: 'Speed', SEO: 'SEO', Accessibility: 'Accessibility' }, f.area, setF('area'), 'Area'),
    sel({ '': 'All priorities', P1: 'P1 · Fix first', P2: 'P2 · Next', P3: 'P3 · Polish' }, f.priority, setF('priority'), 'Priority'),
    sel({ '': 'Any status', ...STATUS }, f.status, setF('status'), 'Status'),
    sel({ '': 'Quick wins & tests', 'Quick win': 'Quick wins', 'A/B test': 'A/B tests' }, f.type, setF('type'), 'Type'),
    search,
    h('span', { style: 'flex:1' }),
    h('button', { class: 'ghost', type: 'button', text: '+ Add finding', onclick: addManualFinding }),
  ));
  root.append(h('div', { id: 'findingList', class: 'f-list' }));
  renderFindingList();
}

function renderFindingList() {
  const list = $('findingList');
  if (!list) return;
  list.innerHTML = '';
  const items = filteredFindings();
  if (!items.length) { list.append(h('p', { class: 'muted', text: 'No findings match these filters.' })); return; }
  const lockedN = state.pro ? 0 : state.audit.findings.filter((f) => f.include !== false).length - unlockedIds().size;
  if (lockedN > 0) list.append(h('div', { class: 'unlock-banner' }, h('span', { text: `You’re seeing the top ${PLANS.free.findingsShown} findings. ${lockedN} more are ready — with step-by-step fixes.` }), h('button', { class: 'primary', type: 'button', text: `Unlock all · ${CONFIG.PRO_PRICE_LABEL}/mo`, onclick: () => openUpgrade('') })));
  for (const f of items) list.append(findingCard(f));
}

function markEdited(f) {
  f.edited = true;
  saveSoon();
}

function findingCard(f) {
  if (!state.pro && !unlockedIds().has(f.id)) {
    return h('article', { class: 'locked-card', id: `card-${f.id}`, role: 'button', tabindex: '0', title: 'Unlock with Pro', onclick: () => openUpgrade('See every finding with step-by-step fixes.'), onkeydown: (e) => { if (e.key === 'Enter') openUpgrade('See every finding with step-by-step fixes.'); } },
      h('span', { class: 'fid', text: f.id }), h('span', { class: `pill ${f.priority}`, text: f.priority }),
      h('span', { class: 'f-title', text: f.title }), h('span', { class: 'lock-tag', text: 'PRO' }));
  }
  const open = state.expanded.has(f.id);
  const card = h('article', { class: `f-card ${f.include === false ? 'excluded' : ''}`, id: `card-${f.id}` });
  const head = h('div', { class: 'f-head', tabindex: '0', role: 'button', 'aria-expanded': String(open) },
    h('span', { class: 'fid', text: f.id }),
    h('span', { class: `pill ${f.priority}`, text: f.priority }),
    h('span', { class: 'f-title' }, f.title, f.simple ? h('span', { class: 'f-simple', style: 'display:block', text: f.simple }) : null),
    h('span', { class: 'f-meta' },
      h('span', { class: 'pill area', text: AREA_LABELS[f.area] || f.area }),
      h('span', { class: 'pill', text: f.type }),
      f.segment && f.segment !== 'All' ? h('span', { class: 'pill', text: f.segment }) : null,
      f.status !== 'open' ? h('span', { class: `pill status-${f.status}`, text: STATUS[f.status] }) : null,
      f.source === 'manual' ? h('span', { class: 'pill', text: 'Manual' }) : null),
  );
  const toggle = () => { if (state.expanded.has(f.id)) state.expanded.delete(f.id); else state.expanded.add(f.id); card.replaceWith(findingCard(f)); };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  card.append(head);
  if (!open) return card;

  const text = (label, key, rows = 3) => {
    const t = h('textarea', { rows: String(rows) });
    t.value = Array.isArray(f[key]) ? f[key].join('\n') : (f[key] || '');
    t.addEventListener('input', () => {
      f[key] = key === 'fix' ? t.value.split('\n').map((s) => s.trim()).filter(Boolean) : t.value;
      markEdited(f);
    });
    return h('label', {}, label, t);
  };
  const title = h('input', { type: 'text', value: f.title });
  title.addEventListener('input', () => { f.title = title.value; head.querySelector('.f-title').textContent = f.title; markEdited(f); });

  const reRender = () => { markEdited(f); card.replaceWith(findingCard(f)); $('findCount').textContent = counts(state.audit.findings).total; };
  const pick = (label, key, options) => h('label', {}, label, sel(options, f[key], (v) => { f[key] = v; if (key === 'type' && v === 'A/B test' && !f.hypothesis) f.hypothesis = ''; reRender(); }, label));

  const include = h('input', { type: 'checkbox' });
  include.checked = f.include !== false;
  include.addEventListener('change', () => { f.include = include.checked; reRender(); });

  const fields = h('div', { class: 'fields' },
    h('label', {}, 'Title', title),
    text('In simple words (for the client)', 'simple', 2),
    text('What we found', 'observation'),
    text('Why it matters', 'why'),
    text('What to do (one step per line)', 'fix', 4),
    f.type === 'A/B test' ? text('What to test', 'hypothesis', 2) : null,
    f.type === 'A/B test' ? (() => { const m = h('input', { type: 'text', value: f.metric || '' }); m.addEventListener('input', () => { f.metric = m.value; markEdited(f); }); return h('label', {}, 'Primary metric', m); })() : null,
    text('Auditor note', 'note', 2),
  );

  const side = h('div', { class: 'f-side' });
  const imgSlot = h('div');
  appendKids(side, imgSlot,
    h('div', { class: 'f-grid' },
      pick('Priority', 'priority', { P1: 'P1 · Fix first', P2: 'P2 · Next', P3: 'P3 · Polish' }),
      pick('Status', 'status', STATUS),
      pick('Type', 'type', { 'Quick win': 'Quick win', 'A/B test': 'A/B test' }),
      pick('Area', 'area', { CRO: 'Conversion', UI: 'UI design', Speed: 'Speed', SEO: 'SEO', Accessibility: 'Accessibility' }),
      pick('Focus', 'lever', Object.fromEntries(Object.keys(LEVERS).map((k) => [k, k]))),
      pick('Evidence', 'evidence', Object.fromEntries(Object.keys(EVIDENCE).map((k) => [k, k]))),
      pick('Segment', 'segment', { All: 'All', Mobile: 'Mobile', Desktop: 'Desktop' }),
    ),
    f.platformTip ? h('p', { class: 'tip' }, h('strong', { text: `On ${state.audit.context.platform}: ` }), f.platformTip) : null,
    f.refs?.length ? h('p', { class: 'refs' }, f.refs.slice(0, 3).map((r) => h('a', { href: r.url, target: '_blank', rel: 'noopener', text: `${r.label} ↗` }))) : null,
    h('div', { class: 'f-actions' },
      h('label', { class: 'check' }, include, 'Include in report'),
      f.source === 'manual' ? h('button', { class: 'ghost small danger', type: 'button', text: 'Delete', onclick: () => {
        if (!confirm('Delete this finding?')) return;
        state.audit.findings = state.audit.findings.filter((x) => x !== f);
        saveSoon(); renderFindingList(); $('findCount').textContent = counts(state.audit.findings).total;
      } }) : null),
  );
  cropFor(f).then((url) => { if (url) imgSlot.append(h('img', { src: url, alt: `Evidence for ${f.id}` })); }).catch(() => {});

  card.append(h('div', { class: 'f-body' }, fields, side));
  return card;
}

function addManualFinding() {
  const n = state.audit.findings.filter((f) => f.source === 'manual').length + 1;
  const f = {
    id: `M-${String(n).padStart(2, '0')}`, ruleId: `manual.${uid()}`, source: 'manual', area: 'CRO', title: 'New finding',
    observation: '', why: '', fix: [], lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
    impact: 'M', confidence: 'M', segment: 'All', status: 'open', include: true, note: '', refs: [], edited: true,
  };
  state.audit.findings.unshift(f);
  state.expanded.add(f.id);
  saveSoon();
  state.filters = { area: '', priority: '', status: '', type: '', q: '' };
  renderFindings();
  $('findCount').textContent = counts(state.audit.findings).total;
  requestAnimationFrame(() => document.querySelector(`#card-${f.id} input[type="text"]`)?.select());
}


// ---- UI elements -----------------------------------------------------------------

function verdictLine(ok, good, bad, warn = false) {
  return h('p', { class: ok ? 'verdict-ok' : warn ? 'verdict-warn' : 'verdict-bad', text: ok ? `✓ ${good}` : `${warn ? '!' : '✕'} ${bad}` });
}

async function renderUI() {
  const a = state.audit;
  const root = $('tab-ui');
  root.innerHTML = '';
  if (!state.pro) { root.append(lockedPanel('UI elements review', 'See every button style, font, text size and colour on the page — with screenshots and what “good” looks like.')); return; }
  const u = a.views.desktop.snapshot.ui;
  if (!u) { root.append(h('p', { class: 'muted', text: 'Re-run this audit to get the UI elements review (it was captured with an older version).' })); return; }
  const uiFindings = a.findings.filter((f) => f.area === 'UI');
  root.append(h('p', { class: 'muted', text: 'The building blocks of the page. Consistent buttons, text and colours make a site feel professional and easy to use. Each box says what “good” looks like.' }));

  const btnCard = h('div', { class: 'card' }, h('h3', { text: `Buttons · ${u.buttonStyles.length} style${u.buttonStyles.length === 1 ? '' : 's'}` }),
    verdictLine(u.buttonStyles.length <= 3, 'Consistent — visitors can tell the main action apart.', 'Too many styles — pick one main, one secondary and one text style.', u.buttonStyles.length === 4),
    h('p', { class: 'explain', text: 'Good: one solid main button in your accent colour, one outline secondary button, and a text-link style. Same height and corner shape everywhere.' }));
  const list = h('div');
  btnCard.append(list);
  const imgs = await buttonImages(a);
  u.buttonStyles.forEach((b, i) => list.append(h('div', { class: 'btn-item' },
    imgs[i] ? h('img', { src: imgs[i], alt: `Button “${b.example}”` }) : h('span', { class: 'muted small', text: '(below screenshot)' }),
    h('div', {}, h('strong', { text: `“${b.example}”` }), h('br'),
      h('span', { class: 'small muted' }, `${b.count}× · ${b.height}px tall · ${b.radius >= 100 ? 'pill' : `${b.radius}px corners`} · `, h('span', { class: 'swatch sm', style: `background:${b.bg}` }), b.bg === 'transparent' ? 'outline' : b.bg)))));

  const sizes = u.fontSizes.filter((x) => x.count >= 2);
  const fonts = u.fonts.filter((x) => x.count >= 3);
  const typeCard = h('div', { class: 'card' }, h('h3', { text: 'Typography' }),
    verdictLine(fonts.length <= 2, `${fonts.length} font${fonts.length === 1 ? '' : 's'} — tidy.`, `${fonts.length} fonts — use at most two.`, fonts.length === 3),
    h('ul', { class: 'outline' }, u.fonts.slice(0, 5).map((f) => h('li', {}, h('span', { style: `font-family:'${f.value}',sans-serif;font-size:17px`, text: f.value }), h('span', { class: 'small muted', text: `  used ${f.count}×` })))),
    h('h4', { text: 'Text sizes' }),
    verdictLine(sizes.length <= 8, `${sizes.length} sizes — a clear scale.`, `${sizes.length} sizes — reduce to a set of 5–7.`, sizes.length <= 10),
    h('p', {}, sizes.map((x) => h('span', { class: 'chip-size', text: `${x.value}px` }))),
    h('h4', { text: 'Heading sizes' }),
    h('p', {}, Object.entries(u.headingSizes).map(([k, v]) => h('span', { class: 'chip-size', text: `${k.toUpperCase()} ${v}px` }))),
    h('p', { class: 'explain', text: 'Good: one font for headings, one for body text; each heading level smaller than the one above; body text 16px on mobile with ~1.5 line spacing.' }));

  const colorCard = h('div', { class: 'card' }, h('h3', { text: 'Colours & details' }),
    verdictLine(u.textColors.filter((c) => c.count >= 2).length <= 6, 'Text colours are under control.', 'Lots of slightly different text colours.', true),
    h('p', {}, u.textColors.slice(0, 12).map((c) => h('span', { class: 'swatch', title: `${c.value} · ${c.count}×`, style: `background:${c.value}` }))),
    verdictLine(!u.iconOnly.length, 'Icon buttons have labels.', `${u.iconOnly.length} icon button(s) with no label — people may not know what they do.`),
    verdictLine(u.hiddenLinks < 2, 'Links are easy to spot.', `${u.hiddenLinks} links look like plain text.`),
    verdictLine(!u.distorted.length, 'No stretched images.', `${u.distorted.length} image(s) stretched out of shape.`),
    verdictLine(u.tiny <= 5, 'No tiny text.', `${u.tiny} pieces of text under 12px.`),
    verdictLine((u.fieldHeights || []).length <= 2, 'Form fields are consistent.', `Form fields in ${(u.fieldHeights || []).length} different heights.`),
    h('p', { class: 'explain', text: 'Good: 3–4 text colours (main, secondary, link/accent, white on dark), labelled icons, underlined or coloured links.' }));

  root.append(h('div', { class: 'ui-grid' }, btnCard, typeCard, colorCard));
  root.append(h('h3', { text: `UI findings (${uiFindings.length})` }));
  root.append(uiFindings.length ? h('div', { class: 'f-list' }, uiFindings.map((f) => findingCard(f))) : h('p', { class: 'muted', text: 'No UI issues found.' }));
}

// ---- Heatmap -----------------------------------------------------------------

async function renderHeat() {
  const a = state.audit;
  const root = $('tab-heatmap');
  root.innerHTML = '';
  if (!state.pro) { root.append(lockedPanel('Predicted attention heatmap', 'See where visitors are likely to look first on desktop and mobile, and whether your main button gets noticed.')); return; }
  const views = ['mobile', 'desktop'].filter((v) => a.views[v]);
  if (!views.includes(state.heatView)) state.heatView = views[0];

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, views.map((v) => h('button', {
    type: 'button', 'aria-pressed': String(state.heatView === v), text: v === 'mobile' ? 'Mobile' : 'Desktop',
    onclick: () => { state.heatView = v; renderHeat(); },
  })));
  const opacity = h('input', { type: 'range', min: '0.2', max: '0.9', step: '0.05', value: String(state.heatOpacity), 'aria-label': 'Heat opacity' });
  opacity.addEventListener('change', () => { state.heatOpacity = Number(opacity.value); renderHeat(); });

  const canvasBox = h('div', { class: `heat-canvas ${state.heatView}` }, h('div', { class: 'status', style: 'min-height:200px' }, h('div', { class: 'spinner' }), h('p', { text: 'Rendering heatmap…' })));
  const side = h('div', { class: 'stack' });
  appendKids(root,
    h('p', { class: 'notice' }, h('strong', { text: 'Predicted attention, not real visitor data. ' }), 'Modelled from layout, size, contrast and position using common eye-tracking patterns. Use it to spot likely problems, then confirm with a real heatmap (', h('a', { href: 'https://clarity.microsoft.com', target: '_blank', rel: 'noopener', text: 'Microsoft Clarity is free' }), ').'),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, seg, h('label', { class: 'check' }, 'Heat opacity', opacity)),
    h('div', { class: 'heat-layout' }, canvasBox, side),
  );

  const result = await heatFor(state.heatView);
  canvasBox.innerHTML = '';
  if (!result) { canvasBox.append(h('p', { class: 'muted', text: 'No screenshot for this view.' })); return; }
  canvasBox.append(result.canvas);
  const ins = result.insights;
  appendKids(side,
    h('div', { class: 'card' }, h('h3', { text: 'Scale' }), h('div', { class: 'legend-bar' }), h('div', { class: 'row small muted', style: 'justify-content:space-between;margin-top:4px' }, h('span', { text: 'Less attention' }), h('span', { text: 'More attention' }))),
    h('div', { class: 'card' }, h('h3', { text: 'Attention by screen (predicted)' }),
      h('div', { class: 'bars' }, result.att.screenShare.slice(0, 8).map((v, i) => h('div', { class: 'bar' }, h('span', { text: `Screen ${i + 1}` }), h('i', { style: `width:${Math.max(2, v)}%` }), h('span', { text: `${v}%` }))))),
    h('div', { class: 'card' }, h('h3', { text: 'First screen: what pulls the eye' }),
      h('ol', { class: 'leaks' }, result.att.foldRanking.slice(0, 6).map((e) => h('li', { text: `${KIND[e.kind] || e.kind}${e.label ? ` “${e.label}”` : ''}${e.inNav ? ' (navigation)' : ''}` }))),
      h('p', { class: 'small', text: ins.primaryCta ? `Main button “${ins.primaryCta}” ranks ${ins.primaryCtaRank ? `#${ins.primaryCtaRank}` : 'outside the top 12'}. ${ins.primaryCtaRank && ins.primaryCtaRank <= 3 ? 'It should be easy to spot.' : 'Consider making it more prominent.'}` : 'No main button on the first screen.' })),
    attachmentsCard(),
  );
}

function attachmentsCard() {
  const a = state.audit;
  const input = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Attach a real heatmap screenshot' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('Image is over 8 MB; please use a smaller screenshot.'); return; }
    a.attachments = a.attachments || [];
    a.attachments.push({ id: uid(), name: file.name, caption: 'Real heatmap (Clarity/Hotjar)', blob: file });
    await saveNow();
    renderHeat();
  });
  const list = h('div', { class: 'thumbs' });
  for (const at of a.attachments || []) {
    const url = URL.createObjectURL(at.blob);
    const cap = h('input', { type: 'text', value: at.caption, 'aria-label': 'Caption', style: 'width:100%;padding:4px 6px;border:1px solid var(--line);border-radius:6px' });
    cap.addEventListener('input', () => { at.caption = cap.value; saveSoon(); });
    list.append(h('figure', {}, h('img', { src: url, alt: at.caption }), cap,
      h('figcaption', {}, h('span', { text: at.name }), h('button', { class: 'linkish small danger', type: 'button', text: 'Remove', onclick: async () => {
        a.attachments = a.attachments.filter((x) => x !== at); await saveNow(); renderHeat();
      } }))));
  }
  return h('div', { class: 'card' }, h('h3', { text: 'Real heatmaps & recordings' }),
    h('p', { class: 'small muted', text: 'Attach screenshots from Clarity, Hotjar or GA4 so the report shows real evidence next to the prediction.' }),
    input, list);
}

// ---- Speed ---------------------------------------------------------------------

function renderSpeed() {
  const a = state.audit;
  const root = $('tab-speed');
  root.innerHTML = '';
  const hasPSI = a.psi?.mobile || a.psi?.desktop;
  root.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
    h('p', { class: 'muted small', style: 'margin:0', text: hasPSI ? `PageSpeed Insights · run ${new Date(a.psi.ranAt).toLocaleString()} · Lighthouse ${(a.psi.mobile || a.psi.desktop).lighthouseVersion}` : 'Google PageSpeed Insights (Lighthouse lab test + Chrome UX Report real-visitor data).' }),
    state.psiRunning ? psiStatusNode() : h('button', { class: 'ghost small', type: 'button', text: hasPSI ? 'Re-run PageSpeed' : 'Run PageSpeed', onclick: runPSI, disabled: !canUsePSI(a.url) }),
  ));
  if (a.psi?.error) root.append(h('p', { class: 'notice', text: a.psi.error }));
  if (!canUsePSI(a.url)) root.append(h('p', { class: 'notice info', text: 'PageSpeed can’t test private or local addresses. The browser measurements below still apply.' }));

  if (hasPSI) {
    root.append(h('div', { class: 'split', style: 'grid-template-columns:1fr 1fr' }, ['mobile', 'desktop'].map((k) => {
      const p = a.psi[k];
      if (!p) return h('div', { class: 'card' }, h('h3', { text: k }), h('p', { class: 'muted', text: 'Not available.' }));
      const field = p.field || p.originField;
      return h('div', { class: 'card' },
        h('h3', { text: k === 'mobile' ? 'Mobile' : 'Desktop' }),
        scoresNode(p),
        h('h4', { text: field ? `Real visitors (Chrome UX Report${p.field ? '' : ', whole site'})` : 'Real visitors' }),
        field ? h('table', {}, h('tr', {}, h('th', { text: 'Metric' }), h('th', { text: '75th pct' }), h('th', { text: 'Rating' })),
          Object.values(field.metrics).map((m) => h('tr', {}, h('td', { text: m.label }), h('td', { text: m.unit === 'cls' ? m.value.toFixed(2) : m.value >= 1000 ? `${(m.value / 1000).toFixed(1)} s` : `${m.value} ms` }),
            h('td', {}, h('span', { class: `dot ${{ FAST: 'good', AVERAGE: 'ok', SLOW: 'bad' }[m.category] || ''}` }), { FAST: 'Good', AVERAGE: 'Needs work', SLOW: 'Poor' }[m.category] || '–')))) : h('p', { class: 'small muted', text: 'Not enough Chrome UX Report data for this page or site yet.' }),
        h('h4', { text: 'Lab test' }),
        h('table', {}, h('tr', {}, Object.keys(p.lab).map((x) => h('th', { text: x }))), h('tr', {}, Object.values(p.lab).map((m) => h('td', { text: m.display })))),
      );
    })));

    const main = a.psi.mobile || a.psi.desktop;
    root.append(h('h3', { text: `Biggest opportunities (${main.strategy})` }));
    root.append(h('div', { class: 'opps' }, main.opportunities.length ? main.opportunities.map((o) => {
      const fid = a.findings.find((f) => f.ruleId === `psi.${o.id}`)?.id;
      return h('div', { class: 'opp' },
        h('b', { text: o.title }), h('span', { class: 'save', text: o.savingsMs ? `−${o.savingsMs >= 1000 ? `${(o.savingsMs / 1000).toFixed(1)} s` : `${o.savingsMs} ms`}` : o.display }),
        h('span', { class: 'small muted', text: o.display && o.savingsMs ? o.display : '' }),
        fid ? h('button', { class: 'linkish small', type: 'button', text: `How to fix (${fid})`, onclick: () => goToFinding(fid) }) : h('span'));
    }) : h('p', { class: 'muted', text: 'No major opportunities flagged.' })));
  }

  const p = a.views.desktop.snapshot.perf || {};
  const im = a.views.desktop.snapshot.images || {};
  root.append(h('h3', { text: 'Measured in your browser (this page load)' }),
    h('table', {},
      h('tr', {}, ['Server response', 'LCP', 'CLS', 'Requests', 'Transferred', 'Third-party domains', 'Oversized images'].map((t) => h('th', { text: t }))),
      h('tr', {}, [p.ttfb != null ? `${p.ttfb} ms` : '–', p.lcp ? `${(p.lcp / 1000).toFixed(1)} s` : '–', p.cls ?? '–', p.requests ?? '–', p.sizesKnown ? `${(p.totalBytes / 1024 / 1024).toFixed(1)} MB` : 'unknown', p.thirdPartyDomains ?? '–', im.oversized ?? '–'].map((t) => h('td', { text: String(t) })))),
    h('p', { class: 'small muted', text: 'One load on your machine and network (often cached). Use PageSpeed and real-visitor data for decisions.' }));
}

// ---- SEO -----------------------------------------------------------------------

function renderSEO() {
  const a = state.audit;
  const s = a.views.desktop.snapshot.seo;
  const root = $('tab-seo');
  root.innerHTML = '';
  let url = s.url;
  try { const u = new URL(s.url); url = `${u.host}${u.pathname === '/' ? '' : ` › ${u.pathname.split('/').filter(Boolean).join(' › ')}`}`; } catch { /* keep */ }

  const check = (label, ok, value) => h('tr', {}, h('td', {}, h('span', { class: ok ? 'ok' : 'no', text: ok ? '✓' : '✕' })), h('td', { text: label }), h('td', { text: value }));
  root.append(h('div', { class: 'split' },
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', { text: 'How it can look in Google' }),
        h('div', { class: 'serp' }, h('div', { class: 'serp-url', text: url }), h('div', { class: 'serp-title', text: s.title ? (s.title.length > 60 ? `${s.title.slice(0, 58)}…` : s.title) : '(no title)' }),
          h('div', { class: 'serp-desc', text: s.metaDescription ? (s.metaDescription.length > 158 ? `${s.metaDescription.slice(0, 155)}…` : s.metaDescription) : 'No meta description — Google will pick text from the page.' }))),
      h('table', {}, h('tr', {}, h('th', {}), h('th', { text: 'Check' }), h('th', { text: 'Found' })),
        check('Title tag (50–60 chars)', s.title.length >= 30 && s.title.length <= 60, `${s.title || '—'} (${s.title.length})`),
        check('Meta description (120–155)', s.metaDescription.length >= 70 && s.metaDescription.length <= 160, `${s.metaDescription.length} characters`),
        check('One H1', s.h1s.length === 1, s.h1s.join(' | ') || '—'),
        check('Indexable', !/noindex/i.test(s.robots), s.robots || 'default'),
        check('Canonical URL', !!s.canonical, s.canonical || '—'),
        check('Mobile viewport', !!s.viewport, s.viewport ? 'set' : '—'),
        check('Language', !!s.lang, s.lang || '—'),
        check('Image alt text', s.images.missingAlt === 0, `${s.images.missingAlt} of ${s.images.total} missing`),
        check('Structured data', s.structuredData.length > 0 && !s.jsonldErrors, s.structuredData.join(', ') || '—'),
        check('Open Graph (social previews)', !!(s.og.title && s.og.image), s.og.title || '—'),
        check('No mixed content', s.mixedContent === 0, String(s.mixedContent)),
        check('Content length', s.wordCount >= 250, `${s.wordCount} words`),
        check('Links', true, `${s.links.internal} internal · ${s.links.external} external`),
      ),
    ),
    h('div', { class: 'stack' },
      aiCopyCard(),
      h('div', { class: 'card' }, h('h3', { text: 'Heading outline' }),
        s.headings.length ? h('ul', { class: 'outline' }, s.headings.slice(0, 40).map((x) => h('li', { style: `padding-left:${(x.level - 1) * 14}px` }, h('span', { class: 'lvl', text: `H${x.level}` }), x.text))) : h('p', { class: 'muted', text: 'No headings found.' })),
    ),
  ));
}

async function aiReady() {
  if (!state.pro) { openUpgrade('AI copy suggestions are part of Pro.'); return false; }
  state.ai = await getAIConfig();
  if (hasKey(state.ai)) return true;
  toast('Add an AI key in Settings to use AI suggestions.', 4000);
  openSettings();
  return false;
}

function aiCopyCard() {
  const a = state.audit;
  const copy = a.ai?.copy;
  const btn = h('button', { class: 'ghost small', type: 'button', text: copy ? 'Regenerate' : 'Suggest copy with AI' });
  btn.addEventListener('click', async () => {
    if (!(await aiReady())) return;
    btn.disabled = true; btn.textContent = 'Thinking…';
    try {
      a.ai = { ...(a.ai || {}), copy: await suggestCopy(a) };
      await saveNow();
      renderSEO();
      toast('Suggestions ready. Review before using.');
    } catch (err) { toast(err.message, 6000); btn.disabled = false; btn.textContent = 'Suggest copy with AI'; }
  });
  const copyBtn = (text) => h('button', { class: 'linkish small', type: 'button', text: 'Copy', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied')) });
  return h('div', { class: 'card ai-box' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'ai-tag', text: 'AI suggestions · review before using' }), btn),
    copy ? h('div', {},
      copy.headlines.length ? [h('h4', { text: 'Headline options' }), h('ul', {}, copy.headlines.map((x) => h('li', {}, x, ' ', copyBtn(x))))] : null,
      copy.subheadline ? [h('h4', { text: 'Sub-headline' }), h('p', {}, copy.subheadline, ' ', copyBtn(copy.subheadline))] : null,
      copy.ctas.length ? [h('h4', { text: 'Button labels' }), h('ul', {}, copy.ctas.map((x) => h('li', {}, x, ' ', copyBtn(x))))] : null,
      copy.seoTitle ? [h('h4', { text: `SEO title (${copy.seoTitle.length} chars)` }), h('p', {}, copy.seoTitle, ' ', copyBtn(copy.seoTitle))] : null,
      copy.metaDescription ? [h('h4', { text: `Meta description (${copy.metaDescription.length} chars)` }), h('p', {}, copy.metaDescription, ' ', copyBtn(copy.metaDescription))] : null,
      copy.notes ? h('p', { class: 'small muted', text: copy.notes }) : null,
    ) : h('p', { class: 'small muted', text: 'Get headline, button and search-listing ideas based on this page’s current copy and findings. Uses your own AI key; only text is sent.' }));
}

// ---- Checklist -----------------------------------------------------------------

function renderChecklist() {
  const a = state.audit;
  const root = $('tab-checklist');
  root.innerHTML = '';
  root.append(h('p', { class: 'muted', text: 'Review the mobile view first. Items marked “auto” were pre-filled from detection — confirm or change them.' }));
  for (const section of checklistFor(a.context.pageType)) {
    const box = h('section', { class: 'cl-section' }, h('h3', { text: section.title }));
    for (const it of section.items) {
      const r = a.checklist[it.id] || (a.checklist[it.id] = { status: '', note: '' });
      const row = h('div', { class: `cl-item ${r.status}` });
      const s = sel({ '': 'Not reviewed', pass: 'Pass', weak: 'Weak', missing: 'Missing', na: 'N/A' }, r.status, (v) => { r.status = v; r.auto = false; row.className = `cl-item ${v}`; saveSoon(); }, it.text);
      const note = h('input', { type: 'text', value: r.note || '', placeholder: 'Note', 'aria-label': `Note for ${it.text}` });
      note.addEventListener('input', () => { r.note = note.value; r.auto = false; saveSoon(); });
      row.append(h('div', {}, h('div', { text: it.text }), h('span', { class: 'lever', text: it.lever }), r.auto ? h('span', { class: 'auto-flag', text: ' · auto' }) : null), s, note);
      box.append(row);
    }
    root.append(box);
  }
}

// ---- Report --------------------------------------------------------------------

const SECTION_LABELS = { strengths: 'Strengths', ui: 'UI elements review', heatmap: 'Attention heatmap', speed: 'Page speed', seo: 'On-page SEO', ai: 'AI copy ideas', checklist: 'CRO checklist' };

async function buildReportHtml(onProgress) {
  const full = state.audit;
  const unlocked = unlockedIds(full);
  const lockedCount = state.pro ? 0 : full.findings.filter((f) => f.include !== false && !unlocked.has(f.id)).length;
  const a = state.pro ? full : { ...full, findings: full.findings.filter((f) => unlocked.has(f.id)), ai: {} };
  const sections = state.pro ? (a.reportSections || {}) : { ...(a.reportSections || {}), heatmap: false, ui: false, ai: false };
  const included = a.findings.filter((f) => f.include !== false && f.priority !== 'P3');
  const crops = {};
  let i = 0;
  for (const f of included) {
    onProgress?.(`Preparing evidence ${++i}/${included.length}…`);
    const url = await cropFor(f).catch(() => null);
    if (url) crops[f.id] = url;
  }
  const heat = {};
  const heatInfo = {};
  if (sections.heatmap !== false) {
    for (const v of ['mobile', 'desktop']) {
      if (!a.views[v]) continue;
      onProgress?.(`Rendering ${v} heatmap…`);
      const r = await heatFor(v);
      if (r) { heat[v] = canvasToDataUrl(r.canvas, v === 'mobile' ? 600 : 1100); heatInfo[v] = r.insights; }
    }
  }
  const attachments = [];
  for (const at of a.attachments || []) attachments.push({ src: await blobToDataUrl(at.blob), caption: at.caption });
  const buttons = sections.ui !== false ? await buttonImages(a) : [];
  return buildReport(a, { settings: state.settings, pro: state.pro, images: { crops, heat, attachments, buttons }, sections, heatInfo, lockedCount });
}

async function renderReportTab() {
  const a = state.audit;
  a.reportSections = a.reportSections || {};
  const root = $('tab-report');
  root.innerHTML = '';
  const frame = h('iframe', { class: 'report-frame', title: 'Report preview' });
  const status = h('p', { class: 'small muted', text: 'Building preview…' });
  const refresh = async () => {
    status.textContent = 'Building preview…';
    try { frame.srcdoc = await buildReportHtml((m) => { status.textContent = m; }); status.textContent = 'Preview is up to date.'; }
    catch (err) { console.error(err); status.textContent = `Preview failed: ${err.message}`; }
  };
  const opts = h('div', { class: 'card report-opts' }, h('h3', { text: 'Include sections' }),
    Object.entries(SECTION_LABELS).map(([k, label]) => {
      const c = h('input', { type: 'checkbox' });
      c.checked = a.reportSections[k] !== false;
      c.addEventListener('change', () => { a.reportSections[k] = c.checked; saveSoon(); refresh(); });
      return h('label', { class: 'check' }, c, label);
    }),
    h('p', { class: 'small muted', text: 'Findings excluded on the Findings tab are left out. Snapshot, findings, test plan, quick wins and data-to-collect are always included.' }),
    h('button', { class: 'primary', type: 'button', text: 'Export PDF', onclick: () => doExport('pdf') }),
    h('button', { class: 'ghost', type: 'button', onclick: () => doExport('html') }, 'Download HTML', state.pro ? null : h('span', { class: 'lock-tag', text: 'PRO' })),
    h('button', { class: 'ghost', type: 'button', text: 'Refresh preview', onclick: refresh }),
    status,
    state.pro ? null : h('p', { class: 'small muted', text: `Free plan: the PDF includes your top ${PLANS.free.findingsShown} findings with a small AuditLens footer. Pro includes every finding, the heatmap and UI review, your branding, and HTML/CSV/JSON exports.` }),
  );
  root.append(h('div', { class: 'report-layout' }, opts, frame));
  refresh();
}

async function doExport(kind) {
  const a = state.audit;
  if (!state.pro && kind !== 'pdf') { openUpgrade('HTML, CSV and JSON exports are part of Pro.'); return; }
  const name = slug(`${a.views.desktop.snapshot.host}-audit-${new Date(a.createdAt).toISOString().slice(0, 10)}`);
  try {
    if (kind === 'csv') { download(new Blob([toCSV(a)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`); toast('CSV downloaded'); return; }
    if (kind === 'json') { download(new Blob([toJSON(a)], { type: 'application/json' }), `${name}.json`); toast('JSON downloaded'); return; }
    toast('Preparing report…', 0);
    const html = await buildReportHtml((m) => toast(m, 0));
    if (kind === 'html') { download(new Blob([html], { type: 'text/html' }), `${name}.html`); toast('HTML report downloaded'); }
    else { toast('Choose “Save as PDF” in the print dialog'); await printHtml(html); }
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, 6000);
  }
}

// ---- Settings ------------------------------------------------------------------

let pendingLogo;
function showLogo(url) {
  $('logoPreview').hidden = !url; $('removeLogo').hidden = !url;
  if (url) $('logoPreview').src = url; else $('logoPreview').removeAttribute('src');
}
function syncProvider() {
  const p = PROVIDERS[$('aiProvider').value] || PROVIDERS.anthropic;
  $('aiKey').placeholder = p.keyHint; $('aiModel').placeholder = p.defaultModel; $('aiKeyLink').href = p.keyUrl;
  $('aiModels').innerHTML = ''; for (const m of p.models) $('aiModels').append(h('option', { value: m }));
  $('aiTestResult').textContent = '';
}
async function openSettings() {
  const f = $('settingsForm'); const s = state.settings;
  state.ai = await getAIConfig();
  f.agencyName.value = s.agencyName; f.auditorName.value = s.auditorName; f.footerText.value = s.footerText;
  f.brandColor.value = s.brandColor; f.psiKey.value = s.psiKey; f.simulatePro.checked = state.pro; $('devToggle').hidden = !DEV_MODE;
  $('aiProvider').value = state.ai.provider; $('aiKey').value = state.ai.apiKey; $('aiModel').value = state.ai.model;
  pendingLogo = undefined; $('logoInput').value = ''; showLogo(s.logoDataUrl); syncProvider();
  $('settingsDialog').showModal();
}
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 400 / Math.max(img.width || 400, img.height || 400));
        const c = h('canvas'); c.width = Math.max(1, Math.round((img.width || 400) * sc)); c.height = Math.max(1, Math.round((img.height || 400) * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
$('logoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try { pendingLogo = await readLogo(file); showLogo(pendingLogo); } catch { toast('Couldn’t read that image.'); }
});
$('removeLogo').addEventListener('click', () => { pendingLogo = ''; $('logoInput').value = ''; showLogo(''); });
$('aiProvider').addEventListener('change', () => { $('aiModel').value = ''; syncProvider(); });
$('aiTest').addEventListener('click', async () => {
  const cfg = { ...state.ai, provider: $('aiProvider').value, apiKey: $('aiKey').value.trim(), model: $('aiModel').value.trim() };
  if (!hasKey(cfg)) { $('aiTestResult').textContent = 'Paste a key first.'; return; }
  $('aiTest').disabled = true; $('aiTestResult').textContent = 'Testing…';
  try { $('aiTestResult').textContent = (await testConnection(cfg)) ? '✓ Key works' : 'Connected, unexpected reply.'; }
  catch (err) { $('aiTestResult').textContent = err.message; }
  finally { $('aiTest').disabled = false; }
});
$('settingsForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
$('settingsDialog').addEventListener('close', async () => {
  if ($('settingsDialog').returnValue !== 'save') return;
  const f = $('settingsForm');
  state.settings = {
    ...state.settings,
    agencyName: f.agencyName.value.trim(), auditorName: f.auditorName.value.trim(), footerText: f.footerText.value.trim(),
    brandColor: f.brandColor.value, psiKey: f.psiKey.value.trim(),
    logoDataUrl: pendingLogo === undefined ? state.settings.logoDataUrl : pendingLogo,
  };
  await saveSettings(state.settings);
  state.ai = { ...state.ai, provider: $('aiProvider').value, apiKey: $('aiKey').value.trim(), model: $('aiModel').value.trim() };
  await saveAIConfig(state.ai);
  if (DEV_MODE) await setPlanForTesting(f.simulatePro.checked ? 'pro' : 'free');
  await refreshPlan(true);
  rerenderCurrent();
  toast(!state.pro && (state.settings.agencyName || state.settings.logoDataUrl) ? 'Saved. Branding appears on reports with Pro.' : 'Settings saved');
  if (state.audit && state.tab === 'report') renderReportTab();
});

// ---- Wiring --------------------------------------------------------------------

function showEmpty() {
  state.audit = null;
  showView('emptyView');
  if (params.get('welcome')) $('emptyTitle').textContent = 'Welcome to AuditLens';
}

for (const b of document.querySelectorAll('.tabs [role="tab"]')) {
  b.addEventListener('click', () => selectTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
    const i = tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
    tabs[(i + tabs.length) % tabs.length].click();
    tabs[(i + tabs.length) % tabs.length].focus();
  });
}

const ctxChange = (key) => (e) => {
  state.audit.context[key] = e.target.value;
  reanalyze();
  saveSoon();
  renderAudit();
  toast('Findings updated for the new context.');
};
$('ctxPageType').addEventListener('change', ctxChange('pageType'));
$('ctxBusiness').addEventListener('change', ctxChange('businessModel'));
$('ctxConversion').addEventListener('change', ctxChange('conversion'));

$('exportPdf').addEventListener('click', () => doExport('pdf'));
$('moreBtn').addEventListener('click', () => {
  const open = $('moreMenu').hidden;
  $('moreMenu').hidden = !open;
  $('moreBtn').setAttribute('aria-expanded', String(open));
  if (open) $('moreMenu').querySelector('button')?.focus();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) {
    $('moreMenu').hidden = true; $('moreBtn').setAttribute('aria-expanded', 'false');
    $('siteMoreMenu').hidden = true; $('siteMoreBtn').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('moreMenu').hidden) { $('moreMenu').hidden = true; $('moreBtn').focus(); } });
for (const b of document.querySelectorAll('[data-export]')) b.addEventListener('click', () => { $('moreMenu').hidden = true; doExport(b.dataset.export); });
$('deleteAudit').addEventListener('click', async () => {
  $('moreMenu').hidden = true;
  if (!state.audit || !confirm('Delete this audit, its screenshots and findings? This can’t be undone.')) return;
  await deleteAudit(state.audit.id);
  if (state.site) { state.site.pageIds = state.site.pageIds.filter((x) => x !== state.audit.id); await putSite(state.site); }
  state.audit = null;
  await refreshList();
  if (state.list[0]) openAudit(state.list[0].id);
  else { history.replaceState(null, '', location.pathname); showEmpty(); }
});
$('settingsBtn').addEventListener('click', openSettings);
$('upgradeClose').addEventListener('click', () => $('upgradeDialog').close());
// Coming back from the checkout tab: re-check the plan and unlock without a reload.
window.addEventListener('focus', async () => {
  if (!state.session || DEV_MODE) return;
  if (await refreshPlan(true)) { rerenderCurrent(); if (state.pro) toast('You’re on Pro — everything is unlocked.'); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.session && !changes.session.newValue && !DEV_MODE) location.reload();
});
$('backBtn').addEventListener('click', () => state.site && openSite(state.site.id));
$('siteExportPdf').addEventListener('click', () => doSiteExport('pdf'));
$('siteMoreBtn').addEventListener('click', () => {
  const open = $('siteMoreMenu').hidden;
  $('siteMoreMenu').hidden = !open;
  $('siteMoreBtn').setAttribute('aria-expanded', String(open));
});
for (const b of document.querySelectorAll('[data-site-export]')) b.addEventListener('click', () => { $('siteMoreMenu').hidden = true; doSiteExport(b.dataset.siteExport); });
$('siteRunPSI').addEventListener('click', () => { $('siteMoreMenu').hidden = true; if (!state.sitePSI.running) runSitePSI(); });
$('deleteSite').addEventListener('click', async () => {
  $('siteMoreMenu').hidden = true;
  if (!state.site || !confirm(`Delete the audit of ${state.site.host} and all ${state.site.pageIds.length} pages? This can’t be undone.`)) return;
  await deleteSite(state.site.id);
  state.site = null; state.siteAudits = [];
  history.replaceState(null, '', location.pathname);
  await refreshList();
  showEmpty();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'AUDIT_PROGRESS' && msg.run && !msg.run.active) refreshList();
});

(async function init() {
  state.settings = await getSettings();
  state.ai = await getAIConfig();
  await refreshPlan();
  await refreshList();
  if (!state.session) { showAuth(); return; }
  if (params.get('upgrade')) openUpgrade('');
  const id = params.get('audit');
  const siteId = params.get('site');
  if (siteId) await openSite(siteId);
  else if (id) await openAudit(id);
  else if (state.sites[0] && !params.get('welcome') && (!state.list[0] || state.sites[0].createdAt >= state.list[0].createdAt)) await openSite(state.sites[0].id);
  else if (state.list[0] && !params.get('welcome')) await openAudit(state.list[0].id);
  else showEmpty();
})().catch((err) => {
  console.error(err);
  showView('statusView');
  $('statusText').textContent = `Something went wrong loading AuditLens: ${err.message}`;
});
