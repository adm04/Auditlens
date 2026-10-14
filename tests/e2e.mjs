// End-to-end smoke test: loads the unpacked extension in Chromium, audits a local test page,
// and screenshots every workspace tab + the exported report.
//
//   node tests/e2e.mjs <extensionDir> <siteUrl> <outDir>
//
// Needs Playwright (any recent version) and a Chromium build. PageSpeed is skipped because
// the test page is on localhost.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const [extDir, siteUrl, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const errors = [];
const log = (...a) => console.log('[e2e]', ...a);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'al-e2e-'));
const context = await chromium.launchPersistentContext(userData, {
  channel: 'chromium',
  headless: true,
  viewport: null,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1440,900'],
  acceptDownloads: true,
});

const watch = (p) => {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${p.url().slice(0, 80)}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${p.url().slice(0, 80)}: ${e.message}`));
};
context.on('page', watch);

let sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
log('extension', extId);

// Close the welcome tab so it can't be the visible tab in the capture window.
await new Promise((r) => setTimeout(r, 1500));
// No backend configured → developer mode; simulate Pro so every feature is testable.
await sw.evaluate(() => chrome.storage.local.set({ plan: 'pro' }));
for (const p of context.pages()) if (p.url().includes(extId)) await p.close();

const site = context.pages()[0] || await context.newPage();
watch(site);
await site.goto(siteUrl, { waitUntil: 'load' });
await site.waitForTimeout(800);

// Start the audit from an extension page in its own window (like the popup would).
const [controller] = await Promise.all([
  context.waitForEvent('page', (p) => p.url().includes('popup/popup.html')),
  sw.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('popup/popup.html'), focused: false, width: 400, height: 600 })),
]);
await controller.waitForLoadState();
const started = await controller.evaluate(async (url) => {
  const tabs = await chrome.tabs.query({});
  const t = tabs.find((x) => x.url && x.url.startsWith(url));
  return chrome.runtime.sendMessage({ type: 'START_AUDIT', tabId: t.id, options: { mobile: true, psi: false, pageType: 'auto', conversion: 'auto' } });
}, siteUrl);
log('start', JSON.stringify(started));

const app = await context.waitForEvent('page', { predicate: (p) => p.url().includes('fresh=1'), timeout: 120000 });
await app.setViewportSize({ width: 1440, height: 1000 });
await app.waitForSelector('#auditView:not([hidden])', { timeout: 60000 });
await app.waitForTimeout(800);
log('report opened');

const shot = async (name) => app.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });
const tab = async (name) => { await app.click(`.tabs [data-tab="${name}"]`); await app.waitForTimeout(name === 'heatmap' || name === 'report' ? 3500 : 600); };

await shot('01-overview');
await tab('findings');
const titles = await app.$$eval('.f-title', (els) => els.map((e) => e.textContent));
log(`findings: ${titles.length}`);
fs.writeFileSync(path.join(outDir, 'findings.txt'), titles.join('\n'));
await app.click('.f-card .f-head');
await app.waitForTimeout(800);
await shot('02-findings');
await tab('heatmap');
await shot('03-heatmap');
await app.click('.seg button:nth-child(2)').catch(() => {});
await app.waitForTimeout(2500);
await shot('03b-heatmap-desktop');
await tab('speed');
await shot('04-speed');
await tab('seo');
await shot('05-seo');
await tab('checklist');
await shot('06-checklist');
await tab('report');
await shot('07-report');

// Exports
await app.click('#moreBtn');
const [dl] = await Promise.all([app.waitForEvent('download'), app.click('[data-export="html"]')]);
const reportPath = path.join(outDir, 'report.html');
await dl.saveAs(reportPath);
for (const kind of ['csv', 'json']) {
  await app.click('#moreBtn');
  const [d] = await Promise.all([app.waitForEvent('download'), app.click(`[data-export="${kind}"]`)]);
  await d.saveAs(path.join(outDir, `findings.${kind}`));
}
log('exports saved');

const rp = await context.newPage();
await rp.goto(`file://${reportPath}`);
await rp.setViewportSize({ width: 1100, height: 1400 });
await rp.screenshot({ path: path.join(outDir, '08-report-full.png'), fullPage: true });
await rp.pdf({ path: path.join(outDir, 'report.pdf'), format: 'A4', printBackground: true });
log('pdf printed');

// Mobile capture check
const meta = await app.evaluate(async () => {
  const { listAudits, getAudit } = await import('../src/db.js');
  const [a] = await listAudits();
  const full = await getAudit(a.id);
  return { desktop: full.views.desktop.shotMeta, mobile: full.views.mobile?.shotMeta, mobileWidth: full.views.mobile?.snapshot.viewport.w, mobileError: full.mobileError || '', pageType: full.context.pageType };
});
log('capture', JSON.stringify(meta));

fs.writeFileSync(path.join(outDir, 'errors.txt'), errors.join('\n'));
log(`console errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await context.close();
