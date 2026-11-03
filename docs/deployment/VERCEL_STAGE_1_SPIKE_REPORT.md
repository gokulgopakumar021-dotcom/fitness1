# Vercel Stage 1 — Express-on-Vercel Preview Spike Report

**Status: spike works on Preview (deployment `fitness1-qkxdly50q`, built from the rewrite fix). Remaining items listed under "Not yet verified" / "Requires owner action".**

## 1. Starting point
- Branch: `main`, commit `dcec169` ("Add files via upload"), working tree clean.
- Repo evidence: no `api/`, no `vercel.json`, no `.vercel/`. `package.json`: `build = vite build`, Express `4.22.3` installed, `typescript ^7.0.2`, `"type": "module"`, no `engines`. `vite.config.ts` has no `define`/`base`; output dir is `dist`.
- Vercel project settings (Vite preset, `npm run build`, `dist`) are owner-reported in the earlier audits; not independently verifiable from the repository.

## 2. New branch and commit
- Branch: `spike/vercel-express-preview` (from `main`). Not merged. Commit hash: see `git log -1` (the commit containing this report).

## 3. Files created (nothing existing was modified)
- `api/index.ts` — single function entry (renamed from `api/[...path].ts` in commit 3); default-exports the spike Express app.
- `vercel.json` (commit 3, owner-approved) — one rule: `rewrites: [{ source: "/api/:path*", destination: "/api" }]`. Matches only `/api` and `/api/*`; no effect on `/`, static assets, `/manifest.webmanifest`, `/brand/*` or unknown non-API paths; no SPA fallback; no framework/build/output changes.
- `api/_spike/app.ts` — isolated Express app (underscore prefix so Vercel does not treat it as its own function).
- `src/server/vercelSpike/vercelSpike.test.ts` — 10 tests (placed under `src/` because `vitest.config.ts` only includes `src/**` and `scripts/**`, which was deliberately left unmodified).
- `docs/deployment/VERCEL_STAGE_1_SPIKE_REPORT.md` — this file.
- No dependency changes, no env vars.

## 4. Design
- Imports only `express`. Does not import `server.ts`, Redis, Supabase, Gemini or security code. No `app.listen`, timers, signal handlers or `process.env` reads.
- Routes: `GET /api/health`; `GET /api/__vercel_spike/path`; `POST /api/__vercel_spike/method` (`express.json`, `2kb` limit, `application/json` only); controlled JSON 404 for other `/api/__vercel_spike/*` and for any other `/api/*`; JSON error handler (413 `payload_too_large`, 400 `invalid_json`, 500 `internal_error`; no stacks).
- Responses never include headers, cookies, query values or environment values.

## 5. Results

### Confirmed by local tests
- `tsc --noEmit`: exit 0 before and after.
- `vite build`: succeeds before and after; `dist/` contains `assets, brand, favicon.ico, index.html, manifest.webmanifest, models` and no `api` output (the function is not part of the static build).
- Spike tests: 10/10 pass (health, path diagnostic incl. `originalUrl`, POST + JSON body, 413 oversize, 400 malformed JSON, spike 404, wrong-method 404, generic `/api/*` 404, no leakage of env/auth/cookie canaries). Tests call the real `api/[...path].ts` default export through a Node `http` server.
- Test counts (vitest, run in chunks; the single full run did not finish within the sandbox time limit):
  - Baseline, excluding 4 files: **2643 passed** — server 425, utils 672, storage 73, services 179, test 293, scripts 268, components 677, data+lib 56.
  - Final: **2653 passed** (baseline + 10 spike tests); server chunk re-run 425 → 435.
  - Excluded (not run, need Redis/Postgres or spawn processes): `redisRateStore.integration.test.ts`, `redisApp.integration.test.ts`, `quota.pg.integration.test.ts`, `startup.process.test.ts`.
- Informational probe: importing `api/[...path].ts` under plain Node ESM (`--experimental-strip-types`) fails with `ERR_MODULE_NOT_FOUND` on the extensionless `./_spike/app` import. This does not predict Vercel's behaviour (Vercel compiles TypeScript itself) but it is exactly the risk C-04 in the compatibility audit describes, and the Preview deployment is the real test.

### Confirmed by Preview deployment (first deployment, commit `68e9809`, Vercel runtime logs + CLI)
- Build succeeded (owner-reported green).
- Vercel discovered and compiled `api/[...path].ts` as a function with no `vercel.json`: `GET /api/health` returned `FUNCTION_INVOCATION_FAILED` (a crash, not a platform 404).
- **C-04 confirmed.** Runtime log: `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api/_spike/app' imported from /var/task/api/[...path].js`. Vercel emits per-file JS under `/var/task/api/` and Node ESM does not resolve extensionless relative imports in this `"type": "module"` project.
- Deployment Protection (Vercel Authentication) is on for Previews; checks need `vercel curl` or a signed-in browser.
- Owner's browser request to `/api/__vercel_spike/path` returned Vercel's platform `NOT_FOUND` (before the CLI test). Unexplained; may reflect nested-path routing under `[...path]` or something else. **Re-test after the fix.**
- Original-path behaviour, POST, unknown-route 404 and static checks: **not yet verified on Preview** (function never ran).

