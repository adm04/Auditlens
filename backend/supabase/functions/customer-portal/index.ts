// POST /functions/v1/customer-portal   (Authorization: Bearer <user access token>)
// Returns a Dodo customer-portal link where the user can update their card, see invoices or cancel.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, corsHeaders, dodoBaseUrl } from '../_shared/billing.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: sub } = await admin.from('subscriptions').select('dodo_customer_id').eq('user_id', user.id).maybeSingle();
  if (!sub?.dodo_customer_id) return json({ error: 'No subscription found for this account.' }, 404);

  const res = await fetch(`${dodoBaseUrl(Deno.env.get('DODO_ENV'))}/customers/${encodeURIComponent(sub.dodo_customer_id)}/customer-portal/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.link) return json({ error: 'Couldn’t open the billing portal.' }, 502);
  return json({ link: data.link });
});
