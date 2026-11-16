# BT-04B Implementation Report: PWA Wearables Dashboard, Consent & Secure Ingestion

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.

Date: 2026-11-16 · Branch: `feature/bt-04b-pwa-wearables` (local; created from `origin/feature/bt-04-pwa-wearable-foundation`) · Nothing committed, pushed, merged, deployed or applied.

## Overall verdict: PASS WITH LIMITATIONS
Repository-level work is implemented and tested in isolation. It is **not production-ready**: the consent and ingestion write paths need the proposed migration (owner approval, not applied), and nothing has been verified against the live project or physical hardware.

## Scope decisions by the owner
- BT-04 is **not** being merged to `main` now; BT-04B is built on the BT-04 branch.
- The signup fix is resolved and was **deliberately not inspected or re-tested** (owner instruction).

## Status legend per feature
| Area | Implemented | Tested | Notes |
|---|---|---|---|
| Server consent API (`GET/PUT /api/wearables/consent`) | Yes | API tests (fake store) + SQL tests (PGlite) | Needs proposed migration to function live (consent writes return a safe 503 without it) |
| Server-side AI consent enforcement (`/api/ai-personal-trainer`) | Yes | Yes (API tests) | Works with the applied schema; without the migration nobody can grant consent, so no wearable data is sent (safe) |
| Ingestion API (`POST /api/wearables/ingest`) | Yes | API tests + SQL tests | Needs proposed migration (ingest function) |
| Wearables dashboard | Yes | jsdom component tests | No visual/mobile-viewport or real-browser test |
| Consent UI | Yes (3 of 5 categories active) | jsdom tests | *(BT-04C)* Historical HR is now active (server-built summary for Coach Iron). Recovery / activity remain "Not available yet" because a browser cannot collect them |
| Workout heart-rate recording (`HrRecorder`, `WearableSyncController`) | Yes | Unit + jsdom tests | *(BT-04C)* Unsent readings now persist across reloads in an account-scoped outbox (`outboxStore.ts`). No hardware test |
| Sync status model | Yes | Unit tests | No background sync (browser limitation) |
| Capability / browser messaging | Reused BT-04 `capabilities.ts` | Component tests (iPhone, desktop, Android-like) | No real-device check |
| Calorie estimate fix | Yes (`energy.ts`) | Unit tests | Removes default age/weight and the male-only formula |
| Heart-rate zones / user max HR | *(BT-04C)* **Implemented** (`heartRateZones.ts`, `maxHrStore.ts`) | Unit tests | No default age; user max HR 120–230, else 220 − age only for age 10–100, else no zone; "(est.)" labels. Other `|| 26` fallbacks elsewhere remain (owner decision) |
| Provider adapters | **Deferred** (no new adapter interface) | n/a | Only the generic ingest route with `direct_ble` / `manual_import` |

## Files created
- `supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql` (PROPOSED, not applied)
- `src/wearables/`: `consentPolicy.ts`, `consentClient.ts`, `ingestClient.ts`, `syncStatus.ts`, `syncStore.ts`, `deviceState.ts`, `hrRecorder.ts`, `savedDevices.ts`, `useWearableConsent.ts`, `energy.ts`, `bt04b.test.ts`
- `src/server/wearables/`: `store.ts`, `ingest.ts`, `routes.ts`, `schemas.ts`, `wearables.api.test.ts`
- `src/components/wearables/`: `WearablesView.tsx`, `ConsentPanel.tsx`, `AddDevicePanel.tsx`, `DeviceList.tsx`, `WearableSyncController.tsx`, `WearablesView.test.tsx`
- `src/test/rls.wearableConsentIngest.test.ts`
- `docs/reports/IRON_LOG_AI_BT_04B_*.md` (six reports)

## Files modified
- `src/server/app.ts` (trainer consent enforcement; wearable routes registered)
- `src/server/security/endpoints.ts` (route policies for the three new routes)
- `src/wearables/consent.ts` (now a cache of the server record; categories/version come from `consentPolicy.ts`)
- `src/context/BluetoothGadgetContext.tsx` (calorie estimate gated on real inputs)
- `src/components/layout/Navbar.tsx`, `src/App.tsx` (Wearables tab; sync controller mounted)
- `src/server/app.sideEffects.test.ts` (wearable routes pinned beside the original 17)
- `src/server/security/clientRouteContract.test.ts` (also scans the wearables routes file; policy checked for the registered method)
- `src/test/migrationReconstruction.test.ts` (hardcoded migration count 16 → 17; stale since BT-04)
- `api/index.js` (regenerated bundle; required by `check:api`)

## Migration status
- Applied: `20261115131442_wearable_foundation` (BT-04). **Unchanged.**
- Proposed, **not applied**: `20261117000000_wearable_consent_ingest_hardening.sql`. Requires owner approval; test on a staging branch/isolated account first.
- Also still proposed from earlier work: `20261116000000_referral_trigger_search_path.sql` (not part of BT-04B).

## Behaviour before the migration is applied (important)
- Consent `PUT` and ingest return a safe `503 wearable_store_unavailable` (the database functions do not exist).
- `GET` consent works (reads the existing table) and returns the applied categories only.
- The AI trainer receives no wearable data (nobody can have BT-04B consent yet). Coach Iron otherwise works normally.
- The Wearables tab loads; switching consent on shows "nothing was changed".

## Not done / out of scope
Native apps, HealthKit, Health Connect, provider OAuth, aggregators, background sync, legal text, billing: none touched.
