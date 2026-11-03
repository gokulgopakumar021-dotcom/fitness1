# Remediation Session 2 — IL-03, IL-06 (fixed) and IL-04 (plan only)

Date: 3 November 2026
Scope: IL-03, IL-06 (applied), IL-04 (drafted, **not applied**). IL-05, IL-07 to IL-10, mobile configuration and dependencies were not touched.

**Final status: PARTIALLY COMPLETED** — IL-03 and IL-06 fixed and verified locally; IL-04 drafted and tested locally only, awaiting owner approval; IL-02 still open by owner decision (not buying Supabase Pro for now). This session does not make the application "fully secure". Overall release decision is unchanged: **CONDITIONALLY READY (web only)**; Android/iOS remain NOT IMPLEMENTED / NOT VERIFIED.

---

## A. Initial state

| Item | Value |
|---|---|
| Branch / HEAD | `main` at `e91d092` ("il01-il02-remediation.patch"), on top of `31fafd3`. `git fetch` showed no divergence; working tree clean. |
| Baseline tests | 2,601 passed, 1 failed (IL-06), 36 skipped (137 files passed, 1 failed, 2 skipped). Reproduced at the start of this session. |
| IL-01 | Fixed in the repo (8 reports under `docs/internal-security/`, absent from `dist/`). **Live deployment NOT VERIFIED**: no production URL was available to this session; redeploy and re-check the old `/assets/aistudio/...` URLs. |
| IL-02 | **Not fixed.** Live security advisor re-run 3 Nov 2026 06:02 UTC: `auth_leaked_password_protection` = WARN ("currently disabled"). Needs the Pro plan; owner has decided not to upgrade for now. Accepted, open risk: users can still choose breached passwords (the app's own rule is 8+ characters, a letter and a number). |
| Other live advisor items | `rls_enabled_no_policy` INFO on `public.ai_usage_counters` and `authenticated_security_definer_function_executable` WARN on `consume_ai_quota` and `delete_own_account`. All three are by design (the counter table is reachable only through the function; both functions are meant to be called by signed-in users). Unchanged. |
| GitHub repo visibility | Still public: an anonymous HTTPS `git clone` succeeded this session. `docs/internal-security/` (including this file) is therefore publicly readable. History was not altered. |

---

## B. IL-03 — Four localStorage keys bypassed account scoping

### Change
All reads and writes of the four keys now go through `scopedKey()` (`src/storage/storageScope.ts`), evaluated at call time:

| Key (base name) | File |
|---|---|
| `ironlog_hydration_pacing_reminders_v1` | `src/components/nutrition/HydrationPacingAlert.tsx` (read + write) |
| `ironlog_last_hydration_alert_ts_v1` | `src/components/nutrition/HydrationPacingAlert.tsx` (read + write) |
| `ironlog_smart_hydration_alerts_v1` | `src/components/nutrition/SmartAlertsConfigModal.tsx` (read + write) |
| `ironlog_water_unit` | `src/components/nutrition/WaterIntakeLogger.tsx` (read + write; literal replaced by a `WATER_UNIT_KEY` constant) |

No change to `resetAll.ts`, `db.ts` or `storageScope.ts` was needed: `keysInCurrentScope()` already matches every key ending in `::u:<current user id>`, so the four keys are covered by Reset All Data and by account erase automatically. This is proven by tests below rather than assumed.

### Decision: existing unscoped values
They are **left exactly as they are: not read by signed-in accounts, not migrated, not deleted.** This follows the rule already documented in `storageScope.ts` for all legacy data.
- Not migrated: copying them into whichever account signs in first would hand one person's preferences to another on a shared device, which is the leak IL-03 describes.
- Not deleted: the instruction was not to silently delete user data, and the values are harmless preferences.
- Consequence: after this change, a signed-in user sees default hydration/unit settings once and must set them again. These are low-sensitivity preferences (unit, reminder hours, alert config, a timestamp).
- Residual: the legacy values stay on the device until the user runs Reset All Data while signed out (that clears legacy keys, behaviour unchanged) or clears browser data.

### Evidence
- `src/storage/hydrationScope.test.tsx` (8 tests) drives the real components under two account scopes: A's unit and wake hour never appear for B and return for A; the "last alert" timestamp is written under A's scope only (fake timers); smart-alert config is invisible across accounts; legacy values are neither inherited nor deleted nor copied; `eraseAccountLocalData` and `resetAllAppData` remove all four keys for the active scope only and leave another account's and the legacy keys intact; signed-out reset still clears legacy keys.
- `src/storage/localStorageScopeGuard.test.ts` (23 tests) scans every production `.ts/.tsx` under `src/` and fails on any `localStorage.get/set/removeItem` whose key is not `scopedKey(...)`, `STORAGE_KEYS.*` (verified to be scoped getters), `consentKey()` (verified), the `keysInCurrentScope()` loop variable, or an explicit allow-list entry. It also fails on `sessionStorage`, `localStorage[...]`, `localStorage.clear()`, `window.localStorage` and any bare `localStorage` reference (aliasing). Fourteen synthetic bypass/accept cases test the scanner itself.
- **Mutation check:** with the three component edits reverted, 7 of these tests fail (unit, wake hour, last-alert, smart config, legacy, the tree scan, the four-key check); restored, all pass.

### Limits and one deliberate exception
- The guard is a static scan. It cannot prove runtime behaviour of code it cannot parse (for example a key built in another module and passed in). It is a tripwire, not a proof.
- **`src/context/ThemeContext.tsx` still uses an unscoped key** for the light/dark preference. It is on the guard's allow-list with a written reason (UI-only, no personal data, needed before sign-in). It was outside the four named keys and was not changed. Say so if you want it scoped too (it would then reset to dark on the login screen).
- This is client-side separation on a shared browser profile, not access control (as stated in `storageScope.ts`).

---

## C. IL-06 — Stale privacy test

`src/services/poseLandmarker.privacy.test.ts` (test "localStorage is used only by mirrorStorage.ts, under one key") expected the bare `STORAGE_KEY`, but `mirrorStorage.ts` correctly uses `scopedKey(STORAGE_KEY)`. The assertion was replaced with a stricter one:
- every `localStorage.<method>(` call in `mirrorStorage.ts` must be a `getItem`/`setItem` whose key is exactly `scopedKey(STORAGE_KEY)` (counted, so a `removeItem`, `clear` or a second key fails),
- `scopedKey` must be imported from `storage/storageScope`,
- the existing checks are unchanged: `STORAGE_KEY` is the single key `ironlog_mirror_sessions_v1`, and no other mirror file touches `localStorage`.

Intent preserved and tightened (the old regex also mis-parsed `scopedKey(...)` arguments). **Mutation check:** changing `mirrorStorage.ts` to a bare key fails the test; adding a second key (`scopedKey('other_key')`) fails it; the file was restored (clean `git status`).

---

## D. IL-04 — consume_ai_quota bucket abuse (PLAN ONLY — NOT APPLIED)

### Problem (confirmed by reading the code and the live schema)
Any signed-in user can call `consume_ai_quota` directly through PostgREST with any `p_bucket` of 1–64 characters; each new name creates a counter row. Nothing deletes old rows. A caller can only affect their own counters, so the risk is unbounded storage growth, not cross-user access. Live check (read-only, 3 Nov 2026): `public.ai_usage_counters` currently has **0 rows**; `pg_cron` is available but **not installed**.

### Proposed migration (draft file, not run anywhere)
`supabase/migrations/20261103000000_ai_quota_bucket_allowlist.sql`
1. **Allow-list** of the 15 `ai: true` buckets in `src/server/security/endpoints.ts`, held in the function. Anything else raises `22023 unknown bucket`, even with `p_limit = 0`. (`barcode` is not an AI bucket and never calls the function.)
2. **Bounded growth:** at most 15 buckets x 8 days = 120 rows per user.
3. **Cleanup without pg_cron:** the first time a user uses a bucket on a new UTC day (`used = 1` after the increment), that user's counters older than 7 days are deleted. It touches only the caller's rows, uses the primary key, and needs no extension, schedule or service role. A one-time `delete` at the top removes stale or non-allow-listed rows (a no-op on the live project today).
4. Unchanged: `SECURITY DEFINER`, empty `search_path`, server-side UTC day, the atomic `INSERT .. ON CONFLICT .. WHERE` increment, argument validation, grants (`authenticated` only; re-stated explicitly).

Alternatives considered and not drafted: a `pg_cron` job (needs the extension enabled on the live project, a separate change), a bucket lookup table (an extra table and another "RLS enabled, no policy" advisor note), and a `CHECK` constraint on the table (a second copy of the list to maintain).

### Evidence (local only)
`src/test/rls.aiUsageQuotaAllowlist.test.ts` (8 tests, PGlite): applies the original migration then the draft; asserts the SQL list equals the `ai: true` buckets of `endpoints.ts` (so adding an AI route without a new migration fails the build); every real bucket works; unknown, near-miss, case-variant, `barcode` and 64-character names are refused and store nothing; previous guarantees still hold (limit, validation, auth, RLS, grants, `search_path`); cleanup deletes only the caller's rows older than 7 days (exactly 7 days is kept, another user's rows untouched, not triggered on non-first calls). **Mutation check:** removing the allow-list fails 2 tests; removing the cleanup fails 2 tests.

