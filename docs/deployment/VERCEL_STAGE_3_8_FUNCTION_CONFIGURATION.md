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

- One `AbortController` per `generateContent` call fires at 90 s for the **whole** call, including the retry, back-off and fallback attempts described below. The SDK's `httpOptions.timeout` alone is per HTTP attempt. Corrected after review: with `@google/genai` 2.31.0 (the version pinned in `package-lock.json`) and `httpOptions.retryOptions` **unset**, the SDK makes exactly **one** HTTP request and does not retry or back off; it retries (5 attempts, 408/429/500/502/503/504) only when `retryOptions` is set, and `createGenAI()` never sets it (CONFIRMED in the SDK source and by a mocked-fetch test: a 503 is one call). An earlier version of this document said the SDK retries up to 5 times; that was wrong for this configuration. The shared deadline stays as a hard bound regardless.
- The abort surfaces as `AbortError`, which the existing `classifyError` already maps to `504 upstream_timeout` with a fixed message. No provider text, key or stack is returned. No route handler changed other than the client constructor.
- The timer is cleared when the call settles; a caller-supplied abort signal and the existing `User-Agent` header are preserved.
- 90 s is 30 s below `maxDuration` (120 s), leaving room to validate and answer. Each AI route makes one Gemini call, so the route total stays under 120 s. The adaptive-explanation route keeps its own shorter 20 s race.
- This is a behaviour change (Stage 2 listed it as needing approval; approved by decision 3). It does not alter authentication, rate limits, quotas or response shapes for successful calls.

## Gemini 503 recovery: one bounded retry, then one fallback request (Stage B, reliability update)

Status: local only. Nothing deployed, no Vercel setting or environment variable changed.

Implemented centrally in `createGenAI()` (`src/server/gemini.ts`), so it covers all 15 AI routes without any route-level retry code. The fallback model is unchanged (`gemini-3.6-flash`).

### Retry sequence (maximum 3 HTTP attempts per generation)

| Step | Request | Condition to proceed |
|---|---|---|
| 1 | Primary model (routes request `gemini-3.8-flash`) | Always. A success is returned immediately and nothing further is started. |
| 2 | Wait a jittered back-off, then retry the **primary once** | Step 1 returned HTTP `503` / `UNAVAILABLE`, the call is not aborted, and at least 10 s of the deadline would remain **after** the wait. |
| 3 | **One** request to the fallback model (`gemini-3.6-flash`, never retried) | Step 2 also returned `503` / `UNAVAILABLE`, a fallback is configured and differs from the requested model, the call is not aborted, and at least 10 s of the deadline remain. |

If every attempt fails, the last error is rethrown and the existing `classifyError` mapping applies (`502 ai_upstream_error`, fixed message). No response format change; provider bodies are never forwarded. The fallback and the retry send identical parameters; only the `model` identifier and the transport timeout (`X-Server-Timeout` = time really left of the shared deadline) differ.

### Back-off

`delay = min(2000 ms, 1000 ms x 2^retryIndex x (1 + jitter))`, jitter uniform in `[0, 1)`. Only one retry exists, so `retryIndex` is 0 and the delay is **1.0 to 2.0 s**. There is no delay before the fallback request, so the total recovery delay of one generation is at most 2 s. The wait is abortable and its timer is cleared on every path.

### Error classification

| Result of an attempt | Action |
|---|---|
| `503` / `UNAVAILABLE` | Eligible for the next step (see the table above). Capacity errors; Google lists 503 as retryable with back-off. |
| 400, 401, 403, 404, 408, 429, 500, 502, 504 | Never retried, no fallback; rethrown unchanged. 429 (rate limit or quota) is not a capacity error and retrying it only spends more quota. |
| Network error, abort, timeout | Never retried; rethrown unchanged (`AbortError` maps to `504 upstream_timeout`). |
| Success | Returned at once. No further request is ever started. |

### Deadline and cancellation

