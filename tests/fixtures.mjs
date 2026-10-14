// Fixture snapshots shaped exactly like collector.collect() output.

export function snapshot(overrides = {}) {
  const vw = overrides.vw || 1440, vh = overrides.vh || 900;
  const base = {
    url: 'https://shop.example.com/products/linen_Shirt',
    host: 'shop.example.com',
    title: 'Shirt',
    capturedAt: Date.now(),
    viewport: { w: vw, h: vh, dpr: 2 },
    pageHeight: vh * 5,
    platform: 'Shopify',
    pageType: 'product',
    businessModel: 'ecommerce',
    fold: { headline: 'The breathable linen shirt you will live in all summer long, from beach to boardroom and back', headlineWords: 18, headlineFontSize: 40, headingCount: 1 },
    ctas: [
      { text: 'Submit', tag: 'button', rect: { x: 900, y: vh + 200, w: 200, h: 36 }, inFold: false, filled: true, inNav: false, generic: true, bgContrast: 1.2, textContrast: 3.1, fontSize: 14, sticky: false, selector: 'button.btn', href: '', prominence: 9000 },
      { text: 'Menu', tag: 'button', rect: { x: 20, y: 20, w: 60, h: 30 }, inFold: true, filled: false, inNav: true, generic: false, bgContrast: null, textContrast: 12, fontSize: 14, sticky: false, selector: 'header button', href: '', prominence: 100 },
    ],
    forms: [
      { fieldCount: 8, required: 5, unlabeled: 3, unlabeledExamples: ['Name', 'Email', 'Phone'], kinds: ['text', 'tel'], emailWrongType: 1, hasEmail: true, hasPhone: true, autocomplete: 0, submitText: 'Submit', isSearch: false, incentive: false, rect: { x: 100, y: 2000, w: 600, h: 500 } },
      { fieldCount: 1, required: 0, unlabeled: 0, unlabeledExamples: [], kinds: ['email'], emailWrongType: 0, hasEmail: true, hasPhone: false, autocomplete: 1, submitText: 'Subscribe', isSearch: false, incentive: false, rect: { x: 100, y: 4200, w: 600, h: 100 } },
    ],
    signals: {
      reviews: false, ratingSchema: false, guarantee: false, shipping: false, security: false, contact: false, phoneLink: false,
      policies: { privacy: true, returns: false, shipping: false, terms: true }, press: false, customerCount: '', urgency: 'Only 3 left',
      chat: false, search: false, priceCount: 2, priceExamples: ['₹1,999'], addToCart: true, freeTrial: false, demo: false, quote: false, faq: false, video: false,
    },
    seo: {
      title: 'Shirt', metaDescription: '', canonical: '', robots: 'index,follow', viewport: 'width=device-width', lang: '', charset: 'UTF-8', favicon: true,
      og: { title: '', description: '', image: '', type: '' }, twitterCard: '', hreflang: 0,
      headings: [{ level: 1, text: 'Linen shirt', y: 100 }, { level: 1, text: 'Other', y: 300 }, { level: 4, text: 'x', y: 500 }, { level: 2, text: 'y', y: 600 }, { level: 5, text: 'z', y: 700 }],
      h1s: ['Linen shirt', 'Other'], structuredData: [], jsonldErrors: 1,
      images: { total: 20, missingAlt: 7, missingAltExamples: ['a.jpg'] },
      links: { internal: 40, external: 5, nofollow: 0, emptyAnchors: 2, genericAnchors: 4, genericExamples: ['read more'] },
      mixedContent: 1, wordCount: 180, url: 'https://shop.example.com/products/linen_Shirt',
    },
    readability: { paragraphs: 20, medianFontSize: 13, longParagraphs: 4, longExample: 'Lorem ipsum…', wideLines: 1, lowContrast: [{ text: 'Free returns', ratio: 2.4, fontSize: 12, rect: { x: 10, y: 400, w: 120, h: 16 }, selector: 'p.muted' }] },
    images: { total: 20, oversized: 6, oversizedExamples: ['hero.jpg (4000px shown at 600px)'], noDimensions: 5, eagerOffscreen: 6, lazyInFold: 1, legacyFormat: 10 },
    perf: { ttfb: 1200, domContentLoaded: 2500, load: 6000, htmlBytes: 80000, requests: 140, jsBytes: 2_000_000, cssBytes: 300_000, imgBytes: 5_000_000, totalBytes: 9_000_000, thirdPartyDomains: 22, sizesKnown: true, lcp: 5200, lcpElement: 'img.hero', cls: 0.31 },
    navLinks: 60,
    salient: [
      { kind: 'heading', rect: { x: 100, y: 120, w: 700, h: 120 }, fontSize: 40 },
      { kind: 'image', rect: { x: 760, y: 80, w: 640, h: 760 } },
      { kind: 'cta', rect: { x: 900, y: vh + 200, w: 200, h: 36 }, contrast: 1.2, filled: true, inNav: false },
      { kind: 'text', rect: { x: 100, y: 300, w: 560, h: 120 }, fontSize: 16 },
      { kind: 'logo', rect: { x: 20, y: 20, w: 120, h: 40 } },
    ],
    redactions: [],
    textSample: '',
    ui: {
      fonts: [{ value: 'Georgia', count: 40 }, { value: 'Arial', count: 12 }, { value: 'Poppins', count: 8 }, { value: 'Roboto', count: 5 }],
      fontSizes: [44, 32, 28, 24, 22, 20, 18, 17, 16, 15, 14, 13, 12].map((value) => ({ value, count: 3 })),
      textColors: Array.from({ length: 10 }, (_, i) => ({ value: `rgb(${i * 20}, 0, 0)`, count: 3 })),
      headingSizes: { h1: 32, h2: 36, h3: 20 },
      buttonStyles: Array.from({ length: 6 }, (_, i) => ({ bg: `rgb(${i * 30}, 80, 80)`, color: '#fff', radius: [0, 4, 8, 999, 12, 2][i], height: 40, fontSize: 14, fontWeight: '600', count: 2, example: `Btn ${i}`, rect: { x: 10, y: 100 * i, w: 120, h: 40 } })),
      radii: [0, 4, 8, 'pill', 12],
      iconOnly: [{ rect: { x: 1300, y: 20, w: 32, h: 32 }, selector: 'button.icon', html: '<button class="icon">' }],
      hiddenLinks: 3, hiddenLinkExamples: ['sizing guide'],
      distorted: [{ rect: { x: 0, y: 900, w: 300, h: 100 }, src: 'x.jpg' }],
      tiny: 8, tinyExamples: [{ text: 'Terms apply', size: 10, rect: { x: 0, y: 0, w: 50, h: 10 } }],
      centred: 3, tight: 5, paraCount: 8,
      fieldHeights: [32, 40, 48],
      ctaCount: 1,
    },
    links: [{ url: 'https://shop.example.com/products/linen_Shirt', path: '/products/linen_Shirt', label: 'Shirt', score: 99, where: 'current' }],
    overlays: [{ share: 45, text: 'Get 10% off your first order', isCookie: false, selector: 'div.popup', rect: { x: 0, y: 0, w: vw, h: vh } }],
  };
  return { ...base, ...overrides };
}

