-- Iron Log: billing core (Razorpay subscriptions + one-time 3-day trial).
--
-- DRAFT: NOT applied to any database. Stage 1 design artifact; it is verified only against an in-process Postgres
-- (src/test/rls.billing.test.ts). Do not apply to the live project before review. Design: docs/billing/STAGE1_ARCHITECTURE.md.
--
-- Trust model. Billing state is written ONLY by the server (service_role key, server-side env only) from Razorpay
-- webhooks and verified Razorpay API reads. Signed-in users get read-only access to their OWN subscription and payment rows
-- (column-limited, RLS-scoped); they have no write privilege on any billing table and no access at all to trial claims or
-- webhook events. The SECURITY DEFINER functions below are executable by service_role only. Because service_role bypasses
-- RLS, the server must always pass the user id it verified from the Supabase JWT; it must never take it from a request body.
--
-- Idempotent: safe to run more than once. Reversible: see the rollback block at the end of this file.

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_subscriptions: one row per Razorpay subscription attempt. Money amounts are integer paise (INR only).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.billing_subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users (id) on delete cascade,
  plan_key                 text        not null,
  razorpay_plan_id         text        not null,
  razorpay_subscription_id text        unique,
  razorpay_customer_id     text,
  billing_period           text        not null,
  billing_interval         integer     not null default 1,
  amount_paise             integer     not null,
  currency                 text        not null default 'INR',
  -- 'creating' = our intent row, written before the Razorpay call; the other values mirror Razorpay's subscription statuses.
  status                   text        not null default 'creating',
  payment_status           text        not null default 'none',
  -- Trial: trial_end_at is the future start date sent to Razorpay (start_at) and the first charge date.
  -- trial_start_at is set only when authorization is confirmed by Razorpay, never from a browser callback.
  trial_start_at           timestamptz,
  trial_end_at             timestamptz,
  expire_by                timestamptz,
  auth_verified_at         timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  next_billing_at          timestamptz,
  paid_count               integer     not null default 0,
  total_count              integer,
  cancel_requested_at      timestamptz,
  cancel_at_cycle_end      boolean     not null default false,
  cancelled_at             timestamptz,
  ended_at                 timestamptz,
  -- Last instant this subscription grants access once cancelled. Set by the server when cancellation is requested.
  access_ends_at           timestamptz,
  razorpay_synced_at       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint billing_subscriptions_plan_key check (plan_key in ('monthly', 'annual')),
  constraint billing_subscriptions_period check (billing_period in ('monthly', 'yearly')),
  constraint billing_subscriptions_interval check (billing_interval >= 1),
  -- Razorpay limits recurring card/UPI debits to INR 15,000.
  constraint billing_subscriptions_amount check (amount_paise > 0 and amount_paise <= 1500000),
  constraint billing_subscriptions_currency check (currency = 'INR'),
  constraint billing_subscriptions_status check (status in
    ('creating', 'created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired')),
  constraint billing_subscriptions_payment_status check (payment_status in
    ('none', 'authorized', 'paid', 'retrying', 'failed', 'refunded')),
  constraint billing_subscriptions_rzp_id_present check (status in ('creating', 'expired') or razorpay_subscription_id is not null),
  constraint billing_subscriptions_trial_order check (
    trial_end_at is null or trial_start_at is null or trial_end_at > trial_start_at),
  constraint billing_subscriptions_trial_start_needs_end check (trial_start_at is null or trial_end_at is not null),
  constraint billing_subscriptions_paid_count check (paid_count >= 0)
);
comment on table public.billing_subscriptions is
  'Razorpay subscription attempts and their server-verified state. Written by the server only; users may read their own rows.';

-- At most one live subscription per user: prevents duplicate subscription creation under concurrent requests.
create unique index if not exists billing_subscriptions_one_live_per_user
  on public.billing_subscriptions (user_id)
  where status in ('creating', 'created', 'authenticated', 'active', 'pending', 'halted');
