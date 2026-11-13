-- Iron Log AI, Stage 2D / Stage 1: SERVER-SIDE enforcement of legal acceptance at sign-up.
--
-- STATUS: written for review. NOT applied to any Supabase project. Additive on top of 20261112060134_legal_acceptances.sql,
-- which it REQUIRES (and must be released together with it, see docs/legal/LEGAL_ACCEPTANCE_ENFORCEMENT.md).
-- Idempotent: safe to run more than once.
--
-- Fixes Stage 2C findings
--   F1  an account could be created through Supabase Auth directly with no acceptance record, and the old trigger swallowed errors.
--   F2  any well-formed version string was accepted.
--
-- Two independent layers use ONE shared check (public.legal_signup_violation), so they cannot drift apart:
--   Layer A (primary, needs no dashboard step): the trigger on auth.users now RAISES when the sign-up metadata does not carry
--           the CURRENT Terms and Privacy versions. A raise aborts the whole sign-up transaction, so an auth.users row cannot
--           exist without its acceptance row, on EVERY insert path (email, OAuth, anonymous, invite, admin API, SQL).
--   Layer B (clean rejection, needs a dashboard / config step): the Before User Created hook returns a 400 with a readable
--           message before the user is created. If the hook is off or misconfigured, Layer A still holds.
--
-- Versions are checked against public.legal_policy_versions (server-controlled; clients have no access to it).
-- The timestamp stays the database clock (accepted_at default now()); the client cannot supply it.
--
-- Compatibility: every path that inserts into auth.users now needs valid `legal_acceptance` metadata, including users created
-- from the Supabase dashboard, invites and the admin API. The app itself only uses email + password sign-up.
--
-- Rollback: supabase/manual/rollback_legal_enforcement.sql (DISABLE THE HOOK IN THE DASHBOARD FIRST).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Server-controlled allowlist of the published policy versions.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.legal_policy_versions (
  policy       text        not null,
  version      text        not null,
  is_current   boolean     not null default false,
  published_at timestamptz not null default now(),
  primary key (policy, version),
  constraint legal_policy_versions_policy_allowed check (policy in ('terms', 'privacy')),
  constraint legal_policy_versions_version_format check (version ~ '^[A-Za-z0-9._-]{1,40}$')
);

-- At most one current version per policy.
create unique index if not exists legal_policy_versions_one_current
  on public.legal_policy_versions (policy) where is_current;

comment on table public.legal_policy_versions is
  'Server-controlled list of published Terms / Privacy versions. Only is_current rows are accepted at sign-up. Change ONLY through a reviewed migration, in the same release as src/legal/legalConfig.ts.';

alter table public.legal_policy_versions enable row level security;
revoke all on public.legal_policy_versions from public, anon, authenticated;
-- No policy and no grant: invisible and unwritable for every API role. Only the SECURITY DEFINER check below reads it.

-- Seed = the versions in src/legal/legalConfig.ts. A test fails if the two ever differ.
insert into public.legal_policy_versions (policy, version, is_current) values
  ('terms',   '2026-11-draft-1', true),
  ('privacy', '2026-11-draft-1', true)
on conflict (policy, version) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The shared check. Returns NULL when the metadata is acceptable, otherwise a safe, user-readable message.
--    Takes the metadata as it appears in raw_user_meta_data / the hook's user.user_metadata.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.legal_signup_violation(p_meta jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc     jsonb := case when jsonb_typeof(p_meta) = 'object' then p_meta -> 'legal_acceptance' end;
  v_terms   text;
  v_privacy text;
begin
  if jsonb_typeof(v_acc) is distinct from 'object' then
    return 'Please agree to the Terms of Service and acknowledge the Privacy Policy to create an account.';
  end if;

  -- Only real JSON strings count (a number, array or object is rejected rather than coerced).
  if jsonb_typeof(v_acc -> 'terms_version') = 'string' then
    v_terms := v_acc ->> 'terms_version';
  end if;
  if jsonb_typeof(v_acc -> 'privacy_version') = 'string' then
    v_privacy := v_acc ->> 'privacy_version';
  end if;

  if v_terms is null or v_privacy is null
     or not exists (select 1 from public.legal_policy_versions where policy = 'terms'   and version = v_terms   and is_current)
     or not exists (select 1 from public.legal_policy_versions where policy = 'privacy' and version = v_privacy and is_current) then
    return 'The Terms of Service or Privacy Policy changed. Please refresh the page and try again.';
  end if;

  return null;
end;
$$;

revoke all on function public.legal_signup_violation(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Layer A: the strict trigger function. Replaces the version that swallowed every error.
--    NO exception handler: a raise here aborts the sign-up transaction. The existing AFTER INSERT trigger
--    on_auth_user_created_legal_acceptance keeps pointing at this function name.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.handle_new_user_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg text := public.legal_signup_violation(new.raw_user_meta_data);
begin
  if v_msg is not null then
    raise exception '%', v_msg using errcode = '23514', hint = 'legal_acceptance_required';
  end if;

  insert into public.legal_acceptances (user_id, terms_version, privacy_version, method)
  values (
    new.id,
    new.raw_user_meta_data -> 'legal_acceptance' ->> 'terms_version',
    new.raw_user_meta_data -> 'legal_acceptance' ->> 'privacy_version',
    'signup'
  )
  on conflict (user_id, terms_version, privacy_version) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user_legal_acceptance() from public, anon, authenticated;

-- Re-assert the trigger so this migration is self-contained and the result does not depend on the earlier file's state.
drop trigger if exists on_auth_user_created_legal_acceptance on auth.users;
create trigger on_auth_user_created_legal_acceptance
  after insert on auth.users
  for each row execute function public.handle_new_user_legal_acceptance();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Layer B: Before User Created hook (Postgres function form).
--    Contract (Supabase docs, "Before User Created Hook"): input {metadata, user}; return '{}' to allow, or
--    {"error": {"http_code": 4xx, "message": "..."}} to reject. Postgres hooks have a short (about 2 s) time budget.
--    Not SECURITY DEFINER, as the docs recommend; it only calls the check function, which supabase_auth_admin may execute.
--    NOT ACTIVE until it is selected under Authentication > Hooks in the dashboard (manual step).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_msg text := public.legal_signup_violation(event -> 'user' -> 'user_metadata');
begin
  if v_msg is not null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', v_msg));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- supabase_auth_admin always exists on Supabase. The guard only lets this file also run on a plain Postgres (local tests).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant execute on function public.legal_signup_violation(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Existing-user acknowledgement: same allowlist (F2). Same signature, same caller-only behaviour as before.
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
  if p_terms_version is null or p_privacy_version is null
     or not exists (select 1 from public.legal_policy_versions where policy = 'terms'   and version = p_terms_version   and is_current)
     or not exists (select 1 from public.legal_policy_versions where policy = 'privacy' and version = p_privacy_version and is_current) then
    raise exception 'Invalid policy version' using errcode = '22023';
  end if;
  insert into public.legal_acceptances (user_id, terms_version, privacy_version, method)
  values (uid, p_terms_version, p_privacy_version, 'existing_user_notice')
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke all on function public.acknowledge_legal_update(text, text) from public, anon;
grant execute on function public.acknowledge_legal_update(text, text) to authenticated;
