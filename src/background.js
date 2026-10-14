// Service worker: runs the capture phase of an audit.
//
//   popup ──START_AUDIT {tabId, options}──▶ background
//     1. desktop: inject collector into the current tab, scroll + capture + stitch, collect snapshot
//     2. mobile (optional): open the URL in a 390px-wide popup window, same steps, close window
//     3. save audit (status 'analyzing') and open the workspace tab
//   The workspace then runs PageSpeed Insights, the rules and the heatmap (long network
//   calls are safer in a page than in a service worker that can be suspended).
//
// Progress is kept in chrome.storage.session.run and broadcast as { type: 'AUDIT_PROGRESS', run }.

import { uid, putAudit, putSite } from './db.js';
import { signInWithGoogle } from './auth.js';
import { consumeAudit } from './entitlements.js';

const CAPTURE_GAP_MS = 560;       // Chrome allows ~2 captureVisibleTab calls per second
const MAX_SCREENS = 12;           // cap the stitched screenshot length
const MAX_OUT_WIDTH = 1280;       // stored screenshot width (px)
const MAX_OUT_HEIGHT = 16000;     // canvas safety limit
const MOBILE_WIDTH = 390;
const MAX_SITE_PAGES = 10;

let lastCapture = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Progress ------------------------------------------------------------------

async function setRun(patch) {
  const { run } = await chrome.storage.session.get('run');
  const next = patch === null ? null : { ...(run || {}), ...patch, at: Date.now() };
  await chrome.storage.session.set({ run: next });
  chrome.runtime.sendMessage({ type: 'AUDIT_PROGRESS', run: next }).catch(() => {});
  if (next?.active) {
    await chrome.action.setBadgeBackgroundColor({ color: '#FF6B3D' });
    await chrome.action.setBadgeText({ text: `${Math.min(99, Math.round(next.pct || 0))}%` });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
  return next;
}

// ---- Page scripting helpers ----------------------------------------------------

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/collector.js'] });
}

async function call(tabId, name, ...args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fn, a) => globalThis.__auditlens[fn](...a),
    args: [name, args],
  });
  return res?.result;
}

async function capture(windowId) {
  const wait = CAPTURE_GAP_MS - (Date.now() - lastCapture);
  if (wait > 0) await sleep(wait);
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 88 });
  } finally {
    lastCapture = Date.now();
  }
}

async function dataUrlToBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

function pixelate(ctx, x, y, w, h) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(W - x, Math.ceil(w)); h = Math.min(H - y, Math.ceil(h));
  if (w < 1 || h < 1) return;
  const block = 8;
  const sw = Math.max(1, Math.ceil(w / block)), sh = Math.max(1, Math.ceil(h / block));
  const tmp = new OffscreenCanvas(sw, sh);
  tmp.getContext('2d').drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();
}

// ---- Capture one view (scroll, capture, stitch, collect) -------------------------

async function captureView({ tabId, windowId, label, onProgress }) {
  await inject(tabId);
  const prep = await call(tabId, 'prepare');
  if (!prep) throw new Error('Could not read the page.');

  const vh = prep.innerHeight;
  const vw = prep.innerWidth;
  const totalScreens = Math.max(1, Math.ceil(prep.scrollHeight / vh));
  const screens = Math.min(totalScreens, MAX_SCREENS);
  const frames = [];
  let overlayShot = null;

  try {
    // If a pop-up covers the page at load, keep one screenshot of it as evidence, then hide
    // it so the stitched page and heatmap show the page itself.
    if ((prep.overlays || []).some((o) => o.share >= 30)) {
      await call(tabId, 'scrollTo', 0);
      await sleep(200);
      const bmp = await dataUrlToBitmap(await capture(windowId));
      const scale = Math.min(1, MAX_OUT_WIDTH / bmp.width);
      const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      overlayShot = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      await call(tabId, 'hideOverlays');
    }
    for (let i = 0; i < screens; i++) {
      const target = Math.min(i * vh, Math.max(0, prep.scrollHeight - vh));
      const y = await call(tabId, 'scrollTo', target);
      if (i > 0 && frames.length && y === frames[frames.length - 1].y) break; // page didn't scroll
      await sleep(i === 0 ? 250 : 450);
      if (i === 1) await call(tabId, 'hideFixed'); // keep sticky headers/chat bubbles out of later frames
      const dataUrl = await capture(windowId);
      frames.push({ y, bitmap: await dataUrlToBitmap(dataUrl) });
      onProgress?.(`${label}: screen ${i + 1} of ${screens}`, (i + 1) / screens);
    }
  } finally {
    await call(tabId, 'showFixed').catch(() => {});
    await call(tabId, 'scrollTo', 0).catch(() => {});
  }

  await sleep(400);
  const snapshot = await call(tabId, 'collect');
  await call(tabId, 'scrollTo', prep.scrollY).catch(() => {});
  if (!snapshot) throw new Error('Could not collect page data.');
  snapshot.overlays = prep.overlays || [];

  // Stitch.
  const first = frames[0].bitmap;
  const deviceScale = first.width / vw;
  const cssHeight = Math.min(prep.scrollHeight, frames[frames.length - 1].y + vh);
  let outScale = Math.min(1, MAX_OUT_WIDTH / first.width);
  if (cssHeight * deviceScale * outScale > MAX_OUT_HEIGHT) outScale = MAX_OUT_HEIGHT / (cssHeight * deviceScale);
  const k = deviceScale * outScale; // output px per CSS px
  const canvas = new OffscreenCanvas(Math.round(first.width * outScale), Math.round(cssHeight * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const f of frames) {
    ctx.drawImage(f.bitmap, 0, Math.round(f.y * k), canvas.width, Math.round(f.bitmap.height * outScale));
    f.bitmap.close();
  }
  for (const r of snapshot.redactions || []) pixelate(ctx, r.x * k, r.y * k, r.w * k, r.h * k);
  const shot = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });

  return {
    snapshot,
    shot,
    overlayShot,
    shotMeta: {
      width: canvas.width, height: canvas.height, k,
      cssWidth: vw, cssHeight, viewportHeight: vh,
      screens: frames.length, truncated: totalScreens > frames.length,
      scrolled: frames.length > 1 || totalScreens === 1,
    },
  };
}