create index if not exists billing_subscriptions_user_created_idx on public.billing_subscriptions (user_id, created_at desc);
-- Reconciliation scans: unauthenticated rows past expire_by, trials past trial_end_at awaiting their first charge.
create index if not exists billing_subscriptions_status_trial_end_idx on public.billing_subscriptions (status, trial_end_at);
create index if not exists billing_subscriptions_customer_idx on public.billing_subscriptions (razorpay_customer_id)
  where razorpay_customer_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_trial_claims: one trial per person, ever. Survives account deletion (no cascade) so delete + re-signup with the
-- same email cannot restart a trial. email_hash is HMAC-SHA256 of the normalised email with a server-side pepper (computed
-- by the server; the plain email is not stored here).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.billing_trial_claims (
  email_hash      text        primary key,
  user_id         uuid        references auth.users (id) on delete set null,
  subscription_id uuid        references public.billing_subscriptions (id) on delete set null,
  state           text        not null default 'reserved',
  reserved_at     timestamptz not null default now(),
  consumed_at     timestamptz,
  constraint billing_trial_claims_hash_length check (char_length(email_hash) between 16 and 128),
  constraint billing_trial_claims_state check (state in ('reserved', 'consumed')),
  constraint billing_trial_claims_consumed_at check ((state = 'consumed') = (consumed_at is not null))
);
comment on table public.billing_trial_claims is
  'One-time trial eligibility. reserved = a trial subscription is being set up; consumed = Razorpay confirmed authorization.';
-- A user id can consume only one trial even if their email changes.
create unique index if not exists billing_trial_claims_one_consumed_per_user
  on public.billing_trial_claims (user_id) where state = 'consumed' and user_id is not null;
