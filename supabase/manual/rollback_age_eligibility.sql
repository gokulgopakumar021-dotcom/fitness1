-- Iron Log AI, Stage 2D / Stage 2: ROLLBACK of 20261113043241_age_eligibility.sql. YOU run this by hand.
-- NOT a migration; never applied automatically.
--
-- WARNING: this RE-OPENS the 18+ sign-up bypass and DELETES every recorded age declaration. Sign-ups work again but are no
-- longer checked for the declaration. Set AGE_ENFORCEMENT=off on the API first, otherwise the age gate (which calls
-- get_my_age_eligibility) answers 503 for every signed-in request once the function is gone.
-- If the migration is in the Supabase migration history, mark it reverted there so a later push does not re-apply it.
-- The legal-acceptance objects from 20261113043228 are NOT touched: the hook goes back to checking legal acceptance only.

begin;

drop trigger if exists on_auth_user_created_age_declaration on auth.users;
drop function if exists public.handle_new_user_age_declaration();
drop function if exists public.declare_adult_18_plus();
drop function if exists public.get_my_age_eligibility();

-- Restore the hook exactly as in 20261113043228_legal_acceptance_enforcement.sql (legal acceptance only).
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

drop function if exists public.age_signup_violation(jsonb);
drop table if exists public.age_declarations;

commit;
