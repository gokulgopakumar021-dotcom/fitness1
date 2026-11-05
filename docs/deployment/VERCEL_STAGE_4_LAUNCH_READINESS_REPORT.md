# Vercel Stage 4: Launch Readiness Report (Iron Log / IRONLOG AI)

Audit date: 2026-11-05. Mode: read-only audit. No source, config, env var, Supabase object, Redis, or deployment was changed. This file is the only file written.
Labels: **PASS** / **FAIL** = executed and observed. **BLOCKED** = needs access/infrastructure not available to this audit. **NOT TESTED** = needs a real browser/device or manual run.
Evidence environment: cloud Linux sandbox, fresh shallow clone of `gokulgopakumar021-dotcom/fitness1`, Node v22.23.4 (repo requires 24.x). Your local Windows working tree was **not** visible.

## A. Executive summary

**Overall status: BLOCKED BY EXTERNAL VERIFICATION.** No P0 defect was found. The code on the Stage 3A branch is clean locally (types, bundle, build, 2,854 tests). But Stage 3A has never run on Vercel, is not on `main`, and its required Redis database does not exist yet.

| Result | Count |
|---|---|
| PASS | 10 |
| FAIL | 5 |
| BLOCKED | 26 |
| NOT TESTED | 7 |

Critical blockers (P1): see section D (3 items).
Non-critical: P2 x4, P3 x3.
**Launch today:** only possible if you finish the owner actions in section E (Upstash Tokyo, Preview env vars, Preview deploy and probe run, merge) in one sitting and the Preview run passes on the first attempt. I would not call it safe until a Preview has actually answered `/api/health`.

## B. Repository baseline

| Item | Finding |
|---|---|
| Remote default branch `main` | `dcec169` "Add files via upload" (single commit, 2026-11-03). Contains **no** `api/`, **no** `vercel.json`, **no** `docs/deployment/`. |
| Stage 3A branch | `implementation/vercel-stage-3-core-backend` @ `5b30094` "stage2-full". `main` is an ancestor of it. |
| Commits after the Stage 3A report commit (`fedd09a`) | 3: `c102e57`, `6bd3351`, `5b30094` (Gemini 503 fallback/retry, 8 files, +1296/-132). Report section 2 does not mention them. `api/index.js` was regenerated (now 161,420 bytes vs 155,686 reported). Also `.gitignore` gained `.vercel`. |
| Working tree (audit clone) | Clean before and after `npm ci` + `npm run build` (deterministic bundle). |
| Your local uncommitted changes | **BLOCKED** (not visible from here). Run `git status` and `git log origin/implementation/vercel-stage-3-core-backend..HEAD` locally. |
| Stage 3A report | `docs/deployment/VERCEL_STAGE_3_IMPLEMENTATION_REPORT.md` exists on the branch only. |
| Other remote branches | 16 total, including `fix/package-lock-sync`, `spike/vercel-express-preview`. Not audited. |

## C. Detailed verification results

### 4A / 4B Build and deployment readiness
| Check | Evidence | Result |
|---|---|---|
| Lockfile consistency | `npm ci` exit 0, 420 packages, lockfile untouched. EBADENGINE warning (Node 22 local vs 24.x). | PASS |
| TypeScript | `npx tsc --noEmit` exit 0 | PASS |
| API bundle | `npm run check:api`: OK, 161,420 bytes, 28 sources, externals `@google/genai, @supabase/supabase-js, express, helmet, node:crypto, redis` | PASS |
| Production build | `npm run build` exit 0; `dist` 36 MB; tree stays clean | PASS |
| Full test suite | `npx vitest run`: 152 files passed, 1 skipped; 2,854 tests passed, 8 skipped, 0 failed | PASS |
| `vercel.json` | One rewrite `/api/:__ironlog_api_path*` to `/api`, region `hnd1`, `maxDuration: 120`. Read only; Vercel has never validated it. | NOT TESTED on Vercel (see 4C) |
| Function discovery, external tracing, function size, Node 24 runtime, `maxDuration` 120 acceptance | Needs a Vercel build | BLOCKED |
| Frontend bundle size | One 2.28 MB JS chunk (637 KB gzip) plus 2 WASM files (~10-11 MB each) in `dist`; MediaPipe model 9.4 MB in `public/models` | P3 (performance) |
| Windows run after Stage 3.8 patches | Reported UNVERIFIED in Stage 3A report | BLOCKED |

