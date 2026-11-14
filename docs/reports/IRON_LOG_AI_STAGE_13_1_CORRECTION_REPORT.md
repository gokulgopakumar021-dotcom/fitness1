# Iron Log AI — Stage 13.1 Correction Report

Date: 2026-11-14. Scope: trial-timing wording correction and Stage 13 verification. Documentation and customer-facing text only; no billing logic changed.
**This report does not declare the application legally compliant, does not publish policies, does not verify Razorpay behaviour and does not authorise release. No lawyer has reviewed anything.**

## 1. Initial branch and HEAD
- Repository `gokulgopakumar021-dotcom/fitness1`, branch `feature/ironlog-billing-referrals-launch` (fresh clone, checked out from `origin`).
- Initial HEAD `02eeca4` ("iron log stage 13"), i.e. the Stage 13 patch on top of `366eb9c` (Stage 10). Initial `git status --short`: clean.
- Stage 13 deliverables present: Finalization report, Policy Review Matrix, lawyer packet, owner-information checklist, `stage13Consistency.test.tsx`, edits to Privacy and Terms.
- The owner's local checkout may differ from this clone. Nothing was committed, pushed, merged or deployed.

## 2. Files inspected
`src/server/billing/config.ts`, `service.ts` (checkout creation, `applyAndMaybeAuthorize`, `buildSyncPatch`, status preview), `entitlement.ts`, `supabase/migrations/20261106052859_billing_core.sql` (`billing_begin_subscription`, entitlement function), `src/utils/billingPresentation.ts` (pre-checkout disclosure), `src/components/billing/{BillingParts,BillingOnboarding,BillingPanel}.tsx`, `src/components/home/LandingPageView.tsx`, the five legal pages (Terms, Privacy, Refund, Cancellation, Contact), the Stage 13 report, matrix, lawyer packet and owner-information file, and the related tests.

## 3. Actual trial timing, derived from code
1. When checkout is created, `billing_begin_subscription` (database clock) sets `expire_by = now() + authorisation window` (default 30 minutes) and `trial_end_at = expire_by + trial days` (default 3). Its comment states the intent: the trial is never shorter than advertised.
2. The server sends Razorpay `start_at = trial_end_at` and `expire_by`. The first plan charge is therefore **scheduled for `trial_end_at`**, an instant fixed at checkout creation.
3. Authorisation does not move that instant. On confirmation the server stamps `auth_verified_at` and, if before `trial_end_at`, `trial_start_at` (server observation time). Entitlement runs until `trial_end_at`.
4. Result: a customer who authorises inside the window has a trial end date between the trial length and the trial length plus the window (up to 30 minutes) after authorising. By design the trial is **not** shorter than three days after authorisation, which is the opposite of the concern raised in the Stage 12 note. Authorising after `expire_by` is not possible (the checkout expires and a new one is created with new dates).
5. The reference point is **checkout creation**, not sign-up.

What the code cannot establish (so no wording may promise it): (a) that Razorpay enforces `expire_by` and charges exactly at `start_at` (Stage 12 Test Mode verification pending); (b) the exact time of the first charge, which Razorpay schedules; (c) that `trial_start_at` equals the customer's real authorisation moment (it is when the server confirmed it); (d) that a later payment succeeds. Nothing here asserts a guaranteed 72 hours after authorisation.

## 4. Exact wording discrepancies found
| Where | Was | Problem |
|---|---|---|
| Terms review note, lawyer packet §3 and §13.4, Stage 13 report §7 and finding 2 | first charge "trial length plus a 30-minute window **after sign-up**" / "approximate to the minute" | Wrong reference point (checkout creation, not sign-up) and implied a floating date |
| Terms, Trial list | "The first plan charge is **taken on the day** the trial ends" | States provider behaviour as fact; no mention that the date is fixed at checkout; no payment-guarantee disclaimer |
| Pre-checkout disclosure (`buildDisclosure`) | "on {date}, **the day your trial ends**" | Same overstatement |
| Billing screen `BillingParts` | Trial row: "**Counted from when your authorisation was confirmed**" | Inaccurate: the end date is set at checkout |
| `BillingParts` / `TrialEndExplainer` | "first charge is **taken** on this date", "On {date} your first payment is **taken**" | Same overstatement |
| Refund Policy | "charged an amount **or at a time** that does not match what the app showed" | The app shows a date, not a time |
| Cancellation Policy | "shows the date of the first plan charge" | Minor: not marked as scheduled |

Privacy Policy and Contact page describe no trial timing and needed no change. The landing page says only that a trial may be offered and that the first charge date is shown; no change.

## 5. Documents corrected
- `TermsPage.tsx`: added that the date is set when checkout starts, does not move if the customer authorises later, and that checkout must be completed in the short time it stays open; first charge "scheduled for the date your trial is set to end", "exact time it is taken can vary", "authorising does not guarantee that a later payment will succeed"; review note rewritten (no "sign-up", no 72-hour promise).
- `billingPresentation.ts` (disclosure text), `BillingParts.tsx` (trial row, first-charge row, "What happens next"): wording only, "scheduled".
- `RefundPolicyPage.tsx` ("on a date"), `CancellationPolicyPage.tsx` ("scheduled for").
- Lawyer packet (§3, §13.4, new §13A), Stage 13 Finalization report (finding 2, §7), Policy Review Matrix (three-day trial row). Owner-information checklist needed no change.
- Unchanged: prices ₹299 / ₹1,499, no added tax, three-day trial as the intended offer, limited refund policy, 18+ everywhere, self-declaration wording, ₹5 wording (no verified-refund claim), `LEGAL.isDraft = true`, release gate, versions.

