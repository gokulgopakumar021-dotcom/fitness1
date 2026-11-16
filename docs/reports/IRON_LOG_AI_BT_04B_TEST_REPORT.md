# BT-04B Test Report

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.
The numbers below are the BT-04B final full run. BT-04C ran targeted files only (owner instruction); see the BT-04C report.

Environment: Node **v24.22.3** (installed in the sandbox via the `node@24` npm package; `package.json` requires 24.x, so BT-04's Node 22 gap is closed). Linux sandbox, no hardware, no live Supabase, no real browser.

## Commands and actual results (final code)
| Command | Result |
|---|---|
| `npm ci` | success |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm run build:api` then `npm run check:api` | `api bundle OK: api/index.js 246436 bytes, 47 source files` |
| `npx vitest run` (full suite) | **213 files passed, 2 skipped (215); 3900 tests passed, 47 skipped (3947); 0 failed** |
| `npm run build` (`vite build`) | built successfully (existing chunk-size warning only) |

Earlier in the work, full runs failed only on guards that needed updating for this change, each fixed: `migrationReconstruction` (stale count 16 → 17, a BT-04 carry-over), `app.sideEffects` (route inventory now pins the 3 wearable routes), `clientRouteContract` (now also scans `src/server/wearables/routes.ts` and checks policy for the method actually registered).

## New tests (all passing)
| File | Tests | Covers |
|---|---|---|
| `src/server/wearables/wearables.api.test.ts` | 35 | Consent endpoints (auth, default off, grant/revoke, account isolation with forged `userId`, bad categories, stale version, 503 fail-closed); trainer enforcement (no consent, live-only, each other category alone, revocation next request, other account's consent, stale, simulated, implausible bpm, hostile device name, DB down keeps Coach working, no lookup without wearable claim); ingestion (401, consent 403, idempotent re-send, partial batch with all five outcomes, simulated, ignored ownership/quality claims, cross-account dedupe, malformed envelopes, batch/body limits, rate limit, in-batch and concurrent duplicates, first-workout-wins, delayed batch, 503 safe error, counts-only logs) |
| `src/test/rls.wearableConsentIngest.test.ts` | 19 | Proposed migration on top of the applied one (idempotent re-apply; RLS on, anon none, credentials unreachable); consent state + audit rows, revoke keeps history, version re-consent, invalid/anon/no-identity rejected, cross-user isolation; ingest function: direct inserts denied, consent required, owner from `auth.uid()`, idempotent, repeats/concurrent (serialized in PGlite), cross-account, workout label length, no simulated origin, plausibility ranges equal `METRICS` for every metric (boundaries), 500 cap, account-deletion cascade |
| `src/wearables/bt04b.test.ts` | 17 | Consent policy, sanitizer, trainer reduction, sync-status model, device-state derivation, `HrRecorder` (throttle, implausible, confirmation, interrupted + delayed resend with identical timestamps, auth expiry, consent loss, workout separation, cap, batching, in-flight guard), energy estimate |
| `src/components/wearables/WearablesView.test.tsx` | 27 | Empty dashboard; unsupported browser; iPhone message; supported browser; real vs simulated device; permission required; syncing / failed / unavailable / expired / synced; remembered device disconnected; remove needs confirmation and is distinct from disconnect; failed removal; consent defaults OFF; connecting never grants; explanation before granting; grant per category; revoke; server unreachable; unverifiable consent; stale consent; sync controller never sends simulated, nothing without consent, sends real readings for the active workout, nothing without a workout |

Mutation check: removing the insert revoke and the consent condition from the proposed SQL made 3 SQL tests fail; the file was restored.

## Not tested / gaps (explicit)
- **Signup, login, logout, account switching regression**: *not run as dedicated checks and not inspected*, per the owner's instruction that the signup issue is resolved. They are exercised only incidentally by the full suite, which passed.
- **Live Supabase / real PostgREST / real Supabase auth**: not tested. PGlite is not equivalent. No production or test-account requests were made.
- **True multi-connection concurrency** for duplicate ingestion: PGlite is single-connection (serialized); the concurrent-duplicate API test uses an in-memory store. The database guarantee rests on `on conflict do nothing` on a unique key.
- **Mobile layout**: not tested (jsdom has no layout engine). Responsive classes exist; no viewport/visual test and no accessibility audit with assistive technology.
- **Real browsers and Web Bluetooth**: no Android Chrome, desktop Chrome, iOS test. Capability messaging is tested with injected environments only.
- **Hardware**: no physical device was used. Nothing is hardware-verified.
- **Heart-rate zones with unknown age**: *(BT-04C)* implemented and unit-tested (25 tests).
- **Server check that a workout session exists / timestamp within it**: *(BT-04C)* implemented in the PROPOSED migration and tested in PGlite only; not verified on a real Supabase database.
- **Real Gemini calls**: mocked; no live model request.
- Existing Bluetooth/workout/Coach Iron behaviour is covered by the pre-existing suite (all passing); no new end-to-end browser test was added.

## Skipped tests (pre-existing, not caused by BT-04B)
Conditional skips found in the repo: `quota.pg.integration.test.ts` (needs a real Postgres), `redisTestHarness.ts` (needs Redis), `poseModel.integrity.test.ts` (skips when the model file is absent), `legalReleaseGate.test.tsx` (skipped while `LEGAL.isDraft`; intentionally unchanged). Totals: 2 skipped files and 47 skipped tests in the full run.
