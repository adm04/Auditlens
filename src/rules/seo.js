// On-page SEO rules from the desktop snapshot. All OBSERVED (read from the page source
// as rendered). Search rankings depend on much more (links, content quality, intent);
// the report says so.

import { finding, strength, plural, quote } from './common.js';
import { platformTip } from './platform.js';

const G = 'https://developers.google.com/search/docs';

export function seoRules({ desktop: D, mobile: M, context }) {
  const s = D.seo;
  const out = [];
  const strengths = [];
  const { platform, pageType } = context;
  const meta = platformTip('meta', platform);

  // Indexing first: a noindex page can't rank at all.
  if (/noindex/i.test(s.robots)) {
    out.push(finding({
      ruleId: 'seo.noindex', area: 'SEO', lever: 'Visibility',
      title: 'Page is blocked from Google (noindex)',
      observation: `The robots meta tag says ${quote(s.robots)}.`,
      why: 'Search engines will drop this page from results, so it gets no organic traffic.',
      fix: [
        'If this page should appear in search, remove “noindex” from the robots meta tag (or the SEO plugin setting “Discourage search engines” / “Hide from search”).',
        'If it’s intentionally hidden (thank-you page, staging), ignore this finding.',
        'After fixing, request indexing in Google Search Console → URL Inspection.',
      ],
      evidence: 'OBSERVED', priority: 'P1', type: 'Quick win',
      refs: [{ label: 'Google: block indexing with noindex', url: `${G}/crawling-indexing/block-indexing` }],
    }));
  }

  // Title
  const tl = s.title.length;
  if (!tl) {
    out.push(finding({
      ruleId: 'seo.title-missing', area: 'SEO', lever: 'Visibility',
      title: 'Page has no title tag',
      observation: 'The page’s <title> is empty.',
      why: 'The title is the clickable headline in Google results and one of the strongest on-page relevance signals.',
      fix: ['Write a unique title of about 50–60 characters: main keyword first, then the benefit, then the brand.', 'Example pattern: “[Product/Service] for [Who] | [Brand]”.'],
      evidence: 'OBSERVED', priority: 'P1', type: 'Quick win', platformTip: meta,
      refs: [{ label: 'Google: title links', url: `${G}/appearance/title-link` }],
    }));
  } else if (tl < 30 || tl > 60) {
    out.push(finding({
      ruleId: 'seo.title-length', area: 'SEO', lever: 'Visibility',
      title: tl < 30 ? 'Title tag is too short' : 'Title tag is likely cut off in Google',
      observation: `The title is ${tl} characters: ${quote(s.title)}.`,
      why: tl < 30
        ? 'A short title wastes space that could carry your main keyword and a reason to click.'
        : 'Google usually shows about 50–60 characters; the rest is cut off, often losing the brand or benefit.',
      fix: ['Rewrite the title to about 50–60 characters.', 'Lead with the main keyword, add the benefit, end with the brand name.', 'Make it unique to this page (no duplicate titles across the site).'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win', platformTip: meta,
      refs: [{ label: 'Google: title links', url: `${G}/appearance/title-link` }],
    }));
  } else {
    strengths.push(strength('Title tag is a good length', `${tl} characters.`, 'Visibility'));
  }

  // Meta description
  const dl = s.metaDescription.length;
  if (!dl) {
    out.push(finding({
      ruleId: 'seo.description-missing', area: 'SEO', lever: 'Visibility',
      title: 'No meta description',
      observation: 'The page has no meta description.',
      why: 'Google may then pick a random snippet of text. A written description is your ad copy in search results and affects click-through rate.',
      fix: ['Write a 120–155 character description that states the benefit, includes the main keyword naturally, and ends with a reason to click.', 'Make it unique to this page.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win', platformTip: meta,
      refs: [{ label: 'Google: snippets and meta descriptions', url: `${G}/appearance/snippet` }],
    }));
  } else if (dl < 70 || dl > 160) {
    out.push(finding({
      ruleId: 'seo.description-length', area: 'SEO', lever: 'Visibility',
      title: dl < 70 ? 'Meta description is too short' : 'Meta description is likely cut off',
      observation: `The description is ${dl} characters.`,
      why: 'Descriptions around 120–155 characters show fully on most results and give enough room to persuade.',
      fix: ['Rewrite to about 120–155 characters with the benefit, keyword and a call to action.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', platformTip: meta,
    }));
  }

  // H1 and heading structure
  if (!s.h1s.length) {
    out.push(finding({
      ruleId: 'seo.h1-missing', area: 'SEO', lever: 'Visibility',
      title: 'No H1 heading',
      observation: 'The page has no visible <h1>.',
      why: 'The H1 tells search engines and screen-reader users what the page is about.',
      fix: ['Mark the main page headline as the single <h1>, including the page’s main topic or keyword.', 'Use H2s for section titles below it.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
    }));
  } else if (s.h1s.length > 1) {
    out.push(finding({
      ruleId: 'seo.h1-multiple', area: 'SEO', lever: 'Visibility',
      title: `Page has ${s.h1s.length} H1 headings`,
      observation: `Multiple H1s: ${s.h1s.slice(0, 3).map(quote).join(', ')}.`,
      why: 'One clear H1 makes the page’s main topic unambiguous; multiple H1s usually mean the heading structure follows styling, not meaning.',
      fix: ['Keep one H1 for the main headline.', 'Change the others to H2/H3 and style them with CSS classes instead.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  let skipped = 0, prev = 0;
  for (const h of s.headings) { if (prev && h.level > prev + 1) skipped++; prev = h.level; }
  if (skipped >= 2) {
    out.push(finding({
      ruleId: 'seo.heading-order', area: 'SEO', lever: 'Visibility',
      title: 'Heading levels skip around',
      observation: `Heading levels jump (e.g. H2 → H4) ${plural(skipped, 'time')}.`,
      why: 'A logical outline helps search engines and assistive tech understand the page structure.',
      fix: ['Use headings in order (H1 → H2 → H3) based on meaning, not size.', 'Control size with CSS classes.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  // Images alt
  if (s.images.missingAlt > 0) {
    out.push(finding({
      ruleId: 'seo.img-alt', area: 'SEO', lever: 'Visibility',
      title: `${plural(s.images.missingAlt, 'image')} missing alt text`,
      observation: `${s.images.missingAlt} of ${s.images.total} images have no alt attribute.`,
      why: 'Alt text helps images rank in Google Images and is how blind users understand them.',
      fix: ['Add short, descriptive alt text to meaningful images (what it shows + context, e.g. “Blue linen shirt, front view”).', 'Use alt="" for purely decorative images so screen readers skip them.'],
      evidence: 'OBSERVED', priority: s.images.missingAlt > 5 ? 'P2' : 'P3', type: 'Quick win',
      refs: [{ label: 'Google: image SEO', url: `${G}/appearance/google-images` }],
    }));
  }

  // Technical basics
  if (!s.viewport) {
    out.push(finding({
      ruleId: 'seo.viewport', area: 'SEO', lever: 'Visibility',
      title: 'No mobile viewport tag',
      observation: 'The page has no <meta name="viewport">.',
      why: 'Without it, phones render the desktop layout zoomed out. Google indexes the mobile version of pages.',
      fix: ['Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.'],
      evidence: 'OBSERVED', priority: 'P1', type: 'Quick win',
    }));
  }
  if (!s.lang) {
    out.push(finding({
      ruleId: 'seo.lang', area: 'SEO', lever: 'Visibility',
      title: 'Page language isn’t declared',
      observation: 'The <html> element has no lang attribute.',
      why: 'Declaring the language helps search engines serve the right audience and screen readers pronounce text correctly.',
      fix: ['Add the language to the html tag, e.g. <html lang="en"> (or en-IN, hi).'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  if (!s.canonical) {
    out.push(finding({
      ruleId: 'seo.canonical', area: 'SEO', lever: 'Visibility',
      title: 'No canonical URL',
      observation: 'The page has no <link rel="canonical">.',
      why: 'Without a canonical, URL variations (tracking parameters, http/https, trailing slashes) can split ranking signals across duplicates.',
      fix: ['Add a self-referencing canonical link pointing to the clean, preferred URL of this page.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', platformTip: meta,
      refs: [{ label: 'Google: canonical URLs', url: `${G}/crawling-indexing/consolidate-duplicate-urls` }],
    }));
  } else {
    try {
      const c = new URL(s.canonical), u = new URL(s.url);
      if (c.host !== u.host || c.pathname.replace(/\/$/, '') !== u.pathname.replace(/\/$/, '')) {
        out.push(finding({
          ruleId: 'seo.canonical-other', area: 'SEO', lever: 'Visibility',
          title: 'Canonical points to a different URL',
          observation: `This page’s canonical is ${s.canonical}.`,
          why: 'Google treats the canonical as the main version; this page itself may not be shown in results.',
          fix: ['Confirm this is intentional (e.g. a filtered or duplicate page).', 'If this page should rank on its own, make the canonical point to its own URL.'],
          evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
        }));
      }
    } catch { /* ignore malformed */ }
  }
  if (s.mixedContent > 0) {
    out.push(finding({
      ruleId: 'seo.mixed', area: 'SEO', lever: 'Trust',
      title: 'Insecure (http) files on a secure page',
      observation: `${plural(s.mixedContent, 'resource')} load over http:// on this https page.`,
      why: 'Browsers block or warn about mixed content, which can break images or scripts and look untrustworthy.',
      fix: ['Change those URLs to https:// (or protocol-relative) in the theme, content or database.', 'On WordPress, a search-and-replace for http://yourdomain helps.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
    }));
  }

  // Social sharing
  if (!s.og.title || !s.og.image) {
    out.push(finding({
      ruleId: 'seo.og', area: 'SEO', lever: 'Visibility',
      title: 'Link previews aren’t set up for social and WhatsApp',
      observation: `Missing Open Graph tags: ${[!s.og.title && 'og:title', !s.og.description && 'og:description', !s.og.image && 'og:image'].filter(Boolean).join(', ')}.`,
      why: 'When the page is shared on WhatsApp, LinkedIn or Facebook, a missing image or title makes the link look broken and get fewer clicks.',
      fix: ['Add og:title, og:description and og:image (1200×630px) meta tags.', 'Add twitter:card = summary_large_image.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', platformTip: meta,
    }));
  }

  // Structured data
  if (s.jsonldErrors) {
    out.push(finding({
      ruleId: 'seo.schema-invalid', area: 'SEO', lever: 'Visibility',
      title: 'Structured data has errors',
      observation: `${plural(s.jsonldErrors, 'JSON-LD block')} could not be parsed.`,
      why: 'Broken structured data is ignored, so rich results (stars, prices, FAQs) won’t show.',
      fix: ['Validate the page in Google’s Rich Results Test and fix the JSON syntax.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      refs: [{ label: 'Rich Results Test', url: 'https://search.google.com/test/rich-results' }],
    }));
  }
  const types = s.structuredData.map((t) => t.toLowerCase());
  if (pageType === 'product' && !types.some((t) => t.includes('product'))) {
    out.push(finding({
      ruleId: 'seo.schema-product', area: 'SEO', lever: 'Visibility',
      title: 'No Product structured data',
      observation: 'This looks like a product page but has no Product schema.',
      why: 'Product schema can show price, availability and review stars in Google, which raises click-through.',
      fix: ['Add Product JSON-LD with name, image, description, offers (price, currency, availability) and aggregateRating if you have real reviews.', 'Check it in the Rich Results Test.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win', platformTip: platformTip('schema', platform),
      refs: [{ label: 'Google: Product structured data', url: `${G}/appearance/structured-data/product` }],
    }));
  } else if (!types.length && !s.jsonldErrors) {
    out.push(finding({
      ruleId: 'seo.schema-none', area: 'SEO', lever: 'Visibility',
      title: 'No structured data',
      observation: 'No JSON-LD or microdata was found.',
      why: 'Structured data helps Google understand your business and can unlock rich results.',
      fix: ['Add Organization (or LocalBusiness) schema site-wide with name, logo, contact and social profiles.', 'Add page-specific types where they fit: Product, FAQPage, Article, BreadcrumbList.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', platformTip: platformTip('schema', platform),
    }));
  } else if (types.length && !s.jsonldErrors) {
    strengths.push(strength('Structured data present', `Types found: ${s.structuredData.slice(0, 6).join(', ')}.`, 'Visibility'));
  }

  // Content and links
  if (s.wordCount < 250 && ['home', 'landing', 'product', 'saas'].includes(pageType)) {
    out.push(finding({
      ruleId: 'seo.thin', area: 'SEO', lever: 'Visibility',
      title: 'Very little text on the page',
      observation: `About ${s.wordCount} words of visible text.`,
      why: 'Search engines need enough text to understand what the page offers and which searches it answers. Visitors also need answers to their questions.',
      fix: ['Add useful copy that answers what people search for: what it is, who it’s for, benefits, how it works, FAQs.', 'Write for people first; don’t pad with keywords.'],
      evidence: 'HEURISTIC', priority: 'P3', type: 'Quick win',
    }));
  }
  if (s.links.emptyAnchors > 0 || s.links.genericAnchors > 2) {
    out.push(finding({
      ruleId: 'seo.anchors', area: 'SEO', lever: 'Visibility',
      title: 'Links without descriptive text',
      observation: `${s.links.emptyAnchors ? `${plural(s.links.emptyAnchors, 'link')} have no text or label` : ''}${s.links.emptyAnchors && s.links.genericAnchors > 2 ? '; ' : ''}${s.links.genericAnchors > 2 ? `${s.links.genericAnchors} use generic text like ${s.links.genericExamples.map(quote).join(', ')}` : ''}.`,
      why: 'Link text tells Google and screen-reader users what the target page is about.',
      fix: ['Give icon links an aria-label (e.g. “Instagram”).', 'Replace “click here / read more” with descriptive text (“Read the sizing guide”).'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  // URL
  try {
    const u = new URL(s.url);
    const issues = [];
    if (/[A-Z]/.test(u.pathname)) issues.push('uppercase letters');
    if (/_/.test(u.pathname)) issues.push('underscores');
    if (u.pathname.length > 90) issues.push('a very long path');
    if (issues.length) {
      out.push(finding({
        ruleId: 'seo.url', area: 'SEO', lever: 'Visibility',
        title: 'URL could be cleaner',
        observation: `The URL path has ${issues.join(', ')}: ${u.pathname.slice(0, 90)}.`,
        why: 'Short, lowercase, hyphenated URLs are easier to read, share and remember.',
        fix: ['Use short lowercase URLs with hyphens (e.g. /linen-shirts).', 'If you change an existing URL, add a 301 redirect from the old one.'],
        evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      }));
    }
  } catch { /* ignore */ }

  return { findings: out, strengths };
}
