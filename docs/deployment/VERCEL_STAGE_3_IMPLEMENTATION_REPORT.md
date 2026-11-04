# Vercel Stage 3A: Core Backend Migration, Implementation Report

Scope: Stage 3A only (Architecture Option 2, same Vercel project). Local verification only.
Labels: **CONFIRMED** (read or run locally), **DOCUMENTED** (vendor documentation or owner-reported), **INFERRED**, **UNVERIFIED**.
Evidence for this report was produced by a fresh clone of the remote branch, `npm ci`, and the commands listed in section 12. Nothing was deployed.

## 1. Starting branch and commit

| Item | Value |
|---|---|
| Stage 2 base branch | `audit/vercel-stage-2-backend-readiness` |
| Stage 2 base commit | `867e0fc` "docs(vercel): add stage 2 backend readiness audit" (CONFIRMED present on the branch) |
| Stage 2 specification | `docs/deployment/VERCEL_STAGE_2_BACKEND_READINESS_AUDIT.md` (verdict: READY FOR STAGE 3) |

## 2. Implementation branch and final commit

| Item | Value |
|---|---|
| Branch | `implementation/vercel-stage-3-core-backend` (created from the Stage 2 branch; never `main`) |
| Last code commit | `62805beba029788740c6c18c1d163234ac170014` "build(vercel): run the function in hnd1 (Tokyo) to match Supabase ap-northeast-1" |
| This report | committed on top of the code commit as `docs(vercel): record stage 3 implementation` (a commit cannot cite its own hash) |

Commits since `867e0fc` (CONFIRMED, `git log`):

```
62805be build(vercel): run the function in hnd1 (Tokyo) to match Supabase ap-northeast-1
655a19c feat(vercel): apply owner decisions: Node 24.x, maxDuration 120, 90 s Gemini abort
bdae00e build(vercel): record function configuration review and guard it
2c24aa5 test(vercel): spawn child-process tests portably on Windows
310c94e fix(vercel): make api bundle check line-ending safe on Windows
19bc71a build(vercel): bundle api for node esm runtime
a88aea5 feat(vercel): route api function to production app
9dd8988 fix(vercel): normalize rewritten api request urls
47c6374 fix(redis): harden serverless connection lifecycle
a2f1b9e feat(vercel): add serverless app initialization
0c38e05 refactor(server): extract side-effect-free express app
```

## 3. Architecture implemented

One Vercel project. The Vite frontend is served as static files exactly as before. A single Vercel Function, `api/index.js`, is reached through one scoped rewrite and runs the real Express application behind the full existing security pipeline.

```
/api, /api/*  --rewrite-->  /api  -->  api/index.js (esbuild bundle of src/server/serverless/entry.ts)
                                         normalizeRewrittenUrl(req.url)
                                         getApp()  (single-flight: config -> Redis ready -> createApp)
                                         Express app: request id, helmet, CORS, IP limit, auth lockout,
                                         JWT, user limit, endpoint policy, body limits, validation,
                                         quota RPC (caller JWT), route handler
everything else  -->  static dist/ (unchanged)
```

`server.ts` remains the local runner (Vite middleware, static serving, SPA fallback, `listen`, Redis init, signals). It re-exports `createApp`. (CONFIRMED)

## 4. Files created, modified, deleted

From `git diff -M --name-status 867e0fc HEAD` (CONFIRMED), 27 files before this report:

| Status | Files |
|---|---|
| Added | `.gitattributes`, `api/index.js` (generated), `scripts/bundle-api.mjs`, `scripts/bundle-api.test.ts`, `src/server/app.ts`, `src/server/app.sideEffects.test.ts`, `src/server/gemini.ts`, `src/server/gemini.test.ts`, `src/server/serverless/{entry,getApp,handler,normalizeUrl}.ts`, `src/server/serverless/{getApp,handler,normalizeUrl,vercelConfig}.test.ts`, `docs/deployment/VERCEL_STAGE_3_8_FUNCTION_CONFIGURATION.md` |
| Modified | `server.ts`, `package.json`, `vercel.json`, `src/server/security/redisRateStore.ts`, `src/server/security/redisRateStore.integration.test.ts`, `src/server/security/clientRouteContract.test.ts`, `docs/security/rate-limiting-redis.md` |
| Deleted | `api/_spike/app.ts`, `api/index.ts` (the Stage 1 diagnostic handler, replaced by the generated `api/index.js`), `src/server/vercelSpike/vercelSpike.test.ts` |

