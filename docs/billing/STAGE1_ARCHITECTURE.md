# Iron Log AI: Billing architecture (Stage 1 design)

Status: **proposal for review**. Nothing here is applied to any database or deployed. Branch: `feature/razorpay-billing-trial`.
The matching draft migration is `supabase/migrations/20261106000000_billing_core.sql`, checked by `src/test/rls.billing.test.ts`.

## 1. Decisions (from the owner)

| Topic | Decision |
|---|---|
| Currency, plans | INR. Monthly ₹299 (29900 paise), annual ₹1,499 (149900 paise). Amounts live in server configuration, not in code. |
| Trial | 3 days, both plans, one per person. Existing users are eligible once. Starts only after Razorpay confirms authorization. No charge during the trial. |
| Gated | All 15 `ai: true` API routes need an active trial or paid subscription. |
| Free | All local-first fitness features and every non-AI route. |
| Server DB access | `SUPABASE_SERVICE_ROLE_KEY`, server only, used only by billing and webhook code. |
| Mode | Razorpay Test Mode only. No live payments, no production env changes, no merge or deploy. |

## 2. Razorpay facts this design relies on

Checked against current official docs on 2026-11-06 (sources at the end). Items marked **unverified** must be confirmed in Test Mode during Stage 2.

- **Future start = trial.** `POST /v1/subscriptions` accepts `start_at` (Unix seconds, must be in the future). The customer authorizes now; the first charge happens at `start_at`. A past `start_at` is rejected. `expire_by` is the last moment the customer can authorize; if they have not authorized by `start_at`, the subscription becomes `expired`.
- **Authorization amount.** For a future start with no upfront amount, the authentication payment is **₹5, refunded automatically**. For an immediate start it is the plan amount, not refunded.
- **Required fields.** `plan_id` and either `total_count` or `end_at`. Unknown fields are rejected. `notes` allows up to 15 pairs.
- **Plans.** `period` is `daily | weekly | monthly | quarterly | yearly`, with an integer `interval` and `item.amount` in paise. Create them once per environment with a script. The docs do not say plans can be edited, so treat them as immutable.
- **Statuses.** `created, authenticated, active, pending, halted, cancelled, completed, expired`. A trial subscription without an add-on moves to `authenticated` after authorization, then to `active` when the first billing cycle starts and the charge is attempted.
- **Retries.** A failed card or UPI charge is retried daily for three days after the first attempt (T+1 to T+3). The first failure moves the subscription to `pending`; exhausting retries moves it to `halted`. `halted` can return to `active` after a successful charge on a new payment method.
- **Cancel.** `POST /v1/subscriptions/:id/cancel` with `cancel_at_cycle_end` (`true` = at period end, `false` = now). Cycle-end cancel **fails** while no billing cycle is active (`created` or `authenticated`), so a trial must be cancelled immediately. Cancelling an `expired` or already cancelled subscription errors.
- **Checkout verification.** `hmac_sha256(razorpay_payment_id + "|" + subscription_id, key_secret)` compared to `razorpay_signature`, where `subscription_id` comes from our own database, never from the browser.
- **Webhooks.** Header `X-Razorpay-Signature` is HMAC-SHA256 of the **raw** body with the webhook secret (Node SDK: `validateWebhookSignature`); the body must not be parsed first. `x-razorpay-event-id` is unique per event and is the idempotency key; duplicates are normal. Subscription events: `authenticated, activated, charged, completed, updated, pending, halted, cancelled, paused, resumed`.
- **Methods and limits.** Cards (Visa, Mastercard, RuPay), UPI Autopay and eMandate. Recurring card and UPI debits are limited to ₹15,000, so both plans fit.
- **Docs disagree on one point.** The webhook page says `subscription.authenticated` fires on the first payment; the test guide says authenticating a future-start subscription triggers no webhooks. **Design consequence:** never depend on that webhook. Authorization is confirmed by the verify endpoint fetching the subscription from Razorpay, and a reconciler covers lost callbacks.
- **Unverified:** whether UPI Autopay and eMandate support future-start subscriptions and what each charges at authorization; how a customer repairs a `pending` or `halted` subscription (hosted page link versus Checkout reuse); exact npm `razorpay` SDK behavior when bundled into `api/index.js`.

## 3. Principles

