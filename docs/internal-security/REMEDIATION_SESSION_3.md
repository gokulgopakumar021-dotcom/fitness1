# Remediation Session 3 — IL-04 follow-up (verify-quota), IL-05, IL-07 to IL-10

Date: 3 November 2026
Scope (in this order, one finding at a time, owner approval after each): step 0 IL-04 follow-up, IL-05, then IL-07, IL-08, IL-09, IL-10.

**Final status: PARTIALLY COMPLETED (in progress; updated after each approved item).** Step 0 (pushed as `d766c5d`), IL-05 (pushed as `321e3c6`) and IL-07 (web part) are done so far. This file does not claim the application is fully secure. Release decision unchanged: **CONDITIONALLY READY (web only)**; Android/iOS remain NOT IMPLEMENTED / NOT VERIFIED.

---

## A. Initial state

| Item | Value |
|---|---|
| Branch / HEAD (session start) | `main` at `7fdc7e6` ("il03-il06-il04plan-remediation"), on top of `e91d092`. `git fetch` showed no divergence; working tree clean. The task text had an unfilled placeholder for the Session 2 push hash, so the hash itself could not be compared: HEAD was accepted because it is the direct child of `e91d092` and contains exactly the Session 2 files. |
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

## B2. IL-05 — Capacitor CLI dev-dependency advisories (LOW)

### Findings re-captured (the audit had no versions or IDs)
| Package | Installed | Advisory | Fixed in |
|---|---|---|---|
| `glob` | 13.0.6 | GHSA-3g3m-2fjr-6pw4 (abort signal does not stop a running search) | 14.0.2 or later |
| `minimatch` | 10.2.6 | GHSA-g3hv-75wg-m249 (denial of service, crafted patterns) | 11.0.1 or later |
| `rimraf` 6.1.3, `@capacitor/cli` 8.6.0 | | flagged only through the chain above | n/a |

All four are `dev` in the lockfile; `npm audit --omit=dev` = 0 before and after. Single chain: `@capacitor/cli` -> `rimraf ^6.0.1` -> `glob ^13.0.3` -> `minimatch ^10.2.2`. The CLI calls `rimraf` only in `cap migrate` and the iOS archive build.

### Why no upgrade
`@capacitor/cli` 8.6.0 is the latest stable release; the newest `rimraf` (6.1.3) still requires `glob ^13`; `@capacitor/cli` 9.0.0-beta.0 still uses `rimraf ^6` and needs Node 24 or later. `npm audit fix --force` would downgrade the CLI to 4.8.2 beside `@capacitor/core|android|ios` 8.6.0 and was not used.

### Change (owner approved the overrides)
- `package.json`: `"overrides": { "glob": "^14.0.3", "minimatch": "^11.0.4" }`.
- `package-lock.json`: only `glob` 13.0.6 -> 14.0.3, `minimatch` 10.2.6 -> 11.0.4, `path-scurry` 2.0.2 -> 3.0.0, and the new `@isaacs/nonrecursive-glob-match` 1.0.3 (all dev). Edited so that no other entry changes: a plain `npm install` in the sandbox also added six unrelated nested `@tailwindcss/oxide-wasm32-wasi` entries, which were deliberately left out.
- `docs/security/dependency-overrides.md`: reason, trade-off, and when to remove the override.
- `src/test/devDependencyOverrides.test.ts` (4 tests): fails if the overrides are missing or their floor is below the fixed versions, if any `glob` or `minimatch` copy in the lockfile is below the fixed version, or if they stop being dev-only.