export function psiSample() {
  return {
    lighthouseResult: {
      finalUrl: 'https://shop.example.com/products/linen_Shirt',
      lighthouseVersion: '12.8.0',
      categories: {
        performance: { score: 0.38, auditRefs: [{ id: 'largest-contentful-paint', group: 'metrics' }, { id: 'image-delivery-insight' }, { id: 'render-blocking-insight' }, { id: 'unused-javascript' }, { id: 'dom-size-insight' }] },
        accessibility: { score: 0.81, auditRefs: [{ id: 'color-contrast', weight: 7 }, { id: 'button-name', weight: 10 }] },
        'best-practices': { score: 0.96, auditRefs: [] },
        seo: { score: 0.83, auditRefs: [{ id: 'document-title' }, { id: 'robots-txt' }] },
      },
      audits: {
        'largest-contentful-paint': { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', displayValue: '6.1 s', numericValue: 6100, score: 0.1, scoreDisplayMode: 'numeric' },
        'first-contentful-paint': { id: 'first-contentful-paint', title: 'First Contentful Paint', displayValue: '2.9 s', numericValue: 2900, score: 0.5, scoreDisplayMode: 'numeric' },
        'total-blocking-time': { id: 'total-blocking-time', title: 'Total Blocking Time', displayValue: '780 ms', numericValue: 780, score: 0.3, scoreDisplayMode: 'numeric' },
        'cumulative-layout-shift': { id: 'cumulative-layout-shift', title: 'Cumulative Layout Shift', displayValue: '0.21', numericValue: 0.21, score: 0.4, scoreDisplayMode: 'numeric' },
        'speed-index': { id: 'speed-index', title: 'Speed Index', displayValue: '5.0 s', numericValue: 5000, score: 0.4, scoreDisplayMode: 'numeric' },
        'image-delivery-insight': { id: 'image-delivery-insight', title: 'Improve image delivery', description: 'Reducing the download time of images can improve load time. [Learn more](https://developer.chrome.com/docs/performance/insights/image-delivery)', score: 0, scoreDisplayMode: 'metricSavings', metricSavings: { LCP: 1850, FCP: 0 }, details: { type: 'table', items: [{ url: 'https://cdn.example.com/hero.jpg', wastedBytes: 900000 }] } },
        'render-blocking-insight': { id: 'render-blocking-insight', title: 'Render blocking requests', description: 'Requests are blocking the page\'s initial render. [Learn more](https://developer.chrome.com/docs/performance/insights/render-blocking)', score: 0.5, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 600, LCP: 600 }, details: { items: [] } },
        'unused-javascript': { id: 'unused-javascript', title: 'Reduce unused JavaScript', description: 'Reduce unused JavaScript. [Learn how](https://developer.chrome.com/docs/lighthouse/performance/unused-javascript/)', score: 0.3, scoreDisplayMode: 'metricSavings', displayValue: 'Est savings of 420 KiB', details: { overallSavingsMs: 450, overallSavingsBytes: 430000, items: [{ url: 'https://shop.example.com/app.js' }] } },
        'dom-size-insight': { id: 'dom-size-insight', title: 'Optimize DOM size', description: 'A large DOM.', score: null, scoreDisplayMode: 'informative' },
        'color-contrast': { id: 'color-contrast', title: 'Background and foreground colors do not have a sufficient contrast ratio.', description: 'Low-contrast text is difficult to read. [Learn how](https://dequeuniversity.com/rules/axe/4.10/color-contrast)', score: 0, scoreDisplayMode: 'binary', details: { items: [{ node: { snippet: '<p class="muted">Free returns</p>' } }] } },
        'button-name': { id: 'button-name', title: 'Buttons do not have an accessible name', description: 'Buttons need names.', score: 0, scoreDisplayMode: 'binary', details: { items: [{ node: { snippet: '<button class="icon">' } }, { node: { snippet: '<button>' } }] } },
        'document-title': { id: 'document-title', title: 'Document has a title', score: 1, scoreDisplayMode: 'binary' },
        'robots-txt': { id: 'robots-txt', title: 'robots.txt is not valid', description: 'If your robots.txt file is malformed… [Learn more](https://developer.chrome.com/docs/lighthouse/seo/invalid-robots-txt/)', score: 0, scoreDisplayMode: 'binary', details: { items: [{}, {}] } },
      },
    },
    loadingExperience: {
      id: 'https://shop.example.com/products/linen_Shirt',
      overall_category: 'SLOW',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4300, category: 'SLOW' },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15, category: 'AVERAGE' },
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'AVERAGE' },
      },
    },
  };
}