1. **Razorpay is the source of truth for payment state; our database is a verified mirror.** State is changed only by (a) the verify endpoint after fetching the subscription from Razorpay, (b) signature-verified webhooks, (c) a reconciler. Never by a browser callback or a client request.
2. **Re-fetch, don't trust ordering.** A webhook is a hint: the handler fetches the current subscription from Razorpay and writes that, so out-of-order or duplicate events converge to the same state.
3. **Access is computed, not stored.** `billing_get_entitlement()` derives access from stored state and the database clock. A frontend timer never grants access.
4. **Service role is confined.** One module, `src/server/billing/`, owns the service-role client. Every query is scoped by the user id verified from the JWT, because service role bypasses RLS.
5. **No sensitive payment data.** No card numbers, CVV, VPAs or raw webhook bodies are stored. Webhook rows keep ids and a SHA-256 digest only.

## 4. Subscription lifecycle

```
 (no subscription)
        │ POST /billing/subscriptions  → intent row 'creating' → Razorpay create (start_at = trial end)
        ▼
    created ──(not authorized by expire_by)──▶ expired
        │ Checkout authorization; server fetches subscription from Razorpay
        ▼
  authenticated  ── TRIALING (access until trial_end_at) ──────────────┐
        │ cancel (immediate)                                             │ trial_end_at: Razorpay charges
        ▼                                                                ▼
   cancelled (access until trial_end_at, then trial_expired)         active ── ACTIVE (access to current_period_end)
                                                                         │ │ cancel_at_cycle_end → still active, flagged
                                              charge fails ◀─────────────┘ └─▶ cancelled at period end
                                                   ▼
                                               pending ── retries T+1..T+3 ──▶ halted (PAYMENT FAILED, no access)
                                                   │ success                        │ customer fixes payment method
                                                   └──────────▶ active ◀────────────┘
```

| Entitlement state | Stored condition | Access |
|---|---|---|
| `none` | no authenticated subscription | no |
| `trialing` | `authenticated` and `trial_end_at > now()` | yes, until `trial_end_at` |
| `payment_pending` | `authenticated` past trial end, or `active` with an ended period, or `pending` | no (optional grace, §8) |
| `active` | `active` and `current_period_end > now()` | yes, until period end |
| `cancelled_active` | cancel requested and `access_ends_at` or period end still ahead | yes, until then |
| `payment_failed` | `halted` | no |
| `trial_expired` | `cancelled`, nothing ever paid, access ended | no |
| `cancelled` | `cancelled` after at least one payment, access ended | no |
| `expired` | `completed` | no |

Trial timing: at creation the database sets `expire_by = now + 30 min` and `trial_end_at = expire_by + 3 days`, and the server sends `trial_end_at` as `start_at`. The customer therefore always gets at least 3 full days after authorizing, and the first charge date shown before checkout is exact.

## 5. Razorpay flow

