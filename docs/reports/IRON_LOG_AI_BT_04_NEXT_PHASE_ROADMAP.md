# BT-04 — Next Phase Roadmap

Principle: **PWA first, maximum practical compatibility, native later.** This replaces BT-03's assumption that the next stage is a native shell: that order was superseded by the owner's PWA-first decision. BT-03's native sections (BT-05 HealthKit, BT-06 Health Connect) stay deferred.

## Owner decisions needed first
1. **Base branch.** BT-04 was built on `feature/ironlog-billing-referrals-launch` @ `ac300aa` (21 commits ahead of `main`; includes the migration-history reconciliation). Confirm this is the base and how it will reach `main`.
2. **Coach Iron and live heart rate.** It is now off by default (see the security report). Keep it off until consent exists, or accept a different interim.
3. **Gemini tier/terms** (free vs paid, retention, training use) and counsel engagement for the privacy text.
4. **Done:** wearable migration applied live as `20261115131442` and recorded in `REMOTE_HISTORY`. **Still pending:** the referral `search_path` proposal (now `20261116000000_…`), which fixes three live advisor warnings.
5. **Hardware:** which watches/bands/straps the owner already has (drives the test list).
6. Whether to **apply to Garmin's developer program** (business application, privacy policy must be on a business page per forum reports).

## BT-04B — Make the foundation reachable (next, small)
* **Consent screen** (grant/revoke per category; plain-language purpose; "external AI provider may process this"; off by default) and server persistence into `wearable_ai_consents`.
* **Server-side AI gate:** the trainer route reads consent and strips health fields; escape/limit `deviceName`.
* **Wearables screen** (dashboard, add device, device details, data-source labels live/synced/manual/**simulated**). Reuse the design system; the existing modal is the starting point. Show the iOS limitation and the third-party-browser note; never show a disabled Connect button as live.
* **Ingestion endpoint** `POST /api/wearables/ingest`: verified bearer token, schema validation via `normalizeSample`, per-user rate limit, batch cap, `ON CONFLICT (user_id, dedupe_key)` upsert, partial-failure report. Add to `routePolicy`/client route contract tests.
* **Persist workout-window heart rate (opt-in)** as downsampled samples with `origin='live'`; link to `WorkoutSession` by time window. Never persist simulator data.
* Replace the static `220 − age` zone default (25 when age unknown) with a labelled estimate, or let the user enter max HR.
* Fix `delete_own_account` header comment (stale).

## BT-04C — Hardware reality check (parallel, cheap, high value)
Test on owner-owned devices with a BLE scanner (nRF Connect) plus Iron Log on Android Chrome: does each advertise 0x180D? Does connecting in Iron Log stream HR? Battery? Record model, firmware, phone OS, browser version and date. Only then move any cell to Verified/Degraded/Unsupported. Include the iOS third-party browser question (Bluefy) as an experiment, not a promise.

## BT-08-style cloud integrations (after BT-04B)
Order by access, not ambition: **Polar** (self-serve; read official terms first) → **Garmin** (only if approved) → others one at a time. Needs a server-side token vault, refresh worker, webhook signature validation, provider-side revoke on disconnect, and a review of each provider's terms for AI processing. Aggregator decision (Terra, Spike, Open Wearables, etc.) requires explicit owner approval: evaluate cost, data residency, subprocessor disclosure, lock-in. **No paid service has been selected or purchased.**

## Native (still deferred)
HealthKit, Health Connect, native BLE (Capacitor). Prerequisites unchanged from BT-03: native token storage, CORS for Capacitor, store privacy declarations, and counsel review. Capacitor packages are already in `package.json`; no `ios/` or `android/` exists and none was created.

## Always
No compatibility claim without a dated hardware record. No wearable fields into any AI prompt without consent + disclosure + server enforcement. Re-check Google Health API availability quarterly.
