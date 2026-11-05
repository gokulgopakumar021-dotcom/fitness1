# Cross-Device Workout Sync — Implementation Report

Branch: `implementation/vercel-stage-3-core-backend`
Sync commits: `141a628` (Stage 1), `8de7a82` (Stage 2), `21c39d0` (Stage 3), `f205697` (Stage 4), Stage 5 report, this report.
Status: implemented, pushed to the branch through Stage 4, verified by targeted automated tests. **Not merged, not deployed.**
Production database: both sync migrations are already applied live (see section 14); no further migration is needed.

---

## 1. Architecture overview

- **localStorage stays the working copy.** The app still reads and writes through `db` (`src/storage/db.ts`). Nothing in the UI talks to Supabase.
- **Supabase is the cloud copy.** One row per record, keyed by `(user_id, id)`, where `id` is the app's own stable record id.
- **Record-level sync, never collection replacement.** Every local write is one record applied by id (`LocalAdapter.applyRecord`).
- **Opaque JSON payload.** A record is stored as a JSON `data` blob plus server-controlled `version`, a tombstone (`deleted_at`) and the client's `client_updated_at`. Existing data types did not need to change.
- **Optimistic concurrency.** `push_workout_record` accepts a write only if the caller's `base_version` equals the stored `version`; otherwise it returns `conflict` and the stored row, and the client merges.
- **Account isolation in two layers.** Locally, keys carry the `::u:<user id>` suffix. In the cloud, RLS scopes every row to `auth.uid()`.
- **Auth.** The signed-in user's own Supabase client (their JWT). No service-role key exists in frontend code.

### What is synced

| Kind | Cloud table | Content |
| --- | --- | --- |
| plans | `workout_plans` | saved workout plans |
| sessions | `workout_sessions` | completed/abandoned workout history |
| active_sessions | `workout_active_sessions` | in-progress workout (resume on another device) |
| prefs | `workout_prefs` | active plan id (`active_plan_id`) |

### Module map (`src/sync/`)

| File | Role |
| --- | --- |
| `syncEngine.ts` | One sync cycle: reconcile local edits, pull, merge per record, push dirty records, conflict rules |
| `syncController.ts` | Status machine for the UI, debounce, retry with backoff, online/offline and visibility handling, polling |
| `remoteAdapter.ts` | Supabase RPC calls (`pull_workout_changes`, `push_workout_record`) and error classification |
| `localAdapter.ts` | Reads/writes records in the account-scoped localStorage; starter-plan and demo-data filtering |
| `syncMeta.ts` | Per-account bookkeeping (versions, hashes, dirty/deleted flags, cursor) and conflict archive |
| `SyncProvider.tsx` | Starts/stops sync for the signed-in account; exposes state to the UI |
| `bulkDelete.ts`, `syncNotify.ts`, `syncRuntime.ts`, `deviceStorage.ts`, `hash.ts`, `types.ts` | Support modules |

Other changed areas: `src/storage/db.ts` (change notifications, merge-based restore), `backupMerge.ts`, `legacyData.ts`, `resetAll.ts`, `src/App.tsx`, `DataPanel.tsx`, `DataControls.tsx`, `Navbar.tsx`, `src/components/sync/*`, `LegacyDataClaim.tsx`.

---

## 2. Database schema

Migrations: `supabase/migrations/20261105071106_workout_cloud_sync.sql` and `20261105072929_workout_sync_no_client_delete.sql`.

Four tables in `public`, identical columns:

| Column | Type | Notes |
| --- | --- | --- |
| user_id | uuid | default `auth.uid()`, FK to `auth.users(id)` ON DELETE CASCADE |
| id | text | length 1..128 |
| data | jsonb | must be an object, at most 1 MiB |
| client_updated_at | timestamptz | clamped to now()+1 day by the row guard |
| version | bigint | starts at 1, +1 on every change (trigger) |
| deleted_at | timestamptz null | tombstone marker |
| device_id | text null | at most 64 chars |
| created_at | timestamptz | immutable |
| updated_at | timestamptz | `clock_timestamp()`, set by trigger |

