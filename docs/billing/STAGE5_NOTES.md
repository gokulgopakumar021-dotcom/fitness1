# Billing Stage 5: recovery, account deletion, reconciler trigger, alerting (notes)

Test Mode only. `BILLING_ENFORCEMENT` default is still `off`. No SQL migration was added or applied; the Stage 1 SQL is unchanged.

## Payment recovery (`pending`, `halted`)
Razorpay documents two ways to repair a failed renewal (payment-retries page, checked 2026-11-08):
1. **Hosted page via the failure email.** Works for every method (card, UPI, e-mandate). We create subscriptions with `customer_notify: 1`, so Razorpay sends it. Nothing for us to build; the UI points to it.
2. **Checkout on the same `subscription_id` with `subscription_card_change: true`.** Cards only.

Implemented: `POST /api/billing/subscriptions/recover` (JWT, no body). It re-reads the subscription from Razorpay and returns Checkout parameters only if it is really `pending` or `halted`, else 409 `recovery_not_available`. The UI opens Checkout in card-change mode and posts the callback to the existing `/verify`. For a `pending`/`halted` row `/verify` now: checks the signature against our stored id, re-fetches Razorpay, answers `recovered: true` only if Razorpay says `active`, else 409 `authorization_not_confirmed` (the UI retries, then says "still confirming, do not pay again"). No payment row is written from the callback; the charge arrives as `subscription.charged`.
Also: `halted` rows are now re-checked on status reads (once a minute per row) and by the reconciler (once a day), so a customer who fixed it from Razorpay's email is not left on "payment failed".

## Account deletion
`delete_own_account()` (Stage 1) is the real gate and still refuses with `BL001` until Razorpay has confirmed every subscription stopped. New server step, called by the browser after the password check and before the delete RPC:
- `GET /api/billing/account/deletion-check`: re-reads Razorpay, returns `none | cancel_billing | confirm_cancel_paid`.
- `POST /api/billing/account/prepare-deletion` `{confirmCancelPaidNow?: boolean}` (strict boolean, body only): trial/unpaid/pending/halted/created subscriptions are cancelled immediately; a paid (`active`) one is cancelled immediately **only** with `confirmCancelPaidNow: true` (access ends now, no refund); otherwise `ready:false`. `ready:true` only after Razorpay returned a terminal status (which sets `billing_stop_verified_at`); otherwise 409 `cancellation_not_confirmed`.
- UI (Settings, Account, Delete): shows the consequence, requires a checkbox for a paid plan, runs the step through `deleteAccount(password, beforeDelete)`. If the preview cannot load (billing not configured, offline) deletion proceeds exactly as before and the database gate remains the safety net; a `BL001` refusal is mapped to a clear message and the requirement is re-read.
- Orphans: rows now survive deletion with `user_id` null; the reconciler's INR 5 refund check works for them (it previously skipped null-user rows). Orphan webhook handling (cancel at Razorpay, verify stop) is tested end to end.

## Reconciler trigger and alerting
- `scripts/billing-reconcile.ts` exit codes: 0 clean, 1 not configured/crashed, 2 alert for a human, 3 some rows unchecked. Output is counts only.
- Alerts: INR 5 authorization not refunded after 24 h (`billing_authorization_not_refunded`); authorization whose payment id was never recorded, 1 h to 7 days old (`billing_authorization_payment_missing`); summary event `billing_reconcile_alerts`.
- **Trigger design (not deployed):** `.github/workflows/billing-reconcile.yml`, every 6 h plus manual. Inert: it needs the repo variable `BILLING_RECONCILE_ENABLED=true`, repo secrets, and scheduled workflows only run from the default branch. A non-zero exit fails the run and GitHub emails it. Chosen over a Vercel Cron endpoint because that would add a second unauthenticated HTTP route. Delete the file if you prefer another scheduler. Log-drain alerting on the event names above also works.

## Authorization payment id on the webhook path: NOT reliable
Razorpay's documented `subscription.authenticated` sample payload contains only the subscription entity (no payment). So the INR 5 payment id is still only known from the browser callback. We did not invent a lookup. Mitigation is the `billing_authorization_payment_missing` alert (manual Dashboard check). BLOCKED: whether Razorpay offers a reliable subscription-to-payment listing; check in Test Mode.

## Still BLOCKED / unverified (no Test Mode keys)
1. `subscription_card_change` behaviour in Checkout (documented option, never run) and whether it works for UPI/e-mandate (docs say card).
2. **Access after recovery from `halted`:** Razorpay says invoices generated while halted are NOT charged after recovery and domestic cards cannot be manually charged. Our entitlement follows `current_period_end`; if Razorpay advanced it, a recovered user could have access for a cycle that was never paid. Needs a Test Mode check and an owner decision (accept, or require the next successful charge).
3. Cancelling `pending`/`halted`/`created` subscriptions via API (we rely on the cancel endpoint accepting them; a rejection surfaces as a safe error and keeps deletion blocked).
4. Items 1 to 4 and 6 from the Stage 2 list (refund timing, UPI/e-mandate authorization amount, scheduled-cancel reporting, `total_count` limit, webhook raw bytes on Vercel) and CSP origins for Checkout.

## Intended changes to existing tests
`app.sideEffects.test.ts` (route inventory lists the 3 new routes); `BillingPanel.test.tsx` (the Stage 4 assertion that "Update payment method" is disabled and "not available yet" is replaced by the enabled behaviour).
