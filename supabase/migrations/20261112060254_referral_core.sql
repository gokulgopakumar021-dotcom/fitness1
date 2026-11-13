-- Iron Log: referral + commission foundation (Stage 1: database and security only).
--
-- DRAFT: NOT applied to any database. Verified only against an in-process Postgres (src/test/rls.referrals.test.ts).
-- Design: Stage 0 audit report (referral_* tables, append-only ledger, SECURITY DEFINER functions, service_role only).
-- Additive and backward compatible: creates new tables/functions only. It does NOT alter, attach triggers to, or otherwise
-- change any existing billing table or function, so billing behaviour is unchanged. Commission accrual is exposed as the
-- idempotent function referral_sync_commission(); wiring it to billing writes is a later, separately reviewed stage.
--
-- Fixed financial policy encoded here: 20% lifetime commission (commission_rate_bps default 2000) on successfully collected
-- subscription charges only (billing_payments.kind = 'charge' and status captured/refunded); trial / authorization-only
-- payments never accrue; refunds and chargebacks are adjustments; payouts are recorded manually by an administrator.
--
-- Trust model. Referral state is written ONLY by the server (service_role, server-side env only) through the functions
-- below. Signed-in users get read-only access to their OWN partner row, ledger entries, payouts and visit counters
-- (column-limited, RLS-scoped). Referred customers have no access at all to attribution or partner financial data. No role
-- claim from the client or from user_metadata is ever consulted: administrators are rows in app_admins, seeded manually by SQL.
-- Every admin function takes the acting user id (which the server must take from the verified JWT) and independently
-- re-checks it against app_admins inside the function, so a server bug or a leaked service key cannot act "as nobody".
--
-- Money: numeric(14,2) rupees with an explicit currency column (INR). Existing billing amounts are integer paise and are
-- converted exactly (paise / 100). Commission is floored to whole paise.
--
-- Idempotent: safe to run more than once. Reversible: see the rollback block at the end of this file.

-- ---------------------------------------------------------------------------------------------------------------------
-- app_admins: who may manage partners and commissions. No client privilege and no policy. Seed manually, e.g.
--   insert into public.app_admins (user_id) values ('<auth user uuid>');
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid
);
comment on table public.app_admins is 'Authorised administrators. Never writable from the API; seeded manually by SQL.';

create or replace function public.is_app_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (select 1 from public.app_admins a where a.user_id = p_user_id);
$$;

