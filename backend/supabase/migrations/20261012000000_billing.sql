-- AuditLens accounts, plans and usage.
-- Run in Supabase: SQL editor → paste → Run (or `supabase db push`).
--
-- Plans: 'free' (3 single-page audits per calendar month, UTC) and 'pro' ($10/month via Dodo).
-- Keep FREE_AUDITS_PER_MONTH below in sync with src/config.js → PLANS.free.auditsPerMonth.

-- ---------------------------------------------------------------------------
-- Profiles (one row per signed-up user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Subscriptions (written ONLY by the dodo-webhook edge function with the service role)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'none',           -- none | active | on_hold | cancelled | expired | failed
  dodo_customer_id text,
  dodo_subscription_id text unique,
  product_id text,
  current_period_end timestamptz,                -- Dodo next_billing_date
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Monthly usage for the free plan
-- ---------------------------------------------------------------------------
create table if not exists public.audit_usage (
  user_id uuid not null references auth.users on delete cascade,
  period text not null,                          -- 'YYYY-MM' (UTC)
  audits int not null default 0,
  primary key (user_id, period)
);

-- Webhook idempotency (Dodo may retry deliveries)
create table if not exists public.webhook_events (
  id text primary key,                           -- webhook-id header
  type text,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security: users can read their own rows; nobody writes from the client.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_usage enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions for select using (auth.uid() = user_id);
drop policy if exists "own usage" on public.audit_usage;
create policy "own usage" on public.audit_usage for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RPCs called by the extension (via PostgREST /rest/v1/rpc/...)
-- ---------------------------------------------------------------------------

-- Is the user Pro right now? Includes a 3-day grace after the period end so a
-- delayed renewal webhook never locks a paying customer out.
create or replace function public.is_pro(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user
      and s.plan = 'pro'
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')
  );
$$;

create or replace function public.get_plan()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  free_limit constant int := 3;                  -- FREE_AUDITS_PER_MONTH
  used int;
  sub public.subscriptions;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into sub from public.subscriptions where user_id = uid;
  select coalesce(audits, 0) into used from public.audit_usage where user_id = uid and period = to_char(now() at time zone 'utc', 'YYYY-MM');
  return json_build_object(
    'plan', case when public.is_pro(uid) then 'pro' else 'free' end,
    'status', coalesce(sub.status, 'none'),
    'current_period_end', sub.current_period_end,
    'cancel_at_period_end', coalesce(sub.cancel_at_period_end, false),
    'has_customer', sub.dodo_customer_id is not null,
    'used', coalesce(used, 0),
    'limit', free_limit
  );
end $$;

-- Called before every audit. Pro: always allowed. Free: single-page audits only,
-- up to free_limit per month; increments the counter atomically.
create or replace function public.consume_audit(kind text default 'page')
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  free_limit constant int := 3;                  -- FREE_AUDITS_PER_MONTH
  p text := to_char(now() at time zone 'utc', 'YYYY-MM');
  new_count int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if public.is_pro(uid) then
    return json_build_object('allowed', true, 'plan', 'pro');
  end if;
  if kind <> 'page' then
    return json_build_object('allowed', false, 'plan', 'free', 'reason', 'pro_only');
  end if;
  insert into public.audit_usage as u (user_id, period, audits) values (uid, p, 1)
  on conflict (user_id, period) do update set audits = u.audits + 1
    where u.audits < free_limit
  returning audits into new_count;
  if new_count is null then
    return json_build_object('allowed', false, 'plan', 'free', 'reason', 'limit', 'used', free_limit, 'limit', free_limit);
  end if;
  return json_build_object('allowed', true, 'plan', 'free', 'used', new_count, 'limit', free_limit);
end $$;

revoke all on function public.consume_audit(text) from public, anon;
revoke all on function public.get_plan() from public, anon;
grant execute on function public.consume_audit(text) to authenticated;
grant execute on function public.get_plan() to authenticated;
