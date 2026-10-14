import { listAudits } from '../src/db.js';
import { getSettings, saveSettings } from '../src/settings.js';
import { canUsePSI } from '../src/psi.js';
import { getSession } from '../src/auth.js';
import { getEntitlement, DEV_MODE } from '../src/entitlements.js';
import { renderAuth, renderUpgrade } from '../src/ui/account-ui.js';
import { PLANS } from '../src/config.js';

let ent = null;
let lastView = 'ready';

const $ = (id) => document.getElementById(id);
let tab = null;
let discovered = null;
const MAX_PAGES = 10;
const DEFAULT_PAGES = 6;

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const selectedUrls = () => [...document.querySelectorAll('#pageList input:checked')].map((c) => c.value);

function updateEstimate() {
  const n = selectedUrls().length;
  const perPage = $('optMobile').checked ? 30 : 15;
  $('siteEstimate').textContent = n ? `${n} page${n === 1 ? '' : 's'} selected · about ${Math.max(1, Math.round((n * perPage) / 60))} min. A new window opens while it runs.` : 'Select at least one page.';
  $('run').disabled = mode() === 'site' && n === 0;
  $('run').textContent = mode() === 'site' ? `Audit ${n} page${n === 1 ? '' : 's'}` : 'Audit this page';
  for (const c of document.querySelectorAll('#pageList input:not(:checked)')) c.disabled = n >= MAX_PAGES;
}

async function loadPages() {
  if (discovered) return;
  $('discoverMsg').textContent = 'Looking for the main pages…';
  const res = await chrome.runtime.sendMessage({ type: 'DISCOVER_PAGES', tabId: tab.id }).catch(() => null);
  discovered = res?.ok ? res.links : [];
  const ul = $('pageList');
  ul.innerHTML = '';
  if (!discovered.length) { $('discoverMsg').textContent = 'No other pages found from the menu. Only this page will be audited.'; discovered = [{ url: tab.url, label: tab.title, path: new URL(tab.url).pathname }]; }
  else $('discoverMsg').textContent = `Found ${discovered.length} pages from the menu and footer. Untick any you don’t need.`;
  discovered.forEach((l, i) => {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.value = l.url; box.checked = i < DEFAULT_PAGES;
    box.addEventListener('change', updateEstimate);
    const p = document.createElement('span'); p.className = 'p';
    const b = document.createElement('b'); b.textContent = l.label || l.path;
    const sm = document.createElement('span'); sm.textContent = l.path + (l.where === 'current' ? ' (this page)' : '');
    p.append(b, sm);
    const label = document.createElement('label'); label.append(box, p);
    const li = document.createElement('li'); li.append(label); ul.append(li);
  });
  updateEstimate();
}

for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', async () => {
    const site = mode() === 'site';
    if (site && ent && ent.plan !== 'pro') { showUpgrade('Auditing a whole site at once is part of Pro.'); return; }
    $('sitePanel').hidden = !site;
    $('pageOptions').hidden = site;
    if (site) await loadPages();
    updateEstimate();
  });
}

function openApp(auditId) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`app/app.html${auditId ? `?audit=${encodeURIComponent(auditId)}` : ''}`) });
  window.close();
}

function show(name) {
  for (const id of ['ready', 'blocked', 'running', 'signin', 'upgrade']) $(id).hidden = id !== name;
  if (name !== 'upgrade') lastView = name;
}

function showUpgrade(reason) {
  renderUpgrade($('upgradeRoot'), { reason, onUpgraded: () => location.reload() });
  show('upgrade');
}
$('upgradeBack').addEventListener('click', () => {
  if (mode() === 'site' && ent?.plan !== 'pro') document.querySelector('input[name="mode"][value="page"]').click();
  show(lastView === 'upgrade' ? 'ready' : lastView);
});

function renderPlanLine() {
  const line = $('planLine');
  line.innerHTML = '';
  if (!ent) { line.hidden = true; return; }
  line.hidden = false;
  const badge = document.createElement('span');
  badge.className = `plan-badge ${ent.plan === 'pro' ? 'pro' : ''}`;
  badge.textContent = ent.plan === 'pro' ? 'PRO' : 'FREE';
  line.append(badge);
  if (ent.plan === 'pro') {
    line.append(document.createTextNode(DEV_MODE ? ' Developer mode (simulated Pro)' : ' Unlimited audits'));
    $('siteLock').hidden = true;
    return;
  }
  const left = Math.max(0, (ent.limit ?? PLANS.free.auditsPerMonth) - (ent.used ?? 0));
  line.append(document.createTextNode(` ${left} of ${ent.limit ?? PLANS.free.auditsPerMonth} free audits left this month · `));
  const up = document.createElement('button');
  up.className = 'link';
  up.type = 'button';
  up.textContent = 'Upgrade';
  up.addEventListener('click', () => showUpgrade(''));
  line.append(up);
  $('siteLock').hidden = false;
}

