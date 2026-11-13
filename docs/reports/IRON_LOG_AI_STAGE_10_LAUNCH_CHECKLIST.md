# Iron Log AI — Stage 10 Launch Checklist

Date: 2026-11-13. HEAD audited: `7d4dede`. A task is DONE only with the evidence listed. Statuses: DONE, OPEN, BLOCKED, UNKNOWN. Nothing here authorizes a production change; each marked "needs approval" requires a separate explicit owner instruction.

## 1. Repository

| # | Task | Status | Evidence required |
|---|---|---|---|
| R1 | `npm ci` succeeds using the existing lockfile | DONE (owner-reported 2026-11-13) | Output: 430 packages, 0 vulnerabilities |
| R2 | `npm run lint` (`tsc --noEmit`) | DONE (no errors printed; exit code not captured) | Re-run once and record `echo %ERRORLEVEL%` = 0 |
| R3 | `npm test` full suite | OPEN: last full run was 3,716 passed, 2 failed, 47 skipped (the 2 failures are fixed in R5) | One full re-run showing 0 failures |
| R4 | `migrationHistory.guard.test.ts` passes (incl. the docs patch) | DONE (owner-reported 2026-11-13) | 20/20 tests passed (alone, and again in the 3-file run) |
| R5 | `migrationReconstruction.test.ts` and `rls.legalEnforcement.test.ts` pass at the default timeout | DONE (owner-reported, after the owner-approved timeout patch) | 8/8 and 42/42 tests passed with no timeout flag |
| R6 | `npm run check:api` and `npm run build` | DONE (owner-reported 2026-11-13) | Bundle OK 226,123 bytes; vite build 23.5 s |
| R7 | Apply the three Stage 10 patches (docs + reports, results update, test timeouts) | OPEN (owner to confirm with `git status`) | Files present in the working tree |
| R8 | Skipped tests classified against the table in the final report | OPEN (47 skipped confirmed; composition unknown) | Per-test skip list with reasons |
| R9 | Redis and Postgres integration tests run with `REQUIRE_*=1` | OPEN | Passing output |

## 2. Supabase

| # | Task | Status | Evidence required |
|---|---|---|---|
| S1 | Remote history equals the 16 repo migrations | DONE | `list_migrations` output 2026-11-13 |
| S2 | Signup triggers installed and enabled | DONE | Catalog query 2026-11-13 |
| S3 | Live signup rejection works (no metadata, fake versions, no age declaration) on a preview branch | OPEN | Recorded results of the steps in `LEGAL_ACCEPTANCE_ENFORCEMENT.md` section 5 |
| S4 | Before User Created hook enabled and pointing at `public.hook_before_user_created` | UNKNOWN | Dashboard screenshot (no secrets) and a preview-branch test with hook on and off |
| S5 | Leaked-password protection enabled | OPEN (needs approval; plan eligibility unconfirmed) | Advisor no longer lists `auth_leaked_password_protection`; a test signup with a breached password is refused |
| S6 | Referral `search_path` migration applied | OPEN (needs approval; optional while referral is deferred) | Advisor no longer lists the 3 `function_search_path_mutable` findings; bodies, ACLs and triggers unchanged |
| S7 | Hosted bodies of `acknowledge_legal_update`, `declare_adult_18_plus`, `get_my_age_eligibility` reviewed for `auth.uid()` scoping | OPEN | Reviewer notes against the migration files |
| S8 | `AGE_ENFORCEMENT`: set `shadow`, watch `age_shadow_would_deny` logs, then `on` | OPEN (needs approval) | Log evidence, then env var value (not secret) |
| S9 | Existing accounts can complete the 18+ declaration screen | OPEN | Preview or staging test with a pre-existing account |

## 3. Razorpay

| # | Task | Status | Evidence required |
|---|---|---|---|
| P1 | Plan IDs exist and amounts are ₹299 monthly, ₹1,499 annual | UNKNOWN | Dashboard screenshot (no secrets) |
| P2 | Vercel Production has plan IDs, key id/secret and webhook secret set | UNKNOWN | Names present only; never values |
| P3 | Checkout amount equals displayed price, no extra tax | OPEN | Test Mode checkout screenshot |
| P4 | Webhook delivery and signature verification | OPEN | Test Mode event received, 200 response, bad signature rejected |
| P5 | Duplicate webhook is ignored | OPEN | Replay result |
| P6 | ₹5 authorization debit refund behaviour | OPEN | Test Mode record showing the refund; copy must not promise it until verified |
| P7 | Duplicate or incorrect charge refund path | OPEN | Documented, tested procedure |
| P8 | `BILLING_ENFORCEMENT` decision (free launch or paid access) and rollout (shadow then on) | OPEN (needs approval) | Owner decision recorded; env var value |

## 4. Legal

| # | Task | Status | Evidence required |
|---|---|---|---|
| L1 | Operator legal name, address, effective date, governing law, grievance contact, retention periods, Gemini tier | BLOCKED (owner information) | Values supplied, placeholders removed |
| L2 | Final policy version labels and matching new migration | OPEN | Migration reviewed and applied with approval; drift test passes |
| L3 | Indian lawyer review of Privacy, Terms, Refund, Cancellation, Contact | OPEN | Written sign-off |
| L4 | `LEGAL.isDraft = false` and release gate test passes | BLOCKED by L1 to L3 | Gate test passes with `LEGAL_RELEASE_CHECK=1` |
| L5 | Refund policy limited to duplicate, incorrect and verified billing-error charges, no change-of-mind refunds | OPEN | Copy reviewed in L3 |
| L6 | Existing-user policy update notice works | OPEN | Test with an older acknowledgement |
| L7 | Referral programme confirmed excluded from launch | DONE (no front-end or API wiring found) | `src` and `api` search 2026-11-13 |
| L8 | 18+ copy does not describe the checkbox as verification | OPEN | Copy review in L3 |

## 5. Manual browser and device testing

| # | Task | Status | Evidence required |
|---|---|---|---|
| M1 | Both signup checkboxes unchecked by default; signup blocked until ticked | OPEN | Screen recording or screenshots |
| M2 | Five legal URLs load directly, after refresh and with trailing slash | OPEN | Per-URL result on a Vercel Preview |
| M3 | Generic signup failure message appears for a non-policy error | OPEN | Screenshot |
| M4 | Fresh signup, email verification, login, logout | OPEN | Test account result |
| M5 | Workout cloud sync across two devices | OPEN | Two-device result |
| M6 | Body Scan blocked without 18+ declaration | OPEN | Test account result |
| M7 | Mobile (Android and iOS via Capacitor) smoke test | OPEN | Device result |
| M8 | No draft banner or placeholder visible after L4 | BLOCKED by L4 | Production check of all five URLs |

## 6. Final release authorization

| # | Task | Status | Evidence required |
|---|---|---|---|
| F1 | Sections 1 to 5 all DONE or explicitly accepted as limitations in writing | OPEN | Owner sign-off listing accepted limitations |
| F2 | Rollback plan confirmed (`supabase/manual/*` scripts; env toggle to `off`) | OPEN | Owner confirmation |
| F3 | Owner issues explicit written release instruction | OPEN | Written instruction (this audit grants none) |