/** windows.create that never fails on bounds that don't fit the user's screen. */
async function createWindow(opts) {
  try {
    return await chrome.windows.create(opts);
  } catch (err) {
    if (!/bounds/i.test(String(err.message))) throw err;
    const { left, top, width, height, ...rest } = opts;
    try {
      return await chrome.windows.create({ ...rest, width, height });
    } catch {
      return chrome.windows.create(rest);
    }
  }
}

// ---- Mobile window -------------------------------------------------------------

function waitForComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') done(); }).catch(done);
  });
}

async function captureMobile(url, onProgress) {
  const win = await createWindow({
    url, type: 'popup', focused: true,
    width: MOBILE_WIDTH + 16, height: 860, left: 40, top: 40,
  });
  const tabId = win.tabs[0].id;
  try {
    await waitForComplete(tabId);
    await sleep(2000); // let late scripts, fonts and hero images settle
    // Window chrome (borders, scrollbars) and OS minimum sizes vary, so measure the real
    // viewport and nudge the outer window width until the page is ~390px wide.
    await inject(tabId);
    for (let i = 0; i < 3; i++) {
      const prep = await call(tabId, 'prepare');
      if (!prep || Math.abs(prep.innerWidth - MOBILE_WIDTH) <= 12) break;
      const current = await chrome.windows.get(win.id);
      const target = Math.max(200, current.width - (prep.innerWidth - MOBILE_WIDTH));
      await chrome.windows.update(win.id, { width: target }).catch(() => {});
      await sleep(700);
    }
    return await captureView({ tabId, windowId: win.id, label: 'Mobile view', onProgress });
  } finally {
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

// ---- Run ---------------------------------------------------------------------

export function isAuditable(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) &&
    !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

function newAudit(url, title, options, siteId) {
  return {
    id: uid(), url, title: title || url, createdAt: Date.now(), status: 'capturing', options, siteId: siteId || null,
    views: {}, psi: {}, context: {}, findings: [], strengths: [], checklist: {}, attachments: [], ai: {}, notes: '',
  };
}

/** Captures desktop (+ mobile) for one page that is already loaded in tabId. */
async function capturePage({ tabId, windowId, url, title, options, siteId, report }) {
  const audit = newAudit(url, title, options, siteId);
  const w = options.mobile ? [0.55, 0.45] : [1, 0];
  audit.views.desktop = await captureView({ tabId, windowId, label: 'Desktop', onProgress: (m, f) => report(m, f * w[0]) });
  audit.title = audit.views.desktop.snapshot.title || audit.title;
  audit.url = audit.views.desktop.snapshot.url || audit.url;
  if (options.mobile) {
    try {
      report('Opening mobile view…', w[0]);
      audit.views.mobile = await captureMobile(audit.url, (m, f) => report(m, w[0] + f * w[1]));
    } catch (err) {
      console.warn('[AuditLens] mobile capture failed', err);
      audit.mobileError = String(err.message || err);
    }
    await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  }
  audit.status = 'analyzing';
  await putAudit(audit);
  return audit;
}

async function runAudit(tabId, options) {
  const tab = await chrome.tabs.get(tabId);
  if (!isAuditable(tab.url)) throw new Error('This page can’t be audited. Open a normal website (http or https).');
  await setRun({ active: true, url: tab.url, pct: 2, message: 'Starting…' });
  const audit = await capturePage({
    tabId, windowId: tab.windowId, url: tab.url, title: tab.title, options,
    report: (message, f) => setRun({ message, pct: 3 + f * 95 }),
  });
  await setRun({ message: 'Opening report…', pct: 99, auditId: audit.id });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`app/app.html?audit=${audit.id}&fresh=1`), windowId: tab.windowId });
  await setRun({ active: false, pct: 100, message: 'Done', auditId: audit.id });
  return audit.id;
}

