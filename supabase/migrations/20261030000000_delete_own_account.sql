-- Iron Log: let a signed-in user delete their OWN account.
--
-- The client cannot delete rows in auth.users (that needs the service role), so this SECURITY DEFINER function
-- does it on the caller's behalf. It can only ever delete the row whose id equals the caller's own auth.uid():
-- there is no parameter, so one user can never name another. public.profiles is removed by ON DELETE CASCADE.
-- Fitness data is not stored in the cloud (see 20261027000000_auth_profiles.sql), so there is nothing else to purge.
-- Idempotent: safe to run more than once.

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
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
