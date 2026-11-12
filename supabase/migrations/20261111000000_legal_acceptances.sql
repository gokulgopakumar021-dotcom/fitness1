-- Iron Log AI, Stage 2B: versioned record of Terms / Privacy acceptance (sign-up) and acknowledgement (existing users).
--
-- STATUS: written for review. NOT applied to any Supabase project. Apply to Preview/staging first, then Production only
-- with the owner's explicit approval. Idempotent: safe to run more than once.
--
-- Design
--   * One row per (user, terms version, privacy version). The unique constraint prevents duplicate records.
--   * Rows are created ONLY by the two SECURITY DEFINER functions below, never by direct client inserts, so the timestamp
--     is the database clock (`now()`), not something the browser can choose. Clients can read their own rows only.
--   * Sign-up: the browser sends the versions it showed in auth user metadata (`legal_acceptance`). A trigger on
--     auth.users copies them into this table in the same transaction as account creation, so it works while the email is
--     still unverified (no session yet). The trigger can never block account creation (any failure is swallowed).
--   * Existing users: the one-time notice calls public.acknowledge_legal_update(). method = 'existing_user_notice' marks a
--     recorded acknowledgement that they were told about an update. It is not a fresh contract by itself.
--   * Existing accounts are deliberately NOT back-filled: having no row is how the app knows to show the notice once.
--   * Deleting an account removes its rows (ON DELETE CASCADE). Whether acceptance evidence should instead be retained
--     after deletion is a LEGAL REVIEW item (see docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md).
--   * No personal data is added: the row holds the user id, two version labels, a timestamp and a method.
--
-- Rollback: supabase/manual/rollback_legal_acceptances.sql (drops the table, functions and trigger; loses the records).

create table if not exists public.legal_acceptances (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  terms_version   text not null,
  privacy_version text not null,
  accepted_at     timestamptz not null default now(),
  method          text not null,
  constraint legal_acceptances_terms_version_format check (terms_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint legal_acceptances_privacy_version_format check (privacy_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint legal_acceptances_method_allowed check (method in ('signup', 'existing_user_notice')),
  constraint legal_acceptances_one_per_version unique (user_id, terms_version, privacy_version)
);

comment on table public.legal_acceptances is
  'Which Terms and Privacy Policy versions a user accepted at sign-up or acknowledged afterwards, and when (database clock). Written only by SECURITY DEFINER functions.';

alter table public.legal_acceptances enable row level security;

-- Defence in depth: privileges are narrowed independently of the policy.
revoke all on public.legal_acceptances from public, anon, authenticated;
grant select on public.legal_acceptances to authenticated;

drop policy if exists "legal_acceptances_select_own" on public.legal_acceptances;
create policy "legal_acceptances_select_own"
  on public.legal_acceptances for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No INSERT / UPDATE / DELETE policy and no privilege: clients cannot write or alter records directly.

-- ---------------------------------------------------------------------------------------------------------------------
-- Sign-up: copy the versions the browser reported at sign-up into a row, using the database clock.
-- Never blocks or fails account creation; malformed or missing metadata simply records nothing.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.handle_new_user_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms   text := new.raw_user_meta_data -> 'legal_acceptance' ->> 'terms_version';
  v_privacy text := new.raw_user_meta_data -> 'legal_acceptance' ->> 'privacy_version';
begin
  if v_terms ~ '^[A-Za-z0-9._-]{1,40}$' and v_privacy ~ '^[A-Za-z0-9._-]{1,40}$' then
    insert into public.legal_acceptances (user_id, terms_version, privacy_version, method)
    values (new.id, v_terms, v_privacy, 'signup')
    on conflict (user_id, terms_version, privacy_version) do nothing;
  end if;
  return new;
exception when others then
  -- Recording acceptance must never prevent someone from creating an account.
  return new;
end;
$$;

revoke execute on function public.handle_new_user_legal_acceptance() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_legal_acceptance on auth.users;
create trigger on_auth_user_created_legal_acceptance
  after insert on auth.users
  for each row execute function public.handle_new_user_legal_acceptance();

-- ---------------------------------------------------------------------------------------------------------------------
-- Existing users: record that the signed-in caller acknowledged the current versions. Callable only for the caller's own
-- account (no user-id parameter). Repeating the call is harmless (no duplicate row, first timestamp is kept).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.acknowledge_legal_update(p_terms_version text, p_privacy_version text)
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
  if p_terms_version is null or p_terms_version !~ '^[A-Za-z0-9._-]{1,40}$'
     or p_privacy_version is null or p_privacy_version !~ '^[A-Za-z0-9._-]{1,40}$' then
    raise exception 'Invalid policy version' using errcode = '22023';
  end if;
  insert into public.legal_acceptances (user_id, terms_version, privacy_version, method)
  values (uid, p_terms_version, p_privacy_version, 'existing_user_notice')
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke all on function public.acknowledge_legal_update(text, text) from public, anon;
grant execute on function public.acknowledge_legal_update(text, text) to authenticated;