One `AbortController` and one 90 s timer cover the **whole** generation (all attempts and the back-off). Nothing gets a fresh deadline. A caller `AbortSignal` cancels the current attempt or the back-off wait immediately, and no later attempt is started. The timer and the caller-signal listener are cleaned up in `finally`.

### Logging events (structured JSON, one `generationId` per generation)

| Event | Level | When | Fields |
|---|---|---|---|
| `gemini_retry` | warn | a 503 triggered the primary retry | `generationId`, `attempt`, `model`, `status`, `delayMs` |
| `gemini_retry_succeeded` | info | the primary retry answered | `generationId`, `model`, `attempts`, `elapsedMs` |
| `gemini_fallback` | warn | a second 503 triggered the fallback request | `generationId`, `attempt`, `from`, `to`, `status` |
| `gemini_fallback_succeeded` | info | the fallback model answered | `generationId`, `from`, `to`, `attempts`, `elapsedMs` |
| `gemini_recovery_failed` | warn | recovery ended without a response | `generationId`, `reason`, `attempts`, `models`, `statuses`, `fallbackAttempted`, `elapsedMs` |

`reason` is one of `exhausted`, `no_fallback`, `insufficient_time`, `aborted`, `non_retryable`. A first-attempt success, and a first-attempt failure that is not a 503, emit none of these (the route logs the latter). Never logged: prompts, conversation history, user content, system instructions, API keys, tokens or provider error bodies.

### AI Coach generation settings

`/api/ai-personal-trainer` sends `thinkingConfig.thinkingLevel = "LOW"` and `maxOutputTokens = 4096`. Google's thinking documentation lists `low` as supported on both Gemini 3.8 Flash and Gemini 3.6 Flash (the default is `medium`); `minimal` is **not** supported by 3.8 Flash (it returns a 400) and is deliberately not used. `maxOutputTokens` counts thinking tokens, so 4096 is generous relative to the 4000-character reply cap. The system instruction and response format are unchanged. No other route sets `thinkingConfig` or `maxOutputTokens`.

All 15 AI routes previously sent `temperature` (0.1 to 0.3). Google's troubleshooting guidance says Gemini 3.6 and later ignore `temperature` and `top_p` and may reject them with a 400 in a future release, so they were removed. No other generation setting (for example `responseMimeType`, `systemInstruction`) was changed.

### Configuration: `GEMINI_FALLBACK_MODEL` (optional, server-side only)

| Value | Effect |
|---|---|
| unset or empty | `gemini-3.6-flash` |
| `off` | fallback disabled (the primary is still retried once on a 503) |
| a model id matching `^gemini-[a-z0-9][a-z0-9.\-]*$` | that model is the fallback |
| anything else | fallback disabled; one sanitized warning per process (the value is not logged) |

Never create this as a `VITE_` variable: Vite would copy it into the public bundle. No Vercel environment variable needs to be set for the default behaviour, and the retry timing is not configurable by environment variable.

### Free Tier, quota and cost notes

- The Gemini project is on the **Free Tier**. Google's rate limits apply per project, not per API key, so additional keys from the same project add no capacity. Google states that specified limits are not guaranteed and actual capacity may vary.
- A 503 is a capacity error; a quota or rate-limit error is a 429. The two are handled differently: 503 is retried within the bounds above, 429 never is.
- **A paid tier is not documented to eliminate 503 errors.** The retry and fallback improve the chance of an answer during a short capacity spike; they cannot guarantee one during a longer outage.
- Retries are sent only after a 503, so normal traffic cost is unchanged. In the worst case a failing generation makes 3 HTTP requests instead of 2. Google's documentation does not state whether a 503 is billed (UNVERIFIED); none is expected because no output is generated. A successful response (primary, retry or fallback) is billed normally and nothing is requested after it. This document states no prices or quota values.
- Lower thinking on the AI Coach reduces billed output tokens relative to the `medium` default; the size of the saving is not measured here.

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
