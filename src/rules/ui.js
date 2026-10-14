// UI element rules: consistency and clarity of buttons, type, colour, icons, links and images.
// Written for clients: every finding says what the visitor experiences, in plain words.

import { finding, strength, plural, quote } from './common.js';

export function uiRules({ desktop: D, mobile: M }) {
  const out = [];
  const strengths = [];
  const u = D.ui;
  if (!u) return { findings: out, strengths };

  // Buttons
  const styles = u.buttonStyles || [];
  const filledStyles = styles.filter((b) => b.bg !== 'transparent');
  if (styles.length > 4) {
    out.push(finding({
      ruleId: 'ui.button-styles', area: 'UI', lever: 'Clarity',
      title: `Buttons come in ${styles.length} different styles`,
      observation: `We found ${styles.length} button designs on this page (different colours, shapes or sizes), e.g. ${styles.slice(0, 3).map((b) => quote(b.example)).join(', ')}.`,
      why: 'When buttons look different everywhere, visitors can’t tell which action matters most, and the site feels less polished and trustworthy.',
      fix: [
        'Agree on three button styles and use only those: a main button (filled, your accent colour), a secondary button (outline), and a text link style.',
        'Use the same corner radius, height and font weight for every button of the same type.',
        'Save them as components in your design file and in the site builder so new pages reuse them.',
      ],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      element: { view: 'desktop', rect: styles[1]?.rect || styles[0].rect, label: styles[1]?.example || styles[0].example },
    }));
  } else if (styles.length && styles.length <= 3) {
    strengths.push(strength('Consistent buttons', `Only ${plural(styles.length, 'button style')} used on this page.`, 'Clarity'));
  }
  if ((u.radii || []).length > 3) {
    out.push(finding({
      ruleId: 'ui.radius', area: 'UI', lever: 'Clarity',
      title: 'Button corners are inconsistent',
      observation: `Buttons use ${u.radii.length} different corner shapes (${u.radii.map((r) => (r === 'pill' ? 'pill' : `${r}px`)).join(', ')}).`,
      why: 'Small inconsistencies like mixed corner shapes make a site look unfinished, even if visitors can’t say why.',
      fix: ['Pick one corner radius for buttons and inputs (for example 8px, or fully rounded) and apply it everywhere.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  if (filledStyles.length === 0 && styles.length > 0) {
    out.push(finding({
      ruleId: 'ui.no-filled-button', area: 'UI', lever: 'Clarity',
      title: 'No solid main button',
      observation: 'All buttons on this page are outlines or text — none is filled with colour.',
      why: 'A solid, coloured button tells visitors “this is the next step”. Without one, nothing stands out as the main action.',
      fix: ['Make the single most important action a solid button in your accent colour.', 'Keep other actions as outlines or links.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'A/B test',
      hypothesis: 'If the main action is a solid, coloured button, more visitors will click it.',
      metric: 'Main button clicks that lead to a conversion',
    }));
  }

  // Typography
  const fonts = (u.fonts || []).filter((f) => f.count >= 3 && !/^(system-ui|-apple-system|inherit)$/i.test(f.value));
  if (fonts.length > 3) {
    out.push(finding({
      ruleId: 'ui.fonts', area: 'UI', lever: 'Clarity',
      title: `${fonts.length} different fonts on one page`,
      observation: `Fonts used: ${fonts.slice(0, 5).map((f) => f.value).join(', ')}.`,
      why: 'Too many fonts make a page look busy and inconsistent. Each extra font also adds download time.',
      fix: ['Use at most two fonts: one for headings and one for body text.', 'Remove fonts left over from old templates or plugins.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  const sizes = (u.fontSizes || []).filter((s) => s.count >= 2);
  if (sizes.length > 10) {
    out.push(finding({
      ruleId: 'ui.type-scale', area: 'UI', lever: 'Clarity',
      title: `Text uses ${sizes.length} different sizes`,
      observation: `Sizes from ${sizes[sizes.length - 1].value}px to ${sizes[0].value}px: ${sizes.slice(0, 12).map((s) => `${s.value}px`).join(', ')}.`,
      why: 'Without a clear set of text sizes, visitors can’t easily tell headings from body text, and the page looks uneven.',
      fix: ['Define a small type scale (for example 14, 16, 20, 24, 32, 44px) and use only those sizes.', 'Give each level a job: page title, section title, card title, body, small print.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  const hs = u.headingSizes || {};
  const order = ['h1', 'h2', 'h3'].filter((k) => hs[k]);
  const inverted = order.some((k, i) => i > 0 && hs[k] > hs[order[i - 1]] + 1);
  if (inverted) {
    out.push(finding({
      ruleId: 'ui.heading-hierarchy', area: 'UI', lever: 'Clarity',
      title: 'Smaller headings look bigger than main ones',
      observation: `Heading sizes: ${order.map((k) => `${k.toUpperCase()} ${hs[k]}px`).join(', ')}.`,
      why: 'Visitors scan headings to understand a page. When a sub-heading is bigger than the main heading, the order of importance is confusing.',
      fix: ['Make each heading level smaller than the one above it (H1 > H2 > H3).', 'If a section title must look big, make it the right level in the code instead of resizing a smaller one.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
    }));
  }
  if (u.tiny > 5) {
    out.push(finding({
      ruleId: 'ui.tiny-text', area: 'UI', lever: 'Clarity',
      title: 'Some text is too small to read comfortably',
      observation: `${u.tiny} pieces of text are smaller than 12px${u.tinyExamples?.[0] ? `, e.g. ${quote(u.tinyExamples[0].text)} at ${u.tinyExamples[0].size}px` : ''}.`,
      why: 'Text under 12px is hard to read, especially on phones and for older visitors. Important details (prices, terms, delivery) get missed.',
      fix: ['Use at least 12px for small print and 16px for body text on mobile.', 'If text needs to be that small, it probably isn’t needed — shorten or remove it.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
      element: u.tinyExamples?.[0] ? { view: 'desktop', rect: u.tinyExamples[0].rect, label: u.tinyExamples[0].text } : undefined,
    }));
  }
  if (u.paraCount >= 4 && u.tight >= Math.max(3, u.paraCount * 0.4)) {
    out.push(finding({
      ruleId: 'ui.line-height', area: 'UI', lever: 'Clarity',
      title: 'Lines of text are packed too tightly',
      observation: `${u.tight} of ${u.paraCount} paragraphs have line spacing under 1.3.`,
      why: 'Cramped lines are tiring to read, so visitors skim and miss details.',
      fix: ['Set body text line spacing (line-height) to about 1.5.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  if (u.centred >= 2) {
    out.push(finding({
      ruleId: 'ui.centred-text', area: 'UI', lever: 'Clarity',
      title: 'Long paragraphs are centre-aligned',
      observation: `${u.centred} long paragraphs are centred.`,
      why: 'Centred text is fine for short headings, but in long paragraphs every line starts in a different place, which makes reading harder.',
      fix: ['Left-align any paragraph longer than two or three lines.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  // Colour
  const colors = (u.textColors || []).filter((c) => c.count >= 2);
  if (colors.length > 8) {
    out.push(finding({
      ruleId: 'ui.text-colours', area: 'UI', lever: 'Clarity',
      title: `${colors.length} different text colours`,
      observation: `Text appears in ${colors.length} colours on this page.`,
      why: 'A few colours used on purpose guide the eye; many slightly different colours look accidental and weaken the brand.',
      fix: ['Limit text to 3–4 colours: main text, secondary text, links/accent, and white on dark backgrounds.', 'Save them as named colours (design tokens) in your design file and site builder.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  // Icons, links, images
  if ((u.iconOnly || []).length) {
    const first = u.iconOnly[0];
    out.push(finding({
      ruleId: 'ui.icon-buttons', area: 'UI', lever: 'Clarity',
      title: `${plural(u.iconOnly.length, 'icon button')} with no label`,
      observation: `${plural(u.iconOnly.length, 'button or link')} show only an icon, with no visible text or hidden label.`,
      why: 'Not everyone recognises an icon, and screen readers announce these as just “button”. People avoid clicking things they don’t understand.',
      fix: ['Add a short visible label next to icons that trigger important actions (e.g. “Cart”, “Menu”, “Search”).', 'For icon-only buttons, add an aria-label describing the action.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      element: { view: 'desktop', rect: first.rect, label: 'Icon button' },
    }));
  }
  if (u.hiddenLinks >= 2) {
    out.push(finding({
      ruleId: 'ui.hidden-links', area: 'UI', lever: 'Clarity',
      title: 'Links look like normal text',
      observation: `${u.hiddenLinks} links inside paragraphs have no underline and the same colour as the text${u.hiddenLinkExamples?.length ? `, e.g. ${u.hiddenLinkExamples.map(quote).join(', ')}` : ''}.`,
      why: 'If people can’t see a link, they won’t click it — useful pages (sizing, delivery, pricing) stay undiscovered.',
      fix: ['Underline links in body text, or give them a clearly different colour.', 'Keep the same link style across the whole site.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }
  if ((u.distorted || []).length) {
    out.push(finding({
      ruleId: 'ui.distorted-images', area: 'UI', lever: 'Trust',
      title: 'Some images look stretched or squashed',
      observation: `${plural(u.distorted.length, 'image')} are shown at a different shape from the original.`,
      why: 'Stretched photos look careless and make products look wrong, which hurts trust.',
      fix: ['Use object-fit: cover (crop) instead of stretching.', 'Or upload images in the same shape as the space they fill.'],
      evidence: 'OBSERVED', priority: 'P2', type: 'Quick win',
      element: { view: 'desktop', rect: u.distorted[0].rect, label: 'Stretched image' },
    }));
  }

  // Forms
  if ((u.fieldHeights || []).length > 2) {
    out.push(finding({
      ruleId: 'ui.field-sizes', area: 'UI', lever: 'Friction',
      title: 'Form fields are different sizes',
      observation: `Input fields come in ${u.fieldHeights.length} heights (${u.fieldHeights.sort((a, b) => a - b).map((h) => `${h}px`).join(', ')}).`,
      why: 'Uneven fields make forms look messy and harder to scan.',
      fix: ['Give all text fields and dropdowns the same height (44–48px works well on mobile) and the same border style.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  // Mobile-specific: buttons too wide/small handled in CRO; check main CTA width on mobile.
  if (M?.ui && M.ui.buttonStyles?.length > D.ui.buttonStyles.length + 2) {
    out.push(finding({
      ruleId: 'ui.mobile-buttons', area: 'UI', lever: 'Clarity', segment: 'Mobile',
      title: 'Buttons change style on mobile',
      observation: `The mobile view shows ${M.ui.buttonStyles.length} button styles versus ${D.ui.buttonStyles.length} on desktop.`,
      why: 'Visitors switching between phone and laptop should see the same buttons; extra variants usually come from leftover mobile overrides.',
      fix: ['Check the mobile breakpoint styles and remove one-off button overrides.'],
      evidence: 'OBSERVED', priority: 'P3', type: 'Quick win',
    }));
  }

  return { findings: out, strengths };
}