No file under `src/` outside `src/server/` changed, so no frontend product behaviour changed (CONFIRMED, `git diff --stat 867e0fc HEAD -- src ':!src/server'` is empty).

The only existing test edited is `clientRouteContract.test.ts`, and the edit is one line: it reads route registrations from `src/server/app.ts` instead of `server.ts`, because the routes moved. Its assertions are unchanged (CONFIRMED by reading the diff).

## 5. Application extraction (3.1, 3.2)

`createApp(deps)` moved from `server.ts` to `src/server/app.ts`. Diffing the base `server.ts` against `app.ts` with whitespace ignored (CONFIRMED) shows only:

1. The import block: relative paths adjusted, `createGenAI` added, and the runner-only imports (`vite`, `dotenv`, `path`, `loadSecurityConfig`, `prepareSecurityRuntime`) not carried over.
2. Fifteen one-line constructor swaps, `new GoogleGenAI(...)` to `createGenAI(...)` (owner decision 3, recorded in `VERCEL_STAGE_3_8_FUNCTION_CONFIGURATION.md`). A grep confirms 15 `createGenAI(` calls, 0 `new GoogleGenAI` in `app.ts`, and 15 `ai.models.generateContent(` calls, so every Gemini call is covered by the deadline.
3. Removal of `getPort`, `startServer`, and the auto-run guard, which stay in `server.ts`.

Route bodies, middleware order, barcode cache, and dependency injection are byte-identical apart from items 1 to 3. `app.sideEffects.test.ts` verifies that importing `app.ts` creates no listener, timer, or background process.

## 6. Serverless initialisation design (3.3)

`src/server/serverless/getApp.ts` (CONFIRMED, read in full):

- **Single flight:** one `inflight` promise per instance; concurrent cold requests share it, so one Redis client.
- **No cached rejection:** a failure is stored only as `{ at, reason }` for a 5 s cooldown; the rejected promise is never kept. After the cooldown a fresh attempt runs, so recovery needs no redeploy.
- **Fail closed:** a config selecting the memory store, or the `degraded` rate-failure policy, is refused before anything connects (`memory_rate_store_not_allowed`, `degraded_rate_policy_not_allowed`). There is no path to an in-memory store.
- **Cleanup:** the Redis client created during a failed initialisation is closed exactly once (memoised `close`).
- **No leakage:** failures are logged by category and error class only. Callers receive a fixed message.
- **Controlled 503:** JSON envelope (`success`, `error`, `code: service_unavailable`, `requestId`), `Retry-After`, `Cache-Control: no-store`, `X-Request-Id`. The request ID reuses the app's safe-ID alphabet, otherwise a fresh UUID.
- **No process control:** no signal handlers, `process.exit`, listeners, or timers. Importing the module reads no environment and connects nothing.
- `/api/health` returns 503 (never a false 200) when initialisation fails; its 200 contract is unchanged on success.

## 7. Redis lifecycle changes (3.4)

`src/server/security/redisRateStore.ts` (CONFIRMED, diff reviewed):

- `pingIntervalMs` (default 15,000 ms, 0 disables) via the node-redis `pingInterval` option, to keep idle connections alive and surface dead sockets.
- `recycleAfterTimeouts` (default 3, 0 disables): after N consecutive command timeouts the store installs a fresh client first, then destroys the stale one. Events from a retired client are ignored. A success resets the count. A periodic-PING timeout counts.
- Unchanged: `disableOfflineQueue`, 500 ms command timeout, 2 s connect timeout, capped reconnect, fail-closed behaviour, key construction, thresholds, TCP/TLS (`rediss://`). No second Redis library, no REST client, no memory fallback.
- Documented in `docs/security/rate-limiting-redis.md`.

Behaviour after a real platform suspension and against Upstash is **UNVERIFIED** until a Preview run.

## 8. Rewrite normalisation design (3.5)

