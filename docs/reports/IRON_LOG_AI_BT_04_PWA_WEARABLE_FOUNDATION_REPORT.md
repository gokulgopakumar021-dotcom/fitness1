# BT-04 — PWA Wearable Foundation: Main Report

## Verdict: **PASS WITH LIMITATIONS**
The reusable PWA foundation exists and is tested, no production change was made, and the privacy defect was contained. It is not a finished feature: no wearable screen, ingestion endpoint, consent UI or server-side consent enforcement exists, no hardware was tested, and nothing yet reads or writes the new tables. Those are documented prerequisites, not hidden failures. No security issue was downgraded to reach this verdict; the open ones are listed in the security report.

## 1. Initial repository state
* Work performed in a **fresh sandbox clone** (your local working tree was not accessible, so its uncommitted/untracked state is **unverified**).
* Base: `origin/feature/ironlog-billing-referrals-launch` @ `ac300aa9ad95…` ("iron log stage 13.1"), 21 commits ahead of `main`, includes migration-history reconciliation. New local branch: `feature/bt-04-pwa-wearable-foundation` (not pushed). Clean tree at start.
* Existing: Web Bluetooth service limited to standard HR (0x180D) and Battery; live BPM display-only; per-account localStorage scoping guard; migration-history guard; `supabase/proposed/` already holds a referral migration; Capacitor packages present, no native projects; `LEGAL.isDraft = true`.
* BT-01/02/03 reports read. Findings re-verified in code: battery `95` hard-code (fixed), BPM to Gemini (confirmed, contained).

## 2. Files
**Created:** `supabase/migrations/20261115131442_wearable_foundation.sql` (replaces the earlier proposal), `src/wearables/{types,normalize,heartRate,capabilities,consent,trainerContext,compatibility}.ts`, `src/wearables/wearables.test.ts`, `src/services/bluetoothFitness.test.ts`, `src/test/rls.wearableFoundation.test.ts`, `src/test/wearableGuards.test.ts`, `supabase/proposed/README.md`, six BT-04 reports.
**Modified:** `src/test/migrationHistory.guard.test.ts` (added the new row to `REMOTE_HISTORY`), the pending referral proposal was **renamed** `20261114000000_…` → `20261116000000_referral_trigger_search_path.sql` (with its test, rollback script and `STAGE1_DATABASE.md` references) because the repo guard requires pending proposals to be newer than the newest applied version; its SQL is unchanged and it is still **not applied**. Also: `src/services/bluetoothFitness.ts`, `src/types/bluetooth.ts`, `src/context/BluetoothGadgetContext.tsx`, `src/components/bluetooth/BluetoothGadgetModal.tsx`, `src/components/trainer/AiTrainerView.tsx`, `src/components/trainer/FloatingTrainerWidget.tsx`.

## 3. Architecture decisions (and why)
* **Adapters in, one vocabulary out.** Four ingestion methods (direct BLE, cloud API, aggregator, native store) all map to one validated `NormalizedSample`; nothing downstream knows brand names. This is what lets later stages add Polar/Garmin/HealthKit without touching the model.
* **Pure, injected-environment modules** (capabilities, parser, merge) so every browser/edge case is unit-testable without a device.
* **Dedupe at two layers:** TypeScript merge for logic, unique `(user_id, dedupe_key)` in SQL for enforcement.
* **Never sum across sources**; one source wins by priority, others shown as alternates.
* **Migration applied by owner instruction (2026-11-15)** after a read-only check of the live project, then recorded in `supabase/migrations` under the version Supabase assigned, keeping the history guard satisfied.
* **Capability detection trusts API presence**, not user-agent, because some iOS third-party browsers do ship Web Bluetooth.

## 4–5. Database and security design
See the data model and security/privacy reports. Highlights: RLS on all five tables; composite FK blocks cross-user device linking; simulated origin impossible to store; credentials table unreachable by client roles; cascades for deletion.

## 6. Privacy findings
Live BPM (and simulated BPM) was sent to Gemini without consent. Now gated; **Coach Iron no longer sees heart rate or device name** until consent exists (owner decision). Server-side enforcement, Gemini tier/terms and policy text remain open.

## 7. Implemented vs deferred
**Implemented:** data model and normalization; dedupe/merge/overlap logic; HR parser; capability detection and honest iOS/Android messaging in the modal (disabled Connect when unsupported; removal of "Tested & Compatible" claims); real-only battery; failed-connect cleanup; consent module (off by default, revocable, per account); AI context gate; compatibility data; migration (applied live) + RLS tests.
**Deferred:** wearable dashboard / add-device / device-details screens; consent UI and server persistence; server ingestion endpoint and rate limits; persisting workout heart rate; cloud/aggregator/native adapters; sync jobs; sleep stages; HealthKit/Health Connect (native, out of scope).

## 8. Tests
193 files, 3,521 passed, 47 pre-existing skips, 0 failed; lint, type check, API check and build clean. Details in the test report. Run on Node 22, not the required Node 24.

## 9. Limitations
No hardware testing (nothing Verified); the live schema was inspected and the migration applied, but live RLS behaviour was not exercised with real users; Node 24 re-run needed; local working tree unverified; brand research partly carried from BT-03.

## 10. Production changes not performed
Apart from the one migration below, no Supabase/auth/env/Razorpay/subscription change, no legal text or `isDraft` change, no package installed, no native project, no commit/push/merge/deploy.

## 10a. Production change performed (owner-instructed)
On 2026-11-15 the owner instructed that the wearable migration be applied. Before applying, the live project (`nerfdflkrtikkbttofwk`, ap-northeast-1) was inspected read-only: its 16-migration history matched the repo's `REMOTE_HISTORY`; no `wearable*` tables existed; the project's default privileges grant `anon`/`authenticated` full table access (the migration explicitly revokes this). The migration was then applied as version **20261115131442** (`wearable_foundation`). Post-apply check: RLS enabled on all five tables; policies 1/2/3/0/3 (consents/connections/devices/credentials/samples); `anon` has no grants; `wearable_provider_credentials` has no policy and no client grants; `authenticated` has only the grants listed in the data model. Security advisor: the only new item is the intentional INFO "RLS enabled, no policy" on the credentials table; the other warnings (mutable `search_path` on three referral functions, SECURITY DEFINER RPCs, leaked-password protection off) already existed. The 3 referral-function warnings are what the still-unapplied referral proposal addresses.
**Not done:** no data was written to the new tables, no live cross-user RLS test was run (the 11 RLS tests ran in an in-process Postgres), no rollback script was written (to undo: drop the five `wearable_*` tables; they are empty).

## 11. Recommended next stage
**BT-04B** (see roadmap): consent screen + server gate, wearables screen, ingestion endpoint; in parallel a hardware reality check on devices you own.
