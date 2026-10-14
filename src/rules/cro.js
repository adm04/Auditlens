// Conversion (CRO) rules. Each rule turns facts from the page snapshots into a finding
// that follows the skill's finding card: observation → why it costs conversions →
// fix steps → lever, evidence label, priority, quick win vs A/B test, hypothesis, metric.
//
// Detection is from the DOM, so "missing" findings are worded as "not detected" and
// labelled HEURISTIC: the auditor confirms or rejects them.

import { finding, strength, plural, quote } from './common.js';
import { platformTip } from './platform.js';

const CTA_EXAMPLES = {
  purchase: ['Add to cart', 'Shop bestsellers', 'Get yours today'],
  signup: ['Start free trial', 'Create free account', 'Try it free for 14 days'],
  lead: ['Get my free quote', 'Book a free consultation', 'Talk to an expert'],
  demo: ['Book a 20-min demo', 'See it in action', 'Schedule my demo'],
  email: ['Get 10% off', 'Send me the guide', 'Join the list'],
};

const METRIC = {
  purchase: 'Purchases (add-to-cart that ends in a purchase)',
  signup: 'Completed sign-ups',
  lead: 'Submitted enquiries',
  demo: 'Booked demos',
  email: 'Email sign-ups',
};

export function defaultConversion(businessModel, pageType) {
  if (businessModel === 'ecommerce') return 'purchase';
  if (businessModel === 'saas') return pageType === 'saas' ? 'signup' : 'demo';
  if (businessModel === 'leadgen') return 'lead';
  return 'lead';
}

const primaryCtas = (s) => (s?.ctas || []).filter((c) => (c.filled && !c.inNav) || c.sticky);
const foldCtas = (s) => primaryCtas(s).filter((c) => c.inFold && !c.sticky);
const realForms = (s) => (s?.forms || []).filter((f) => !f.isSearch);

