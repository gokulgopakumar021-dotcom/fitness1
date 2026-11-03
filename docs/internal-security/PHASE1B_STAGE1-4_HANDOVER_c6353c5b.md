# IRONLOG AI — Phase 1B, Stages 1–4 Handover

Purpose: give the next session the exact state, evidence and decisions so it can verify them and continue from Stage 5.
Everything marked "claimed" must be re-verified. Claude did not commit, push, merge, deploy, run a migration, or touch live Supabase at any point. The owner applies and pushes patches.

## 1. Baselines

| Item | Value |
|---|---|
| Phase 1 baseline | `73c2ec4` (ironlog-security-phase1) |
| Stage 3 `main` | `cd828f1` (ironlog-security-phase1b-stage3), single commit over `73c2ec4` |
| Stage 4 work | `ironlog-security-phase1b-interim-stage4.patch`, **incremental over `cd828f1`**; the owner applies it and supplies the resulting commit hash (`<NEW_MAIN_COMMIT>`) |

## 2. Stage 1 verification (done in the previous session)

On a fresh clone of `main`: HEAD `cd828f1` = `origin/main`, clean tree. `git diff 73c2ec4..HEAD` = 22 files, +2,335/−27, with zero differing changed lines against `ironlog-security-phase1b-stage3.patch`; the patch reverse-applies cleanly; `git diff --check` clean; lockfile +86/−0, `package.json` +1.
Test baseline on unmodified `cd828f1` with real Redis 7.0.15 and `REQUIRE_REDIS_TESTS=1`: 135 files, 2,528 tests passed, 0 failed, 0 skipped; `tsc --noEmit` clean. Node v22.22.2.

## 3. Stage 4 — what was implemented (claimed; verify)

Files: `config.ts`, `quota.ts`, `index.ts`, `endpoints.ts` (comment only), `security.test.ts`, new `quotaFailure.test.ts` (58 tests), new `aiRequestFixtures.ts` (shared request payloads moved out of `security.test.ts`), `testUtils.ts` (`QUOTA_ENV`), `config.rate.test.ts`, `redisApp.integration.test.ts`, `startup.process.test.ts` (+4 tests), `.env.example`, `docs/security/quota-store.md`, `docs/security/rate-limiting-redis.md` (one link).

- `ResilientQuotaStore` removed. `QuotaStoreUnavailableError` has a static message and a `reason` code (`timeout`, `transport`, `no_token`, `not_configured`, `bad_shape`, `rpc_<code>`, `rpc_error`); DB error text never reaches clients or logs.
- `SupabaseQuotaStore`: 3 s timeout via `AbortSignal.timeout`, every failure mapped to the error above, called with the caller's JWT.
- Gate: `QuotaStoreUnavailableError` → 503 `quota_unavailable`, `Retry-After: 5`, before the route handler (no Gemini call). Untyped errors still go to the generic 500 handler. 429 `quota_exceeded` unchanged.
- `DegradingQuotaStore` (only with `QUOTA_FAILURE_POLICY=degraded`): catches only `QuotaStoreUnavailableError`, counts per instance, sets `X-Quota-Mode: degraded`, throttled `quota_store_degraded` log. `allowDegraded=false` (the three always-closed buckets `extract-plan`, `ai-generate-physique`, `ai-physique-analysis`) re-throws, never counted in memory.
- Config: `QUOTA_STORE` strict (`memory|supabase`; invalid = startup problem); **production default is `supabase`**, `memory` must be explicit and warns; `QUOTA_STORE=supabase` requires `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (or `VITE_` equivalents) else startup problem; `QUOTA_FAILURE_POLICY` `closed` (default) | `degraded`, invalid = problem and never permissive.
- The old fallback test (`security.test.ts`, ~L290) was rewritten to assert 503 `quota_unavailable`, no Gemini call, no degraded log.
- Nine Stage 3 tests (`config.rate`, `redisApp.integration`, `startup.process`) were given a non-secret Supabase fixture because production now requires quota config; no assertions were weakened.

## 4. Stage 4 test evidence (claimed; re-run)

Patch applied to a fresh `cd828f1`: `tsc` clean; `REQUIRE_REDIS_TESTS=1 npx vitest run` → **136 files, 2,590 passed, 0 failed, 0 skipped**; `git diff --check` clean.
Mutation checks (tests fail when code is broken; `quota.ts` restored after each): gate ignores `allowDegraded` (4 failures), no 503 mapping (21), degraded store catches every error (1), bad shape treated as allowed (1), error message leaks into reason (2), no timeout signal (1).
Not run: `npm run build`, `npm audit`.

## 5. Decisions (keep unless the owner changes them)

1. Production without Redis refuses to start unless `RATE_LIMIT_STORE=memory` is explicit.
2. Auth-failure lockout uses the same store as other limiters (503 under `closed`, per-instance under `degraded`).
3. Quota counted on attempt; no refund on upstream failure (documented).
4. Supabase access is read-only: no writes, migrations or dashboard changes.
5. `extract-plan` and both physique routes are fail-closed in every mode; `/api/health` unchanged.
6. Production quota default is `supabase` (Claude's recommendation; the owner said "continue" without objecting). Memory in production must be explicit.
7. Degraded quota mode is explicit, logged and documented; always-closed routes never degrade.

## 6. Open items and known risks

- **No startup check that the `consume_ai_quota` migration exists.** Not built: a boot-time RPC would consume quota or need a JWT, and PostgREST schema introspection as a read-only alternative is unverified. Until then a missing migration shows as 503 `quota_unavailable` on the first AI request. Task 4 should test feasibility read-only and/or add an opt-in `verify:quota` script.
- Supabase is mocked at the `supabase-js` boundary: real error codes, real abort behaviour and a real-JWT call are **not verified**. `ai_usage_quota` migration was applied to live on 2026-11-02 at the owner's request (per the Phase 1 report); the live schema has not been inspected.
- Deploy impact: a production deploy without Supabase config or `QUOTA_STORE=memory` now refuses to start.
- Degraded mode multiplies daily limits by instance count.
- A timed-out Redis command can still execute server-side (counted for a 503'd request).
- TLS `rediss://`, managed Redis and ACL users untested. No CI (TST-01). Phase 1 report items still relevant (`TRUST_PROXY`, Host-header CORS rule, `auth.getUser` per request, body-size estimates, no pen test, Gemini/Supabase Auth mocked).
- Stage 5 Tasks 4–9 and Stage 6–7 deliverables not started.

## 7. Environment notes

- Sandbox does not persist; write an interim `.patch` early. `redis-server` must be reinstalled (`apt-get install redis-server`). Sandbox network allows github.com, npm registry, PyPI, etc.; the repo clones anonymously over https.
- Owner is on Windows; Redis from WSL or Docker with `REDIS_TEST_URL=redis://127.0.0.1:6379`; PowerShell: `$env:REQUIRE_REDIS_TESTS="1"; $env:REDIS_TEST_URL="redis://127.0.0.1:6379"; npm test`.
- Never request credentials or tokens in chat; give commands that read environment variables.
