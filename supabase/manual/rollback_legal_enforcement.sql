-- Iron Log AI, Stage 2D / Stage 1: ROLLBACK of 20261113043228_legal_acceptance_enforcement.sql. YOU run this by hand.
-- NOT a migration; never applied automatically.
--
-- ORDER MATTERS:
--   1. FIRST disable the Before User Created hook (Dashboard > Authentication > Hooks). If the hook is still enabled when
--      its function is dropped, every sign-up fails with a server error.
--   2. Then run this script.
--
-- WARNING: this RE-OPENS the sign-up bypass (F1/F2). Sign-ups work again but are no longer checked on the server.
-- Rows already written to public.legal_acceptances are kept. If the migration is in the Supabase migration history,
-- mark it reverted there so a later push does not silently re-apply it.

begin;

-- Restore the previous (non-blocking) trigger function exactly as in 20261112060134_legal_acceptances.sql.
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
  return new;
end;
$$;
revoke execute on function public.handle_new_user_legal_acceptance() from public, anon, authenticated;

-- Restore the previous acknowledge function (format check only).
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

drop function if exists public.hook_before_user_created(jsonb);
drop function if exists public.legal_signup_violation(jsonb);
drop table if exists public.legal_policy_versions;

commit;
