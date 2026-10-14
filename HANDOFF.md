# AuditLens — Engineering Handoff

> Read this first. Written for an AI coding agent (Antigravity) and any developer continuing the project. It covers what exists, how it works, the rules you must not break, how to test, and what to build next.

---

## 1. Product in one paragraph

AuditLens is a Chrome extension (Manifest V3) for **UX/UI designers, freelancers and agencies** who audit client websites. On any public page the user clicks **Audit this page**. The extension then:

1. captures the page on desktop and in a real 390px mobile window (full-page, scrolled and stitched);
2. reads the page's headings, buttons, forms, trust signals, SEO tags, images and load timing;
3. runs **Google PageSpeed Insights** (performance, Core Web Vitals, SEO, accessibility);
4. draws a **predicted attention heatmap**;
5. produces findings with **clear how-to-fix steps**, ranked P1–P3, split into quick wins and A/B tests;
6. exports a branded **client report** (PDF, HTML) plus CSV/JSON.

The CRO logic follows the owner's CRO skill (`ultimate-cro-skill`), summarised in §6.

This is a sibling product to **StepCapture** (client handoff guides). Both share the same stack, coding style, AI module and payment plan.

---

## 2. Status (v0.3.0)

| Area | Status |
|---|---|
| Popup: page type, page goal, mobile/PSI toggles, progress, recent audits | ✅ |
| **Multi-page site audit (v0.2):** finds main pages from header/nav/main/footer links, lets the user pick up to 10, audits each in its own window, then opens a site overview | ✅ tested (5-page test site) |
| **Site overview + site report (v0.2):** "Fix once, improve every page" (issues on 2+ pages), pages table, PageSpeed for all pages (mobile, 2 at a time), combined PDF/HTML/CSV | ✅ tested |
| **UI elements review (v0.2):** button styles (with screenshot crops), fonts, type scale, heading hierarchy, text colours, icon-only buttons, hidden links, stretched images, tiny text, line height, centred paragraphs, form field sizes → UI tab, ~15 UI rules, report section | ✅ tested |
| **Plain language (v0.2):** every finding has an "In simple words" line (editable), jargon replaced in titles/fixes (quoted page text untouched), glossary in reports | ✅ unit-tested |
| Desktop capture: scroll, stitch, hide sticky elements after the first screen, blur emails/card numbers | ✅ tested |
| Pop-up handling: keep one evidence shot, then hide it so the page and heatmap show the real layout | ✅ tested |
| Mobile capture in a 390px popup window (auto-corrects window chrome) | ✅ tested |
| Page collector (CRO signals, CTAs, forms, readability, contrast, SEO, images, perf, platform) | ✅ tested |
| CRO rules (~30), SEO rules (~20), local speed rules (~10) | ✅ unit-tested |
| PageSpeed Insights client, parser and findings (field data = DATA, opportunities with fixes, a11y + SEO audits) | ✅ unit-tested with a fixture. ⚠️ Not yet run against the live API from this environment |
| Platform-specific fix tips (WordPress, WooCommerce, Shopify, Webflow, Wix, Squarespace, Framer, Next.js) | ✅ |
| Predicted attention heatmap (model, render, attention by screen, CTA rank) | ✅ tested |
| Attach real heatmap screenshots (Clarity/Hotjar) | ✅ |
| Workspace tabs: Overview, Findings (edit/filter/add), Heatmap, Speed, SEO, CRO checklist, Report | ✅ tested |
| Report: HTML + PDF (print) with page numbers; CSV; JSON | ✅ tested (26-page sample PDF) |
| AI (bring your own key): verdict writer, copy suggestions | ✅ code complete. ⚠️ Not tested with a real key |
| **Accounts (v0.3):** Google sign-in (chrome.identity + Supabase OAuth), email sign-up/sign-in/reset (Supabase Auth REST, no library) | ✅ email flow e2e-tested against a mock backend. ⚠️ Google flow needs real credentials to test |
| **Plans & payments (v0.3):** Free (3 audits/month, top 5 findings) vs Pro $10/month via Dodo Payments: checkout, signed webhook, customer portal, server-side usage counting | ✅ e2e-tested with mock Supabase + signed Dodo webhook. ⚠️ Not yet run against real Dodo test mode |
| Cloud sync of audits | ❌ (audits stay local by design) |
| axe-core in-page accessibility scan | ❌ (accessibility currently comes from Lighthouse via PSI, which uses axe-core) |
| Nielsen heuristics checklist, side panel, element picker | ❌ (see §9) |

