# Iron Log AI: Razorpay billing, final implementation report (Stage 7)

Date: 2026-11-08. Branch `feature/razorpay-billing-trial` at `bcf7e42` (Stage 6). `main` is untouched at `fd18c70`. Nothing was merged, deployed, or run against live Razorpay or production env vars. **Everything below that involves Razorpay was verified against mocks only: no Test Mode keys were available at any stage.**

## 1. Regression results (clean clone of `bcf7e42`)

| Check | Result |
|---|---|
| `src/server scripts` | 41 files, 1065 tests: all pass once `api/index.js` is rebuilt (3 `bundle-api.test.ts` tests fail on the pushed head: the committed bundle was stale after Stage 6, see 2) |
| `src/utils src/test` | 51 files, 1062 tests pass |
| `src/components` | 59 files, 753 tests pass |
| rest (`assets context data hooks lib services storage sync types`) | 31 files, 435 tests pass |
| Total | 182 test files (181 ran, 1 skipped by design), 3315 tests: 3307 pass, 8 skipped by design, 0 fail |
| `npm run lint` | passes |
| `npm run build` | passes; built frontend bundle contains no secret name or key-shaped literal |
| `npm run check:api` | passes after `npm run build:api` (stale before) |

Baseline before billing (Stage 0): 163 files, 3010 tests. No existing test was removed or weakened.

## 2. Action needed before anything is deployed
The pushed head has a **stale `api/index.js`** (it still embeds the Stage 5 billing service). Run `npm run build:api` on your machine and commit the result, otherwise Vercel would serve the old bundle without the Stage 6 fixes.

## 3. The 12 acceptance criteria

| # | Criterion | Status | Basis |
|---|---|---|---|
| 1 | Three-day trial works | Met in tests only | Real Stage 1 SQL on PGlite (trial window, database-clock expiry, one per account/email, survives deletion) plus mocked service. Not seen with a real Razorpay mandate. |
| 2 | Razorpay authorization works in Test Mode | **Not verified** | Needs Test Mode keys. Only mocked Razorpay responses and signature maths were tested. |
| 3 | Billing records securely stored | Met (PGlite) | RLS on every table, no client writes, hidden Razorpay ids, service-role-only functions. Stage 1 migrations are applied to Supabase; RLS tests ran in-process, not against the live project. |
| 4 | Webhooks verified and idempotent | Met in tests; raw body on Vercel **not verified** | HMAC over raw bytes, event ledger, replay and concurrency tests. Fails closed if Vercel pre-parses the body. |
| 5 | Subscription status authoritative on the server | Met | Gate and UI read only server state; webhook writes Razorpay's fetched state; frontend callback is never proof. |
| 6 | Paid entitlements work | Met in tests only | All nine entitlement states at the gate. Enforcement is off by default; no real charge was ever made. |
| 7 | Cancellation and payment-failure flows | Met in tests only | Cancel (trial now, paid at cycle end), halted/pending, recovery, cancel-then-delete. Checkout card-change recovery and API cancel of pending/halted/created are untested against Razorpay. |
| 8 | Billing UI on mobile and desktop | Partly | Component tests check layout classes and accessibility semantics (jsdom has no layout). Not seen on a real phone or in a real browser; Checkout CSP not browser-tested. |
| 9 | Applicable automated tests pass | Met | Section 1. |
| 10 | Existing tests, lint, build, API validation pass | Met after `build:api` | Section 1 and 2. |
| 11 | No unresolved critical/high security findings | Met | `SECURITY_REVIEW.md`: 0 critical, 0 high; two mediums fixed; remaining mediums are documented residual risks or deployment requirements. |
| 12 | Git state reported accurately | Met | Section 7. |

## 4. Manual Razorpay Dashboard steps (Test Mode first)
1. Generate Test Mode API keys; set `RAZORPAY_KEY_ID` (`rzp_test_...`) and `RAZORPAY_KEY_SECRET` as server env vars only.
2. Activate Subscriptions on the account if it is not already.
3. Create the plans once: `RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... npx tsx scripts/billing-create-plans.ts`; put the printed ids in `RAZORPAY_PLAN_ID_MONTHLY` / `RAZORPAY_PLAN_ID_ANNUAL`. Amounts must stay 29900 and 149900 paise (the server refuses a mismatching plan).
4. Add a webhook to `https://<your-domain>/api/billing/webhook` with a secret you generate (this becomes `RAZORPAY_WEBHOOK_SECRET`). Subscribe to: `subscription.authenticated, activated, charged, completed, updated, pending, halted, cancelled, paused, resumed`.
5. Set `BILLING_TRIAL_PEPPER` (32+ random characters; changing it later breaks trial-claim matching) and `SUPABASE_SERVICE_ROLE_KEY` (server only, never `VITE_`).
6. Set `TRUST_PROXY` correctly for Vercel and keep the shared Redis rate store.
7. Optional reconciler: create GitHub environment `billing-reconcile` (deployment branch `main` only), move the eight secrets into it, set repo variable `BILLING_RECONCILE_ENABLED=true`.
8. Keep `BILLING_ENFORCEMENT` unset or `off`.

