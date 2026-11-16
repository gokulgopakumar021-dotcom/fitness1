# BT-04B API & Ingestion Report

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.

All routes are authenticated (bearer token verified by the existing middleware), registered in `endpoints.ts` (so they are subject to the project's body limits, rate limits, age gate and validation), and use the caller's own token for Supabase access (no service-role key).

## `GET /api/wearables/consent`
Returns `{ success, currentVersion, categories, stale }`. 503 `wearable_store_unavailable` if consent cannot be read.

## `PUT /api/wearables/consent`
Body `{ categories: [...] }` (names from the allowlist; empty array revokes everything). Unknown categories → 400. Unknown body keys (e.g. `userId`) dropped. Identity from the token via `set_my_wearable_consent()`.

## `POST /api/wearables/ingest`
Body: `{ device: { deviceKey, manufacturer, model?, displayName?, ingestionMethod }, workoutSessionId?, samples: [{ metric, value, unit, measuredAt, measuredEndAt?, tzOffsetMin?, sourceRecordId?, origin }] }`

Order of checks: auth → body size/schema (400/413) → envelope validation → consent from the database (`workout_health_sync`, else 403 `consent_required`) → per-record validation → one database call for storable rows → per-record outcomes.

| Rule | Behaviour |
|---|---|
| Ingestion methods from a browser | `direct_ble`, `manual_import` only; others → 400 |
| Provenance | `direct_ble`: origin `live` or `synchronized`; `manual_import`: `manual`. `simulated` → record `rejected`. Provider label and `quality` (`unverified` / `user_entered`) are set by the server; client quality/"verified" claims ignored |
| Metrics | the 11 types in `METRICS`; unknown → `unsupported`. Unit and range checked by the existing `normalizeSample` |
| Timestamps | not in the future (>5 min), not older than 366 days |
| Batch | 1–200 samples (413 `batch_too_large` above); 500 hard cap in the database; body limit 256 KB; 20 requests/min |
| Idempotency | unique `(user_id, dedupe_key)` + `on conflict do nothing`; re-sends and concurrent identical requests store one row; a repeat inside a batch counts as duplicate |
| Response | `{ success, summary:{received,accepted,duplicate,rejected,unsupported,invalid}, results:[{index,status,reason?}], syncedAt }`; HTTP 200 with partial success; nothing rejected is hidden |
| Errors | 401, 403 `consent_required`, 413, 429, 503; no database text, no stack |
| Logging | counts only. Measurements, device keys, names and session ids are never logged (tested) |

Reuse: `src/wearables/types.ts` and `normalize.ts` (no second normalization system); BT-04's provenance model and dedupe key.

## BT-04C additions
- `POST /api/wearables/workout-heart-rate` `{ sessionId }` reads the caller's stored samples for one workout under the caller's token (RLS); 30/min; pages 1000 rows × 8 and reports `truncated`. Reading your own stored data needs no consent category (owner to confirm).
- `POST /api/wearables/consent-history` reads `wearable_consent_events` (read-only). Both use POST with a schema-validated JSON body because the repo tripwire forbids reading the query string in backend code.
- Ingest verification (proposed migration, unapplied): `workout_session_verified` is set only inside `ingest_wearable_batch()` from the caller's own cloud-synced sessions (±5 min); samples outside a synced session's window are not stored (`rejected_keys`).

## Workout association (partial)
Samples carry an optional `workoutSessionId` (label, ≤128 chars, no FK because workouts are local-first). First association wins: re-sending the same reading under another workout is a duplicate, so one reading cannot be moved between workouts. **Not implemented:** server-side check that the session exists and that the timestamp falls within it; existing workout statistics are not modified or recomputed.

## Client side
`HrRecorder` (real readings only, 1 per 5 s, memory buffer, per-workout batches of ≤100, retries with identical timestamps, drops oldest beyond 1,000, discards on consent loss); `WearableSyncController` (runs only with a real device, an active workout, and server-confirmed consent; flushes every 30 s, on tab hide, on disconnect/workout end). *(BT-04C)* Unsent readings are mirrored to an account-scoped on-device outbox, restored only after consent is confirmed, resent with the original timestamps, and wiped on consent off, sign-out or account switch. There is **no background sync**.

## Requires production configuration / approval
Apply the proposed migration (owner approval); confirm `SUPABASE_URL`/anon key in the API environment (already used by other routes); confirm shared rate-limit store; staging test with two isolated accounts.
