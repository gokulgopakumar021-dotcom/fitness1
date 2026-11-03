-- PROPOSED, NOT EXECUTED. Review, then run yourself in the Supabase SQL Editor (or `supabase db query`).
-- Not a repo migration on purpose: public.rls_auto_enable() and the ensure_rls event trigger are not created by any
-- file in supabase/migrations (they come from the project, not the repo), so a migration would fail on a fresh database.
--
-- Why: the function is SECURITY DEFINER and currently executable by PUBLIC, anon and authenticated, so the Supabase
-- security advisor flags it as callable through the API. Direct calls already fail ("trigger functions can only be
-- called as triggers", verified on local PostgreSQL 16), so this is hardening and advisor hygiene, not a live exploit.
-- Effect on behaviour: none. The ensure_rls event trigger fires with the DDL, not with the caller's EXECUTE right
-- (verified locally: after the revoke, a table created by a non-owner role still got RLS enabled).

-- 1. BEFORE: record current state (read-only)
select p.oid::regprocedure as fn,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('public', p.oid, 'execute')        as public_exec,
       p.proacl
from pg_proc p
where p.oid = to_regprocedure('public.rls_auto_enable()');

-- 2. APPLY (guarded: does nothing if the function does not exist)
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 3. AFTER: expect anon_exec = false, authenticated_exec = false, public_exec = false
--    (postgres and service_role keep EXECUTE; the event trigger is unaffected)
select has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')          as anon_exec,
       has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') as authenticated_exec,
       has_function_privilege('public', 'public.rls_auto_enable()', 'execute')        as public_exec;
select evtname, evtenabled from pg_event_trigger where evtname = 'ensure_rls';   -- expect 'O' (enabled)

-- 4. OPTIONAL functional check of the trigger (creates and drops a scratch table; run in a quiet moment)
-- create table public.zz_rls_probe(id int);
-- select relrowsecurity from pg_class where oid = 'public.zz_rls_probe'::regclass;   -- expect true
-- drop table public.zz_rls_probe;

-- ROLLBACK (restores the previous Supabase default grants)
-- grant execute on function public.rls_auto_enable() to public, anon, authenticated;