### What is NOT verified
- Not run against any real Supabase project, and `apply_migration` was **not** called.
- PGlite is single-connection: concurrency of the new code path was not exercised. The env-gated real-PostgreSQL suite (`quota.pg.integration.test.ts`) was skipped (no `PG_TEST_URL`); it loads only the original migration and still passes unchanged, but it was not run against the draft.
- Behaviour of Supabase's PostgREST layer for the new error was not tested live.

### Things to decide or do when you approve
1. **`scripts/verify-quota.ts` will break** after the migration: it probes with `verify-quota-probe` (limit 0) and `--consume` uses `verify-quota-seq-*` / `verify-quota-par-*`; these are not allow-listed and will now raise `unknown bucket`. Fix needed at the same time (not made now): probe with a real bucket at limit 0 (writes nothing); `--consume` would use real buckets for the test user. Its test and `docs/security/quota-store.md` need the same update.
2. **Do not push the draft file to a repo connected to the Supabase GitHub integration** unless you want it applied: no CI in the repo applies migrations (verified: no `.github/workflows`, no `db push` in scripts), but whether the Supabase dashboard's GitHub integration is enabled is **NOT VERIFIED** from here.
3. The live project records migration versions by apply time (the previous one was recorded as `20261102045148`); the file timestamp here is only an ordering label.