### 4C Backend and API (live)
All items below need the deployed function; the audit sandbox's proxy returned 403 for `fitness1-five.vercel.app` (not bypassed). Source-level facts are noted but are **not** counted as PASS.

| Check | Source observation | Result |
|---|---|---|
| `/api/health` | 200 on success, controlled 503 on init failure (handler tests) | BLOCKED |
| Unauthenticated returns 401 | Only `GET/HEAD /api/health` is public; tests assert 401 elsewhere | BLOCKED |
| Authenticated routing | 17 routes in `src/server/app.ts` | BLOCKED |
| Middleware order | Same pipeline as pre-migration; unit tests pass | BLOCKED (live) |
| CORS | Allow-list, no wildcard, no credentials; foreign origin gets 403 (`cors.ts`) | BLOCKED |
| Security headers | helmet, CSP (prod only), HSTS, frame deny, Permissions-Policy, `no-store` on `/api/*` | BLOCKED |
| Request IDs | Implemented | BLOCKED |
| Rate limiting, Redis availability, fail-closed behaviour | Fail-closed in code; memory/degraded refused in `getApp` | BLOCKED (Upstash DB does not exist yet) |
| Error bodies without secrets/stack | Fixed messages in code and tests | BLOCKED |
| URL normalisation with real Vercel rewrite | Unit-tested only; reserved-parameter injection by Vercel UNVERIFIED | BLOCKED |
| Request/response lifecycle | Handler tests only | BLOCKED |
| Redis (37) and Postgres (8) integration tests | Skipped without infrastructure | NOT TESTED |

### 4D PWA
| Check | Evidence | Result |
|---|---|---|
| Manifest JSON valid, name/short_name, start_url `/`, scope `/`, display `standalone`, colours `#050505` | `public/manifest.webmanifest` parsed and read | PASS |
| Icons 192/512 any + 192/512 maskable exist | All four files present in `public/brand/` | PASS |
| **Service worker** | **None exists.** No `serviceWorker`, workbox, `vite-plugin-pwa`, `sw.js`, or install-prompt code anywhere in `src`, `public`, `index.html`, `vite.config.ts`. | **FAIL** (see P2-1) |
| Offline shell, offline fallback, cache versioning, stale-shell handling | Not applicable without a service worker; app does not work offline | FAIL (same finding) |
| Caching of authenticated API data | No SW, and server sends `Cache-Control: no-store` on `/api/*` | NOT TESTED live |
| Installability Android Chrome / Desktop Chrome / standalone launch / installed icons | Needs real browsers; Chrome install criteria without a SW are unverified here | BLOCKED (x3) |
| Offline behaviour, reconnect recovery, no data loss | User data is local (localStorage/IndexedDB), so offline data entry is plausible; needs browser test | NOT TESTED |
| Offline failure handling in UI | `PlansUploadView` calls `res.json()` on the response; a non-JSON platform error (e.g. 413) will surface only as the generic catch message (not live-verified) | NOT TESTED |