---

## 3. Stack and constraints

- Plain JavaScript ES modules, HTML, CSS. **No build step, no npm dependencies at runtime.** Load the folder unpacked.
- MV3 service worker (`type: module`).
- **Storage:**
  - IndexedDB `auditlens` holds audits, including screenshot blobs.
  - `chrome.storage.local` holds `settings`, `plan` and `ai`.
  - `chrome.storage.session` holds `run`, the progress of the current audit.
- **Permissions:** `storage`, `unlimitedStorage`, `scripting`, `tabs`, and host `<all_urls>`. Host access is needed to inject the collector into any page, capture tabs, and call the PSI and AI APIs from extension pages.
- Minimum Chrome version is 116. Page numbers in the PDF need Chrome 131+, because they use `@page` margin boxes; older Chrome prints without numbers.

---

## 4. File map

```
auditlens/
├── manifest.json
├── src/
│   ├── background.js     Capture orchestration: desktop + mobile, stitching, progress, opens workspace
│   ├── collector.js      Injected into the audited page: returns the snapshot (see §5.3)
│   ├── db.js             IndexedDB (audits)
│   ├── analyze.js        Snapshot (+PSI) → findings, strengths, checklist pre-fill, counts
│   ├── rules/
│   │   ├── common.js     Finding schema, evidence labels, levers, page types, sorting
│   │   ├── cro.js        Conversion rules (from the CRO skill)
│   │   ├── ui.js         UI element rules (buttons, type, colour, icons, links, images, fields)
│   │   ├── plain.js      "In simple words" lines, jargon replacement, glossary
│   │   ├── seo.js        On-page SEO rules
│   │   ├── speed.js      Browser-measured speed rules (for non-public pages)
│   │   └── platform.js   "On Shopify/WordPress/… do this" tips per topic
│   ├── psi.js            PageSpeed Insights fetch/parse/findings + plain-English fix library
│   ├── heatmap.js        Predicted attention model (pure) + canvas renderer
│   ├── checklists.js     CRO page checklists (Global + per page type) with auto pre-fill
│   ├── report.js         Report HTML builder (pure string)
│   ├── exporters.js      CSV + JSON
│   ├── config.js         Supabase URL/anon key, plan limits, prices shown — the only file to edit when connecting the backend
│   ├── auth.js           Supabase Auth over REST: Google (launchWebAuthFlow), email sign-up/in, reset, refresh, api()
│   ├── ui/account-ui.js  Shared sign-in form + upgrade panel (popup and workspace); ui/account.css
│   ├── ai.js             Provider calls (Anthropic / OpenAI / Gemini), BYOK — shared with StepCapture
│   ├── ai-audit.js       Audit prompts: verdict + copy suggestions
│   ├── settings.js       Branding, PSI key, defaults
│   └── entitlements.js   Plan gating stub — plug payments in here
├── popup/                Toolbar popup
├── app/                  Workspace (app.html / app.css / app.js)
├── icons/
├── tests/
│   ├── run-tests.mjs     Node unit tests (22): rules, UI rules, plain language, site summary, reports, PSI, heatmap, exports
│   ├── e2e-site.mjs      Playwright multi-page run: discovery → site audit → site view → UI tab → site report
│   ├── fixtures.mjs      Snapshot + PSI fixtures
│   └── e2e.mjs           Playwright end-to-end: loads the extension, audits a page, screenshots, exports
├── backend/supabase/
│   ├── migrations/…_billing.sql   profiles, subscriptions, audit_usage, webhook_events, RLS, get_plan(), consume_audit()
│   └── functions/
│       ├── _shared/billing.js     Standard Webhooks verification + Dodo event → plan mapping (pure, unit-tested)
│       ├── create-checkout/       Dodo checkout session (metadata.user_id)
│       ├── dodo-webhook/          verifies signature, idempotent, updates subscriptions
│       ├── customer-portal/       Dodo billing portal link
│       └── checkout-done/         simple "you're on Pro" page after payment
├── SETUP.md                       step-by-step: Supabase, Google OAuth, Dodo, deploy, go live
├── HANDOFF.md
└── README.md
```

---

## 5. How it works

### 5.1 Flow