- Primary key `(user_id, id)`; index `(user_id, updated_at, id)` on each table (the pull cursor).
- `workout_sessions` also has generated columns `session_date`, `status`, `plan_id` derived from `data`, and an index on `(user_id, session_date desc) where deleted_at is null`.
- **Row guard trigger** (`workout_sync_row_guard`, not callable by clients): identity is immutable, `version`/`created_at`/`updated_at` are server-controlled, and a far-future device clock is clamped.
- **Functions** (SECURITY INVOKER, `authenticated` only, revoked from `public`/`anon`):
  - `pull_workout_changes(...)`: keyset-paginated change feed of the caller's rows, ordered by `(updated_at, kind, id)`, limit capped at 1000.
  - `push_workout_record(...)`: locks the row, then inserts, updates, tombstones, treats an identical replay as `applied`, or returns `conflict`. A tombstone stores no content.

---

## 3. RLS policies

- RLS is enabled on all four tables; `anon` has no privileges.
- Per table: `select_own`, `insert_own`, `update_own`, each `(select auth.uid()) = user_id` (insert uses `with check`, update uses both).
- **No DELETE policy and no DELETE grant** for `authenticated` (hardening migration). A client that could hard-delete a tombstone would let a stale device resurrect the record. Rows still disappear with the account through the foreign-key cascade, which needs no client privilege.
- Ownership comes from the token: `push_workout_record` has no user-id argument, and a direct insert with another user's `user_id` is rejected by `with check`.
- The existing live migration `revoke_rls_auto_enable_execute` is untouched; neither sync migration references it.

---

## 4. Files changed

41 files, +4,466 / -29 lines versus `e88b06c` (the commit before Stage 1), including tests. Key groups:

- **Database:** 2 migrations; `docs/deployment/CROSS_DEVICE_SYNC_SCHEMA_SNAPSHOT.md`.
- **Sync engine:** 13 files in `src/sync/` (listed above), plus 6 test files and `testutil.ts`.
- **Storage:** `db.ts`, `backupMerge.ts`, `legacyData.ts`, `resetAll.ts`, and tests (`backupMerge`, `legacyData`, `localStorageScopeGuard`).
- **UI:** `App.tsx`, `Navbar.tsx`, `DataPanel.tsx`, `DataControls.tsx`, `LegacyDataClaim.tsx`, `SyncStatusBadge.tsx`, `SyncStatusCard.tsx`, `syncPresentation.ts`, and tests.
- **Tests:** `src/test/rls.workoutSync.test.ts` (PGlite).
- **Docs:** schema snapshot, Stage 5 test report, this report.

Not modified: the Gemini reliability code, the Vercel deployment configuration, and existing tests (none removed or weakened).

---

## 5. Synchronisation lifecycle

1. **Start.** `SyncProvider` mounts inside `AuthGate` after storage is scoped to the user. It builds an engine (user id, device storage, Supabase remote, device id) and a controller. A sign-out or account switch remounts the tree, so a controller never outlives its account.
2. **Trigger.** First sync on sign-in; then on any local workout change (`notifyLocalWorkoutChange`, debounced 1.5 s), on the browser `online` event, when the tab becomes visible, and every 5 minutes while visible.
3. **Cycle** (single-flight; concurrent calls share one cycle):
   1. Reconcile: compare local records with the last-synced hashes and mark changed/deleted records dirty.
   2. Pull: fetch the change feed from the saved cursor (500 per page, keyset-paginated, with a 5 s look-back window because rows commit slightly out of order) and merge each record by id.
   3. Reconcile again.
   4. Push each dirty record with its base version. On `conflict`, merge and retry, up to 3 attempts per record per cycle.
   5. Save bookkeeping and the last-sync time.
4. **Status.** `synced` is reported only after a full cycle left nothing pending, i.e. after the server confirmed the writes.
5. **After a cycle that changed local records**, `dataVersion` increments and the app re-reads storage. The workout screen is not remounted under someone mid-workout.

Bookkeeping lives in the same localStorage scope as the data it describes: if the data is wiped, the bookkeeping goes too, so a wiped device re-downloads instead of treating missing data as a deletion.

---

## 6. Conflict-resolution strategy

Deterministic: every device reaches the same winner from the same two versions.

| Situation | Resolution |
| --- | --- |
| Edit vs edit (same record) | Later client timestamp wins; ties broken by device id, then content hash. The loser is kept: a plan as a visible "(conflict copy)" plan, other records in the conflict archive (capped at 50 entries). |
| Edit vs delete | The later of the two wins. A discarded edit goes to the conflict archive. An edit after a remote delete keeps (resurrects) the edit. |
| Identical content on two devices | Adopted; no conflict, no duplicate. |
| Two different in-progress workouts | The later-started stays active; the other is saved to history as `abandoned`. |
| Active session that already finished locally | The finished session wins; the stale cloud active row is cleaned up. |
| Server-side conflict (stale base version) | Nothing written; stored row returned; client merges and retries. |
| Device clock far in the future | Clamped to server time (cannot win conflicts forever). |