**Approval needed before any `apply_migration`.** The full SQL is in the draft file and in the session summary.

---

## E. Regression results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` exit 0 (after final changes) |
| Full tests | PASS | `npx vitest run`: 141 files passed, 2 skipped; **2,641 passed, 0 failed, 36 skipped**. Baseline was 2,601 / 1 / 36. Delta: +1 (IL-06 now passing) +8 hydration isolation +23 scope guard +8 IL-04 draft = +40 |
| 36 skipped tests | NOT VERIFIED | Same skipped set as the baseline (env-gated Redis / real-PostgreSQL suites); not run here |
| Production build | PASS | `rm -rf dist && npx vite build` built successfully; no `aistudio`, internal-report or `.md` files in `dist/` |
| Mutation checks | PASS | IL-03 fix reverted: 7 tests fail. IL-06 bare key / second key: fails. IL-04 allow-list removed / cleanup removed: 2 + 2 fail. All restored |
| Live Supabase | READ-ONLY | `list_projects`, security advisor, three `select` queries (counter rows, extensions, function hash). No migration, no writes |
| Two-account isolation (IL-03) | PASS (jsdom, real components) | `hydrationScope.test.tsx`. Real browsers and real sign-in flows were not exercised |
| IL-01 on live site | NOT VERIFIED | No production URL available |
| IL-02 | OPEN / accepted | Advisor still WARN; Pro not purchased |

---

## F. Git changes (nothing committed, pushed or deployed)

Modified: `src/components/nutrition/HydrationPacingAlert.tsx`, `src/components/nutrition/SmartAlertsConfigModal.tsx`, `src/components/nutrition/WaterIntakeLogger.tsx`, `src/services/poseLandmarker.privacy.test.ts`

Added: `src/storage/hydrationScope.test.tsx`, `src/storage/localStorageScopeGuard.test.ts`, `src/test/rls.aiUsageQuotaAllowlist.test.ts`, `supabase/migrations/20261103000000_ai_quota_bucket_allowlist.sql` (DRAFT, unapplied), `docs/internal-security/REMEDIATION_SESSION_2.md` (this file)

No dependency, config, lockfile or mobile change.

---

## G. Remaining findings

- IL-02: open (plan upgrade needed; owner decision to defer).
- IL-04: drafted, awaiting approval, then `verify-quota` companion change.
- IL-05, IL-07 to IL-10 and all mobile-readiness gaps: untouched.
- Observations (not findings in the register yet): ThemeContext unscoped key (accepted, allow-listed); GitHub repository is public and contains `docs/internal-security/`; unknown `/assets/*` paths return the SPA shell rather than 404 (from Session 1).

## H. Final status

**PARTIALLY COMPLETED.** IL-03 and IL-06: fixed and verified locally. IL-04: plan and tested draft delivered, not applied. IL-02: open. Release decision unchanged: CONDITIONALLY READY (web only).
