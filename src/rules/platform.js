// Platform-specific "how to do it here" tips, shown under a finding's fix steps when
// the collector detects the site's platform. Keep tips general and durable: name the
// setting or approach, not version-specific menu paths that change often.

const TIPS = {
  images: {
    WordPress: 'Install an image optimisation plugin (for example ShortPixel, Imagify or EWWW) to compress existing uploads and serve WebP/AVIF, and upload images no wider than about 2× their displayed size.',
    WooCommerce: 'Use an image optimisation plugin to compress product photos and serve WebP/AVIF, and set sensible product image sizes in WooCommerce settings so themes don’t load originals.',
    Shopify: 'In the theme code, output images with the image_url filter and a width (plus image_tag with sizes) so Shopify’s CDN sends a right-sized WebP/AVIF; avoid uploading 4000px+ originals for small slots.',
    Webflow: 'In the Assets panel, compress images and convert them to WebP/AVIF; Webflow builds responsive versions automatically for images placed through the Designer.',
    Wix: 'Upload images close to their display size; Wix serves optimised formats automatically, so focus on removing oversized background images and heavy galleries.',
    Squarespace: 'Upload images at most about 2500px wide; Squarespace creates responsive sizes, so the gain comes from smaller originals and fewer full-bleed images.',
    Framer: 'Use Framer’s image settings to set resolution to Auto and avoid very large originals; Framer serves optimised formats from its CDN.',
    'Next.js': 'Use next/image with explicit sizes so Next serves responsive WebP/AVIF, and mark only the hero image as priority.',
  },
  lazyload: {
    WordPress: 'WordPress lazy-loads images by default; make sure the hero/first image is excluded (loading="eager", fetchpriority="high") and that a page builder isn’t overriding it.',
    Shopify: 'In theme sections, add loading="lazy" to images below the first screen and keep the first image eager with fetchpriority="high".',
    Webflow: 'Set image Load to "Lazy" for everything below the first screen and "Eager" for the hero in the image settings panel.',
    'Next.js': 'next/image lazy-loads by default; add priority only to the above-the-fold hero image.',
  },
  js: {
    WordPress: 'Remove plugins you don’t use, and use a performance plugin (for example WP Rocket, Perfmatters or LiteSpeed Cache) to delay non-critical JavaScript until user interaction.',
    WooCommerce: 'Stop cart fragments and marketing scripts loading on pages that don’t need them (a performance plugin can unload scripts per page).',
    Shopify: 'Uninstall unused apps (they often leave scripts behind), check theme.liquid for leftover app snippets, and load non-essential widgets after interaction.',
    Webflow: 'Remove unused custom code embeds and interactions, and move third-party scripts to load with defer.',
    Wix: 'Remove unused apps and heavy animations; each app adds JavaScript to every page.',
    'Next.js': 'Use dynamic imports for heavy components, check the bundle analyzer, and load third-party scripts with next/script strategy="lazyOnload".',
  },
  'render-blocking': {
    WordPress: 'Use a performance plugin to inline critical CSS and defer the rest, and to defer non-essential JavaScript.',
    Shopify: 'Load app and theme scripts with defer, and avoid render-blocking web-font stylesheets in theme.liquid.',
    Webflow: 'Move custom scripts from the head to the end of body or add defer; keep custom code in the head to the minimum.',
  },
  caching: {
    WordPress: 'Enable page caching (via your host or a caching plugin) and put the site behind a CDN such as Cloudflare.',
    Shopify: 'Shopify handles caching and CDN; focus on theme and app weight instead.',
    Webflow: 'Webflow hosting includes a CDN; focus on image and script weight instead.',
  },
  server: {
    WordPress: 'Slow first-byte time on WordPress usually means no page cache, slow hosting or heavy plugins; enable full-page caching and consider better hosting.',
    WooCommerce: 'Cart and checkout pages can’t be fully cached, so database health and hosting quality matter; remove heavy plugins from these pages.',
  },
  fonts: {
    WordPress: 'Host Google Fonts locally (many themes and performance plugins have an option) and limit to two families and a few weights.',
    Shopify: 'Use fonts from Shopify’s font library through theme settings rather than extra external font stylesheets, and limit weights.',
    Webflow: 'Upload only the weights you use and set font-display to swap in the font settings.',
  },
  meta: {
    WordPress: 'Set the SEO title and meta description in an SEO plugin (for example Yoast SEO or Rank Math) for this page.',
    WooCommerce: 'Set product SEO titles and descriptions in your SEO plugin’s box on the product edit screen.',
    Shopify: 'Edit the page or product, scroll to “Search engine listing”, and set the page title and meta description.',
    Webflow: 'Open Page settings → SEO settings and fill in the title tag and meta description (CMS pages can use fields).',
    Wix: 'Open the page’s SEO Basics settings to set the title and description.',
    Squarespace: 'Open the page settings → SEO tab to set the SEO title and description.',
    Framer: 'Open the page settings and fill in the title and description under SEO.',
  },
  schema: {
    WordPress: 'Your SEO plugin can add Organization, Product and FAQ schema; review plugins can add AggregateRating.',
    Shopify: 'Most current Shopify themes output Product schema; review apps usually add rating schema. Check in Google’s Rich Results Test.',
    Webflow: 'Add JSON-LD in Page settings → Custom code (CMS fields can fill product names, prices and ratings).',
  },
  reviews: {
    WordPress: 'Add a reviews plugin or embed real Google reviews, and show the rating near the main CTA.',
    WooCommerce: 'Turn on product reviews (Settings → Products), ask past buyers for photo reviews, and show stars on product cards.',
    Shopify: 'Use a reviews app (for example Judge.me or Loox) and show the star summary under the product title.',
    Webflow: 'Add a CMS collection for testimonials or embed a reviews widget, and place ratings near CTAs.',
  },
  'sticky-cta': {
    Shopify: 'Many themes have a “sticky add to cart” option in the product section settings; otherwise a lightweight app can add one.',
    WooCommerce: 'Use your theme’s sticky add-to-cart option or a small plugin; test it on mobile only first.',
    Webflow: 'Add a fixed-position bar shown on mobile breakpoints only, revealed with an interaction after the main CTA scrolls out of view.',
    WordPress: 'Use your page builder’s sticky/fixed section on mobile breakpoints, containing the primary CTA.',
  },
  forms: {
    WordPress: 'In your form plugin (Gravity Forms, WPForms, Contact Form 7 etc.), remove optional fields, add visible labels, and set the email field type to Email.',
    Webflow: 'In the form block, give every input a visible label, set the right field type (Email, Tel), and remove fields you don’t act on.',
    Shopify: 'Edit the contact or newsletter form section to remove optional fields and use type="email" for email inputs.',
    Wix: 'Edit the form in the Wix Forms editor: remove optional fields and show field titles above inputs.',
  },
  popups: {
    WordPress: 'In your pop-up plugin, delay the pop-up (exit intent or after 30–50% scroll), and never show it on mobile before the first interaction.',
    Shopify: 'In your pop-up app settings, delay the pop-up, disable it on mobile entry, and make the close button large.',
  },
};

export function platformTip(topic, platform) {
  if (!topic || !platform) return '';
  const byPlatform = TIPS[topic];
  if (!byPlatform) return '';
  return byPlatform[platform] || (platform === 'WooCommerce' ? byPlatform.WordPress || '' : '');
}
