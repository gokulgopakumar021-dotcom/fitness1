# BT-04 — Security & Privacy Report

Scope: what was verified in the repository, what was changed, what remains. This is an engineering report, **not legal advice and not a compliance claim**. Qualified legal review is recommended before any wearable data reaches an external AI provider.

## 1. Privacy finding: live heart rate was going to Gemini (verified in code)

| Question | Finding |
|---|---|
| Which health fields are sent? | `bluetooth: { isConnected, bpm }` from `src/components/trainer/AiTrainerView.tsx` and `FloatingTrainerWidget.tsx`. The server (`src/server/app.ts`, `POST /api/ai-personal-trainer`) writes the device name and **live BPM** into the Gemini prompt. |
| Which endpoint? | `/api/ai-personal-trainer` only. `/api/ai-recovery-insights` receives sessions/profile, not wearable fields. |
| Stored or logged by Iron Log? | The route does not log the request body. On failure `handleRouteError` logs request id, user id and a scrubbed error message and stack. Whether a Gemini SDK error message can echo prompt text was **not verified**. Whether Google retains it depends on the Gemini tier and terms, **which the repo's own privacy draft leaves as a pending field** (`geminiTier`). Not verified here. |
| Explicit consent before this change? | **No.** The request was sent whenever a device (real *or simulated*) was connected. |
| Disclosure? | The privacy draft mentions AI context sent to Gemini but contains no wearable or health-data section. `LEGAL.isDraft` is still `true`. |
| **Aggravating defect** | The simulator's invented BPM was sent to the AI **as if it were a real reading.** |

## 2. Remediation implemented

* New gate `buildTrainerBluetoothContext` (`src/wearables/trainerContext.ts`). The AI is told **nothing** (not even the device name) unless the device is real **and** the user has granted the `live_heart_rate` AI consent. Missing BPM is omitted, never `0`.
* Consent module (`src/wearables/consent.ts`): **off by default**, per-category, versioned (a version bump invalidates old consent), revocable, and stored under the existing **per-account** key scope. The repo's `localStorageScopeGuard` test caught an unscoped first draft; it was fixed to use `scopedKey`, which also means consent does not leak between accounts on a shared device.
* Both call sites now go through the gate; a source-guard test fails if either reverts to posting raw BPM.

### ⚠ Behaviour change the owner must know about
Because no consent UI exists yet, **Coach Iron no longer receives live heart rate or device name at all**, for anyone. This is the privacy-conservative default and was chosen over leaving unconsented health data flowing. The coach still works; it just doesn't see heart rate. **Reversing it is a one-line change in each call site, but I recommend against it until the consent screen, the Gemini-tier decision and the policy text exist.** Decision needed from the owner.

### Limits of the fix (do not overstate)
1. The gate is **client-side**. The server still accepts any `bluetooth` object (`validation.ts` uses `loose({kind:'object'})`). A modified client could still send BPM about *itself*. Server enforcement should read `wearable_ai_consents` (proposed table) before including any health field. Not built.
2. `deviceName` is a free-text string that is interpolated into a prompt: a prompt-injection surface once provider-supplied names exist. Constrain/escape it server-side.
3. No consent UI, no policy text, no "what was shared" display was built or published (and none may be, per the brief; legal text is not touched).

## 3. Supabase / RLS design (proposed, tested in PGlite, not applied)

Verified by `src/test/rls.wearableFoundation.test.ts` (11 tests): RLS on all five tables; no grants to `anon`; cross-user reads return nothing; inserting under another user's id is rejected; **a sample cannot be attached to another user's device** (composite FK `(device_id, user_id)`); simulated origin, wrong unit, NaN and unknown metric are rejected by CHECK constraints; duplicates collapse on `(user_id, dedupe_key)`; clients cannot UPDATE samples; **clients cannot read, insert or update provider credentials and cannot create cloud connections**; disconnect cascades credentials; consent has no default row and rejects unknown categories; account deletion cascades everywhere.

**Not verified:** the live Supabase schema, real PostgREST/GoTrue behaviour, concurrency (PGlite is single-connection), grants that Supabase adds automatically in the real project (e.g. default privileges). The Supabase connector was **not used**; no production read or write occurred. Re-audit against the live project is required before applying.

## 4. Credential handling

No OAuth client secret, refresh token or service-role key exists in any new browser-reachable module (guard test). Credentials would live server-side only, referenced by `secret_ref`. No provider integration was implemented, so no secrets were introduced.

## 5. Open risks (ordered)

1. **High:** server does not enforce AI consent (client-only gate).
2. **High:** Gemini tier/terms, retention and training-use are unconfirmed; privacy draft lacks a wearable/health section.
3. **Medium:** account deletion removes our rows but cannot revoke provider tokens at the provider.
4. **Medium:** BLE `device.id` is browser-scoped, so "same device" matching across browsers is unreliable; do not use it as an identity proof.
5. **Medium:** `bluetooth=(self)` Permissions-Policy is present and correct for Web Bluetooth; nothing else needed.
6. **Low:** `delete_own_account()` header comment still says fitness data is not stored in the cloud (stale; pre-existing).
7. Health data of minors: the age gate exists; wearable handling for under-18s was not reviewed.

## 6. Not done, by instruction
No policy was published, `LEGAL.isDraft` is unchanged (guard test), no production setting, secret, subscription or Razorpay item was touched, nothing was committed or pushed.
