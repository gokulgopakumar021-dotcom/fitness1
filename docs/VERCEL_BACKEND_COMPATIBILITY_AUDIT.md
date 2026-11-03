# IRONLOG AI — Vercel-Native Backend Compatibility Audit

**Stage 0 — AUDIT ONLY. No code, configuration, dependency, migration, environment variable, deployment or commit was changed.**

- **Date:** 2026-11-03
- **Repository:** `gokulgopakumar021-dotcom/fitness1`, default branch, commit `79a3dd0` ("il07-web-session-token-tripwire"), shallow clone inspected directly
- **Frontend (production):** `https://fitness1-five.vercel.app/` (Vite preset, `npm run build`, output `dist`; `VITE_API_BASE_URL` not set — owner-reported)
- **Supabase project inspected read-only:** `list_migrations` only (names), nothing applied
- **Relationship to the earlier report:** this document supersedes the Option B discussion in `PRODUCTION_API_DEPLOYMENT_AUDIT.md`. That report assumed a long-running host was acceptable; this one answers the narrower question "can it be Vercel-only, and at what cost?"

---

## 0. Evidence base and limits of this audit

| Area | Status |
|---|---|
| `server.ts` (1,719 lines), all 17 route registrations, `createApp()`, `startServer()` | **Read** |
| `src/server/security/*` (config, auth, cors, headers, rateLimit, redisRateStore, quota, runtime, endpoints, validation, errors, logger, requestContext, jsonBody) | **Read** |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.env.example`, `capacitor.config.ts`, client call sites, `PlansUploadView.tsx` | **Read** |
| Existing tests (inventory, what they import and exercise) | **Inventoried; not executed** (installing dependencies is forbidden) |
| Vercel limits, Express support, Node versions, forwarded-IP behaviour, monorepo behaviour, connection reuse | **Checked against current Vercel documentation** (Sources, §17) |
| Supabase Storage signed-upload behaviour, Gemini inline-data limit | **Checked against vendor documentation**; one source conflicts (see §8) |
| Behaviour of this code on Vercel at runtime (module resolution, `req.url` under catch-all routing, bundle size, TypeScript 7 compatibility, real client IP seen by Express) | **NOT TESTED.** These are the questions the Stage 1 spike must answer. Each is labelled "unverified" below |
| Vercel project settings, plan tier, Supabase region, Redis provider | **Unknown** (no Vercel connector; owner decisions in §16) |

"Inferred" or "unverified" means a deduction from code and documentation, not an observation of a running deployment.

---

## 1. Executive summary

1. **Can the existing backend realistically run on Vercel? Yes, but not as-is.** The Express application is already well factored for it (`createApp(deps)` is exported, synchronous, and takes injectable stores), and every protection except one is stateless or externally stored (Supabase auth, Supabase quota RPC, Redis rate limits). What blocks a naive deployment is the **process entry point**, not the application.
2. **Four code-level blockers** (§5): (a) importing `server.ts` auto-runs `startServer()`, which connects Redis, calls `app.listen()`, registers signal handlers and may `process.exit(1)`; (b) `server.ts` statically imports `vite`; (c) the project is ESM (`"type": "module"`) with extensionless relative imports, which community reports show failing at runtime on Vercel unless the code is pre-bundled (unverified for this repo); (d) the Redis store starts connecting in the background and refuses commands until ready, so a serverless cold start needs an explicit, single-flight "wait until ready" step that does not exist today.
3. **One unavoidable platform limit:** Vercel Functions cap request bodies at **4.5 MB**. `POST /api/extract-plan` accepts files up to 10 MB decoded (about 13.3 MB base64). On Vercel as-is, **files larger than roughly 3.3 MB would be rejected before Express runs**, with a non-JSON platform 413. Typical text PDFs fit; phone photos of a printed plan often do not. Preserving the 10 MB capability requires a direct-to-Supabase-Storage upload path (§8), which needs a new bucket migration and a client change. All other routes fit.
4. **Security can be preserved without weakening anything**, provided the serverless init path fails closed, `TRUST_PROXY=1` is set (Vercel documents that it overwrites `X-Forwarded-For` with the client IP), Redis is an external managed instance, and no service-role key is ever placed in Vercel (§6).
5. **Recommended architecture: Option 2, the same Vercel project with a Vercel-compatible `api/` function** (§3, §4). It keeps the frontend URL, makes the API same-origin (no `VITE_API_BASE_URL`, no CORS configuration, and Preview deployments work automatically), and requires no change to the frontend code.
6. **This deviates from your stated preference for a separate project.** The reason is concrete: two Vercel projects that point at the *same Root Directory* read the *same* `vercel.json` and see the *same* `api/` folder, so the "separate" project is not actually isolated (§4, Option 1). A truly isolated separate project needs a subdirectory root with its own dependency manifest or a workspace restructure. That is a larger change and is offered as a deliberate alternative, not the default.
7. **Estimated complexity:** Medium-High for the minimum path (about 6 source files touched or added, 1 spike, 1 Redis hardening, new test files), plus Medium for the large-upload path if you want to keep the 10 MB limit. No change to endpoint behaviour, quotas, or validation is required by the minimum path.

---

## 2. Current architecture (verified from source)

**Frontend.** React 19 + Vite 8 SPA, state-based navigation (no router), Supabase Auth used directly from the browser, fitness data in per-origin browser storage. All Express calls go through `src/lib/apiFetch.ts`, which uses relative `/api/...` URLs unless `VITE_API_BASE_URL` is set, and attaches the Supabase bearer token only to the API origin.

**Backend.** One Express app, 17 routes (15 Gemini, 1 barcode proxy to Open Food Facts, 1 health).

| Layer (in order) | Source | State it keeps |
|---|---|---|
| Request ID | `requestContext.ts` | none (per request) |
| Security headers (helmet, Permissions-Policy, `no-store` on API) | `headers.ts` | none |
| CORS allow-list (same-host requests allowed without configuration) | `cors.ts` | none |
| Per-IP rate limit (default 300/min) | `rateLimit.ts` + store | **Redis** (or memory if explicitly chosen) |
| Authentication (`Authorization: Bearer`, Supabase `auth.getUser`), failed-auth lockout (30 failures / 15 min / IP) | `auth.ts` | lockout counters in the rate store; per-request token in a `WeakMap` |
| Per-user rate limit (default 120/min) | `rateLimit.ts` | Redis |
| Endpoint policy (unknown path ⇒ 404) and per-endpoint limit | `endpoints.ts` | Redis |
| Route-specific JSON parser, limits 64 KB to 14 MB | `jsonBody.ts` | parser cache (a `Map`, per app) |
| Schema validation | `validation.ts` | none |
| Daily AI quota (Supabase RPC `consume_ai_quota` with the caller's JWT) | `quota.ts` | **Supabase Postgres** |
| Route handler | `server.ts` | `barcodeCache` (module-level `Map`, max 500 entries, 24 h TTL) |
| Error tail (JSON 404 for unknown `/api/*`, terminal handler) | `errors.ts` | none |

**Process model today.** `server.ts` defines `createApp(deps)` and, unless `VITEST` is set, runs `startServer()`: load config, connect Redis (exit on failure), build the app, serve `dist/` and a SPA fallback in production (or Vite middleware in dev), `listen` on `--port` / `APP_PORT` / 3000, SIGTERM/SIGINT shutdown. Local development (`npm run dev` / `npm start` = `tsx server.ts`) must keep working.

---

## 3. Recommended Vercel architecture

**Option 2: one Vercel project, static frontend unchanged, plus a function under `api/`.**

```
Browser (https://fitness1-five.vercel.app)
   ├── static files (dist/) ───────────► Vercel CDN            (unchanged)
   ├── auth / profiles / videos ───────► Supabase (direct)     (unchanged)
   └── /api/*  (same origin) ──────────► Vercel Function (Node, Fluid compute)
                                           └── Express app via createApp() (single warm instance reused)
                                                 ├── Supabase Auth (getUser) + RPC consume_ai_quota
                                                 ├── External Redis (rediss://) for rate limits
                                                 ├── Gemini
                                                 └── Open Food Facts
```

Why this is the smallest safe change for this codebase:

1. **Frontend code and URL are untouched.** `apiFetch` already calls same-origin `/api/...` when `VITE_API_BASE_URL` is unset, and that is exactly today's production setting. The 404s become real answers with no frontend edit.
2. **No CORS surface to get wrong.** The CORS middleware already allows requests whose `Origin` host equals the request `Host` (Vercel documents that `host` is the domain the client used). Preview deployments get their own working API on their own origin with no allow-list entries.
3. **No new project, domain, or secret copy.** The frontend project's Build/Output settings and Vite preset are not changed (expected to coexist with `api/`; confirm in the spike).
4. **Native path stays open.** A later Capacitor build sets `VITE_API_BASE_URL=https://fitness1-five.vercel.app` plus `CORS_ALLOW_CAPACITOR`, both already supported.
5. **Atomic deploys.** Frontend and API ship together, so the client/server route contract (`clientRouteContract.test.ts`) cannot drift between two deployments.
6. **Reversible.** A failed build is not promoted (production stays on the last good deployment); removing `api/` restores today's behaviour.

The trade-offs (coupled deployments, backend secrets living in the same project as the frontend, Preview exposure) are real and are handled in §4 and §14.

---

## 4. Comparison of the three options

### Option 1 — Separate Vercel project for the backend, same GitHub repository

| Aspect | Detail |
|---|---|
| Required files/config | A second Vercel project connected to the same repo. Vercel's monorepo guidance: each project has its own **Root Directory**, and each root can hold its own `vercel.json`. A push to a repo connected to several projects creates a deployment for **each**, built in parallel |
| **Problem if Root Directory = repo root (the simplest setup)** | Both projects read the **same** `vercel.json` and see the **same** `api/` directory. The frontend project would also deploy the function, and any `vercel.json` rewrite or header intended for the API applies to the frontend. The two projects are not isolated. (Dashboard settings such as framework preset and build command *can* differ per project, but file-based config cannot.) |
| Isolated variant | Root Directory = new subfolder (for example `backend/`) with its own `vercel.json` and `api/`. Vercel's "include source files outside of the Root Directory" option is enabled by default on projects created after August 2020, so imports from `../src/server/...` can resolve in the build step. However, dependency installation happens for the root directory: the subfolder needs its **own `package.json`** (duplicated dependency list for express, helmet, redis, `@supabase/supabase-js`, `@google/genai`, dotenv) or the repo must become an npm workspace. Unverified for this repo |
| How API routes resolve | The backend project would serve `/api/*` on its own domain, so the frontend needs `VITE_API_BASE_URL` (a build-time variable, redeploy required) and the API needs `CORS_ALLOWED_ORIGINS` for the frontend origin (and every Preview origin that should work) |
| Frontend assets | Unaffected in the isolated variant |
| Separate environment variables | Yes (the main advantage): backend secrets live only in the backend project |
| Advantages | Strongest blast-radius isolation and secret isolation; independent deploy cadence |
| Disadvantages | Cross-origin (CORS preflight, allow-list maintenance, CSP `connect-src` if a CSP is later added to the static site); the frontend must change (env var plus rebuild); Preview frontends cannot reach the API without extra CORS entries; duplicated manifest or workspace restructure; two deployments per push |
| Risk | Medium-High (structure) — mostly configuration and dependency-drift risk rather than runtime risk |

### Option 2 — Same Vercel project, `api/` directory (recommended)

| Aspect | Detail |
|---|---|
| Required files/config | `api/[...path].ts` (new; catch-all so `/api/health`, `/api/nutrition/barcode/123`, `/api/adaptive-coach/explain` all reach it); small `vercel.json` (function `maxDuration`, region); a side-effect-free server entry (§10) |
| Build/deploy | The existing Vite build is unchanged. Vercel detects `api/` and builds the function alongside the static output. If bundling is needed (§5, C-04), a post-build bundling step is added to the existing build |
| How API routes resolve | `/api/*` is matched by the catch-all function; everything else is static. **Unverified:** that Express sees the *original* request path in `req.url` under catch-all routing. The spike must prove it; if not, a rewrite to a single `api/index` function is the fallback |
| Frontend assets | Unaffected (same CDN, same headers as today) |
| Separate environment variables | Not separate. Backend secrets live in the frontend project. They are not bundled into the client (only `VITE_`-prefixed names are, and `vite.config.ts` has no `define`), but Preview deployments must be scoped deliberately (§9, R-07) |
| Advantages | Smallest change; frontend untouched; same-origin; no CORS config; Previews work; atomic deploys; one project to operate |
| Disadvantages | Coupled deployments (a broken `api/` build blocks the frontend from deploying; production is not replaced by a failed build, so this is a delay, not an outage); secrets share a project; `vercel.json` is now a file whose mistakes can affect the live frontend (mitigated by Preview testing) |
| Risk | Medium |

### Option 3 — Single deployment using Express framework detection

| Aspect | Detail |
|---|---|
| Required files/config | Change the project's framework preset away from Vite. Vercel's zero-config Express detection looks for `app`/`index`/`server` files at the root or `src/`. `server.ts` exists at the root |
| Behaviour | The whole Express app becomes **one Vercel Function**. Vercel documents that `express.static()` is **ignored** and static files must live in `public/**`, and that its bundling "does not perform application bundling" |
| Why it is poor here | The SPA is built to `dist/`, not `public/`; the existing frontend project would have to change preset and output settings, which contradicts "frontend must remain operational". `server.ts` would be detected *with* its startup side effects. The `vite` import and `tsx` start script remain problems. Highest regression risk to the working frontend |
| Risk | High. **Not recommended** |

### Recommendation

**Option 2.** If isolation outweighs simplicity for you, choose Option 1 in its isolated (subfolder-root) variant, accepting the manifest/workspace work. Do not choose Option 3. Decision recorded in §16 (D-1).

---

## 5. Exact compatibility issues in the current code

| ID | File / lines | Finding | Consequence on Vercel | Status |
|---|---|---|---|---|
| **C-01** | `server.ts` ~1681–1719 (`startServer`, auto-run guard) | Auto-runs unless `VITEST` is set: `loadSecurityConfig`, `prepareSecurityRuntime` (Redis connect, throws or exits non-zero on failure), `app.listen`, `process.once('SIGTERM'/'SIGINT')`, `process.exit(1)` in the catch | Importing `server.ts` from a function would start a listener, open Redis during module load, and may kill the process. **Cannot be imported as-is** | Verified in source |
| **C-02** | `server.ts` 37–1676 | `createApp(deps = {})` is exported, synchronous, registers all 17 routes plus `installApiTail`. With `config.rateStore === 'redis'` it **throws** unless `deps.rateStore` is provided (`security/index.ts`) | Good seam: a handler can build the runtime once and pass `rateStore`. No duplication of the pipeline is needed: all 17 routes and the whole pipeline live inside `createApp` | Verified |
| **C-03** | `server.ts` line 2 | `import { createServer as createViteServer } from 'vite'` is static and used only in the dev branch | Vite (and, for Vite 8, its native bundler dependencies) would be traced into the function. Size impact **not measured**; risk of nearing Vercel's 250 MB bundle limit. A *dynamic* `import('vite')` is still traced by file analysis, so the import should live in a file the function never imports | Verified in source; size unverified |
| **C-04** | `package.json` `"type": "module"`, `tsconfig.json` (`moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`), `server.ts` imports such as `./src/utils/adaptiveCoach/engine` | ESM project with **extensionless relative imports**. Community reports (not official Vercel documentation) show Vercel's Node builder transpiling files individually and then failing with `ERR_MODULE_NOT_FOUND` on extensionless relative imports in `"type": "module"` projects, fixed by pre-bundling with esbuild. Vercel's own Express page says its process "does not perform application bundling" | Unverified for this repo. If true, un-bundled deployment fails at first request. `esbuild` is already a devDependency | **Unverified: must be proven in the spike** |
| **C-05** | `package.json` (`typescript ^7.0.2`, `@types/node ^22`, no `engines`) | Vercel's default Node is **24.x** (22.x and 20.x also available); `engines.node` in `package.json` overrides the dashboard setting. TypeScript 7 compatibility with Vercel's TypeScript handling is unknown | A TypeScript or Node mismatch could fail the function build | **Unverified** |
| **C-06** | `redisRateStore.ts` constructor, `guard`, `waitUntilReady` | The client connects **in the background**, `disableOfflineQueue: true`, commands fail immediately while not ready, 500 ms command timeout. `waitUntilReady` (polls every 50 ms, 5 s default) is used **only at startup** | In a function, the first request(s) after a cold start would hit a not-yet-ready client and get `503 rate_limit_unavailable`. Safe (fail-closed) but user-visible. The handler must await readiness once per instance | Verified in source |
| **C-07** | (absent) | No single-flight guard around runtime initialisation. `startServer` runs once, sequentially | Concurrent cold-start requests could each create a Redis client and app. Needs a memoised init promise | Verified (absence) |
| **C-08** | `runtime.ts` (`prepareSecurityRuntime`) | Throws `StartupConfigError` on configuration problems and throws if Redis is unreachable | If a failed init were cached, **one bad cold start would poison the instance**; if the exception escaped, every request would be a 500 without the standard JSON error shape. The handler must map init failure to a fail-closed `503` with `Retry-After` and **retry initialisation** after a short cooldown | Design requirement |
| **C-09** | `redisRateStore.ts` | Reconnect strategy is unbounded exponential back-off with jitter; an `error` listener is attached (so connection errors do not crash the process). No `pingInterval`/keep-alive option is configured; `close()` is never called in a function lifecycle | After an instance is suspended and resumed, a dead socket is detected only when it errors or a command times out, so the first command can return 503 before recovery. Node-redis keep-alive defaults are **not verified** | Verified in source; behaviour unverified |
| **C-10** | `quota.ts` `SupabaseQuotaStore` | Creates a new `supabase-js` client per quota call (3 s timeout). `createSupabaseVerifier` caches one client lazily | Functionally fine in functions; adds one outbound call per AI request. No leak | Verified |
| **C-11** | `server.ts` 435–437 | `barcodeCache` is a module-level `Map` (max 500, 24 h TTL, oldest-first eviction), synchronous operations | Per-instance cache: hit rate drops across instances; no correctness or race problem. More Open Food Facts calls | Verified |
| **C-12** | `security/*`, `server.ts` | No per-request data stored in module-level variables (checked: only `accessTokens` `WeakMap` keyed by request object, `PUBLIC` set, caches above) | Fluid compute runs concurrent requests in one instance; the code is safe for that | Verified (grep + read) |
| **C-13** | `jsonBody.ts`, `endpoints.ts` | Route-specific `express.json` limits up to **14 MB** (`extract-plan`) and 4 MB (`ai-recovery-insights`) | Vercel rejects bodies over **4.5 MB** before Express runs | See §8 |
| **C-14** | `server.ts` (Gemini routes) | Most Gemini calls have **no explicit timeout**; only `adaptive-coach/explain` (20 s) and barcode (8 s) do | The only upper bound would be Vercel's `maxDuration` (default 300 s). Set an explicit lower `maxDuration` and decide client behaviour | Verified in source |
| **C-15** | `config.ts` `trustProxy` | Parsed from `TRUST_PROXY`: only an all-digits string becomes a hop count; anything else (including `true`) becomes `false` | Must be exactly `1` on Vercel (see §6). A wrong value silently shares one IP bucket | Verified |
| **C-16** | `config.ts`, `index.ts` | `NODE_ENV !== 'production'` switches defaults (memory stores, dev CORS origins `localhost:*`) | Vercel's runtime `NODE_ENV` for Preview functions is **unverified**; set it explicitly so Preview behaves as production | **Unverified** |
| **C-17** | `server.ts` imports | `src/utils/adaptiveCoach/*` imports `../recoveryAnalytics` and `../../types`; no `window`/`localStorage`/`document` usage found in them | Safe to run in Node | Verified (grep) |
| **C-18** | `scripts/video-library/*` | References `SUPABASE_SERVICE_ROLE_KEY` (offline ingestion tooling) | Must **never** be set in Vercel | Verified |

**What is not a problem:** `dotenv.config()` (harmless without a `.env`), JSON logging to `console` (Vercel collects it), the SPA fallback and static serving (live only in `startServer`, which the function never calls), and the security pipeline order.

### Answers to the mandatory Express-compatibility questions

1. *Can `createApp()` be exported and reused without starting a server?* **Yes in principle, no in practice today**: it is exported, but the same file runs `startServer()` and statically imports `vite`. The function must import `createApp` from a module that has neither (§10, change S-1). To keep existing tests untouched, `server.ts` can re-export it.
2. *Does importing `server.ts` trigger side effects?* **Yes**: `app.listen`, Redis connection, signal handlers, `process.exit` (C-01), plus `dotenv.config()`.
3. *Does the static Vite import cause problems?* **Probably**: unnecessary dependency weight and possible bundle-size risk (C-03).
4. *Can the middleware work in the function lifecycle?* **Yes**: every middleware is request-scoped or uses external stores; Express itself runs on Vercel (documented).
5. *Can it be wrapped without duplicating the pipeline?* **Yes**: one `createApp(deps)` call; the handler delegates `(req, res)` to the Express app (Express apps are request listeners).
6. *Can initialisation be reused across warm invocations?* **Yes**: Vercel documents that on Fluid compute (default for new projects since April 2025) global state is reused within a warm instance. Initialisation must be memoised, single-flight, and retried after failure (C-06 to C-09).
7. *Concurrency/shared-state problems?* **None found** in the code (C-12). The new risk is *initialisation* races, not request races.

---

## 6. Security preservation assessment

Principle: **no protection is weakened to make deployment easier.** Where a protection behaves differently, the table says what must be true.

| Component | Behaviour in Vercel Functions | Verdict | Conditions / required action |
|---|---|---|---|
| **Supabase JWT verification** | Stateless; `auth.getUser(token)` per request; Supabase unavailable ⇒ `503 auth_unavailable` (unchanged) | Preserved | `SUPABASE_URL` + publishable key present on the function. Adds one network round trip per request; choose a function region near the Supabase project |
| **CORS allow-list** | Same-origin requests (Origin host equals `Host`) pass without configuration; unknown origins get `403 origin_not_allowed`; preflight handled | Preserved, and **simpler** (no allow-list needed for web) | Capacitor later needs `CORS_ALLOW_CAPACITOR` (or explicit origins) and `VITE_API_BASE_URL`. Vercel documents `host` as the domain accessed and `x-forwarded-host` identical |
| **Request IDs** | Per request; inbound `X-Request-Id` accepted only if well-formed | Preserved | none |
| **Helmet / CSP** | Headers on API responses only (JSON). The **SPA is served by Vercel's CDN, not Express**, so the SPA still receives no CSP/Permissions-Policy from the app | Unchanged from today (no regression); pre-existing gap | Separate hardening stage: static-site headers via `vercel.json` (also tracked by the PWA audit) |
| **IP-based rate limiting** | Keyed by `req.ip`. Vercel documents that `X-Forwarded-For` carries the client's public IP and that Vercel **overwrites** a client-supplied value (no spoofing of the header from outside) | Preserved **if `TRUST_PROXY=1`** | Unset/`false` ⇒ `req.ip` is Vercel's internal address ⇒ **all users share one IP bucket and one failed-auth lockout bucket** (R-01). Verify with two real networks in Preview. If a CDN/proxy is ever put in front of Vercel (for example Cloudflare), the client IP seen by Vercel becomes that proxy's, and this must be re-engineered |
| **User-based rate limiting** | Keyed by Supabase user id, stored in Redis | Preserved | Shared across instances only because Redis is external |
| **Redis connectivity and reuse** | Global-scope client reused across warm invocations on Fluid compute | Preserved with **changes** (C-06 to C-09): await readiness once per instance, single-flight init, retry after failure, add keep-alive/ping, and test stale-socket recovery | Vercel's `attachDatabasePool` exists to close idle pool connections before suspension; it is documented for database pools. Whether it supports a node-redis client is **unverified**: do not assume it |
| **Shared limits across concurrent instances** | Yes: every instance talks to the same Redis; counting is atomic (one Lua script) | Preserved | Requires an external Redis reachable from Vercel with TLS (`rediss://`). **Never** the memory store in production (per-instance limits and quotas would multiply by instance count) |
| **Daily quota (Supabase RPC)** | Stateless, per request, caller's JWT; function is `SECURITY DEFINER`, RLS on, grants revoked | Preserved | Migrations `ai_usage_quota` and `ai_quota_bucket_allowlist` are **applied live** (verified). Run `npm run verify:quota` with a dedicated test account after deployment |
| **Endpoint-specific limits** | Table in `endpoints.ts`, unchanged | Preserved | Platform 4.5 MB cap sits *in front of* the 14 MB parser (see §8) |
| **Fail-closed behaviour** | Per-request behaviour unchanged. **New failure modes at init:** Redis unreachable at cold start, bad configuration | Preserved **only if** init failure ⇒ `503` (never "continue without limits") | Init must never fall back to memory stores. Always-closed routes (`extract-plan`, both physique routes) stay closed |
| **Request validation** | Unchanged | Preserved | Platform rejects over-4.5 MB bodies before validation (non-JSON 413) |
| **Error handling** | Unchanged inside Express. **Platform-level errors bypass it**: `413 FUNCTION_PAYLOAD_TOO_LARGE`, `504 FUNCTION_INVOCATION_TIMEOUT`, platform `500`s are not the app's JSON shape | Preserved with a client caveat | Clients that call `res.json()` on a non-JSON error body fall into their `catch` and show a generic message (observed pattern in `PlansUploadView`, `AiRecoveryInsightsPanel`). Verify each caller |

**Questions you asked specifically**

- **Auth-failure lockout affecting multiple users?** Failures are recorded per `authfail:<req.ip>`. With the **correct** client IP it affects only that IP. It would affect everyone under a wrong `TRUST_PROXY` (R-01). Independently of Vercel, users behind one carrier or office NAT share an IP; expired-token requests count as failures (`isExpired` records one), so many users on one NAT address could hit 30 failures in 15 minutes. That is Low-Medium and pre-existing.
- **Preflight CORS works?** Yes for web (same-origin needs none) and for allow-listed origins; `OPTIONS` is answered by the CORS middleware before auth and rate limiting. With `VITE_API_BASE_URL` set later (native), it must be tested.
- **Never a service-role key.** The server uses the publishable key plus the caller's JWT. `SUPABASE_SERVICE_ROLE_KEY` appears only in offline ingestion scripts and **must not** be added to Vercel. A request refused with 401 or 42501 is fixed by correcting the token or grant, never by a bypass key.

---

## 7. Redis and Supabase compatibility

**Redis (rate limits).**

| Question | Finding |
|---|---|
| Reachable from Vercel? | Yes with an external TCP+TLS Redis (`rediss://`). Which provider is an owner decision (Vercel Marketplace Redis and others are options; availability not verified here) |
| Connection reuse between warm invocations | Possible on Fluid compute (global state reused). Needs memoised single-flight init (C-07) |
| Reconnect/stale-connection handling | Reconnects forever with back-off and jitter, error listener present, no offline queue (commands fail fast). **Gap:** no keep-alive/ping configured; first command after resume may fail with 503. Needs a targeted test with the existing TCP-proxy harness (`redisTestHarness.ts`) |
| Shared across concurrent instances | Yes (single Redis, atomic Lua script, window length from Redis TTL) |
| Cold-start cost | One TLS handshake plus `waitUntilReady` (up to 5 s by design). A cold start with Redis down returns 503 and must **retry** on the next request |
| Preview isolation | `RedisRateStore` takes a key prefix option (default `ironlog`) but `runtime.ts` does not expose it via an environment variable, so Preview and Production sharing one Redis would **share counters**. Use a separate Redis for Preview, or leave Preview without API secrets so it fails closed |

**Supabase.**

| Question | Finding |
|---|---|
| Token verification | `auth.getUser(token)` per request; stateless |
| Quota RPC | `consume_ai_quota(p_bucket, p_limit)` with the caller's JWT; atomic upsert; 3 s timeout; `closed` policy default |
| Migrations | **Verified read-only on the live project:** `ai_usage_quota` (20261102045148) and `ai_quota_bucket_allowlist` (20261103061647) exist |
| Drift (informational) | Live project also has `revoke_rls_auto_enable_execute` (20261102082840) with no matching file in `supabase/migrations/`; reconcile separately before any `db push` |
| RLS impact of hosting on Vercel | None: no schema or policy change is needed for the minimum path. The large-upload path adds Storage policies (§8) |

---

## 8. Request body and large-upload assessment

**Platform facts (current Vercel documentation).** Request and response body limit for a Vercel Function: **4.5 MB**; exceeding it returns `413 FUNCTION_PAYLOAD_TOO_LARGE` before the app runs. Maximum duration with Fluid compute: default 300 s for all plans, max 300 s (Hobby), 800 s (Pro/Enterprise), 1,800 s extended (beta, Pro/Enterprise). Memory 2 GB default (Hobby maximum 2 GB; Pro/Enterprise up to 4 GB). Bundle limit 250 MB. Default region `iad1`.

**Endpoint-by-endpoint:**

| Endpoint | Configured parser limit | Works unchanged on Vercel? |
|---|---|---|
| Health, barcode (GET) | 64 KB | Yes |
| `extract-plan` | **14 MB** (decoded file limit 10 MB, base64 ≈ 13.3 MB) | **No for large files.** Bodies above 4.5 MB never reach Express. Base64 inflates by about one third, so a raw file over **roughly 3.3 MB** fails. Text PDFs and CSV/JSON (CSV and JSON are parsed in the browser and never sent) mostly fit; photos of a plan from a phone camera frequently exceed it |
| `ai-recovery-insights` | 4 MB | **Probably** yes: the client sends `sessions` (schema cap 1,000), `profile` and `activePlan`; real size is unmeasured. Measure with production-like history before relying on it (the parser limit leaves only 0.5 MB of headroom under the platform cap) |
| `ai-workout-insights`, `ai-plan-overload-tuning`, `ai-personal-trainer` | 1 MB | Yes |
| All others | 64 KB to 256 KB | Yes |
| Responses (all) | small JSON | Yes (4.5 MB response cap not approached) |

**Does base64 matter?** Yes: the client reads the file as a data URL and sends it as a JSON string, so the 4.5 MB cap applies to the inflated body.

**Options to preserve the 10 MB upload (none changes the 10 MB server limit):**

| Option | How | Verdict |
|---|---|---|
| **U1 — Client-side downscale** | Reduce images before upload | Changes quality and behaviour; PDFs cannot be reduced reliably. Needs owner approval; not silent |
| **U2 — Direct-to-Supabase-Storage (recommended if the limit must be kept)** | Private bucket (for example `plan-uploads`); the browser uploads the file to Storage with its own session; then calls `extract-plan` with a storage path instead of base64 | See below |
| **U3 — Vercel Blob client upload** | Same idea with a second storage vendor | Adds a service, a token endpoint and a second privacy surface; Supabase is already in the stack. Not recommended |
| **U4 — Chunked upload through the function** | Several ≤4.5 MB requests reassembled | Needs shared temporary state; complex and error-prone. Not recommended |
| **U5 — Send the file directly from the browser to Gemini** | Would expose the API key | Rejected (security) |

**How U2 would work without exposing private files or using a service-role key:**

1. *Migration* (new, owner-approved, delivered as a patch file): bucket `plan-uploads`, `public = false`, `file_size_limit` 10 MB, `allowed_mime_types` equal to `EXTRACT_MIME_TYPES`; policies on `storage.objects` for role `authenticated`: INSERT and SELECT only where `bucket_id = 'plan-uploads'` and the first path segment equals `auth.uid()::text`; DELETE for the same prefix (so the server can clean up); no UPDATE. This follows the existing precedent in `20261027010100_exercise_videos_storage.sql` (private bucket, policy-checked access).
2. *Browser* uploads with its own session. A server-issued signed upload URL is optional (`createSignedUploadUrl` requires INSERT permission under RLS), but is not needed when the policy itself restricts the folder.
3. *API*: `extract-plan` accepts `storagePath` (validated to be `<uid>/<file>` and the caller's own uid). The server downloads the object with the **caller's JWT** (RLS enforces ownership), re-runs the existing MIME/signature checks on the bytes, calls Gemini as today, then deletes the object in a `finally`.
4. *Gemini*: inline data is documented with a 20 MB total request limit; a 10 MB file is about 13.3 MB base64, which fits. One third-party source reports a higher inline limit; the documented figure is used here. The Files API is an alternative if ever needed.
5. *Abuse and privacy*: uploads without a following API call leave orphan objects, so add a short retention (delete on completion, plus a periodic cleanup the owner chooses) and consider a per-user storage ceiling. Quota is still counted at `extract-plan`, after upload. Files are health-adjacent personal documents: private bucket, per-user folder, short retention, no public URLs.
6. *Backward compatibility*: keep the `fileData` path for small files so older clients keep working during rollout.

**Can the existing upload workflow be preserved?** Yes at the UI level (same screen, same limits). The transport changes for files over about 3.3 MB. **Do not silently reduce limits or remove the feature**; if U2 is deferred, either accept the limit with a clear user-facing message (needs your approval) or leave large uploads unavailable until U2 ships.

---

## 9. Environment-variable matrix

Names only; no values. "Project" is the single Vercel project under Option 2; "Runtime-only" means it is read by the function at request time and is **not** part of the client bundle. "Client build" means `VITE_*`, inlined into the public JavaScript.

| Variable | Required? | Where (Option 2) | Secret? | Purpose | Read correctly by current code? |
|---|---|---|---|---|---|
| `NODE_ENV` | Yes (`production`) | Runtime (set explicitly; Preview behaviour unverified) | No | Production defaults (CSP/HSTS, Redis + Supabase quota stores), disables dev CORS origins | Yes (`config.ts`) |
| `SUPABASE_URL` | Yes (falls back to `VITE_SUPABASE_URL`) | Runtime | No (public project URL) | Token verification, quota RPC | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | Yes (falls back to `SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`) | Runtime | Not secret by design (publishable/anon) | Server-side Supabase client with caller's JWT | Yes |
| `GEMINI_API_KEY` | Yes for AI features | Runtime only | **Yes** | Gemini calls | Yes, per request (15 routes read it; missing ⇒ 503 on nine, local fallback 200 on six). **Never** `VITE_` |
| `REDIS_URL` | Yes (unless memory store explicitly chosen, not recommended) | Runtime only | **Yes** (may embed credentials) | Shared rate-limit store | Yes (`rediss://` preferred; warns on plain `redis://` to a non-local host) |
| `RATE_LIMIT_STORE` | Optional (`redis` is the production default) | Runtime | No | Store selection | Yes |
| `RATE_LIMIT_FAILURE_POLICY` | Optional (`closed` default) | Runtime | No | Behaviour when Redis fails | Yes |
| `QUOTA_STORE` | Optional (`supabase` default) | Runtime | No | Quota backend | Yes |
| `QUOTA_FAILURE_POLICY` | Optional (`closed` default) | Runtime | No | Behaviour when quota store fails | Yes |
| `AI_QUOTA_OVERRIDES` | Optional | Runtime | No | Per-bucket daily limits (JSON; `0` disables) | Yes (malformed JSON ⇒ defaults, never disables limits) |
| `TRUST_PROXY` | **Yes: `1`** | Runtime | No | Proxy hop count for `req.ip` | Yes, but **only digits are accepted** (C-15) |
| `CORS_ALLOWED_ORIGINS` | Not needed for same-origin web | Runtime | No | Extra allowed origins | Yes. Needed later for Capacitor/Preview-to-Production cases |
| `CORS_ALLOW_CAPACITOR` | Optional (native only) | Runtime | No | Capacitor origins | Yes |
| `AUTH_REQUIRE_VERIFIED_EMAIL` | Optional | Runtime | No | Require confirmed email | Yes |
| `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_USER_PER_MIN`, `AUTH_FAIL_MAX`, `AUTH_FAIL_WINDOW_SEC` | Optional | Runtime | No | Limit tuning (defaults 300, 120, 30, 900) | Yes |
| `LOG_LEVEL` | Optional | Runtime | No | Logger level | Yes |
| `APP_URL` | Optional | Runtime | No | Added to CORS allow-list (the `.env.example` placeholder `MY_APP_URL` is ignored) | Yes. Its `.env.example` wording describes AI Studio/Cloud Run |
| `VITE_SITE_URL` | Strongly recommended (already set) | **Client build**; also read server-side for CORS | No | Origin for Supabase email links | Yes |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes (already set) | **Client build** | No (publishable) | Browser Supabase client; the app refuses a secret key | Yes |
| `VITE_SUPABASE_ANON_KEY` | Legacy alias | Client build | No | Alias of publishable key | Yes |
| `VITE_API_BASE_URL` | **Leave unset** under Option 2 | Client build | No | API origin for cross-origin setups | Yes (`apiFetch.ts`); unset ⇒ same-origin |
| `APP_PORT`, `PORT` | Not used on Vercel | n/a | No | Local server port (`APP_PORT`/`--port`/3000; `PORT` is **not** read) | Yes (local only) |
| `DISABLE_HMR` | n/a | n/a | No | AI Studio dev server note | `vite.config.ts` only |
| `VITEST` | n/a | n/a | No | Prevents `startServer()` in tests | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **Must NOT be set on Vercel** | n/a | **Yes (highest)** | Offline video-ingestion scripts only | n/a |
| `VERIFY_QUOTA_EMAIL`, `VERIFY_QUOTA_PASSWORD`, `VERIFY_QUOTA_JWT` | Not on Vercel | Local shell only | **Yes** | `npm run verify:quota` | Script only |
| `REDIS_TEST_URL`, `PG_TEST_URL`, `REQUIRE_REDIS_TESTS`, `REQUIRE_PG_TESTS`, `TZ` | Not on Vercel | CI/local only | Possibly | Test infrastructure | Tests only |

**Scoping advice (Option 2).** Backend secrets (`GEMINI_API_KEY`, `REDIS_URL`) should be scoped to **Production** only, or given **separate** values for Preview, so a Preview deployment never uses the production Redis or key unintentionally. `vite.config.ts` has no `define`, so non-`VITE_` variables are not inlined into the bundle.

---

## 10. Required source files and proposed changes

*All proposals only; nothing was changed.* Each item lists the exact file, current behaviour, required behaviour, reason, regression risk, and test needed.

### S-1 — Side-effect-free app module and local runner

- **Files:** `server.ts` (split), new `src/server/app.ts`, new `src/server/devServer.ts` (or keep `server.ts` as the local runner).
- **Current:** one file holds `createApp`, all 17 routes, `startServer`, static serving, Vite middleware and the auto-run guard (C-01, C-03).
- **Required:** move `createApp` and the route code into `src/server/app.ts` (mechanical move, no logic edits); `server.ts` remains the local entry (`tsx server.ts` unchanged), imports `createApp`, owns `startServer`, signals, static serving and the `vite` import, and **re-exports `createApp`** so the five existing test files that `import { createApp } from '../../../server'` keep working.
- **Reason:** lets the function import the app without listener, Redis, signals, `process.exit` or `vite`.
- **Regression risk:** Medium (large diff, mostly a move). Reviewable as a rename; verify with the full existing suite.
- **Tests:** all existing server tests unchanged and green; `startup.process.test.ts` still passes against `tsx server.ts`.

### S-2 — Serverless runtime initialiser

- **File:** new `src/server/serverless.ts` (or extend `security/runtime.ts`).
- **Current:** no serverless init; `prepareSecurityRuntime` throws/exits on failure; no single-flight.
- **Required:** `getApp()` memoises a single in-flight promise per instance: `loadSecurityConfig()` ⇒ `prepareSecurityRuntime()` (Redis, ready-wait) ⇒ `createApp({ config, rateStore })`. On failure it does **not** cache the rejection permanently: returns a fail-closed `503` JSON with `Retry-After`, and retries initialisation after a short cooldown. Never falls back to memory stores. No `process.exit`, no signal handlers.
- **Reason:** C-06, C-07, C-08.
- **Regression risk:** Medium-High (security-relevant code path).
- **Tests:** cold start with healthy Redis; concurrent cold start creates exactly one Redis client; Redis down at cold start ⇒ 503, then recovers when Redis returns; invalid configuration ⇒ 503 with no secret in the body or logs; memory store never used when `redis` is configured.

### S-3 — Vercel function entry

- **File:** new `api/[...path].ts` (catch-all), plus a bundling wrapper if C-04 proves necessary.
- **Current:** no `api/` directory.
- **Required:** default export `(req, res)` that awaits `getApp()` and delegates to Express, with a JSON 503 on init failure.
- **Reason:** the Vercel entry point.
- **Regression risk:** Low-Medium; unverified: Express sees the original path in `req.url` (fallback: a single `api/index` function plus a rewrite).
- **Tests:** Preview smoke tests for all 17 routes (§12).

### S-4 — Module format / bundling decision (conditional)

- **Files:** `package.json` (build/postbuild script), new `scripts/bundle-api.mjs` (uses the existing `esbuild` devDependency), `api` wrapper.
- **Current:** extensionless relative imports in an ESM package (C-04).
- **Required:** only if the spike shows runtime resolution failure: pre-bundle the server entry to a single ESM file with npm packages kept external, so Vercel's file tracing still ships them.
- **Reason:** removes the extension-resolution boundary deterministically.
- **Regression risk:** Medium: it adds a step to the frontend's build (a bundling failure would fail the whole deployment; production is not replaced by a failed build). Alternative: add file extensions to server-side imports only (unverified how Vercel's transpile treats `.ts` specifiers).
- **Tests:** build in Preview; runtime smoke test of every route.

### S-5 — Redis store hardening

- **File:** `src/server/security/redisRateStore.ts` (and optionally `runtime.ts` to expose a key-prefix variable).
- **Current:** background connect, no ping/keep-alive configuration, no readiness API other than `waitUntilReady`.
- **Required:** add a keep-alive/ping interval appropriate for a managed Redis behind idle timeouts; keep `disableOfflineQueue` and fail-closed behaviour; optional env-driven key prefix for Preview isolation.
- **Reason:** C-09; Preview/Production isolation.
- **Regression risk:** Medium (shared, well-tested component).
- **Tests:** existing `redisRateStore.integration.test.ts` and `redisApp.integration.test.ts` (need a real Redis, `REQUIRE_REDIS_TESTS=1`), plus a new stale-socket test with the TCP-proxy harness.

### S-6 — Vercel configuration

- **File:** new `vercel.json` (proposal in §11).
- **Current:** none.
- **Required:** function `maxDuration` and region; no change to build command, output directory or framework preset; optional SPA rewrite and static-site headers handled in a **separate** later stage so the first change cannot alter the live frontend.
- **Reason:** explicit duration cap and region choice.
- **Regression risk:** Medium (a `vercel.json` mistake can affect the live frontend).
- **Tests:** Preview deployment diffed against production behaviour for `/`, manifest, icons and an unknown path.

### S-7 — Package metadata

- **File:** `package.json`.
- **Required:** `engines.node` (22.x or 24.x; owner/local decision; verify with `node -v` in a build). Possibly a new dependency such as `@vercel/functions` only if `waitUntil`/`attachDatabasePool` proves useful and applicable (needs approval).
- **Regression risk:** Low-Medium (engine changes affect local installs; dependency additions need your approval).

### S-8 — Large-upload path (optional, separable)

- **Files:** `src/server/security/validation.ts` (`extractPlan` schema accepts `storagePath`), `server.ts`/`app.ts` (`/api/extract-plan` handler: download with caller JWT, delete after), `src/components/plans/PlansUploadView.tsx` (upload to Storage then call API), new `supabase/migrations/<timestamp>_plan_uploads_bucket.sql` (patch file, your approval).
- **Current:** base64 in JSON, one request.
- **Required:** as §8 (U2), keeping the `fileData` path and all current validation (MIME, signature, 10 MB).
- **Regression risk:** Medium-High (new data path, new RLS policies, health-adjacent files).
- **Tests:** RLS tests in PGlite following the existing `rls.*.test.ts` pattern (owner-only insert/select/delete, wrong-prefix refused, `anon` refused); API tests for ownership, MIME/signature, size, cleanup; Preview test with a 3 MB, a 5 MB and a 10 MB file.

### S-9 — Documentation and examples

- **Files:** `.env.example` (document `TRUST_PROXY=1`, Redis, `NODE_ENV`; fix `APP_URL` wording), `docs/deployment/*` runbook. **Risk:** none.

**Not required:** no change to `src/lib/apiFetch.ts`, `cors.ts`, `auth.ts`, `quota.ts`, `rateLimit.ts`, `endpoints.ts` limits, or any frontend call.

---

## 11. Vercel configuration proposal (for review only; not created)

```jsonc
// vercel.json  — PROPOSAL, do not create during this audit
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/[...path].ts": {
      "maxDuration": 60            // explicit cap; default is 300 s. Value to be tuned from Gemini latency measurements.
    }
  }
  // "regions": ["<region near the Supabase project>"]   // default is iad1; choose after D-3
  // No buildCommand / outputDirectory / framework overrides: the existing Vite settings stay as they are.
  // No rewrites in the first change. SPA fallback and static-site security headers are a separate, later stage.
}
```

Dashboard settings (not files): Node.js version (consistent with `engines.node`), Fluid compute (default for new projects; confirm it is on for this project), environment variables per §9 and scoping advice, and Deployment Protection behaviour for Preview URLs (protected Previews block unauthenticated `curl` smoke tests; use the project's bypass mechanism or test from a signed-in browser).

---

## 12. Testing and verification plan

**What exists and is reusable (not executed in this audit).**

| Existing test | Covers | Reuse for Vercel |
|---|---|---|
| `security.test.ts`, `aiSchemas.test.ts`, `routePolicy.test.ts`, `quotaFailure.test.ts` | Whole pipeline through `createApp` with fakes: auth, CORS, limits, validation, quota, all 17 routes × failure matrix | **Reuse unchanged** if `server.ts` re-exports `createApp` (S-1); they validate that the refactor changed nothing |
| `redisRateStore.integration.test.ts`, `redisApp.integration.test.ts` | Real Redis, outage and reconnect via TCP proxy | **Reuse**; extend for stale-socket and cold-start cases |
| `quota.pg.integration.test.ts`, `rls.aiUsageQuota*.test.ts`, `scripts/verify-quota.test.ts`, `npm run verify:quota` | Quota function and RLS on real Postgres/PGlite and a live project | Reuse unchanged; run `verify:quota` after deployment |
| `clientRouteContract.test.ts`, `apiFetch.test.ts` | Client paths match server routes; token only to API origin | Reuse unchanged |
| `startup.process.test.ts` | `tsx server.ts` refusals and health | Reuse (guards the local entry stays intact) |

**New tests required.**

| # | Area | Test | Where |
|---|---|---|---|
| 1 | Cold start | First request after init: Redis ready-wait, correct response, one Redis client created | New `serverless.test.ts` (in-process, fake Redis factory) + Preview |
| 2 | Warm reuse | N sequential calls reuse one app and one Redis client; no reconnects | in-process + Preview log inspection |
| 3 | Authentication | Missing header ⇒ 401 `auth_required`; malformed ⇒ 401; valid ⇒ 200 | Preview with a dedicated test user |
| 4 | Invalid/expired tokens | Expired JWT ⇒ 401 `token_expired`; forged ⇒ 401 `invalid_token`; counts toward lockout only for that IP | in-process + Preview |
| 5 | CORS | Same-origin POST ⇒ allowed; foreign `Origin` ⇒ 403 `origin_not_allowed`; preflight 204 with correct headers; Capacitor origin only with the flag | in-process + Preview (`curl` with `Origin`) |
| 6 | Redis availability | Down at cold start ⇒ 503 then recovers; down mid-traffic ⇒ 503 `rate_limit_unavailable`; always-closed routes never degrade; health stays 200 | TCP-proxy harness (existing) |
| 7 | Shared limits across instances | Burst enough concurrent requests to spread across instances; aggregate allowed count stays at the configured limit (±tolerance); counters survive an instance replacement | Preview load test + Redis key inspection |
| 8 | Supabase quota | `X-Quota-*` headers; 429 `quota_exceeded` at the limit; 503 `quota_unavailable` when the RPC is unreachable | `verify:quota` + staging check |
| 9 | AI endpoints | Each Gemini route returns schema-valid output; missing key behaviour per route policy; error classification for upstream 429/timeouts | Preview with real key on a test account (costs a few calls) |
| 10 | Large plan uploads | 1 MB, 3 MB (passes), 4.4 MB, 4.6 MB (platform 413 shape), and with U2: 5 MB and 10 MB; MIME/signature rejection; client message on 413 | Preview |
| 11 | Barcode | Valid code, not-found code, 8 s timeout path, cache hit; per-instance cache expectations | Preview |
| 12 | Error handling | Platform 413/504/500 responses seen by each client caller; app 404/401/429/503 JSON shapes; no secret or token in any body or log | Preview + log review |
| 13 | Concurrency | 50 to 200 parallel cold-start requests ⇒ one init, no duplicate Redis clients, no 500s; parallel quota consumption never exceeds the limit | in-process + Preview |
| 14 | All 17 routes | Smoke matrix: method × path × (no auth / valid auth / over limit) | Scripted `curl`/Node script run against Preview; extends `clientRouteContract` |
| 15 | Client IP | Two networks produce different `req.ip` values (temporary, non-persistent diagnostic); `TRUST_PROXY=1` verified; spoofed `X-Forwarded-For` from the client does not change the limit key | Preview |
| 16 | Module resolution / bundle | Function boots; reported bundle size; `req.url` preserved for `/api/nutrition/barcode/123` and `/api/adaptive-coach/explain` | Stage 1 spike |

---

## 13. Deployment and rollback plan

**Deployment path.** (1) Work on a throwaway branch; (2) Vercel creates a **Preview** deployment of the existing project automatically; (3) run the §12 matrix against the Preview with Preview-scoped environment values; (4) review and approve; (5) set Production-scoped variables; (6) merge to the production branch; (7) verify `/`, `/manifest.webmanifest`, `/brand/icon-512.png`, `/api/health` and one signed-in AI call on production; (8) monitor logs and the 503 codes for the first days.

**Rollback.** Production is only replaced by a deployment that builds successfully. If a bad deployment ships: use Vercel's instant rollback/promote of the previous production deployment (frontend and API revert together, atomic). The pre-change state is the **current** production behaviour (no `/api`, AI features failing), so rolling back to it cannot make things worse than today. For configuration-only problems, removing the offending environment variable and redeploying also works. A failed init is fail-closed (503), never fail-open, so an incorrectly configured Preview cannot weaken protections.

**Flag:** Production environment changes should be made only after the Preview matrix passes, and `VITE_API_BASE_URL` must remain **unset** under Option 2.

---

## 14. Risks, ranked

### Critical

| ID | Risk | Mitigation |
|---|---|---|
| R-01 | `TRUST_PROXY` missing or not exactly `1` ⇒ all users share one IP bucket and one failed-auth lockout bucket (availability outage for everyone); too high ⇒ spoofable limits | Set `TRUST_PROXY=1`; verify with two networks in Preview before production; only digits are honoured |
| R-02 | Serverless init that fails open, falls back to memory stores, or caches a failed init forever | S-2 contract: fail-closed 503, retry with cooldown, never memory fallback; dedicated tests (#1, #6, #13) |
| R-03 | A service-role or secret key placed in Vercel or in any `VITE_*` variable "to make it work" | Never required; document explicitly; audit env names before promotion |

### High

| ID | Risk | Mitigation |
|---|---|---|
| R-04 | `extract-plan` rejects files over about 3.3 MB (platform 413) | U2 (Supabase Storage direct upload) or an explicit, approved limitation with a clear client message |
| R-05 | Runtime module-resolution failure (ESM with extensionless imports) or TypeScript 7 / Node mismatch | Stage 1 spike; esbuild pre-bundle fallback (S-4); pin `engines.node` |
| R-06 | Redis cold-start and stale-socket 503s | Single-flight ready-wait, keep-alive/ping, retry; stale-socket test; managed Redis with TLS |
| R-07 | Preview deployments using production Redis, Gemini key or quotas (shared counters, cost) | Scope secrets per environment; separate Preview Redis or no Preview secrets (fails closed) |
| R-08 | Region latency and duration: three serial remote calls before any handler plus Gemini; no per-call Gemini timeout | Choose region near Supabase/Redis; set `maxDuration`; measure p95 per route |
| R-09 | Plan tier limits and terms (duration, memory, commercial use) | Confirm plan before Stage 3 (D-2); verify Hobby terms if Iron Log is commercial |

### Medium

| ID | Risk | Mitigation |
|---|---|---|
| R-10 | Express may not see the original `req.url` under catch-all routing | Spike; fallback `api/index` + rewrite |
| R-11 | Platform error bodies (413, 504) are not the app's JSON; some clients then show a generic failure | Verify each caller; improve client messages in a later, approved change |
| R-12 | Coupled frontend/API deployments; a bad `vercel.json` could affect the live frontend | Preview testing; keep first `vercel.json` minimal (§11); instant rollback |
| R-13 | Bundle size from the `vite` import and its native dependencies | Split (S-1); record the bundle size in the spike |
| R-14 | `attachDatabasePool` applicability to node-redis unknown | Do not rely on it; test lifecycle behaviour directly |
| R-15 | SPA still has no CSP/Permissions-Policy (pre-existing) | Separate hardening stage |

### Low

| ID | Risk | Mitigation |
|---|---|---|
| R-16 | Three routes have no client caller (`generate-plan`, `ai-workout-insights`, `ai-nutrition-coach`) and stay reachable | Optionally set their quota to `0` via `AI_QUOTA_OVERRIDES` (not removed in this audit) |
| R-17 | Shared NAT users and the failed-auth lockout; expired tokens count | Monitor `too_many_auth_failures`; tune `AUTH_FAIL_MAX` only deliberately |
| R-18 | Barcode cache per instance; more Open Food Facts calls | Acceptable; per-user 30/min limit remains |
| R-19 | Supabase migration drift (`revoke_rls_auto_enable_execute` has no repo file) | Reconcile before the next `db push` |

---

## 15. Staged implementation plan with go/no-go checkpoints

Each stage stops for your approval. **No stage starts until you approve this audit.**

| Stage | Work | Exit criteria (GO) | NO-GO / fallback |
|---|---|---|---|
| **0 — Decisions** | Answer §16 | D-1 to D-9 recorded | Missing decisions block Stage 1 |
| **1 — Spike (throwaway branch, Preview only)** | Minimal `api/[...path].ts` running `createApp` with a **stub** rate store; no production env; measure bundle size | Function boots; `GET /api/health` returns app JSON; `/api/nutrition/barcode/123` and `/api/adaptive-coach/explain` reach the right route (`req.url` preserved); module format works as-is or with pre-bundle; Node and TypeScript versions confirmed; bundle size under the limit with margin | If extensionless imports fail: adopt S-4 (pre-bundle). If catch-all routing fails: single function + rewrite. If neither works: Option 1 isolated variant or a long-running host (previous audit) |
| **2 — Refactor** | S-1, S-2, S-3 (+S-4 if needed), S-5, S-7, S-9 on a branch; existing suites green; new unit tests (#1, #2, #4, #6, #13) | All pre-existing tests unchanged and passing; new tests pass; no behaviour change for `tsx server.ts` | Any regression in existing security tests ⇒ stop and fix before continuing |
| **3 — Preview verification** | Deploy Preview with Preview-scoped env (separate Redis); run §12 matrix #3–#9, #11–#16 | `TRUST_PROXY=1` verified, shared limits proven, quota enforced, all 17 routes pass, no secret in logs or bodies, p95 latency acceptable, `maxDuration` fits | Any security-control failure is a NO-GO; no workaround that weakens a control |
| **4 — Large uploads (separable)** | S-8 (migration patch for your approval, client change, API change) and test #10 | 10 MB file succeeds; ownership enforced; RLS tests pass; cleanup verified | If deferred: ship Stage 5 with the documented limitation only if you approve it explicitly |
| **5 — Production** | Production env vars; merge; production smoke checks; short monitoring window | Health, one authenticated AI call, quota headers, 503 codes at zero | Instant rollback (§13) |
| **6 — Hardening** | Static-site headers/CSP and SPA fallback via `vercel.json` (aligned with the PWA audit), alerts on `rate_limit_unavailable`, `quota_unavailable`, `auth_unavailable`, `verify:quota` in the runbook | Headers verified in a browser (camera features, video, fonts) | Revert the header change only |

Estimated complexity: Stage 1 small; Stage 2 medium-high; Stage 3 medium; Stage 4 medium; Stages 5 and 6 small to medium.

---

## 16. Explicit owner decisions required before implementation

| # | Decision | Why it matters |
|---|---|---|
| **D-1** | **Option 2 (same project, recommended) or Option 1 (isolated separate project)?** | Option 1 needs a subfolder root with its own manifest or a workspace restructure, a cross-origin setup, and a frontend change |
| **D-2** | **Vercel plan tier** (Hobby/Pro) and confirmation that it covers your intended use | Duration (800 s max on Pro vs 300 s), memory, multi-region, and plan terms |
| **D-3** | **Function region** and the **Supabase project region** | Latency of three serial remote calls; default Vercel region is `iad1` |
| **D-4** | **Redis provider** (external, TLS) and whether Preview gets its own instance | Rate limits must be shared and external; Preview isolation |
| **D-5** | **Node version policy** (`engines.node` 22.x vs 24.x) | Build/runtime consistency; local dev parity |
| **D-6** | **Large uploads:** implement U2 now, defer it with an approved visible limitation (about 3.3 MB), or reduce files client-side (U1) | Preserves or changes a feature; includes a new migration and health-adjacent file storage |
| **D-7** | **Preview policy:** should Preview deployments have a working API (with separate Redis and secrets), or none (fails closed)? | Secret exposure and cost |
| **D-8** | **Approval for the proposed source changes** in §10 (S-1 to S-9), including the optional `@vercel/functions` dependency and any bundling step | Nothing may change until approved |
| **D-9** | **Gemini limits/billing** for the production key and the explicit `maxDuration` you will accept for AI calls | Cost control and timeout behaviour |

---

## 17. Sources

- Vercel, Express on Vercel: https://vercel.com/docs/frameworks/backend/express (zero-config Express detection; `express.static()` ignored; static assets in `public/**`; single function; 250 MB limit; no application bundling)
- Vercel, Functions limits: https://vercel.com/docs/functions/limitations (4.5 MB request/response body; durations with Fluid compute; memory; 250 MB bundle)
- Vercel, Fluid compute: https://vercel.com/docs/fluid-compute (enabled by default for new projects since April 2025; defaults per plan)
- Vercel, Supported Node.js versions: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions (24.x default, 22.x, 20.x; `engines.node` overrides the dashboard setting)
- Vercel, Request headers: https://vercel.com/docs/headers/request-headers (`x-forwarded-for` is the client's public IP and is overwritten by Vercel; `host` and `x-forwarded-host`)
- Vercel, Connection pooling with Functions: https://vercel.com/kb/guide/connection-pooling-with-functions (global state reuse on Fluid compute; `attachDatabasePool`)
- Vercel, Monorepos and FAQ: https://vercel.com/docs/monorepos/monorepo-faq (a push builds every connected project; Root Directory; shared-source option)
- Supabase Storage: `createSignedUploadUrl` / `uploadToSignedUrl` references (requires INSERT on `storage.objects`): https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl
- Gemini API input files: inline data total request limit documented at 20 MB (https://firebase.google.com/docs/ai-logic/input-file-requirements); one third-party source reports a higher figure
- Community reports on Vercel + ESM TypeScript (`ERR_MODULE_NOT_FOUND` on extensionless imports; fix by pre-bundling): https://this.is-a.dev/blog/deploying-bun-to-vercel and https://community.vercel.com/t/deploying-typescript-serverless-functions/4029 (non-official; used only as a reason to run the spike)
- Repository files: `server.ts`, `src/server/security/*`, `src/lib/apiFetch.ts`, `src/components/plans/PlansUploadView.tsx`, `src/components/dashboard/AiRecoveryInsightsPanel.tsx`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `supabase/migrations/*`, `docs/security/*`
