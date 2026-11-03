# Vercel Stage 1 — Express-on-Vercel Preview Spike Report

**Status: spike implemented and verified locally. NOT yet deployed to Preview. Preview verification requires owner action.**

## 1. Starting point
- Branch: `main`, commit `dcec169` ("Add files via upload"), working tree clean.
- Repo evidence: no `api/`, no `vercel.json`, no `.vercel/`. `package.json`: `build = vite build`, Express `4.22.3` installed, `typescript ^7.0.2`, `"type": "module"`, no `engines`. `vite.config.ts` has no `define`/`base`; output dir is `dist`.
- Vercel project settings (Vite preset, `npm run build`, `dist`) are owner-reported in the earlier audits; not independently verifiable from the repository.

## 2. New branch and commit
- Branch: `spike/vercel-express-preview` (from `main`). Not merged. Commit hash: see `git log -1` (the commit containing this report).

## 3. Files created (nothing existing was modified)
- `api/[...path].ts` — catch-all function entry; default-exports the spike Express app.
- `api/_spike/app.ts` — isolated Express app (underscore prefix so Vercel does not treat it as its own function).
- `src/server/vercelSpike/vercelSpike.test.ts` — 10 tests (placed under `src/` because `vitest.config.ts` only includes `src/**` and `scripts/**`, which was deliberately left unmodified).
- `docs/deployment/VERCEL_STAGE_1_SPIKE_REPORT.md` — this file.
- No `vercel.json`, no dependency changes, no config changes, no env vars.

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

### Confirmed by Preview deployment
- **Nothing.** No Preview deployment was created from this environment, so no Preview result is claimed.

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

## 6. Prepared fallbacks (not applied)
- If the function fails with `ERR_MODULE_NOT_FOUND`: change the import to `./_spike/app.js` (or pre-bundle with the existing `esbuild` devDependency — audit item S-4).
- If Express sees a stripped or different path: single `api/index.ts` function plus one narrowly scoped `/api/(.*)` rewrite in `vercel.json`, explained rule-by-rule before adding.

## 7. Does the spike prove Option 2 is viable?
**Not yet.** Locally the isolated Express app works and the frontend build is unaffected. Viability depends on the Preview results above (function discovery, original path, module resolution).

## 8. Recommended next step
Perform owner steps 1–5, run the Preview checklist, and update this report with real Preview results. Stage 2 should not begin until that is reviewed and approved.
