# AuditLens — CRO, UI, SEO & speed audits (v0.3)

Audit any public web page for conversion problems, SEO gaps and slow loading. You get a predicted attention heatmap, clear fix steps for every issue, and a client-ready report.

## Install

1. Unzip, open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose the `auditlens` folder. Pin the icon.

## Use

1. Open the page you want to audit.
2. Click AuditLens. Pick the page type and goal (or leave **Detect automatically**).
3. Press **Audit this page**.
4. Keep the tab in front for about 20–40 seconds while the page scrolls. A narrow mobile window opens briefly.
5. The workspace opens with tabs for **Overview**, **Findings**, **Heatmap**, **Speed**, **SEO**, **CRO checklist** and **Report**.
6. Edit anything: priorities, wording, fix steps, status. You can also add your own findings and attach real heatmap screenshots.
7. Export as **PDF**, **HTML**, **CSV** (for Trello/Jira/ClickUp) or **JSON**.

## Audit a whole site

1. In the popup, choose **Main pages of this site**.
2. AuditLens lists the pages it found in the menu and footer. Untick any you don't need (up to 10).
3. Press **Audit N pages**. A separate window opens and goes through each page; leave it alone until the overview opens.
4. The site overview shows:
   - **Fix once, improve every page:** issues that repeat across pages.
   - Each page's own findings: click a page to open it.
   - One combined **site report** to export as PDF, HTML or CSV.

## Plain language and UI elements

- Every finding starts with **In simple words**, a one-line explanation a client can understand. You can edit it.
- The **UI elements** tab shows your buttons, fonts, text sizes and colours, and says what "good" looks like.
- Every report ends with a glossary of the technical terms it uses.

## Plans

- **Free:** sign in with Google or email. 3 single-page audits a month, the top 5 findings with fixes, PageSpeed scores and a watermarked PDF.
- **Pro, $10/month:** unlimited audits, every finding, whole-site audits, the UI elements review, heatmaps, all exports without a watermark, your branding and AI copy suggestions. Billed through Dodo Payments; cancel any time from **Manage subscription**.

Setting up sign-in and payments: see **SETUP.md**. Without it, the extension runs in developer mode with no sign-in, and you can simulate Pro in Settings.

## Optional keys (Settings)

- **PageSpeed Insights API key** (free from Google). Without one, Google's shared quota often runs out.
- **AI key** (Anthropic, OpenAI or Gemini). Writes the summary and suggests headlines, button labels and SEO tags. Only text is sent.

## Good to know

- **The heatmap is a prediction** based on layout. Confirm it with real data, such as Microsoft Clarity, which is free.
- **PageSpeed works only on public URLs.** Local and staging pages still get every other check.
- **The mobile view is a 390px browser window.** PageSpeed's mobile test uses true phone emulation.
- **Everything stays on your computer** except the URL, which is sent to Google if PageSpeed is on, and text, which is sent to your AI provider if you add a key.

Developers: see **HANDOFF.md**. Run `node tests/run-tests.mjs` for the unit tests.
