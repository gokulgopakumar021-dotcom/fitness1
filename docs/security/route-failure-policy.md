# Per-route failure policy

What every `/api` route does when a protection it depends on cannot answer: the shared **rate-limit store** (Redis) or
the shared **quota store** (Supabase `consume_ai_quota`). This is the reference for `routePolicy.test.ts`, which checks
every row below against the real app.

## Rules

1. **Closed by default.** If the rate store or the quota store cannot give a trustworthy answer, the request is
   refused before the route handler runs: `503 rate_limit_unavailable` / `503 quota_unavailable`, `Retry-After: 5`, no
   Gemini call, no upstream spend.
2. **Degraded is opt-in and global.** `RATE_LIMIT_FAILURE_POLICY=degraded` and `QUOTA_FAILURE_POLICY=degraded` switch the
   *degradable* routes to per-instance counting. Every degraded answer is announced (`X-RateLimit-Mode: degraded`,
   `X-Quota-Mode: degraded`, throttled `rate_limit_degraded` / `quota_store_degraded` logs). Limits then multiply by the
   number of instances. There is no per-route override: a route is either always closed or degradable.
3. **Always closed, whatever the policy:** `extract-plan`, `ai-generate-physique`, `ai-physique-analysis`
   (`ALWAYS_CLOSED_BUCKETS` in `endpoints.ts`). Their daily quota is never counted in memory.
4. **Health** (`GET /api/health`) is unchanged in every mode: answers `200`, never marked degraded, exposes only
   `status` and `time`, spends nothing.
5. Quota is **counted on attempt**, after authentication, rate limiting and validation and before the handler. There
   is no refund when Gemini fails or when the handler answers locally (see "Observations").

## Outcome matrix

| Situation | Always-closed (3) | Other AI routes (12) | Barcode | Health |
|---|---|---|---|---|
| Rate store down, `closed` (default) | 503 `rate_limit_unavailable` | 503 `rate_limit_unavailable` | 503 `rate_limit_unavailable` | 200 |
| Rate store down, `degraded` | 503 `rate_limit_unavailable` | served, `X-RateLimit-Mode: degraded` | served, `X-RateLimit-Mode: degraded` | 200 |
| Quota store down, `closed` (default) | 503 `quota_unavailable` | 503 `quota_unavailable` | not affected | not affected |
| Quota store down, `degraded` | 503 `quota_unavailable` | served, `X-Quota-Mode: degraded` | not affected | not affected |
| Quota exhausted (store healthy) | 429 `quota_exceeded` | 429 `quota_exceeded` | not applicable (no daily quota) | not applicable |

With the rate store down the auth middleware also refuses first (its failed-login lockout uses the same store), so under
`closed` even unauthenticated requests get 503 rather than 401. That is intended: nothing is evaluated without protection.

## Per-route justification

"Caller" is the client component that sends the request; "Trigger" is what makes it fire. Limits are the defaults in
`endpoints.ts` (daily quota / per-minute / body size) and can be overridden with `AI_QUOTA_OVERRIDES`.