## 5. Test Mode verification checklist (every BLOCKED item)
Use a Vercel **preview** deployment with Test Mode keys.

| # | Item | What to check | Pass means |
|---|---|---|---|
| 1 | Webhook raw body on Vercel | Send a Razorpay test webhook; look for `raw_body_unavailable` | 200 `processed`. If it fails, try `NODEJS_HELPERS=0` (unverified) and retest. |
| 2 | Rs 5 refund timing and field | Complete a trial authorization with a test card; fetch the payment | Field names the code reads (`refund_status`, `amount_refunded`, status `refunded`) match; refund arrives; reconciler raises no alert. |
| 3 | Rs 5 for UPI Autopay / eMandate | Authorize with each method | Actual debit amount; then decide whether the UI may state Rs 5 for non-card methods. |
| 4 | Scheduled cycle-end cancel | Cancel a paid test subscription | Razorpay's reported status/fields; access stays to period end via our own columns. |
| 5 | `total_count` limits | Create monthly (120) and annual (10) subscriptions | Razorpay accepts both. |
| 6 | `subscription_card_change` in Checkout | Fail a renewal (test failure card), use "Update payment method" | Checkout opens for the same subscription; `/verify` reports recovered once Razorpay says active. UPI/eMandate use the emailed link. |
| 7 | Cancel of `pending`/`halted`/`created` via API | Run cancel-and-delete in each state | Razorpay accepts, stop verified, deletion succeeds. A rejection must keep deletion blocked. |
| 8 | CSP origins Checkout needs | Open the billing flow in a real browser with DevTools | No CSP violations; add only the origins reported, narrowly. |
| 9 | Authorization payment id | After a verified authorization, check Razorpay for a reliable subscription-to-payment link | If none, keep the `billing_authorization_payment_missing` alert and manual check. |
| 10 | Halted recovery access | Recover a halted test subscription | Does `current_period_end` advance without a paid charge? **Owner decision:** accept it or require the next successful charge. |
| 11 | Trial flow end to end | Fresh verified account: subscribe, authorize, cancel during trial | Access to the original trial end; no charge; second trial refused. |
| 12 | Mobile | Run the billing screen on a real phone | Layout, tap targets, Checkout opening. |

## 6. Live-payment checklist (separate approved step)
1. All of section 5 passed and the halted-recovery decision is recorded.
2. Run `npm run build:api`, commit, then merge only after explicit approval.
3. Switch to live keys deliberately: requires `BILLING_ALLOW_LIVE_KEYS=true`; recreate plans in live mode (never edit existing ones); new live webhook and secret.
4. Deploy with `BILLING_ENFORCEMENT=off`; confirm health and one real, refundable low-value test by the owner.
5. Set `shadow`: nothing is blocked; watch logs for `entitlement_shadow_would_deny` and `entitlement_shadow_unavailable` for several days. Existing users will show as would-deny: decide whether existing users get a trial or a grandfathered state **before** `on`.
6. Set `on` only after shadow is clean. Rollback is setting it back to `off`.
7. Monitor alerts `billing_authorization_not_refunded`, `billing_authorization_payment_missing`, `billing_reconcile_alerts`.

## 7. Git state
- Branch `feature/razorpay-billing-trial` at `bcf7e42` ("stage6-security-tests"), 8 commits ahead of `main` (Stage 1 took three commits, Stages 2 to 6 one each) (plus this report, to be committed by you).
- `main` at `fd18c70`, not touched. Nothing pushed or merged by Claude.
- Pushed head working tree: clean except the stale generated `api/index.js` (section 2).
- This report was added as a patch on top of `bcf7e42`; apply and commit it with the rebuilt bundle.

## 8. Implemented, not tested / blocked / deferred
- **Implemented and tested (mocks, PGlite):** everything in Stages 1 to 6.
- **Implemented, not tested against the real service:** Razorpay SDK calls, Checkout loading and CSP, card-change recovery, reconciler run, GitHub Actions workflow.
- **Blocked on Test Mode keys:** section 5.
- **Deferred / decisions:** halted-recovery access rule, grandfathering of existing users before `on`, per-instrument trial dedupe if abuse appears, SHA-pinning of GitHub Actions.
