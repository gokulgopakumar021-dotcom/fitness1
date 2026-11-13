# Iron Log AI — Stage 10 Final Report (verification, documentation cleanup, launch-readiness audit)

Date: 2026-11-13. Audit and hardening only. No feature work.
Legend: PASS (command executed), FAIL, BLOCKED, NOT RUN (deliberately not executed in this session), NOT VERIFIED (no evidence), UNKNOWN (setting not readable).

## 1. Executive summary

- **Verdict: NOT READY TO LAUNCH. Repository: READY WITH LIMITATIONS, test evidence missing.** Stage 10 is **not complete**: the test suite, type-check, build and API-bundle check were **not run** in this session (the owner chose to run them locally). Nothing below claims they pass.
- Verified read-only on the hosted Supabase project: the 16-row migration history matches the repository exactly; all expected tables have RLS; the three signup triggers are enabled.
- Verified gaps: leaked-password protection is **disabled**; the three referral guard functions still have a mutable `search_path` (the proposal is unapplied, as intended); `AGE_ENFORCEMENT` and `BILLING_ENFORCEMENT` are **not set** in Vercel Production, so both gates are effectively **off**.
- Still open: Before User Created hook (UNKNOWN), Razorpay dashboard and end-to-end checks, owner legal information, Indian legal review, `LEGAL.isDraft = true`.

## 2. Branch and HEAD