### 4E Core journeys (source inspection; manual verification still required for all)
| Journey | Frontend | API / backend dependency | Automated coverage | Manual still required |
|---|---|---|---|---|
| Sign-up, login, logout, reset, session, refresh | `AuthContext.tsx`, `AuthScreens.tsx`, `AuthGate.tsx` | Supabase Auth direct; `apiFetch` refreshes once on 401 | `auth.test.tsx`, `apiFetch.test.ts` | Yes, on the real production Supabase URLs/redirects |
| Dashboard, workouts, library, nutrition, hydration, profile, history | `src/components/*` | Local storage; barcode GET `/api/nutrition/barcode/:id`; video catalog from Supabase | Extensive component tests (2,854 total) | Yes |
| Data isolation between users | `src/storage/storageScope.ts` (per-user key namespace, documented as client-side separation only) | Supabase RLS for server data | `storageScope.test.ts`, `localStorageScopeGuard.test.ts` | Yes: two accounts on one device |
| Body Scan, camera failure handling | `src/components/bodyscan`, `src/services/camera.ts` (maps `NotAllowedError`, `NotFoundError`, `NotReadableError`), on-device MediaPipe | None (local pose model) | `camera.test.ts`, `poseLandmarker*.test.ts` | Yes, on Android Chrome |
| Delete account | `deleteAccount` in `AuthContext` | RPC `delete_own_account` | `accountErase.test.ts` | Yes, with a throwaway account |
| AI features (15 Gemini routes) | Various | `/api/*` | Mocked | Out of Stage 4 scope. They depend on the backend being deployed, so they are blocked by P1-1/P1-2. |

### 4F Security
| Check | Evidence | Result |
|---|---|---|
| RLS on all public tables | Live Supabase: `profiles`, `exercise_videos`, `ai_usage_counters` all `rls_enabled: true` | PASS |
| Secrets in frontend bundle | Scanned `dist`: no `AIza...` key; only a guard string `sb_secret_` (a check that rejects secret keys); no service-role key | PASS |
| Frontend env names | Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`/`PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, `VITE_SITE_URL` used | PASS (source) |
| Migration drift | All 7 repo migrations are applied. **The database has an 8th migration `revoke_rls_auto_enable_execute` (applied 2026-11-02) that is not in the repo.** | FAIL (P2-3) |
| Supabase leaked-password protection | Advisor WARN: disabled | FAIL (P2-2) |
| SECURITY DEFINER RPCs executable by `authenticated` | `consume_ai_quota`, `delete_own_account`: advisor WARN. Both appear intentional (caller-scoped), not verified here. | NOT TESTED (review) |
| `ai_usage_counters` RLS enabled, no policies | Advisor INFO; consistent with access only through the RPC | informational |
| **`/api/extract-plan` body limit** | Parser limit `14mb`, file cap 10 MB decoded; Vercel documents 4.5 MB per request. Files above about 3.3 MB (PDF/PNG/JPG, the client has no size guard, accept list `.pdf,.png,.jpg,.jpeg,.csv,.txt,.json`) will get a non-JSON 413 from the platform. CSV/JSON uploads are parsed in the browser and are unaffected. All other routes are at or below 4 MB. | FAIL (P2-4, not a launch blocker; see D) |
| Request validation, upload limits, auth enforcement, JWT validation, rate limits | Present in code, tests pass; live behaviour BLOCKED | BLOCKED |

### 4G Mobile and browser
Responsive layout, touch targets, keyboard behaviour, overflow, installed-app behaviour: **NOT TESTED** (no browser/device in this audit). CSP has not been verified in a real browser (the code comments say so). Highest-risk item: CSP must allow Google Fonts, Supabase and the self-hosted WASM/model; test in Chrome with DevTools open.

### 4H Production readiness
Vercel dashboard (production branch, domain, HTTPS, env var names, Supabase/Redis/Gemini env presence, build settings, runtime/limits, logs, rollback): **BLOCKED**, no Vercel access. Known from the repo/docs: the frontend is served at `fitness1-five.vercel.app` with `VITE_API_BASE_URL` unset (owner-reported). Supabase project `ap-northeast-1` is ACTIVE_HEALTHY (live). Upstash Redis does not exist per the Stage 3A report.

## D. Launch blocker register