`vercel.json` has one rewrite: `/api/:__ironlog_api_path*` to `/api`. `normalizeRewrittenUrl` removes every occurrence of the reserved key and changes nothing else:

- Client `path` parameters (single, repeated, or alongside the reserved key) are never touched.
- Other parameters keep order, repetition, raw encoding, and empty segments byte for byte (no parse and re-serialise).
- The path part, including `%2F` in barcodes, is never modified.
- The key is compared after percent-decoding, so `%5F%5Fironlog_api_path` cannot slip past. A malformed escape keeps the segment.
- Returns the same string when there is nothing to remove.

CONFIRMED by `normalizeUrl.test.ts`. A test also enforces that the constant matches the `vercel.json` source, and Stage 2 found no production reader of `req.query`, `req.url`, or `req.originalUrl`. That Vercel actually injects the reserved name as designed is **UNVERIFIED** until Preview.

## 9. Vercel Function entry point design (3.6)

`src/server/serverless/entry.ts` default-exports `createHandler(getApp)`. `handler.ts` does exactly: normalise `req.url`; await `getApp()` (on failure send the controlled 503 and stop); delegate to Express and keep the invocation open until `finish` or `close`. It never reads or modifies the method or body, and a synchronous escape from Express becomes a fixed 500 with no detail.

**Spike removal (CONFIRMED):** `git grep __vercel_spike -- . ':!docs'` returns nothing. `api/_spike/app.ts` is deleted. `api/` holds exactly one function file (enforced by a test). Only `GET/HEAD /api/health` is public (`PUBLIC` set in `auth.ts`).

## 10. Bundling decision and local bundle size (3.7)

**Decision: B2 (esbuild pre-bundle).** Reasoning:

- Stage 2 found 58 extensionless relative imports in 18 server-reachable files, and Stage 1 showed Vercel's per-file ESM output fails on them (CONFIRMED in Stage 2, S-03).
- B1 would edit 18 files including security modules, and would touch `src/utils/*` shared with the frontend. B2 needs zero source edits, and Stage 2's experiment ran the real app this way.
- No local build evidence contradicted B2.

Implementation: `scripts/bundle-api.mjs` bundles `entry.ts` into the committed, generated `api/index.js` (ESM, `node22` target, deterministic). `prebuild` runs it before `vite build`. `npm run check:api` inspects the result and the freshness. `.gitattributes` pins the file to LF.

Local result (CONFIRMED, this session):

```
api bundle OK: api/index.js 155686 bytes, 28 source files,
externals: @google/genai, @supabase/supabase-js, express, helmet, node:crypto, redis
```

No Vite, no dotenv in the bundle. The build is deterministic: the working tree was clean after `npm run build`. **No Vercel function-size figure is claimed**; that needs a Vercel build (UNVERIFIED). Whether Vercel discovers `api/index.js` and traces the external packages is also UNVERIFIED until a Preview build.

## 11. Security invariants preserved

| Invariant | Evidence |
|---|---|
| 17 routes, original methods and paths | CONFIRMED: `app.get/post` registrations in base `server.ts` and `src/server/app.ts` are the same 17, same order (1 GET health, 1 GET barcode, 15 POST) |
| Health is the only public route; all others require auth; unknown `/api/*` is 401 | CONFIRMED: `handler.test.ts` asserts 401 for every route, for `/api`, `/api/`, `/api/does-not-exist`, `/api/__anything`, with and without the rewrite parameter |
| Security pipeline and middleware order | CONFIRMED: createApp body diff is imports plus the 15 constructor swaps only; `installSecurity`/`installApiTail` untouched |
| Rate limits, lockout, thresholds, key construction | CONFIRMED: unchanged in `redisRateStore.ts` diff; existing security tests pass |
| Fail-closed rate limit and quota | CONFIRMED by existing and new tests; no memory fallback reachable (`getApp.test.ts` asserts the store is never `MemoryRateStore`) |
| Quota RPC with caller's JWT; no service-role key | CONFIRMED: no new service-role reference. The remaining hits are the pre-existing local video-ingest scripts and warnings that forbid the key |
| No new environment variables | CONFIRMED: no new `process.env.*` read in server code on this branch (the only reads in added lines are `GEMINI_API_KEY`, `NODE_ENV`, `LOG_LEVEL`, all pre-existing, plus test and script plumbing) |
| Frontend calls and origin | CONFIRMED: no frontend file changed. Frontend references 13 distinct `/api/` paths (the contract test passes). `generate-plan`, `ai-workout-insights`, `ai-nutrition-coach` have no frontend caller today (pre-existing, DOCUMENTED in Stage 2) |
| `VITE_API_BASE_URL` unset | CONFIRMED in repo (commented in `.env.example`, guarded by test); the Vercel project setting itself is UNVERIFIED |
| `/`, `/manifest.webmanifest`, `/brand/icon-512.png`, unknown non-API paths | CONFIRMED from config: the only rewrite starts with `/api`, no SPA fallback or routes added, files exist in `public/`. Live behaviour is UNVERIFIED until Preview |

