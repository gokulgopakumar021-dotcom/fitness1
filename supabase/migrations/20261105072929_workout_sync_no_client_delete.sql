-- Iron Log: workout sync hardening (follows 20261105071106_workout_cloud_sync.sql).
--
-- Deletes are tombstones (deleted_at, written through push_workout_record). A client that could hard-DELETE a
-- tombstone row would let a stale device resurrect the record on its next push. So authenticated clients lose
-- DELETE on the four sync tables. Rows still disappear with the account: the foreign key to auth.users is
-- ON DELETE CASCADE, which runs inside delete_own_account() and needs no client privilege.
-- Additive/restrictive only; no data is touched. Idempotent.

revoke delete on public.workout_plans, public.workout_sessions,
                 public.workout_active_sessions, public.workout_prefs from authenticated;

drop policy if exists "workout_plans_delete_own" on public.workout_plans;
drop policy if exists "workout_sessions_delete_own" on public.workout_sessions;
drop policy if exists "workout_active_sessions_delete_own" on public.workout_active_sessions;
drop policy if exists "workout_prefs_delete_own" on public.workout_prefs;
