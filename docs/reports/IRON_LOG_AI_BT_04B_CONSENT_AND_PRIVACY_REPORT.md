# BT-04B Consent & Privacy Report

> **Updated for BT-04C (2026-11-16).** Where this report disagrees with `IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md`, the BT-04C report is current. Lines changed by BT-04C are marked *(BT-04C)*.

## Model
One consent system: the existing `wearable_ai_consents` table (current state, one row per account) plus a new append-only `wearable_consent_events` audit table (proposed migration). The **server record is the authority**. The browser keeps only a cache (`consent.ts`), refreshed from the server and never able to grant anything.

| Category | Meaning | Active in UI | Read by anything today |
|---|---|---|---|
| `live_heart_rate` | Live bpm from a real device may go to Coach Iron | Yes | Yes: the AI trainer prompt (server-enforced) |
| `workout_health_sync` | Real readings may be stored in the account | Yes | Yes: ingestion requires it; never implies AI sharing |
| `historical_heart_rate` | Stored history may go to Coach Iron | *(BT-04C)* Yes | *(BT-04C)* Yes: the trainer builds a summary on the server from the account's own stored samples (30 days, at most 5 workouts, numbers and dates only), read from the database on every request. Client-sent history is ignored. Fails closed on database error |
| `sleep_and_recovery_metrics` | Other metrics (resting HR, HRV, sleep, SpO2, respiratory rate) | No | No (a browser cannot collect these) |
| `activity_metrics` | Steps, energy, distance | No | No |

Defaults: all OFF, no pre-checked boxes, connecting a device never changes consent (tested). Consent version is 1; a record under another version authorizes nothing and the UI says so (tested at API, SQL and UI levels).

## Before granting (shown in the dialog)
What is shared · why it is needed · how Coach Iron uses it · whether it is sent to an external AI provider · how to turn it off and what happens after. The text makes no claim about provider retention, training or deletion.

## UNRESOLVED privacy requirement (owner action)
The Gemini plan/tier and its data-handling terms are **not verified**. The UI states this plainly ("Iron Log has not yet verified how that provider retains or uses submitted data") instead of asserting anything. Before launch the owner must confirm the tier and terms (retention, training use, regional processing, deletion) and then update the consent copy and the privacy policy. Legal text was not edited and `LEGAL.isDraft` was not changed; no legal compliance is claimed.

## Revocation
1. UI calls `PUT /api/wearables/consent` with the new set; the screen changes only after the server confirms.
2. `set_my_wearable_consent()` updates the state row and writes a `revoked` audit event in one transaction (revoking everything deletes the state row but keeps the audit history).
3. Every trainer/ingest request re-reads consent: **effective on the very next request**, including from older sessions or other devices (tested through the HTTP API, not just the UI).
4. The recorder discards unsent readings and stops when the server answers `consent_required`.
5. Already-sent AI messages cannot be recalled; already-stored readings remain until the device is removed (stated in the UI).

## Data categories actually reaching the AI provider
Only `{ connected flag, sanitized device name (≤32 chars), integer bpm 20–255 }`, only with `live_heart_rate` consent at the current version, never for simulated readings. Nothing else wearable-related is added to the prompt.

## Fail-closed behaviour
Database unavailable, bad token, or malformed row → wearable data withheld; Coach Iron answers normally; consent/ingest endpoints return 503 with no detail. The UI shows "could not be verified… treated as not shared" and disables the switches.

## Gaps
- Consent writes are not live until the proposed migration is applied.
- *(BT-04C)* Consent history is shown in the Wearables dashboard (read-only; category, granted/revoked, version, time) via `POST /api/wearables/consent-history`. Live data needs the proposed migration, because the audit table is part of it.
- Retention/erasure policy for the audit table is undecided.
- Per-device consent is not modelled (consent is account-wide).