## 6. Tests added or updated
`src/legal/stage13Consistency.test.tsx` (+9 tests; file now 21):
- Source anchors: SQL `trial_end = expire + trial days`; service sends `start_at` from `trial_end_at` and `expire_by`.
- Terms: date set at checkout and not moved; first charge scheduled; timing can vary; no payment guarantee.
- Disclosure: "is scheduled for", "date is set when you start checkout", no "the day your trial ends".
- No customer-facing text (five policy pages, disclosure, billing screens) promises 72 hours, "three full days", "three days after authorisation", an exact charge time or a guaranteed payment, or says "Counted from when your authorisation was confirmed".
- No "after sign-up" timing wording in the Terms source or the lawyer and owner docs.
- Owner decisions unchanged (prices, one trial, no change-of-mind refund promise, 18+, no verified-age claim), draft state and release gate active, ₹5 wording makes no verified-refund claim.
Existing tests were not weakened; no tests skipped, retried or loosened. Version-label consistency continues to be covered by the existing Stage 13 and legal tests.

## 7. Test results
Node v22.23.4 (package requires 24.x; EBADENGINE warning only).
| Command | Result |
|---|---|
| `npm ci` | PASS (434 packages, 0 vulnerabilities) |
| Targeted: `src/legal`, `src/components/legal`, `src/components/billing`, `billingPresentation.test.ts`, `refundDisclosure.test.ts` | PASS: 15 files, 238 passed, 1 skipped (the release-gate test, by design) |
| `LEGAL_RELEASE_CHECK=1` gate test | Fails by design with 17 listed blockers, same count as Stage 13: the gate still blocks release |
| `npm run lint` (`tsc --noEmit`) | PASS |
| `npm run check:api` | PASS (`api/index.js` 226,123 bytes, 40 source files) |
| `npm run build` | PASS (chunk-size warning only) |
| `npm test` (full) | PASS: 205 files passed, 2 skipped; **3,739 tests passed, 0 failed, 47 skipped** (Stage 13 baseline 3,730 passed; +9 new). The 47 skips match Stage 13 and were not touched; 302 s |
Browser, device and Razorpay Test Mode checks were **not** run.

## 8. Remaining legal uncertainties
- Whether Razorpay enforces the authorisation deadline and charges at the scheduled start (Stage 12, **BLOCKED**).
- Live production values of trial days, authorisation window and plan amounts were not readable (**UNKNOWN**); text assumes the code defaults.
- With `pendingGraceHours` at 0, access ends at the trial end date and does not continue while a first charge is late or has failed. Described accurately in the cancellation and status pages; not changed.
- Date-only disclosure: the app shows a calendar date, not the time of day, for the first charge.
- Everything from Stage 13 remains open: operator identity, governing law, grievance contact, retention periods, liability cap, existing-user acceptance design, `AGE_ENFORCEMENT` and `BILLING_ENFORCEMENT` decisions.

## 9. Items for Indian lawyer review
1. Is "scheduled for", "can vary" and the no-payment-guarantee sentence adequate disclosure for a trial-to-paid conversion and recurring charge (consumer protection, RBI e-mandate rules)?
2. Should the disclosure show a time of day as well as a date for the first charge?
3. Is it acceptable that the authorisation window adds up to 30 minutes to the trial, and that the customer must authorise within the window?
4. Access stops at the trial end when the first payment is not yet confirmed: does this need explicit wording?
5. The existing Stage 13 questions on refund, grievance, retention and DPDP stand.

## 10. If the billing implementation should change (not implemented)
The code already gives at least the trial length after authorisation, so no change is required to honour "three days". If the owner wants a hard post-authorisation guarantee (for example a trial counted from the verified authorisation instant, or a first-charge time shown to the minute), that needs a design change to how `start_at` is set after authorisation and Stage 12 Test Mode evidence of Razorpay's behaviour. It is left for the deferred Stage 12 workstream.

## 11. Final verdict
**PASS WITH LIMITATIONS.** The customer-facing text and Stage 13 documents now match the inspected implementation, and lint, API check, build and the full suite pass. This is not a PASS in the strict sense only because of the open items in sections 8 and 9: Razorpay Test Mode is unverified, no full 72-hour post-authorisation guarantee is claimed, and no lawyer has reviewed the text. Billing logic was not changed.

- Final branch: `feature/ironlog-billing-referrals-launch`. HEAD unchanged at `02eeca4`; all Stage 13.1 changes are uncommitted in the working tree.
- Changed files: `src/components/billing/BillingParts.tsx`, `src/components/legal/content/{TermsPage,RefundPolicyPage,CancellationPolicyPage}.tsx`, `src/utils/billingPresentation.ts`, `src/legal/stage13Consistency.test.tsx`, `docs/legal/IRON_LOG_AI_INDIAN_LAWYER_REVIEW_PACKET.md`, `docs/reports/IRON_LOG_AI_STAGE_13_LEGAL_FINALIZATION_REPORT.md`, `docs/reports/IRON_LOG_AI_STAGE_13_POLICY_REVIEW_MATRIX.md`; added `docs/reports/IRON_LOG_AI_STAGE_13_1_CORRECTION_REPORT.md`.
- Remaining blockers: the Stage 13 list (owner facts, Stage 12 evidence, lawyer review, existing-user acceptance decision, unread production env values, final labels and migration).
- Nothing pushed, merged, deployed or applied; no Supabase, Razorpay, environment or flag changes.
