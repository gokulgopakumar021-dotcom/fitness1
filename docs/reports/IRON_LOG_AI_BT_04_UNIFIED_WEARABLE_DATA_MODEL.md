# BT-04 — Unified Wearable Data Model

Implemented as: `src/wearables/types.ts`, `normalize.ts` (pure TypeScript, tested) and the migration `supabase/migrations/20261115131442_wearable_foundation.sql` (tested in-process with PGlite and **applied to the live project on 2026-11-15** at the owner's instruction).

## 1. Entities: what was built and what was deliberately not

| Entity | Decision | Why |
|---|---|---|
| `wearable_connections` | **Applied** | One row per integration link (provider + external account). Status, scopes, last sync, last error, revocation time. Created by `service_role` only, because only a server can complete an OAuth/aggregator link. |
| `wearable_devices` | **Applied** | One row per physical/logical source. Unique per `(user_id, ingestion_method, device_key)`. Browser BLE ids are not stable across browsers, so a BLE device is a convenience identity, not proof of the same hardware. |
| `wearable_samples` | **Applied** | Single narrow table for point and interval measurements. Chosen over per-metric tables because the metric list is small, units are constrained by a CHECK, and one dedupe key serves all metrics. |
| `wearable_ai_consents` | **Applied (added beyond the brief's list)** | Server-side record of the separate AI consent. No row = no consent. |
| `wearable_provider_credentials` | **Applied** | Holds only a `secret_ref` (pointer to a secret store). RLS on, no policy, no grant to `anon`/`authenticated`. Tokens are never stored in a client-readable table. |
| `wearable_sessions`, `wearable_sleep_sessions`, `wearable_daily_summaries`, `wearable_sync_jobs` | **Deferred** | Sessions and sleep can be expressed as interval samples (`workout_duration`, `sleep_duration`) until a provider needs stage-level detail. Daily summaries are *derived* and are computed (see section 4) rather than stored, so they cannot drift from their sources. Sync jobs are needed only when a server worker exists (BT-08). Adding them now would be speculative. |

## 2. Required principles → where each is enforced

| Principle | TypeScript (`normalize.ts`) | Database (applied SQL) |
|---|---|---|
| User ownership | n/a (server derives user from the verified token) | `user_id` on every row; RLS `user_id = auth.uid()`; cascade on account deletion |
| Device identity + manufacturer + model | required fields | `device_key`, `manufacturer` (NOT NULL), `model` |
| Integration provider / method | `provider`, `ingestionMethod` validated against a closed set | `ingestion_method` CHECK |
| Value + explicit unit | unit must equal the metric's unit; value must be a finite number inside a plausibility range; **rejected, never clamped** | `unit` CHECK, metric↔unit pairing CHECK, finite-value CHECK |
| Timestamp + timezone | ISO-8601 with offset or `Z` required; stored as canonical UTC; `tzOffsetMin` kept when the source gives it | `measured_at timestamptz`, `tz_offset_min` range CHECK |
| Import time | `importedAt` | `imported_at default now()` |
| Source id | `sourceRecordId` (trimmed; empty becomes null) | `source_record_id` |
| Provenance | `ingestionMethod` + `origin` + `provider` | same columns |
| Quality status | `device_reported / user_entered / derived / unverified`; defaults to `user_entered` for manual, otherwise `unverified` (never silently "verified") | CHECK |
| live / synchronized / manual / simulated | `origin`; simulated is representable in memory only | `origin` CHECK allows **only** `live`, `synchronized`, `manual` |
| Missing stays missing | `null`, `undefined`, `''`, `NaN`, strings are rejected; 0 is accepted only where 0 is in range (0 steps yes, 0 bpm no) | `value` NOT NULL + finite CHECK; no default |

## 3. Metrics supported (units fixed)

`heart_rate`, `resting_heart_rate` (bpm) · `hrv_rmssd`, `hrv_sdnn` (ms; **two distinct types**, because they are different statistics and must not be mixed) · `steps` (count) · `active_energy`, `total_energy` (kcal) · `distance` (m) · `workout_duration`, `sleep_duration` (s) · `blood_oxygen` (percent) · `respiratory_rate` (breaths/min). Sleep *stages* are not modelled yet; add them only when a verified source provides them.

## 4. Deduplication, idempotency, ordering, overlap

* **Identity:** `dedupeKey = provider | deviceId | metric | (id:<sourceRecordId> or t:<start>/<end>)`. Unique per user in the database. A provider id is the strongest signal; absent one, the metric window on that device is the identity.
* **Idempotent merge (`mergeIncoming`):** same key and same value is a no-op; same key and different value is a provider *revision* (the later `importedAt` wins; equal or older is ignored). Re-sending a batch, retrying after a failure, and receiving batches out of order all converge to the same store (tested).
* **Partial failure:** each item is validated independently; invalid items are reported while valid ones still import.
* **Overlapping sources (`resolveDailyTotal`):** for cumulative metrics (steps, energy, distance, durations) values are summed **within one source only**; one source is chosen by an explicit priority list and the others are returned as *alternates* for display. Totals from different devices are never added. A day with no data returns `null`, not 0.
* **Timezone-safe dates:** `localDate` applies the sample's own offset; with no offset it falls back to UTC and says so (`dateBasis: 'utc'`) instead of guessing.
* **Simulated data:** `isPersistable` is false for it; `mergeIncoming` counts and drops it; the database cannot store it.

## 5. Revocation and deletion

* Account deletion: every table cascades from `auth.users` (tested).
* Disconnect: the owner can delete a `wearable_connections` row; credentials and devices tied to it cascade (tested). **Provider-side token revocation cannot happen from SQL** and needs the future server worker (BT-08).
* Clients can delete their own samples and devices. Clients cannot UPDATE samples (revisions arrive through the ingestion path).

## 6. Not yet built (honest list)

No ingestion endpoint, no sync worker, no per-metric retention policy, no sleep-stage entity, no daily-summary materialization. The pure functions above are what such an endpoint must call; wiring them to a route was not done because the tables do not exist in any database yet.
