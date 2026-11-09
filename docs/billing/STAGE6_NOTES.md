# Billing Stage 6: tests and security audit (notes)

Test Mode only. `BILLING_ENFORCEMENT` default is still `off`. No SQL migration was added or applied; the Stage 1 SQL is unchanged. Security findings are in `SECURITY_REVIEW.md`.

## Master prompt section 10: requirement to test map

Paths are under `src/` unless noted. "Mock" = in-memory fakes for Razorpay and the store; "PGlite" = the real Stage 1 SQL run in-process.

| Requirement | Covered by | Level |
|---|---|---|
| Trial activation | `server/billing/service.test.ts` (valid signature + Razorpay confirmation starts the trial, consumes the claim); `test/rls.billing.test.ts` (offers the trial once, full-length window) | Mock + PGlite |
| Trial expiry | `test/rls.billing.test.ts` (trial grants access only while the database clock is before `trial_end_at`; expired trial; completed = expired); `server/billing/stage6.test.ts` (gate answers 402 for `trial_expired`, `cancelled`, `expired`, `none`) | PGlite + gate |
| Trial eligibility | `service.test.ts` (used trial gets no `start_at` and pays the full amount; same confirmed email on a new account gets no second trial; unverified email never offered one); `rls.billing.test.ts` (same hash / same user under another email refused; claim survives deletion) | Mock + PGlite |
| Subscription creation | `service.test.ts` (server-side plan data only; annual plan; plan-amount mismatch refused; Razorpay failures mapped safely; orphan cancelled if the id cannot be saved) | Mock |
| Payment authorization | `service.test.ts` (authorization verification block); `components/billing/BillingPanel.test.tsx` (Checkout opened with server ids only) | Mock + component |
| Successful payment verification | `service.test.ts` (valid signature + Razorpay says authenticated; idempotent repeat); `stage5.test.ts` (recovery confirmed only when Razorpay says active) | Mock |
| Invalid payment signatures | `service.test.ts` (invalid, other payment id, swapped order); `signature.test.ts`; `routes.test.ts` (malformed rejected at validation); `stage5.test.ts` (invalid recovery signature does not even ask Razorpay) | Mock |
| Webhook signature verification | `signature.test.ts`; `webhook.test.ts` (invalid before any database call; modified body); `routes.test.ts` (raw-byte HTTP tests, re-serialised JSON fails, non-JSON content type fails closed) | Mock + HTTP |
| Duplicate webhook events | `webhook.test.ts` (duplicate acknowledged; in-progress 409; failed then retried); `rls.billing.test.ts` (idempotency function); **new** `stage6.test.ts` (simultaneous identical deliveries processed once; replay under a new event id converges) | Mock + PGlite |
| Duplicate subscription creation | `service.test.ts` (second call reuses; plan switch cancels first); `rls.billing.test.ts` (existing returned; unique index); **new** `stage6.test.ts` (concurrent calls create one Razorpay subscription; crashed intent row heals) | Mock + PGlite |
| Payment failure | `webhook.test.ts` (pending -> halted gives no access; forged "charged" body cannot grant access); `rls.billing.test.ts` (pending/halted denied, grace opt-in); `BillingPanel.test.tsx` (payment-failed screen); **new** `stage6.test.ts` (halted stays halted and no access after a "charged" body) | Mock + PGlite + component |
| Cancellation and access after cancel | `service.test.ts` (trial cancel keeps access to original trial end; paid cancel at cycle end keeps paid period; idempotent); `rls.billing.test.ts` (access through the paid period, then ends; cancelled-before-payment = expired trial); `webhook.test.ts` (cancelled finalises, keeps promised access) | Mock + PGlite |
| Unauthorized access | `routes.test.ts` (every billing route requires a verified token); `stage5.test.ts` (the three Stage 5 routes); `rls.billing.test.ts` (anon has no access to anything) | HTTP + PGlite |
| Cross-user isolation | `routes.test.ts`, `service.test.ts`, `stage5.test.ts` (user B cannot verify, cancel, recover, list or prepare deletion for user A); `entitlement.test.ts` (user B does not inherit A's trial); `rls.billing.test.ts` (users read only their own rows) | HTTP + Mock + PGlite |
| RLS enforcement (incl. deletion gate) | `test/rls.billing.test.ts`: RLS on every table, no client writes, hidden columns, service-role-only functions, deletion refused in every live state, allowed only after a verified stop, orphans matchable | PGlite |
| Server-side entitlement | `entitlement.test.ts` (off / shadow / on, fail closed 503, non-AI never gated); **new** `stage6.test.ts` (all nine states; client-supplied "paid" claims ignored) | HTTP |
| Mobile billing UI | `components/billing/BillingPanel.test.tsx` mobile layout and accessibility contract (class and semantics checks only: jsdom has no layout engine, so real-device rendering is a manual check) | Component |
| Error and retry handling | `BillingPanel.test.tsx` (verify retries then "still confirming, do not pay again"; load errors with retry; cancel failure inside the dialog); `service.test.ts` (timeouts 504, outages retryable); `lib/billingGate.test.ts` (402/503 announced for every AI call site) | Component + Mock |
| Secrets never exposed | `routes.test.ts` (no secret in any response); **new** `stage6.test.ts` (no secret in logs or responses when dependencies throw secret-bearing errors); **new** `test/billingSecurityGuards.test.ts` (confinement, bundle, `.env.example`, CSP, workflow); `test/billingClientGuards.test.ts` (client) | Static + Mock |

## New or changed in Stage 6

Created: `docs/billing/SECURITY_REVIEW.md`, `docs/billing/STAGE6_NOTES.md`, `src/server/billing/stage6.test.ts` (25 tests), `src/test/billingSecurityGuards.test.ts` (13 tests).
Modified: `src/server/billing/service.ts` (S6-01), `src/server/billing/config.ts` and `routes.ts` (S6-02), `src/server/security/logger.ts` and `logger.test.ts` (S6-11, one test added), `.github/workflows/billing-reconcile.yml` (S6-03). `api/index.js` is regenerated and **not in the patch**: run `npm run build:api` after applying.

No existing test was removed or weakened and no guard test needed changing.