Deletions are tombstones (`deleted_at`, content dropped, row kept). A stale push cannot resurrect a tombstone; only an explicit re-create at the current version clears it.

---

## 7. Offline behaviour

- The app keeps working from localStorage with no network. Starting, completing and editing workouts all work offline.
- Changes are marked dirty and queued; the queue survives page reload because it is stored in the account-scoped bookkeeping.
- Offline status is shown without touching the network. On the `online` event the attempt counter resets and a sync runs immediately.
- Retries: exponential backoff (base 2 s, cap 5 min, jittered), at most 6 attempts, then the status becomes `error` until the user taps Retry.
- Error kinds: `transient` retries with backoff; `auth`, `permanent` (server rejected the request) and `local` (unreadable local data) are not retried automatically. Unreadable local data pauses sync and uploads and deletes nothing.
- Records over about 900 KB are skipped and reported as pending (never dropped).

---

## 8. Starter plans and legacy data

**Starter plans.** A starter plan is recognised by `isStarter === true` plus a content hash equal to the seeded original (`isPristineStarter`). Untouched starters are never uploaded, so they cannot overwrite or pollute real cloud plans. A new device that only has starters keeps them and also receives the user's real plans. A starter the user edited does sync and replaces a pristine starter elsewhere. Demo sessions are never uploaded.

**Legacy (un-namespaced) data.**
- The sync engine never reads, uploads or modifies the old unscoped keys.
- The only way in is the explicit "Import into my account" prompt (`LegacyDataClaim`). It shows how many plans and workouts would be imported before anything happens, and "Not now" is remembered per account.
- The import merges by id, is idempotent, archives the loser of any same-id difference, and verifies the result; if it cannot be verified the account is restored exactly and the legacy data stays.
- Legacy records are never modified or deleted; unreadable legacy data is reported and left alone.

**First sync.** It never overwrites either side: empty cloud, existing cloud, and both sides having different records all merge by id.

---

## 9. Backup and restore

- The JSON backup format is unchanged; sync bookkeeping is not part of it.
- **Decision (Stage 3):** restoring a backup now **merges by id** instead of replacing. Records absent from the backup are kept; when the same id differs, the later timestamp wins and the other copy is archived; restoring the same file twice changes nothing.
- An explicit `replace` mode still exists in `db.importBackupJSON` (destructive; tombstones absent records in the cloud). A restore that cannot be fully written reports failure and applies nothing partially.
- Restored records are treated as new local activity and sync up afterwards.

---

## 10. Account deletion

- `delete_own_account()` (unchanged) deletes the caller's `auth.users` row. All four sync tables reference it with ON DELETE CASCADE, so the user's workout rows are removed in the same transaction.
- Tested: the caller's rows are removed in every sync table and other accounts' rows are untouched; a re-created account starts clean.
- Local data is erased by the existing `eraseAccountLocalData` flow after cloud deletion.
- Note: the header comment in `20261030000000_delete_own_account.sql` still says fitness data is not stored in the cloud. That is now outdated, but it is a comment only; behaviour is correct.
- Reset All Data and Delete Workout History first pull from the cloud (best effort, 8 s limit) so records created on other devices are tombstoned too; offline, the delete proceeds and stays queued.

---

## 11. UI

- Status badge in the navigation bar and a status card in Settings > Data.
- Five states: **Synced**, **Syncing**, **Pending changes** (with a count), **Offline**, **Failed** (with the error message). Shows "Local only" when cloud sync is off.
- Last successful sync time (relative), or "Not yet". "Synced" is never shown without a server-confirmed time.
- Retry button appears only on failure or pending-with-changes; the card is a polite live region.
- Kept conflict versions can be listed (newest first, this account only).
- No redesign; the components follow the existing premium styling.

---

## 12. Test results

Stage 5 ran the sync-related files only (not the full repository suite):

| Gate | Result |
| --- | --- |
| Targeted tests | 13 files, **185 passed, 0 failed** |
| `npm run lint` (`tsc --noEmit`) | exit 0 |
| `npm run build` | succeeded (existing chunk-size warning only) |
| `npm run check:api` | exit 0 |

