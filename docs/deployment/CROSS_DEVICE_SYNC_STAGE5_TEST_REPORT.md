# Cross-Device Sync — Stage 5 Test Report

Branch: `implementation/vercel-stage-3-core-backend` (base: `f205697` iron-log-sync-stage4)
Scope: targeted sync-related verification only. The full repository suite was intentionally NOT run in this stage.
No source or test files were changed or removed in Stage 5.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Type check / lint | `npm run lint` (`tsc --noEmit`) | exit 0 |
| Production build | `npm run build` | succeeded (only the existing >500 kB chunk warning) |
| API bundle check | `npm run check:api` | exit 0 |
| Targeted tests | 13 files | 185 passed, 0 failed |

Environment: Node v22.23.4 (the repo declares 24.x; npm printed EBADENGINE warnings only).

## Test files run

| File | Tests |
| --- | --- |
| src/sync/syncEngine.test.ts | 40 |
| src/sync/syncController.test.ts | 20 |
| src/sync/syncDeletion.test.ts | 10 |
| src/sync/syncBackup.test.ts | 7 |
| src/sync/SyncProvider.test.tsx | 5 |
| src/storage/backupMerge.test.ts | 14 |
| src/storage/legacyData.test.ts | 10 |
| src/storage/localStorageScopeGuard.test.ts | 24 |
| src/components/sync/SyncStatus.test.tsx | 14 |
| src/components/sync/syncPresentation.test.ts | 7 |
| src/components/settings/LegacyDataClaim.test.tsx | 3 |
| src/test/rls.workoutSync.test.ts | 25 |
| src/test/rls.deleteAccount.test.ts | 6 |

## Brief section 12 coverage

| Required area | Covered by |
| --- | --- |
| Local-to-cloud upload | syncEngine (local -> cloud), SyncProvider |
| Cloud-to-local download | syncEngine (second device), syncBackup |
| Two-device / same-account sync | syncEngine (second device, offline-for-days, active session on another device) |
| Different-account isolation | syncEngine (different account, per-user namespacing); rls.workoutSync (B cannot read/insert/update A) |
| Record-level merging | syncEngine (merge per record, unrelated entries untouched); backupMerge |
| Duplicate prevention | syncEngine (repeated syncs, lost-response replay, same content on two devices); rls.workoutSync (idempotent push) |
| Deletion tombstones | syncEngine (delete propagates, offline device does not resurrect, client never hard-deletes); syncDeletion; rls.workoutSync |
| Conflict resolution | syncEngine (edit vs edit, deterministic, session conflict, edit vs delete, archive cap); rls.workoutSync (stale base version) |
| Offline edits / reconnection / retry | syncEngine (offline edits, days offline); syncController (backoff, max attempts, manual retry); SyncProvider (offline then reconnect) |
| Starter-plan protection | syncEngine (3 tests); syncBackup (seeding does not upload) |
| Legacy-data handling | syncEngine (legacy never read/uploaded); legacyData (explicit claim, idempotent, rollback, per-account decline); LegacyDataClaim |
| Interrupted synchronisation | syncEngine (interrupted push, page closed mid-sync, transient pull failure); syncDeletion (interrupted delete) |
| Account deletion | syncEngine (account deletion); rls.workoutSync + rls.deleteAccount (cascade in every sync table) |
| RLS ownership enforcement | rls.workoutSync (25 tests) |
| Backup and restore compatibility | syncBackup; backupMerge (round-trip, idempotent, replace mode) |
| UI status (5 states, last sync) | syncPresentation; SyncStatus |

## Limits of this verification

- RLS and migration tests run on PGlite (in-process Postgres) against the repository migrations, not against the live Supabase project.
- Acceptance criteria 1 and 2 (a workout appears on desktop/mobile) are verified by simulated two-device tests, not by real devices. Manual check still required.
- Full-suite regression (criterion 13) was not run here by instruction; the unrelated feature suites are untouched by this branch.
- Quota-failure tests print expected `Failed saving plans` stack traces; they are intentional and all pass.
