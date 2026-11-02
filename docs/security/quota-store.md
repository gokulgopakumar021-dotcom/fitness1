# Daily AI quota: store, failure policy, tests

Every AI route has a per-user daily quota (`src/server/security/endpoints.ts`, overridable with `AI_QUOTA_OVERRIDES`).
The counter resets at 00:00 UTC. A request is counted when it is **attempted**; it is not refunded if Gemini then fails.

## Configuration

| Variable | Values | Default |
|---|---|---|
| `QUOTA_STORE` | `memory`, `supabase` | `supabase` if `NODE_ENV=production`, else `memory` |
| `QUOTA_FAILURE_POLICY` | `closed`, `degraded` | `closed` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `VITE_` equivalents) | | required when the store is `supabase` |

Startup refuses to run (exit 1, names the setting, never a value) when: `QUOTA_STORE` or `QUOTA_FAILURE_POLICY` has an
unrecognised value, or the store is `supabase` without the Supabase URL and key. Production with `QUOTA_STORE=memory`
starts with a warning (daily limits are per instance and reset on restart).

The migration `supabase/migrations/20261031000000_ai_usage_quota.sql` must be applied before `supabase` is used. The
server calls `consume_ai_quota` with the **caller's own JWT**; no service-role key is needed or used.

## Failure behaviour

If the shared store cannot give a trustworthy answer (network error, timeout after 3 s, RPC error such as a missing
function or permission error, unexpected response shape), the outcome depends on the policy:

| Policy | AI routes except the three below | `extract-plan`, `ai-generate-physique`, `ai-physique-analysis` |
|---|---|---|
| `closed` (default) | 503 `quota_unavailable`, `Retry-After: 5`, Gemini is not called | same |
| `degraded` | request proceeds, counted per instance in memory; response has `X-Quota-Mode: degraded`; throttled `quota_store_degraded` log | **still 503 `quota_unavailable`** |

- The 503 body is `{ success:false, error, code:"quota_unavailable", requestId }`. Database error text never reaches the
  client or the logs; logs carry a short reason code only (`timeout`, `transport`, `no_token`, `not_configured`,
  `bad_shape`, `rpc_<code>`, `rpc_error`).
- Degraded mode multiplies every daily limit by the number of instances. Use it only knowingly.
- The quota check runs before the route handler, so nothing reaches Gemini without having been counted or refused.
- Barcode and health do not use the daily quota and are unaffected. Requests that fail authentication or validation
  never reach the quota check and do not consume quota.
- A quota that is exhausted is a normal 429 `quota_exceeded`, unrelated to store failures.

## Local development

No setup: with `NODE_ENV` unset or `development`, the in-memory store is used, nothing connects to Supabase, and limits
reset when the server restarts. To exercise the shared store locally set `QUOTA_STORE=supabase` plus the Supabase variables.

## Tests

`src/server/security/quotaFailure.test.ts` (store error mapping, degraded store, all 15 AI routes under both policies,
wiring from configuration, configuration rules) and `startup.process.test.ts` (real `tsx server.ts` refusals). Supabase is
faked at the `supabase-js` boundary; **no test talks to a real Supabase project** (see the Stage 5 verification for that).
