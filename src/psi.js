// Google PageSpeed Insights (Lighthouse run on Google's servers + Chrome UX Report field data).
//
// - Works only for pages Google can reach (public URLs, not localhost/staging behind login).
// - Sends ONLY the page URL to Google. No screenshots or page content leave the browser.
// - An API key is optional but strongly recommended: without one, Google's shared quota is
//   small and requests often fail with 429. Keys are free in Google Cloud Console.
//
// Lighthouse also runs accessibility checks (built on axe-core), so failing accessibility
// audits from PSI are reported as automated accessibility findings.

import { finding, strength } from './rules/common.js';
import { platformTip } from './rules/platform.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export function canUsePSI(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchPSI(url, strategy, apiKey, signal) {
  const params = new URLSearchParams({ url, strategy });
  for (const c of CATEGORIES) params.append('category', c);
  if (apiKey) params.set('key', apiKey);
  const res = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* ignore */ }
    if (res.status === 429) throw new Error('PageSpeed quota reached. Add a free PageSpeed API key in Settings, or try again later.');
    if (res.status === 400 && /unable to process|FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST/i.test(msg)) {
      throw new Error('Google couldn’t load this page (is it public and online?).');
    }
    throw new Error(`PageSpeed request failed (${res.status}): ${msg}`);
  }
  return res.json();
}

const FIELD_NAMES = {
  LARGEST_CONTENTFUL_PAINT_MS: { key: 'LCP', label: 'Largest Contentful Paint', unit: 'ms' },
  INTERACTION_TO_NEXT_PAINT: { key: 'INP', label: 'Interaction to Next Paint', unit: 'ms' },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { key: 'CLS', label: 'Cumulative Layout Shift', unit: 'cls' },
  FIRST_CONTENTFUL_PAINT_MS: { key: 'FCP', label: 'First Contentful Paint', unit: 'ms' },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { key: 'TTFB', label: 'Time to First Byte', unit: 'ms' },
};

function parseField(exp) {
  if (!exp || !exp.metrics) return null;
  const metrics = {};
  for (const [raw, m] of Object.entries(exp.metrics)) {
    const meta = FIELD_NAMES[raw];
    if (!meta) continue;
    const value = meta.unit === 'cls' ? m.percentile / 100 : m.percentile;
    metrics[meta.key] = { label: meta.label, value, unit: meta.unit, category: m.category };
  }
  return Object.keys(metrics).length ? { overall: exp.overall_category || '', metrics, id: exp.id || '' } : null;
}

const LAB = {
  'first-contentful-paint': 'FCP',
  'largest-contentful-paint': 'LCP',
  'total-blocking-time': 'TBT',
  'cumulative-layout-shift': 'CLS',
  'speed-index': 'SI',
};