One intentional behaviour change, approved by owner decision 3: every Gemini call now has a 90 s whole-call deadline with a real abort, mapped to the existing fixed `504 upstream_timeout`. Auth, limits, quotas, validation and success response shapes are unaffected.

## 12. Tests run and exact results

All CONFIRMED, run in this session on a fresh clone of the remote branch at `62805be`. Environment: Linux, **Node v22.23.4** (the repo now declares `24.x`, so npm prints an `EBADENGINE` warning locally).

| Check | Result |
|---|---|
| `npm ci` | exit 0, 420 packages |
| `npx tsc --noEmit` | exit 0, no errors |
| `npm run check:api` | OK, 155,686 bytes, 28 source files |
| `npx vitest run src/server scripts` | 31 files passed, 2 skipped; 811 tests passed, 46 skipped, 0 failed |
| `npx vitest run` (everything else, excluding `src/server`, `scripts`) | 119 files passed; 1,950 tests passed |
| **Combined** | **150 files passed, 2 skipped; 2,761 tests passed, 46 skipped, 0 failed** |
| `npm run build` | exit 0 (`prebuild` bundle, then Vite build); `git status` clean afterwards |

Requirement coverage: serverless initialisation (`getApp.test.ts`), URL normalisation (`normalizeUrl.test.ts`), real handler (`handler.test.ts`, including concurrent cold starts, controlled 503 and recovery, no memory fallback, no leakage), side effects (`app.sideEffects.test.ts`), startup/process (`startup.process.test.ts`, 8 passed, 1 skipped), bundle (`bundle-api.test.ts`), Gemini deadline (`gemini.test.ts`), config guards (`vercelConfig.test.ts`), route policy and client route contract (existing, passing).

**Windows (owner machine):** after patch 3.7c the owner reported 92/92 passing in the serverless, side-effect and bundle suites, with `check:api` and `npm run build` OK (DOCUMENTED, owner-reported). Patches 3.8, 3.8b and 3.8c are pushed, but a Windows run of the full command set after them has **not** been shown to this session (UNVERIFIED).

## 13. Tests not run, and reasons

The 46 skipped tests are exactly the infrastructure-dependent ones (27 + 10 + 8 + 1 = 46). They are NOT claimed as passing.

| Tests | Count | Reason (from the skip messages) |
|---|---|---|
| `redisRateStore.integration.test.ts` | 27 | No Redis available (`REDIS_TEST_URL` not set, no `redis-server`) |
| `redisApp.integration.test.ts` | 10 of 14 | Same |
| `quota.pg.integration.test.ts` | 8 | `PG_TEST_URL` not set |
| `startup.process.test.ts` "real server process with Redis" | 1 | No Redis available |

Also not run: any Preview or Production request, any Vercel build, any run against Upstash, Supabase data, or Gemini. Known Windows-only failures before this work: `startup.process.test.ts` and `scripts/verify-quota.test.ts` spawned `node_modules/.bin/tsx` directly (a `.cmd` shim on Windows). Patch 3.7c fixed the serverless-suite instances. A separate small patch for the two older spawns is available if the owner wants it.

## 14. Remaining Stage 3B upload limitation

