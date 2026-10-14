# AuditLens — CRO, UI, SEO & Speed Audits

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests Passing](https://img.shields.io/badge/tests-26%20passed-brightgreen.svg)](tests/run-tests.mjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Author](https://img.shields.io/badge/author-Arkadeb%20Mondal-orange.svg)](https://github.com/adm04)

AuditLens is a powerful, local-first Chrome extension (Manifest V3) built for **UX/UI designers, conversion rate optimization (CRO) specialists, freelancers, and agencies** who audit client websites. 

With one click, AuditLens analyses any public web page for conversion friction, usability flaws, SEO gaps, and performance bottlenecks. It generates a **predicted attention heatmap**, categorizes actionable findings with **plain-English fix steps**, and exports **client-ready branded reports** (PDF, HTML, CSV, JSON).

---

## 🚀 Key Features

- **In-Depth Page Audits:**
  - Automated full-page scroll capture on desktop and an authentic 390px mobile viewport.
  - Automatically handles sticky navigation bars, cookie banners, and pop-ups without duplicating headers.
  - Sensitive data blurring (emails, card numbers, form inputs) done client-side before storage.
- **Predicted Attention Heatmaps:**
  - Layout-based visual attention simulation using Gaussian distribution modeling.
  - Generates attention share per viewport screen and ranks call-to-action (CTA) visibility.
- **Multi-Page Site Audits:**
  - Automatically discovers primary navigation and footer links (up to 10 pages).
  - Audits each page and summarizes site-wide template issues: *"Fix once, improve every page"*.
- **UI Elements Review:**
  - Inspects button consistency (crops, colors, padding, corner radii), font families, type scales, heading hierarchy, contrast, and field sizing.
- **Plain-Language Recommendations:**
  - Every technical finding includes an *"In simple words"* summary that non-technical clients can understand.
  - Clear P1–P3 prioritization, categorized into **Quick Wins** and **A/B Tests** with hypotheses and primary metrics.
  - Automated glossary of CRO and web performance terminology in every report.
- **Google PageSpeed Insights & Core Web Vitals:**
  - Retrieves mobile and desktop lab scores, field data (CWV: LCP, CLS, INP), and Lighthouse diagnostic fixes.
- **Platform-Specific Guidance:**
  - Tailored recommendations for Shopify, WooCommerce, WordPress, Webflow, Framer, Wix, Squarespace, and Next.js.
- **Client-Ready Reports & Exports:**
  - Printable, publication-ready PDF reports with proper page numbering (Chrome 131+ margin boxes).
  - Standalone HTML reports, CSVs (for Jira, Trello, ClickUp, Linear), and raw JSON data.
- **AI-Powered Assistance (BYOK):**
  - Bring your own API key (Anthropic Claude, OpenAI GPT-4, or Google Gemini) for automated executive summaries and copy recommendations.
- **Accounts & Monetization Ready:**
  - Supabase Auth (Google OAuth & Email sign-in) + Dodo Payments subscription integration ($10/mo Pro tier with server-side usage gating).

---

## 🛠️ Architecture & Tech Stack

- **Zero-Build Vanilla ES Modules:** Pure JavaScript, HTML5, and CSS3. No Webpack, Vite, or npm runtime dependencies.
- **Manifest V3 Compliant:** Modular service worker background orchestration, offscreen canvas stitching, and content script injection.
- **Local-First Storage:**
  - `IndexedDB` (`auditlens`): Stores full audit runs, findings, and stitched screenshot blobs locally on the user's machine.
  - `chrome.storage.local`: Manages user settings, authentication sessions, and cached entitlements.
- **Strict Privacy Guarantees:**
  - Screenshots and DOM data **never leave the user's machine**.
  - Only public URLs are sent to Google PageSpeed Insights, and only sanitized text excerpts are sent to user-configured AI providers.

---

## 📦 Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/adm04/Auditlens.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the `auditlens` folder.
5. Pin **AuditLens** to your Chrome toolbar for quick access.

---

## 🎯 How to Use

1. Navigate to the website you want to audit.
2. Click the **AuditLens** icon in your toolbar.
3. Select the page type (e.g., E-commerce Product, SaaS Landing Page, Lead Gen) or leave on **Detect automatically**.
4. Click **Audit this page**.
5. Keep the browser tab focused for 20–40 seconds while AuditLens scrolls, captures desktop & mobile views, and gathers diagnostics.
6. The interactive workspace opens automatically with tabs for:
   - **Overview:** Executive summary, health scores, and key strengths.
   - **Findings:** Filter, edit, prioritize (P1–P3), or add manual findings.
   - **UI Elements:** Button design catalog, typography scale, and color palette audit.
   - **Heatmap:** Predicted attention distribution and CTA rankings.
   - **Speed:** Google PageSpeed Insights & Core Web Vitals breakdown.
   - **SEO:** On-page metadata, canonical tags, structured data, and OpenGraph checks.
   - **CRO Checklist:** Comprehensive conversion checklist pre-filled from DOM data.
   - **Report:** Generate and export your customized client report.

---

## 🧪 Running Tests

AuditLens features a complete, standalone Node.js test suite with zero external test runner dependencies:

```bash
# Run all 26 unit and integration tests
npm test
# or
node tests/run-tests.mjs
```

### End-to-End Testing (Playwright)
```bash
# Start a local HTTP server serving a test site
python -m http.server 8765 --directory tests/fixtures

# Run single-page E2E test
node tests/e2e.mjs . http://localhost:8765/ ./e2e-out

# Run multi-page site E2E test
node tests/e2e-site.mjs . http://localhost:8765/ ./e2e-site-out

# Run billing & account flow E2E test
node tests/e2e-billing.mjs . http://localhost:8765/ ./e2e-bill-out
```

---

## 📁 Repository Structure

```
Auditlens/
├── manifest.json              # Chrome Extension MV3 Manifest
├── package.json               # Package metadata and test scripts
├── LICENSE                    # MIT License
├── README.md                  # Project overview and documentation
├── SETUP.md                   # Backend setup guide (Supabase + Dodo Payments)
├── HANDOFF.md                 # Engineering handoff and architecture guide
├── popup/                     # Toolbar popup interface
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── app/                       # Main AuditLens workspace and report app
│   ├── app.html
│   ├── app.css
│   └── app.js
├── src/                       # Core extension logic (ES Modules)
│   ├── background.js          # Service worker orchestration & capture
│   ├── collector.js           # In-page DOM inspector & metric collector
│   ├── analyze.js             # Finding synthesis & scoring engine
│   ├── rules/                 # Domain-specific rule suites (CRO, UI, SEO, Speed)
│   ├── psi.js                 # PageSpeed Insights client & parser
│   ├── heatmap.js             # Predicted attention model & canvas renderer
│   ├── checklists.js          # CRO heuristic evaluation checklists
│   ├── report.js              # Client report generation engine
│   ├── auth.js                # Supabase Auth client (REST)
│   ├── config.js              # Global configuration & plan definitions
│   └── db.js                  # Local IndexedDB persistence layer
├── backend/                   # Cloud backend & serverless functions
│   └── supabase/
│       ├── migrations/        # SQL schema (profiles, subscriptions, permits)
│       └── functions/         # Edge Functions (Dodo webhook, checkout session)
└── tests/                     # Test fixtures and test runners
```

---

## 📄 License & Copyright

**Copyright © 2026 Arkadeb Mondal ([@adm04](https://github.com/adm04)). All rights reserved.**

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
