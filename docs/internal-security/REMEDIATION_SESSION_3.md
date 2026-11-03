# Remediation Session 3 — IL-04 follow-up (verify-quota), IL-05, IL-07 to IL-10

Date: 3 November 2026
Scope (in this order, one finding at a time, owner approval after each): step 0 IL-04 follow-up, IL-05, then IL-07, IL-08, IL-09, IL-10.

**Final status: PARTIALLY COMPLETED (in progress; updated after each approved item).** Only step 0 is done so far. This file does not claim the application is fully secure. Release decision unchanged: **CONDITIONALLY READY (web only)**; Android/iOS remain NOT IMPLEMENTED / NOT VERIFIED.

---

## A. Initial state

| Item | Value |
|---|---|
| Branch / HEAD | `main` at `7fdc7e6` ("il03-il06-il04plan-remediation"), on top of `e91d092`. `git fetch` showed no divergence; working tree clean. The task text had an unfilled placeholder for the Session 2 push hash, so the hash itself could not be compared: HEAD was accepted because it is the direct child of `e91d092` and contains exactly the Session 2 files. |
| Baseline tests | **2,641 passed, 0 failed, 36 skipped** (141 files passed, 2 skipped). Reproduced at the start of this session. `npx tsc --noEmit` exit 0. |
| Live migrations (read-only `list_migrations`) | Last is `20261103061647 ai_quota_bucket_allowlist`, as expected. |
| Live security advisor (re-run 3 Nov 2026 06:21 UTC) | 1 INFO + 3 WARN entries: `auth_leaked_password_protection` WARN (IL-02, open by owner decision); `authenticated_security_definer_function_executable` WARN on `consume_ai_quota` and `delete_own_account` (by design, signed-in users must call both; same as Session 2); `rls_enabled_no_policy` INFO on `ai_usage_counters` (by design). So IL-02 is the only *accepted open risk*, but it is not the only item the advisor lists. IL-02 was not touched and is **not** enabled. |
| IL-01 | Fixed in the repo; live deployment NOT VERIFIED (owner to redeploy). |
| GitHub repo | Still public (anonymous clone succeeded). History not altered. |

---

## B. Step 0 — IL-04 follow-up: `scripts/verify-quota.ts` used buckets the live function now rejects

### Problem (confirmed)
The applied migration raises `22023 unknown bucket` for any bucket outside the 15 `ai: true` buckets, **before** the limit-0 shortcut. The script probed with `verify-quota-probe` and `--consume` used `verify-quota-seq-*` / `verify-quota-par-*`, so every mode would have failed against the live project. Demonstrated against the real migration SQL in PGlite (test below), not against the live project.

### Change
- `scripts/verify-quota.ts`: buckets now come from `ENDPOINTS` (`ai: true`) in `src/server/security/endpoints.ts`, so the script cannot drift from the endpoints list. The first AI bucket is used for the limit-0 probes (signed-in and anonymous), the next two for `--consume`. The limit-0 probe still writes nothing (validated first, then returns before the table).
- Added the hint `rpc_22023` ("unknown bucket: script and live allow-list disagree").
- Behaviour change to be aware of: `--consume` now uses **real** buckets (limit 3), so it leaves two rows at `used = 3` for the test user for the rest of that UTC day. It can be run once per UTC day per dedicated test account; a same-day rerun fails the two consumption checks and the output now says why. The rows need no manual cleanup (the function deletes the caller's counters older than 7 days on first use of a bucket on a new UTC day).
- `docs/security/quota-store.md`: verification section updated; the stale "delete ... like 'verify-quota-%'" instruction removed.
- Not changed: the migration, the live database, `endpoints.ts`, `quota.ts`.

### Evidence
`scripts/verify-quota.test.ts` (12 -> 19 tests):
- Required guard: the fake store now refuses non-AI buckets with `rpc_22023` like the live function, and a test fails if the script (probe, anonymous probe or `--consume`) uses any bucket that is not an `ai: true` bucket in `endpoints.ts` **or** not in the allow-list inside the migration file. It also fails if the source contains `verify-quota-` strings or the docs mention them.
- Three different real buckets are used (probe / sequence / simultaneous); `rpc_22023` hint test; same-day rerun message test.
- New PGlite block: runs the script's real logic against the real original + IL-04 migrations through a QuotaStore calling `consume_ai_quota` as `authenticated`/`anon`: the old bucket names are refused (22023, no row), read-only mode passes and writes no row, `--consume` passes and leaves exactly 2 rows at `used = 3` in real buckets, a same-day rerun fails with the explanation.
- **Mutation checks (all restored afterwards):** probe back to `verify-quota-probe`: 11 of 19 fail; sequence bucket a made-up name: 5 fail; anonymous probe a made-up name: 2 fail; docs with the old cleanup line: 1 fails.

### NOT verified
- No live call was made (no test account/JWT available; read-only on live Supabase). The script has **not** been run against the live project; PGlite is a model of the live function (single connection, no PostgREST).

---

## C. Regression results (after step 0)

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` exit 0 |
| Full tests | PASS | 141 files passed, 2 skipped; **2,648 passed, 0 failed, 36 skipped** (baseline 2,641 / 0 / 36; +7 = the new tests) |
| 36 skipped | NOT VERIFIED | Same env-gated Redis / real-PostgreSQL suites as the baseline |
| Production build | PASS | `rm -rf dist && npx vite build` built; no `aistudio` or `.md` files in `dist/` |
| Mutation checks | PASS | See section B |
| Live Supabase | READ-ONLY | `list_projects`, `get_advisors(security)`, `list_migrations` only |

---

## D. Git changes (nothing committed, pushed or deployed)

Modified: `scripts/verify-quota.ts`, `scripts/verify-quota.test.ts`, `docs/security/quota-store.md`
Added: `docs/internal-security/REMEDIATION_SESSION_3.md` (this file; later patches extend it, so they depend on this one)

No dependency, lockfile, migration, config or mobile change.

---

## E. Remaining findings

IL-05, IL-07, IL-08, IL-09, IL-10: not started. IL-02: open by owner decision. Observations carried over (not changed): `ThemeContext` unscoped key (allow-listed), public GitHub repository containing `docs/internal-security/`, unknown `/assets/*` paths return the SPA shell.

## F. Final status

**PARTIALLY COMPLETED** (in progress): step 0 done, pending owner approval.
