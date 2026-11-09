# Billing Stage 2: server-side Razorpay integration (notes)

Code: `src/server/billing/` (config, signature, emailHash, gateway, store, service, routes, schemas). Tests beside it. Test Mode only.

## Endpoints
| Route | Auth | Notes |
|---|---|---|
| GET `/api/billing/status` | JWT | plans (server config), trial eligibility, entitlement, safe subscription view |
| POST `/api/billing/subscriptions` | JWT | body `{planKey}` only; verified email required |
| POST `/api/billing/subscriptions/verify` | JWT | signature over our stored subscription id, then Razorpay fetch |
| POST `/api/billing/subscriptions/cancel` | JWT | decides from Razorpay's live state |
| GET `/api/billing/payments` | JWT | own payments, display columns |
| POST `/api/billing/webhook` | HMAC (raw body) | mounted before the JSON/auth pipeline; the only /api route without a JWT |

## Verification status of the Stage 1 open items
1. INR 5 refund timing / refunded field: docs confirm "INR 5, auto refunded" for a future start with no upfront amount (card). No bank timing is documented. We read `refund_status` (`full`), `amount_refunded` and payment `status: refunded`. LIVE CHECK BLOCKED (no Test Mode keys).
2. UPI Autopay / eMandate authorization amount with future start: docs table is method-agnostic; not stated per method. LIVE CHECK BLOCKED. UI must not claim INR 5 for non-card until confirmed.
3. Scheduled cycle-end cancel: docs say status stays until the cycle ends, then becomes `cancelled`. `has_scheduled_changes` is documented for plan/quantity changes; whether cancel sets it is not documented. We do not rely on it: our own `cancel_at_cycle_end` and `access_ends_at` drive access. LIVE CHECK BLOCKED.
4. total_count limits: still conflicting in docs; 120 and 10 both under either limit. LIVE CHECK BLOCKED (config allows 1..1200; Razorpay is the final judge).
5. Supabase email confirmation: live project has 3 users, 2 confirmed, 1 unconfirmed, so unconfirmed accounts exist. The platform flag `AUTH_REQUIRE_VERIFIED_EMAIL` is optional, so billing enforces `emailVerified` itself (403 `email_not_verified`).
6. SDK bundling: `razorpay@2.9.8` (CommonJS, depends on axios) stays an external import in `api/index.js`; `ALLOWED_EXTERNALS` updated; `check:api` passes. Not yet run on Vercel.

## Known gaps
- The SDK has no request timeout; calls are raced against `BILLING_RAZORPAY_TIMEOUT_MS` (a timed-out call is abandoned, not cancelled).
- Razorpay documents no idempotency key for subscription create: a crash between Razorpay create and our DB write could leave an unauthorized `created` subscription (it expires; notes carry `billing_row`).
- Vercel may pre-parse request bodies for plain functions; the webhook fails closed (`raw_body_unavailable`) if it receives anything but raw bytes. Must be proven with a Vercel preview plus a Razorpay test webhook before relying on it.
- The authorization payment id is only captured on the verify path; a lost browser callback is healed by webhook/reconciler for status, but the INR 5 payment row would be missing.