function renderRun(run) {
  if (run?.active) {
    show('running');
    $('bar').style.width = `${Math.max(2, Math.min(100, run.pct || 0))}%`;
    $('runMsg').textContent = run.message || 'Working…';
    $('error').hidden = true;
  } else if (run?.error && Date.now() - run.at < 60000) {
    $('error').textContent = run.error;
    $('error').hidden = false;
  }
}

async function renderRecent() {
  const audits = (await listAudits()).slice(0, 5);
  const ul = $('recent');
  ul.innerHTML = '';
  if (!audits.length) { ul.innerHTML = '<li class="empty">No audits yet.</li>'; return; }
  for (const a of audits) {
    const btn = document.createElement('button');
    btn.type = 'button';
    let host = a.url;
    try { host = new URL(a.url).host + new URL(a.url).pathname.replace(/\/$/, ''); } catch { /* keep */ }
    btn.innerHTML = '<span class="t"></span><span class="d"></span>';
    btn.querySelector('.t').textContent = host;
    btn.querySelector('.d').textContent = new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    btn.addEventListener('click', () => openApp(a.id));
    const li = document.createElement('li');
    li.append(btn);
    ul.append(li);
  }
}

$('openApp').addEventListener('click', () => openApp());

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  const options = {
    mobile: $('optMobile').checked,
    psi: $('optPSI').checked && canUsePSI(tab.url),
    pageType: $('pageType').value,
    conversion: $('conversion').value,
  };
  const s = await getSettings();
  await saveSettings({ ...s, runMobile: $('optMobile').checked, runPSI: $('optPSI').checked });
  const res = mode() === 'site'
    ? await chrome.runtime.sendMessage({ type: 'START_SITE_AUDIT', tabId: tab.id, urls: selectedUrls(), options: { ...options, pageType: 'auto', conversion: 'auto' } })
    : await chrome.runtime.sendMessage({ type: 'START_AUDIT', tabId: tab.id, options });
  if (!res?.ok) {
    $('run').disabled = false;
    if (res?.reason === 'limit') { showUpgrade(`You’ve used your ${res.limit ?? PLANS.free.auditsPerMonth} free audits this month. Upgrade for unlimited audits, or wait until next month.`); return; }
    if (res?.reason === 'pro_only') { showUpgrade('Auditing a whole site at once is part of Pro.'); return; }
    if (res?.reason === 'signin') { await showSignIn(); return; }
    $('error').textContent = res?.error || 'Couldn’t start the audit.';
    $('error').hidden = false;
    return;
  }
  if (res.plan === 'free' && res.used != null) { ent = { ...ent, used: res.used, limit: res.limit }; renderPlanLine(); }
  renderRun({ active: true, pct: 2, message: 'Starting…' });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'AUDIT_PROGRESS') {
    renderRun(msg.run);
    if (msg.run && !msg.run.active && msg.run.error) { show('ready'); $('run').disabled = false; }
  }
});

async function showSignIn() {
  $('planLine').hidden = true;
  renderAuth($('signin'), { onSignedIn: () => location.reload(), compact: false });
  show('signin');
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const session = await getSession();
  if (!session) { await showSignIn(); await renderRecent(); return; }
  ent = await getEntitlement();
  renderPlanLine();
  const ok = tab?.url && /^https?:\/\//.test(tab.url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(tab.url);
  const s = await getSettings();
  $('optMobile').checked = s.runMobile;
  $('optMobile').addEventListener('change', updateEstimate);
  $('optPSI').checked = s.runPSI;
  if (ok) {
    const u = new URL(tab.url);
    $('host').textContent = u.host;
    $('pageTitle').textContent = tab.title || u.pathname;
    $('psiNote').hidden = canUsePSI(tab.url);
    show('ready');
  } else {
    show('blocked');
  }
  const run = await chrome.runtime.sendMessage({ type: 'GET_RUN' }).catch(() => null);
  renderRun(run);
  await renderRecent();
})();
