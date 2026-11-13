-- Iron Log AI Stage 2B: ROLLBACK of 20261112060134_legal_acceptances.sql. YOU run this by hand (SQL Editor).
-- NOT a migration; never applied automatically.
--
-- Effects:
--   * Sign-up keeps working: the trigger only ever added a row, and the app's metadata field is simply ignored.
--   * DESTROYS every recorded acceptance / acknowledgement. Export first if you need them:
--       select * from public.legal_acceptances order by accepted_at;
--   * The app tolerates the table being absent: the existing-user notice then stays hidden (it treats "cannot check" as "do not show").
--   * If the migration is also listed in the Supabase migration history, mark it reverted there so a later push does not re-apply it.

drop trigger if exists on_auth_user_created_legal_acceptance on auth.users;
drop function if exists public.handle_new_user_legal_acceptance();
drop function if exists public.acknowledge_legal_update(text, text);
drop table if exists public.legal_acceptances;
