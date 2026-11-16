# BT-04B Security Audit

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.

Date: 2026-11-16. Audited the BT-04 branch and the BT-04B changes. Live Supabase was **not** tested; all database checks ran in an in-process Postgres (PGlite) with simulated roles.

## Findings in BT-04 (before BT-04B)
| # | Finding | Severity | Status after BT-04B |
|---|---|---|---|
| 1 | `/api/ai-personal-trainer` accepted any client `bluetooth` object and put `deviceName` and `bpm` into the Gemini prompt with no consent check (client-side gate only) | High (health data to a third party) | **Fixed in code** and tested. Consent read from the database per request; fields reduced to `{isConnected, deviceName, bpm}`; fails closed |
| 2 | Device name unsanitized in the prompt (prompt-injection channel; BLE names are attacker-controlled) | Medium | **Fixed**: whitelist sanitizer, 32 chars, then wrapped with the existing `ui()` untrusted-input fence |
| 3 | `authenticated` role could INSERT directly into `wearable_samples`/`wearable_devices` via PostgREST, bypassing any API validation, consent and rate limits | Medium | **Fixed in proposed migration** (insert revoked; only `ingest_wearable_batch()`); **not live until applied** |
| 4 | `authenticated` could INSERT/UPDATE/DELETE its own consent row directly (no audit; deleting = silent revoke) | Medium | **Fixed in proposed migration** (writes only through `set_my_wearable_consent()` with an append-only audit table); not live until applied |
| 5 | No plausibility constraint on stored values | Low | Added as `NOT VALID` CHECK in the proposed migration; drift test against `METRICS` |
| 6 | Calorie estimate used default age 26 / weight 75 and the male formula for everyone | Low (accuracy/misleading) | **Fixed** (`energy.ts`) |
| 7 | Heart-rate zones use `profile.age || 26` | Low | *(BT-04C)* **Fixed** for zones. The same fallback remains in `tdeeEngine.ts`, `NutritionGoalGauge.tsx` and the trainer prompt in `app.ts` (owner decision pending) |
| 8 | Stale hardcoded migration count in a test (16 vs 17) | Info | Fixed |

## Controls added
- Identity is always from the verified token. Request schemas drop unknown keys, so a client `userId`/`user_id`/`ownerId` is discarded; database functions use `auth.uid()`.
- Consent: read from the database on every wearable request (no server cache), version-checked, unknown categories ignored, failures fail closed (503 for consent/ingest; wearable data withheld for the trainer, which still answers).
- Ingestion: allowlisted metrics and units (reuses `normalizeSample`), range checks, future/too-old timestamps rejected, simulated data rejected at API and impossible at the table, quality derived server-side (clients cannot claim "verified"), provenance rules per method, 200-record batch cap (500 at DB), 256 KB body limit, 20 requests/min, per-record outcomes, idempotent insert (`on conflict do nothing` per user + dedupe key), counts-only logging, no database detail in errors.
- Route policy: all three routes are in the endpoint table (unregistered routes 404); a route-inventory test pins them.

## Verified by test (see test report)
Cross-account consent isolation and forged `userId` ignored; one category never authorizes another; revocation effective on the next request; stale version = no consent; simulated excluded; hostile device name; direct-bypass bodies stripped; ingest 401/403/413/429/503 paths; duplicates (including concurrent in the in-memory store); SQL: direct client writes denied, ingest needs consent, cross-user reads empty, credentials table unreachable, account deletion cascades, plausibility ranges equal `METRICS`; two protections were deliberately removed to confirm tests fail.

## Limitations and residual risk
1. **Live RLS/PostgREST not verified.** PGlite proves the SQL, not Supabase's auth service, PostgREST, role setup or real connection concurrency. A staging run with two isolated test accounts is required before production.
2. **Server cannot prove a reading came from real hardware.** It enforces consent, plausibility, and the client's simulated flag. A modified client with live-HR consent can still send a fabricated plausible bpm to Coach Iron. This is a trust-boundary limit of any client-supplied reading.
3. `workoutSessionId` is a label scoped to the user. *(BT-04C)* The proposed migration verifies it against the caller's cloud-synced sessions; that is not live until applied and not tested on a real database. Unsynced sessions are stored as unverified, so a user can still mislabel their own samples.
4. `SECURITY DEFINER` functions rely on `search_path = ''` and schema-qualified names; reviewed, but should be re-reviewed by the database owner.
5. Consent audit rows cascade-delete with the account (erasure over retention). Retention policy is an owner/legal decision.
6. In-memory rate limiter only protects a single instance unless the project's configured shared store is used in production (existing platform behaviour; verify `RATE_LIMIT_STORE`).
7. The AI provider's data handling (retention/training) is **unverified** and stated as such in the UI.
8. No dependency audit or penetration test was performed.
9. *(BT-04C)* The on-device outbox holds unsent real readings in plain localStorage under the account scope (48 h expiry, 2000 cap). Client-side separation on a shared browser profile is not access control.
