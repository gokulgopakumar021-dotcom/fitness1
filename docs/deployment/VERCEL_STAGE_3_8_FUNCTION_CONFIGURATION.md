# Stage 3.8: Vercel Function configuration

Status: local only. Nothing deployed, no Vercel setting or environment variable changed.
Labels: CONFIRMED (read or run locally), DOCUMENTED (vendor documentation), INFERRED, UNVERIFIED.

## Result

Owner decisions received after the first review, now applied:

| # | Decision | Applied as |
|---|---|---|
| 1 | Node.js `24.x` | `package.json` `"engines": { "node": "24.x" }` (Vercel maps it to the latest 24.x) |
| 2 | `maxDuration` 120 s | `vercel.json` `functions["api/index.js"].maxDuration = 120` |
| 3 | Gemini timeout max 90 s, real abort | `src/server/gemini.ts` `createGenAI()`; all 15 `new GoogleGenAI(...)` in `src/server/app.ts` now call it |
| 4 | Fluid Compute enabled | Vercel dashboard setting, not in the repo. **Owner confirmed it is already enabled** (not verifiable from the repo; a Preview build will confirm `maxDuration: 120` is accepted) |
| 5 / 6 | Function region matched to Supabase, Upstash to match | `vercel.json` `"regions": ["hnd1"]` (Tokyo). Supabase project region read from the connected project: `ap-northeast-1` (CONFIRMED, read-only metadata). Vercel documents `hnd1` = `ap-northeast-1`, Tokyo (DOCUMENTED). **Upstash must be created in AWS `ap-northeast-1` (Tokyo): owner action.** |

### Gemini deadline design (CONFIRMED by local tests with a fake fetch)

- One `AbortController` per `generateContent` call fires at 90 s for the **whole** call, including the fallback attempt described below. The SDK's `httpOptions.timeout` alone is per HTTP attempt. Corrected after review: with `@google/genai` 2.31.0 (the version pinned in `package-lock.json`) and `httpOptions.retryOptions` **unset**, the SDK makes exactly **one** HTTP request and does not retry or back off; it retries (5 attempts, 408/429/500/502/503/504) only when `retryOptions` is set, and `createGenAI()` never sets it (CONFIRMED in the SDK source and by a mocked-fetch test: a 503 is one call). An earlier version of this document said the SDK retries up to 5 times; that was wrong for this configuration. The shared deadline stays as a hard bound regardless.
- The abort surfaces as `AbortError`, which the existing `classifyError` already maps to `504 upstream_timeout` with a fixed message. No provider text, key or stack is returned. No route handler changed other than the client constructor.
- The timer is cleared when the call settles; a caller-supplied abort signal and the existing `User-Agent` header are preserved.
- 90 s is 30 s below `maxDuration` (120 s), leaving room to validate and answer. Each AI route makes one Gemini call, so the route total stays under 120 s. The adaptive-explanation route keeps its own shorter 20 s race.
- This is a behaviour change (Stage 2 listed it as needing approval; approved by decision 3). It does not alter authentication, rate limits, quotas or response shapes for successful calls.

## Gemini 503 model fallback (Stage B)

Status: local only. Nothing deployed, no Vercel setting or environment variable changed.

Implemented centrally in `createGenAI()` (`src/server/gemini.ts`), so it covers all 15 AI routes without touching `src/server/app.ts`.