```
popup ──START_AUDIT {tabId, options}──▶ background.runAudit
  captureView(desktop tab)
    inject collector → prepare() (metrics + overlays at load)
    if a pop-up covers ≥30% of the screen: capture it once (overlayShot) → hideOverlays()
    for each screen (max 12): scrollTo → wait → (from screen 2: hideFixed) → captureVisibleTab
    showFixed → scrollTo(0) → collect() → stitch frames on OffscreenCanvas → blur sensitive rects → JPEG
  captureMobile: windows.create(popup, ~390px) → wait for load → resize to exactly 390 → captureView → close
  save audit {status:'analyzing'} → open app/app.html?audit=ID&fresh=1
app.js
  analyze() → findings/strengths/checklist → status 'ready'
  if options.psi: fetch PSI mobile + desktop in parallel (in the page, not the SW) → re-analyze (keeps auditor edits)
```

PSI runs in the workspace page because MV3 service workers can be suspended during long fetches (PSI takes 15–60 s).

### 5.2 Messages

| Message | Direction | Response |
|---|---|---|
| `START_AUDIT {tabId, options:{mobile, psi, pageType, conversion}}` | popup → SW | `{ok}` or `{ok:false,error}` |
| `GET_RUN` | any → SW | current `run` |
| `AUDIT_PROGRESS {run}` | SW → pages (broadcast) | — |

### 5.3 Snapshot (collector output, per view)

All rects are in **CSS pixels, document coordinates** (scrollY = 0). Key fields:

- `viewport {w,h,dpr}`, `pageHeight`, `platform`, `pageType`, `businessModel`
- `fold {headline, headlineWords, headlineFontSize, headingCount}`
- `ctas[] {text, rect, inFold, filled, inNav, generic, bgContrast, textContrast, sticky, prominence}`. This excludes navigation icons, dismiss/cookie buttons and anything inside a pop-up.
- `forms[] {fieldCount, required, unlabeled, emailWrongType, autocomplete, incentive, isSearch, rect}`
- `signals {reviews, ratingSchema, guarantee, shipping, security, contact, policies{…}, press, customerCount, urgency, chat, search, priceCount, addToCart, freeTrial, demo, quote, faq, video}`
- `seo {title, metaDescription, canonical, robots, viewport, lang, og{}, headings[], h1s[], structuredData[], jsonldErrors, images{}, links{}, mixedContent, wordCount}`
- `readability {medianFontSize, longParagraphs, lowContrast[]}`, `images {oversized, legacyFormat, eagerOffscreen, lazyInFold, noDimensions}`
- `perf {ttfb, lcp, cls, requests, totalBytes, jsBytes, imgBytes, thirdPartyDomains, sizesKnown}`
- `salient[]`: elements for the heatmap; `redactions[]`: areas to blur; `overlays[]`: pop-ups at load.

The screenshot is stored as `view.shot` (Blob) and described by `view.shotMeta {k, cssWidth, cssHeight, viewportHeight, screens, truncated}`. `k` is screenshot pixels per CSS pixel.

### 5.4 Finding schema

See `rules/common.js`:

```
{ id:'F-03', ruleId, area:'CRO'|'SEO'|'Speed'|'Accessibility', title, observation, why, fix:[steps],
  lever, evidence:'DATA'|'OBSERVED'|'HEURISTIC'|'HYPOTHESIS', priority:'P1'|'P2'|'P3',
  type:'Quick win'|'A/B test', hypothesis?, metric?, impact:'H'|'M'|'L', confidence:'H'|'M'|'L',
  segment:'All'|'Mobile'|'Desktop', element?{view, rect, label}, refs[], platformTip?,
  source:'auto'|'psi'|'manual', status:'open'|'progress'|'fixed'|'wontfix', include, note, edited? }
```

Re-analysis (after a context change or a PSI run) keeps edits. A finding with `edited: true` is kept whole. For the others, status, priority, type, include and note carry over. Manual findings are always kept.

### 5.5 Heatmap model (`heatmap.js`)

This is a heuristic attention model, **not visitor data**, and it is labelled that way everywhere. It does the following:

- Each salient element adds a Gaussian blob to an 8px grid.
- Weights depend on element type: headings by font size, buttons by fill and contrast, images by size, plus video, logo, inputs and text. Text is weighted towards its left edge.
- The result is multiplied by a position prior that favours the top of the page and its left side.

It outputs:

- attention share per screen;
- a first-screen ranking with labels;
- `sumIn(rect)`.