/** Reduce the large PSI response to what the report needs. */
export function parsePSI(json, strategy) {
  const lh = json.lighthouseResult || {};
  const audits = lh.audits || {};
  const cats = lh.categories || {};
  const scores = {};
  for (const c of CATEGORIES) if (cats[c]) scores[c] = cats[c].score == null ? null : Math.round(cats[c].score * 100);

  const lab = {};
  for (const [id, key] of Object.entries(LAB)) {
    const a = audits[id];
    if (a) lab[key] = { label: a.title, display: a.displayValue || '', value: a.numericValue, score: a.score };
  }

  // Performance opportunities & diagnostics: anything scoring below 0.9 outside the metrics group.
  const perfRefs = cats.performance?.auditRefs || [];
  const opportunities = [];
  for (const ref of perfRefs) {
    if (ref.group === 'metrics') continue;
    const a = audits[ref.id];
    if (!a || a.score === null || a.score === undefined || a.score >= 0.9) continue;
    if (['notApplicable', 'manual', 'error'].includes(a.scoreDisplayMode)) continue;
    const savingsMs = a.details?.overallSavingsMs ?? Math.max(a.metricSavings?.LCP || 0, a.metricSavings?.FCP || 0, a.metricSavings?.TBT || 0);
    opportunities.push({
      id: a.id, title: a.title, description: a.description || '', display: a.displayValue || '',
      score: a.score, savingsMs: Math.round(savingsMs || 0), savingsBytes: a.details?.overallSavingsBytes || 0,
      items: (a.details?.items || []).slice(0, 4).map((it) => ({
        url: typeof it.url === 'string' ? it.url : (it.node?.snippet || it.source?.url || it.entity?.text || it.entity || ''),
        wastedBytes: it.wastedBytes || 0, wastedMs: it.wastedMs || 0,
      })).filter((it) => it.url),
    });
  }
  opportunities.sort((a, b) => (b.savingsMs - a.savingsMs) || (a.score - b.score));

  const failed = {};
  for (const c of ['accessibility', 'seo', 'best-practices']) {
    failed[c] = (cats[c]?.auditRefs || [])
      .map((ref) => audits[ref.id])
      .filter((a) => a && a.score !== null && a.score !== undefined && a.score < 1 && ['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode))
      .map((a) => ({
        id: a.id, title: a.title, description: a.description || '',
        count: a.details?.items?.length || 0,
        examples: (a.details?.items || []).slice(0, 3).map((it) => it.node?.snippet || it.node?.nodeLabel || it.url || '').filter(Boolean),
      }));
  }

  return {
    strategy,
    fetchedAt: Date.now(),
    finalUrl: lh.finalUrl || json.id || '',
    lighthouseVersion: lh.lighthouseVersion || '',
    runtimeError: lh.runtimeError?.message || '',
    scores,
    lab,
    field: parseField(json.loadingExperience),
    originField: json.loadingExperience?.metrics ? null : parseField(json.originLoadingExperience),
    opportunities: opportunities.slice(0, 14),
    failed,
  };
}

// ---- Plain-English fixes for Lighthouse audits ---------------------------------

const FIX = {
  images: {
    topic: 'images',
    steps: ['Resize images to about 2× their displayed size.', 'Convert to WebP or AVIF and compress (quality ~75–80).', 'Use srcset/sizes so phones get smaller files.'],
  },
  lazy: {
    topic: 'lazyload',
    steps: ['Add loading="lazy" to images below the first screen.', 'Keep the first-screen image eager with fetchpriority="high".'],
  },
  renderBlocking: {
    topic: 'render-blocking',
    steps: ['Inline the small amount of CSS needed for the first screen; load the rest without blocking.', 'Add defer to scripts in the <head> (or move them to the end of the body).', 'Self-host fonts and preload only the one or two used above the fold.'],
  },
  js: {
    topic: 'js',
    steps: ['Remove apps, plugins and tags you no longer use.', 'Load non-essential scripts (chat, reviews, pop-ups, heatmaps) after interaction or with a delay.', 'Split large bundles so each page loads only what it needs.'],
  },
  css: {
    topic: 'render-blocking',
    steps: ['Remove unused CSS (page builders and themes often ship styles for every widget).', 'Minify CSS and combine small files.'],
  },
  server: {
    topic: 'server',
    steps: ['Turn on full-page caching.', 'Put the site behind a CDN close to your visitors.', 'Avoid redirect chains (link directly to the final URL).', 'Upgrade hosting if response stays slow with caching on.'],
  },
  compression: {
    topic: 'caching',
    steps: ['Enable Brotli or Gzip compression on the server or CDN.'],
  },
  caching: {
    topic: 'caching',
    steps: ['Serve static files (images, CSS, JS, fonts) with long cache lifetimes (e.g. 1 year) and versioned file names.', 'A CDN like Cloudflare can set this for you.'],
  },
  fonts: {
    topic: 'fonts',
    steps: ['Add font-display: swap (or optional) to @font-face rules.', 'Limit to 2 families and the weights you use; self-host and preload the main one.'],
  },
  lcp: {
    topic: 'images',
    steps: ['Find the LCP element (usually the hero image or headline) in the PageSpeed report.', 'Make the hero image small and modern-format, never lazy-loaded, with fetchpriority="high".', 'Preload it if it’s a CSS background image, or switch it to an <img>.'],
  },
  cls: {
    topic: 'images',
    steps: ['Give images, videos and embeds width/height or aspect-ratio.', 'Reserve space for banners and cookie bars instead of pushing content down.', 'Avoid late-loading fonts that change text size.'],
  },
  thirdParty: {
    topic: 'js',
    steps: ['List each third-party script and its owner; remove what isn’t used.', 'Replace embeds (YouTube, maps, chat) with lightweight click-to-load placeholders.', 'Delay marketing tags until after the page is interactive.'],
  },
  dom: {
    topic: 'js',
    steps: ['Simplify the page structure: fewer nested wrappers, shorter carousels and mega-menus.', 'Load long lists/reviews in pages or on demand.'],
  },
  weight: {
    topic: 'images',
    steps: ['Start with images (usually the largest share), then fonts and JavaScript.', 'Aim for under ~2 MB per page.'],
  },
  preconnect: {
    topic: 'render-blocking',
    steps: ['Add <link rel="preconnect"> for the one or two critical third-party origins (font or image CDN).', 'Reduce chains of files that load other files before rendering.'],
  },
  interactivity: {
    topic: 'js',
    steps: ['Break long JavaScript tasks into smaller pieces.', 'Avoid reading layout (offsetHeight etc.) right after changing styles.', 'Remove heavy scripts that run on every click or scroll.'],
  },
};

const ID_TO_FIX = {
  'uses-optimized-images': 'images', 'modern-image-formats': 'images', 'uses-responsive-images': 'images',
  'efficient-animated-content': 'images', 'image-delivery-insight': 'images',
  'offscreen-images': 'lazy',
  'render-blocking-resources': 'renderBlocking', 'render-blocking-insight': 'renderBlocking',
  'unused-javascript': 'js', 'legacy-javascript': 'js', 'duplicated-javascript': 'js', 'legacy-javascript-insight': 'js',
  'duplicated-javascript-insight': 'js', 'bootup-time': 'js', 'mainthread-work-breakdown': 'js', 'unminified-javascript': 'js',
  'unused-css-rules': 'css', 'unminified-css': 'css',
  'server-response-time': 'server', 'document-latency-insight': 'server', 'redirects': 'server',
  'uses-text-compression': 'compression',
  'uses-long-cache-ttl': 'caching', 'cache-insight': 'caching',
  'font-display': 'fonts', 'font-display-insight': 'fonts',
  'largest-contentful-paint-element': 'lcp', 'lcp-lazy-loaded': 'lcp', 'prioritize-lcp-image': 'lcp',
  'lcp-discovery-insight': 'lcp', 'lcp-phases-insight': 'lcp', 'lcp-breakdown-insight': 'lcp',
  'layout-shifts': 'cls', 'cls-culprits-insight': 'cls', 'unsized-images': 'cls', 'layout-shift-elements': 'cls',
  'third-party-summary': 'thirdParty', 'third-parties-insight': 'thirdParty', 'third-party-facades': 'thirdParty',
  'dom-size': 'dom', 'dom-size-insight': 'dom',
  'total-byte-weight': 'weight',
  'uses-rel-preconnect': 'preconnect', 'network-dependency-tree-insight': 'preconnect', 'critical-request-chains': 'preconnect',
  'forced-reflow-insight': 'interactivity', 'inp-breakdown-insight': 'interactivity', 'long-tasks': 'interactivity',
};

/** Lighthouse descriptions are Markdown with [text](url) links; split into text + refs. */
export function splitMarkdown(md) {
  const refs = [];
  const text = String(md || '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, label, url) => {
    refs.push({ label, url });
    return label;
  }).replace(/`/g, '');
  return { text: text.trim(), refs };
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

function fieldCategoryText(cat) {
  return { FAST: 'good', AVERAGE: 'needs improvement', SLOW: 'poor' }[cat] || cat?.toLowerCase() || '';
}

/** Findings from PSI results (mobile preferred, desktop as fallback). */
export function psiFindings(psi, { platform } = {}) {
  const out = [];
  const strengths = [];
  const main = psi.mobile || psi.desktop;
  if (!main) return { findings: out, strengths };
  const label = main.strategy === 'mobile' ? 'mobile' : 'desktop';

  // Real-user data first (Chrome UX Report).
  const field = main.field || main.originField;
  if (field) {
    const scope = main.field ? 'this page' : 'your whole site (not enough data for this page alone)';
    const bad = ['LCP', 'INP', 'CLS'].map((k) => field.metrics[k]).filter((m) => m && m.category && m.category !== 'FAST' && m.category !== 'NONE');
    if (bad.length) {
      const list = bad.map((m) => `${m.label} ${m.unit === 'cls' ? m.value.toFixed(2) : fmtMs(m.value)} (${fieldCategoryText(m.category)})`).join('; ');
      out.push(finding({
        ruleId: 'psi.cwv-field', area: 'Speed', lever: 'Speed', source: 'psi',
        title: 'Real visitors experience slow Core Web Vitals',
        observation: `Chrome UX Report data for ${scope} on ${label} (75th percentile of real visits over the last 28 days): ${list}.`,
        why: 'These are real-user measurements Google uses as a ranking signal. Slow, jumpy or laggy pages lose visitors before they convert.',
        fix: ['Fix the largest PageSpeed opportunities below first; they target these metrics.', 'Re-check here after 28 days (field data is a rolling average).'],
        evidence: 'DATA', priority: bad.some((m) => m.category === 'SLOW') ? 'P1' : 'P2', type: 'Quick win',
        segment: label === 'mobile' ? 'Mobile' : 'Desktop',
        refs: [{ label: 'Core Web Vitals (web.dev)', url: 'https://web.dev/articles/vitals' }],
      }));
    } else {
      strengths.push(strength('Real visitors get good Core Web Vitals', `Chrome UX Report data for ${scope} on ${label} passes LCP, INP and CLS.`, 'Speed'));
    }
  }

  const perf = main.scores.performance;
  if (perf !== null && perf !== undefined && perf < 90) {
    out.push(finding({
      ruleId: 'psi.performance-score', area: 'Speed', lever: 'Speed', source: 'psi',
      title: `PageSpeed performance score is ${perf}/100 on ${label}`,
      observation: `Lighthouse lab test on ${label}: LCP ${main.lab.LCP?.display || '–'}, TBT ${main.lab.TBT?.display || '–'}, CLS ${main.lab.CLS?.display || '–'}.`,
      why: 'Slow pages lose visitors before they see the offer. The lab score is a simulated slow mobile connection, so it shows how the page feels on an average phone.',
      fix: ['Work through the opportunities in this report in order of estimated savings.', 'Re-run PageSpeed after each change to confirm the improvement.'],
      evidence: 'OBSERVED', priority: perf < 50 ? 'P1' : 'P2', type: 'Quick win',
      segment: label === 'mobile' ? 'Mobile' : 'Desktop',
    }));
  } else if (perf >= 90) {
    strengths.push(strength(`Strong PageSpeed score (${perf}/100 on ${label})`, 'The page performs well in Google’s lab test.', 'Speed'));
  }

  for (const o of main.opportunities.slice(0, 8)) {
    const key = ID_TO_FIX[o.id];
    const fx = FIX[key];
    const { text, refs } = splitMarkdown(o.description);
    out.push(finding({
      ruleId: `psi.${o.id}`, area: 'Speed', lever: 'Speed', source: 'psi',
      title: o.title,
      observation: [
        o.savingsMs ? `Estimated saving: ${fmtMs(o.savingsMs)}.` : '',
        o.display ? `${o.display}.` : '',
        o.items.length ? `Examples: ${o.items.map((i) => i.url.length > 70 ? `…${i.url.slice(-68)}` : i.url).join(', ')}.` : '',
      ].filter(Boolean).join(' ') || 'Flagged by PageSpeed Insights.',
      why: text,
      fix: fx ? fx.steps : ['Follow the guidance in the linked Lighthouse documentation.'],
      evidence: 'OBSERVED', priority: o.savingsMs >= 1000 || o.score < 0.5 ? 'P1' : o.savingsMs >= 300 ? 'P2' : 'P3', type: 'Quick win',
      segment: label === 'mobile' ? 'Mobile' : 'Desktop',
      refs,
      platformTip: fx ? platformTip(fx.topic, platform) : '',
    }));
  }

  // SEO audits not already covered by local rules.
  const localSeo = new Set(['document-title', 'meta-description', 'canonical', 'is-crawlable', 'link-text', 'image-alt', 'html-has-lang', 'viewport', 'crawlable-anchors']);
  for (const a of main.failed.seo || []) {
    if (localSeo.has(a.id)) continue;
    const { text, refs } = splitMarkdown(a.description);
    out.push(finding({
      ruleId: `psi.seo.${a.id}`, area: 'SEO', lever: 'Visibility', source: 'psi',
      title: a.title,
      observation: `Lighthouse SEO check failed${a.count ? ` (${a.count} item${a.count === 1 ? '' : 's'})` : ''}.${a.examples.length ? ` Example: ${a.examples[0].slice(0, 120)}` : ''}`,
      why: text, fix: ['Follow the linked Google guidance for this check.'],
      evidence: 'OBSERVED', priority: a.id === 'http-status-code' || a.id === 'robots-txt' ? 'P1' : 'P2', type: 'Quick win', refs,
    }));
  }

  // Accessibility (Lighthouse uses axe-core). Grouped into one finding per failing rule.
  for (const a of main.failed.accessibility || []) {
    const { text, refs } = splitMarkdown(a.description);
    const serious = /color-contrast|button-name|link-name|image-alt|label|aria-|document-title|html-has-lang|input-image-alt|select-name|frame-title/.test(a.id);
    out.push(finding({
      ruleId: `psi.a11y.${a.id}`, area: 'Accessibility', lever: 'Accessibility', source: 'psi',
      title: a.title,
      observation: `Automated accessibility check failed${a.count ? ` on ${a.count} element${a.count === 1 ? '' : 's'}` : ''}.${a.examples.length ? ` Example: ${a.examples[0].slice(0, 140)}` : ''}`,
      why: text,
      fix: ['Fix each listed element following the linked guidance.', 'Re-test with a keyboard and a screen reader; automated checks find only part of accessibility issues.'],
      evidence: 'OBSERVED', priority: serious ? 'P2' : 'P3', type: 'Quick win', refs,
    }));
  }

  return { findings: out, strengths };
}
