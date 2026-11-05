# IRONLOG AI — Vercel Stage 2: Production Backend Compatibility Audit & Implementation Plan

**Architecture:** Option 2 (Vite frontend + Express API in the same Vercel project, Vercel Functions for the API)
**Mode:** AUDIT AND PLANNING ONLY. No application source, dependency, configuration, environment variable, migration, infrastructure or Vercel setting was changed. The only repository change is this file.
**Date:** 2026-11-04

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **CONFIRMED** | Directly verified in current source, or observed in a command run during this audit, or observed on the Stage 1 Preview |
| **DOCUMENTED** | Supported by an existing audit or by official vendor documentation (source named) |
| **INFERRED** | Reasoned from the above, not yet experimentally verified |
| **UNVERIFIED** | Needs a Preview test or owner confirmation |

---

## 1. Executive summary

1. **The existing backend can be migrated to Vercel Functions safely, without changing any security control or business rule.** CONFIRMED: every protection (CORS, helmet, IP/user/endpoint rate limits, Supabase JWT verification, Supabase quota RPC, schema validation, fail-closed policies) lives inside `createApp(deps)` and the `src/server/security/*` modules. All of that state is either per-request or in an external store (Redis, Supabase). Nothing in the application logic needs to change.
2. **What blocks a naive deployment is the process entry point and module format, not the application.** Four confirmed blockers: (a) `server.ts` auto-starts a listener, Redis, signal handlers and `process.exit` on import; (b) `server.ts` statically imports `vite`; (c) the code uses 58 extensionless relative imports across 18 of the 23 source files the server needs, which Stage 1 proved fails on Vercel's per-file ESM output (`ERR_MODULE_NOT_FOUND`); (d) there is no serverless initialisation layer (single-flight, readiness wait, retry after failure).
3. **The rewrite-injected `path` query parameter is not a problem for today's code** (CONFIRMED: no production code reads `req.query`, `req.url` or `req.originalUrl`; routing and policy use `req.path` only; no route accepts any query parameter). It is a latent hazard for logging, future routes and any client that sends its own `path`. A safe, deterministic solution exists (§7): rename the rewrite parameter to a reserved name and strip it from `req.url` in the Vercel entry point before Express sees the request. Naive `delete req.query.path` is **unsafe** (§7.4).
4. **Upstash Redis is expected to be compatible with the current client, but only via its standard TCP/TLS URL** (`rediss://default:<password>@<endpoint>:6379`), never its REST URL/token. DOCUMENTED (Upstash docs, node-redis 6.3.0 source inspected). It must be proven in Preview with the existing Redis integration tests. Upstash itself recommends its REST SDK for serverless because of connection counts; using REST would require a new rate-store implementation (a security-code change) and is not recommended for Stage 3.
5. **Large uploads need an architecture change only for files above roughly 3.3 MB.** `POST /api/extract-plan` accepts up to 10 MB decoded (about 13.3 MB base64); Vercel documents a 4.5 MB function body limit. Everything else fits. The private Supabase Storage approach is sound and needs no service-role key (§10). It is separable from the core migration.
6. **Recommendation: READY FOR STAGE 3**, conditional on the owner actions in §15 before any Preview deployment. Stage 3 steps 3.1–3.6 are code-only, local and have no external prerequisites.

---

## 2. Repository baseline and branch information

