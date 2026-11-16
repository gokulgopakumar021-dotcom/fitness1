# BT-04B Next-Stage Roadmap

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.

## Gate 0: owner approvals (blocking production use)
1. Review and approve `supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql`. Apply first to a Supabase branch or staging project, never directly to production.
2. Run the live security checklist with **two isolated test accounts** (owner-approved, no real user data): cross-user reads/writes through PostgREST, direct insert denied, consent RPC, ingest RPC, credentials table inaccessible, account deletion cascade.
3. Confirm the Gemini plan and data-handling terms; update consent copy and privacy policy (legal text and `LEGAL.isDraft` are owner decisions).
4. Decide retention/erasure for `wearable_consent_events`.
5. Confirm shared rate-limit store in production.

## Next engineering stage (BT-04C) — status *(BT-04C)*
Done: heart-rate zones, workout verification on ingest (proposed migration, unapplied), workout heart rate in history, historical HR for Coach Iron, consent history view, persisted unsent readings. Pending: live staging verification (task 7), real-browser QA, hardware records.
| Item | Notes |
|---|---|
| Heart-rate zones | Remove `profile.age \|\| 26`; add user-defined max HR; label as estimate; show nothing rather than a guessed zone when age and max HR are unknown (`calculateHeartRateZone`, `BluetoothGadgetContext`, tracker UI) |
| Workout verification | On ingest, verify the session exists for the user and the timestamp is within its window when the session is cloud-synced; otherwise keep as unverified label |
| Show workout heart-rate in workout history | Read stored samples per session; do not rewrite existing statistics |
| Historical heart-rate for Coach Iron | Server-side summary built from stored samples, gated by `historical_heart_rate`; client never supplies history |
| Consent history view | Read `wearable_consent_events` for the user |
| Real-browser QA | Android Chrome with a BLE strap; mobile and desktop viewports; accessibility pass (screen reader, keyboard) |
| Hardware test records | Dated per-device test notes before any "Verified" label; none exist today |
| Persist unsent readings across reloads | Needs a scoped IndexedDB/localStorage key (storage-scope guard applies) |

## Provider integrations (each needs approval; none started)
Official APIs only, server-side OAuth, no scraping or reverse engineering. Candidates subject to terms and approval: Polar AccessLink, Garmin Health/Connect, WHOOP, Oura. Fitbit legacy and Google Health API availability are uncertain; do not assume. Aggregators require separate owner approval and a cost decision. Adapter interface should accept normalized samples through the same ingestion path, with tokens held only in the service-role-only `wearable_provider_credentials` table.

## Infrastructure that does not exist yet
Scheduled/background sync for cloud providers needs a worker or cron (external cost, owner approval). Browsers cannot sync Bluetooth in the background; native apps (HealthKit, Health Connect) are deferred per the PWA-first strategy.

## Known browser limits to keep communicating
iOS Safari/Chrome have no standard Web Bluetooth; installing the PWA does not change this; Android Chrome works only for devices exposing the standard Heart Rate service; a manufacturer app working does not imply Iron Log access.
