# IRONLOG AI — Phase 1 Security Remediation Report

Baseline: `main` @ `64a816c` (working tree was clean and identical to the audited commit; no drift found).
State: **uncommitted working-tree changes only.** Nothing committed, pushed, merged or deployed. The `ai_usage_quota` migration was applied to the Supabase project on 2026-11-02 at the owner's explicit request (see §11).
Delivered also as `ironlog-security-phase1.patch` (same convention as the repo's existing `*.patch` files).

## 0. Results at a glance

| | Baseline (audit) | Now |
|---|---|---|
| Test files | 125 | 129 |
| Tests | 2,127 pass | **2,201 pass** (+74 new, 0 existing tests modified) |
| `tsc --noEmit` | pass | pass |
| `vite build` | pass | pass |
| `npm audit` | 4 moderate | 4 moderate (unchanged, see SEC-06) |

Also run: the real server started in production mode (`tsx server.ts`) and probed with curl: public health 200; protected
route without token 401; unknown `/api` path 401 (unauthenticated) ; foreign `Origin` 403; 3 MB unauthenticated body to
`extract-plan` 401 (never parsed); SPA response carries the CSP and security headers.

Automated tests do not replace penetration testing, and nothing was run against a live Supabase project, a real Gemini key, or a browser.

## 1. Finding-by-finding status

| ID | Finding | Status |
|---|---|---|
| SEC-01 | Unauthenticated API (open Gemini proxy) | **FIXED AND TESTED** against mocked Supabase; real `auth.getUser` path **IMPLEMENTED, NOT FULLY VERIFIED** (needs live token) and **REQUIRES DEPLOYMENT CONFIGURATION** (Supabase URL/key on server) |
| SEC-02 | No rate limits / quotas / 25 MB body | Per-process limits, body limits, quotas: **FIXED AND TESTED**. Distributed protection: **PARTIALLY FIXED** (memory store default; shared store written but not applied) → **REQUIRES DEPLOYMENT CONFIGURATION** |
| SEC-03 | Raw `error.message` to clients | **FIXED AND TESTED** |
| SEC-04 | Weak validation / prompt interpolation / MIME | **PARTIALLY FIXED**: request validation, file validation and prompt fencing done and tested; AI *output* validation done for `extract-plan` only (others only parse-failure handling). Prompt-injection resistance is mitigated, not proven |
| SEC-05 | No headers / CSP / CORS | CORS + headers **FIXED AND TESTED**. CSP **IMPLEMENTED, NOT FULLY VERIFIED** (not run in a real browser; MediaPipe/camera/fonts/Bluetooth must be checked live) |
| SEC-06 | 4 moderate npm advisories | **NOT FIXED** (no non-breaking fix exists; see §6) |
| SEC-07 | Local data / token storage | Documentation only, as scoped: `docs/security/local-data-and-tokens.md`. **PARTIALLY FIXED** by design; native storage remains for the mobile phase. Web session persistence untouched |
| SEC-08 | Positive controls | Unchanged. Not re-verified against the live project |
| SEC-09 | Logging | Server: **FIXED AND TESTED** (structured, redacting). Client: **NOT FIXED** — reviewed, see §6 |

## 2. Changes by finding

**SEC-01.** `src/server/security/auth.ts`: one middleware mounted on `/api` before any route. Requires `Authorization: Bearer <jwt>`;
rejects missing/malformed/oversized/expired (decoded locally, verifier not called) with 401; verifies through Supabase
`auth.getUser(token)`; Supabase unreachable → 503 (not 401); no Supabase config → 503 (fails closed); optional
`AUTH_REQUIRE_VERIFIED_EMAIL` → 403. Identity is attached as `req.user`; no user id is ever read from body/query. Public list
is the exact set `GET|HEAD /api/health` (returns only `status`, `time`). Barcode is protected. A test enumerates every Express
route and fails if one has no policy entry. Tokens are held in a `WeakMap`, never on `req`, never logged (tested).
Client: `src/lib/apiFetch.ts` attaches the session token only to `/api/...` (or the configured `VITE_API_BASE_URL` origin), never
to other domains, retries once after a session refresh on 401, passes bodies/headers/Response through unchanged. All 14 internal
call sites (incl. barcode and adaptive coach) migrated; no other `/api` fetches remain.

**SEC-02.** `rateLimit.ts`, `quota.ts`, `endpoints.ts`, `jsonBody.ts`. Layers: per-IP (all `/api`, pre-auth) → failed-auth lockout per IP →
per-user → per-endpoint per-minute → daily per-user per-feature AI quota. Global 25 MB parser removed; per-route limits
(default 16 KB; 64 KB–4 MB for AI routes; 14 MB only `extract-plan`, which additionally caps decoded files at 10 MB). Parsing happens
after auth, so anonymous traffic is never body-parsed. Quota check-and-increment is atomic (synchronous in memory; single
`INSERT … ON CONFLICT DO UPDATE … WHERE used < limit` in Postgres). Day key is the UTC date so reset needs no job. Limits live in one table
and are overridable via `AI_QUOTA_OVERRIDES`; a malformed override cannot disable limits.

**SEC-03.** `errors.ts`: request id (valid inbound `X-Request-Id` kept, else UUID; echoed on every response); all 14 raw `error.message`
returns replaced by `handleRouteError`; shape `{ success, error, code, requestId }` (existing `found`/`reply` fields kept where clients
depend on them). Gemini 429 → 503 `ai_busy`; other upstream status → 502; timeout → 504; unparseable output → 502; anything else → generic 500.
Body-parser errors → 413/400. Config detail (`GEMINI_API_KEY`) removed from 9 client-visible messages.

**SEC-04.** `validation.ts`: types, required fields, lengths, ranges, array sizes, nesting depth for nested app objects, control-character
stripping, unknown top-level keys dropped. `extract-plan`: MIME allow-list (pdf, png, jpeg, webp, text/plain, text/csv), strict base64, no `data:`
prefix, decoded-size cap, and magic-byte check that content matches the declared type. `prompt.ts`: all user-controlled interpolations in the 15 prompts are
wrapped in `<user_input>` fences (forged fence tags stripped) and each prompt starts with an untrusted-data notice. `aiOutput.ts`: extracted plans
are validated/sanitised before return. Over-long chat history is trimmed to the last 40 messages rather than rejected.

**SEC-05.** `cors.ts`, `headers.ts`: explicit allow-list (env + same host), no wildcard, no credentials, GET/POST/OPTIONS, preflight handled, foreign origin 403.
Helmet with CSP enforced in production only (see §8), `X-Frame-Options: DENY`, nosniff, referrer policy, HSTS (prod), `Permissions-Policy`
(`camera=(self)`, `bluetooth=(self)`, microphone off — the app never requests it), `Cache-Control: no-store` on API.

**SEC-06/09.** See §6. `logger.ts`: JSON lines, redacts token/key/password-shaped keys and strings, truncates long strings.

## 3. Files

Modified: `server.ts`, `.env.example`, `package.json`, `package-lock.json` (helmet only, 13 added lines), `src/utils/adaptiveCoach/client.ts`, and the 11 components/services
that call `/api` (import + `fetch`→`apiFetch` only): `AiRecoveryInsightsPanel`, `NutritionView`, `AiRoutineBuilderModal`, `PlansUploadView`, `ExercisePostureModal`,
`ProgressionView`, `AiTrainerView`, `DreamPhysiqueModal`, `DynamicWarmupModal`, `FloatingTrainerWidget`, `WorkoutSessionTracker`, `openFoodFactsService`.
New: `src/server/security/{index,config,auth,cors,headers,jsonBody,rateLimit,quota,endpoints,validation,aiOutput,prompt,errors,logger,requestContext,types,testUtils}.ts`,
`src/lib/apiFetch.ts`, `supabase/migrations/20261031000000_ai_usage_quota.sql`, `docs/security/*.md`, tests (below).
`server.ts` is now `export function createApp(deps)` (so tests can inject mocks); `startServer()` does not run under Vitest.

## 4. Architecture

```
Browser/App ── apiFetch ── Authorization: Bearer <Supabase access token>
                │ (token only to /api on own/API origin; one refresh+retry on 401)
                ▼
request-id → helmet/CSP/headers → CORS → per-IP limit → AUTH ──(Supabase auth.getUser)──┐
   → per-user limit → endpoint policy (404 if unlisted) → per-endpoint/min limit          │ 401 invalid / 503 unreachable
   → JSON parse (route size limit) → schema validation → daily AI quota → handler         │ 403 unverified email (opt-in)
   → Gemini (prompt fenced) → output check → response ; errors → handleRouteError (safe body + server log)
```

Authentication flow: client `getSession()` (auto-refresh) → header → middleware shape/expiry check → `auth.getUser(token)` → `req.user` → every downstream limit keys on `req.user.id`.

Rate-limit/quota: `RateStore` interface (memory impl, 50k-key cap) for rate limits; `QuotaStore` interface with `MemoryQuotaStore` (default) and `SupabaseQuotaStore`
(`consume_ai_quota` RPC called with the caller's own JWT, so no service-role key on the server) wrapped in a fallback to memory if the RPC errors (logged as degraded).
**With the default memory stores and more than one instance, or after a restart, counters are per-instance and reset; protection is not distributed.**

Default daily quotas (proposals, mine, please review): extract-plan 10, physique generate/analysis 10 each, generate-plan 20, ai-routine 20, overload-tuning 30,
warm-up 30, workout-insights/recovery/nutrition/form 40 each, coach/adaptive-explain 60, trainer 100, food-parser 100. Barcode: rate-limited only.

## 5. Tests (73 new across 4 files; all pass)

`security.test.ts` (55): every route 401 without token; malformed/expired/invalid/valid token; identity propagation (body/query user ids ignored); 503 when Supabase down or
unconfigured; 403 unverified; health public; route-table completeness; token never logged; per-IP/per-user/per-endpoint 429; auth-failure lockout; quota enforcement per user/feature;
10 concurrent requests vs quota 3 → exactly 3 pass; UTC-day reset; quota-store fallback; invalid requests don't spend quota; missing fields/types/lengths/ranges/array sizes/nesting;
fence-tag stripping; unsupported MIME, signature mismatch, bad base64, `data:` prefix, >10 MB file, 413 oversize; malformed JSON; malformed/sanitised AI output; upstream Gemini failure,
unexpected exception, no leakage, request-id propagation; CORS allowed/disallowed/preflight/same-host/Capacitor opt-in; headers; production CSP content; no CSP in dev;
all 15 endpoints accept a realistic client payload (guards against validation breaking features).
`apiFetch.test.ts` (9), `logger.test.ts` (3), `rls.aiUsageQuota.test.ts` (6, real migration in PGlite).
Limits of the tests: Gemini and Supabase Auth are mocked; PGlite is single-connection so real multi-connection concurrency of the SQL quota is argued, not demonstrated; no browser.

## 6. Remaining risks and honest gaps

1. **SEC-06 not fixed.** `@capacitor/cli` 8.6.0 is already the latest; the only npm-suggested fix is `--force` to 4.8.2 (a major *downgrade*, would break Capacitor 8). Advisories are dev/CLI-time, not in the browser bundle. Left unchanged; recheck when `glob`/`minimatch`/`rimraf` release fixes the chain. I did not use `overrides` (untested against the CLI).
2. **Distributed limits**: see §4. Pick the shared store (apply migration + `QUOTA_STORE=supabase`) before multi-instance deploys; per-minute rate limits still use the in-process store (a shared limiter, e.g. Redis, is not built).
3. **Client logging (SEC-09)**: 35 `console.*` calls remain in `src/` (mostly `db.ts` storage errors, a few fetch/camera/Bluetooth errors). Reviewed from their call sites: they log static text plus an error object, no tokens or health values seen; not changed, no lint rule added.
4. **AI output validation** only for `extract-plan`. Other endpoints still pass parsed JSON to clients as before (clients apply defaults). Worth a follow-up schema per endpoint.
5. **Prompt injection** is reduced (fencing, length caps, advisory-only outputs), not eliminated.
6. **Quota counted on attempt**: an upstream failure after quota consumption is not refunded.
7. **Auth token not cached**: every request calls Supabase `getUser` (latency + load, but immediate revocation). A short cache is a possible optimisation.
8. **Same-host CORS rule** relies on the `Host` header; it is browser protection, not authentication.
9. **Unrelated pre-existing bug, not changed:** `WorkoutSessionTracker` calls `/api/ai-exercise-coach`, but the server route is `/api/exercise-coach`, so the in-session AI coach has been 404ing since before this work (with the unknown-route handler it now returns a clean JSON 404). One-word client fix; needs your OK because it changes behaviour. Also `generate-plan`, `ai-workout-insights`, `ai-nutrition-coach` have no client callers (still protected; candidates for removal).
10. Body-size and array limits (esp. recovery insights, 4 MB / 1000 sessions) are estimates; a very heavy user could exceed them and get a 400/413. Check against real data volumes.

## 7. Deployment configuration required

`SUPABASE_URL` + publishable key (or reuse the `VITE_` values already present) on the **server**; `GEMINI_API_KEY`; `CORS_ALLOWED_ORIGINS` (and `APP_URL` real value; the `.env.example` placeholder is ignored);
`TRUST_PROXY` set to the real proxy hop count (otherwise all users share the proxy's IP for per-IP limits, or XFF can be spoofed if set too high); optional `AI_QUOTA_OVERRIDES`, `AUTH_REQUIRE_VERIFIED_EMAIL`, `QUOTA_STORE=supabase`.
Full list in `.env.example`.

## 8. Needs live verification

- Real Supabase token accepted/rejected end-to-end; behaviour on expiry/refresh in the browser UI (login, registration, session persistence).
- **CSP in a real browser**: MediaPipe WASM + `blob:` worker (Body Scan, Workout Mirror), camera permission, Web Bluetooth, Google Fonts, Supabase signed video playback, PWA install. `connect-src` is built from the server's Supabase URL, so it must be set in production.
- `ai_usage_quota` migration applied on a staging project; concurrent calls; RLS on the new table; `QUOTA_STORE=supabase`.
- Gemini behaviour with fenced prompts (output quality unchanged), and real Gemini error shapes mapping to 502/503.
- Behind your real proxy: client IP, `X-Forwarded-For`, request-id header passthrough.
- Each AI feature in the UI with real data (validation limits) — the regression suite does not render these against the server.

## 9. Left for the mobile phase

Keychain/Keystore token storage (custom supabase `storage` adapter; plugin not chosen or installed); encryption/backup exclusion for Body Scan and body metrics; `CORS_ALLOW_CAPACITOR` + `VITE_API_BASE_URL`
(see `docs/security/mobile-origins.md`); self-hosting Google Fonts to drop the third-party CSP entries; bumping `@capacitor/cli` when a fix exists; native pinning/jailbreak considerations (not assessed).

## 10. Not done / out of scope

No commit, push, deploy, or Supabase change. Existing tests unchanged. No new product features (the optional `VITE_API_BASE_URL` is plumbing for the CORS/mobile requirement and is inert unless set).

## 11. Supabase migration applied (2026-11-02)

`20261031000000_ai_usage_quota.sql` was applied to the project via the Supabase connector as migration `ai_usage_quota`. Verified on the live database: RLS on, 0 policies, no table privileges for `anon`/`authenticated`, `consume_ai_quota` is `SECURITY DEFINER`, executable by `authenticated` only (not `anon`). Not yet exercised with a real user JWT or real concurrency, and `QUOTA_STORE=supabase` is still not set, so the server still uses the in-memory store until you enable it.

**Stopping here for review and approval.**
