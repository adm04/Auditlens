// Speed findings from what the browser measured during this page load (not PageSpeed).
// These work on staging/localhost pages that PageSpeed Insights can't reach. They are
// one load on the auditor's machine, so they're labelled OBSERVED with that caveat.

import { finding, strength, plural } from './common.js';
import { platformTip } from './platform.js';

const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function speedRules({ desktop: D, context }) {
  const out = [];
  const strengths = [];
  const { platform } = context;
  const p = D.perf || {};
  const img = D.images || {};
  const note = 'Measured in your browser for this one page load (your network and cache affect it).';

  if (img.oversized > 0) {
    out.push(finding({
      ruleId: 'speed.img-oversized', area: 'Speed', lever: 'Speed',
      title: `${plural(img.oversized, 'image')} much larger than displayed`,
      observation: `${img.oversized} images are over twice the size they’re shown at${img.oversizedExamples?.length ? `, e.g. ${img.oversizedExamples[0]}` : ''}.`,
      why: 'Oversized images are usually the biggest cause of slow pages, especially on mobile data. Slower pages convert worse.',
      fix: [
        'Resize images to about 2× their largest displayed width (e.g. 1600px for a full-width hero, 800px for a card).',
        'Serve modern formats (WebP or AVIF) and compress (quality ~75–80).',
        'Use srcset/sizes so phones download smaller versions.',
      ],
      evidence: 'OBSERVED', priority: img.oversized >= 5 ? 'P1' : 'P2', type: 'Quick win',
      platformTip: platformTip('images', platform),
    }));
  }
  if (img.legacyFormat >= 5) {
    out.push(finding({
      ruleId: 'speed.img-format', area: 'Speed', lever: 'Speed',
      title: 'Images use older formats (JPG/PNG)',
      observation: `${img.legacyFormat} images appear to be JPG/PNG/GIF rather than WebP/AVIF.`,
      why: 'WebP/AVIF are typically 25–50% smaller at the same quality, so pages load faster.',
      fix: ['Convert images to WebP or AVIF (most CMSs and CDNs can do this automatically).', 'Keep PNG only where transparency is needed and WebP can’t be used.'],
      evidence: 'HEURISTIC', priority: 'P3', type: 'Quick win',
      platformTip: platformTip('images', platform),
    }));
  }
  if (img.eagerOffscreen >= 4) {
    out.push(finding({
      ruleId: 'speed.lazy', area: 'Speed', lever: 'Speed',
      title: 'Images far down the page load immediately',
      observation: `${img.eagerOffscreen} images more than two screens down are not lazy-loaded.`,
      why: 'They compete for bandwidth with the content visitors see first, slowing the first screen.',
      fix: ['Add loading="lazy" to images below the first screen.', 'Keep the hero image eager and add fetchpriority="high" to it.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      platformTip: platformTip('lazyload', platform),
    }));
  }
  if (img.lazyInFold > 0) {
    out.push(finding({
      ruleId: 'speed.lazy-hero', area: 'Speed', lever: 'Speed',
      title: 'First-screen image is lazy-loaded',
      observation: `${plural(img.lazyInFold, 'image')} on the first screen use loading="lazy".`,
      why: 'Lazy-loading the hero delays the Largest Contentful Paint, the main “page looks loaded” moment.',
      fix: ['Remove loading="lazy" from the hero/first-screen image and add fetchpriority="high".'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      platformTip: platformTip('lazyload', platform),
    }));
  }
  if (img.noDimensions >= 3) {
    out.push(finding({
      ruleId: 'speed.img-dimensions', area: 'Speed', lever: 'Speed',
      title: 'Images without width and height cause layout jumps',
      observation: `${img.noDimensions} images have no width/height or aspect-ratio.`,
      why: 'The page jumps as images load (layout shift), which makes people mis-tap and feels broken.',
      fix: ['Add width and height attributes (or CSS aspect-ratio) to every image so space is reserved.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  if (p.ttfb > 800) {
    out.push(finding({
      ruleId: 'speed.ttfb', area: 'Speed', lever: 'Speed',
      title: 'Server responds slowly',
      observation: `Time to first byte was ${p.ttfb} ms. ${note}`,
      why: 'Everything else waits for the server. Over ~800 ms is slow and delays the whole page.',
      fix: ['Enable full-page caching.', 'Use a CDN (e.g. Cloudflare) close to your visitors.', 'Upgrade hosting if the server is under-powered; reduce heavy plugins/apps.'],
      evidence: 'OBSERVED', priority: p.ttfb > 1800 ? 'P1' : 'P2', type: 'Quick win',
      platformTip: platformTip('server', platform),
    }));
  }
  if (p.lcp && p.lcp > 4000) {
    out.push(finding({
      ruleId: 'speed.lcp-local', area: 'Speed', lever: 'Speed',
      title: 'Main content appears late',
      observation: `Largest Contentful Paint was ${(p.lcp / 1000).toFixed(1)} s${p.lcpElement ? ` (element: ${p.lcpElement})` : ''}. ${note}`,
      why: 'Google considers over 4 s poor. Visitors see a blank or half-loaded page and leave.',
      fix: ['Make the hero image small, modern-format and high priority (fetchpriority="high", not lazy).', 'Reduce render-blocking CSS/JS in the <head>.', 'Check PageSpeed Insights for the exact causes.'],
      evidence: 'OBSERVED', priority: 'P1', type: 'Quick win',
    }));
  }
  if (p.cls > 0.25) {
    out.push(finding({
      ruleId: 'speed.cls-local', area: 'Speed', lever: 'Speed',
      title: 'The layout jumps while loading',
      observation: `Cumulative Layout Shift was ${p.cls}. ${note}`,
      why: 'Shifting content causes mis-taps and frustration; above 0.25 is “poor” by Google’s standards.',
      fix: ['Reserve space for images, embeds and ads with width/height or aspect-ratio.', 'Don’t insert banners above existing content after load.', 'Use font-display: optional or matched fallback fonts to avoid text reflow.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
    }));
  }
  if (p.sizesKnown && p.totalBytes > 4 * 1024 * 1024) {
    out.push(finding({
      ruleId: 'speed.weight', area: 'Speed', lever: 'Speed',
      title: 'Page is heavy to download',
      observation: `About ${kb(p.totalBytes)} transferred across ${p.requests} requests (images ${kb(p.imgBytes)}, JavaScript ${kb(p.jsBytes)}). ${note}`,
      why: 'Heavy pages are slow on mobile data and cost visitors money on metered plans.',
      fix: ['Compress and resize images first (usually the biggest win).', 'Remove unused apps/plugins and third-party scripts.', 'Aim for under ~2 MB for a typical landing page.'],
      evidence: 'OBSERVED', priority: p.totalBytes > 8 * 1024 * 1024 ? 'P1' : 'P2', type: 'Quick win',
      platformTip: platformTip('js', platform),
    }));
  }
  if (p.thirdPartyDomains > 15) {
    out.push(finding({
      ruleId: 'speed.third-party', area: 'Speed', lever: 'Speed',
      title: 'Many third-party services load on this page',
      observation: `Requests went to ${p.thirdPartyDomains} other domains (analytics, chat, ads, fonts, apps).`,
      why: 'Each third party adds connections and script work that delay the page, and A/B testing/tracking tools add up.',
      fix: ['List every third-party tool and remove ones nobody uses.', 'Load chat, review and marketing widgets after user interaction or a delay.', 'Use one tag manager and audit it quarterly.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      platformTip: platformTip('js', platform),
    }));
  }

  if (p.lcp && p.lcp <= 2500) strengths.push(strength('Main content loads quickly in this browser', `LCP ${(p.lcp / 1000).toFixed(1)} s on this load.`, 'Speed'));
  return { findings: out, strengths };
}
