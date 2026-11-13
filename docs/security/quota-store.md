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

The migration `supabase/migrations/20261102045148_ai_usage_quota.sql` must be applied before `supabase` is used. The
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

- `src/server/security/quotaFailure.test.ts` (store error mapping, degraded store, all 15 AI routes under both
  policies, wiring from configuration, configuration rules) and `startup.process.test.ts` (real `tsx server.ts`
  refusals). Supabase is faked at the `supabase-js` boundary; **no automated test talks to a real Supabase project**.
- `src/test/rls.aiUsageQuota.test.ts`: the real migration in PGlite (single connection: RLS, grants, argument checks).
- `src/server/security/quota.pg.integration.test.ts`: the real migration on a **real PostgreSQL server** with 60
  simultaneous connections (exactly `limit` allowed), user and bucket isolation, UTC day key independent of the session
  time zone, previous-day counters, limit 0, SQLSTATEs, `anon` and direct table access refused, catalog checks
  (RLS on, no policies, `SECURITY DEFINER`, `search_path = ''`, EXECUTE only for `authenticated`, none for PUBLIC).
  It needs `psql` on PATH and a **throw-away** PostgreSQL server in `PG_TEST_URL` (it creates a scratch database and,
  if missing, the cluster-wide roles `anon` and `authenticated`). Without `PG_TEST_URL` it is reported as skipped;
  with `REQUIRE_PG_TESTS=1` a missing server is a failure (use that in CI).

  ```bash
  docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
  REQUIRE_PG_TESTS=1 PG_TEST_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres npx vitest run src/server/security/quota.pg.integration.test.ts
  docker rm -f pgtest
  ```
  ```powershell
  # Windows: run from WSL (sudo apt install postgresql-client), or have psql.exe on PATH
  $env:REQUIRE_PG_TESTS="1"; $env:PG_TEST_URL="postgresql://postgres:pw@127.0.0.1:55432/postgres"
  npx vitest run src/server/security/quota.pg.integration.test.ts
  ```
- `scripts/verify-quota.test.ts`: the verification script's logic against a fake store.

## Verifying a real project (`npm run verify:quota`)

There is deliberately **no start-up check** for the migration. A boot-time call to `consume_ai_quota` needs a user's JWT
(the server has none at boot), and the function is not executable by `anon`, so a publishable-key-only schema lookup is
not a dependable existence check (not verified against PostgREST's introspection output). Instead, a missing or mis-granted function surfaces as `503 quota_unavailable` (log reason `rpc_PGRST202`,
`rpc_42883` or `rpc_42501`) and this opt-in script tells you why before you go live.

It runs the production `SupabaseQuotaStore` against your project with a real user JWT. Values come from environment
variables and are never printed. Use a **dedicated test account**.

```powershell
# PowerShell (values typed into your own shell, never into chat)
$env:SUPABASE_URL="https://<project-ref>.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY="<publishable key>"
$env:VERIFY_QUOTA_EMAIL="<test account email>"; $env:VERIFY_QUOTA_PASSWORD="<its password>"   # or: $env:VERIFY_QUOTA_JWT="<access token>"
npm run verify:quota                 # read-only: limit-0 probe + anonymous caller refused; writes nothing
npm run verify:quota -- --consume    # also: limit 3 sequence (3 allowed, 4th refused) + 8 simultaneous calls (exactly 3 allowed); writes 2 rows
```
```bash
SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... VERIFY_QUOTA_JWT=... npm run verify:quota
```

- Since the IL-04 migration (`20261103061647_ai_quota_bucket_allowlist.sql`) the live function accepts only the buckets of
  the `ai: true` endpoints in `src/server/security/endpoints.ts` and raises `22023 unknown bucket` for any other name, even
  with limit 0. The script therefore uses real bucket names taken from that list and invents none. If it reports
  `rpc_22023`, the script and the applied allow-list disagree. `scripts/verify-quota.test.ts` fails if the script uses a
  bucket that is not an `ai: true` bucket (checked against `endpoints.ts` and against the list inside the migration file).
- The default mode calls `consume_ai_quota(<real bucket>, 0)`; with limit 0 the function validates the bucket and returns
  before touching the table.
- `--consume` uses two further real buckets with limit 3 and so leaves two counter rows (`used = 3`) for the test user for
  the rest of that UTC day. Use a **dedicated test account only**: those buckets are real, so the account's own quota for
  them is used up for the day. Run it at most once per UTC day per account; a second run the same day fails the two
  consumption checks (the output says why). The rows need no manual cleanup: the function deletes a user's counters older
  than 7 days the first time that user uses any bucket on a new UTC day, and they also disappear if the test user is deleted.
- Email/password mode signs in and so creates an auth session for that account.
- Exit codes: 0 all passed, 1 a check failed, 2 bad configuration.

To check the **application** path end to end (auth middleware + quota gate + store), start the server with the same
variables plus `QUOTA_STORE=supabase`, send authenticated requests until you receive `429 quota_exceeded`, then point
`SUPABASE_URL` at an unreachable host and confirm `503 quota_unavailable` with `Retry-After: 5`.

Which routes fail closed and which may degrade, with the justification for each: [route-failure-policy.md](route-failure-policy.md).
