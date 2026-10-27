-- Iron Log: account profile foundation.
--
-- Scope of this migration is deliberately small: one row of ACCOUNT data per auth user (display name).
-- Fitness data (workouts, nutrition, body metrics, ...) is NOT modelled here; its cloud schema needs a separate
-- migration designed after auditing the local storage model.
--
-- Profile rows are created by the trigger below and nowhere else (the client never inserts), so there is no
-- client/trigger race. Idempotent: safe to run more than once.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,  -- one profile per auth user
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 100)
);

comment on table public.profiles is 'Account-level profile (display name). Not fitness data.';

alter table public.profiles enable row level security;

-- Defence in depth: table privileges are narrowed independently of the policies below.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No INSERT or DELETE policy (and no privilege): clients cannot create or delete profiles.
-- Rows are created by the trigger and removed by ON DELETE CASCADE when the auth user is deleted.
-- anon has no privilege and no policy, so unauthenticated requests are denied.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile when an auth user is created. SECURITY DEFINER because the new user has no session yet
-- (email verification pending) and therefore cannot satisfy RLS. Minimal and conflict-safe: never overwrites.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The function is only meant to be invoked by the trigger, never through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for any auth users that pre-date the trigger. Existing rows are left untouched.
insert into public.profiles (id, full_name)
select u.id, nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 100), '')
from auth.users u
on conflict (id) do nothing;
