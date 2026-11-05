# Cross-device sync: live schema snapshot (Stage 2)

Read from the live Supabase project on 2026-11-05 (read-only `list_tables` / `list_migrations` / catalog query).
**Stage 2 applied no migration.** The two Stage 1 migrations are already live and match the repository files:

| Version | Name | In repo |
|---|---|---|
| 20261105071106 | workout_cloud_sync | `supabase/migrations/20261105071106_workout_cloud_sync.sql` |
| 20261105072929 | workout_sync_no_client_delete | `supabase/migrations/20261105072929_workout_sync_no_client_delete.sql` |

`revoke_rls_auto_enable_execute` (20261102082840) is still present live and was not touched.

## Tables (all in `public`, RLS enabled, 3 policies each: select / insert / update own rows; no DELETE policy or grant)

Identical columns on all four. Primary key `(user_id, id)`; `user_id` references `auth.users(id)` ON DELETE CASCADE.

| Column | Type | Default / constraint |
|---|---|---|
| user_id | uuid | `auth.uid()` |
| id | text | length 1..128 (the app's own record id) |
| data | jsonb | `'{}'`, must be an object, ≤ 1 MiB |
| client_updated_at | timestamptz | `now()`; clamped to now()+1 day by the row guard |
| version | bigint | `1`; set by trigger (+1 on every change) |
| deleted_at | timestamptz null | tombstone marker |
| device_id | text null | ≤ 64 chars |
| created_at | timestamptz | `now()`; immutable |
| updated_at | timestamptz | `clock_timestamp()`; set by trigger |

| Table | Holds | Extra |
|---|---|---|
| `workout_plans` | one row per plan id | |
| `workout_sessions` | completed / abandoned history | generated columns `session_date`, `status`, `plan_id` from `data`; index `(user_id, session_date desc) where deleted_at is null` |
| `workout_active_sessions` | in-progress workout (resume on another device) | |
| `workout_prefs` | per-account settings; currently id `active_plan_id`, data `{"value": <plan id or null>}` | |

Index on each: `(user_id, updated_at, id)` (the pull cursor).

## Functions (SECURITY INVOKER, `authenticated` only)

- `pull_workout_changes(p_after_ts, p_after_kind, p_after_id, p_limit)`: keyset-paginated change feed of the caller's rows.
- `push_workout_record(p_kind, p_id, p_data, p_client_updated_at, p_base_version, p_deleted, p_device_id)`: optimistic-concurrency upsert/tombstone of one record; returns `applied` or `conflict` (with the stored row). Replaying an identical push is a no-op.

Live check at snapshot time: all four tables RLS on, 3 policies each, `authenticated` has no DELETE privilege, 0 rows.