- Repository `gokulgopakumar021-dotcom/fitness1`, branch `feature/ironlog-billing-referrals-launch`.
- HEAD at audit start: `7d4dede8705bd7871c2d9f03c6a22b6d025c1538` ("iron log stage 9"), parent `1553164` ("ironlog-stage8-v2-v3").
- Working copy: a fresh read-only clone made for this audit (not the owner's local checkout).

## 3. Stage 9 changes confirmed in the branch (`1553164..HEAD`)

Confirmed by diff: 13 migration files renamed to the remote versions; `20261102082840_revoke_rls_auto_enable_execute.sql` added; `src/test/migrationHistory.guard.test.ts` and `src/test/migrationReconstruction.test.ts` added; signup error handling split into generic vs policy-specific messages and a `pwned`-specific weak-password message in `src/utils/authValidation.ts`; `supabase/proposed/20261114000000_referral_trigger_search_path.sql` and `supabase/manual/rollback_referral_trigger_search_path.sql` present; `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md` added. The comparison to `e9f47c3` also contains Stage 8 changes (55 files); Stage 9 alone is the HEAD commit.

## 4. Worktree baseline and Stage 10 changes

- Baseline: clean tree, no untracked files, no stashes, on the expected branch.
- Stage 10 changes (uncommitted, delivered as a patch): 7 documentation files edited plus these two reports. No source, test, migration or configuration file was modified.

## 5. Commands executed and results

| Command / check | Result |
|---|---|
| `git clone` of the branch, `git status`, `git log`, `git diff --stat` | PASS |
| `node -v` / `npm -v` | v22.23.4 / 10.9.9 |
| `npm ci` | **NOT RUN** |
| `npm run lint` (`tsc --noEmit`) | **NOT RUN** |
| `npm test` (`vitest run`) | **NOT RUN** |
| `npm run check:api` | **NOT RUN** |
| `npm run build` | **NOT RUN** |
| Static `grep` check that no live doc contains prohibited migration commands (mirrors the guard test) | PASS (not a substitute for running the test) |

## 6. Test totals

Passed: **NOT RUN**. Failed: **NOT RUN**. Skipped: **NOT RUN**. The Stage 8 figures (3,687 passed, 0 failed, 47 skipped) are historical and are not evidence for this HEAD. The owner will supply real totals.

## 7. Migration history verification

- **Remote vs repository (read-only, 2026-11-13): PASS.** 16 remote rows; versions and names identical to the 16 files in `supabase/migrations/`, same order, none missing, unexpected or duplicated. Includes the remote-only revoke migration and the legal_acceptances → referral_core order.
- Limits: only versions and names were compared; statement text was not re-diffed (the Stage 9 doc claims a normalised hash match, not re-verified).
- `migrationHistory.guard.test.ts` execution: **NOT RUN**. Test code was read: it encodes the 16 rows, order, duplicates, stale versions, prohibited commands and proposed-migration separation.

## 8. PGlite reconstruction

`migrationReconstruction.test.ts` execution: **NOT RUN**. The test replays all 16 files into PGlite and checks tables, RLS, workout-sync permissions, signup triggers, the hook function, ordering and both branches of the revoke migration. PGlite is not GoTrue, hosted Storage, `pg_cron`, event triggers or the hosted hook runtime, and is not a substitute for a Supabase preview-branch test.

## 9. Documentation corrections made

Seven files (patch `ironlog-stage10-docs.patch`):
- `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md`: new section 8 defining nine separate states (file exists, recorded remotely, objects exist, trigger active, hook enabled, age gate, billing gate, legal gate, legal docs approved) with the evidence for each.
- `README.md`: step 2 now separates a fresh project from an existing project with recorded history.
- `docs/referrals/STAGE1_DATABASE.md`: no longer "DRAFT, not applied"; notes the referral programme is deferred and the `search_path` change is proposed only.
- `docs/billing/STAGE1_ARCHITECTURE.md`: header and section 7 now reflect remote recording and the unset enforcement gate.
- `docs/legal/LEGAL_ACCEPTANCE_ENFORCEMENT.md`: replaced the false "nothing applied" status with per-state statuses.
- Two additional contradictions fixed: `docs/legal/AGE_ELIGIBILITY_DESIGN.md` ("NOT applied") and `docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md` (instruction to apply an already-applied migration).
- Legal documents were not marked final; existing warnings were kept.

## 10. Read-only Supabase preflight

Project `nerfdflkrtikkbttofwk` (ap-northeast-1, ACTIVE_HEALTHY, Postgres 17). Only `list_migrations`, `get_advisors`, SELECT queries and one log count were used. No DDL, migration, setting or data change.

- Migrations: PASS (section 7).
- Tables: 20 public tables, all RLS-enabled. Seven have zero policies and zero client grants (intentional deny-all: `ai_usage_counters`, `app_admins`, `billing_trial_claims`, `billing_webhook_events`, `legal_policy_versions`, `referral_admin_audit`, `referral_attributions`).
- Client grants: `authenticated` has SELECT on `age_declarations`, `exercise_videos`, `legal_acceptances`, `profiles`, and SELECT/INSERT/UPDATE on the four workout-sync tables; `anon` has none on any public table; billing and referral tables have no client grants.
- Triggers on `auth.users`: `on_auth_user_created`, `on_auth_user_created_legal_acceptance`, `on_auth_user_created_age_declaration`, all enabled. Workout row guards and referral guards are enabled.
- Hook function `public.hook_before_user_created`: exists, invoker, `search_path=''`, executable only by `postgres`, `service_role`, `supabase_auth_admin`.
- Live policy versions: `terms` and `privacy` both `2026-11-draft-1`, current.
- Not exercised: a real signup, the hook, the app's API behaviour.

## 11. Production settings

| Setting | Status |
|---|---|
| Migration history | VERIFIED matches repo |
| Signup triggers | VERIFIED installed and enabled (behaviour not exercised) |
| Before User Created hook enabled | UNKNOWN (dashboard setting not readable) |
| Leaked-password protection | VERIFIED DISABLED (advisor, 2026-11-13) |
| `AGE_ENFORCEMENT` | NOT SET per owner; effective `off` (code default) |
| `BILLING_ENFORCEMENT` | NOT SET per owner; effective `off` (code default) |
| Referral guard `search_path` | VERIFIED unpinned (proposal not applied) |
| Razorpay keys, plan IDs, webhook secret in Vercel | UNKNOWN (Vercel not accessible) |

## 12. Billing and Razorpay readiness: NOT VERIFIED (code reviewed only)

Code evidence (static, tests not run): default prices 29,900 paise (₹299) monthly and 149,900 paise (₹1,499) annual, overridable by env; Terms text states the same prices; webhook signature check uses HMAC with `timingSafeEqual` and fails closed when the raw body is missing; webhook processing is idempotent with a duplicate gate; subscription authorization has a server `verify` route; no tax/GST amount is added in billing code (not GST-registered per owner). The ₹5 authorization debit is documented as auto-refunded by Razorpay but the code comment states the refund was **not verified in Test Mode**, and customer-facing text must not promise it.
Not verified: actual plan IDs in Razorpay, that live amounts equal the displayed prices, checkout amount, webhook delivery, refund and duplicate-payment behaviour, and `BILLING_ENFORCEMENT` (currently off, so AI routes are not gated by trial or subscription). No payment or refund was attempted.

## 13. Legal readiness and owner information

Repository evidence supports: Iron Log AI branding; legal checkbox and 18+ checkbox unchecked by default (`useState(false)`); the five legal routes in `vercel.json`; `support@ironlog.app` in code; `LEGAL.isDraft = true`. The referral programme has no front-end or API wiring in `src` or `api` (database objects only), consistent with deferral.
Outstanding: operator legal name, address, effective date, governing law/courts, grievance contact, retention periods, Gemini tier and data terms (all still placeholders in `OWNER_PLACEHOLDERS`); final version labels (live labels are `2026-11-draft-1`); Indian legal review. The 18+ checkbox is a self-declaration and is not identity or age verification. This report does not declare legal compliance. Existing-user notice and refund-policy scope were not re-checked in this stage.

## 14. Security findings

1. **Leaked-password protection disabled** (WARN). Frontend handling exists but cannot take effect. Fix needs a Supabase dashboard change (plan eligibility to be confirmed). Approval boundary: not changed.
2. **Referral guard functions have a mutable `search_path`** (3 WARN). Proposed fix is three `ALTER FUNCTION … SET search_path = ''` statements; rollback `RESET`. Risk: low (functions reference no objects by name). Not applied; needs separate approval and a re-run of the advisor.
3. **Five SECURITY DEFINER functions are executable by `authenticated`** (WARN): `acknowledge_legal_update`, `consume_ai_quota`, `declare_adult_18_plus`, `delete_own_account`, `get_my_age_eligibility`. Repo migrations show an explicit grant for `consume_ai_quota` and `delete_own_account`; the other three are consistent with the docs but their hosted bodies were not read. Treat as intended pending that review.
4. **Seven RLS-no-policy tables** (INFO): intentional deny-all.
5. **Enforcement gates off**: API age gate off means AI routes and Body Scan rely on client behaviour plus the signup trigger; existing accounts have not been through the 18+ declaration. Billing gate off means no paywall.
6. No new warning class beyond Stage 8/9 findings. `rls_auto_enable` is SECURITY DEFINER with `search_path=pg_catalog` and no `anon`/`authenticated` execute (consistent with the revoke migration).

## 15. Remaining launch blockers

1. Test suite, type-check, build and API-bundle check have not been run on this HEAD.
2. Skipped-test classification is incomplete (section 16 lists what the code skips; counts unknown).
3. Before User Created hook status unknown; live signup rejection never exercised on a preview branch.
4. Leaked-password protection disabled.
5. `AGE_ENFORCEMENT` unset (off); needs a shadow-then-on rollout once existing users can declare.
6. Billing: Razorpay plan IDs, amounts, checkout, webhook, refund and duplicate-payment behaviour unverified; `BILLING_ENFORCEMENT` unset.
7. Legal: owner placeholders, draft versions, `LEGAL.isDraft = true`, Indian legal review.
8. Referral `search_path` proposal unapplied (non-blocking if the referral programme stays deferred).

### Skipped tests found in code (counts unknown until run)

| Test | Why skipped | Launch impact | Evidence to close |
|---|---|---|---|
| `quota.pg.integration.test.ts` | No `PG_TEST_URL` | Real-Postgres quota behaviour untested | Run with a local Postgres and `REQUIRE_PG_TESTS=1` |
| Redis integration (`redisTestHarness.ts` suites) | No Redis | Rate-limit store untested on real Redis | Run with `REDIS_TEST_URL` and `REQUIRE_REDIS_TESTS=1` |
| `legalReleaseGate.test.tsx` | Skipped while `LEGAL.isDraft` | Intentional block; must pass before release | Set `isDraft=false` after legal review, run with `LEGAL_RELEASE_CHECK=1` |
| `poseModel.integrity.test.ts` | Model file absent | Body Scan model integrity unchecked | Run `npm run fetch:pose-model` then test |
| `inventory.test.ts`, `probe.test.ts` (ffprobe, encoders) | ffmpeg/encoders missing | Video ingest tooling only | Install ffmpeg; no launch impact |

No tests were found for: real server startup, live Supabase signup, Razorpay checkout and webhook integration.

## 16. Recommended next stage

Stage 11 (verification and preview-branch testing, no production changes): owner runs the five local commands and returns totals; create a Supabase preview branch and run the signup rejection checks from `LEGAL_ACCEPTANCE_ENFORCEMENT.md` section 5; Razorpay Test Mode end-to-end including the ₹5 refund; owner supplies legal placeholders; then a separate approval for the `search_path` migration, the hook, `AGE_ENFORCEMENT=shadow`, and leaked-password protection.

## 17. Actions NOT performed

Not run: `npm ci`, lint, tests, build, `check:api`. Not done: commit, push, merge, branch switch, Vercel deployment or env change, Supabase migration/repair/reset/push, any DDL or data write, any auth setting change, enabling the hook or leaked-password protection, enabling or changing either enforcement gate, applying the `search_path` migration, any Razorpay payment, refund or dashboard check, any live signup. Secrets were not read or printed.
