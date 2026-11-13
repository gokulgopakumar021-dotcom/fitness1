-- Iron Log: billing deletion safeguards + INR 5 authorization refund tracking (additive follow-up to 20261106052859_billing_core.sql).
--
-- Final Stage 1 design (docs/billing/STAGE1_ARCHITECTURE.md, section 5a). Idempotent: safe to run more than once, and a no-op
-- for anything already present. Changes:
--   * subscription/payment rows survive account deletion (user_id on delete set null) so orphaned Razorpay events can be handled,
--   * billing_stop_verified_at + billing_mark_stop_verified(): recorded only after Razorpay itself reports a terminal status,
--   * delete_own_account() refuses deletion until every subscription is verified stopped (billing_assert_account_deletable),
--   * refund tracking for the refundable INR 5 authorization payment and a revenue view that excludes it.
-- Rollback: see the end of this file.

-- Rows must outlive the user (orphan handling), so user_id becomes nullable and is nulled, not cascaded, on account deletion.
alter table public.billing_subscriptions alter column user_id drop not null;
alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_user_id_fkey;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

alter table public.billing_payments alter column user_id drop not null;
alter table public.billing_payments drop constraint if exists billing_payments_user_id_fkey;
alter table public.billing_payments
  add constraint billing_payments_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- Set only by the server after Razorpay reported a terminal status (cancelled/completed/expired). Gate for account deletion.
alter table public.billing_subscriptions add column if not exists billing_stop_verified_at timestamptz;
alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_stop_verified_terminal;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_stop_verified_terminal check (
    billing_stop_verified_at is null or status in ('cancelled', 'completed', 'expired'));
create index if not exists billing_subscriptions_orphan_idx on public.billing_subscriptions (razorpay_subscription_id)
  where user_id is null and billing_stop_verified_at is null;

-- Refund tracking. The INR 5 authorization payment is refunded automatically by Razorpay; it is NOT revenue.
alter table public.billing_payments add column if not exists amount_refunded_paise integer not null default 0;
alter table public.billing_payments add column if not exists refunded_at timestamptz;
alter table public.billing_payments drop constraint if exists billing_payments_refund_amount;
alter table public.billing_payments
  add constraint billing_payments_refund_amount check (amount_refunded_paise >= 0 and amount_refunded_paise <= amount_paise);
alter table public.billing_payments drop constraint if exists billing_payments_refunded_needs_time;
alter table public.billing_payments
  add constraint billing_payments_refunded_needs_time check (status <> 'refunded' or refunded_at is not null);
grant select (amount_refunded_paise, refunded_at) on public.billing_payments to authenticated;

-- billing_mark_stop_verified: called by the server ONLY after it has read a terminal status (cancelled/completed/expired) for
-- this subscription from Razorpay itself (the cancel API response or a fresh fetch), never from a webhook body or a client
-- request alone. It records that recurring billing is confirmed stopped; account deletion depends on it.
create or replace function public.billing_mark_stop_verified(p_subscription_id uuid, p_observed_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_subscription_id is null or p_observed_status is null or p_observed_status not in ('cancelled', 'completed', 'expired') then
    raise exception 'a terminal Razorpay status is required' using errcode = '22023';
  end if;
  update public.billing_subscriptions b
     set status = p_observed_status,
         billing_stop_verified_at = coalesce(b.billing_stop_verified_at, now()),
         cancelled_at = case when p_observed_status = 'cancelled' then coalesce(b.cancelled_at, now()) else b.cancelled_at end,
         ended_at = coalesce(b.ended_at, now())
   where b.id = p_subscription_id and b.razorpay_subscription_id is not null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- billing_assert_account_deletable: raises billing_cancellation_required unless EVERY subscription of the user is confirmed
-- stopped. Rows that never reached Razorpay (no razorpay_subscription_id, status expired) hold no mandate and do not block.
-- A subscription still creating/created/authenticated/active/pending/halted blocks; so does a terminal row the server has not yet
-- verified with Razorpay (covers delayed or lost webhooks). Cancel-at-cycle-end leaves the status 'active' and therefore blocks:
-- the user must cancel immediately (access ends now, no refund) before deleting.
create or replace function public.billing_assert_account_deletable(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.billing_subscriptions b
    where b.user_id = p_user_id
      and not (b.status = 'expired' and b.razorpay_subscription_id is null)
      and not (b.status in ('cancelled', 'completed', 'expired') and b.billing_stop_verified_at is not null)
  ) then
    raise exception 'billing_cancellation_required' using errcode = 'BL001',
      hint = 'Cancel the subscription and wait for confirmation before deleting the account.';
  end if;
end;
$$;

-- delete_own_account: same behaviour as 20261030053401, plus the billing gate. It takes the SAME per-user advisory lock as
-- billing_begin_subscription, so a new subscription cannot be created while deletion is being decided. Grants are unchanged
-- (create or replace keeps them): executable by authenticated users only.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || uid::text, 0));
  perform public.billing_assert_account_deletable(uid);
  delete from auth.users where id = uid;
end;
$$;

-- Revenue = captured subscription CHARGES only. The refundable INR 5 authorization payment (kind = 'authorization') is excluded
-- by definition, whatever its status. Server/reporting use only.
create or replace view public.billing_revenue_payments with (security_invoker = true) as
  select id, user_id, subscription_id, razorpay_payment_id, amount_paise, currency, paid_at
  from public.billing_payments
  where kind = 'charge' and status = 'captured';

-- billing_unrefunded_authorizations: authorization payments Razorpay has not refunded within p_older_than_minutes. The server's
-- reconciler re-fetches these from Razorpay and raises an alert; nothing here assumes a refund webhook event exists.
create or replace function public.billing_unrefunded_authorizations(p_older_than_minutes integer default 1440)
returns table (payment_id uuid, razorpay_payment_id text, subscription_id uuid, amount_paise integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.razorpay_payment_id, p.subscription_id, p.amount_paise, p.created_at
  from public.billing_payments p
  where p.kind = 'authorization'
    and p.status <> 'failed'
    and p.status <> 'refunded'
    and p.created_at < now() - make_interval(mins => greatest(coalesce(p_older_than_minutes, 1440), 1))
  order by p.created_at;
$$;

revoke all on function public.billing_mark_stop_verified(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_assert_account_deletable(uuid) from public, anon, authenticated;
revoke all on function public.billing_unrefunded_authorizations(integer) from public, anon, authenticated;
grant execute on function public.billing_mark_stop_verified(uuid, text) to service_role;
grant execute on function public.billing_assert_account_deletable(uuid) to service_role;
grant execute on function public.billing_unrefunded_authorizations(integer) to service_role;
revoke all on public.billing_revenue_payments from public, anon, authenticated;
grant select on public.billing_revenue_payments to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- ROLLBACK (not part of the migration; run manually, only before real billing data exists):
--   -- restore the original delete_own_account() by re-running supabase/migrations/20261030053401_delete_own_account.sql
--   drop view if exists public.billing_revenue_payments;
--   drop function if exists public.billing_unrefunded_authorizations(integer);
--   drop function if exists public.billing_assert_account_deletable(uuid);
--   drop function if exists public.billing_mark_stop_verified(uuid, text);
--   alter table public.billing_payments drop column if exists refunded_at, drop column if exists amount_refunded_paise;
--   alter table public.billing_subscriptions drop column if exists billing_stop_verified_at;
--   (user_id nullability / on delete set null can stay; reverting needs no rows with a null user_id.)
-- ---------------------------------------------------------------------------------------------------------------------