| Item | Result | Label |
|---|---|---|
| Repository | `gokulgopakumar021-dotcom/fitness1` (public clone made in the audit sandbox; this is **not** the owner's local checkout) | CONFIRMED |
| `main` | `dcec169` "Add files via upload" | CONFIRMED |
| Stage 1 branch | `origin/spike/vercel-express-preview` at `ac38877` "docs(vercel): record Stage 1 Preview results" | CONFIRMED |
| Stage 1 commits ahead of `main` | 4: `e726c0e` (first spike), `253bc81` (`.js` specifier), `7313c9b` (`api/index.ts` + scoped rewrite), `ac38877` (report) | CONFIRMED |
| Audit branch | `audit/vercel-stage-2-backend-readiness`, created from `ac38877` | CONFIRMED |
| Working tree at start | Clean (fresh clone; no pre-existing changes to protect) | CONFIRMED |
| Files differing `main` → Stage 1 branch | `api/index.ts`, `api/_spike/app.ts`, `vercel.json`, `src/server/vercelSpike/vercelSpike.test.ts`, `docs/deployment/VERCEL_STAGE_1_SPIKE_REPORT.md` (5 files, +316 lines) | CONFIRMED |
| On `main` | None of the five above exist (no `api/`, no `vercel.json`, no `docs/deployment/`) | CONFIRMED |

**Required documents**

| Document | Status |
|---|---|
| `docs/VERCEL_BACKEND_COMPATIBILITY_AUDIT.md` | Exists; byte-identical to the supplied copy. Read in full. |
| `docs/deployment/VERCEL_STAGE_1_SPIKE_REPORT.md` | Exists on the Stage 1 branch only; byte-identical to the supplied copy. Read in full. |
| Production API Deployment Audit | **Not in the repository** (searched by name). Read from the supplied upload `PRODUCTION_API_DEPLOYMENT_AUDIT.md` (also dated 2026-11-03, based on commit `79a3dd0`). Consider committing it in a later docs change. |
| `docs/security/rate-limiting-redis.md`, `quota-store.md`, `route-failure-policy.md` | All exist. Read. |

**Local diagnostics run (read-only, nothing committed):** `npm ci` (node_modules is gitignored), `tsc --noEmit` clean, and 5 test files / 171 tests passed (`security.test.ts`, `routePolicy.test.ts`, `quotaFailure.test.ts`, `clientRouteContract.test.ts`, `vercelSpike.test.ts`). The full suite and the four Redis/Postgres/process tests were **not** run (they need infrastructure or exceed sandbox time). Sandbox Node is v22.22.2.

---

## 3. Stage 1 verification and outstanding owner checks

**Verified against the repository**

- `api/index.ts` default-exports `createSpikeApp()` and imports it with the `.js` specifier. CONFIRMED.
- `vercel.json` contains exactly one rule, `/api/:path*` → `/api`. CONFIRMED.
- The spike app imports only `express`; no env reads, timers, listeners or security code. CONFIRMED.
- Stage 1 Preview behaviours (health, original path preserved, POST, 404s, static unaffected, `?path=` injected) are as reported. DOCUMENTED (owner-observed on Preview; not reproducible from the sandbox).

**Discrepancies found**

| # | Discrepancy | Impact |
|---|---|---|
| D1 | Stage 1 report says the tested deployment is commit `9fb746b`. That hash **does not exist** in the repository. The code commit that introduced the rewrite is `7313c9b`. | Owner must confirm in the Vercel dashboard which commit the third Preview built. Low risk, but the "which code was tested" chain is unproven. |
| D2 | Stage 1 report §3/§5 still describes tests calling `api/[...path].ts`; the test file now imports `api/index`. | Stale prose only. |
| D3 | The spike health response (`{ok, service, runtime, version}`) differs from the real one (`{status:'ok', time}`). | Any monitor written against the spike must be updated in Stage 3. |
| D4 | Spike routes `/api/__vercel_spike/*` are **unauthenticated diagnostic endpoints**. | They are safe on an unmerged Preview branch but must never reach `main`/Production. Stage 3 must remove them (step 3.6). |

**Outstanding owner checks from Stage 1 (not verifiable here)**

1. Confirm the commit/branch of the tested Preview (D1) and that Production still points at its previous deployment.
2. Record the Node version and function size from the build log (feeds D-5 and the bundle budget).
3. Confirm `GET /` loads on the Preview.
4. Confirm Vercel Authentication stays on for Previews.

---

## 4. Existing backend architecture

**Process model (CONFIRMED, `server.ts`, 1,719 lines).** `createApp(deps)` (lines 37–1676) builds the Express app, calls `installSecurity`, registers 17 routes, then `installApiTail`. `startServer()` (line 1681) loads config, runs `prepareSecurityRuntime` (Redis connect), builds the app, serves Vite middleware (dev) or `dist/` plus an SPA fallback (production), calls `app.listen`, and registers `SIGTERM`/`SIGINT`. The auto-run guard is `if (!process.env.VITEST) startServer()...` with `process.exit(1)` in the catch.

**Middleware order (CONFIRMED, `security/index.ts`)**

| # | Layer | Source | State |
|---|---|---|---|
| 1 | Request ID | `requestContext.ts` | none |
| 2 | helmet, Permissions-Policy, `no-store` on `/api/*` | `headers.ts` | none |
| 3 | CORS (allow-list; same-`Host` origins allowed; no credentials) | `cors.ts` | none |
| 4 | Per-IP limit (300/min) keyed `req.ip`; fail-open for `GET/HEAD /health` only | `rateLimit.ts` | Redis |
| 5 | Auth: failed-auth lockout peek (30 / 15 min / IP), Bearer parse, expiry pre-check, `auth.getUser(token)` | `auth.ts` | Redis + Supabase Auth |
| 6 | Per-user limit (120/min) | `rateLimit.ts` | Redis |
| 7 | Endpoint policy (unknown path → 404 after auth) | `endpoints.ts` | none |
| 8 | Per-endpoint limit | `rateLimit.ts` | Redis |
| 9 | Route-specific `express.json` (64 KB–14 MB) | `jsonBody.ts` | parser `Map` per app |
| 10 | Schema validation | `validation.ts` | none |
| 11 | Daily AI quota (`consume_ai_quota` RPC with the caller's JWT) | `quota.ts` | Supabase Postgres |
| 12 | Route handler | `server.ts` | `barcodeCache` (module-level `Map`) |
| 13 | `apiNotFound` + terminal error handler | `errors.ts` | none |

**Per-request remote calls (CONFIRMED by reading the pipeline).** An authenticated AI request makes **4 Redis round trips** (IP hit, auth-failure peek, user hit, endpoint hit), **2 Supabase calls** (`getUser`, quota RPC), then Gemini. Region placement of Vercel, Redis and Supabase therefore matters (§11).

**Request IDs and logging.** `requestContext` accepts an inbound `X-Request-Id` only if it matches `^[A-Za-z0-9._-]{8,64}$`. The logger emits JSON lines through `console.*` with redaction (JWTs, bearer tokens, Google and Supabase keys, URL query secrets). Vercel collects console output. CONFIRMED.

**Environment loading.** `dotenv.config()` runs at the top of `server.ts`. On Vercel there is no `.env`, so it is harmless, but dotenv 17 prints an "injected env (0)" line on each load (observed in the audit run). Cosmetic. CONFIRMED.

---

## 5. Complete route inventory

17 routes, verified against `server.ts` registrations and `endpoints.ts`. Every route except `GET /api/health` is authenticated.

**Rate layers on every authenticated route:** per-IP 300/min → auth-failure lockout → per-user 120/min → per-endpoint limit (shown below). All four use Redis. Daily quota (Supabase RPC, caller's JWT) applies to the 15 AI routes only. "Closed" = always fail-closed (`ALWAYS_CLOSED_BUCKETS`: never degrades even if `RATE_LIMIT_FAILURE_POLICY=degraded`).

### 5.1 Policy table

| # | Method and path | Auth | Endpoint limit | Daily quota (bucket) | Parser limit | Failure policy |
|---|---|---|---|---|---|---|
| 1 | `GET /api/health` | **Public** | none (IP limit only, fails open) | none | n/a | open for the IP limiter only |
| 2 | `POST /api/extract-plan` | Bearer | 3/min | 10 | **14 MB** | **Closed** |
| 3 | `POST /api/generate-plan` | Bearer | 5/min | 20 | 64 KB | degradable |
| 4 | `POST /api/exercise-coach` | Bearer | 10/min | 60 | 64 KB | degradable |
| 5 | `POST /api/generate-ai-routine` | Bearer | 5/min | 20 | 256 KB | degradable |
| 6 | `GET /api/nutrition/barcode/:barcode` | Bearer | 30/min | none | 64 KB | degradable |
| 7 | `POST /api/ai-food-parser` | Bearer | 15/min | 100 | 64 KB | degradable |
| 8 | `POST /api/ai-workout-insights` | Bearer | 8/min | 40 | 1 MB | degradable |
| 9 | `POST /api/ai-plan-overload-tuning` | Bearer | 5/min | 30 | 1 MB | degradable |
| 10 | `POST /api/ai-nutrition-coach` | Bearer | 8/min | 40 | 256 KB | degradable |
| 11 | `POST /api/ai-recovery-insights` | Bearer | 8/min | 40 | **4 MB** | degradable |
| 12 | `POST /api/ai-personal-trainer` | Bearer | 12/min | 100 | 1 MB | degradable |
| 13 | `POST /api/adaptive-coach/explain` | Bearer | 10/min | 60 | 256 KB | degradable |
| 14 | `POST /api/ai-form-analyzer` | Bearer | 8/min | 40 | 64 KB | degradable |
| 15 | `POST /api/ai-warmup-generator` | Bearer | 6/min | 30 | 64 KB | degradable |
| 16 | `POST /api/ai-generate-physique` | Bearer | 3/min | 10 | 64 KB | **Closed** |
| 17 | `POST /api/ai-physique-analysis` | Bearer | 3/min | 10 | 256 KB | **Closed** |

### 5.2 Integration and migration table

| # | Redis | Supabase | Gemini | External / timeout | Frontend caller (CONFIRMED by grep) | Vercel risk | Treatment |
|---|---|---|---|---|---|---|---|
| 1 | IP hit (fail-open) | no | no | none | none in `src/` (probe/monitor only) | none | Migrate unchanged. Health during init failure should return 503 (§12, step 3.3). |
| 2 | yes | getUser + quota | yes, `inlineData` | no explicit timeout | `PlansUploadView.tsx` | **High: 4.5 MB platform body cap vs 10 MB**; platform 413 is non-JSON | Migrate; large files via Storage (§10, sub-stage 3B) |
| 3 | yes | yes | yes | none | **none** | low | Migrate unchanged; candidate for `AI_QUOTA_OVERRIDES` = 0 (owner choice) |
| 4 | yes | yes | yes | none | `WorkoutSessionTracker.tsx` | low | Migrate unchanged |
| 5 | yes | yes | yes (custom `User-Agent: aistudio-build` header) | none | `AiRoutineBuilderModal.tsx` | low | Migrate unchanged |
| 6 | yes | getUser only | no | Open Food Facts, 8 s `AbortController`; per-instance cache | `openFoodFactsService.ts` | low; cache hit rate drops across instances | Migrate unchanged |
| 7 | yes | yes | yes | none | `NutritionView.tsx` | low | Migrate unchanged |
| 8 | yes | yes | yes | none | **none** | low | Migrate unchanged; override candidate |
| 9 | yes | yes | yes | none | `ProgressionView.tsx` | low | Migrate unchanged |
| 10 | yes | yes | yes | none | **none** | low | Migrate unchanged; override candidate |
| 11 | yes | yes | yes | none | `AiRecoveryInsightsPanel.tsx` | **Medium: 4 MB parser cap leaves 0.5 MB headroom under the platform cap; real size unmeasured** | Measure with production-like history (§10) |
| 12 | yes | yes | yes | none | `FloatingTrainerWidget.tsx`, `AiTrainerView.tsx` | low | Migrate unchanged |
| 13 | yes | yes | yes (deterministic review first) | 20 s `Promise.race` (does not cancel the underlying call) | `utils/adaptiveCoach/client.ts` | low | Migrate unchanged |
| 14 | yes | yes | yes | none | `ExercisePostureModal.tsx` | low | Migrate unchanged |
| 15 | yes | yes | yes | none | `DynamicWarmupModal.tsx` | low | Migrate unchanged |
| 16 | yes | yes | yes | none | `DreamPhysiqueModal.tsx` | low | Migrate unchanged |
| 17 | yes | yes | yes | none | `DreamPhysiqueModal.tsx` | low | Migrate unchanged |

Notes (CONFIRMED unless stated):
- 13 of 15 Gemini calls use model string `gemini-3.8-flash` with no per-call timeout; only #13 (20 s race) and #6 (8 s, Open Food Facts) have an upper bound. The effective ceiling is therefore the function `maxDuration`.
- `GEMINI_API_KEY` is read from `process.env` per request (no init-time dependency). A new `GoogleGenAI` client is created per request. Missing-key behaviour (503 on nine routes, local fallback 200 on six) is DOCUMENTED from Stage 0 and was not re-verified route by route.
- `generate-plan`, `ai-workout-insights`, `ai-nutrition-coach` have no frontend caller but remain reachable and quota-metered. They were **not** omitted from the migration plan.
- No route uses file upload middleware (no multer); the only "upload" is base64 inside JSON on #2.
- No route streams. No route accepts any query parameter.

---

## 6. Serverless compatibility findings

| ID | Finding | Evidence | Label |
|---|---|---|---|
| S-01 | Importing `server.ts` starts Redis, `app.listen`, `SIGTERM`/`SIGINT` handlers and may `process.exit(1)`. These are the **only** `process.exit`/signal sites in server code. | `grep` of `server.ts` and `src/server`; lines 1705–1717 | CONFIRMED |
| S-02 | `server.ts` imports `vite` statically (line 2). Even with the entry bundled and `vite` marked external, the bundle retains `import { createServer } from "vite"`, so Vercel's file tracing would pull `vite` in. | esbuild experiment (§6.1) | CONFIRMED |
| S-03 | 58 extensionless relative import statements in 18 of the 23 source files the server needs (count is approximate: it includes type-only imports). Stage 1 proved Vercel emits per-file JS and Node ESM then fails on extensionless specifiers. | scripted count; Stage 1 deployment 1 log | CONFIRMED |
| S-04 | `createApp(deps)` is exported, synchronous, and takes injectable `rateStore`, `quotaStore`, `verifyToken`, `config`. With `rateStore: 'redis'` and no store provided it **throws** (cannot silently use memory). | `security/index.ts` | CONFIRMED |
| S-05 | No per-request data in module-level mutable state. Only module-level state: `accessTokens` `WeakMap` keyed by request object (auth.ts), the `PUBLIC` set, the `barcodeCache` `Map` (max 500, 24 h TTL, oldest-first eviction), a per-app parser `Map`. Safe for concurrent requests in one instance (Fluid compute). | grep and read | CONFIRMED |
| S-06 | `barcodeCache` is per instance; hit rate falls as instances multiply; no correctness issue. | `server.ts` 435–543 | CONFIRMED |
| S-07 | No timers or background jobs in the app, other than request-scoped timeouts. One minor leak: in the barcode route, `clearTimeout` is not called on the error path. | read | CONFIRMED |
| S-08 | Static serving and SPA fallback exist only in `startServer()`. The function never reaches them. Non-`/api` paths still get Vercel's platform `NOT_FOUND` (Stage 1). | read; Stage 1 | CONFIRMED |
| S-09 | `src/utils/adaptiveCoach/*` and `recoveryAnalytics.ts` (imported by the server) contain no `window`/`localStorage`/`document` usage. | grep | CONFIRMED |
| S-10 | `RedisRateStore` constructor connects in the background and refuses commands until ready; `waitUntilReady` is used only at startup. A cold start with no readiness wait would produce 503s. | `redisRateStore.ts` | CONFIRMED |
| S-11 | No single-flight guard: concurrent cold starts could each build a Redis client and app. | absence | CONFIRMED |
| S-12 | `prepareSecurityRuntime` throws on bad config or unreachable Redis. An unhandled throw in the function would yield a platform 500 without the app's JSON shape; a cached rejection would poison the instance. | `runtime.ts` | CONFIRMED (design requirement) |
| S-13 | Gemini routes mostly lack timeouts (see §5). With default function duration (§11) a stuck provider call holds an instance. | read | CONFIRMED |

### 6.1 Experiments run in this audit (out-of-tree, nothing committed)

- `esbuild server.ts --bundle --platform=node --format=esm --packages=external` → 144 KB, 23 source files. **The bundled real `createApp` ran under plain Node ESM** with injected fake stores: `/api/health` 200; unauthenticated `/api/nutrition/barcode/…` 401 `auth_required`; unknown `/api/nope` 401 (route existence not revealed); foreign `Origin` 403 `origin_not_allowed`; rate-limit keys `ip:` and `authfail:` used. CONFIRMED: pre-bundling is mechanically viable with no source edits.
- Dependency sizes on disk (not a Vercel bundle measurement): `@google/genai` ≈ 12 MB, `@supabase/supabase-js` ≈ 0.8 MB, `redis` ≈ 0.3 MB, `express` ≈ 0.3 MB, `helmet` ≈ 0.1 MB; `vite` + its native toolchain ≈ 87 MB. The real function size must be read from the Vercel build log (UNVERIFIED); excluding `vite` is clearly necessary for margin against the documented 250 MB limit.

### 6.2 Can `createApp(deps)` be reused unchanged?

**Yes (CONFIRMED in principle and in the experiment above).** The function must import it from a module that has no `startServer`, no `vite` and no `dotenv` side effects. Moving `createApp` verbatim to a new module and re-exporting it from `server.ts` keeps every existing test import (`import { createApp } from '../../../server'`) working. No security or business logic needs to be edited.

### 6.3 Proposed Stage 3 file structure (not created)

```
server.ts                         local runner only (startServer, Vite/dist, signals) + re-export createApp
src/server/app.ts                 createApp(deps) moved verbatim (+ barcodeCache, Gemini helpers)
src/server/serverless/getApp.ts   single-flight init: config -> prepareSecurityRuntime -> createApp
src/server/serverless/handler.ts  (req,res) wrapper: normalise URL, await getApp, delegate, 503 on init failure
src/server/serverless/normalizeUrl.ts  strips the reserved rewrite parameter (pure function, unit-tested)
src/server/serverless/*.test.ts   in-process tests with fake Redis factory
api/index.ts                      thin default export of the handler (replaces the spike export)
api/_spike/                       deleted before merge (D4)
scripts/bundle-api.mjs            only if the bundling sub-spike selects pre-bundling (§12, 3.7)
vercel.json                       rewrite param rename + functions config (owner-approved values)
package.json                      engines.node (owner decision D-5)
```

---

## 7. Rewrite and query-parameter investigation

### 7.1 Why the parameter appears (DOCUMENTED)

Vercel's rewrite documentation shows named path parameters that are not used in the destination becoming query parameters (`/resize/800/600` → `/api/sharp?width=800&height=600`). Our rule `/api/:path*` → `/api` does not use `:path`, so Vercel appends `?path=<segments>`. This matches the Stage 1 observation (`originalUrl:"/api/__vercel_spike/path?path=__vercel_spike%2Fpath"`).

### 7.2 Every use of the request URL in the backend (CONFIRMED by grep of `server.ts` and `src/server`, excluding tests)

| API | Uses |
|---|---|
| `req.query` | **None** |
| `req.originalUrl`, `req.url`, `req.baseUrl` | **None** in production code (only the Stage 1 spike diagnostic reads `originalUrl`) |
| `req.path` | `isHealth`, `resolvePolicy` (policy, limits, quota, body limit, always-closed), `PUBLIC` auth allow-list, `noStoreApi` (`startsWith('/api/')`), log fields |
| Route params | `req.params.barcode` only |
| Signature / canonical-URL validation | **None exist** |
| Client code sending a query string | **None**: no client call in `src/` uses `?path=` or any query on `/api` |

### 7.3 Impact assessment

| Area | Effect of the injected `path` | Label |
|---|---|---|
| Routing, policy, rate-limit keys, quota buckets, body limits, auth allow-list | **None.** They derive from `req.path`, which excludes the query string. Verified by running the real bundled `createApp` with `?path=health`, `?path=nutrition%2Fbarcode%2F…`, a duplicated `?path=evil&path=…`, `/api?path=`: status codes and bodies were identical to the no-query cases. | CONFIRMED |
| Authentication, CORS, validation | None | CONFIRMED |
| Logging | Current loggers record `req.path`, not the URL. No impact today. Any future access log using `originalUrl` would record a misleading `path=` value. | CONFIRMED / INFERRED |
| Caching | Responses are `Cache-Control: no-store` on `/api/*` and are not cacheable by URL. None. | CONFIRMED |
| Future routes reading `req.query` | A route that legitimately accepts `path` would see the injected value; with a client-supplied `path` too, Express yields an **array** (below). | CONFIRMED |
| Edge case `/api` (no trailing slash) | The rewrite source matches it; Express sees `req.path === '/api'`. `noStoreApi` checks `startsWith('/api/')`, so `Cache-Control: no-store` is **not** set on that one path (it returns 401 JSON). Pre-existing quirk, harmless, but worth a test. | CONFIRMED |

### 7.4 Why `delete req.query.path` is not safe (CONFIRMED by experiment on Express 4.22.3)

| Request query | `req.query` |
|---|---|
| `?path=foo%2Fbar` | `{ path: "foo/bar" }` |
| `?path=client&path=foo%2Fbar` | `{ path: ["client","foo/bar"] }` |
| `?path=foo%2Fbar&path=client` | `{ path: ["foo/bar","client"] }` |
| `?path[a]=1&path=foo%2Fbar` | `{ path: [{a:"1"},"foo/bar"] }` |

Deleting the key (a) destroys a legitimate client value, (b) cannot tell which array element Vercel added, and (c) leaves `req.url`/`req.originalUrl` still containing the injected parameter. Express's query parser (`qs`, extended) is installed at app entry, so any normalisation must happen on `req.url` **before** the request reaches Express.

### 7.5 Recommended solution (INFERRED; must be verified in Preview)

1. **Rename the rewrite parameter to a reserved name**, e.g. `source: "/api/:__ironlog_api_path*"`. Vercel then injects `__ironlog_api_path=…` instead of `path`, so a client's own `path` parameter is never touched or confused. (Parameter names in this syntax are word characters; underscores are valid. UNVERIFIED on Vercel until tested.)
2. In the Vercel entry point, **before** `app(req, res)`: parse `req.url`, remove **every** occurrence of the reserved key (a client cannot meaningfully use it, so removal of all occurrences is safe and deterministic), and write the cleaned URL back to `req.url`. Express then sets `req.originalUrl` from the clean value, so `req.query`, `req.originalUrl`, logs and any future signature logic all see only client-sent parameters. Preserve the order, encoding and duplicates of all other parameters; do not re-encode unrelated values.
3. Add a **tripwire test**: any new `req.query`/`req.originalUrl` reader in `src/server` fails CI unless it is written against the normalised URL.
4. Ordering requirement: normalisation precedes everything (request ID, helmet, CORS, limiters, auth, body parse, validation, quota). It is a pure string transform with no I/O and cannot affect the security pipeline's decisions.

**Alternatives considered**

| Alternative | Assessment |
|---|---|
| Leave the parameter in place (nothing reads it today) | Works today (CONFIRMED) but leaves a hazard for future routes/logging. Acceptable only as a fallback. |
| Optional catch-all `api/[[...path]].ts` | Stage 1 showed `[...path]` matched only single-segment paths in this project. `[[...path]]` was not tested. UNVERIFIED; cheap to try in a Preview sub-spike. |
| Unnamed capture group (`/api/(.*)`) | Vercel's handling of unnamed groups in the query is undocumented here. UNVERIFIED. |
| Legacy `routes` block | Disables the newer routing features and risks the static frontend. Not recommended. |
| Per-route explicit rewrites | 17 rules, same injection behaviour for any named param. No benefit. |

**Preview probes required (Stage 4):** reserved key injected on single- and multi-segment paths; client `path` and client reserved key sent together with the rewrite (order and duplication); `/api` exact; encoded slash in a barcode (`%2F`); very long paths.

---

## 8. Redis and rate-limit findings

| Question | Finding | Label |
|---|---|---|
| Client and version | `redis` **6.3.0** (`@redis/client` 6.3.0), pinned exactly | CONFIRMED |
| URL format | `redis://` or `rediss://` only (config rejects other schemes). Production default store is Redis; `REDIS_URL` required. Plain `redis://` to a non-local host only warns. | CONFIRMED |
| TLS | node-redis enables TLS from the `rediss:` scheme; a `tls` option that contradicts the scheme throws. Upstash requires TLS. | CONFIRMED (source) / DOCUMENTED (Upstash) |
| Commands used | `INCR`, `PTTL`, `PEXPIRE`, `GET` inside two Lua scripts via `defineScript` (EVALSHA, falling back to EVAL on `NOSCRIPT`), plus `PING`. node-redis also pipelines `CLIENT SETINFO` on connect and **ignores failures** of it. | CONFIRMED |
| Upstash support for the above | `EVAL`/`EVALSHA` documented as supported; TCP URL shape `rediss://default:<password>@<endpoint>:6379`; TLS cannot be disabled; node-redis documented as working via the TCP URL. Not tested with node-redis 6.3.0 specifically. | DOCUMENTED; UNVERIFIED for this version |
| REST URL vs TCP URL | **Not interchangeable.** The REST URL (`https://…`) plus token is for `@upstash/redis`. Giving it to `REDIS_URL` fails config validation (`must start with redis:// or rediss://`). Using REST would require a new `RateStore` implementation. | CONFIRMED |
| Connection timeouts | connect 2 s; per-command 500 ms via `Promise.race`; `disableOfflineQueue: true` (commands fail immediately when not ready). | CONFIRMED |
| Reconnect | Unbounded capped exponential back-off (≤ 2 s) plus jitter; `error` listener attached (no crash). | CONFIRMED |
| Keep-alive / stale sockets | node-redis TCP/TLS keep-alive defaults to **on with a 30 s initial delay**. A `pingInterval` client option exists in 6.3.0 but is **not configured**. After an instance resumes from suspension, a dead socket is detected only on error or command timeout, so the first request can get one `503 rate_limit_unavailable`. (Resolves the Stage 0 "unverified" note C-09 on keep-alive defaults.) | CONFIRMED (source); resume behaviour UNVERIFIED |
| Concurrent initialisation | None guarded (S-11). | CONFIRMED |
| Per-instance vs shared | All counters live in Redis; atomic via one Lua script; window length enforced by Redis TTL (clock-skew immune). Memory store only if `RATE_LIMIT_STORE=memory` is explicit. | CONFIRMED |
| Key construction | `<prefix>:rl:<label>:<sha256-base64url[0..32]>`; raw IPs/user IDs are never stored. Prefix default `ironlog`, validated `^[A-Za-z0-9_.-]{1,40}$`. **The prefix is not exposed through any environment variable** (`runtime.ts` constructs `new RedisRateStore({ url })`). | CONFIRMED |
| IP identification | `req.ip` with `trust proxy` = `TRUST_PROXY`. Only an all-digit value is honoured; `true` or anything else becomes `false`. Must be exactly `1` on Vercel (Vercel overwrites `X-Forwarded-For`; DOCUMENTED, Stage 0). | CONFIRMED (parsing); DOCUMENTED (Vercel) |
| Failure policy | Default **closed**: `RateStoreUnavailableError` → `503 rate_limit_unavailable` + `Retry-After: 5`. `degraded` is explicit opt-in and never applies to the three always-closed routes. Health's IP limiter fails open. No silent memory fallback exists. | CONFIRMED |
| Reliability inside Vercel Functions | Feasible on Fluid compute (global-scope reuse), provided Stage 3 adds single-flight readiness, retry-after-failure, and a keep-alive/ping decision. TCP connection counts grow with instance count; Upstash's own guidance prefers REST for serverless, so **connection limits of the chosen Upstash plan must be confirmed**. | INFERRED; plan limits UNVERIFIED |

### 8.1 Exact `REDIS_URL` requirement

`rediss://<user>:<password>@<host>:<port>` copied from the Upstash console **TCP** tab (shape `rediss://default:<password>@<endpoint>:6379`). Mark as a secret. Never prefix with `VITE_`. Never paste it into chat or commit it. A password containing URL-special characters must be percent-encoded.

### 8.2 Preview vs Production Redis isolation plan

| Option | Description | Verdict |
|---|---|---|
| **R1 (recommended)** | Two separate Upstash databases. Production database's URL set only in Vercel's **Production** scope; Preview database's URL only in the **Preview** scope. No code change. | Safest; counters cannot mix |
| R2 | One database with different key prefixes. Requires a new env-driven prefix (code change to `runtime.ts`; new variable name needs approval). | Optional hardening only |
| R3 | No `REDIS_URL` in Preview, so the API fails closed on Preview | Safe but untestable |

Rules: never reuse the Production URL in Preview; never test with production counters; create neither database during Stage 2.

### 8.3 What Stage 4 must test for Redis

Cold start with healthy Redis; Redis unreachable at cold start (503, then recovery without redeploy); Redis dies mid-traffic (503 `rate_limit_unavailable`; health stays 200; always-closed routes never degrade); reconnect after outage; instance idle for several minutes then reused (stale socket); rate-limit threshold exactness (`RateLimit-*` headers; request N+1 → 429); concurrent bursts across instances (aggregate allowed count ≈ limit); `TRUST_PROXY=1` with two different client networks; spoofed `X-Forwarded-For` has no effect; existing `redisRateStore.integration.test.ts` and `redisApp.integration.test.ts` run against the **Preview** database with `REQUIRE_REDIS_TESTS=1`; Upstash command latency vs the 500 ms command timeout (UNVERIFIED: a cross-region Redis could cause spurious 503s).

---

## 9. Supabase authentication and quota findings

| Question | Finding | Label |
|---|---|---|
| JWT verification | `supabase.auth.getUser(token)` per request, using the publishable key; Supabase Auth validates signature, expiry and revocation. A cached lazily created client holds no user state. Retryable errors/5xx → `503 auth_unavailable`; otherwise `401 invalid_token`. Cheap pre-checks: Bearer regex, max 4096 chars, three segments, local `exp` check. | CONFIRMED |
| How the frontend gets tokens | `apiFetch.ts`: `supabase.auth.getSession()` (refreshes an expired access token); the token is attached only to the API origin; relative `/api/...` when `VITE_API_BASE_URL` is unset. | CONFIRMED |
| Token refresh | On a 401, `refreshSession()` once, then one retry, only if the body is replayable (string/`URLSearchParams`/none). All current callers send string bodies. No automatic retry on 503/413. | CONFIRMED |
| Server-state dependency | None beyond Redis lockout counters. The token is stored in a request-keyed `WeakMap`. | CONFIRMED |
| Quota RPC authentication | `consume_ai_quota(p_bucket, p_limit)` called with a client carrying `Authorization: Bearer <caller JWT>`; the SQL function is `SECURITY DEFINER`, uses `auth.uid()`, execute granted to `authenticated` only, table has no policies and all privileges revoked. | CONFIRMED (client code and migration SQL) |
| Runs on the user's JWT? | **Yes.** No service-role key is used by the server. `SUPABASE_SERVICE_ROLE_KEY` appears only in offline `scripts/video-library/*`. It must never be added to Vercel. | CONFIRMED |
| Errors and timeouts | 3 s `AbortSignal` timeout; every failure becomes `QuotaStoreUnavailableError` with a fixed-vocabulary reason; mapped to `503 quota_unavailable` + `Retry-After: 5`. | CONFIRMED |
| Fail-closed | Default `QUOTA_FAILURE_POLICY=closed`: no Gemini call is made if the quota cannot be consumed. `degraded` is explicit and never applies to the three always-closed buckets. | CONFIRMED |
| Concurrency bypass | The upsert (`ON CONFLICT … DO UPDATE`) serialises concurrent callers on the row lock; the per-endpoint Redis limiter is a single Lua script. **Not found:** a way to exceed a limit by concurrency. Minor non-atomic spot: the failed-auth lockout does `peek` then later `hit`, so a burst can overshoot the lockout threshold slightly (accuracy, not a bypass of auth). | CONFIRMED / INFERRED |
| Quota counted before success | Quota is consumed before the handler; a failed Gemini call still counts. Pre-existing behaviour, unchanged. | CONFIRMED |
| Migration drift | Repo files: `20261031000000_ai_usage_quota.sql`, `20261103000000_ai_quota_bucket_allowlist.sql`. The Stage 0 audit (read-only `list_migrations`) found the live project has both under different version numbers (`20261102045148`, `20261103061647`) **plus** `revoke_rls_auto_enable_execute` (`20261102082840`) with **no file in the repo**. The `.env.example` and docs still cite `20261031000000`. Not re-verified here (the live project was deliberately not contacted). Reconcile before any `db push`. | DOCUMENTED |

**Preview consequence (owner decision):** there is one Supabase project. A Preview API that uses Supabase quotas writes counters into the **production** `ai_usage_counters` table for whoever calls it. Use a dedicated test account only; never real user data; run `npm run verify:quota` with that account's credentials typed into your own shell. A separate Supabase project for Preview is the only full isolation and is out of scope.

---

## 10. Payload and Vercel limit analysis

### 10.1 Platform limits

| Limit | Value | Label |
|---|---|---|
| Request and response body | **4.5 MB**; larger → `413 FUNCTION_PAYLOAD_TOO_LARGE` before Express runs (non-JSON platform error) | DOCUMENTED (Vercel Functions limits page, last updated 2026-02-24; Vercel KB) |
| Bundle size | 250 MB uncompressed (enforced by AWS) | DOCUMENTED |
| Memory | Hobby up to 2 GB, Pro/Enterprise up to 4 GB | DOCUMENTED |
| Duration | Pages disagree by mode. With Fluid compute: default 300 s, max 300 s (Hobby) / 800 s (Pro, Enterprise). Without Fluid: Hobby 10 s default / 60 s max, Pro 15 s / 300 s. A `504 FUNCTION_INVOCATION_TIMEOUT` is returned on overrun. | DOCUMENTED (conflicting by mode; plan tier and Fluid status UNVERIFIED) |
| **Conflict** | One third-party summary of a Vercel agent skill claims 5 GB packages and 100 MB request bodies on Fluid. The official limits page still states 4.5 MB / 250 MB. **Treat 4.5 MB as binding** until a Preview test with a 5 MB POST says otherwise. | UNVERIFIED |

### 10.2 Endpoint payloads

| Endpoint | Finding | Label |
|---|---|---|
| `extract-plan` | Parser limit 14 MB; decoded-file limit 10 MB (`MAX_FILE_BYTES`); base64 inflates by 4/3, so the platform's 4.5 MB cap rejects raw files above about **3.3 MB** (JSON envelope also counts). Allowed MIME types: PDF, PNG, JPEG, WebP, text, CSV. CSV/JSON plans are parsed in the browser and never sent. | CONFIRMED (code) / DOCUMENTED (limit) |
| `ai-recovery-insights` | Parser 4 MB (below the platform cap, so app 413 for 4.0–4.5 MB, platform 413 above). Body is `sessions` (schema cap 1,000 entries), `profile`, `activePlan`. Real production size is unmeasured. | CONFIRMED (limits); size UNVERIFIED |
| All others | ≤ 1 MB parser limits | CONFIRMED |
| Responses | Small structured JSON; none approach 4.5 MB. Gemini output is schema-checked and length-capped. | INFERRED |
| Streaming/long-running | None. | CONFIRMED |
| Client behaviour on platform errors | Callers do `await res.json()` inside try/catch; a non-JSON 413/504 falls into the catch and shows a generic message (`PlansUploadView` shows the error text in the success-false branch; recovery panel shows a local-model fallback message). No caller retries 413/504 automatically. | CONFIRMED (read of two callers); others INFERRED |
| Gemini inline data | A 10 MB file is ≈ 13.3 MB base64, within the documented 20 MB inline limit (Stage 0). | DOCUMENTED (not re-fetched) |

### 10.3 Large-upload design (recommendation, not implemented)

**Verdict: large file uploads require an architectural change only for files above ≈ 3.3 MB.** Typical text PDFs fit today; phone photos of printed plans often do not. Do not silently reduce the 10 MB limit.

If the owner wants to keep 10 MB (decision D-6), use **private Supabase Storage with the caller's own session**:

| Aspect | Design |
|---|---|
| Bucket | New migration (patch file, owner-approved): bucket `plan-uploads`, `public = false`, `file_size_limit` 10 MB, `allowed_mime_types` equal to `EXTRACT_MIME_TYPES`. Precedent: `20261027010100_exercise_videos_storage.sql` (private bucket, no public URLs). |
| Object path | `<auth.uid()>/<random-uuid>.<ext>`; first path segment must equal the caller's uid. |
| RLS on `storage.objects` | For role `authenticated`: INSERT, SELECT and DELETE where `bucket_id = 'plan-uploads'` and `(storage.foldername(name))[1] = auth.uid()::text`. No UPDATE, no `anon`, no policy for other users. (The existing video bucket has no client INSERT policy; this is new surface and needs RLS tests in PGlite following the `rls.*.test.ts` pattern.) |
| Upload authorisation | Browser uploads directly with its own Supabase session; the folder policy is the authorisation. Signed upload URLs are optional. |
| API change | `extract-plan` also accepts `storagePath` (validated `<uid>/<file>` equal to the caller's uid). The server **downloads with the caller's JWT** (RLS enforces ownership), re-runs the existing MIME, signature and 10 MB checks on the actual bytes, calls Gemini as today, then deletes the object in `finally`. |
| Validation | Do not trust the client-declared MIME: re-validate size and magic bytes server-side. The existing helpers (`base64DecodedLength`, signature sampling in `validation.ts`) already do this for base64. |
| Cleanup and expiry | Delete on completion and on failure paths; orphans (upload without API call) need a retention rule (owner choice: lazy cleanup on the user's next upload, or a scheduled job). Consider a per-user object ceiling. |
| Failure handling | Storage download failure → fixed-message 502/503 (no provider text); quota is still consumed at `extract-plan`, after upload; deletion failure is logged but does not fail the user's request. |
| Compatibility | Keep the `fileData` base64 path for small files so old clients and cached bundles keep working during rollout. |
| Open questions | Supabase's per-project global upload limit and whether standard (non-resumable) uploads are reliable at 10 MB on the owner's plan. UNVERIFIED; must be checked before committing to the design. |
| Privacy | Plans can be health-adjacent documents: private bucket, per-user folder, short retention, no public URLs, no logging of file names or content. |

Alternatives (client-side image downscale, Vercel Blob, chunked upload, browser→Gemini) are rejected or deferred as in the Stage 0 audit. Browser→Gemini would expose the API key and is rejected on security grounds.

---

## 11. Vercel architecture recommendation

### 11.1 Stage 1 assessment

| Item | Assessment |
|---|---|
| `api/index.ts` single entry + `/api/:path*` rewrite | Proven on Preview (Stage 1). Keep, with the parameter rename (§7.5). The `api/[...path].ts` catch-all failed for nested paths. |
| `api/_spike/app.ts` | Diagnostic only; delete before merge (D4). |
| `vercel.json` | One rewrite, no framework/build/output keys. Stage 3 adds `functions` config only. No SPA fallback, no broad rewrites, no static-site headers (separate later stage). |
| TypeScript and Node ESM | Stage 1 proved the **`.js` specifier** fixes the single hop `api/index.ts` → `./_spike/app.js`. The real server has 58 extensionless imports (S-03). |

### 11.2 Bundling decision (needs a short Stage 3 sub-spike)

| Option | Pros | Cons | Status |
|---|---|---|---|
| **B1: `.js` specifiers** in the 18 affected server-reachable files | Uses the mechanism Stage 1 proved; no build step | Mechanical edits to 18 files **including security modules** (reviewable, no logic change); also touches `src/utils/*` shared with the frontend | Fallback |
| **B2: esbuild pre-bundle** (existing `esbuild` devDependency) of `src/server/serverless/handler.ts` to one ESM file, packages external | Zero source edits; the experiment in §6.1 ran the real app this way | Adds a build step to the frontend's `npm run build` (a bundling failure fails the deploy, though Production is never replaced by a failed build); **unverified** whether a build-time generated file placed where Vercel's function discovery looks is picked up, and whether file tracing ships the external packages | **Preferred pending sub-spike** |
| B3: Vercel zero-config Express detection | none | Ignores `express.static`; requires changing framework preset; detects `server.ts` with side effects | Rejected (Stage 0) |

Sub-spike (Preview only, no secrets): the **real** `createApp` with an in-memory fake store (never in Production), measure function size and cold start, confirm `req.path`, and decide B1 vs B2.

### 11.3 Other platform choices

| Item | Recommendation | Label |
|---|---|---|
| Entry | `api/index.ts` default-exports the wrapper `(req,res)`; awaits `getApp()`; delegates to Express | CONFIRMED mechanism |
| `maxDuration` | Set explicitly (owner chooses; Stage 0 proposed 60 s as a placeholder), tuned from measured Gemini p95. Without per-call Gemini timeouts it is the only ceiling. | INFERRED; value is an owner decision |
| Memory | Default is ample (10 MB file → ~35 MB of buffers) | INFERRED |
| Region | Co-locate with Supabase and Redis. A request makes 4 Redis + 2 Supabase round trips before Gemini; default region is `iad1`. | DOCUMENTED (default); owner decision D-3 |
| Node version | Set `engines.node` (22.x or 24.x; owner decision D-5). The sandbox ran Node 22.22.2. Stage 0 documented Vercel's default as 24.x; not re-fetched. | DOCUMENTED / UNVERIFIED |
| Preview vs Production | Separate environment-variable scopes (§12 matrix); Preview Redis separate; Gemini Preview key recommended | — |
| CORS and origin | Frontend stays at `https://fitness1-five.vercel.app/`. Same-origin web requests pass because the CORS layer allows `Origin` host == `Host`; Preview origins therefore need no allow-list. `VITE_API_BASE_URL` stays **unset**. | CONFIRMED (code) |
| Deployment Protection | Previews are protected: smoke tests need `vercel curl`, a bypass token or a signed-in browser. | CONFIRMED (Stage 1) |
| SPA fallback / static headers / CSP | Out of scope. The SPA still receives no CSP/Permissions-Policy (pre-existing: headers are emitted only on API responses). | CONFIRMED |

---

## 12. Environment variable matrix

Names verified against `config.ts`, `logger.ts`, `server.ts`, `apiFetch.ts` and `.env.example`. No values are included. "Build" = inlined into the public client bundle (`VITE_*`); "Runtime" = read by the function at request time. `vite.config.ts` has no `define`, so non-`VITE_` names are never bundled (CONFIRMED).

| Variable | Build/Runtime | Public/Secret | Consumer | Preview needs | Production needs | Separate Preview value | Stage 1 |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Runtime | Public | `config.ts` (production defaults: Redis + Supabase stores, CSP/HSTS, no dev CORS origins), `logger.ts` | Yes: **set explicitly to `production`** (Vercel's Preview value is UNVERIFIED) | Yes | No (same value) | Unset (spike ignores env) |
| `SUPABASE_URL` | Runtime | Public | token verification, quota RPC (falls back to `VITE_SUPABASE_URL`) | Yes (or the `VITE_` fallback) | Yes | No (same project) | Unset |
| `SUPABASE_PUBLISHABLE_KEY` | Runtime | Not secret by design (publishable/anon; never a secret/service key) | same (fallbacks: `SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`) | Yes (or fallback) | Yes | No | Unset |
| `VITE_SUPABASE_URL` | Build | Public | browser Supabase client; server fallback | Yes (already set) | Yes (already set) | No | Already set |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build | Public (publishable) | browser client; server fallback | Yes | Yes | No | Already set |
| `GEMINI_API_KEY` | Runtime | **Secret** | all 15 Gemini routes, read per request | Yes for AI testing, **separate key recommended** | Yes | **Yes** | **Unset** |
| `REDIS_URL` | Runtime | **Secret** (embeds credentials) | `RedisRateStore` | Yes, **separate Preview database** | Yes, production database | **Yes (mandatory)** | **Unset** |
| `TRUST_PROXY` | Runtime | Public | `app.set('trust proxy')`; digits only | Yes: exactly `1` | Yes: exactly `1` | No | Unset |
| `CORS_ALLOWED_ORIGINS` | Runtime | Public | `cors.ts` extra origins | Not needed for same-origin web | Not needed for same-origin web | n/a | Unset |
| `APP_URL` | Runtime | Public | added to CORS list (ignored while placeholder `MY_APP_URL`) | Optional | Optional | n/a | Unset |
| `VITE_SITE_URL` | Build (+ read by server CORS) | Public | Supabase email-link origin; CORS list | Already set; keep | Already set | No | Already set |
| `CORS_ALLOW_CAPACITOR` | Runtime | Public | Capacitor origins (native only) | No | No (until native ships) | n/a | Unset |
| `RATE_LIMIT_STORE` | Runtime | Public | `redis` is the production default; `memory` must be explicit | Leave unset (so Redis is used) | Leave unset | No | Unset |
| `RATE_LIMIT_FAILURE_POLICY` | Runtime | Public | `closed` default | Leave unset | Leave unset | No | Unset |
| `QUOTA_STORE` | Runtime | Public | `supabase` is the production default | Leave unset | Leave unset | No | Unset |
| `QUOTA_FAILURE_POLICY` | Runtime | Public | `closed` default | Leave unset | Leave unset | No | Unset |
| `AI_QUOTA_OVERRIDES` | Runtime | Public | JSON per-bucket daily limits; malformed JSON falls back to defaults, never disables limits | Optional (e.g. low limits to cap Preview cost) | Optional | Yes if used | Unset |
| `AUTH_REQUIRE_VERIFIED_EMAIL` | Runtime | Public | `403 email_not_verified` when true | Optional | Optional (owner policy) | No | Unset |
| `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_USER_PER_MIN`, `AUTH_FAIL_MAX`, `AUTH_FAIL_WINDOW_SEC` | Runtime | Public | limit tuning (defaults 300 / 120 / 30 / 900) | Leave unset | Leave unset | No | Unset |
| `LOG_LEVEL` | Runtime | Public | logger threshold | Optional | Optional | No | Unset |
| `VITE_API_BASE_URL` | Build | Public | `apiFetch.ts` cross-origin base | **Leave unset** | **Leave unset** | n/a | Unset |
| `VITE_SUPABASE_ANON_KEY` | Build | Public | legacy alias | Only if already used | same | No | — |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Highest secret** | offline ingestion scripts only | **Must NOT be set** | **Must NOT be set** | n/a | Never |
| `APP_PORT`, `DISABLE_HMR`, `VITEST` | Local/test | Public | local server port; AI Studio HMR; test guard | Not on Vercel | Not on Vercel | n/a | — |
| `VERIFY_QUOTA_EMAIL/PASSWORD/JWT`, `REDIS_TEST_URL`, `PG_TEST_URL`, `REQUIRE_REDIS_TESTS`, `REQUIRE_PG_TESTS` | Local/CI only | Secret (where credentials) | `verify:quota` and integration tests | Local shell only | Local shell only | n/a | — |

Not variables today (do not invent): there is no Redis key-prefix variable; `PORT` is not read by the app.

**Rules:** Preview must never share Production Redis counters or use Production credentials for testing. Backend secrets are scoped per environment in the Vercel dashboard (owner action). Audit variable names before any promotion.

---

## 13. Stage 3 ordered implementation plan

**Do not start until explicitly approved.** Split into mandatory (M) and optional (O). Do not combine unrelated feature work with this migration.

### Stage 3A — mandatory core migration

**3.1 (M) Extract the real Express app into a side-effect-free module**
- Objective: make `createApp` importable without a listener, Redis, signals or `vite`.
- Files: new `src/server/app.ts` (verbatim move of `createApp`, `barcodeCache`, constants); `server.ts` (imports and re-exports `createApp`).
- Reason: S-01, S-02; keeps all existing test imports working.
- Depends on: none.
- Security: move only; no edit to pipeline order, limits, validation or messages. Review as a rename.
- Tests: the whole existing server suite unchanged and green (`security`, `routePolicy`, `quotaFailure`, `aiSchemas`, `clientRouteContract`, spike); add a test that importing `src/server/app.ts` creates no listener, handle or timer.
- Rollback: revert the commit (pure move).
- Acceptance: `tsc` clean; identical test results; `git diff -M` shows a move with no content change in route/handler bodies.

**3.2 (M) Preserve local development**
- Files: `server.ts` only (runner, Vite middleware, static + SPA fallback, signals, `dotenv.config()`).
- Depends on: 3.1.
- Tests: `startup.process.test.ts` and a manual `npm run dev` start; health reachable.
- Rollback: revert. Acceptance: `npm run dev`/`npm start` behave exactly as before.

**3.3 (M) Serverless initialisation layer, single-flight and retry**
- Files: new `src/server/serverless/getApp.ts` (+ test).
- Behaviour: memoise one in-flight promise per instance: `loadSecurityConfig()` → `prepareSecurityRuntime()` (Redis, readiness wait) → `createApp({ config, rateStore })`. On failure, do **not** cache the rejection permanently: respond fail-closed `503` JSON (`Retry-After`, request ID, no secrets), close any half-open Redis client, and permit a fresh attempt after a short cooldown so recovery needs no redeploy. Never fall back to the memory store; no `process.exit`; no signal handlers. Health returns 503 during init failure (so monitoring sees it), not a fake OK.
- Reason: S-10 to S-12.
- Security: this is the highest-risk new code. Optional guard: refuse to serve when running on Vercel with an effective memory rate store (new behaviour; needs approval).
- Tests: in-process with a fake Redis factory: cold start, one Redis client under 50–200 concurrent cold requests, Redis down at init → 503 then recovery, invalid config → 503 with no secret in body or logs, memory store never selected when `redis` configured.
- Rollback: revert; entry point still the spike. Acceptance: all tests above green.

**3.4 (M) Redis lifecycle hardening**
- Files: `src/server/security/redisRateStore.ts` (and, only if approved, `runtime.ts`).
- Change: decide and set a `pingInterval` (option exists in 6.3.0, unused); keep `disableOfflineQueue`, the 500 ms command timeout and fail-closed behaviour; document `REDIS_URL` shape.
- Reason: resume-after-suspend stale socket (§8).
- Security: touches a shared, well-tested security component; no weakening of failure semantics.
- Tests: existing `redisRateStore.integration.test.ts`, `redisApp.integration.test.ts` (real Redis, `REQUIRE_REDIS_TESTS=1`); new stale-socket and recovery tests using `redisTestHarness.ts`.
- Rollback: revert. Acceptance: all integration tests green; no change to 503/429 outcomes.

**3.5 (M) Rewrite normalisation**
- Files: new `src/server/serverless/normalizeUrl.ts` (+ test); `vercel.json` parameter rename (§7.5).
- Tests: unit tests over the §7.4 matrix, `/api` exact, encoding preservation, repeated reserved key, no change when the key is absent; tripwire test for `req.query` readers.
- Rollback: revert `vercel.json` rename; normaliser harmless if key absent. Acceptance: Preview probes pass (3.9).

**3.6 (M) Real Vercel entry point; remove the spike**
- Files: `api/index.ts` (wrapper: normalise → `getApp` → delegate; JSON 503 on init failure); delete `api/_spike/app.ts` and the spike test **before any merge** (D4).
- Security: no unauthenticated diagnostic route may remain.
- Tests: handler-level tests through a Node `http` server like the Stage 1 test; all existing route tests via the handler with fake stores.
- Rollback: restore the spike entry on the branch. Acceptance: no `__vercel_spike` string in the tree.

**3.7 (M) Bundling and Node ESM compatibility**
- Sub-spike first (Preview, fake in-memory store, no secrets): choose B2 (pre-bundle) or B1 (`.js` specifiers); record function size and cold start.
- Files: B2 → `scripts/bundle-api.mjs`, `package.json` build script; B1 → import specifiers in the 18 files.
- Tests: Preview boots; every route reachable; the bundle contains no `vite`.
- Rollback: revert build script (B2) or specifier commit (B1). Acceptance: function boots and size is well under the limit.

**3.8 (M) Function configuration**
- Files: `vercel.json` `functions` entry (`maxDuration`, and `regions` per D-3), `package.json` `engines.node` (D-5). No change to build command, output directory, framework preset, rewrites beyond 3.5, SPA fallback or headers.
- Rollback: revert; Acceptance: Preview build shows the chosen Node version and settings; `/`, manifest and icons unchanged.

**3.9 (M) Environment variable setup (owner actions in the Vercel dashboard)**
- Preview scope first: separate `REDIS_URL`, separate `GEMINI_API_KEY`, `TRUST_PROXY=1`, `NODE_ENV=production`, Supabase values. Production scope only after Preview passes. See §12. Never set `SUPABASE_SERVICE_ROLE_KEY`.

**3.10 (M) Preview verification**: execute the Stage 4 matrix (§14). Any security-control failure is a NO-GO; no workaround that weakens a control.

**3.11 (M) Production release and rollback**: §16.

### Stage 3B — large-upload path (separable, needs its own approval)

**3B.1** migration patch (bucket + RLS) → owner approves and applies; **3B.2** `validation.ts` accepts `storagePath`; **3B.3** `extract-plan` handler downloads with the caller's JWT, re-validates, deletes in `finally`; **3B.4** `PlansUploadView.tsx` uploads to Storage then calls the API (small files keep `fileData`); **3B.5** RLS tests (PGlite) + API tests + Preview tests at 3, 5 and 10 MB. Rollback: feature stays on the base64 path; revert client + API commits; bucket left unused. Acceptance: ownership enforced, cleanup verified, 10 MB succeeds.

### Optional improvements (not required for Stage 3A)

- Explicit Gemini per-call timeouts and a client message for platform 413/504 (behaviour change; needs approval).
- `AI_QUOTA_OVERRIDES` = 0 for the three routes with no caller.
- Env-driven Redis key prefix (R2) and a "refuse memory store on Vercel" guard.
- Update `.env.example` (TRUST_PROXY, Redis, NODE_ENV for Vercel; cites `20261031000000` while live differs) and commit the Production API Deployment Audit.
- Reconcile Supabase migration drift (`revoke_rls_auto_enable_execute`).
- Static-site security headers/CSP and SPA fallback (separate stage); fix the barcode `clearTimeout` leak.

---

## 14. Stage 4 test matrix

"Local" = runnable without Preview infrastructure. "Preview" = needs a Vercel Preview, separate Redis/Gemini, and a dedicated test account.

| # | Test | Where | Expected |
|---|---|---|---|
| 1 | Health | Local + Preview | 200 `{status:'ok',time}`; 503 JSON if init failed |
| 2 | Every one of the 17 routes (method × path × no auth / valid auth / over limit) | Local (fakes) + Preview | Policy table §5 holds; unknown `/api/*` → 401 unauthenticated, 404 authenticated |
| 3 | Unauthenticated request | Both | 401 `auth_required`, counted toward lockout |
| 4 | Invalid / forged JWT | Both | 401 `invalid_token` |
| 5 | Expired JWT | Both | 401 `token_expired` |
| 6 | Valid authenticated request | Preview | 200 (barcode, one AI route) |
| 7 | Token refresh via `apiFetch` | Local (`apiFetch.test.ts`) + Preview browser | one refresh and replay on 401; token only sent to API origin |
| 8 | CORS allowed origin / same-host Preview origin | Both | CORS headers present |
| 9 | CORS disallowed origin; preflight from foreign origin | Both | 403 `origin_not_allowed` |
| 10 | Rate-limit threshold (IP, user, endpoint) | Local (fake store) + Preview (real Redis) | request N+1 → 429 with `Retry-After`; `RateLimit-*` headers |
| 11 | Redis unavailable at cold start / mid-traffic | Local (harness) + Preview (pause or break Preview Redis only) | 503 `rate_limit_unavailable`; health 200 mid-traffic; always-closed routes never degrade |
| 12 | Redis reconnect | Both | recovers without redeploy |
| 13 | Stale socket after idle | Preview | at most one transient 503, then success |
| 14 | Quota exhaustion | Local (fake store) + Preview (`verify:quota` account) | 429 `quota_exceeded`, `X-Quota-*` headers, reset 00:00 UTC |
| 15 | Quota RPC failure | Local | 503 `quota_unavailable`; no Gemini call |
| 16 | Gemini provider failure / timeout | Local (stub) + Preview (limited real calls) | mapped fixed messages (502/503/504), no provider text |
| 17 | Invalid body (bad JSON, schema violation) | Both | 400 `invalid_json` / validation error |
| 18 | Oversized body (app limit; platform limit) | Local (app) + Preview | app 413 JSON at parser limit; 4.6 MB → platform 413 (note the response shape) |
| 19 | Large upload flow (1, 3, 4.4, 4.6 MB; 5 and 10 MB with 3B) | Preview | per §10 |
| 20 | Concurrent requests (50–200) across instances | Local (in-process) + Preview | one init; no duplicate Redis clients; aggregate allowed ≈ limit; quota never exceeded |
| 21 | Cold-start initialisation | Both | first request correct; one Redis client |
| 22 | Repeated warm invocations | Preview | no reconnects, stable latency |
| 23 | Function timeout | Preview | 504 platform error shape; client behaviour verified |
| 24 | Query-string preservation (`?a=1&b=2` reaches the route) | Local + Preview | unchanged after normalisation |
| 25 | Legitimate client `path` parameter | Local + Preview | preserved exactly, single value |
| 26 | Vercel-injected reserved parameter | Preview | stripped before Express; `req.originalUrl` clean |
| 27 | Client sends the reserved key itself, duplicated, or with `path` | Local + Preview | all reserved occurrences removed; `path` untouched |
| 28 | `/api` exact, `%2F` in barcode, long path | Preview | defined behaviour (401 / sanitised barcode / no crash) |
| 29 | Static frontend and manifest (`/`, `/manifest.webmanifest`, `/brand/icon-512.png`, unknown path) | Preview | unchanged from today; unknown path remains platform `NOT_FOUND` |
| 30 | Existing local data preservation (localStorage/IndexedDB on `fitness1-five.vercel.app`) | Preview/Production | origin unchanged; data intact |
| 31 | `TRUST_PROXY=1`: two networks give different limit keys; spoofed `X-Forwarded-For` ignored | Preview | per-IP buckets distinct |
| 32 | No secret, token or `REDIS_URL` in any response body or log | Preview log review | none |
| 33 | `startup.process.test.ts` and local `npm run dev` | Local | unchanged |
| 34 | Full vitest suite and the four infra-dependent tests (`REQUIRE_REDIS_TESTS=1`, `REQUIRE_PG_TESTS=1`) | Local with services / CI | green |
| 35 | Bundle: no `vite` in the function; size recorded | Preview build log | under limit with margin |

---

## 15. Risks, blockers and unresolved questions

### 15.1 Confirmed blockers (code), all resolved by Stage 3A

| ID | Blocker | Step |
|---|---|---|
| BL-1 | `server.ts` side effects on import (listener, Redis, signals, `process.exit`) | 3.1, 3.2 |
| BL-2 | Static `vite` import pulled into the function | 3.1, 3.7 |
| BL-3 | 58 extensionless imports in 18 files fail on Vercel ESM output | 3.7 |
| BL-4 | No serverless init layer (single-flight, readiness, retry, fail-closed 503) | 3.3 |

### 15.2 Platform / architecture constraints

| ID | Item | Treatment |
|---|---|---|
| C-1 | 4.5 MB body cap vs `extract-plan` (> ≈ 3.3 MB files) | Stage 3B or an owner-approved visible limitation |
| C-2 | Injected rewrite parameter | §7.5 (verify in Preview) |
| C-3 | `ai-recovery-insights` real payload unmeasured | measure before relying on the 4 MB cap |

### 15.3 Risks

| Sev | ID | Risk | Mitigation |
|---|---|---|---|
| Critical | R-1 | `TRUST_PROXY` not exactly `1` → all users share one IP bucket and one lockout bucket | set `1`; two-network Preview test (#31) |
| Critical | R-2 | Init that fails open, falls back to memory stores, or caches a failure forever | step 3.3 contract and tests |
| Critical | R-3 | Service-role or secret key placed in Vercel or a `VITE_*` variable | never set; review variable names before promotion |
| High | R-4 | Preview using Production Redis/Gemini/quotas | R1 isolation; separate Gemini key; test account only |
| High | R-5 | Upstash connection limits and cross-region latency vs the 500 ms command timeout (spurious 503s) | confirm plan limits; co-locate regions; measure |
| High | R-6 | Bundling path (B2) not yet proven for discovery/tracing | sub-spike in 3.7 |
| High | R-7 | Duration and plan limits unknown (plan tier, Fluid status) | owner confirms D-2; set `maxDuration` explicitly |
| Medium | R-8 | Platform 413/504 responses are not the app's JSON shape | verify each caller; optional client message |
| Medium | R-9 | Coupled deployments; a bad `vercel.json` can affect the live frontend | Preview diff of `/`, manifest, icons, unknown path; instant rollback |
| Medium | R-10 | Spike endpoints reaching Production | step 3.6 deletion; grep gate |
| Low | R-11 | Per-instance barcode cache; NAT users sharing a lockout bucket; quota counted on failed Gemini calls | accepted, pre-existing |
| Low | R-12 | Supabase migration drift | reconcile before the next `db push` |

### 15.4 Unresolved questions / owner actions

1. Stage 1 owner checks (§3), including commit `9fb746b` (D1).
2. **D-2** Vercel plan tier and Fluid compute status. **D-3** function region and Supabase region. **D-5** Node version policy.
3. **D-4** Redis provider confirmation and plan limits; create the two Upstash databases (not done in Stage 2).
4. **D-6** Large uploads: implement 3B, accept an approved limitation, or defer.
5. **D-7** Preview policy and a separate Gemini key; **D-9** Gemini billing/limits and accepted `maxDuration`.
6. Create a dedicated Supabase test account for Preview/`verify:quota`.
7. Approve the §13 plan (**D-8**) and the bundling choice after the 3.7 sub-spike.

---

## 16. Rollback and production safety strategy

**Release path.** (1) Stage 3A on a branch; Preview deployments are created automatically. (2) Run the §14 matrix against Preview with Preview-scoped variables. (3) Review and explicit approval. (4) Set Production-scoped variables. (5) Merge. (6) Verify `/`, `/manifest.webmanifest`, `/brand/icon-512.png`, `/api/health`, then one signed-in AI call with a test account. (7) Monitor `rate_limit_unavailable`, `quota_unavailable`, `auth_unavailable` and 5xx for the first days.

**Rollback.**
- A failed build is never promoted; Production stays on the last good deployment.
- Bad deployment: Vercel instant rollback to the previous Production deployment (frontend and API revert together). The pre-migration state is today's behaviour (`/api` returns platform 404), so rollback cannot be worse than now.
- Configuration problems: correct or remove the offending environment variable and redeploy.
- Redis problems: a failed Redis returns fail-closed 503, never open; do **not** set `RATE_LIMIT_STORE=memory` or `RATE_LIMIT_FAILURE_POLICY=degraded` as an emergency measure without an explicit owner decision (it multiplies limits by instance count).
- Stage 3B rollback independent of 3A: base64 path remains the default.

**Safety rules.** No branch merges to `main` without Preview passing; Production variables set only after Preview passes; no real user data in tests; `VITE_API_BASE_URL` stays unset; `SUPABASE_SERVICE_ROLE_KEY` never in Vercel.

---

## 17. Final readiness recommendation

**READY FOR STAGE 3**, conditional on the owner actions in §15.4 before any Preview deployment.

- The existing backend **can be migrated safely**: all security controls are preserved by reusing `createApp` unchanged; confirmed blockers are mechanical (entry point, `vite` import, ESM specifiers, init layer).
- **Upstash Redis:** expected compatible via its TCP/TLS `rediss://` URL; the REST URL is not compatible. Must be proven in Preview.
- **Rewrite-injected `path`:** has a safe solution (reserved parameter name plus pre-Express normalisation); currently harmless to the code (CONFIRMED) but must be handled before real traffic.
- **Large uploads:** need an architectural change (Supabase Storage, Stage 3B) only for files above ≈ 3.3 MB; everything else fits.
- **Preview infrastructure required before Preview testing (Stage 3.10 / Stage 4):** a separate Upstash Redis database for Preview; a separate Preview Gemini key (recommended); Preview-scoped Vercel variables (`NODE_ENV`, `TRUST_PROXY=1`, Supabase values, `REDIS_URL`, `GEMINI_API_KEY`); a dedicated Supabase test account; a way to call protected Previews (`vercel curl` or bypass).
- **Not required** for Stage 3 steps 3.1–3.6: any external service.

**Stop after Stage 2. No application code, configuration, dependency, infrastructure or Vercel setting has been changed. Awaiting explicit approval before Stage 3.**

---

### Sources

- Vercel, Rewrites (`/resize/800/600` → `/api/sharp?width=800&height=600`; named parameters become query parameters): https://vercel.com/docs/routing/rewrites
- Vercel, Functions Limits (4.5 MB body, 250 MB bundle, memory, duration by mode): https://vercel.com/docs/functions/limitations; KB: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Upstash, node-redis over the TCP `rediss://` URL, TLS mandatory, EVAL/EVALSHA: https://upstash.com/docs/redis/integrations/effect-mq.md, https://upstash.com/docs/redis/howto/redis-cli.md, https://upstash.com/docs/redis/commands/scripting/eval.md, https://upstash.com/docs/redis/commands/scripting/evalsha.md
- Repository (this audit's commit base `ac38877`): `server.ts`, `src/server/security/*`, `src/lib/apiFetch.ts`, `supabase/migrations/*`, `docs/security/*`, `api/*`, `vercel.json`, `package.json`, `.env.example`, `node_modules/@redis/client` 6.3.0 source
- Carried forward from Stage 0 and **not** re-fetched in this stage: Vercel Node version defaults, `X-Forwarded-For` overwrite, Fluid compute defaults, Supabase Storage signed-upload behaviour, Gemini inline-data limit