### Confirmed by Preview deployment (second deployment, commit `57e0d5d`, with `.js` import fix)
- Import fix worked: function starts. `GET /api/health%60` (stray backtick typed by mistake) returned the Express JSON 404 `{"ok":false,"error":"not_found","method":"GET","path":"/api/health%60"}`: Express received the full original path for a single-segment URL.
- **Catch-all limitation confirmed:** `api/[...path].ts` matched only single-segment paths. `/api/__vercel_spike/path`, `/api/__vercel_spike/unknown` and `/api/foo/bar` all returned Vercel platform `NOT_FOUND` (not Express). `/api/foo/bar` has no underscore, so the underscore prefix is not the cause.
- Fix (commit 3, owner-approved): rename to `api/index.ts` plus the one scoped rewrite above. Local simulation (per-file esbuild emit under native Node ESM) serves `/api/health`, `/api/__vercel_spike/path` and `/api/foo/bar` correctly. **Not yet verified on Preview.** Key open question: whether Express still sees the original `/api/...` path after the rewrite.

### Confirmed by Preview deployment (third deployment `fitness1-qkxdly50q-fitness-67e0.vercel.app`, rewrite fix; Vercel Authentication on, tested via `vercel curl` and a signed-in browser console)
| Request | Result |
|---|---|
| `GET /api/health` | 200, `{"ok":true,"service":"ironlog-vercel-spike","runtime":"vercel-function","version":"stage1-spike-1"}` |
| `GET /api/__vercel_spike/path` | 200, `method:"GET"`, `path:"/api/__vercel_spike/path"`, `routeMatched:true`, `originalUrl:"/api/__vercel_spike/path?path=__vercel_spike%2Fpath"` |
| `POST /api/__vercel_spike/method` body `{"a":1}` | 200, `{"ok":true,"method":"POST","path":"/api/__vercel_spike/method","body":{"a":1}}` |
| `GET /api/__vercel_spike/unknown` | 404 Express JSON `spike_route_not_found`, `routeMatched:false`, path preserved |
| `GET /api/__vercel_spike/method` (wrong method) | 404 Express JSON `spike_route_not_found` |
| `GET /api/foo/bar` | 404 Express JSON `not_found`, path `/api/foo/bar` (nested routing works) |
| `GET /manifest.webmanifest` | IronLog manifest returned (static unaffected) |
| `GET /brand/icon-512.png` | binary image returned (static unaffected) |
| `GET /some/unknown/path` | Vercel platform `NOT_FOUND`, unchanged from pre-spike behaviour (no SPA fallback added) |

- Express receives the original `/api/...` path in `req.path` after the rewrite.
- **Rewrite side effect (Stage 2 must handle):** the rewrite appends a `path` query parameter. `req.originalUrl` and `req.query` contain `?path=<segments>` that the client never sent. Any real route, middleware, logger or signature check that reads `req.query.path` or the full URL must account for this (for example by ignoring or stripping a reserved `path` key, or by testing an alternative routing form).
- No secrets or environment variables were needed; none were added.

### Not yet verified
- `GET /` (frontend root) on the third Preview was not explicitly tested; `/manifest.webmanifest` and `/brand/icon-512.png` were.
- The deployment's commit hash and branch (expected `9fb746b` on `spike/vercel-express-preview`) were not confirmed from the dashboard.
- Node version and function bundle size from the Vercel build log.
- That no Production deployment changed (owner to confirm on the Deployments page).
- Behaviour with a real app (`createApp`, Redis, Supabase, Gemini, security pipeline), `TRUST_PROXY`, client IP, large bodies, `maxDuration`: out of scope for Stage 1.

### Requires owner action
1. Confirm in the Vercel dashboard that the tested deployment is commit `9fb746b` on `spike/vercel-express-preview`, and that Production still points to its previous deployment.
2. Note the Node version and function size shown in the build log.
3. Confirm `GET /` loads on the Preview in a signed-in browser.
4. Decide whether to keep Vercel Authentication on for Previews (recommended); testing used `vercel curl` and a signed-in browser.

## 6. Fix and fallbacks
- **Applied (follow-up commit):** `api/[...path].ts` now imports `./_spike/app.js`. Local: 10/10 spike tests, `tsc` clean; a per-file esbuild emit run under native Node ESM served `/api/health`, the path diagnostic (original path preserved) and the spike 404 correctly. This simulation is not a Vercel result.
- If it still fails: pre-bundle with the existing `esbuild` devDependency (audit item S-4).
- If Express sees a stripped or different path: single `api/index.ts` function plus one narrowly scoped `/api/(.*)` rewrite in `vercel.json`, explained rule-by-rule before adding.

## 7. Does the spike prove Option 2 is viable?
**Yes for the platform mechanics, with two conditions.** On a real Preview, an Express app runs as a Vercel Function inside the existing Vite project, receives the original `/api/...` path, handles GET and POST with JSON bodies, returns controlled JSON errors, and leaves static assets and non-API 404 behaviour unchanged. It needed two corrections found by the spike: the `.js` import specifier (C-04) and `api/index.ts` plus a scoped `/api/:path*` rewrite (the `[...path]` catch-all only matched single-segment paths here). Conditions: Stage 2 must handle the rewrite-injected `path` query parameter, and the remaining items above should be confirmed. Nothing here validates the real backend, security pipeline, Redis or body-size behaviour.

## 8. Recommended next step
Complete the owner confirmations, review this report, and explicitly approve Stage 2. Stage 2 should (a) keep the `.js` import-specifier convention for server code (or pre-bundle with esbuild, audit item S-4), (b) keep `api/index.ts` and the scoped rewrite, (c) design around the injected `path` query parameter, and (d) not start until approved.
