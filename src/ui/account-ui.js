// Sign-in / sign-up form and upgrade panel, shared by the popup and the workspace.

import { signInWithEmail, signUpWithEmail, sendPasswordReset } from '../auth.js';
import { openCheckout, waitForPro } from '../entitlements.js';
import { CONFIG, PRO_FEATURES, PLANS } from '../config.js';

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const appendAll = (root, ...kids) => root.append(...kids.flat().filter((k) => k != null && k !== false));

const GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/**
 * Renders the sign-in / create-account form.
 * @param {HTMLElement} root
 * @param {{onSignedIn: () => void, compact?: boolean}} opts
 */
export function renderAuth(root, { onSignedIn, compact = false } = {}) {
  let mode = 'signin'; // signin | signup | reset
  const msg = el('p', { class: 'auth-msg', role: 'status', 'aria-live': 'polite' });
  const setMsg = (text, kind = '') => { msg.textContent = text; msg.className = `auth-msg ${kind}`; };

  const google = el('button', { class: 'auth-google', type: 'button' });
  google.innerHTML = `${GOOGLE_SVG}<span>Continue with Google</span>`;
  google.addEventListener('click', async () => {
    google.disabled = true;
    setMsg('Opening Google…');
    const res = await chrome.runtime.sendMessage({ type: 'AUTH_GOOGLE' }).catch((err) => ({ ok: false, error: err.message }));
    google.disabled = false;
    if (res?.ok) { setMsg(''); onSignedIn?.(); } else setMsg(res?.error || 'Google sign-in failed.', 'error');
  });

  const name = el('input', { type: 'text', autocomplete: 'name', placeholder: 'Your name', 'aria-label': 'Your name' });
  const email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'Email', 'aria-label': 'Email', required: true });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Password', minlength: '8', required: true });
  const submit = el('button', { class: 'auth-submit', type: 'submit' });
  const switchLink = el('button', { class: 'auth-link', type: 'button' });
  const forgot = el('button', { class: 'auth-link', type: 'button', text: 'Forgot password?' });
  const nameRow = el('label', { class: 'auth-field' }, name);
  const passRow = el('label', { class: 'auth-field' }, password);

  const form = el('form', { class: 'auth-form', novalidate: true },
    nameRow,
    el('label', { class: 'auth-field' }, email),
    passRow,
    submit,
  );

  function sync() {
    nameRow.hidden = mode !== 'signup';
    passRow.hidden = mode === 'reset';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    submit.textContent = { signin: 'Sign in', signup: 'Create free account', reset: 'Send reset link' }[mode];
    switchLink.textContent = mode === 'signin' ? 'New here? Create a free account' : 'Already have an account? Sign in';
    forgot.hidden = mode !== 'signin';
    setMsg('');
  }
  switchLink.addEventListener('click', () => { mode = mode === 'signin' ? 'signup' : 'signin'; sync(); });
  forgot.addEventListener('click', () => { mode = 'reset'; sync(); email.focus(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg('Enter a valid email address.', 'error'); email.focus(); return; }
    if (mode !== 'reset' && password.value.length < 8) { setMsg('Password must be at least 8 characters.', 'error'); password.focus(); return; }
    submit.disabled = true;
    try {
      if (mode === 'signin') {
        await signInWithEmail(em, password.value);
        onSignedIn?.();
      } else if (mode === 'signup') {
        const r = await signUpWithEmail(em, password.value, name.value.trim());
        if (r.needsConfirmation) { setMsg('Check your inbox — click the link we sent to confirm your email, then sign in here.', 'ok'); mode = 'signin'; sync(); setMsg('Check your inbox — click the link we sent to confirm your email, then sign in here.', 'ok'); }
        else onSignedIn?.();
      } else {
        await sendPasswordReset(em);
        mode = 'signin'; sync();
        setMsg('If that email has an account, a reset link is on its way.', 'ok');
      }
    } catch (err) {
      setMsg(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  root.innerHTML = '';
  appendAll(root,
    compact ? null : el('h2', { class: 'auth-title', text: 'Sign in to AuditLens' }),
    el('p', { class: 'auth-sub', text: `Free plan: ${PLANS.free.auditsPerMonth} audits a month. No card needed.` }),
    google,
    el('div', { class: 'auth-or' }, el('span', { text: 'or' })),
    form,
    msg,
    el('div', { class: 'auth-links' }, switchLink, forgot),
    CONFIG.TERMS_URL || CONFIG.PRIVACY_URL
      ? el('p', { class: 'auth-legal' }, 'By continuing you agree to the ', CONFIG.TERMS_URL ? el('a', { href: CONFIG.TERMS_URL, target: '_blank', text: 'Terms' }) : 'Terms', ' and ', CONFIG.PRIVACY_URL ? el('a', { href: CONFIG.PRIVACY_URL, target: '_blank', text: 'Privacy policy' }) : 'Privacy policy', '.')
      : null,
    el('p', { class: 'auth-legal', text: 'Your audits stay on this computer. Your account only stores your email and plan.' }),
  );
  sync();
}

/**
 * Renders the Pro upgrade panel.
 * @param {HTMLElement} root
 * @param {{reason?: string, onUpgraded?: () => void}} opts
 */
export function renderUpgrade(root, { reason = '', onUpgraded } = {}) {
  const status = el('p', { class: 'auth-msg', role: 'status', 'aria-live': 'polite' });
  const btn = el('button', { class: 'auth-submit upgrade', type: 'button', text: `Upgrade to Pro · ${CONFIG.PRO_PRICE_LABEL}/${CONFIG.PRO_PERIOD_LABEL}` });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.className = 'auth-msg';
    status.textContent = 'Opening secure checkout…';
    try {
      await openCheckout();
      status.textContent = 'Complete the payment in the new tab. This page unlocks automatically when it’s done.';
      const e = await waitForPro();
      if (e.plan === 'pro') { status.className = 'auth-msg ok'; status.textContent = 'You’re on Pro. Everything is unlocked.'; onUpgraded?.(); }
      else { status.textContent = 'Still waiting for the payment. If you’ve paid, it can take a minute — reopen this window to check again.'; btn.disabled = false; }
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = err.message;
      btn.disabled = false;
    }
  });
  root.innerHTML = '';
  appendAll(root,
    reason ? el('p', { class: 'upgrade-reason', text: reason }) : null,
    el('div', { class: 'plan-compare' },
      el('div', { class: 'plan-col' },
        el('h3', { text: 'Free' }), el('p', { class: 'price', text: '$0' }),
        el('ul', {}, el('li', { text: `${PLANS.free.auditsPerMonth} single-page audits a month` }), el('li', { text: `Top ${PLANS.free.findingsShown} findings with fixes` }), el('li', { text: 'PageSpeed scores' }), el('li', { text: 'PDF summary (watermarked)' }))),
      el('div', { class: 'plan-col pro' },
        el('h3', { text: 'Pro' }), el('p', { class: 'price' }, CONFIG.PRO_PRICE_LABEL, el('span', { text: ` / ${CONFIG.PRO_PERIOD_LABEL}` })),
        el('ul', {}, PRO_FEATURES.map((f) => el('li', { text: f })))),
    ),
    btn,
    status,
    el('p', { class: 'auth-legal', text: 'Billed monthly through Dodo Payments (cards, UPI and more). Cancel any time from “Manage subscription”.' }),
  );
}