1. **Status.** `GET /api/billing/status` returns plans (amount, interval, trial days, first-charge date preview), trial eligibility, entitlement and the current subscription. Amounts come from server config.
2. **Create.** `POST /api/billing/subscriptions` with `{ planKey: 'monthly' | 'annual' }` only. The server: authenticates; validates `planKey` against an allow-list; maps it to a configured plan id and amount; confirms the amount matches the Razorpay plan; calls `billing_begin_subscription` (advisory-locked, decides eligibility, writes the `creating` row or returns the existing live one); calls Razorpay create with `plan_id`, `total_count`, `start_at` (trial only), `expire_by`, `customer_notify: true`, `notes: { user_id, plan_key }`; stores `razorpay_subscription_id` and `created`. If Razorpay fails, the row is marked `expired` and the trial claim stays reusable. Returns `{ subscriptionId, keyId, firstChargeAt, amount, interval, trialEligible }`. The key **id** is public by design; the secret never leaves the server.
3. **Disclosure.** Before opening Checkout the UI shows: ₹ amount, billing interval, 3-day trial, **first charge date**, that a refundable ₹5 verification charge is made now (§8), that the plan renews automatically until cancelled, and how to cancel.
4. **Authorize.** The browser opens Razorpay Checkout with `subscription_id`. The handler posts `razorpay_payment_id`, `razorpay_subscription_id`, `razorpay_signature` to `POST /api/billing/subscriptions/verify`.
5. **Verify.** The server loads the user's own subscription row, recomputes the HMAC with the stored subscription id, compares in constant time, **then fetches the subscription from Razorpay** and requires status `authenticated` or `active`. Only then does it set `authenticated`, `trial_start_at`, `auth_verified_at`, record the authorization payment, and call `billing_consume_trial_claim`. A valid signature alone never grants access.
6. **Trial end.** Razorpay charges at `start_at`. Webhooks `subscription.activated` and `subscription.charged` carry the payment; the handler re-fetches the subscription and updates period dates, `next_billing_at`, `paid_count`, and payment history.
7. **Failure and recovery.** `subscription.pending` and `subscription.halted` set the state and show a recovery screen. The recovery method (Checkout reuse versus Razorpay's hosted update-payment link) is confirmed in Stage 2.
8. **Cancel.** `POST /api/billing/subscriptions/cancel`: if `active`, cancel with `cancel_at_cycle_end: true` and set `access_ends_at = current_period_end`; if `authenticated` (trial), cancel immediately and set `access_ends_at = trial_end_at` (no money has been taken; the trial the user was promised is honored). `subscription.cancelled` finalizes the row.
9. **Reconcile.** A server routine (called on `status` reads when a row is stale, and by a scheduled job later) re-fetches subscriptions that are `created` past `expire_by`, `authenticated` past `trial_end_at`, or `pending`, so a lost webhook cannot leave wrong state.

## 6. Webhook endpoint

`POST /api/billing/webhook` is the one route without a Supabase JWT, because Razorpay cannot send one. It is registered **before** `installSecurity` with `express.raw({ type: 'application/json', limit: '256kb' })`, so the body stays exact. It then:

1. Rejects a missing or invalid `X-Razorpay-Signature` (HMAC-SHA256 over the raw bytes, constant-time compare) with 400, before any database access. Per-IP rate limit applies.
2. Parses JSON from the verified bytes only.
3. Calls `billing_begin_webhook_event` with `x-razorpay-event-id`: `duplicate` returns 200 with no work; `in_progress` returns 409 so Razorpay retries; `process` continues.
4. Handles the event idempotently (re-fetch, upsert, payments deduplicated on `razorpay_payment_id`), then marks the event `processed`, `ignored` (unknown event type) or `failed` (returns 500 so Razorpay retries).

The route is added to the route-policy tests as an explicit, documented exception to "every `/api` route is authenticated".

## 7. Database (draft migration)

| Table | Purpose | Client access |
|---|---|---|
| `billing_subscriptions` | One row per subscription attempt: ids, plan, amount snapshot, status, payment status, trial start and end, current period, next billing, cancellation fields. Unique partial index: at most one live subscription per user. | `select` own rows, display columns only (no Razorpay ids). No writes. |
| `billing_trial_claims` | One trial per person, forever. Keyed by `email_hash` (HMAC of the normalized email with a server pepper). `user_id` is `on delete set null`, so deleting an account and re-registering cannot restart a trial. Unique per consumed `user_id`. | None. |
| `billing_payments` | Payment history; unique on `razorpay_payment_id`. No card or VPA data. | `select` own rows, display columns only. |
| `billing_webhook_events` | Idempotency ledger keyed by Razorpay event id: ids, digest, status, attempts. No raw payload. | None. |

Functions (SECURITY DEFINER, `search_path = ''`, executable by `service_role` only): `billing_get_entitlement`, `billing_begin_subscription`, `billing_consume_trial_claim`, `billing_begin_webhook_event`.

Verified by 26 tests against the real SQL in an in-process Postgres: RLS on every table, own-rows-only reads, no client writes (including self-granting paid status), hidden Razorpay columns, no anon access, service-role-only functions, one-time trial per email hash and per user, trial claim surviving account deletion, duplicate-subscription prevention, every entitlement state, and webhook idempotency. Not covered: true concurrency (single connection), real Supabase/PostgREST.

Safety: all statements are `if not exists` / `create or replace` (idempotent), touch no existing table, and a rollback block is included.

## 8. Configuration

Server only. Never `VITE_`-prefixed, never in a client bundle.

| Variable | Purpose |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API credentials (Test Mode `rzp_test_…` keys for development) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature secret |
| `RAZORPAY_PLAN_ID_MONTHLY`, `RAZORPAY_PLAN_ID_ANNUAL` | Plan ids created by a Stage 2 script |
| `BILLING_PRICE_MONTHLY_PAISE=29900`, `BILLING_PRICE_ANNUAL_PAISE=149900` | Expected amounts; the server refuses to start a checkout if the Razorpay plan differs |
| `BILLING_TRIAL_DAYS=3`, `BILLING_AUTH_WINDOW_MINUTES=30` | Trial length and authorization window |
| `BILLING_PENDING_GRACE_HOURS=0` | Optional access during failed-renewal retries; 0 = none |
| `BILLING_TRIAL_PEPPER` | Secret used to hash emails for trial claims |
| `BILLING_ENFORCEMENT=off\|shadow\|on` | Rollout switch (§9) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only billing and webhook database access |

`scripts/bundle-api.mjs` `ALLOWED_EXTERNALS` gains `razorpay` (a deliberate edit to a guarded script). The bundle check already rejects JWT-looking and credential-looking strings; the service-role key is read only from the environment.

## 9. Entitlement enforcement

- A new gate runs **after** authentication and validation and **before** the daily AI quota gate, so a refused request consumes no quota. It applies to every endpoint with `ai: true`; non-AI routes and all local-first features are unaffected.
- Refusal is `402` with `code: 'subscription_required'`, the entitlement state, and a plain message; no payment detail in the body.
- It fails closed (`503 billing_unavailable`) if entitlement cannot be determined for a gated route.
- `BILLING_ENFORCEMENT`: `off` (default; nothing is gated, so merging cannot lock anyone out), `shadow` (computes the decision, logs would-be denials, gates nothing), `on`. Switching to `on` is a separate, approved production step.
- Stage 4 will confirm the existing client AI call sites handle `402` gracefully and send users to the billing screen. Some routes currently return offline fallbacks when AI is unavailable.

## 10. Endpoints (to be registered in `endpoints.ts`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/billing/status` | JWT | Plans, eligibility, entitlement, subscription |
| `POST /api/billing/subscriptions` | JWT | Create or reuse a subscription for Checkout |
| `POST /api/billing/subscriptions/verify` | JWT | Verify Checkout result against Razorpay |
| `POST /api/billing/subscriptions/cancel` | JWT | Cancel (cycle end, or immediate during trial) |
| `GET /api/billing/payments` | JWT | Billing history |
| `POST /api/billing/webhook` | Razorpay signature | Webhook intake (outside the JWT pipeline) |

## 11. Risks and open items

1. **₹5 verification charge.** Razorpay's future-start authorization charges ₹5 and refunds it automatically. This conflicts with a strict reading of "do not charge during the trial". It must be disclosed in the UI. **Needs owner acceptance.**
2. **Trial abuse with new email addresses.** Email hashing (with plus-tag and Gmail dot normalization) and per-user limits stop repeats on one account and re-signup with one address. A person with many addresses can still obtain multiple trials. A payment-method fingerprint would help, but no verified Razorpay field is confirmed for it. Residual risk, to be accepted or mitigated later.
3. **Account deletion with a live subscription.** `delete_own_account()` cascades the database rows but cannot cancel Razorpay, so billing would continue. Proposal for Stage 5: refuse deletion while a live subscription exists and tell the user to cancel first (an additive migration), plus a server cancel step.
4. **`total_count`.** Razorpay requires it. Proposed: 120 monthly cycles and 10 annual cycles (10 years).
5. **Cancel during trial.** Proposed: immediate cancellation with access kept until `trial_end_at`, because no charge has occurred.
6. **Failed-renewal grace.** Default none, per "prevent unauthorized paid access". `BILLING_PENDING_GRACE_HOURS` allows an opt-in grace.
7. **Razorpay prerequisites.** A Razorpay account with Subscriptions enabled, Test Mode keys, a webhook URL reachable from Razorpay (a tunnel for local testing) with the subscription events subscribed, and the webhook secret. These are manual dashboard steps for the owner.
8. **Existing 3 accounts and `BILLING_ENFORCEMENT`.** Safe while `off`; turning it `on` gates their AI use until they subscribe.

## Sources

- [Subscriptions workflow and authentication amounts](https://razorpay.com/docs/payments/subscriptions/workflow.md)
- [Subscription states](https://razorpay.com/docs/payments/subscriptions/states.md)
- [Payment retries](https://razorpay.com/docs/payments/subscriptions/payment-retries.md)
- [Create Subscription API](https://razorpay.com/docs/api/payments/subscriptions/create-subscription.md)
- [Create Plan API](https://razorpay.com/docs/api/payments/subscriptions/create-plan.md)
- [Cancel Subscription API](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription.md)
- [Subscription webhook events](https://razorpay.com/docs/webhooks/subscriptions.md)
- [Validate and test webhooks](https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md)
- [Integration guide (Checkout and payment signature)](https://razorpay.com/docs/payments/subscriptions/integration-guide.md)
- [Test Subscriptions](https://razorpay.com/docs/subscriptions/test-guide)
- [Subscriptions settings (payment methods and limits)](https://razorpay.com/docs/payments/subscriptions/settings.md)
