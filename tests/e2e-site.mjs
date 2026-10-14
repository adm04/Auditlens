// End-to-end test for multi-page site audits.
//   node tests/e2e-site.mjs <extensionDir> <siteUrl> <outDir>
// Discovers main pages from the given URL, audits them, screenshots the site overview,
// a page's UI tab and findings, and exports the site report (HTML + PDF + CSV).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const [extDir, siteUrl, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const errors = [];
const log = (...a) => console.log('[site-e2e]', ...a);

const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'al-site-')), {
  channel: 'chromium', headless: true, viewport: null, acceptDownloads: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1440,900'],
});
const watch = (p) => {
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${p.url().slice(0, 70)}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${p.url().slice(0, 70)}: ${e.message}`));
};
context.on('page', watch);
const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));
// No backend configured → developer mode; simulate Pro so every feature is testable.
await sw.evaluate(() => chrome.storage.local.set({ plan: 'pro' }));
for (const p of context.pages()) if (p.url().includes(extId)) await p.close();

const site = context.pages()[0] || await context.newPage();
watch(site);
await site.goto(siteUrl, { waitUntil: 'load' });

const [controller] = await Promise.all([
  context.waitForEvent('page', (p) => p.url().includes('popup/popup.html')),
  sw.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('popup/popup.html'), focused: false, width: 400, height: 700 })),
]);
await controller.waitForLoadState();
const discovered = await controller.evaluate(async (url) => {
  const t = (await chrome.tabs.query({})).find((x) => x.url && x.url.startsWith(url));
  const res = await chrome.runtime.sendMessage({ type: 'DISCOVER_PAGES', tabId: t.id });
  return { tabId: t.id, links: res.links };
}, siteUrl);
log('discovered', discovered.links.map((l) => `${l.path} [${l.where}]`).join(', '));
fs.writeFileSync(path.join(outDir, 'discovered.json'), JSON.stringify(discovered.links, null, 2));

const urls = discovered.links.slice(0, 6).map((l) => l.url);
const started = await controller.evaluate(async ({ tabId, urls }) => chrome.runtime.sendMessage({
  type: 'START_SITE_AUDIT', tabId, urls, options: { mobile: true, psi: false, pageType: 'auto', conversion: 'auto' },
}), { tabId: discovered.tabId, urls });
log('start', JSON.stringify(started), `${urls.length} pages`);

const poll = setInterval(async () => {
  try { const run = await sw.evaluate(() => chrome.storage.session.get('run').then((r) => r.run)); log('run', run?.pct?.toFixed?.(0), run?.message, run?.error || ''); } catch (e) { log('poll error', e.message); }
}, 10000);
const app = await context.waitForEvent('page', { predicate: (p) => p.url().includes('site=') && p.url().includes('fresh=1'), timeout: 300000 });
clearInterval(poll);
await app.setViewportSize({ width: 1440, height: 1000 });
await app.waitForSelector('#siteView:not([hidden])', { timeout: 120000 });
await app.waitForTimeout(800);
await app.screenshot({ path: path.join(outDir, 's1-site-overview.png') });
await app.screenshot({ path: path.join(outDir, 's1b-site-overview-full.png'), fullPage: true });
log('site view open');

// Open a page with UI issues
await app.click('.page-row:nth-of-type(3)');
await app.waitForSelector('#auditView:not([hidden])');
await app.click('.tabs [data-tab="ui"]');
await app.waitForTimeout(2500);
await app.screenshot({ path: path.join(outDir, 's2-page-ui.png') });
await app.click('.tabs [data-tab="findings"]');
await app.waitForTimeout(500);
await app.screenshot({ path: path.join(outDir, 's3-page-findings.png') });
await app.click('#backBtn');
await app.waitForSelector('#siteView:not([hidden])');

// Exports
await app.click('#siteMoreBtn');
const [dl] = await Promise.all([app.waitForEvent('download', { timeout: 180000 }), app.click('[data-site-export="html"]')]);
const reportPath = path.join(outDir, 'site-report.html');
await dl.saveAs(reportPath);
await app.click('#siteMoreBtn');
const [dl2] = await Promise.all([app.waitForEvent('download'), app.click('[data-site-export="csv"]')]);
await dl2.saveAs(path.join(outDir, 'site-findings.csv'));
const rp = await context.newPage();
await rp.goto(`file://${reportPath}`);
await rp.pdf({ path: path.join(outDir, 'site-report.pdf'), format: 'A4', printBackground: true });
log('exports saved');

fs.writeFileSync(path.join(outDir, 'errors.txt'), errors.join('\n'));
log(`console errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await context.close();
