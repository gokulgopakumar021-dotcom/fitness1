# Iron Log AI: Stage 2B owner and legal-review checklist

> **Current consolidated list: `STAGE_6_OWNER_INFORMATION_AND_RELEASE.md` (Stage 2D).** It supersedes the release-gate description below: the gate now also blocks draft-era wording and draft version labels. This file is kept for its item-by-item history.

**All legal pages are DRAFTS. They are not legally approved.** `LEGAL.isDraft = true` in `src/legal/legalConfig.ts` keeps a visible
draft banner, highlighted `[OWNER TO PROVIDE: ...]` placeholders and reviewer notes on every page. Do not set it to `false` until every
item marked **BLOCKS RELEASE** is done. A test (`RELEASE GATE` in `src/legal/legalPages.test.tsx`) fails the moment drafts are switched off
while a placeholder or review note remains.

Nothing below has been invented. Where the answer is unknown the page shows a placeholder.

## A. The twelve required items

| # | Item | Where it appears | Owner action | Blocks release |
|---|---|---|---|---|
| 1 | Individual operator's legal name | Privacy, Terms, Contact (`operatorLegalName`) | Supply the name to publish | **Yes** |
| 2 | Business address and jurisdiction | Privacy, Terms, Contact (`operatorAddress`) | Supply; counsel to confirm the contracting jurisdiction. If the operator is resident outside India, counsel should also advise on Indian consumer, tax and data rules for an overseas individual serving Indian users | **Yes** |
| 3 | Indian legal review of all five pages | all | Engage counsel; give them this checklist and `AGE_ELIGIBILITY_RESEARCH.md`. Counsel questions are in the audit (§11) and in the in-page review notes | **Yes** |
| 4 | Age eligibility: **18+ for the whole platform (owner decision, Stage 2D)** | Terms "Who can use", Privacy "Age and children" | Self-declaration, no date of birth, built in Stage 2D (`AGE_ELIGIBILITY_DESIGN.md`). Counsel to confirm the wording and that self-declaration is sufficient. The old `minimumAge` placeholder is gone | **Yes** (counsel review) |
| 5 | Gemini API tier and data terms | Privacy "AI features" (`geminiTier`) | State the tier in use and what Google's terms say about retention and training. Until then the page deliberately makes no "not used for training" claim | **Yes** |
| 6 | Retention periods: payment records; hashed trial-prevention email | Privacy "How long data is kept" (`billingRetention`, `trialHashRetention`) | Decide periods and purposes with counsel and a CA; none are invented | **Yes** |
| 7 | Final effective date; final version labels | Privacy and Terms version line (`effectiveDate`); `termsVersion`, `privacyVersion` | Set date; replace `2026-11-draft-1` with final labels. **Changing a version re-shows the one-time notice to everyone** | **Yes** |
| 8 | Razorpay ₹5 verification debit and refund behaviour | Refund Policy review note; in-app text | Test cards, UPI and e-mandate in Razorpay Test Mode. The in-app text (`billingPresentation.ts`, `BillingOnboarding.tsx`) no longer claims an automatic refund (corrected in Stage 2D, Stage 4: "Razorpay may make a small verification debit... refund handling is described in the Refund Policy"). Verification in Test Mode is still open and is the only thing that could justify saying more. The policy pages make no such claim | **Yes** |
| 9 | Real cancellation and access-end behaviour | Cancellation Policy review note | Test cancel in trial, active, pending, failed states against Razorpay Test Mode and record results; then firm up wording | **Yes** |
| 10 | Tax and invoicing | Terms plans section | CA to confirm GST/invoicing for a digital subscription sold by an unregistered individual, and whether ₹299 / ₹1,499 stay tax-free. Pages claim no GST registration or collection | **Yes** |
| 11 | Grievance officer / designated contact | Privacy, Terms, Contact (`grievanceContact`) | Counsel to say whether one is required and what details to publish | Likely |
| 12 | Other pre-launch requirements | see section B | see section B | **Yes** |

## B. Additional items found while implementing

1. **Governing law and dispute venue** (`governingLaw`) is a placeholder; no arbitration clause is proposed. Counsel to choose.
2. **Liability cap** (three months of fees) in Terms is a placeholder proposal, not a verified standard.
3. **Brand spelling.** RESOLVED in Stage 2D / Stage 5: the approved public spelling is "Iron Log AI". App text, page metadata, the web manifest, notification titles and the legal pages now use it; `src/test/brandConsistency.test.ts` guards against drift. OPEN: the logo image files still show the one-word artwork "IRONLOG AI" (see docs/legal/STAGE_5_BRAND_CLEANUP.md).
4. **Free vs paid split.** Landing copy now says AI features "may need a trial or a paid plan". Production `BILLING_ENFORCEMENT` was not inspected (default is `off`). Confirm the true split and adjust landing and Terms.
5. **Live prices.** Prices are env-overridable. Confirm production still equals ₹299 / ₹1,499 and the trial length; policy copy hard-codes the prices (a test pins them to the code defaults only).
6. **Supabase region, backup retention, Vercel log retention, Upstash region and configuration**: unverified; Privacy says so.
7. **Acceptance records on account deletion.** The new table cascades with the account. Counsel to say whether acceptance evidence should be kept after deletion.
8. **Direct API sign-ups.** The Terms checkbox is enforced in the app and in `AuthContext.signUp`, but the Supabase sign-up endpoint is public: a client that calls it directly gets an account with no acceptance record (it would then see the one-time notice). Server-side enforcement would need an Auth hook, out of scope.
9. **Existing-user notice** appears only after the migration is applied. Until then it stays hidden by design.
10. **Google Fonts** sends visitors' IP addresses to Google. Disclosed; self-hosting is a later option.
11. **Support mailbox.** Owner states `support@ironlog.app` is active and monitored. Not verifiable from the repo.
12. **Per-feature notices** are concise drafts; counsel should review the fitness-injury wording.
13. **App stores.** If the Capacitor wrapper is ever published, a privacy-policy URL and an account-deletion URL are required (`/privacy` exists).
14. **Referral programme** is excluded; the referral branch was not touched. Terms need extending if it ships.
15. **Notice email / transactional emails** (Supabase default sender) were not reviewed.

## C. Release steps (owner)

1. Fill every placeholder; counsel signs off; set effective date and final version labels.
2. Apply `supabase/migrations/20261112060134_legal_acceptances.sql` to a **staging/preview** Supabase project first, check sign-up and the notice, then Production **with explicit approval**. Rollback: `supabase/manual/rollback_legal_acceptances.sql`.
3. Review `vercel.json` (five narrow rewrites) on a **Preview deployment** and open each route directly, refresh, and with a trailing slash.
4. Set `LEGAL.isDraft = false`; run the tests; the release gate must pass.
5. Merge and deploy only on the owner's explicit instruction.
