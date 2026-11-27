-- Iron Log: pin search_path on the three referral guard trigger functions (advisor: function_search_path_mutable).
-- Applied to the hosted project on 2026-11-27 (recorded version 20261127072822). Originally proposed as
-- supabase/proposed/20261114000000_referral_trigger_search_path.sql; the analysis there still applies:
-- ALTER FUNCTION ... SET only, no body, trigger, table, RLS or grant changes; re-running is a no-op.
-- Rollback: supabase/manual/rollback_referral_trigger_search_path.sql

alter function public.referral_forbid_mutation()    set search_path = '';
alter function public.referral_attribution_guard()  set search_path = '';
alter function public.referral_partner_guard()      set search_path = '';