`attentionInsights()` gives the main CTA's rank. If the CTA ranks below #5, a HYPOTHESIS finding is raised. To improve the model later, tune the weights in `weightFor()` and keep the unit tests passing.

### 5.6 PageSpeed Insights

- Endpoint `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed` with `url`, `strategy` (mobile/desktop), four `category` params and an optional `key`. It only works on public URLs; `canUsePSI()` blocks localhost and private IP ranges.
- `parsePSI()` keeps scores, lab metrics, field data (`loadingExperience`, falling back to `originLoadingExperience`), performance opportunities (any audit scoring under 0.9 outside the metrics group), and failed SEO/accessibility/best-practices audits.
- `ID_TO_FIX` maps Lighthouse audit IDs, both classic and newer `*-insight` IDs, to plain-English steps and a platform tip topic. **When Lighthouse adds or renames audits, extend this map.** Unknown IDs fall back to the Lighthouse description and its links.
- Real-user Core Web Vitals get evidence `DATA`. When PSI has run, local LCP/CLS estimates are dropped to avoid duplicates.

### 5.7 Multi-page site audits (v0.2)

```
popup "Main pages of this site" ──DISCOVER_PAGES {tabId}──▶ SW → collector.discoverLinks()
  scoring: header/nav +3, main +1, footer +1, important words (about, pricing, services, shop, contact…) +2,
  deeper paths −1, max 2 product pages; login/cart/checkout/policy/legal/search/files excluded
popup ──START_SITE_AUDIT {tabId, urls[], options}──▶ SW.runSiteAudit
  new normal window sized like the user's window (createWindow() falls back if bounds don't fit the screen)
  for each URL: navigate → wait for load → capturePage() (desktop + optional mobile) → audit {siteId}
  site record {id, host, title, pageIds[], errors[], status} in IndexedDB store "sites" (DB v2)
  → app.html?site=ID&fresh=1 → analyse each page → site overview → PageSpeed queue (mobile only, 2 parallel)
```

- `siteSummary(audits)` in `analyze.js` groups findings by `ruleId`; a rule on 2+ pages is **site-wide** (fix once in the template).
- `buildSiteReport()` in `report.js` covers: cover → summary → pages table → fix once → page by page (only page-specific issues, with a thumbnail and a mobile heatmap) → UI elements → what to test (deduped) → quick wins → data to collect → glossary → methodology.
- Page audits inside a site are ordinary audits with `siteId`, so every page tab (findings, UI, heatmap, speed, SEO, checklist, report) still works per page, with a "← site" link.
- Limits: max 10 pages per run; no crawling beyond links on the starting page; pages behind login are skipped by URL filter only if their path says so.

### 5.8 UI elements and plain language (v0.2)

- `collector.collectUI()` returns `snapshot.ui`: `buttonStyles[]` (grouped by colour, radius, height, weight, text colour, with an example rect for screenshot crops), `fonts`, `fontSizes`, `textColors`, `headingSizes`, `radii`, `iconOnly[]`, `hiddenLinks`, `distorted[]`, `tiny`, `centred`, `tight`, `fieldHeights`. Pop-up content is excluded.
- `rules/ui.js` turns it into findings with `area: 'UI'`. Thresholds:
  - more than 4 button styles;
  - more than 3 fonts;
  - more than 10 text sizes;
  - more than 8 text colours;
  - heading levels inverted.
  Tune these on real sites.
- `rules/plain.js` handles the plain-language layer:
  - `simpleFor()` gives each rule an "In simple words" line; PageSpeed IDs are matched by pattern.
  - `applyPlainLanguage()` swaps jargon (CTA → button, above the fold → first screen…) in titles, explanations and fix steps, but never inside quoted page text “…” and never in findings the auditor edited.
  - `GLOSSARY` prints at the end of every report.
- **When you add a rule, add its line to `SIMPLE`**. A unit test fails if any auto finding lacks one.

### 5.9 Accounts and payments (v0.3)

**Read SETUP.md for configuration.** Architecture:

