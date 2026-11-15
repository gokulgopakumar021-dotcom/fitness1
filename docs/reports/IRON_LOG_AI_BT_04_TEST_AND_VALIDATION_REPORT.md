# BT-04 — Test & Validation Report

Environment: sandbox clone, **Node v22.23.4** (project requires **24.x**: deviation, re-run on Node 24 before merge). `npm ci` succeeded. Date 2026-11-15.

## Commands and actual results
| Command | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | clean |
| `npx tsc --noEmit` | clean |
| `npm run check:api` | `api bundle OK` (226,123 bytes, 40 source files) |
| `npm run build` | built; only the pre-existing >500 kB chunk warning; no tracked file modified |
| `vitest run src/server` | 25 files passed, 2 skipped; 793 passed, 46 skipped |
| `vitest run` (all other `src/*` except `src/test`) | 136 files passed; 2145 passed, 1 skipped |
| `vitest run src/test` | 32 files passed; 583 passed |
| **Total** | **193 files, 3,521 tests passed, 47 skipped, 0 failed** (run in three chunks because the single run exceeds my tool time limit) |

## New tests (all passing)
* `src/wearables/wearables.test.ts` (30): heart-rate parser (8/16-bit, contact, energy, RR, malformed, zero = missing, battery), capability detection (iOS, iPadOS-as-Mac, Android, insecure context, no API, no environment), normalization (units, ranges, missing values, timezone, provenance), merge (idempotency, retry, out-of-order, revisions, simulated rejected, partial failure), overlap (no double counting, null not 0), consent (default off, revoke, stale version, corrupt JSON), AI context gate, compatibility data.
* `src/services/bluetoothFitness.test.ts` (11): unsupported browser, iPhone message, SSR, device not found, connection failure (with state cleanup), missing heart-rate service, missing battery service, real/invalid battery, malformed packets, disconnection, simulator separation.
* `src/test/rls.wearableFoundation.test.ts` (11): RLS and constraints on the applied migration (see security report).
* `src/test/wearableGuards.test.ts` (5): no hard-coded battery, call sites gated, no unverified compatibility claims, no secrets in wearable modules, `LEGAL.isDraft` untouched.

## Defects found by testing and fixed
1. Failed BLE connect left a stale device reference (fixed).
2. First consent draft used an unscoped localStorage key; the repo's scope guard caught it (fixed with `scopedKey`).
3. My own test-fixture errors (future timestamp, wrong clock, non-bypass service role) were corrected in the tests, not the code.

## Skipped / not covered
* 47 skipped tests are pre-existing (e.g. real-server-with-Redis tests, skipped because no Redis is available here).
* **No real hardware**: parser tested on synthetic packets; Web Bluetooth mocked. Nothing is Verified.
* **Live Supabase:** the migration was applied and its structure checked by query (RLS, policies, grants, advisors); no live cross-user behavioural test was run. The 11 RLS tests use PGlite with a simulated `auth` schema and roles; they don't cover PostgREST or concurrency.
* After applying, the full suite was **not** re-run; re-run only `migrationHistory.guard`, `rls.referralSearchPath`, `rls.wearableFoundation` and `wearableGuards` (46 tests, all passed) after the migration was moved into `supabase/migrations` and the referral proposal renamed. Run the full suite on Node 24 before merging.
* **No UI/responsive/browser tests** for new screens (none were built; the modal edit is covered by guard tests only). Existing route/auth/workout/sleep tests passed unchanged.
* Node 24 not used.