| Route | Caller / trigger | Gemini input | Limits | Policy | Why |
|---|---|---|---|---|---|
| `POST /extract-plan` | `PlansUploadView`, user uploads a file | PDF/image (up to 14 MB) or text | 10 / 3 / 14 MB | **Always closed** | The only route that forwards user files to Gemini: largest request, most expensive call, widest input surface (MIME and signature checks exist, but the payload is still untrusted). A per-instance counter would multiply a 10/day cap by instance count on the costliest route. A failure costs one retry of a rare action. |
| `POST /ai-physique-analysis` | `DreamPhysiqueModal`, user taps analyse | text (body metrics, goals) | 10 / 3 / 256 KB | **Always closed** | Largest structured output of any route (nutrition plus multi-day training blueprint) and body-composition inputs with calorie/macro targets as output. Rare, user-initiated, so closing costs little. |
| `POST /ai-generate-physique` | `DreamPhysiqueModal`, earlier step of the same flow | text (archetype, free-text vision) | 10 / 3 / 64 KB | **Always closed** | Owner decision. The cost argument is weak (text only, output capped at 1,000 characters, 64 KB body), so this row rests on keeping one feature flow consistent: a degraded "generate" that leads into a refused "analyse" gives users half a feature and still adds uncounted exposure. Candidate to move to degradable if the owner prefers (one line in `ALWAYS_CLOSED_BUCKETS` plus the test lists). |
| `POST /generate-plan` | none found in `src/` | text | 20 / 5 / 64 KB | Degradable | No current client; kept as a registered route. Text-only, small, tight quota. See "Observations". |
| `POST /exercise-coach` | `WorkoutSessionTracker`, user opens coach on an exercise | text | 60 / 10 / 64 KB | Degradable | Used mid-workout, so an outage should not take it away; tiny text prompt, advisory output only. |
| `POST /generate-ai-routine` | `AiRoutineBuilderModal`, user builds a routine | text | 20 / 5 / 256 KB | Degradable | User-initiated, text-only, moderate output, tight quota. Per-instance counting at worst allows N times 20 routines per day. |
| `POST /ai-food-parser` | `NutritionView`, user submits a meal | text | 100 / 15 / 64 KB | Degradable | Highest-frequency everyday action, smallest prompt and output. Closing it on an outage would degrade the core logging flow for the least protection gained. |
| `POST /ai-workout-insights` | none found in `src/` | text (session) | 40 / 8 / 1 MB | Degradable | No current client; see "Observations". |
| `POST /ai-plan-overload-tuning` | `ProgressionView`, button | text (plan + history summary) | 30 / 5 / 1 MB | Degradable | User-initiated, text-only, advisory. |
| `POST /ai-nutrition-coach` | none found in `src/` | text | 40 / 8 / 256 KB | Degradable | No current client; see "Observations". |
| `POST /ai-recovery-insights` | `AiRecoveryInsightsPanel`, button (`handleRunAiAnalysis`) | text (up to 4 MB history) | 40 / 8 / 4 MB | Degradable | A local recovery analysis is already shown without the call (the AI result only refines it), so a refusal costs nothing essential. The 4 MB body is the largest of the degradable routes; its per-minute limit (8) still applies per instance while degraded. |
| `POST /ai-personal-trainer` | `AiTrainerView`, `FloatingTrainerWidget`, each chat message | text (chat history) | 100 / 12 / 1 MB | Degradable | Chat is the main AI surface and is interactive; a daily quota of 100, level with the food parser. Closed-only would turn an infrastructure blip into a visibly dead assistant. |
| `POST /adaptive-coach/explain` | `AdaptiveReviewModal`, fires when the modal opens | text (coaching context) | 60 / 10 / 256 KB | Degradable | Optional wording on top of a rule-based review that is shown regardless; the client already treats failure as "unavailable". Safest degradable route. |
| `POST /ai-form-analyzer` | `ExercisePostureModal`, user question | text | 40 / 8 / 64 KB | Degradable | User-initiated, small text prompt. |
| `POST /ai-warmup-generator` | `DynamicWarmupModal`, user opens modal | text | 30 / 6 / 64 KB | Degradable | User-initiated, text only. |
| `GET /nutrition/barcode/:barcode` | `openFoodFactsService`, camera scan | none (Open Food Facts lookup, 8 s timeout, in-memory cache) | rate limit only (30/min) / 64 KB | Rate-limited only; refused (503) under closed, served under degraded | No Gemini and no quota: the risk is using the server as a proxy to a third party, which authentication plus the per-minute limit bound. It follows the global rate policy like every other route; it is not special-cased open. |
| `GET /health` | uptime probe | none | per-IP only | Fail-open, unchanged | The probe must answer during an outage; it reveals nothing and spends nothing. |

### Why the 12 degradable routes are acceptable to degrade

All 12 are text-in, text-out, advisory output validated against a schema (`aiSchemas.ts`), authenticated, and still bound
by the per-user per-minute limit and a per-instance daily count while degraded. The worst case of a prolonged outage with
`degraded` is the quota multiplied by the instance count, not an unlimited path. If an operator cannot accept that,
leave the default (`closed`).

## Observations (no change made)

1. **Three registered routes have no client caller** in `src/`: `generate-plan`, `ai-workout-insights`,
   `ai-nutrition-coach`. They remain reachable by any authenticated user and consume quota. Removing them is a
   product decision and was not done. Alternative: set their quota to `0` with `AI_QUOTA_OVERRIDES` in production.
2. **The client does not read the new error codes.** No component handles `quota_exceeded`, `quota_unavailable`,
   `rate_limited` or `rate_limit_unavailable`, or `Retry-After`; users see each feature's generic failure message.
   No client retries automatically, so a 503 does not cause a retry storm. A small shared mapping in `apiFetch`
   consumers is a worthwhile follow-up (SEC-02 asked for client 429 handling) but is a UI change.
3. **Quota is spent on requests that never reach Gemini.** `adaptive-coach/explain` answers `nothing_to_explain`
   locally when there is no data and still counts. Six routes (`ai-personal-trainer`, `adaptive-coach/explain`,
   `ai-form-analyzer`, `ai-warmup-generator`, `ai-generate-physique`, `ai-physique-analysis`) answer `200` with a local
   fallback when `GEMINI_API_KEY` is missing, whereas nine others return 503. Both are consistent with "counted on
   attempt"; neither is a security issue.
4. **A Supabase outage may surface in the auth layer first.** Token verification (`auth.getUser`) and the quota RPC both
   go to the same Supabase project, so during a project-wide outage requests can be refused at authentication before
   the quota store is consulted. Not exercised against a real outage (see Verification).

## Verification

- **Verified by automated test, in-process, with fakes at the Redis-store and `supabase-js` boundaries:**
  `src/server/security/routePolicy.test.ts` runs all 17 routes through all 16 combinations of rate store
  (healthy/down) x rate policy x quota store (healthy/down) x quota policy and compares status, error code, both mode
  headers, Gemini call count, and quota RPC call count with the matrix above. It also asserts the three always-closed
  routes stay refused with both policies degraded and both stores down, and that no database error text is logged.
- **Verified by existing tests:** `quotaFailure.test.ts` (quota side, all 15 routes) and `redisApp.integration.test.ts`
  (real Redis cut through a TCP proxy; needs `REDIS_TEST_URL`).
- **Not verified:** a real Redis outage mid-traffic in production, a real Supabase outage, managed Redis with TLS/ACL.