/** Audits several pages of one site in a dedicated window, then opens the site overview. */
async function runSiteAudit(srcTabId, urls, options) {
  const src = await chrome.tabs.get(srcTabId);
  const list = urls.filter(isAuditable).slice(0, MAX_SITE_PAGES);
  if (!list.length) throw new Error('No pages to audit.');
  const host = new URL(list[0]).host;
  const site = { id: uid(), host, title: host, createdAt: Date.now(), status: 'capturing', options, pageIds: [], errors: [] };
  await putSite(site);
  await setRun({ active: true, siteId: site.id, url: list[0], pct: 1, message: `Opening ${host}…` });

  // Same size and place as the user's window, so it always fits their screen.
  const srcWin = await chrome.windows.get(src.windowId).catch(() => null);
  const bounds = srcWin && srcWin.state === 'normal'
    ? { left: srcWin.left, top: srcWin.top, width: srcWin.width, height: srcWin.height }
    : { width: Math.min(1440, srcWin?.width || 1440), height: Math.min(900, srcWin?.height || 900) };
  const win = await createWindow({ url: list[0], type: 'normal', focused: true, ...bounds });
  const tabId = win.tabs[0].id;
  try {
    for (let i = 0; i < list.length; i++) {
      const base = (i / list.length) * 97;
      const span = 97 / list.length;
      const label = `Page ${i + 1} of ${list.length}`;
      try {
        if (i > 0) await chrome.tabs.update(tabId, { url: list[i] });
        await setRun({ message: `${label}: loading ${new URL(list[i]).pathname}`, pct: 2 + base });
        await waitForComplete(tabId);
        await sleep(1500);
        const tab = await chrome.tabs.get(tabId);
        if (!isAuditable(tab.url)) throw new Error('Page redirected to a URL that can’t be audited.');
        const audit = await capturePage({
          tabId, windowId: win.id, url: tab.url, title: tab.title, options, siteId: site.id,
          report: (message, f) => setRun({ message: `${label} · ${message}`, pct: 2 + base + f * span }),
        });
        site.pageIds.push(audit.id);
        if (i === 0) site.title = audit.views.desktop.snapshot.title || host;
      } catch (err) {
        console.warn('[AuditLens] page failed', list[i], err);
        site.errors.push({ url: list[i], error: String(err.message || err) });
      }
      await putSite(site);
    }
  } finally {
    await chrome.windows.remove(win.id).catch(() => {});
  }
  if (!site.pageIds.length) throw new Error(site.errors[0]?.error || 'No pages could be captured.');
  site.status = 'analyzing';
  await putSite(site);
  await chrome.windows.update(src.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.create({ url: chrome.runtime.getURL(`app/app.html?site=${site.id}&fresh=1`), windowId: src.windowId });
  await setRun({ active: false, pct: 100, message: 'Done', siteId: site.id });
  return site.id;
}

async function discover(tabId) {
  await inject(tabId);
  return call(tabId, 'discoverLinks');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'DISCOVER_PAGES') {
    discover(msg.tabId).then((links) => sendResponse({ ok: true, links: links || [] }), (err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (msg?.type === 'AUTH_GOOGLE') {
    signInWithGoogle().then((session) => sendResponse({ ok: true, email: session?.user?.email }), (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'START_AUDIT' || msg?.type === 'START_SITE_AUDIT') {
    (async () => {
      const { run } = await chrome.storage.session.get('run');
      if (run?.active && Date.now() - run.at < 120000) {
        sendResponse({ ok: false, error: 'An audit is already running.' });
        return;
      }
      // Plan check (and free-plan usage count) happens here, server-side when configured.
      const permit = await consumeAudit(msg.type === 'START_SITE_AUDIT' ? 'site' : 'page');
      if (!permit.allowed) {
        sendResponse({ ok: false, reason: permit.reason, used: permit.used, limit: permit.limit, error: permit.message });
        return;
      }
      sendResponse({ ok: true, plan: permit.plan, used: permit.used, limit: permit.limit });
      try {
        if (msg.type === 'START_SITE_AUDIT') await runSiteAudit(msg.tabId, msg.urls || [], msg.options || {});
        else await runAudit(msg.tabId, msg.options || {});
      } catch (err) {
        console.error('[AuditLens] audit failed', err);
        await setRun({ active: false, error: String(err.message || err), message: 'Audit failed', pct: 0 });
      }
    })();
    return true;
  }
  if (msg?.type === 'GET_RUN') {
    chrome.storage.session.get('run').then(({ run }) => sendResponse(run || null));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.action.setBadgeText({ text: '' });
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html?welcome=1') });
});