| Item | Behaviour |
|---|---|
| Primary / fallback | Routes request `gemini-3.8-flash`; the fallback is `gemini-3.6-flash` (GA, same published token price per Google's pricing page, as verified in Stage A). |
| Trigger | Only a primary failure with HTTP `503` / `UNAVAILABLE`. Everything else is rethrown unchanged: 400, 401, 403, 404, 408, 429 (both models share one project quota), 500, 502, 504, aborts, timeouts, network errors. |
| What changes | Only the `model` identifier, plus the transport timeout (`httpOptions.timeout` = time left of the shared deadline, so the `X-Server-Timeout` header is truthful). Response MIME type, system instruction, temperature and the rest are identical. |
| Attempts | At most **2 HTTP requests** per generation (one per model); SDK retries stay disabled. |
| Deadline | One shared 90 s controller/timer for both attempts; the fallback does not get a fresh 90 s. A caller `AbortSignal` cancels either attempt. Timer and listener are cleaned up in `finally`. |
| Skipped when | The shared controller is already aborted; the fallback is disabled or invalid; the requested model already is the fallback; fewer than 10 s of the deadline remain (the original 503 is rethrown). |
| Failure | If the fallback also fails, its error is rethrown and the existing `classifyError` mapping applies (`502 ai_upstream_error`, fixed message). No response format change; provider bodies are never forwarded. |
| Logging | One `logger.warn('gemini_fallback', { from, to, status })` per activation. No prompt, output, key or provider message. |

### Configuration: `GEMINI_FALLBACK_MODEL` (optional, server-side only)

| Value | Effect |
|---|---|
| unset or empty | `gemini-3.6-flash` |
| `off` | fallback disabled |
| a model id matching `^gemini-[a-z0-9][a-z0-9.\-]*$` | that model is the fallback |
| anything else | fallback disabled; one sanitized warning per process (the value is not logged); primary behaviour unchanged |

Never create this as a `VITE_` variable: Vite would copy it into the public bundle. No Vercel environment variable needs to be set for the default behaviour.

### Cost and quota notes

- Both models have the same published per-token price (both double on 2027-01-01, independent of this change), so a fallback call costs the same as a primary call.
- Google's documentation does not state whether a 503 is billed (UNVERIFIED); none is expected because no output is generated. A successful fallback is billed normally.
- Quota exhaustion (429) is deliberately not a fallback trigger: both models draw on the same key and project.

### Owner actions (not performed, not possible from the repo)

1. ~~Enable Fluid compute~~ Done by the owner. `maxDuration: 120` depends on it; plan tier is still UNVERIFIED.
2. Confirm the project's **Node.js Version** dashboard setting does not conflict (`engines.node` overrides it, DOCUMENTED).
3. Create the Upstash Redis database in **AWS ap-northeast-1 (Tokyo)** so function, Redis and Supabase share one region. Not done here (no Upstash configuration is authorised in Stage 3A). A different Upstash region risks spurious 503s against the 500 ms Redis command timeout (Stage 2 R-5); latency is UNVERIFIED until a Preview run.
4. Local verification ran on Node 22; Node 24 is UNVERIFIED until a Preview build. The bundle target (`node22`) runs on 24.

## Review

| Item | Finding | Label |
|---|---|---|
| Function entry point | `api/index.js` (generated by `npm run build:api`, committed). Vercel needs no `functions` entry to serve it. `api/` holds exactly one function file. | CONFIRMED (tree + test); discovery by Vercel UNVERIFIED until a Preview build |
| Rewrite | `/api/:__ironlog_api_path*` to `/api`. Only rewrite; no SPA fallback, no redirects, headers or routes. | CONFIRMED |
| Frontend routing | Framework preset, `npm run build`, `dist` and the frontend URL are untouched. `public/manifest.webmanifest`, `public/brand/icon-512.png` and `public/favicon.ico` exist and are outside `/api`. | CONFIRMED (files) |
| `VITE_API_BASE_URL` | Read only in `src/lib/apiFetch.ts`; commented out in `.env.example`. Same-origin `/api` is used. | CONFIRMED (repo); the Vercel project setting itself UNVERIFIED |
| Node version floor | Installed `@supabase/supabase-js` 2.118.0 requires Node >= 22; `redis` 6.3.0 and `@google/genai` 2.31.0 require >= 20; `helmet` >= 18. The bundle targets `node22`. **Node 20 is below the floor.** | CONFIRMED (package metadata) |
| Vercel Node versions | 24.x (default), 22.x and 20.x are offered; `engines.node` overrides the dashboard setting; `>=20.0.0` maps to the latest 24.x. | DOCUMENTED (Vercel docs, page dated 2026-02-27) |

## Values still unset

None of the decided settings are open. The Upstash database itself does not exist yet (owner action above).

## Not changed

Vite preset, build command, output directory, frontend origin, static asset paths, manifest and icon paths, `VITE_API_BASE_URL`, Stage 3B upload handling (the 4.5 MB platform body cap remains).