- **Developer mode:** when `CONFIG.SUPABASE_URL` is empty, `DEV_MODE` is true. There is no sign-in, the plan comes from the local "simulate Pro" switch, and usage is counted locally. All existing tests run in this mode.
- **Sessions:** `auth.js` stores the session in `chrome.storage.local.session` and refreshes it 60 s before expiry. Google sign-in runs in the service worker (`AUTH_GOOGLE` message), so it survives the popup closing.
- **Plan check:** `entitlements.getEntitlement()` calls the `get_plan()` RPC and caches the result for 5 minutes. If the server is unreachable, the last known plan is kept for up to 7 days.
- **Audit permits:** the service worker calls `consume_audit(kind)` before every `START_AUDIT` / `START_SITE_AUDIT`. It replies `{allowed:false, reason:'signin'|'limit'|'pro_only'|'error'}` and the popup shows sign-in or upgrade accordingly.
- **Checkout:** `create-checkout` → Dodo `POST /checkouts` with `metadata.user_id` → the user pays → Dodo sends `subscription.active` → `dodo-webhook`:
  - verifies the Standard Webhooks signature;
  - records `webhook-id` for idempotency;
  - finds the user from metadata, then the subscription id, then the email;
  - upserts `subscriptions`.

  The workspace polls `get_plan` every 5 s (`waitForPro`) and re-checks on window focus, so Pro unlocks without a reload.
- **How each Dodo event changes the plan** (see `mapSubscriptionEvent`):
  - `active`, `renewed` or `plan_changed` → Pro.
  - `on_hold` or `past_due` → keeps the plan; the UI warns that payment failed.
  - `cancelled` → keeps Pro until `current_period_end`.
  - `expired` or `failed` → Free.
- `is_pro()` adds a 3-day grace period after `current_period_end`.
- **Free-plan gating in the UI:**
  - `unlockedIds()` exposes the top `PLANS.free.findingsShown` findings; the others render as locked cards.
  - The UI and heatmap tabs show `lockedPanel()`.
  - The PDF contains only unlocked findings plus a "N more findings" callout.
  - HTML/CSV/JSON exports, site exports, site PageSpeed and AI open the upgrade dialog.
- **Tests:** `tests/mock-backend.mjs` mirrors the Supabase and Dodo contracts and signs its webhook with the real `billing.js`. `tests/e2e-billing.mjs` covers the whole path: sign-up → free limits → upgrade → webhook → Pro.

---

## 6. CRO method (from the owner's skill)

The rules and report follow the skill. Keep these principles intact:

- **Evidence labels** on every finding: DATA / OBSERVED / HEURISTIC / HYPOTHESIS. Never present a heuristic as fact.
- **Levers:** friction, motivation, urgency, clarity, trust, authority, social proof, reciprocity, product discovery, AOV. Each finding names one.
- **Priority:** P1 / P2 / P3. **Quick win vs A/B test:** safe, obvious fixes ship directly; changes that could plausibly hurt conversion go through a test and carry a hypothesis and a primary metric.
- **Mobile first.** Desktop and mobile are separate segments.
- **No traffic data → rank by impact × confidence** and say so. Never invent conversion rates, lifts or visitor behaviour. Typical test win rate is 30–40%, and the report says this.
- **Ethical urgency only.** Urgency copy is flagged for verification.
- **Report template order:** Snapshot → Evidence & limits → Strengths → Ranked findings → Finding details → (Heatmap, Speed, SEO) → A/B test plan → Quick wins → Copy ideas → Checklist → Data to collect next → Methodology.

**Rights note for the owner:** the skill is a summary of *The Ultimate Guide to CRO* by Stuti Kathuria and was written for personal use. Before selling AuditLens commercially, confirm you're comfortable with how closely the checklists and wording follow the book (the code paraphrases it and doesn't credit the book inside the product), or rewrite those parts in your own words.

---

## 7. Rules — do not break

1. **Privacy:**
   - Screenshots and DOM data never leave the device.
   - Only the page URL goes to Google (PSI), and only text facts go to the AI provider (`ai-audit.js` → `facts()`).
   - Emails and card numbers are blurred in screenshots before storage.
   - Never read or store form values except to find areas to blur.
2. **Honesty:**
   - Predicted heatmaps are always labelled as predictions.
   - Automated accessibility results are never presented as compliance.
   - "Not detected" wording is used for DOM-detected absences.
   - AI output is labelled and editable, and the AI never generates data.
3. **No remote code.** Bundle any library locally (MV3).
4. **Captures happen only on an explicit user action.** No background browsing capture.
5. **One coordinate system:** CSS px in document coordinates. Convert with `shotMeta.k` only when drawing.
6. Keep `analyze()` and the rules **pure** so `node tests/run-tests.mjs` keeps working.
7. The **"Developer: simulate Pro"** switch only works in DEV_MODE (no backend configured). Remove it before publishing anyway.
8. **Never put the Supabase service role key or Dodo API key in the extension.** They live only in Edge Function secrets.

