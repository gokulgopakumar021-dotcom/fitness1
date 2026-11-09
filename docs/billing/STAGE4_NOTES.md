# Billing Stage 4: frontend billing UI and 402 handling (notes)

Test Mode only. `BILLING_ENFORCEMENT` stays `off` by default; nothing in the client reads it. No server billing logic changed.

## What was added
| Area | Files |
|---|---|
| Typed client for `/api/billing/*` (plan KEY only is ever sent) | `src/lib/billingApi.ts` |
| Checkout loader/opener (script loaded only when a subscription is started) | `src/lib/razorpayCheckout.ts` |
| App-wide 402/503 announcement, hooked into `apiFetch` (Response returned unchanged) | `src/lib/billingGate.ts`, `src/lib/apiFetch.ts` |
| Display helpers (INR, dates, days left, state mapping, disclosure text) | `src/utils/billingPresentation.ts` |
| Billing screen | `src/components/billing/BillingPanel.tsx`, `BillingParts.tsx` |
| "Subscription required" prompt with a route to Billing | `src/components/billing/BillingRefusalNotice.tsx`, `src/App.tsx` |
| Settings category "Billing" (before "Account"; signed-in only) | `src/components/settings/SettingsView.tsx` |
| Two AI call sites that used to show a canned reply on any answer | `FloatingTrainerWidget.tsx`, `AiTrainerView.tsx` |
| CSP: `script-src` + new `frame-src` for Razorpay only | `src/server/security/headers.ts` |

## Behaviour
- Everything shown comes from `GET /api/billing/status` and `/payments`. "Days left" is a display reading of a server timestamp; no timer gates anything.
- Disclosure before Checkout: plan, amount and interval, trial length, first charge date, the Rs 5 card verification debit and its automatic refund, renewal until cancelled, how to cancel. For UPI/e-mandate it only says to check the amount shown in Checkout (not verified). The words "free" and "no charge" are never used.
- If the server's exact first-charge date, trial eligibility or amount differs from what was disclosed, Checkout is NOT opened; the corrected terms are shown and agreement is requested again.
- The Checkout callback is never treated as proof: it is posted to `/verify`; `409 authorization_not_confirmed` is retried (1.5 s, 3 s, 5 s), then "still confirming, do not pay again".
- Cancel: confirmation dialog with the access end date; result and refreshed status shown.
- 402 `subscription_required` and 503 `billing_unavailable` (from AI routes only) raise one app-wide message; "View plans" opens Settings, Billing. Each call site keeps its own fallback. Two sites that showed a canned coach line now show the subscription message.

## CSP (needs a real-browser check)
Added `https://checkout.razorpay.com` to `script-src`, and `frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com`. Script origin is in Razorpay's integration docs; the frame origins come from public reports of Checkout's frames, not from Razorpay documentation. Any further origin Checkout needs (`connect-src`, `img-src`) is unknown and UNVERIFIED. Verify in a Vercel preview with Test Mode keys before enabling billing. Note: this widens `script-src` beyond `'self'` for one third-party origin (see the IL-07 note in `src/test/noXssSinks.test.ts`).

## Not done here (by design)
- Payment recovery for `pending`/`halted` (button shown disabled, with an honest note): Stage 5.
- Account deletion flow, reconciler trigger, unrefunded-authorization alerting: Stage 5.