Not implemented, by design. `POST /api/extract-plan` accepts up to 10 MB decoded (about 13.3 MB as base64), while Vercel documents a **4.5 MB** request body limit on Functions (DOCUMENTED). Files above roughly **3.3 MB** will be rejected by the platform with a non-JSON `413 FUNCTION_PAYLOAD_TOO_LARGE` before Express runs. All other routes fit. The existing 10 MB parser limit, `PlansUploadView.tsx`, `validation.ts` and the `extract-plan` flow are untouched.

Stage 3B proposal (from Stage 2 section 10, not started): the browser uploads the file to a **private Supabase Storage** bucket under the user's own path using the user's JWT and Storage RLS; `extract-plan` receives only the storage path and reads the object with the caller's JWT. No service-role key is needed. It is separable from the core migration and needs a bucket, RLS policies, a client change and a validation change, all owner-approved and out of Stage 3A scope.

## 15. Owner actions still required (not performed here)

1. Create the Upstash Redis database in **AWS `ap-northeast-1` (Tokyo)** to match the `hnd1` function and the Supabase project. It does not exist yet.
2. Set Preview environment variables, including the TCP/TLS `REDIS_URL`, in the approved Preview stage only.
3. Confirm the Vercel dashboard Node.js Version setting does not conflict (`engines.node` 24.x overrides it, DOCUMENTED).
4. Confirm Fluid compute is enabled (owner reports it is; not verifiable from the repo) and that the plan accepts `maxDuration: 120`.
5. Re-run `npm ci`, `npx tsc --noEmit`, `npm run check:api`, `npx vitest run src/server scripts`, `npm run build` on Windows after the 3.8 to 3.8c patches and confirm a clean `git status`.
6. Approve Preview infrastructure and Stage 4 verification. Decide on Stage 3B separately.

## 16. Risks and unresolved questions

| # | Item | Label |
|---|---|---|
| 1 | Node 24 runtime and `maxDuration: 120` acceptance are untested; local runs used Node 22 (bundle target `node22` runs on 24) | UNVERIFIED until Preview |
| 2 | Vercel discovery of the committed `api/index.js`, external-package tracing, and function size | UNVERIFIED until Preview build |
| 3 | The reserved rewrite parameter name is injected as designed (word-character names; underscores valid) | UNVERIFIED on Vercel |
| 4 | Redis recycle and ping behaviour after a real platform suspension, and latency to Upstash against the 500 ms command timeout. A different Upstash region risks spurious 503s (Stage 2 R-5) | UNVERIFIED |
| 5 | Redis (37) and Postgres (8) integration tests have never run in this environment | NOT RUN |
| 6 | `api/index.js` is a committed generated file; CRLF regeneration on Windows can make `git am` report it as modified. Mitigated by `.gitattributes` and the CR-tolerant freshness check | CONFIRMED mitigation; Windows run after 3.8x UNVERIFIED |
| 7 | One Gemini call per route, so a route total stays under 120 s; the adaptive-explanation route keeps its own 20 s race | INFERRED from the code (all 15 calls are `generateContent`) |
| 8 | Real production request sizes for `ai-recovery-insights` (4 MB parser limit, below the platform cap) are unmeasured | UNVERIFIED |
| 9 | A third-party claim of larger Fluid body limits conflicts with Vercel's documented 4.5 MB; 4.5 MB is treated as binding until a Preview test says otherwise | UNVERIFIED |

## 17. Recommendation for the next stage

**Stage 3A is ready for Preview verification**, subject to owner actions 1 to 4 above. Locally: types clean, 2,761 tests passing with 0 failures, bundle and build reproducible, all 17 routes and security controls preserved, no spike endpoint, no secrets, no service-role key, no memory-store path.

Recommended next step, only on explicit owner approval: create the Upstash database in Tokyo, set Preview-only environment variables, deploy a **Preview** of this branch, then run the Stage 2 section 14 probe matrix (health, 401 behaviour, reserved-parameter and `%2F` barcode cases, a 5 MB POST to settle the body-limit question, cold start, function size, Redis latency and recovery). Run the 37 Redis and 8 Postgres integration tests against safe, non-production infrastructure at the same time. Only after Preview passes should a Production cutover or Stage 3B be considered.

No Preview or Production deployment occurred. No Vercel setting, environment variable, Supabase object, Upstash resource, or Storage bucket was created or changed. Nothing was merged to `main`.
