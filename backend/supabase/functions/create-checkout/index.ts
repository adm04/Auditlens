// POST /functions/v1/create-checkout   (Authorization: Bearer <user access token>)
// Creates a Dodo Payments checkout session for the Pro subscription and returns its URL.
// The Supabase user id travels in metadata so the webhook can link the subscription.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, corsHeaders, dodoBaseUrl } from '../_shared/billing.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json({ error: 'Please sign in again.' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: sub } = await admin.from('subscriptions').select('plan, dodo_customer_id, current_period_end').eq('user_id', user.id).maybeSingle();
  if (sub?.plan === 'pro' && (!sub.current_period_end || new Date(sub.current_period_end) > new Date())) {
    return json({ error: 'You already have Pro. Use “Manage subscription” to change it.' }, 409);
  }

  const siteUrl = Deno.env.get('SITE_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/checkout-done`;
  const body = {
    product_cart: [{ product_id: Deno.env.get('DODO_PRO_PRODUCT_ID')!, quantity: 1 }],
    customer: sub?.dodo_customer_id
      ? { customer_id: sub.dodo_customer_id }
      : { email: user.email, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email },
    metadata: { user_id: user.id, app: 'auditlens' },
    return_url: siteUrl,
  };

  const res = await fetch(`${dodoBaseUrl(Deno.env.get('DODO_ENV'))}/checkouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.checkout_url) {
    console.error('Dodo checkout failed', res.status, data);
    return json({ error: 'Couldn’t start checkout. Please try again in a minute.' }, 502);
  }
  return json({ checkout_url: data.checkout_url, session_id: data.session_id });
});