### Evidence
- From the real lockfile: `npm ci --ignore-scripts` succeeds, `npm ls` exit 0 (shows `glob@14.0.3 overridden`, `minimatch@11.0.4 overridden`, `rimraf@6.1.3`, `@capacitor/cli@8.6.0`), `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities**.
- Functional spot checks (sandbox copy): `npx cap --version` prints 8.6.0; `rimraf` removes a folder and glob patterns; `glob` rejects an already-aborted search with `AbortError`.
- **Mutation checks (all restored, files byte-identical):** overrides removed: 1 test fails; lockfile back to the old entries: 1 fails; glob override floor lowered to `^13.0.6`: 1 fails; `minimatch` 11.0.0 in the lockfile: 1 fails.

### Residual risk and NOT verified
- `rimraf` 6 declares `glob ^13`, so `glob` 14 with it is an off-spec combination. Remove the override when a `@capacitor/cli` release resolves fixed versions by itself.
- NOT VERIFIED: the CLI against real Android/iOS projects (none exist), and a Windows `npm ci`.

---

## B3. IL-07 — Supabase session persisted in localStorage (INFORMATIONAL on web; blocker for mobile)

### Re-checked against current `main` (`321e3c6`)
- `src/lib/supabase.ts` still uses `persistSession: true` with the default storage, PKCE flow. Unchanged; this is standard supabase-js behaviour.
- The audit's mitigations: (1) strict production CSP, already asserted in `security.test.ts` (no `unsafe-inline`/`unsafe-eval` for scripts); (2) no XSS sinks in `src/`. Re-run: **zero** uses of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` in production code (matches exist only inside test files that read rendered HTML). Mitigation (2) was not enforced by any test anywhere.
- The finding stays accurate and is not a vulnerability on the web; it needs no behavioural change.

### Scope decision
The remediation the audit gives for native (Keychain/Keystore-backed storage adapter) is mobile configuration, which this session excludes, and no native project exists. **Not done, still open for the mobile phase.**

### Change (web only: documentation and a tripwire, no production code)
- `src/test/noXssSinks.test.ts` (3 tests): fails if production code uses any of the sinks above; the scanner is itself tested on synthetic code (comments, look-alikes such as `model.eval()`), and a coverage check makes sure the scan really walks the tree. Accepted exceptions would need an entry in an `ALLOWED` list with a reason (empty today).
- `docs/security/local-data-and-tokens.md`: new section "Why a localStorage session is accepted on the web (IL-07)".

### Evidence
- Mutation checks (all restored): `innerHTML` assignment added to `src/lib/supabase.ts`: fails; `dangerouslySetInnerHTML` in a new component: fails; `eval` in a new util: fails; control: the same sink inside a `.test.ts` file does not fail; scanner weakened (innerHTML pattern removed): the synthetic test fails.
- Limits: text scan only; third-party libraries, computed property access and cross-module sinks are not covered. CSP behaviour in a real browser: NOT VERIFIED (that is IL-10).

---

## C. Regression results (after IL-07)

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` exit 0 |
| Full tests | PASS | 143 files passed, 2 skipped; **2,655 passed, 0 failed, 36 skipped** (session baseline 2,641 / 0 / 36; step 0 added 7, IL-05 added 4, IL-07 added 3) |
| Dependency audit | PASS | `npm audit` 0 vulnerabilities (was 4 moderate); `npm audit --omit=dev` 0; `npm ci` and `npm ls` clean |
| 36 skipped | NOT VERIFIED | Same env-gated Redis / real-PostgreSQL suites as the baseline |
| Production build | PASS | `rm -rf dist && npx vite build` built; no `aistudio` or `.md` files in `dist/` |
| Mutation checks | PASS | See sections B, B2 and B3 |
| Live Supabase | READ-ONLY | `list_projects`, `get_advisors(security)`, `list_migrations` only |

---

## D. Git changes (nothing committed, pushed or deployed)

Step 0 (pushed by the owner as `d766c5d`): `scripts/verify-quota.ts`, `scripts/verify-quota.test.ts`, `docs/security/quota-store.md`, `docs/internal-security/REMEDIATION_SESSION_3.md`.
IL-05 (pushed by the owner as `321e3c6`): modified `package.json`, `package-lock.json`, `docs/internal-security/REMEDIATION_SESSION_3.md`; added `docs/security/dependency-overrides.md`, `src/test/devDependencyOverrides.test.ts`.

IL-07 (patch against `321e3c6`, not committed): modified `docs/security/local-data-and-tokens.md`, `docs/internal-security/REMEDIATION_SESSION_3.md`; added `src/test/noXssSinks.test.ts`.

No migration, live-database, config or mobile change. Later patches extend this file, so each depends on the one before.

---

## E. Remaining findings

IL-05: done and pushed. IL-07: web part done (tripwire and docs, pending owner approval); the native token-storage part is mobile work and stays open. IL-08, IL-09, IL-10: not started. IL-02: open by owner decision. Observations carried over (not changed): `ThemeContext` unscoped key (allow-listed), public GitHub repository containing `docs/internal-security/`, unknown `/assets/*` paths return the SPA shell.

## F. Final status

**PARTIALLY COMPLETED** (in progress): step 0 and IL-05 done and pushed; IL-07 web part done, pending owner approval of its patch.