create index if not exists billing_trial_claims_user_idx on public.billing_trial_claims (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_payments: payment history. Never stores card numbers, CVV, VPAs or any payment credential.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.billing_payments (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  subscription_id     uuid        not null references public.billing_subscriptions (id) on delete cascade,
  razorpay_payment_id text        not null unique,
  razorpay_invoice_id text,
  kind                text        not null,
  status              text        not null,
  amount_paise        integer     not null,
  currency            text        not null default 'INR',
  method              text,
  error_code          text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint billing_payments_kind check (kind in ('authorization', 'charge')),
  constraint billing_payments_status check (status in ('authorized', 'captured', 'failed', 'refunded')),
  constraint billing_payments_amount check (amount_paise >= 0),
  constraint billing_payments_currency check (currency = 'INR'),
  constraint billing_payments_method_length check (method is null or char_length(method) <= 32),
  constraint billing_payments_error_code_length check (error_code is null or char_length(error_code) <= 64)
);
comment on table public.billing_payments is 'Payments reported by Razorpay for a subscription. Deduplicated on razorpay_payment_id.';
create index if not exists billing_payments_user_created_idx on public.billing_payments (user_id, created_at desc);
create index if not exists billing_payments_subscription_idx on public.billing_payments (subscription_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_webhook_events: idempotency ledger keyed by Razorpay's x-razorpay-event-id. Holds ids and a digest only, never the
-- raw payload (which contains customer contact details).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.billing_webhook_events (
  razorpay_event_id        text        primary key,
  event_type               text        not null,
  razorpay_subscription_id text,
  razorpay_payment_id      text,
  payload_sha256           text,
  event_created_at         timestamptz,
  status                   text        not null default 'received',
  attempts                 integer     not null default 1,
  error_code               text,
  received_at              timestamptz not null default now(),
  processed_at             timestamptz,
  constraint billing_webhook_events_id_length check (char_length(razorpay_event_id) between 1 and 128),
  constraint billing_webhook_events_type_length check (char_length(event_type) between 1 and 64),
  constraint billing_webhook_events_status check (status in ('received', 'processed', 'ignored', 'failed')),
  constraint billing_webhook_events_error_length check (error_code is null or char_length(error_code) <= 64)
);
comment on table public.billing_webhook_events is 'Webhook idempotency ledger. Server only; no client access. Rows older than ~90 days may be deleted.';
create index if not exists billing_webhook_events_received_idx on public.billing_webhook_events (received_at);
create index if not exists billing_webhook_events_subscription_idx on public.billing_webhook_events (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges and RLS.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.billing_subscriptions  enable row level security;
alter table public.billing_trial_claims   enable row level security;
alter table public.billing_payments       enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on public.billing_subscriptions, public.billing_trial_claims, public.billing_payments, public.billing_webhook_events
  from public, anon, authenticated;

-- Signed-in users may read their own subscription and payment rows, limited to display columns (no Razorpay ids).
grant select (id, user_id, plan_key, billing_period, billing_interval, amount_paise, currency, status, payment_status,
              trial_start_at, trial_end_at, current_period_start, current_period_end, next_billing_at, paid_count,
              cancel_requested_at, cancel_at_cycle_end, cancelled_at, ended_at, access_ends_at, created_at, updated_at)
  on public.billing_subscriptions to authenticated;
grant select (id, user_id, subscription_id, kind, status, amount_paise, currency, method, paid_at, created_at)
  on public.billing_payments to authenticated;

drop policy if exists "billing_subscriptions_select_own" on public.billing_subscriptions;
create policy "billing_subscriptions_select_own"
  on public.billing_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "billing_payments_select_own" on public.billing_payments;
create policy "billing_payments_select_own"
  on public.billing_payments for select to authenticated
  using ((select auth.uid()) = user_id);

-- No INSERT/UPDATE/DELETE privilege or policy for clients on any table. billing_trial_claims and billing_webhook_events
-- have no client privilege and no policy at all. The server uses service_role (explicit grants; it bypasses RLS).
grant select, insert, update on public.billing_subscriptions to service_role;
grant select, insert, update on public.billing_trial_claims to service_role;
grant select, insert, update on public.billing_payments to service_role;
grant select, insert, update, delete on public.billing_webhook_events to service_role;

drop trigger if exists billing_subscriptions_set_updated_at on public.billing_subscriptions;
create trigger billing_subscriptions_set_updated_at
  before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists billing_payments_set_updated_at on public.billing_payments;
create trigger billing_payments_set_updated_at
  before update on public.billing_payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_get_entitlement: the single server-authoritative access decision, computed from stored, Razorpay-verified state and
-- the database clock. A frontend timer is never an input. p_pending_grace_hours (server config, default 0) optionally keeps
-- access for a short window while Razorpay retries a failed renewal; 0 means no access while payment is pending.
-- States: trialing, active, cancelled_active, payment_pending, payment_failed, trial_expired, cancelled, expired, none.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.billing_get_entitlement(p_user_id uuid, p_pending_grace_hours integer default 0)
returns table (state text, has_access boolean, access_ends_at timestamptz, subscription_id uuid, plan_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  v_now timestamptz := now();
  v_grace interval := make_interval(hours => greatest(coalesce(p_pending_grace_hours, 0), 0));
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;

  -- Rows that never reached authentication ('creating', 'created', 'expired') grant nothing and are ignored here.
  select * into s
  from public.billing_subscriptions b
  where b.user_id = p_user_id and b.status not in ('creating', 'created', 'expired')
  order by b.created_at desc
  limit 1;

  if not found then
    return query select 'none'::text, false, null::timestamptz, null::uuid, null::text;
    return;
  end if;

  if s.status = 'authenticated' then
    -- Authorized, trial running. After trial_end_at access stops until Razorpay reports the first charge as paid.
    if s.trial_end_at is not null and s.trial_end_at > v_now then
      return query select 'trialing'::text, true, s.trial_end_at, s.id, s.plan_key;
    else
      return query select 'payment_pending'::text, false, null::timestamptz, s.id, s.plan_key;
    end if;
  elsif s.status = 'active' then
    if s.current_period_end is not null and s.current_period_end > v_now then
      if s.cancel_requested_at is not null then
        return query select 'cancelled_active'::text, true, coalesce(s.access_ends_at, s.current_period_end), s.id, s.plan_key;
      else
        return query select 'active'::text, true, s.current_period_end, s.id, s.plan_key;
      end if;
    else
      return query select 'payment_pending'::text, false, null::timestamptz, s.id, s.plan_key;
    end if;
  elsif s.status = 'pending' then
    if s.current_period_end is not null and v_grace > interval '0' and v_now < s.current_period_end + v_grace then
      return query select 'payment_pending'::text, true, s.current_period_end + v_grace, s.id, s.plan_key;
    else
      return query select 'payment_pending'::text, false, null::timestamptz, s.id, s.plan_key;
    end if;
  elsif s.status = 'halted' then
    return query select 'payment_failed'::text, false, null::timestamptz, s.id, s.plan_key;
  elsif s.status = 'cancelled' then
    if s.access_ends_at is not null and s.access_ends_at > v_now then
      return query select 'cancelled_active'::text, true, s.access_ends_at, s.id, s.plan_key;
    elsif s.paid_count = 0 then
      return query select 'trial_expired'::text, false, null::timestamptz, s.id, s.plan_key;
    else
      return query select 'cancelled'::text, false, null::timestamptz, s.id, s.plan_key;
    end if;
  else -- completed
    return query select 'expired'::text, false, null::timestamptz, s.id, s.plan_key;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- billing_begin_subscription: atomically (per user) decides trial eligibility and writes the 'creating' intent row, BEFORE
-- the server calls Razorpay. Concurrent requests for one user serialise on an advisory lock; the one-live-subscription unique
-- index is the backstop. outcome 'existing' returns the user's live subscription so the server can reuse or reject; it never
-- creates a second one. A trial is offered only if no claim exists for this email hash or this user.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.billing_begin_subscription(
  p_user_id uuid,
  p_email_hash text,
  p_plan_key text,
  p_razorpay_plan_id text,
  p_billing_period text,
  p_amount_paise integer,
  p_trial_days integer,
  p_authorization_window_minutes integer
)
returns table (outcome text, subscription_id uuid, status text, plan_key text, trial_eligible boolean, trial_end_at timestamptz, expire_by timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live public.billing_subscriptions%rowtype;
  v_claim public.billing_trial_claims%rowtype;
  v_eligible boolean := false;
  v_window interval;
  v_expire timestamptz;
  v_trial_end timestamptz;
  v_id uuid;
begin
  if p_user_id is null or p_email_hash is null or p_plan_key is null or p_razorpay_plan_id is null
     or coalesce(p_trial_days, 0) < 0 or coalesce(p_trial_days, 0) > 30
     or coalesce(p_authorization_window_minutes, 0) < 5 or p_authorization_window_minutes > 1440 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_user_id::text, 0));

  select * into v_live from public.billing_subscriptions b
  where b.user_id = p_user_id and b.status in ('creating', 'created', 'authenticated', 'active', 'pending', 'halted')
  limit 1;
  if found then
    return query select 'existing'::text, v_live.id, v_live.status, v_live.plan_key,
      (v_live.trial_end_at is not null), v_live.trial_end_at, v_live.expire_by;
    return;
  end if;

  if coalesce(p_trial_days, 0) > 0 then
    select * into v_claim from public.billing_trial_claims c where c.email_hash = p_email_hash for update;
    if found then
      -- A reserved claim from an abandoned attempt (same user, or an account that was deleted) can be taken over.
      if v_claim.state = 'reserved' and (v_claim.user_id is null or v_claim.user_id = p_user_id) then
        update public.billing_trial_claims set user_id = p_user_id, reserved_at = now() where email_hash = p_email_hash;
        v_eligible := true;
      end if;
    elsif exists (select 1 from public.billing_trial_claims c where c.user_id = p_user_id and c.state = 'consumed') then
      v_eligible := false; -- same account already used its trial under a previous email
    else
      insert into public.billing_trial_claims (email_hash, user_id, state) values (p_email_hash, p_user_id, 'reserved');
      v_eligible := true;
    end if;
  end if;

  v_window := make_interval(mins => p_authorization_window_minutes);
  v_expire := now() + v_window;
  -- The trial runs for p_trial_days after the last moment the customer can still authorize, so it is never shorter than advertised.
  v_trial_end := case when v_eligible then v_expire + make_interval(days => p_trial_days) else null end;

  insert into public.billing_subscriptions
    (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise, status, trial_end_at, expire_by)
  values
    (p_user_id, p_plan_key, p_razorpay_plan_id, p_billing_period, p_amount_paise, 'creating', v_trial_end, v_expire)
  returning id into v_id;

  if v_eligible then
    update public.billing_trial_claims set subscription_id = v_id where email_hash = p_email_hash;
  end if;

  return query select 'created'::text, v_id, 'creating'::text, p_plan_key, v_eligible, v_trial_end, v_expire;
end;
$$;

-- billing_consume_trial_claim: called by the server only after Razorpay itself reports the subscription authenticated.
create or replace function public.billing_consume_trial_claim(p_user_id uuid, p_subscription_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.billing_trial_claims c
     set state = 'consumed', consumed_at = coalesce(c.consumed_at, now())
   where c.subscription_id = p_subscription_id and c.user_id = p_user_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- billing_begin_webhook_event: idempotency gate. Returns 'process' (first delivery, or a retry of a failed/stale one),
-- 'duplicate' (already processed or deliberately ignored), or 'in_progress' (another delivery is being handled right now).
create or replace function public.billing_begin_webhook_event(
  p_event_id text,
  p_event_type text,
  p_razorpay_subscription_id text,
  p_razorpay_payment_id text,
  p_payload_sha256 text,
  p_event_created_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_ev public.billing_webhook_events%rowtype;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 128 or p_event_type is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  insert into public.billing_webhook_events
    (razorpay_event_id, event_type, razorpay_subscription_id, razorpay_payment_id, payload_sha256, event_created_at)
  values
    (p_event_id, p_event_type, p_razorpay_subscription_id, p_razorpay_payment_id, p_payload_sha256, p_event_created_at)
  on conflict (razorpay_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return 'process';
  end if;

  select * into v_ev from public.billing_webhook_events e where e.razorpay_event_id = p_event_id for update;
  if v_ev.status in ('processed', 'ignored') then
    return 'duplicate';
  end if;
  if v_ev.status = 'failed' or v_ev.received_at < now() - interval '2 minutes' then
    update public.billing_webhook_events
       set status = 'received', attempts = attempts + 1, received_at = now(), error_code = null
     where razorpay_event_id = p_event_id;
    return 'process';
  end if;
  return 'in_progress';
end;
$$;

-- Only the server (service_role) may call these. They are never reachable by anon or authenticated callers.
revoke all on function public.billing_get_entitlement(uuid, integer) from public, anon, authenticated;
revoke all on function public.billing_begin_subscription(uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.billing_consume_trial_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.billing_begin_webhook_event(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_get_entitlement(uuid, integer) to service_role;
grant execute on function public.billing_begin_subscription(uuid, text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.billing_consume_trial_claim(uuid, uuid) to service_role;
grant execute on function public.billing_begin_webhook_event(text, text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- ROLLBACK (not part of the migration; run manually to undo, only before real billing data exists):
--   drop function if exists public.billing_begin_webhook_event(text, text, text, text, text, timestamptz);
--   drop function if exists public.billing_consume_trial_claim(uuid, uuid);
--   drop function if exists public.billing_begin_subscription(uuid, text, text, text, text, integer, integer, integer);
--   drop function if exists public.billing_get_entitlement(uuid, integer);
--   drop table if exists public.billing_webhook_events;
--   drop table if exists public.billing_payments;
--   drop table if exists public.billing_trial_claims;
--   drop table if exists public.billing_subscriptions;
-- ---------------------------------------------------------------------------------------------------------------------