---

## 8. Testing

```bash
node tests/run-tests.mjs                       # 26 unit tests (incl. webhook signatures + plan mapping), no browser needed

# End-to-end (needs Playwright + Chromium; serve any test page locally first)
python3 -m http.server 8765 --directory <folder-with-a-test-page>
PLAYWRIGHT_PATH=<path-to-playwright> node tests/e2e.mjs <path-to-auditlens> http://localhost:8765/ ./e2e-out
PLAYWRIGHT_PATH=<path-to-playwright> node tests/e2e-site.mjs <path-to-auditlens> http://localhost:8765/ ./e2e-site-out   # multi-page
PLAYWRIGHT_PATH=<path-to-playwright> node tests/e2e-billing.mjs <path-to-auditlens> http://localhost:8765/some-page.html ./e2e-bill-out   # accounts + payments (mock backend on :8790)
```

For the site test, the served folder needs a few pages that link to each other through a shared header (home, about, services, product, contact).

The e2e run produces screenshots of every tab, `report.html`, `report.pdf`, `findings.csv`, `findings.json` and `errors.txt`.

**Manual checks** (things automation can't cover here):

1. Audit a real public page (a Shopify store and a WordPress site). PageSpeed should finish in under a minute. Try it without a PSI key (quota errors are handled) and with one.
2. Try a page with a cookie banner, a newsletter pop-up, a sticky header and a chat bubble. Check that the stitched screenshot has no repeated headers and the pop-up evidence shot exists.
3. Try an infinite-scroll page and a page with an internal scroll container. Both should capture the first screens and show a "long page" notice; neither should hang.
4. Settings → AI key → Test → **Write with AI** (Overview) and **Suggest copy** (SEO).
5. Export PDF on Chrome 131+ and check that page numbers appear and nothing is clipped.
6. Keyboard only: Tab through the popup and workspace, use arrow keys on the tabs, open the More menu, and close it with Escape.

---

## 9. Roadmap (priority order)

1. **Stabilise on real sites** using §8. Tune rule thresholds where they're noisy (e.g. `cro.cta-contrast`, `seo.thin`).
2. **Connect the real backend** with SETUP.md, then run the test-mode checklist there. Next: an annual plan (add a second Dodo product, and a `plan` value per product in `mapSubscriptionEvent`), team seats, and a 7-day trial (`subscription_data.trial_period_days` in create-checkout).
3. **axe-core in-page scan:** vendor `axe.min.js` (npm `axe-core`) into `src/vendor/`, inject it after the collector, and map violations to Accessibility findings, keeping axe's impact levels and WCAG tags. This gives accessibility results for staging/localhost pages where PSI can't run.
4. **Element picker + manual evidence:** pick an element on the live page, capture it, and create a manual finding with a highlight. This would reuse StepCapture's highlight drawing.
5. **Nielsen heuristics checklist** as a second checklist tab (Pass / Needs improvement / Failed / N/A).
6. **Side panel** (`chrome.sidePanel`) for working alongside the live page.
7. **Re-audit and compare:** run again after fixes and show fixed / new / still-open (for sites too).
7b. **Sitemap discovery:** read /sitemap.xml to suggest pages not linked from the menu (needs a fetch from the extension page, same-origin rules permitting).
8. **Competitor matrix:** audit 3–5 competitor URLs and compare which elements each has (per the skill's competitor step).
9. **Real heatmap tracking:** an optional snippet for sites the user owns. This needs a backend and consent, and is a separate project.
10. Shareable report link (Supabase Storage, rendered/redacted images only).

---

## 10. Chrome Web Store notes

- **Single purpose:** "Audit web pages for conversion, SEO and speed issues and export reports."
- **Permission justifications:**
  - `<all_urls>` + `scripting`: read and capture the page the user chooses to audit.
  - `tabs`: open the mobile view window and the report.
  - `storage` / `unlimitedStorage`: local audits and screenshots.
- **Privacy policy must disclose:** the URL is sent to Google PageSpeed when enabled; text is sent to the user's chosen AI provider when they add a key; nothing else leaves the device.
- Provide 1280×800 screenshots, a 440×280 promo tile, and bump the version for each upload.
