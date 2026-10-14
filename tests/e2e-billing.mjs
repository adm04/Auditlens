// End-to-end test of accounts + plans + checkout against tests/mock-backend.mjs.
//   node tests/e2e-billing.mjs <extensionDir> <siteUrl> <outDir>
// Copies the extension, points src/config.js at the mock backend, then:
//   sign-up (email) → free plan line → audit → locked findings/UI/heatmap/HTML export →
//   free limit reached → site audit is Pro-only → upgrade → signed webhook → Pro unlocks.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startMockBackend } from './mock-backend.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const [srcExt, siteUrl, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log('[billing-e2e]', ...a);
const errors = [];

// 1. Copy extension and configure it for the mock backend.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'al-ext-'));
fs.cpSync(srcExt, ext, { recursive: true, filter: (p) => !p.includes(`${path.sep}tests`) });
const cfgPath = path.join(ext, 'src/config.js');
fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8')
  .replace("SUPABASE_URL: '',", "SUPABASE_URL: 'http://localhost:8790',")
  .replace("SUPABASE_ANON_KEY: '',", "SUPABASE_ANON_KEY: 'anon-test-key',"));

const backend = await startMockBackend(8790);
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'al-bill-')), {
  channel: 'chromium', headless: true, viewport: null, acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1440,900'],
});
context.on('page', (p) => {
  p.on('pageerror', (e) => errors.push(`${p.url().slice(0, 60)}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${p.url().slice(0, 60)}: ${m.text()}`); });
});
const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));

try {
  // The welcome tab now shows the sign-in screen.
  let app = context.pages().find((p) => p.url().includes(extId));
  await app.setViewportSize({ width: 1440, height: 950 });
  await app.waitForSelector('#authView:not([hidden]) .auth-google');
  await app.screenshot({ path: path.join(outDir, 'b1-workspace-signin.png') });

  // 2. Sign up in the popup.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('#signin:not([hidden]) .auth-google');
  await popup.screenshot({ path: path.join(outDir, 'b2-popup-signin.png') });
  await popup.click('text=New here? Create a free account');
  await popup.fill('input[aria-label="Your name"]', 'Sutanu Test');
  await popup.fill('input[type="email"]', 'designer@example.com');
  await popup.fill('input[type="password"]', 'short');
  await popup.click('.auth-submit');
  assert.match(await popup.textContent('.auth-msg'), /at least 8/);
  await popup.fill('input[type="password"]', 'correct-horse-9');
  await popup.click('.auth-submit');
  await popup.waitForSelector('#planLine:not([hidden])');
  log('signed up; plan line:', (await popup.textContent('#planLine')).trim());
  assert.match(await popup.textContent('#planLine'), /3 of 3 free audits left/);

  // 3. Use 2 audits server-side so the next is the last free one.
  backend.usage.set('u1', 2);

  const site = await context.newPage();
  await site.goto(siteUrl, { waitUntil: 'load' });
  await site.bringToFront();
  const send = (msg) => popup.evaluate(async ({ msg, url }) => {
    const t = (await chrome.tabs.query({})).find((x) => x.url && x.url.startsWith(url));
    return chrome.runtime.sendMessage({ ...msg, tabId: t.id });
  }, { msg, url: siteUrl });

  const r1 = await send({ type: 'START_AUDIT', options: { mobile: false, psi: false, pageType: 'auto', conversion: 'auto' } });
  log('audit 3 →', JSON.stringify(r1));
  assert.equal(r1.ok, true); assert.equal(r1.used, 3);
  app = await context.waitForEvent('page', { predicate: (p) => p.url().includes('fresh=1'), timeout: 120000 });
  await app.setViewportSize({ width: 1440, height: 950 });
  await app.waitForSelector('#auditView:not([hidden])');
  await app.click('.tabs [data-tab="findings"]');
  await app.waitForTimeout(500);
  const lockedCount = await app.$$eval('.locked-card', (els) => els.length);
  log('free: locked findings', lockedCount);
  assert.ok(lockedCount > 0);
  await app.screenshot({ path: path.join(outDir, 'b3-free-findings.png') });
  await app.click('.tabs [data-tab="ui"]');
  await app.waitForSelector('#tab-ui .locked-panel');
  await app.screenshot({ path: path.join(outDir, 'b4-free-ui-locked.png') });

  // 4. Limits
  const r2 = await send({ type: 'START_AUDIT', options: { mobile: false, psi: false } });
  log('audit 4 →', JSON.stringify(r2));
  assert.equal(r2.ok, false); assert.equal(r2.reason, 'limit');
  const r3 = await send({ type: 'START_SITE_AUDIT', urls: [siteUrl], options: { mobile: false, psi: false } });
  log('site audit →', JSON.stringify(r3));
  assert.equal(r3.reason, 'pro_only');

  // 5. Upgrade from the workspace → checkout tab → signed webhook → Pro.
  await app.bringToFront();
  await app.click('#accountBox .accent');
  await app.waitForSelector('#upgradeDialog[open] .auth-submit.upgrade');
  await app.screenshot({ path: path.join(outDir, 'b5-upgrade-dialog.png') });
  const [checkout] = await Promise.all([context.waitForEvent('page', (p) => p.url().includes('fake-checkout')), app.click('.auth-submit.upgrade')]);
  log('checkout opened:', checkout.url().split('?')[0]);
  await app.bringToFront();
  await app.waitForFunction(() => !document.getElementById('upgradeDialog').open, null, { timeout: 30000 });
  await app.waitForTimeout(800);
  assert.match(await app.textContent('#accountBox'), /PRO/);
  await app.click('.tabs [data-tab="findings"]');
  await app.waitForTimeout(500);
  assert.equal(await app.$$eval('.locked-card', (els) => els.length), 0);
  await app.click('.tabs [data-tab="ui"]');
  await app.waitForSelector('#tab-ui .ui-grid', { timeout: 15000 });
  await app.screenshot({ path: path.join(outDir, 'b6-pro-unlocked.png') });
  log('pro: all findings + UI unlocked; subscription row:', JSON.stringify(backend.subs.get('u1')));

  const r4 = await send({ type: 'START_SITE_AUDIT', urls: [], options: {} });
  log('site audit as Pro →', JSON.stringify(r4));
  assert.notEqual(r4.reason, 'pro_only');

  await popup.reload();
  await popup.waitForSelector('#planLine:not([hidden])');
  await popup.screenshot({ path: path.join(outDir, 'b7-popup-pro.png') });
  log('popup plan line:', (await popup.textContent('#planLine')).trim());
  log('PASS');
} catch (err) {
  console.error('[billing-e2e] FAIL', err);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(outDir, 'errors.txt'), errors.join('\n'));
  log(`console errors: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
  await context.close();
  backend.close();
}