Details and the section-by-section coverage matrix are in `CROSS_DEVICE_SYNC_STAGE5_TEST_REPORT.md`. Environment: Node 22 locally (repo declares 24.x; warnings only).

### Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Desktop workout appears on mobile | Automated two-device simulation passes; **manual check required** |
| 2 | Mobile workout appears on desktop | Same as 1 |
| 3 | Existing history preserved | Automated (first-sync merge, wiped-device re-download, legacy claim) |
| 4 | Accounts cannot see each other's data | Automated (engine + RLS tests) |
| 5 | Offline changes sync after reconnect | Automated |
| 6 | No duplicate records | Automated |
| 7 | Deleted records do not reappear | Automated |
| 8 | Conflicts do not silently destroy data | Automated (loser always archived or kept as a copy) |
| 9 | Starter plans do not overwrite real plans | Automated |
| 10 | Backup and restore keep working | Automated |
| 11 | Account deletion removes cloud workout data | Automated (PGlite, cascade) |
| 12 | RLS prevents cross-account access | Automated (PGlite) |
| 13 | Existing features keep working | **Not fully verified:** full suite not run in Stage 5 |
| 14 | Relevant tests pass | Targeted set passes |

---

## 13. Known limitations

1. **Only workout data is synced.** Plans, sessions, the in-progress workout and the active plan id. These stay device-local and are **not** synced: profile, nutrition logs and custom foods, sleep logs, body metrics, hydration data, reminders settings, Body Scan photos and avatar (IndexedDB). If "relevant fitness data" in the brief was meant to include these, that is a follow-up scope decision.
2. **RLS and migration tests run on PGlite**, not against the live project. The live schema was checked read-only (tables, policies, migration list) in Stage 2.
3. **No real two-device run yet.** Cross-device behaviour is proven by simulation only.
4. **Full test suite not run** in Stages 5 or 6 by instruction.
5. **Conflict detail is coarse by design:** whole-record winner plus a kept copy; no field-level merge inside a single plan or session.
6. **Pull is by polling** (every 5 minutes while visible, plus on focus/online); there is no realtime push, so another device's change can take up to that long to appear unless the tab regains focus.
7. **Records larger than about 900 KB** are skipped and reported as pending.
8. **Concurrent active workouts** on two devices resolve to one active workout; the other is saved as abandoned (kept, not lost).
9. **Sync bookkeeping is localStorage-bound.** If a browser clears site data, that device re-downloads; local-only unsynced edits on that device would be lost with it (cloud copies are safe).
10. The `delete_own_account` migration header comment is outdated (comment only).

---

## 14. Deployment and migration instructions

**Database.** Live migrations include `20261105071106 workout_cloud_sync` and `20261105072929 workout_sync_no_client_delete` (confirmed with a read-only migration list in Stage 5). They match the repository files and are idempotent. **No new migration is needed.** Do not re-run anything against Production without approval.

**Application, in order (each step needs your explicit approval):**
1. Review the branch diff. Note the sync commits share the branch with the Vercel/Gemini work, so review or merge accordingly.
2. Run the full test suite on Node 24.x (not done yet).
3. Deploy to **Preview** first, pointed at the live Supabase project (or a test account on it).
4. Complete the manual verification below.
5. Only then merge and promote to Production.

Rollback: sync is additive. Disabling it means not mounting `SyncProvider`; local data is untouched. The cloud tables can stay in place.

---

## 15. Remaining manual verification steps

1. Sign in on desktop and on a phone with the same test account; create a workout on each and confirm it appears on the other.
2. Put one device in airplane mode, complete a workout, reconnect, and confirm the status goes Pending, then Syncing, then Synced and the workout appears on the other device.
3. Edit the same plan on both devices offline; reconnect and confirm one version wins and a "(conflict copy)" plan is kept.
4. Delete a workout on one device and confirm it does not return on the other, including after the second device was offline during the delete.
5. Sign in with a second account on the same browser and confirm it sees none of the first account's workouts.
6. On a device with old un-namespaced data, confirm the import prompt appears, shows counts, and nothing imports until you choose to.
7. Export a JSON backup, restore it, and confirm nothing is lost and no duplicates appear.
8. Delete a throwaway test account and confirm its rows are gone in the Supabase table editor.
9. Check that the Synced, Syncing, Pending, Offline and Failed states display correctly at phone width.
10. Smoke-test the unrelated features (nutrition, body scan, AI coach, progression) after deploying the Preview.