| ID | Sev | Issue | Evidence | Required action |
|---|---|---|---|---|
| P1-1 | P1 | Stage 3A backend is not on `main` and has never run on Vercel (no Preview ever deployed). Whatever production is built from `main` has no `api/` function, so every `/api/*` call (AI, barcode) would fail. | `main` @ `dcec169` has no `api/` or `vercel.json`; Stage 3A report section 16 lists Vercel discovery, Node 24, function size, rewrite parameter as UNVERIFIED | Deploy a Preview of the branch (owner approval), run the Stage 2 probe matrix, then merge to the production branch |
| P1-2 | P1 | Upstash Redis does not exist; the app fails closed, so without it `/api/health` and all API routes return 503. | Stage 3A report section 15 action 1; `getApp.ts` refuses memory/degraded stores | Create the Upstash DB in AWS `ap-northeast-1`, set `REDIS_URL` (TCP/TLS) and the other server env vars for Preview, then Production |
| P1-3 | P1 | Required Production env vars are unverified (Supabase URL/key server side, `GEMINI_API_KEY`, CORS origins, Redis, `NODE_ENV`). | Dashboard not accessible | Confirm names/presence in Vercel (no values) |
| P2-1 | P2 | No service worker: no offline support, no update control. App is probably still installable from the manifest; unverified. | grep found no service worker code | Decide whether offline is a launch requirement; otherwise ship as "installable, online-first" |
| P2-2 | P2 | Leaked-password protection disabled in Supabase Auth | Live advisor | Enable in dashboard (owner action) |
| P2-3 | P2 | Migration drift: `revoke_rls_auto_enable_execute` exists in DB, not in repo | Live `list_migrations` | Add the SQL to `supabase/migrations/` later; do not re-apply |
| P2-4 | P2 | Plan PDF/image uploads above ~3.3 MB fail at the platform with a non-JSON error and no client guard | Section 4F | **Not a launch blocker** if you accept the limit: Stage 3B (Supabase Storage) is not required for launch. Postpone, optionally add a client-side size message |
| P3-1 | P3 | 3 Gemini commits after the Stage 3A report are on the branch (the report and your instructions treat Gemini work as postponed) | `git log` | Note; tests pass; decide whether to keep them in the merge |
| P3-2 | P3 | Large single JS chunk and ~20 MB WASM downloads | Build output | Later optimisation |
| P3-3 | P3 | Local Node 22 vs `engines` 24.x warning | `npm ci` | Confirm Preview build uses Node 24 |

No P0 issue was found.

## E. Production deployment checklist (owner actions)

1. Run `git status` locally; commit or set aside any local changes; confirm your branch equals `origin/implementation/vercel-stage-3-core-backend` (5b30094).
2. Create the Upstash Redis database in `ap-northeast-1`; copy the TCP/TLS `REDIS_URL`.
3. In Vercel, set Preview env vars (names only listed here): Supabase URL and key(s) used by the server, `REDIS_URL`, `GEMINI_API_KEY`, optional `GEMINI_FALLBACK_MODEL`, CORS origin settings, `NODE_ENV`. Confirm `VITE_API_BASE_URL` stays unset.
4. Confirm Node.js version (engines 24.x), Fluid compute, and that the plan accepts `maxDuration: 120`.
5. Approve a Preview deploy of the branch; then run: `/api/health` 200, unauthenticated 401 on a protected route, CORS 403 for a foreign origin, headers and `X-Request-Id`, a barcode URL with `%2F`, a 5 MB POST (confirm the 413 behaviour), cold start time, function size.
6. Verify rate limiting and that stopping/breaking Redis gives 503 (on safe infrastructure).
7. In Chrome (Android and desktop): sign up, verify email, login, logout, reset password, refresh persistence, add workout/meal/water, Body Scan with camera allowed and denied, second account isolation, delete a throwaway account, DevTools console for CSP violations, install the PWA and launch standalone.
8. Enable leaked-password protection in Supabase Auth.
9. Check the Vercel Production branch and domain, HTTPS, and that logs are visible; note the previous deployment for rollback.
10. Merge to the production branch only after steps 5-7 pass.

## F. Final verdict

**BLOCKED BY EXTERNAL VERIFICATION.**

Reasoning: local evidence is strong (tsc, bundle check, build, 2,854 passing tests, RLS enabled, no secrets in the frontend bundle, clean manifest). However the three P1 items are all things this audit cannot verify or that do not exist yet: the backend has never been deployed to Vercel, the Redis database it needs is not created, and Production configuration is not inspectable. Nothing found requires a code change before launch. The 4.5 MB upload limit is a degraded-feature issue, not a launch blocker.
