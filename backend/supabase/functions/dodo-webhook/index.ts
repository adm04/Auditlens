// POST /functions/v1/dodo-webhook   (called by Dodo Payments, no user auth)
// Deploy with:  supabase functions deploy dodo-webhook --no-verify-jwt
// Verifies the Standard Webhooks signature, ignores duplicates, and updates public.subscriptions.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyStandardWebhook, mapSubscriptionEvent, json } from '../_shared/billing.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const headers = {
    id: req.headers.get('webhook-id') ?? '',
    timestamp: req.headers.get('webhook-timestamp') ?? '',
    signature: req.headers.get('webhook-signature') ?? '',
  };
  const ok = await verifyStandardWebhook(Deno.env.get('DODO_WEBHOOK_SECRET') ?? '', headers, raw);
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  const event = JSON.parse(raw);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Idempotency: Dodo retries until it gets a 2xx.
  const { error: dupErr } = await admin.from('webhook_events').insert({ id: headers.id, type: event.type });
  if (dupErr && dupErr.code === '23505') return json({ ok: true, duplicate: true });

  const row = mapSubscriptionEvent(event, { proProductId: Deno.env.get('DODO_PRO_PRODUCT_ID') });
  if (!row) return json({ ok: true, ignored: event.type });

  // Find the user: metadata.user_id (set at checkout) → existing subscription id → email.
  let userId = row.user_id;
  if (!userId && row.dodo_subscription_id) {
    const { data } = await admin.from('subscriptions').select('user_id').eq('dodo_subscription_id', row.dodo_subscription_id).maybeSingle();
    userId = data?.user_id;
  }
  if (!userId && row.email) {
    const { data } = await admin.from('profiles').select('id').ilike('email', row.email).maybeSingle();
    userId = data?.id;
  }
  if (!userId) {
    console.error('Webhook for unknown user', event.type, row.dodo_subscription_id, row.email);
    return json({ ok: true, unmatched: true }); // 2xx so Dodo stops retrying; investigate in logs
  }

  const update: Record<string, unknown> = {
    user_id: userId,
    status: row.status,
    dodo_subscription_id: row.dodo_subscription_id,
    product_id: row.product_id,
    cancel_at_period_end: row.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  if (row.dodo_customer_id) update.dodo_customer_id = row.dodo_customer_id;
  if (row.current_period_end) update.current_period_end = row.current_period_end;
  if (!row.keepPlan) update.plan = row.plan;

  const { error } = await admin.from('subscriptions').upsert(update, { onConflict: 'user_id' });
  if (error) {
    console.error('Subscription update failed', error);
    await admin.from('webhook_events').delete().eq('id', headers.id); // allow the retry to process
    return json({ error: 'db' }, 500);
  }
  return json({ ok: true });
});
