// Plans, usage and checkout. The server (Supabase RPCs fed by the Dodo webhook) is the source
// of truth; the extension caches the answer in chrome.storage.local ('entitlement') so it
// works offline for a while and the UI doesn't wait on the network.
//
// In DEV_MODE (no Supabase configured in config.js) everything is local: the plan comes from
// the "Developer: simulate Pro" switch in Settings and free usage is counted locally.

import { CONFIG, PLANS, DEV_MODE } from './config.js';
import { api, getSession } from './auth.js';

const OFFLINE_GRACE_MS = 7 * 24 * 3600 * 1000;
const FRESH_MS = 5 * 60 * 1000;

const month = () => new Date().toISOString().slice(0, 7);

async function devEntitlement() {
  const { plan, devUsage } = await chrome.storage.local.get(['plan', 'devUsage']);
  const used = devUsage?.period === month() ? devUsage.audits : 0;
  return { plan: plan === 'pro' ? 'pro' : 'free', status: 'dev', used, limit: PLANS.free.auditsPerMonth, checkedAt: Date.now(), dev: true };
}

/** Current entitlement, refreshed from the server when stale. */
export async function getEntitlement({ force = false } = {}) {
  if (DEV_MODE) return devEntitlement();
  const session = await getSession();
  if (!session) return { plan: 'none', signedIn: false };
  const { entitlement } = await chrome.storage.local.get('entitlement');
  const sameUser = entitlement?.userId === session.user.id;
  if (!force && sameUser && Date.now() - entitlement.checkedAt < FRESH_MS) return { ...entitlement, signedIn: true };
  try {
    const p = await api('/rest/v1/rpc/get_plan', { body: {} });
    const fresh = { ...p, userId: session.user.id, checkedAt: Date.now() };
    await chrome.storage.local.set({ entitlement: fresh });
    return { ...fresh, signedIn: true };
  } catch (err) {
    if (sameUser && Date.now() - entitlement.checkedAt < OFFLINE_GRACE_MS) return { ...entitlement, signedIn: true, offline: true };
    return { plan: 'free', used: 0, limit: PLANS.free.auditsPerMonth, signedIn: true, error: err.message };
  }
}

export async function getPlan() {
  const e = await getEntitlement();
  return e.plan === 'pro' ? 'pro' : 'free';
}

export async function isPro() {
  return (await getPlan()) === 'pro';
}

export function limitsFor(plan) {
  return plan === 'pro' ? PLANS.pro : PLANS.free;
}

/**
 * Ask permission to run an audit (and count it for free users).
 * @param {'page'|'site'} kind
 * @returns {Promise<{allowed:boolean, reason?:'signin'|'limit'|'pro_only'|'error', used?:number, limit?:number, plan?:string, message?:string}>}
 */
export async function consumeAudit(kind = 'page') {
  if (DEV_MODE) {
    const e = await devEntitlement();
    if (e.plan === 'pro') return { allowed: true, plan: 'pro' };
    if (kind !== 'page') return { allowed: false, plan: 'free', reason: 'pro_only' };
    if (e.used >= e.limit) return { allowed: false, plan: 'free', reason: 'limit', used: e.used, limit: e.limit };
    await chrome.storage.local.set({ devUsage: { period: month(), audits: e.used + 1 } });
    return { allowed: true, plan: 'free', used: e.used + 1, limit: e.limit };
  }
  const session = await getSession();
  if (!session) return { allowed: false, reason: 'signin' };
  try {
    const r = await api('/rest/v1/rpc/consume_audit', { body: { kind } });
    const { entitlement } = await chrome.storage.local.get('entitlement');
    if (entitlement && r.used != null) await chrome.storage.local.set({ entitlement: { ...entitlement, used: r.used, plan: r.plan } });
    return r;
  } catch (err) {
    return { allowed: false, reason: 'error', message: err.message };
  }
}

/** Opens Dodo checkout in a new tab. Returns once the tab is open. */
export async function openCheckout() {
  if (DEV_MODE) throw new Error('Payments aren’t connected yet. Add your Supabase details to src/config.js (see SETUP.md).');
  const { checkout_url } = await api('/functions/v1/create-checkout', { body: {} });
  await chrome.tabs.create({ url: checkout_url });
}

/** Opens Dodo's customer portal (change card, invoices, cancel). */
export async function openBillingPortal() {
  if (DEV_MODE) throw new Error('Payments aren’t connected yet.');
  const { link } = await api('/functions/v1/customer-portal', { body: {} });
  await chrome.tabs.create({ url: link });
}

/** After checkout: poll until the webhook has upgraded the account (max ~10 minutes). */
export async function waitForPro({ onTick, timeoutMs = 10 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const e = await getEntitlement({ force: true });
    onTick?.(e);
    if (e.plan === 'pro') return e;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return getEntitlement({ force: true });
}

/** Developer-only (DEV_MODE): flip the local plan. */
export async function setPlanForTesting(plan) {
  await chrome.storage.local.set({ plan: plan === 'pro' ? 'pro' : 'free' });
}

export { DEV_MODE, CONFIG };