export function croRules({ desktop: D, mobile: M, context }) {
  const out = [];
  const strengths = [];
  const { pageType, businessModel, conversion, platform } = context;
  const ecommerce = businessModel === 'ecommerce';
  const metric = METRIC[conversion] || 'Primary conversion';
  const examples = CTA_EXAMPLES[conversion] || CTA_EXAMPLES.lead;
  const S = M || D;
  const sig = D.signals;

  // ---- First fold: headline ------------------------------------------------
  if (!D.fold.headline) {
    out.push(finding({
      ruleId: 'cro.fold-headline-missing',
      title: 'No clear headline on the first screen',
      observation: 'No heading or large headline text was found in the first screen on desktop.',
      why: 'Visitors decide within a few seconds whether a page is for them. Without a headline that says what you offer and why it’s different, more people leave or scroll without understanding.',
      fix: [
        'Add one headline at the top of the page that states the main benefit or what you sell, in 3–6 words.',
        'Put a one-line sub-headline under it with the key differentiator (who it’s for, or the result they get).',
        'Mark it up as the page’s single <h1>.',
      ],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P1', type: 'Quick win',
      metric,
    }));
  } else if (D.fold.headlineWords > 12) {
    out.push(finding({
      ruleId: 'cro.fold-headline-long',
      title: 'First-screen headline is long and hard to scan',
      observation: `The main headline is ${D.fold.headlineWords} words: ${quote(D.fold.headline)}.`,
      why: 'Short, benefit-led headlines (about 3–6 words, max 3 lines) are understood at a glance. Long ones get skimmed, so the key message is missed.',
      fix: [
        'Cut the headline to the single most important benefit or differentiator (aim for 3–6 words).',
        'Move supporting detail into a sub-headline or 2–3 short bullet points.',
        'Read it aloud: it should sound like natural speech and make sense without the sub-copy.',
      ],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'A/B test',
      hypothesis: 'If the headline states one clear benefit in a few words, more visitors will understand the offer and click the primary CTA.',
      metric,
    }));
  } else if (D.fold.headlineWords >= 2) {
    strengths.push(strength('Clear, short headline on the first screen', `${quote(D.fold.headline)} (${D.fold.headlineWords} words).`, 'Clarity'));
  }

  // ---- First fold: primary CTA ------------------------------------------------
  if (pageType !== 'checkout') {
    const dFold = foldCtas(D);
    const mFold = M ? foldCtas(M) : null;
    const missingD = dFold.length === 0;
    const missingM = M ? mFold.length === 0 : false;
    if (missingD || missingM) {
      const segment = missingD && missingM ? 'All' : missingM ? 'Mobile' : 'Desktop';
      const where = segment === 'All' ? 'on desktop or mobile' : `on ${segment.toLowerCase()}`;
      out.push(finding({
        ruleId: 'cro.fold-cta-missing',
        title: `No primary call-to-action on the first screen ${segment === 'All' ? '' : `(${segment.toLowerCase()})`}`.trim(),
        observation: `No prominent button (outside the navigation) is visible in the first screen ${where}.${missingM && !missingD ? ' Desktop shows one, so the mobile layout pushes it down.' : ''}`,
        why: 'Visitors who are ready to act have to hunt for the next step. On mobile, where most traffic usually is, a CTA below the fold is often never seen.',
        fix: [
          'Place one high-contrast primary button directly under the headline and sub-headline.',
          `Label it with the benefit and destination, e.g. ${examples.map(quote).join(', ')}.`,
          segment !== 'Desktop' ? 'On mobile, shrink the hero image or move it below the button so the CTA is visible without scrolling.' : 'Keep secondary links visually quieter (outline or text style).',
        ],
        lever: 'Friction', evidence: 'OBSERVED', priority: 'P1', type: 'A/B test', segment,
        hypothesis: 'If the primary CTA is visible without scrolling, more visitors will start the conversion because the next step is obvious and effortless.',
        metric,
      }));
    } else {
      strengths.push(strength('Primary CTA visible on the first screen', `${quote(dFold[0].text)} is visible without scrolling${M ? ' on desktop and mobile' : ''}.`, 'Friction'));
    }

    const distinct = [...new Set(dFold.map((c) => c.text.toLowerCase()))];
    if (distinct.length > 3) {
      out.push(finding({
        ruleId: 'cro.fold-cta-competing',
        title: 'Too many competing buttons on the first screen',
        observation: `${plural(distinct.length, 'different button')} compete for attention on the first screen: ${distinct.slice(0, 5).map(quote).join(', ')}.`,
        why: 'When several actions look equally important, visitors hesitate or pick the wrong path (choice overload).',
        fix: [
          'Pick the one action that matters most for this page and keep it as the only filled, high-contrast button.',
          'Turn the others into secondary styles (outline or text links) or move them lower on the page.',
        ],
        lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'A/B test',
        hypothesis: 'If the first screen has one dominant CTA, more visitors will take the primary action.',
        metric,
        element: { view: 'desktop', rect: dFold[0].rect, label: dFold[0].text },
      }));
    }
  }

  // ---- CTA copy -----------------------------------------------------------
  const generic = [...new Set(primaryCtas(D).concat(M ? primaryCtas(M) : []).filter((c) => c.generic).map((c) => c.text))];
  if (generic.length) {
    const first = primaryCtas(D).find((c) => c.generic);
    out.push(finding({
      ruleId: 'cro.cta-generic',
      title: 'Button labels are generic',
      observation: `These buttons don’t say what happens next: ${generic.slice(0, 5).map(quote).join(', ')}.`,
      why: 'CTAs convert better when they state the benefit and where the click leads. Generic labels add doubt at the moment of action.',
      fix: [
        'Rewrite each label to name the benefit or destination in up to about 3 words.',
        `Examples for this page: ${examples.map(quote).join(', ')}.`,
        'Use strong verbs (Get, Start, Book, Shop, Add) and, where helpful, state effort (“Take the 2-minute quiz”).',
      ],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'A/B test',
      hypothesis: 'If CTA labels state the benefit and destination, click-through and completed conversions will rise because the next step feels clearer and safer.',
      metric,
      element: first ? { view: 'desktop', rect: first.rect, label: first.text } : undefined,
    }));
  }

  // ---- CTA contrast ----------------------------------------------------------
  const weak = primaryCtas(D).slice(0, 6).filter((c) => (c.bgContrast !== null && c.bgContrast < 1.6) || (c.textContrast !== null && c.textContrast < 4.5));
  if (weak.length) {
    const c = weak[0];
    out.push(finding({
      ruleId: 'cro.cta-contrast',
      title: 'Main buttons don’t stand out enough',
      observation: `${plural(weak.length, 'primary button')} have low contrast, e.g. ${quote(c.text)}${c.bgContrast !== null ? ` (button vs background ${c.bgContrast}:1` : ''}${c.textContrast !== null ? `${c.bgContrast !== null ? ', ' : ' ('}label text ${c.textContrast}:1)` : c.bgContrast !== null ? ')' : ''}.`,
      why: 'A CTA has to be the most noticeable element in its area. Low contrast makes it blend in and harder to read, especially on phones outdoors.',
      fix: [
        'Use one accent colour reserved for primary CTAs that contrasts strongly with the page background.',
        'Make the label text at least 4.5:1 against the button colour (WCAG AA).',
        'Give the button enough size and white space around it (at least 44px tall on mobile).',
      ],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      metric,
      element: { view: 'desktop', rect: c.rect, label: c.text },
    }));
  }

  // ---- Mobile tap targets ---------------------------------------------------
  if (M) {
    const small = primaryCtas(M).filter((c) => c.rect.h < 40 && !c.sticky);
    if (small.length) {
      out.push(finding({
        ruleId: 'cro.tap-targets',
        title: 'Buttons are small to tap on mobile',
        observation: `${plural(small.length, 'primary button')} are under 40px tall in the mobile view, e.g. ${quote(small[0].text)} (${small[0].rect.h}px).`,
        why: 'Small targets cause mis-taps and frustration, which adds friction right at the moment of action.',
        fix: ['Make primary buttons at least 44–48px tall on mobile with comfortable padding.', 'Keep at least 8px space between adjacent tap targets.'],
        lever: 'Friction', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', segment: 'Mobile',
        metric,
        element: { view: 'mobile', rect: small[0].rect, label: small[0].text },
      }));
    }

    const long = M.pageHeight > M.viewport.h * 3;
    const hasSticky = (M.ctas || []).some((c) => c.sticky);
    if (long && !hasSticky && ['product', 'landing', 'saas'].includes(pageType)) {
      out.push(finding({
        ruleId: 'cro.sticky-cta',
        title: 'No sticky call-to-action on a long mobile page',
        observation: `The mobile page is about ${Math.round(M.pageHeight / M.viewport.h)} screens long and no sticky CTA was detected.`,
        why: 'Once the in-page button scrolls away, visitors who become ready to act have to scroll back up to find it.',
        fix: [
          'Add a slim sticky bar at the bottom of the screen on mobile that appears once the main CTA scrolls out of view.',
          'Keep it to the price (if relevant) and one button; don’t cover content or the chat bubble.',
          'Run it as an A/B test on mobile traffic only.',
        ],
        lever: 'Friction', evidence: 'HEURISTIC', priority: pageType === 'product' ? 'P2' : 'P3', type: 'A/B test', segment: 'Mobile',
        hypothesis: 'If the primary CTA stays reachable while scrolling, more mobile visitors will convert because acting takes less effort.',
        metric,
        platformTip: platformTip('sticky-cta', platform),
      }));
    } else if (hasSticky) {
      strengths.push(strength('Sticky CTA on mobile', 'A call-to-action stays reachable while scrolling.', 'Friction'));
    }
  }

  // ---- Overlays at load --------------------------------------------------------
  const overlays = [...(D.overlays || []).map((o) => ({ ...o, view: 'Desktop' })), ...((M?.overlays) || []).map((o) => ({ ...o, view: 'Mobile' }))];
  const blocking = overlays.filter((o) => !o.isCookie && o.share >= 30);
  const bigCookie = overlays.filter((o) => o.isCookie && o.share >= 25);
  if (blocking.length) {
    const o = blocking[0];
    out.push(finding({
      ruleId: 'cro.popup-at-load',
      title: 'A pop-up covers the page as soon as it loads',
      observation: `An overlay covers about ${o.share}% of the ${o.view.toLowerCase()} screen on load${o.text ? `: ${quote(o.text.slice(0, 90))}` : ''}.`,
      why: 'Interrupting visitors before they’ve seen the offer adds friction and raises bounce, especially on mobile where it can fill the whole screen.',
      fix: [
        'Delay the pop-up until intent is shown (exit intent on desktop, or after 30–50% scroll / 20–30 seconds).',
        'On mobile, use a small bottom banner instead of a full-screen modal.',
        'Make the close button obvious, top-right, with a large tap area.',
      ],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P1', type: 'A/B test', segment: o.view,
      hypothesis: 'If the pop-up appears only after visitors engage, bounce will fall and more visitors will reach the primary CTA.',
      metric,
      platformTip: platformTip('popups', platform),
    }));
  }
  if (bigCookie.length) {
    out.push(finding({
      ruleId: 'cro.cookie-banner',
      title: 'Cookie banner takes up a lot of the first screen',
      observation: `The cookie/consent banner covers about ${bigCookie[0].share}% of the ${bigCookie[0].view.toLowerCase()} screen.`,
      why: 'A large consent banner hides the headline and CTA on the most important screen.',
      fix: ['Use a compact bottom banner with clear Accept / Manage buttons.', 'Keep it to two short lines on mobile.'],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', segment: bigCookie[0].view,
      metric,
    }));
  }

  // ---- Trust and social proof -----------------------------------------------
  if (!sig.reviews && !sig.ratingSchema && !sig.customerCount) {
    out.push(finding({
      ruleId: 'cro.social-proof',
      title: 'No reviews, ratings or customer proof detected',
      observation: 'We didn’t detect reviews, star ratings, testimonials or customer counts on this page.',
      why: 'People copy what others do. Without visible proof, first-time visitors have to take your word for it, which lowers trust and conversion.',
      fix: [
        'Show a rating summary (stars + number of reviews) near the headline or main CTA.',
        'Add 2–3 short testimonials with real names, photos or locations.',
        ecommerce ? 'Show review counts on product cards and photo reviews (UGC) near the product description.' : 'Add client logos or a case study with a specific, quantified result.',
        'Only use genuine reviews; link to the source (Google, Trustpilot) if you can.',
      ],
      lever: 'Social proof', evidence: 'HEURISTIC',
      priority: ecommerce && ['product', 'home'].includes(pageType) ? 'P1' : 'P2',
      type: 'A/B test',
      hypothesis: 'If visitors see proof that others bought and liked this, more of them will convert because the decision feels less risky.',
      metric,
      platformTip: platformTip('reviews', platform),
    }));
  } else {
    strengths.push(strength('Social proof is present', [sig.reviews || sig.ratingSchema ? 'Reviews or ratings' : '', sig.customerCount ? `customer count (${quote(sig.customerCount)})` : ''].filter(Boolean).join(' and ') + ' found on the page.', 'Social proof'));
  }

  if (sig.press) strengths.push(strength('Press or media mentions', 'An “as seen in” / featured-in section adds authority.', 'Authority'));

  if (ecommerce && !sig.guarantee) {
    out.push(finding({
      ruleId: 'cro.guarantee',
      title: 'Returns, guarantee or warranty not mentioned',
      observation: 'No returns policy, guarantee, refund or warranty message was detected on the page.',
      why: 'Risk-reversal messages answer the “what if it doesn’t work for me?” worry right where people decide.',
      fix: [
        'Add short service USPs directly under the add-to-cart button: e.g. “Free 30-day returns”, “1-year warranty”.',
        'Use icons + 3–5 words each; link to the full policy.',
      ],
      lever: 'Trust', evidence: 'HEURISTIC', priority: pageType === 'product' ? 'P1' : 'P2', type: 'A/B test',
      hypothesis: 'If returns/guarantee terms are visible next to the CTA, more visitors will add to cart because the purchase feels lower-risk.',
      metric,
    }));
  } else if (sig.guarantee) {
    strengths.push(strength('Risk reversal is mentioned', 'Returns, guarantee or warranty terms are on the page.', 'Trust'));
  }

  if (ecommerce && ['product', 'home', 'checkout', 'collection'].includes(pageType) && !sig.shipping) {
    out.push(finding({
      ruleId: 'cro.shipping',
      title: 'Shipping cost and delivery time not shown',
      observation: 'No shipping cost, free-shipping threshold or delivery time was detected on this page.',
      why: 'Surprise costs at checkout are one of the most common reasons for cart abandonment, and occasion buyers need to know it will arrive in time.',
      fix: [
        'State shipping terms near the price or CTA (e.g. “Free delivery over ₹999 · Ships in 2 days”).',
        'Add the free-shipping threshold to the announcement bar.',
        'Show all costs (shipping, tax, fees) before the final checkout step.',
      ],
      lever: 'Friction', evidence: 'HEURISTIC', priority: 'P2', type: 'Quick win',
      metric,
    }));
  }

  if (!sig.contact) {
    out.push(finding({
      ruleId: 'cro.contact',
      title: 'No easy way to contact you',
      observation: 'No phone, email, WhatsApp or “Contact” link was detected on this page.',
      why: 'Visible contact options signal a real, reachable business and catch visitors with last-minute questions.',
      fix: ['Add a Contact link in the header or footer.', 'Show a phone/WhatsApp or email link, and consider live chat on key pages.'],
      lever: 'Trust', evidence: 'HEURISTIC', priority: 'P2', type: 'Quick win',
      metric,
    }));
  }

  const missingPolicies = Object.entries(sig.policies).filter(([k, v]) => !v && (ecommerce ? ['privacy', 'returns', 'shipping'].includes(k) : k === 'privacy')).map(([k]) => k);
  if (missingPolicies.length) {
    out.push(finding({
      ruleId: 'cro.policies',
      title: 'Policy pages are hard to find',
      observation: `No link was detected for: ${missingPolicies.join(', ')} policy.`,
      why: 'Easy-to-find policies reduce anxiety and are expected by cautious buyers (and by payment providers).',
      fix: ['Link every policy page in the footer.', ecommerce ? 'Summarise returns and shipping in one line near the CTA, linking to the full policy.' : 'Link the privacy policy next to any form.'],
      lever: 'Trust', evidence: 'HEURISTIC', priority: ecommerce ? 'P2' : 'P3', type: 'Quick win',
      metric,
    }));
  }

  if (pageType === 'checkout' && !sig.security) {
    out.push(finding({
      ruleId: 'cro.security',
      title: 'No payment or security reassurance at checkout',
      observation: 'No secure-checkout message or payment method logos were detected.',
      why: 'Checkout is where anxiety peaks; familiar payment logos and a secure-checkout line reassure buyers.',
      fix: ['Show accepted payment methods (cards, UPI, wallets) near the pay button.', 'Add a short “Secure checkout” line with a lock icon, and the returns summary.'],
      lever: 'Trust', evidence: 'HEURISTIC', priority: 'P2', type: 'Quick win',
      metric,
    }));
  }

  if ((pageType === 'checkout' || businessModel === 'saas') && !sig.chat) {
    out.push(finding({
      ruleId: 'cro.chat',
      title: 'No chat or quick help channel',
      observation: 'No live chat, WhatsApp or chat widget was detected.',
      why: 'Questions at the decision point that go unanswered become abandoned carts or lost sign-ups.',
      fix: ['Add live chat or a WhatsApp link on pricing, product and checkout pages.', 'Review the questions people ask and answer the common ones on the page.'],
      lever: 'Trust', evidence: 'HEURISTIC', priority: 'P3', type: 'A/B test',
      hypothesis: 'If help is one tap away, fewer visitors will abandon because their last questions get answered.',
      metric,
    }));
  } else if (sig.chat) {
    strengths.push(strength('Help is reachable', 'A chat or WhatsApp channel is available.', 'Trust'));
  }

  if (ecommerce && ['home', 'collection'].includes(pageType) && !sig.search) {
    out.push(finding({
      ruleId: 'cro.search',
      title: 'No visible search',
      observation: 'No search box or search button was detected.',
      why: 'Visitors who know what they want convert at a high rate when they can search; hiding search slows product discovery.',
      fix: ['Add a visible search icon in the header (a full search bar on desktop).', 'Make sure search handles typos and shows product suggestions as people type.'],
      lever: 'Product discovery', evidence: 'HEURISTIC', priority: 'P2', type: 'Quick win',
      metric,
    }));
  }

  if (['product', 'saas', 'landing'].includes(pageType) && !sig.faq) {
    out.push(finding({
      ruleId: 'cro.faq',
      title: 'Common questions aren’t answered on the page',
      observation: 'No FAQ section was detected.',
      why: 'Repeated customer questions point to missing information; answering them on the page removes objections at the moment of decision.',
      fix: ['Collect the top 5–8 questions from support, chat, reviews and sales calls.', 'Add them as an accordion FAQ near the bottom, before the final CTA.'],
      lever: 'Trust', evidence: 'HEURISTIC', priority: 'P3', type: 'A/B test',
      hypothesis: 'If the main objections are answered on the page, more visitors will convert without leaving to ask.',
      metric,
    }));
  }

  if (sig.urgency) {
    out.push(finding({
      ruleId: 'cro.urgency-check',
      title: 'Check that urgency messages are genuine',
      observation: `Urgency copy was found: ${quote(sig.urgency)}.`,
      why: 'Real deadlines and real stock help undecided visitors act; fake or always-on urgency erodes trust once noticed.',
      fix: ['Confirm the deadline or stock number is real and updates automatically.', 'State the terms honestly (end date, what happens after).'],
      lever: 'Urgency', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      metric,
    }));
  }

  // ---- Forms ---------------------------------------------------------------
  const forms = realForms(S);
  const longForm = forms.find((f) => f.fieldCount > 6);
  if (longForm) {
    out.push(finding({
      ruleId: 'cro.form-long',
      title: `Form asks for a lot (${longForm.fieldCount} fields)`,
      observation: `A form on this page has ${longForm.fieldCount} visible fields${longForm.required ? ` (${longForm.required} required)` : ''}.`,
      why: 'Each extra field adds effort and makes the form feel riskier, so fewer people finish it.',
      fix: [
        'Remove every field you don’t act on immediately; ask for the rest later (after sign-up or on a call).',
        'If you need many fields, split into 2–3 short steps with a progress indicator.',
        'Explain why you ask for sensitive fields (e.g. phone: “so our team can call you back today”).',
      ],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P2', type: 'A/B test',
      hypothesis: 'If the form asks only for essential information, more visitors will complete it.',
      metric,
      element: { view: M ? 'mobile' : 'desktop', rect: longForm.rect, label: 'Form' },
      platformTip: platformTip('forms', platform),
    }));
  }
  const unlabeled = forms.reduce((n, f) => n + f.unlabeled, 0);
  if (unlabeled) {
    const ex = forms.flatMap((f) => f.unlabeledExamples).slice(0, 3);
    out.push(finding({
      ruleId: 'cro.form-labels',
      title: 'Form fields rely on placeholders instead of labels',
      observation: `${plural(unlabeled, 'field')} have no visible or programmatic label${ex.length ? `, e.g. ${ex.map(quote).join(', ')}` : ''}.`,
      why: 'Placeholder text disappears when typing, so people forget what a field was for; screen readers may not announce it either.',
      fix: ['Add a visible label above each field (connected with for/id).', 'Keep placeholders only for example formats (e.g. “name@company.com”).'],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      metric,
      platformTip: platformTip('forms', platform),
    }));
  }
  if (forms.some((f) => f.emailWrongType)) {
    out.push(finding({
      ruleId: 'cro.form-email-type',
      title: 'Email field doesn’t use the email keyboard on mobile',
      observation: 'An email field is a plain text input instead of type="email".',
      why: 'On phones, the email keyboard (with @ and .com) makes typing faster and reduces typos.',
      fix: ['Set the email input to type="email" and autocomplete="email".'],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win', segment: 'Mobile',
      metric,
    }));
  }
  if (forms.some((f) => f.fieldCount >= 2 && f.autocomplete === 0)) {
    out.push(finding({
      ruleId: 'cro.form-autocomplete',
      title: 'Forms don’t support autofill',
      observation: 'Form fields have no autocomplete attributes.',
      why: 'Autofill lets returning visitors complete forms in one tap, especially on mobile.',
      fix: ['Add autocomplete values (name, email, tel, street-address, postal-code) to matching fields.'],
      lever: 'Friction', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      metric,
    }));
  }
  const capture = forms.find((f) => f.hasEmail && f.fieldCount <= 2 && !f.incentive);
  if (capture) {
    out.push(finding({
      ruleId: 'cro.email-incentive',
      title: 'Email sign-up gives no reason to join',
      observation: `An email sign-up${capture.submitText ? ` (${quote(capture.submitText)})` : ''} has no visible incentive nearby.`,
      why: 'People trade an email for something of value. Without a clear reason, sign-up rates stay low.',
      fix: ['Offer a concrete reason: first-order discount, a useful guide, early access, or member perks.', 'Put the benefit in the button text (e.g. “Get 10% off”).'],
      lever: 'Reciprocity', evidence: 'HEURISTIC', priority: 'P3', type: 'A/B test',
      hypothesis: 'If the sign-up offers a clear benefit, more visitors will join the list.',
      metric: 'Email sign-ups',
    }));
  }

  // ---- Readability ---------------------------------------------------------
  const R = S.readability;
  if (R.medianFontSize && R.medianFontSize < (M ? 15 : 14)) {
    out.push(finding({
      ruleId: 'cro.text-size',
      title: 'Body text is small',
      observation: `Typical paragraph text is ${R.medianFontSize}px in the ${M ? 'mobile' : 'desktop'} view.`,
      why: 'Small text is tiring to read, so people skim past the details that would convince them.',
      fix: ['Use at least 16px for body text on mobile (15px minimum).', 'Keep line height around 1.5 and line length about 40–60 characters.'],
      lever: 'Clarity', evidence: 'OBSERVED', priority: M ? 'P2' : 'P3', type: 'Quick win', segment: M ? 'Mobile' : 'Desktop',
      metric,
    }));
  }
  if (R.longParagraphs >= 3) {
    out.push(finding({
      ruleId: 'cro.long-paragraphs',
      title: 'Long blocks of text',
      observation: `${plural(R.longParagraphs, 'paragraph')} run longer than about 4–5 lines on ${M ? 'mobile' : 'desktop'}${R.longExample ? `, e.g. ${quote(R.longExample)}` : ''}.`,
      why: 'Most visitors skim. Long paragraphs hide key benefits and objections handling.',
      fix: ['Break paragraphs to about 3 lines on mobile.', 'Turn lists of features into bullets, shortest line first.', 'Bold the key words so skimmers still get the message.'],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      metric,
    }));
  }
  if (R.lowContrast.length) {
    const lc = R.lowContrast[0];
    out.push(finding({
      ruleId: 'cro.text-contrast',
      title: 'Some text has low contrast',
      observation: `${plural(R.lowContrast.length, 'text element')} fall below WCAG contrast, e.g. ${quote(lc.text)} at ${lc.ratio}:1.`,
      why: 'Low-contrast text is hard to read for many people (and on phones in daylight), so the message is lost.',
      fix: ['Darken grey text so it reaches at least 4.5:1 against its background (3:1 for large text).', 'Avoid light text over busy images; add an overlay behind text on photos.'],
      lever: 'Clarity', evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      metric,
      element: { view: M ? 'mobile' : 'desktop', rect: lc.rect, label: lc.text },
      refs: [{ label: 'WCAG contrast minimum', url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html' }],
    }));
  }

  return { findings: out, strengths };
}
