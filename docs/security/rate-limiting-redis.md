# Rate limiting: Redis store, failure policy, tests

## What is shared and what is not

| Layer | Store | Shared across instances |
|---|---|---|
| Per-IP, per-user, per-endpoint per-minute limits, failed-auth lockout | `RATE_LIMIT_STORE` (`memory` or `redis`) | only with `redis` |
| Daily AI quota | `QUOTA_STORE` (`memory` or `supabase`) | only with `supabase` |

## Configuration

| Variable | Values | Default |
|---|---|---|
| `RATE_LIMIT_STORE` | `memory`, `redis` | `redis` if `NODE_ENV=production`, else `memory` |
| `REDIS_URL` | `rediss://user:password@host:port` (or `redis://`) | none; **required** when the store is `redis` |
| `RATE_LIMIT_FAILURE_POLICY` | `closed`, `degraded` | `closed` |

**Local development:** set nothing. Counters are in memory. To try Redis locally: `RATE_LIMIT_STORE=redis` and `REDIS_URL=redis://127.0.0.1:6379`.

**Production:** set `REDIS_URL` (TLS) and leave the store unset. Set `TRUST_PROXY` correctly or every user shares the proxy's IP.
Choosing `RATE_LIMIT_STORE=memory` in production is allowed (single instance) but is an explicit opt-out and logs
`security_config_warning`.

## Startup behaviour (fail fast)

`server.ts` calls `prepareSecurityRuntime()` before listening. The process exits with code 1 and a credential-free
message when: a setting is invalid; `REDIS_URL` is missing for the `redis` store; or Redis is not reachable within 5 s.
There is no automatic fall-back to memory. This holds under both failure policies: the policy governs outages **after**
a successful start.

## Failure policy while running

| Situation | `closed` (default) | `degraded` |
|---|---|---|
| Redis down or too slow (500 ms command timeout) | `503 rate_limit_unavailable`, `Retry-After: 5` | per-instance counting, header `X-RateLimit-Mode: degraded` |
| `extract-plan`, `ai-generate-physique`, `ai-physique-analysis` | 503 | **still 503** (always fail-closed) |
| `GET /api/health` | 200, body unchanged, no extra headers | same |
| Failed-auth lockout | 503 with everything else | counts per instance |
| Recovery | automatic reconnect with back-off; no restart | same; returns to Redis on the next successful call |

`degraded` is **not** distributed protection. Choose it only if availability matters more than exact limits during a
Redis outage. It is logged (`rate_limit_degraded`, throttled) every time it is in effect.

## Redis design notes

- One Lua script does `INCR` + `PEXPIRE` + `PTTL`, so counting is atomic and a key cannot outlive its window.
- Window length comes from Redis' TTL, not instance clocks.
- Keys are `<prefix>:rl:<label>:<sha256 prefix>`: hostile or huge input cannot collide or grow the key, and raw IPs/user ids are not stored in Redis.
- Commands fail immediately when disconnected (no offline queue). A timed-out command may still execute server-side, so a request that got a 503 can still have been counted.
- Use a Redis dedicated to (or prefix-separated for) this app. `noeviction` is not required; if Redis evicts a key, that counter simply restarts.

## Integration tests

`redisRateStore.integration.test.ts`, `redisApp.integration.test.ts`, `startup.process.test.ts` run against a real Redis through a
TCP proxy that can cut, restore and stall the connection.

- Redis source: `REDIS_TEST_URL` if set (e.g. a CI service container), otherwise a throw-away local `redis-server` on a free port (must be on `PATH`).
- **Without Redis the tests are SKIPPED and a notice is printed.** With `REQUIRE_REDIS_TESTS=1` they **fail** instead.
- Windows: Redis has no official native build. Use WSL, Docker (`docker run -p 6379:6379 redis:7`) and `REDIS_TEST_URL=redis://127.0.0.1:6379`.
  - PowerShell: `$env:REQUIRE_REDIS_TESTS="1"; $env:REDIS_TEST_URL="redis://127.0.0.1:6379"; npm test`
  - bash: `REQUIRE_REDIS_TESTS=1 REDIS_TEST_URL=redis://127.0.0.1:6379 npm test`

## CI requirements

Run `npm ci`, `npm run lint`, `npm test` and `npm run build` with a Redis 7 service and `REQUIRE_REDIS_TESTS=1` plus
`REDIS_TEST_URL` set, so a missing Redis can never produce a green run. (This repository has no CI workflow yet: TST-01.)
