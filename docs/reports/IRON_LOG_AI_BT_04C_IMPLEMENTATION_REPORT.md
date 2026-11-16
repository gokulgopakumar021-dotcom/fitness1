# BT-04C Implementation Report (tasks 1–8)

Date: 2026-11-16 · Branch `feature/bt-04b-pwa-wearables` (local, from `origin/feature/bt-04-pwa-wearable-foundation`) · Nothing committed, pushed, merged, deployed or applied. Node 24.22.3.

## Overall verdict: PASS WITH LIMITATIONS
Code is implemented and tested in isolation. Not production-ready: the consent, ingest and workout-HR read paths need the proposed migration (unapplied), and nothing has run against a real Supabase database, real browser or hardware.

## Status by task
| # | Task | Implemented | Tested | Notes |
|---|---|---|---|---|
| 1 | Heart-rate zones | Yes | Unit (25) | No default age. User max HR 120–230, else 220 − age only for age 10–100, else no zone. "(est.)" labels |
| 2 | Workout verification on ingest | Yes (SQL) | PGlite only | In the proposed migration. Client claims ignored; out-of-window samples not stored |
| 3 | Stored workout HR in history | Yes | Unit + jsdom | `POST /api/wearables/workout-heart-rate`; on demand; statistics untouched |
| 4 | Consent history view | Yes | Unit + jsdom | `POST /api/wearables/consent-history`; read-only panel |
| 5 | Historical HR for Coach Iron | Yes | Unit + API | Server-built from stored samples, gated by `historical_heart_rate` read per request, fails closed |
| 6 | Persist unsent readings | Yes | Unit + jsdom (24 new) | Account-scoped outbox; restore only after consent confirmed; wiped on consent off, sign-out, account switch |
| 7 | Staging verification | Prepared | Script syntax + refusal guards only | **Not run.** Needs approval of a target (see below) |
| 8 | Reports and progress | Reports done | n/a | `PROJECT_PROGRESS.md` not updated: the file was not provided (see below) |

## Task 6 and 7 files (this session)
- New: `src/wearables/outboxStore.ts`, `src/wearables/outbox.test.ts`, `src/components/auth/AuthGate.outbox.test.tsx`, `scripts/staging/verifyWearableMigration.mjs`, `docs/reports/IRON_LOG_AI_BT_04C_STAGING_VERIFICATION.md`.
- Modified: `src/wearables/hrRecorder.ts`, `src/components/wearables/WearableSyncController.tsx`, `src/components/auth/AuthGate.tsx` (one guarded call before the scope changes; signup logic untouched).

## Tests actually run (targeted only, by owner instruction)
`npm run lint` clean. `npm run build:api` + `check:api`: `api bundle OK: api/index.js 259045 bytes, 50 source files` (bundle identical to the patched one).
`npx vitest run` on `src/wearables`, `src/services/bluetoothFitness.test.ts`, `src/components/wearables`, `src/components/workouts`, `src/components/auth`, `src/server/wearables`, `src/test/rls.wearableConsentIngest.test.ts`, `src/test/wearableGuards.test.ts`, `src/storage/localStorageScopeGuard.test.ts`, `src/server/app.sideEffects.test.ts`, `src/server/security/clientRouteContract.test.ts`, `src/server/serverless/normalizeUrl.test.ts`, `src/test/migrationReconstruction.test.ts`: **28 files, 577 tests passed, 0 failed.**
Mutation checks: removing the `AuthGate` clear call fails 2 of 3 gate tests; earlier, removing SQL protections failed 3 SQL tests.

## Not tested
Full suite and production `vite build` (not run in BT-04C). Any live Supabase request. 8000-sample read cap on a real database. PGlite does not prove PostgREST/RLS behaviour. Real browsers, Android Chrome with a BLE strap, mobile layout, accessibility. Any hardware: **no device is Verified; none has a dated test record.** The staging script has never run.

## Known limits
- Outbox lives in plain localStorage (account-scoped, 48 h, 2000 readings). It is cleared on sign-out or direct account switch. A brief auth error that drops the user also clears it. Switching without sign-out leaves the old account's outbox under its own key, unreadable by the new account.
- Until the proposed migration is applied: consent PUT, ingest and workout-HR read return a safe 503, and Coach Iron gets no wearable data. This is expected.
- A modified client with live-HR consent can still send a fabricated plausible bpm.
- Other `|| 26` age fallbacks remain: `tdeeEngine.ts`, `NutritionGoalGauge.tsx`, trainer prompt in `app.ts`.
- Proposed-migration notes: `wearable_try_timestamptz` is marked `immutable` though a timestamptz cast depends on time zone; one malformed `measured_at` aborts a whole batch (the API validates first).

## Staging verification (task 7) — state
The connected Supabase has ONE project (`nerfdflkrtikkbttofwk`), which is production, and no branches. A branch would cost $0.01344/hour. Not created. The owner has not yet confirmed the cost, the organization, test-account creation or branch deletion. Nothing was applied anywhere.

## Owner decisions pending
1. Approve a staging target (branch at $0.01344/h, or a separate project) and test accounts; then run `scripts/staging/verifyWearableMigration.mjs`.
2. Approve applying `supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql` to production only after staging passes. Decide order against `20261116000000_referral_trigger_search_path.sql`.
3. Gemini plan and data-handling terms (UI says unverified).
4. Retention of consent audit rows after account deletion.
5. Other `|| 26` fallbacks.
6. Confirm reading your own stored heart rate needs no consent category.
7. Outbox expiry (48 h) and clear-on-auth-error behaviour.
