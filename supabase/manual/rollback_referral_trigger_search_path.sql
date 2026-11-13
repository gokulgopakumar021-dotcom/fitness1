-- Rollback for supabase/proposed/20261114000000_referral_trigger_search_path.sql (Stage 8 / V3). Manual, never auto-run.
-- Removes only the per-function search_path setting, returning the functions to their original (advisor-warned) state.
-- Does not touch triggers, data, RLS, grants or function bodies.

alter function public.referral_forbid_mutation()    reset search_path;
alter function public.referral_attribution_guard()  reset search_path;
alter function public.referral_partner_guard()      reset search_path;
