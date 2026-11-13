-- Iron Log AI, Stage 2D / Stage 2: platform-wide 18+ ELIGIBILITY (lower-data design: self-declaration, NO date of birth).
--
-- STATUS: written for review. NOT applied to any Supabase project. Additive on top of
--   20261111000000_legal_acceptances.sql and 20261112000000_legal_acceptance_enforcement.sql,
-- which it REQUIRES. All three must be released together, in order (see docs/legal/AGE_ELIGIBILITY_DESIGN.md).
-- Idempotent: safe to run more than once.
--
-- What it adds
--   * public.age_declarations: ONE row per user, holding only a positive "I am 18 or older" declaration, the Terms version
--     that was current, how it was given, and the DATABASE clock. No date of birth and no age number is stored.
--   * Layer A (primary, needs no dashboard step): a strict AFTER INSERT trigger on auth.users that RAISES unless the sign-up
--     metadata carries age_declaration.adult_18_plus = JSON true. A raise aborts the whole sign-up transaction.
--   * Layer B (clean 400 before the user is created): the Before User Created hook from the previous migration is replaced so it
--     checks BOTH legal acceptance and the age declaration. Still NOT ACTIVE until selected in the dashboard.
--   * public.declare_adult_18_plus(): lets a SIGNED-IN EXISTING user record the declaration for themselves only (no argument,
--     so nobody can declare for someone else). public.get_my_age_eligibility(): the caller's own status, used by the app and
--     by the API gate with the user's own token (no service-role key involved).
--
-- Honest limit: this is a SELF-DECLARATION, not verified identity or verified age. It is a deliberate data-minimisation
-- choice (a typed date of birth would be just as unverified and would add personal data). Stronger assurance would need owner
-- and legal approval and is only PROPOSED in docs/legal/AGE_ELIGIBILITY_DESIGN.md.
--
-- Existing accounts are NOT back-filled: no row means "age unknown", which the app and API treat as not yet eligible.
-- Rollback: supabase/manual/rollback_age_eligibility.sql (DISABLE NOTHING in the dashboard first unless it says so).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. The declaration record.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.age_declarations (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  adult_18_plus boolean not null default true,
  terms_version text not null,
  declared_at   timestamptz not null default now(),
  method        text not null,
  constraint age_declarations_positive_only check (adult_18_plus is true),
  constraint age_declarations_terms_version_format check (terms_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint age_declarations_method_allowed check (method in ('signup', 'existing_user_gate'))
);

comment on table public.age_declarations is
  'Positive self-declaration that the user is 18 or older (no date of birth, no age). Written only by SECURITY DEFINER functions with the database clock. Self-declared, NOT verified.';

alter table public.age_declarations enable row level security;
revoke all on public.age_declarations from public, anon, authenticated;
grant select on public.age_declarations to authenticated;

drop policy if exists "age_declarations_select_own" on public.age_declarations;
create policy "age_declarations_select_own"
  on public.age_declarations for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- No INSERT / UPDATE / DELETE policy and no privilege: clients cannot write or alter records directly.

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Shared check on sign-up metadata. NULL = acceptable, otherwise a safe, user-readable message.
--    Only the JSON boolean true counts: the string "true", 1, an object or a missing key are all rejected.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.age_signup_violation(p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_meta) = 'object'
     and jsonb_typeof(p_meta -> 'age_declaration') = 'object'
     and (p_meta -> 'age_declaration' -> 'adult_18_plus') = 'true'::jsonb
    then null
    else 'You must confirm that you are 18 years of age or older to create an account.'
  end
$$;

revoke all on function public.age_signup_violation(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Layer A: strict trigger. No exception handler: a raise aborts the sign-up transaction on EVERY insert path.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.handle_new_user_age_declaration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg   text := public.age_signup_violation(new.raw_user_meta_data);
  v_terms text;
begin
  if v_msg is not null then
    raise exception '%', v_msg using errcode = '23514', hint = 'age_declaration_required';
  end if;

  -- The recorded version comes from the server-controlled allowlist, never from the client.
  select version into v_terms from public.legal_policy_versions where policy = 'terms' and is_current;
  if v_terms is null then
    raise exception 'No current policy version is published.' using errcode = '23514', hint = 'age_declaration_required';
  end if;

  insert into public.age_declarations (user_id, terms_version, method)
  values (new.id, v_terms, 'signup')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user_age_declaration() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_age_declaration on auth.users;
create trigger on_auth_user_created_age_declaration
  after insert on auth.users
  for each row execute function public.handle_new_user_age_declaration();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Layer B: the hook now checks legal acceptance first, then the age declaration. Same name, so a dashboard selection of
--    hook_before_user_created keeps working. NOT ACTIVE until selected under Authentication > Hooks (manual step).
--    Not SECURITY DEFINER (as the Supabase docs recommend); it only calls check functions supabase_auth_admin may execute.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_meta jsonb := event -> 'user' -> 'user_metadata';
  v_msg  text  := coalesce(public.legal_signup_violation(v_meta), public.age_signup_violation(v_meta));
begin
  if v_msg is not null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', v_msg));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant execute on function public.age_signup_violation(jsonb) to supabase_auth_admin;
    grant execute on function public.legal_signup_violation(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Existing users: the caller records their own declaration, and reads their own status.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.declare_adult_18_plus()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_terms text;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select version into v_terms from public.legal_policy_versions where policy = 'terms' and is_current;
  if v_terms is null then
    raise exception 'No current policy version is published.' using errcode = '22023';
  end if;
  insert into public.age_declarations (user_id, terms_version, method)
  values (uid, v_terms, 'existing_user_gate')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.declare_adult_18_plus() from public, anon;
grant execute on function public.declare_adult_18_plus() to authenticated;

-- 'declared' when the caller has a declaration row, otherwise 'unknown' (every account that pre-dates this migration).
create or replace function public.get_my_age_eligibility()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return case when exists (select 1 from public.age_declarations where user_id = uid and adult_18_plus) then 'declared' else 'unknown' end;
end;
$$;

revoke all on function public.get_my_age_eligibility() from public, anon;
grant execute on function public.get_my_age_eligibility() to authenticated;