create or replace function public.referral_require_admin(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin(p_actor) then
    raise exception 'administrator privileges required' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_partners
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_partners (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        unique references auth.users (id) on delete set null,
  code                text        not null,
  display_name        text        not null,
  commission_rate_bps integer     not null default 2000,
  status              text        not null default 'active',
  email_hash          text,
  payout_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  constraint referral_partners_code_format check (code ~ '^[A-Z0-9]{4,20}$'),
  constraint referral_partners_display_name check (char_length(btrim(display_name)) between 1 and 80),
  constraint referral_partners_rate check (commission_rate_bps between 0 and 10000),
  constraint referral_partners_status check (status in ('active', 'suspended', 'terminated')),
  constraint referral_partners_email_hash_length check (email_hash is null or char_length(email_hash) between 16 and 128),
  constraint referral_partners_payout_note_length check (payout_note is null or char_length(payout_note) <= 500)
);
comment on table public.referral_partners is
  'Referral partners. Rate changes affect future accruals only. No bank/UPI details are stored here.';
create unique index if not exists referral_partners_code_key on public.referral_partners (code);

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_attributions: permanent, first-touch customer attribution. referred_user_id is nulled (not cascaded) when the
-- customer deletes their account so commission history keeps its partner/attribution snapshot.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_attributions (
  id                  uuid        primary key default gen_random_uuid(),
  referred_user_id    uuid        unique references auth.users (id) on delete set null,
  partner_id          uuid        not null references public.referral_partners (id) on delete restrict,
  code_used           text        not null,
  referred_email_hash text,
  attributed_at       timestamptz not null default now(),
  source              text        not null default 'signup',
  status              text        not null default 'active',
  risk_flags          text[]      not null default '{}',
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  constraint referral_attributions_status check (status in ('active', 'void')),
  constraint referral_attributions_source check (source in ('signup', 'checkout', 'admin')),
  constraint referral_attributions_email_hash_length check (referred_email_hash is null or char_length(referred_email_hash) between 16 and 128),
  constraint referral_attributions_flags_size check (cardinality(risk_flags) <= 16),
  constraint referral_attributions_review_pair check ((reviewed_by is null) = (reviewed_at is null))
);
comment on table public.referral_attributions is
  'One partner per customer, first touch, immutable identity columns. Only status/risk flags/review fields change, via admin functions.';
create index if not exists referral_attributions_partner_idx on public.referral_attributions (partner_id, attributed_at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_payouts: manual payouts (append-only). Voiding is a compensating ledger entry, never an update.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_payouts (
  id                 uuid          primary key default gen_random_uuid(),
  partner_id         uuid          not null references public.referral_partners (id) on delete restrict,
  amount             numeric(14,2) not null,
  currency           text          not null default 'INR',
  method             text          not null,
  external_reference text          not null,
  paid_at            timestamptz   not null,
  recorded_by        uuid          not null,
  created_at         timestamptz   not null default now(),
  constraint referral_payouts_amount check (amount > 0),
  constraint referral_payouts_currency check (currency = 'INR'),
  constraint referral_payouts_method check (method in ('upi', 'bank_transfer', 'other')),
  constraint referral_payouts_reference_length check (char_length(btrim(external_reference)) between 1 and 120)
);
comment on table public.referral_payouts is 'Manual payouts recorded by an administrator. Append-only.';
create index if not exists referral_payouts_partner_idx on public.referral_payouts (partner_id, paid_at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_ledger_entries: append-only commission history. Signed amounts; the net per payment is the sum of its entries.
-- partner_id/attribution_id are snapshotted at accrual time so refunds that arrive after account deletion still resolve.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_ledger_entries (
  id             uuid          primary key default gen_random_uuid(),
  partner_id     uuid          not null references public.referral_partners (id) on delete restrict,
  attribution_id uuid          references public.referral_attributions (id) on delete restrict,
  payment_id     uuid          references public.billing_payments (id) on delete restrict,
  payout_id      uuid          references public.referral_payouts (id) on delete restrict,
  entry_type     text          not null,
  amount         numeric(14,2) not null,
  currency       text          not null default 'INR',
  basis_amount   numeric(14,2),
  rate_bps       integer,
  refund_level   numeric(14,2),
  dedupe_key     text          not null,
  reason         text,
  payable_after  timestamptz,
  created_at     timestamptz   not null default now(),
  created_by     uuid,
  constraint referral_ledger_currency check (currency = 'INR'),
  constraint referral_ledger_type check (entry_type in
    ('accrual', 'refund_reversal', 'refund_reinstatement', 'chargeback_reversal', 'payout', 'payout_void', 'manual_adjustment')),
  constraint referral_ledger_sign check (
       (entry_type = 'accrual' and amount > 0)
    or (entry_type in ('refund_reversal', 'chargeback_reversal', 'payout') and amount < 0)
    or (entry_type in ('refund_reinstatement', 'payout_void') and amount > 0)
    or (entry_type = 'manual_adjustment' and amount <> 0)),
  constraint referral_ledger_links check (
       (entry_type in ('accrual', 'refund_reversal', 'refund_reinstatement', 'chargeback_reversal')
          and payment_id is not null and attribution_id is not null and payout_id is null)
    or (entry_type in ('payout', 'payout_void') and payout_id is not null and payment_id is null)
    or (entry_type = 'manual_adjustment' and payment_id is null and payout_id is null)),
  constraint referral_ledger_accrual_fields check (
    entry_type <> 'accrual' or (basis_amount > 0 and rate_bps is not null and payable_after is not null)),
  constraint referral_ledger_manual_reason check (
    entry_type <> 'manual_adjustment' or (reason is not null and char_length(btrim(reason)) >= 5)),
  constraint referral_ledger_dedupe_length check (char_length(dedupe_key) between 1 and 200),
  constraint referral_ledger_reason_length check (reason is null or char_length(reason) <= 500)
);
comment on table public.referral_ledger_entries is
  'Append-only commission ledger. Corrections are new entries. UPDATE/DELETE/TRUNCATE are rejected by trigger, even for the owner.';
-- Payment commission uniqueness: exactly one accrual per payment, one payout/void entry per payout, one entry per dedupe key.
create unique index if not exists referral_ledger_dedupe_key on public.referral_ledger_entries (dedupe_key);
create unique index if not exists referral_ledger_one_accrual_per_payment
  on public.referral_ledger_entries (payment_id) where entry_type = 'accrual';
create unique index if not exists referral_ledger_one_payout_entry
  on public.referral_ledger_entries (payout_id) where entry_type = 'payout';
create unique index if not exists referral_ledger_one_void_per_payout
  on public.referral_ledger_entries (payout_id) where entry_type = 'payout_void';
create index if not exists referral_ledger_partner_created_idx on public.referral_ledger_entries (partner_id, created_at desc);
create index if not exists referral_ledger_payment_idx on public.referral_ledger_entries (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_admin_audit: append-only record of every admin action. Written inside the admin functions themselves.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_admin_audit (
  id          uuid        primary key default gen_random_uuid(),
  actor_id    uuid        not null,
  action      text        not null,
  target_type text        not null,
  target_id   text,
  before_data jsonb,
  after_data  jsonb,
  request_id  text,
  created_at  timestamptz not null default now(),
  constraint referral_admin_audit_action_length check (char_length(action) between 1 and 64),
  constraint referral_admin_audit_request_length check (request_id is null or char_length(request_id) <= 128)
);
comment on table public.referral_admin_audit is 'Append-only admin audit trail. No client access.';
create index if not exists referral_admin_audit_created_idx on public.referral_admin_audit (created_at desc);
create index if not exists referral_admin_audit_target_idx on public.referral_admin_audit (target_type, target_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_visit_counters: aggregate landing-page visits per partner per UTC day. Never affects money; holds no visitor data.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.referral_visit_counters (
  partner_id uuid   not null references public.referral_partners (id) on delete restrict,
  day        date   not null,
  visits     bigint not null default 0,
  primary key (partner_id, day),
  constraint referral_visit_counters_visits check (visits >= 0)
);
comment on table public.referral_visit_counters is 'Anonymous per-day visit counts for a partner code. Informational only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- Immutability guards.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.referral_forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists referral_ledger_no_update on public.referral_ledger_entries;
create trigger referral_ledger_no_update before update or delete on public.referral_ledger_entries
  for each row execute function public.referral_forbid_mutation();
drop trigger if exists referral_ledger_no_truncate on public.referral_ledger_entries;
create trigger referral_ledger_no_truncate before truncate on public.referral_ledger_entries
  for each statement execute function public.referral_forbid_mutation();

drop trigger if exists referral_payouts_no_update on public.referral_payouts;
create trigger referral_payouts_no_update before update or delete on public.referral_payouts
  for each row execute function public.referral_forbid_mutation();
drop trigger if exists referral_payouts_no_truncate on public.referral_payouts;
create trigger referral_payouts_no_truncate before truncate on public.referral_payouts
  for each statement execute function public.referral_forbid_mutation();

drop trigger if exists referral_admin_audit_no_update on public.referral_admin_audit;
create trigger referral_admin_audit_no_update before update or delete on public.referral_admin_audit
  for each row execute function public.referral_forbid_mutation();
drop trigger if exists referral_admin_audit_no_truncate on public.referral_admin_audit;
create trigger referral_admin_audit_no_truncate before truncate on public.referral_admin_audit
  for each statement execute function public.referral_forbid_mutation();

-- Attributions: identity is immutable. The only permitted identity change is the FK's ON DELETE SET NULL of referred_user_id.
create or replace function public.referral_attribution_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on referral_attributions is not allowed: void the attribution instead' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.partner_id is distinct from old.partner_id
     or new.code_used is distinct from old.code_used
     or new.referred_email_hash is distinct from old.referred_email_hash
     or new.attributed_at is distinct from old.attributed_at
     or new.source is distinct from old.source
     or (new.referred_user_id is distinct from old.referred_user_id and new.referred_user_id is not null) then
    raise exception 'referral attribution identity columns are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists referral_attributions_guard on public.referral_attributions;
create trigger referral_attributions_guard before update or delete on public.referral_attributions
  for each row execute function public.referral_attribution_guard();
drop trigger if exists referral_attributions_no_truncate on public.referral_attributions;
create trigger referral_attributions_no_truncate before truncate on public.referral_attributions
  for each statement execute function public.referral_forbid_mutation();

-- Partners: never deleted (terminate instead); id/code/creation fields immutable; terminated is final.
create or replace function public.referral_partner_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on referral_partners is not allowed: terminate the partner instead' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.code is distinct from old.code
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'referral partner id, code and creation fields are immutable' using errcode = '55000';
  end if;
  if old.status = 'terminated' and new.status <> 'terminated' then
    raise exception 'a terminated partner cannot be reactivated' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists referral_partners_guard on public.referral_partners;
create trigger referral_partners_guard before update or delete on public.referral_partners
  for each row execute function public.referral_partner_guard();
drop trigger if exists referral_partners_no_truncate on public.referral_partners;
create trigger referral_partners_no_truncate before truncate on public.referral_partners
  for each statement execute function public.referral_forbid_mutation();

drop trigger if exists referral_partners_set_updated_at on public.referral_partners;
create trigger referral_partners_set_updated_at before update on public.referral_partners
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges and RLS. Everything is revoked first (Supabase's REST layer reaches any public table that has grants).
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.app_admins              enable row level security;
alter table public.referral_partners       enable row level security;
alter table public.referral_attributions   enable row level security;
alter table public.referral_ledger_entries enable row level security;
alter table public.referral_payouts        enable row level security;
alter table public.referral_admin_audit    enable row level security;
alter table public.referral_visit_counters enable row level security;

revoke all on public.app_admins, public.referral_partners, public.referral_attributions, public.referral_ledger_entries,
              public.referral_payouts, public.referral_admin_audit, public.referral_visit_counters
  from public, anon, authenticated;

-- Partners read ONLY their own rows and ONLY display columns. No email hash, payout note, payment id, attribution id,
-- external payout reference, reason text or audit data. Customers (non-partners) match no policy and see nothing.
grant select (id, user_id, code, display_name, commission_rate_bps, status, created_at)
  on public.referral_partners to authenticated;
grant select (id, partner_id, entry_type, amount, currency, payable_after, created_at)
  on public.referral_ledger_entries to authenticated;
grant select (id, partner_id, amount, currency, method, paid_at, created_at)
  on public.referral_payouts to authenticated;
grant select (partner_id, day, visits)
  on public.referral_visit_counters to authenticated;

drop policy if exists "referral_partners_select_own" on public.referral_partners;
create policy "referral_partners_select_own"
  on public.referral_partners for select to authenticated
  using (user_id is not null and (select auth.uid()) = user_id);

drop policy if exists "referral_ledger_select_own" on public.referral_ledger_entries;
create policy "referral_ledger_select_own"
  on public.referral_ledger_entries for select to authenticated
  using (partner_id in (select p.id from public.referral_partners p where p.user_id = (select auth.uid())));

drop policy if exists "referral_payouts_select_own" on public.referral_payouts;
create policy "referral_payouts_select_own"
  on public.referral_payouts for select to authenticated
  using (partner_id in (select p.id from public.referral_partners p where p.user_id = (select auth.uid())));

drop policy if exists "referral_visits_select_own" on public.referral_visit_counters;
create policy "referral_visits_select_own"
  on public.referral_visit_counters for select to authenticated
  using (partner_id in (select p.id from public.referral_partners p where p.user_id = (select auth.uid())));

-- No INSERT/UPDATE/DELETE privilege or policy for clients anywhere. The server reads with service_role; ALL writes go through
-- the SECURITY DEFINER functions below. Financial history tables are select-only for service_role (no direct insert either,
-- so the checks inside the functions cannot be bypassed by a direct table write).
grant select on public.app_admins to service_role;
grant select on public.referral_partners, public.referral_attributions, public.referral_ledger_entries,
                public.referral_payouts, public.referral_admin_audit, public.referral_visit_counters to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Internal helper: audit writer (callable only from other definer functions).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.referral_write_audit(
  p_actor uuid, p_action text, p_target_type text, p_target_id text, p_before jsonb, p_after jsonb, p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.referral_admin_audit (actor_id, action, target_type, target_id, before_data, after_data, request_id)
  values (p_actor, p_action, p_target_type, p_target_id, p_before, p_after, p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Admin functions. Each re-validates p_actor against app_admins and writes its audit row in the same transaction.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.referral_admin_create_partner(
  p_actor uuid, p_user_id uuid, p_code text, p_display_name text, p_email_hash text,
  p_commission_rate_bps integer default 2000, p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  perform public.referral_require_admin(p_actor);
  insert into public.referral_partners (user_id, code, display_name, email_hash, commission_rate_bps, created_by)
  values (p_user_id, v_code, p_display_name, p_email_hash, coalesce(p_commission_rate_bps, 2000), p_actor)
  returning id into v_id;
  perform public.referral_write_audit(p_actor, 'partner.create', 'referral_partner', v_id::text, null,
    jsonb_build_object('code', v_code, 'user_id', p_user_id, 'commission_rate_bps', coalesce(p_commission_rate_bps, 2000)), p_request_id);
  return v_id;
end;
$$;

create or replace function public.referral_admin_set_partner_status(
  p_actor uuid, p_partner_id uuid, p_status text, p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform public.referral_require_admin(p_actor);
  if p_status is null or p_status not in ('active', 'suspended', 'terminated') then
    raise exception 'invalid partner status' using errcode = '22023';
  end if;
  select status into v_old from public.referral_partners where id = p_partner_id for update;
  if not found then
    raise exception 'partner not found' using errcode = 'P0002';
  end if;
  update public.referral_partners set status = p_status where id = p_partner_id;
  perform public.referral_write_audit(p_actor, 'partner.status', 'referral_partner', p_partner_id::text,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_request_id);
end;
$$;

-- Rate changes affect FUTURE accruals only: every accrual snapshots its own rate on the ledger entry.
create or replace function public.referral_admin_set_partner_rate(
  p_actor uuid, p_partner_id uuid, p_rate_bps integer, p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old integer;
begin
  perform public.referral_require_admin(p_actor);
  if p_rate_bps is null or p_rate_bps not between 0 and 10000 then
    raise exception 'invalid commission rate' using errcode = '22023';
  end if;
  select commission_rate_bps into v_old from public.referral_partners where id = p_partner_id for update;
  if not found then
    raise exception 'partner not found' using errcode = 'P0002';
  end if;
  update public.referral_partners set commission_rate_bps = p_rate_bps where id = p_partner_id;
  perform public.referral_write_audit(p_actor, 'partner.rate', 'referral_partner', p_partner_id::text,
    jsonb_build_object('commission_rate_bps', v_old), jsonb_build_object('commission_rate_bps', p_rate_bps), p_request_id);
end;
$$;

-- Review of an attribution: void it, or confirm it (optionally replacing risk flags). Setting reviewed_at releases a payout hold.
create or replace function public.referral_admin_review_attribution(
  p_actor uuid, p_attribution_id uuid, p_status text, p_risk_flags text[] default null, p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.referral_attributions%rowtype;
begin
  perform public.referral_require_admin(p_actor);
  if p_status is null or p_status not in ('active', 'void') then
    raise exception 'invalid attribution status' using errcode = '22023';
  end if;
  select * into v_old from public.referral_attributions where id = p_attribution_id for update;
  if not found then
    raise exception 'attribution not found' using errcode = 'P0002';
  end if;
  update public.referral_attributions
     set status = p_status,
         risk_flags = coalesce(p_risk_flags, risk_flags),
         reviewed_by = p_actor,
         reviewed_at = now()
   where id = p_attribution_id;
  perform public.referral_write_audit(p_actor, 'attribution.review', 'referral_attribution', p_attribution_id::text,
    jsonb_build_object('status', v_old.status, 'risk_flags', v_old.risk_flags),
    jsonb_build_object('status', p_status, 'risk_flags', coalesce(p_risk_flags, v_old.risk_flags)), p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- referral_partner_balance: total ledger sum, the payable part and the pending part. Payable excludes (a) commission on
-- payments still inside the hold period, and (b) commission on attributions that are void or flagged and not yet reviewed.
-- Reversals follow their payment, so a reversal of a still-held accrual does not reduce the payable balance early.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.referral_partner_balance(p_partner_id uuid)
returns table (currency text, total numeric, payable numeric, pending numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select e.amount,
           (e.payment_id is null
            or (acc.payable_after <= now()
                and a.status = 'active'
                and (cardinality(a.risk_flags) = 0 or a.reviewed_at is not null))) as counted
      from public.referral_ledger_entries e
      left join public.referral_ledger_entries acc on acc.payment_id = e.payment_id and acc.entry_type = 'accrual'
      left join public.referral_attributions a on a.id = e.attribution_id
     where e.partner_id = p_partner_id
  )
  select 'INR'::text,
         coalesce(sum(amount), 0)::numeric,
         coalesce(sum(amount) filter (where counted), 0)::numeric,
         coalesce(sum(amount) filter (where not counted), 0)::numeric
    from rows;
$$;

-- referral_admin_record_payout: records a manual payout and its negative ledger entry atomically. Cannot exceed the payable balance.
create or replace function public.referral_admin_record_payout(
  p_actor uuid, p_partner_id uuid, p_amount numeric, p_method text, p_external_reference text, p_paid_at timestamptz,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner public.referral_partners%rowtype;
  v_payable numeric;
  v_id uuid;
begin
  perform public.referral_require_admin(p_actor);
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'payout amount must be positive with at most 2 decimals' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral:partner:' || p_partner_id::text, 0));
  select * into v_partner from public.referral_partners where id = p_partner_id;
  if not found then
    raise exception 'partner not found' using errcode = 'P0002';
  end if;
  if v_partner.status = 'terminated' then
    raise exception 'cannot pay a terminated partner' using errcode = '55000';
  end if;
  select b.payable into v_payable from public.referral_partner_balance(p_partner_id) b;
  if p_amount > v_payable then
    raise exception 'payout exceeds payable balance' using errcode = '23514';
  end if;
  insert into public.referral_payouts (partner_id, amount, method, external_reference, paid_at, recorded_by)
  values (p_partner_id, p_amount, p_method, p_external_reference, coalesce(p_paid_at, now()), p_actor)
  returning id into v_id;
  insert into public.referral_ledger_entries (partner_id, payout_id, entry_type, amount, dedupe_key, reason, created_by)
  values (p_partner_id, v_id, 'payout', -p_amount, 'payout:' || v_id::text, 'manual payout', p_actor);
  perform public.referral_write_audit(p_actor, 'payout.record', 'referral_payout', v_id::text, null,
    jsonb_build_object('partner_id', p_partner_id, 'amount', p_amount, 'method', p_method), p_request_id);
  return v_id;
end;
$$;

-- referral_admin_void_payout: compensating entry for a payout recorded in error. The payout row itself is never changed.
create or replace function public.referral_admin_void_payout(
  p_actor uuid, p_payout_id uuid, p_reason text, p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.referral_payouts%rowtype;
begin
  perform public.referral_require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_payout from public.referral_payouts where id = p_payout_id;
  if not found then
    raise exception 'payout not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral:partner:' || v_payout.partner_id::text, 0));
  insert into public.referral_ledger_entries (partner_id, payout_id, entry_type, amount, dedupe_key, reason, created_by)
  values (v_payout.partner_id, v_payout.id, 'payout_void', v_payout.amount, 'payout_void:' || v_payout.id::text, p_reason, p_actor);
  perform public.referral_write_audit(p_actor, 'payout.void', 'referral_payout', p_payout_id::text, null,
    jsonb_build_object('amount', v_payout.amount, 'reason', p_reason), p_request_id);
end;
$$;

-- referral_admin_add_adjustment: signed manual correction. A negative adjustment may push the balance below zero (clawback).
create or replace function public.referral_admin_add_adjustment(
  p_actor uuid, p_partner_id uuid, p_amount numeric, p_reason text, p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.referral_require_admin(p_actor);
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) or abs(p_amount) > 10000000 then
    raise exception 'invalid adjustment amount' using errcode = '22023';
  end if;
  if not exists (select 1 from public.referral_partners where id = p_partner_id) then
    raise exception 'partner not found' using errcode = 'P0002';
  end if;
  insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key, reason, created_by)
  values (p_partner_id, 'manual_adjustment', p_amount, 'manual:' || gen_random_uuid()::text, p_reason, p_actor)
  returning id into v_id;
  perform public.referral_write_audit(p_actor, 'adjustment.add', 'referral_ledger_entry', v_id::text, null,
    jsonb_build_object('partner_id', p_partner_id, 'amount', p_amount, 'reason', p_reason), p_request_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- System functions (server-side, called with a user id the server verified from the JWT, never from a request body).
-- ---------------------------------------------------------------------------------------------------------------------

-- referral_attribute_user: first-touch, immutable attribution. Outcomes: attributed, existing, rejected_unknown_code,
-- rejected_inactive_partner, rejected_self_referral, rejected_has_billing. Never overwrites an existing attribution.
create or replace function public.referral_attribute_user(
  p_user_id uuid, p_code text, p_email_hash text, p_source text default 'signup', p_risk_flags text[] default '{}'
)
returns table (outcome text, attribution_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_partner public.referral_partners%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  if p_user_id is null or p_email_hash is null or char_length(p_email_hash) < 16 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral:attr:' || p_user_id::text, 0));

  select a.id into v_existing from public.referral_attributions a where a.referred_user_id = p_user_id;
  if found then
    return query select 'existing'::text, v_existing;
    return;
  end if;

  select * into v_partner from public.referral_partners p where p.code = v_code;
  if not found then
    return query select 'rejected_unknown_code'::text, null::uuid;
    return;
  end if;
  if v_partner.status <> 'active' then
    return query select 'rejected_inactive_partner'::text, null::uuid;
    return;
  end if;
  if v_partner.user_id = p_user_id or v_partner.email_hash = p_email_hash then
    return query select 'rejected_self_referral'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.billing_subscriptions b where b.user_id = p_user_id)
     or exists (select 1 from public.billing_payments bp where bp.user_id = p_user_id) then
    return query select 'rejected_has_billing'::text, null::uuid;
    return;
  end if;

  insert into public.referral_attributions (referred_user_id, partner_id, code_used, referred_email_hash, source, risk_flags)
  values (p_user_id, v_partner.id, v_code, p_email_hash, coalesce(p_source, 'signup'), coalesce(p_risk_flags, '{}'))
  returning id into v_id;
  return query select 'attributed'::text, v_id;
end;
$$;

-- referral_sync_commission: idempotent. Accrues once per eligible payment, then brings the payment's ledger net to
-- floor((amount - amount_refunded) * rate / 10000) with a refund_reversal / refund_reinstatement for the difference. The
-- cumulative-target method is order-independent and needs no refund ids. After a chargeback reversal the target stays zero.
-- Outcomes: payment_not_found, not_eligible, no_user, no_attribution, partner_inactive, zero_commission, accrued, adjusted, unchanged.
create or replace function public.referral_sync_commission(p_payment_id uuid, p_hold_days integer default 14)
returns table (outcome text, delta numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.billing_payments%rowtype;
  v_acc public.referral_ledger_entries%rowtype;
  v_att public.referral_attributions%rowtype;
  v_partner public.referral_partners%rowtype;
  v_user uuid;
  v_accrued boolean := false;
  v_target numeric;
  v_current numeric;
  v_delta numeric;
  v_n integer;
  v_commission numeric;
begin
  if p_payment_id is null or coalesce(p_hold_days, 0) < 0 or p_hold_days > 90 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral:pay:' || p_payment_id::text, 0));

  select * into p from public.billing_payments where id = p_payment_id;
  if not found then
    return query select 'payment_not_found'::text, 0::numeric;
    return;
  end if;
  if p.kind <> 'charge' or p.status not in ('captured', 'refunded') or p.amount_paise <= 0 or p.currency <> 'INR' then
    return query select 'not_eligible'::text, 0::numeric;
    return;
  end if;

  select * into v_acc from public.referral_ledger_entries e where e.payment_id = p.id and e.entry_type = 'accrual';
  if not found then
    v_user := coalesce(p.user_id, (select s.user_id from public.billing_subscriptions s where s.id = p.subscription_id));
    if v_user is null then
      return query select 'no_user'::text, 0::numeric;
      return;
    end if;
    select * into v_att from public.referral_attributions a where a.referred_user_id = v_user and a.status = 'active';
    if not found then
      return query select 'no_attribution'::text, 0::numeric;
      return;
    end if;
    select * into v_partner from public.referral_partners r where r.id = v_att.partner_id;
    if v_partner.status <> 'active' then
      return query select 'partner_inactive'::text, 0::numeric;
      return;
    end if;
    v_commission := floor(p.amount_paise::numeric * v_partner.commission_rate_bps / 10000) / 100;
    if v_commission <= 0 then
      return query select 'zero_commission'::text, 0::numeric;
      return;
    end if;
    insert into public.referral_ledger_entries
      (partner_id, attribution_id, payment_id, entry_type, amount, basis_amount, rate_bps, dedupe_key, payable_after)
    values
      (v_partner.id, v_att.id, p.id, 'accrual', v_commission, p.amount_paise::numeric / 100, v_partner.commission_rate_bps,
       'acc:' || p.id::text, now() + make_interval(days => p_hold_days))
    returning * into v_acc;
    v_accrued := true;
  end if;

  if exists (select 1 from public.referral_ledger_entries e where e.payment_id = p.id and e.entry_type = 'chargeback_reversal') then
    v_target := 0;
  else
    v_target := floor((p.amount_paise - p.amount_refunded_paise)::numeric * v_acc.rate_bps / 10000) / 100;
  end if;
  select coalesce(sum(e.amount), 0) into v_current from public.referral_ledger_entries e
   where e.payment_id = p.id and e.entry_type in ('accrual', 'refund_reversal', 'refund_reinstatement', 'chargeback_reversal');
  v_delta := v_target - v_current;

  if v_delta = 0 then
    return query select (case when v_accrued then 'accrued' else 'unchanged' end)::text, 0::numeric;
    return;
  end if;

  select count(*) into v_n from public.referral_ledger_entries e
   where e.payment_id = p.id and e.entry_type in ('refund_reversal', 'refund_reinstatement');
  insert into public.referral_ledger_entries
    (partner_id, attribution_id, payment_id, entry_type, amount, rate_bps, refund_level, dedupe_key, reason)
  values
    (v_acc.partner_id, v_acc.attribution_id, p.id,
     case when v_delta < 0 then 'refund_reversal' else 'refund_reinstatement' end,
     v_delta, v_acc.rate_bps, p.amount_refunded_paise::numeric / 100,
     'adj:' || p.id::text || ':' || (v_n + 1)::text, 'refund level sync');
  return query select 'adjusted'::text, v_delta;
end;
$$;

-- referral_apply_chargeback: called when a dispute is LOST. Reverses the remaining net commission for the payment once per
-- dispute id. The hold-while-open policy (decision D2) is deliberately not implemented in this stage.
create or replace function public.referral_apply_chargeback(p_payment_id uuid, p_dispute_id text)
returns table (outcome text, delta numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.referral_ledger_entries%rowtype;
  v_current numeric;
begin
  if p_payment_id is null or p_dispute_id is null or char_length(p_dispute_id) not between 1 and 64 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral:pay:' || p_payment_id::text, 0));
  if exists (select 1 from public.referral_ledger_entries e where e.dedupe_key = 'cb:' || p_dispute_id) then
    return query select 'duplicate'::text, 0::numeric;
    return;
  end if;
  select * into v_acc from public.referral_ledger_entries e where e.payment_id = p_payment_id and e.entry_type = 'accrual';
  if not found then
    return query select 'no_commission'::text, 0::numeric;
    return;
  end if;
  select coalesce(sum(e.amount), 0) into v_current from public.referral_ledger_entries e
   where e.payment_id = p_payment_id and e.entry_type in ('accrual', 'refund_reversal', 'refund_reinstatement', 'chargeback_reversal');
  if v_current <= 0 then
    return query select 'nothing_to_reverse'::text, 0::numeric;
    return;
  end if;
  insert into public.referral_ledger_entries (partner_id, attribution_id, payment_id, entry_type, amount, dedupe_key, reason)
  values (v_acc.partner_id, v_acc.attribution_id, p_payment_id, 'chargeback_reversal', -v_current, 'cb:' || p_dispute_id, 'dispute lost');
  return query select 'reversed'::text, -v_current;
end;
$$;

-- referral_record_visit: bumps the anonymous daily counter for an ACTIVE partner code. Returns false for unknown/inactive codes.
create or replace function public.referral_record_visit(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.referral_partners where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then
    return false;
  end if;
  insert into public.referral_visit_counters (partner_id, day, visits)
  values (v_id, (now() at time zone 'utc')::date, 1)
  on conflict (partner_id, day) do update set visits = public.referral_visit_counters.visits + 1;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Function privileges: service_role only. Never reachable by anon or authenticated callers.
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public.is_app_admin(uuid) from public, anon, authenticated;
revoke all on function public.referral_require_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.referral_write_audit(uuid, text, text, text, jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.referral_admin_create_partner(uuid, uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.referral_admin_set_partner_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.referral_admin_set_partner_rate(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.referral_admin_review_attribution(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.referral_partner_balance(uuid) from public, anon, authenticated;
revoke all on function public.referral_admin_record_payout(uuid, uuid, numeric, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.referral_admin_void_payout(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.referral_admin_add_adjustment(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.referral_attribute_user(uuid, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.referral_sync_commission(uuid, integer) from public, anon, authenticated;
revoke all on function public.referral_apply_chargeback(uuid, text) from public, anon, authenticated;
revoke all on function public.referral_record_visit(text) from public, anon, authenticated;

grant execute on function public.is_app_admin(uuid) to service_role;
grant execute on function public.referral_admin_create_partner(uuid, uuid, text, text, text, integer, text) to service_role;
grant execute on function public.referral_admin_set_partner_status(uuid, uuid, text, text) to service_role;
grant execute on function public.referral_admin_set_partner_rate(uuid, uuid, integer, text) to service_role;
grant execute on function public.referral_admin_review_attribution(uuid, uuid, text, text[], text) to service_role;
grant execute on function public.referral_partner_balance(uuid) to service_role;
grant execute on function public.referral_admin_record_payout(uuid, uuid, numeric, text, text, timestamptz, text) to service_role;
grant execute on function public.referral_admin_void_payout(uuid, uuid, text, text) to service_role;
grant execute on function public.referral_admin_add_adjustment(uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.referral_attribute_user(uuid, text, text, text, text[]) to service_role;
grant execute on function public.referral_sync_commission(uuid, integer) to service_role;
grant execute on function public.referral_apply_chargeback(uuid, text) to service_role;
grant execute on function public.referral_record_visit(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- ROLLBACK (not part of the migration; run manually to undo, only before real referral data exists):
--   drop function if exists public.referral_record_visit(text);
--   drop function if exists public.referral_apply_chargeback(uuid, text);
--   drop function if exists public.referral_sync_commission(uuid, integer);
--   drop function if exists public.referral_attribute_user(uuid, text, text, text, text[]);
--   drop function if exists public.referral_admin_add_adjustment(uuid, uuid, numeric, text, text);
--   drop function if exists public.referral_admin_void_payout(uuid, uuid, text, text);
--   drop function if exists public.referral_admin_record_payout(uuid, uuid, numeric, text, text, timestamptz, text);
--   drop function if exists public.referral_partner_balance(uuid);
--   drop function if exists public.referral_admin_review_attribution(uuid, uuid, text, text[], text);
--   drop function if exists public.referral_admin_set_partner_rate(uuid, uuid, integer, text);
--   drop function if exists public.referral_admin_set_partner_status(uuid, uuid, text, text);
--   drop function if exists public.referral_admin_create_partner(uuid, uuid, text, text, text, integer, text);
--   drop function if exists public.referral_write_audit(uuid, text, text, text, jsonb, jsonb, text);
--   drop function if exists public.referral_require_admin(uuid);
--   drop function if exists public.is_app_admin(uuid);
--   -- append-only tables must have their guard triggers dropped before they can be truncated/dropped:
--   drop table if exists public.referral_visit_counters;
--   drop table if exists public.referral_admin_audit;
--   drop table if exists public.referral_ledger_entries;
--   drop table if exists public.referral_payouts;
--   drop table if exists public.referral_attributions;
--   drop table if exists public.referral_partners;
--   drop table if exists public.app_admins;
--   drop function if exists public.referral_partner_guard();
--   drop function if exists public.referral_attribution_guard();
--   drop function if exists public.referral_forbid_mutation();
-- ---------------------------------------------------------------------------------------------------------------------
