# BT-04C Task 7 — Staging verification of the proposed wearable migration

Status: PREPARED, NOT RUN. No Supabase request was made while writing this. The proposed migration
`supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql` is still UNAPPLIED. Applied migration
`20261115131442` is never edited or recreated.

## Owner approvals required before anything runs
1. Approve applying the proposed migration to a STAGING project or Supabase branch (not production).
2. Provide two dedicated test accounts (A, B) with no real data. Never real users.
3. Approve each live request class. The script only runs with `STAGING_CONFIRM=I_HAVE_OWNER_APPROVAL_FOR_STAGING`.
4. Optional: a staging service-role key, used only to create and delete its own throwaway user (step D01).
5. Note: `supabase/proposed/20261116000000_referral_trigger_search_path.sql` is also proposed. Decide the apply order; the wearable file is dated later.

## How to run
`node scripts/staging/verifyWearableMigration.mjs --plan` prints the 29 steps and makes no request.
Run for real with env: `STAGING_CONFIRM`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STAGING_EXPECTED_REF` (must equal the URL's project ref),
optional `PRODUCTION_REF` (script refuses if equal), `TEST_A_EMAIL/PASSWORD`, `TEST_B_EMAIL/PASSWORD`, optional `STAGING_SERVICE_ROLE_KEY`.
All rows carry a per-run prefix and are removed at the end; leftovers are reported.

## Checklist (script step -> what it proves -> expected)
| Step | Requirement | Expected |
|---|---|---|
| P01 | anon cannot call consent or ingest RPC | denied |
| P02 | `wearable_try_timestamptz` not callable by authenticated | denied |
| I01 | ingest without `workout_health_sync` consent | `consent_required`, nothing stored |
| I02 | direct INSERT to `wearable_samples` / `wearable_devices` | denied |
| I03 | direct INSERT to `wearable_connections` / provider credentials | denied |
| C01 | direct write to `wearable_ai_consents` | denied or 0 rows |
| C02 | unknown category, version 0 via RPC | rejected |
| C03 | grant two categories | row + two `granted` events |
| C04 | B reads A's consent and events | none |
| C05 | audit table insert/update/delete by client | denied, rows intact |
| C06 | revoke one category | `revoked` event, other category kept |
| C07 | new consent version | re-grants every category |
| I04 | ingest owner derived from `auth.uid()` | rows owned by caller, verified = null |
| I05 | resend identical batch | 0 inserted, no new rows |
| I06 | 4 concurrent identical batches | each row exactly once |
| I07 | B uses A's dedupe key | separate B row, A untouched |
| I08 | B reads/deletes A's samples | none visible, none deleted |
| I09 | `origin = simulated` | rejected |
| I10 | bpm 300, wrong unit, unknown metric | rejected |
| I11 | 501-sample batch | rejected |
| S01–S02 | session in window / outside / unsynced | verified / not stored (`rejected_keys`) / stored unverified |
| S03 | client `workout_session_verified: true` | ignored |
| S04 | B labels A's session id | unverified |
| R01 | workout-HR read shape under RLS | A sees its row, B only its own |
| K01 | credentials table via anon and authenticated | no read, no write |
| D01 | delete user (optional) | all four wearable tables empty for that user |

## Manual checks the script does NOT cover (need the staging app and the two accounts)
- Through the deployed API: consent PUT, `POST /api/wearables/ingest`, `POST /api/wearables/workout-heart-rate`, consent history route; confirm 401 without a token, 403 without consent, and that a client-supplied user id is ignored.
- Coach Iron: no wearable data without consent; live HR only with `live_heart_rate`; history only with `historical_heart_rate`; fail-closed when the database is unreachable.
- Rate limits and payload-size limits on the real server.
- Revocation takes effect on the next request from an older session.
- Task 6 outbox: reload mid-workout, confirm unsent readings are resent once after consent is re-confirmed, and wiped on sign-out.

## Findings from reading the SQL (no change made)
- `wearable_try_timestamptz` is declared `immutable` but casting text to `timestamptz` depends on the session time zone (stable). Harmless here because the function is only called inside the ingest function, but worth correcting in a later migration revision. Owner decision.
- `ingest_wearable_batch` casts `measured_at` directly, so one malformed timestamp aborts the whole batch. The server validates first, so this is defence in depth only; the API reports a safe error.
- The 8000-sample read cap in the workout-HR route has still never run against a real database.

## Not tested / limits
- Nothing here has run. PGlite tests do not prove PostgREST behaviour. Results must be pasted into the test report after the run.
- No hardware was used. No device is Verified.
