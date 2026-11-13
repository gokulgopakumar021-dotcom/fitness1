-- Iron Log: pin search_path on the three referral guard trigger functions (Stage 8 / V3). PROPOSED - NOT APPLIED.
--
-- Why: the Supabase database advisor (function_search_path_mutable) warns that these functions have a role-mutable search_path.
--   public.referral_forbid_mutation()
--   public.referral_attribution_guard()
--   public.referral_partner_guard()
--
-- Findings from reading 20261112060254_referral_core.sql:
--   * All three are ordinary INVOKER trigger functions (LANGUAGE plpgsql, no SECURITY DEFINER). Nothing here adds privilege.
--   * They reference no table, function, type or schema by name. They only use NEW/OLD fields, the trigger variables
--     tg_op / tg_table_name, RAISE, and the built-in operators IS DISTINCT FROM and <>. Operators and built-in types resolve
--     through pg_catalog, which is always searched first, so an empty search_path cannot change their behaviour.
--   * The repo convention for every other function in these migrations is `set search_path = ''`.
--
-- What this does: ALTER FUNCTION ... SET only. It does NOT redefine any function body (no CREATE OR REPLACE), and it does not touch
-- triggers, tables, RLS policies, grants or ownership. Existing triggers keep calling the same functions. Re-running is a no-op.
--
-- Version note: 20261114000000 sorts after the newest version recorded remotely (20261113043241), so the CLI will not treat it as
-- out-of-order. Do not move it into supabase/migrations/ until the V7 history reconciliation has been approved and done.
--
-- Rollback: supabase/manual/rollback_referral_trigger_search_path.sql
--
-- Not changed on purpose: public.set_updated_at(), used by referral_partners_set_updated_at, belongs to the profiles migration and
-- was not named in the advisor finding. It is out of scope for V3 and is not touched here.

alter function public.referral_forbid_mutation()    set search_path = '';
alter function public.referral_attribution_guard()  set search_path = '';
alter function public.referral_partner_guard()      set search_path = '';
