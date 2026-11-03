# Vercel Stage 1 — Express-on-Vercel Preview Spike Report

**Status (update 3): routing fix applied, awaiting Preview re-test. Earlier: spike implemented; first Preview deployment (commit `68e9809`) built green but the function crashed at runtime (C-04, extensionless import). Fix applied in a follow-up commit; Preview re-verification pending.**

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

### Not yet verified
- Vercel discovers `api/[...path].ts` alongside the Vite preset with no `vercel.json`.
- Express receives the original `/api/...` path (`req.url`/`req.path`) under catch-all routing. The `/api/__vercel_spike/path` endpoint is built to answer this.
- Extensionless relative import `./_spike/app` resolves on Vercel in a `"type": "module"` project (C-04).
- TypeScript 7 / Node version compatibility of Vercel's function build (C-05; no `engines` set).
- Static assets, `/` and `/some/unknown/path` behaviour with `api/` present (expected unchanged: no rewrites were added).
- Whether Preview Deployment Protection blocks unauthenticated `curl`.

### Requires owner action
1. Push the branch: `git push -u origin spike/vercel-express-preview` (no push was made from here).
2. Confirm Vercel creates a **Preview** deployment for the branch (Git integration) or authorize one. Do not promote it.
3. In the Vercel project, confirm no env vars are needed (none are) and note the Preview URL; if Deployment Protection is on, use the bypass token or a signed-in browser.
4. Send me the Preview URL; I will run the checklist (`/`, `/api/health`, `/api/__vercel_spike/path`, `/api/__vercel_spike/method`, `/api/__vercel_spike/unknown`, `/manifest.webmanifest`, `/brand/icon-512.png`, `/some/unknown/path`).
5. Check the Vercel build log for the function's Node version and bundle size.

## 6. Fix and fallbacks
- **Applied (follow-up commit):** `api/[...path].ts` now imports `./_spike/app.js`. Local: 10/10 spike tests, `tsc` clean; a per-file esbuild emit run under native Node ESM served `/api/health`, the path diagnostic (original path preserved) and the spike 404 correctly. This simulation is not a Vercel result.
- If it still fails: pre-bundle with the existing `esbuild` devDependency (audit item S-4).
- If Express sees a stripped or different path: single `api/index.ts` function plus one narrowly scoped `/api/(.*)` rewrite in `vercel.json`, explained rule-by-rule before adding.

## 7. Does the spike prove Option 2 is viable?
**Not yet.** Function discovery without `vercel.json` is confirmed on Preview and the module-resolution problem is identified and fixed locally. Original-path preservation, nested-path routing and static compatibility are still unverified on Preview.

## 8. Recommended next step
Perform owner steps 1–5, run the Preview checklist, and update this report with real Preview results. Stage 2 should not begin until that is reviewed and approved.
