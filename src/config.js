// ─────────────────────────────────────────────────────────────────────────────
//  AuditLens configuration — the ONLY file you edit to connect your backend.
//  See SETUP.md for where each value comes from.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  // Supabase → Project Settings → API. The anon key is public by design (RLS protects data).
  SUPABASE_URL: '',          // e.g. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',     // e.g. 'eyJhbGciOi…'

  // Shown in the UI. Charging is configured in Dodo (product price), not here.
  PRO_PRICE_LABEL: '$10',
  PRO_PERIOD_LABEL: 'month',

  // Optional: your website pages linked from the sign-in screen.
  TERMS_URL: '',
  PRIVACY_URL: '',
};

// What each plan includes. FREE auditsPerMonth must match free_limit in the SQL migration.
export const PLANS = {
  free: {
    name: 'Free',
    auditsPerMonth: 3,
    findingsShown: 5,          // top findings shown in full; the rest are listed as locked
    siteAudits: false,
    uiReview: false,
    heatmap: false,
    exports: ['pdf'],          // watermarked, top findings only
    branding: false,
    ai: false,
  },
  pro: {
    name: 'Pro',
    auditsPerMonth: Infinity,
    findingsShown: Infinity,
    siteAudits: true,
    uiReview: true,
    heatmap: true,
    exports: ['pdf', 'html', 'csv', 'json'],
    branding: true,
    ai: true,
  },
};

export const PRO_FEATURES = [
  'Unlimited in-depth audits',
  'Every finding with step-by-step fixes',
  'Audit up to 10 pages of a site at once',
  'UI elements review (buttons, fonts, colours)',
  'Predicted attention heatmaps',
  'PDF, HTML, CSV & JSON exports without watermark',
  'Your logo and colours on client reports',
  'AI copy suggestions',
];

/** True when no backend is configured: everything runs locally (for development and tests). */
export const DEV_MODE = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;
