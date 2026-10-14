// A tiny stand-in for Supabase (Auth REST, RPCs, Edge Functions) and Dodo checkout, used by
// tests/e2e-billing.mjs. It mirrors the real contracts:
//   /auth/v1/signup, /auth/v1/token?grant_type=password|refresh_token, /auth/v1/user, /auth/v1/logout, /auth/v1/recover
//   /rest/v1/rpc/get_plan, /rest/v1/rpc/consume_audit      (same logic as the SQL migration)
//   /functions/v1/create-checkout → fake hosted checkout page → signed Standard-Webhooks POST
//   /functions/v1/dodo-webhook    (verifies with the real shared billing.js + mapSubscriptionEvent)
//   /functions/v1/customer-portal

import http from 'node:http';
import { verifyStandardWebhook, signStandardWebhook, mapSubscriptionEvent } from '../backend/supabase/functions/_shared/billing.js';

const FREE_LIMIT = 3;
export const WEBHOOK_SECRET = 'whsec_' + Buffer.from('mock-webhook-secret-for-tests').toString('base64');

export function startMockBackend(port = 8790) {
  const users = new Map();     // email -> { id, email, password, name }
  const tokens = new Map();    // access token -> user id
  const subs = new Map();      // user id -> { plan, status, current_period_end, ... }
  const usage = new Map();     // user id -> count
  const log = [];
  let n = 0;

  const session = (u) => {
    const access = `at_${u.id}_${++n}`;
    tokens.set(access, u.id);
    return { access_token: access, refresh_token: `rt_${u.id}`, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email, user_metadata: { full_name: u.name } } };
  };
  const userFor = (req) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const id = tokens.get(t);
    return [...users.values()].find((u) => u.id === id);
  };
  const isPro = (id) => { const s = subs.get(id); return s?.plan === 'pro' && (!s.current_period_end || new Date(s.current_period_end) > Date.now() - 3 * 864e5); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    log.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method === 'OPTIONS') return send(200, {});

    if (url.pathname === '/auth/v1/signup') {
      if (users.has(body.email)) return send(400, { msg: 'User already registered' });
      const u = { id: `u${users.size + 1}`, email: body.email, password: body.password, name: body.data?.full_name || '' };
      users.set(u.email, u);
      subs.set(u.id, { plan: 'free', status: 'none' });
      return send(200, session(u));
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return send(200, session(u));
      }
      const u = [...users.values()].find((x) => `rt_${x.id}` === body.refresh_token);
      return u ? send(200, session(u)) : send(400, { error_description: 'Invalid Refresh Token' });
    }
    if (url.pathname === '/auth/v1/user') { const u = userFor(req); return u ? send(200, { id: u.id, email: u.email, user_metadata: {} }) : send(401, { msg: 'invalid' }); }
    if (url.pathname === '/auth/v1/logout') return send(204, '', 'text/plain');
    if (url.pathname === '/auth/v1/recover') return send(200, {});

    if (url.pathname === '/rest/v1/rpc/get_plan') {
      const u = userFor(req); if (!u) return send(401, { message: 'JWT expired' });
      const s = subs.get(u.id) || {};
      return send(200, { plan: isPro(u.id) ? 'pro' : 'free', status: s.status || 'none', current_period_end: s.current_period_end || null, cancel_at_period_end: !!s.cancel_at_period_end, has_customer: !!s.dodo_customer_id, used: usage.get(u.id) || 0, limit: FREE_LIMIT });
    }
    if (url.pathname === '/rest/v1/rpc/consume_audit') {
      const u = userFor(req); if (!u) return send(401, { message: 'JWT expired' });
      if (isPro(u.id)) return send(200, { allowed: true, plan: 'pro' });
      if ((body.kind || 'page') !== 'page') return send(200, { allowed: false, plan: 'free', reason: 'pro_only' });
      const used = usage.get(u.id) || 0;
      if (used >= FREE_LIMIT) return send(200, { allowed: false, plan: 'free', reason: 'limit', used, limit: FREE_LIMIT });
      usage.set(u.id, used + 1);
      return send(200, { allowed: true, plan: 'free', used: used + 1, limit: FREE_LIMIT });
    }

    if (url.pathname === '/functions/v1/create-checkout') {
      const u = userFor(req); if (!u) return send(401, { error: 'Please sign in again.' });
      if (isPro(u.id)) return send(409, { error: 'You already have Pro.' });
      return send(200, { checkout_url: `http://localhost:${port}/fake-checkout?user=${u.id}&email=${encodeURIComponent(u.email)}`, session_id: 'cks_test' });
    }
    if (url.pathname === '/fake-checkout') {
      // Simulates the customer paying: Dodo then sends a signed subscription.active webhook.
      const event = { business_id: 'bus_test', type: 'subscription.active', timestamp: new Date().toISOString(), data: {
        payload_type: 'Subscription', subscription_id: 'sub_test_1', product_id: 'pdt_pro', status: 'active',
        customer: { customer_id: 'cus_test_1', email: url.searchParams.get('email') },
        metadata: { user_id: url.searchParams.get('user') },
        next_billing_date: new Date(Date.now() + 30 * 864e5).toISOString(),
      } };
      const rawEvent = JSON.stringify(event);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = await signStandardWebhook(WEBHOOK_SECRET, 'msg_test_1', ts, rawEvent);
      setTimeout(() => {
        fetch(`http://localhost:${port}/functions/v1/dodo-webhook`, { method: 'POST', headers: { 'webhook-id': 'msg_test_1', 'webhook-timestamp': ts, 'webhook-signature': sig, 'content-type': 'application/json' }, body: rawEvent });
      }, 1500);
      return send(200, '<!doctype html><title>Test checkout</title><h1>Test payment complete</h1>', 'text/html');
    }
    if (url.pathname === '/functions/v1/dodo-webhook') {
      const ok = await verifyStandardWebhook(WEBHOOK_SECRET, { id: req.headers['webhook-id'], timestamp: req.headers['webhook-timestamp'], signature: req.headers['webhook-signature'] }, raw);
      if (!ok) return send(401, { error: 'Invalid signature' });
      const row = mapSubscriptionEvent(JSON.parse(raw), { proProductId: 'pdt_pro' });
      if (row?.user_id) {
        const prev = subs.get(row.user_id) || {};
        subs.set(row.user_id, { ...prev, status: row.status, dodo_customer_id: row.dodo_customer_id, current_period_end: row.current_period_end, cancel_at_period_end: row.cancel_at_period_end, ...(row.keepPlan ? {} : { plan: row.plan }) });
      }
      return send(200, { ok: true });
    }
    if (url.pathname === '/functions/v1/customer-portal') return send(200, { link: `http://localhost:${port}/portal` });
    if (url.pathname === '/portal') return send(200, '<h1>Billing portal (test)</h1>', 'text/html');

    send(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, users, subs, usage, log, close: () => server.close() })));
}
