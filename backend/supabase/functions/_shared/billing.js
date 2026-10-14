// Pure billing logic shared by the edge functions (Deno) and the Node unit tests.
// No Supabase or Dodo calls here — just signature checks and event → plan mapping.

const enc = new TextEncoder();

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Standard Webhooks verification (used by Dodo Payments).
 * signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with the
 * base64-decoded secret (after removing "whsec_"), compared against each "v1,<sig>" entry.
 * @returns {Promise<boolean>}
 */
export async function verifyStandardWebhook(secret, { id, timestamp, signature }, rawBody, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const keyBytes = b64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToB64(mac);
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && sig && safeEqual(sig, expected);
  });
}

/** Test helper: produce a valid signature header for a payload. */
export async function signStandardWebhook(secret, id, timestamp, rawBody) {
  const keyBytes = b64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  return `v1,${bytesToB64(mac)}`;
}

/**
 * Maps a Dodo subscription webhook to the row we store. Returns null for events we ignore.
 *
 *  subscription.active / renewed / plan_changed / updated(active) → pro, active
 *  subscription.on_hold / past_due  → pro until the current period ends (payment retry window)
 *  subscription.cancelled           → keeps pro until current_period_end, then is_pro() expires it
 *  subscription.expired / failed    → free
 */
export function mapSubscriptionEvent(event, { proProductId } = {}) {
  const type = event?.type || '';
  if (!type.startsWith('subscription.')) return null;
  const d = event.data || {};
  const productOk = !proProductId || !d.product_id || d.product_id === proProductId;
  const base = {
    dodo_subscription_id: d.subscription_id || null,
    dodo_customer_id: d.customer?.customer_id || null,
    email: d.customer?.email || null,
    user_id: d.metadata?.user_id || null,
    product_id: d.product_id || null,
    current_period_end: d.next_billing_date || null,
    cancel_at_period_end: !!d.cancel_at_next_billing_date,
  };
  switch (type) {
    case 'subscription.active':
    case 'subscription.renewed':
    case 'subscription.plan_changed':
      return { ...base, plan: productOk ? 'pro' : 'free', status: 'active' };
    case 'subscription.updated':
      if (d.status === 'active') return { ...base, plan: productOk ? 'pro' : 'free', status: 'active' };
      return { ...base, status: d.status || 'updated', keepPlan: true };
    case 'subscription.on_hold':
    case 'subscription.past_due':
      return { ...base, status: 'on_hold', keepPlan: true };
    case 'subscription.cancelled':
      return { ...base, status: 'cancelled', keepPlan: true, cancel_at_period_end: true };
    case 'subscription.expired':
    case 'subscription.failed':
      return { ...base, plan: 'free', status: type.split('.')[1] };
    default:
      return null;
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders, ...headers },
  });
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function dodoBaseUrl(env) {
  return env === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
}
