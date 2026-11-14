# Iron Log AI — Owner Information Required (Stage 13)

Date: 2026-11-14. Branch `feature/ironlog-billing-referrals-launch`.
Status legend: **OPEN** (owner must supply), **LAWYER** (a lawyer must advise first), **UNKNOWN** (could not be verified from the repository or a read-only check), **DONE** (settled and in the product).

Nothing below has been invented. Every placeholder in the application is the value of `OWNER_PLACEHOLDERS` in `src/legal/legalConfig.ts` and renders as a highlighted field while `LEGAL.isDraft` is `true`. The user's approximate location (Hyderabad) is **not** used as the operator's address.

## A. Items the owner must supply or a lawyer must decide

| # | Item | Placeholder key | Why required | Where used | Who supplies | Blocks final publication? | Status |
|---|---|---|---|---|---|---|---|
| 1 | Exact legal name of the individual operator | `operatorLegalName` | Identifies the contracting party and the person responsible for personal data | Privacy ("Who this policy is from"), Terms ("About these terms"), Contact ("Who operates the service") | Owner | **Yes** | OPEN — `LEGAL NAME OF THE INDIVIDUAL OPERATOR` |
| 2 | Full address for legal notices | `operatorAddress` | Notices, contact details a consumer-facing service is generally expected to publish, jurisdiction input | Privacy, Terms, Contact | Owner (lawyer to confirm what must be published) | **Yes** | OPEN — `BUSINESS ADDRESS AND JURISDICTION` |
| 3 | Effective date of the final policies | `effectiveDate` (null) | Fixes when the final versions apply; release gate requires a real `YYYY-MM-DD` | All five pages, version labels | Owner, after lawyer sign-off | **Yes** | OPEN — `EFFECTIVE DATE OF THESE POLICIES` |
| 4 | Governing law and courts/dispute venue | `governingLaw` | Dispute clause; consumer-protection rules may limit what can be agreed | Terms ("Governing law and disputes") | **Lawyer advises**, owner confirms | **Yes** | LAWYER — `GOVERNING LAW AND COURTS / DISPUTE VENUE` |
| 5 | Grievance contact and any legally required grievance details | `grievanceContact` | Whether a grievance officer is required and what must be published (name, contact, response time) depends on the laws that apply | Privacy, Terms, Contact | **Lawyer advises** whether required; owner supplies the details | **Yes** | LAWYER — `GRIEVANCE OFFICER OR DESIGNATED CONTACT, IF REQUIRED` |
| 6a | Retention period for payment and subscription records | `billingRetention` | Records are kept after account deletion; the policy must say for how long | Privacy ("How long data is kept") | Owner with accountant; lawyer confirms | **Yes** | OPEN — `RETENTION PERIOD FOR PAYMENT RECORDS` |
| 6b | Retention period for the trial-prevention email hash | `trialHashRetention` | Kept after account deletion; period not decided | Privacy | Owner; lawyer confirms the design is acceptable | **Yes** | OPEN — `RETENTION PERIOD FOR THE TRIAL-PREVENTION HASH` |
| 6c | Retention for support emails, server logs and provider backups | none yet (text says "not set") | Privacy now says no fixed period is set for support emails; log and backup periods depend on providers | Privacy | Owner | Lawyer to say whether "not set" is acceptable | OPEN |
| 6d | Deletion schedule (how fast a deletion request is processed) | none | Policy says only that deletion is not instant in every system | Privacy | Owner and lawyer | Lawyer to say | OPEN |
| 7 | Exact Gemini / Google AI service tier and applicable data terms | `geminiTier` | Decides what the policy may say about Google retention and model-training use. The policy must not claim "not used for training" unless the terms establish it | Privacy ("AI features and Google Gemini"), Terms | Owner (from the Google AI account and API key) | **Yes** | UNKNOWN — `GEMINI API TIER AND APPLICABLE DATA TERMS` |
| 8a | Hosting/processor facts: Vercel log retention and plan | none | Privacy says "which we have not verified" | Privacy (third parties, retention) | Owner | Yes (draft wording must be replaced) | UNKNOWN |
| 8b | Upstash (Redis) region and configuration | none | Rate-limiter counters keyed by IP | Privacy | Owner | Yes (draft wording must be replaced) | UNKNOWN |
| 8c | Supabase region | none | Cross-border transfer disclosure | Privacy | — | Lawyer to review transfers | **DONE (read-only)**: project region is `ap-northeast-1` (Tokyo), read from the project listing on 2026-11-14. Backup retention is still UNKNOWN |
| 8d | Razorpay merchant account facts (settlement entity, refund and mandate rules, ₹5 authorisation behaviour) | none | Refund and cancellation wording depends on actual behaviour | Refund, Cancellation, Terms | Owner (Stage 12 Test Mode evidence) | **Yes** | UNKNOWN — Stage 12 pending |
| 8e | Support mailbox arrangements (who reads it, how long mail is kept) | none | Support communications are personal data | Privacy | Owner | No (but needs an answer for 6c) | OPEN |
| 8f | Security-incident contact and process | none | Privacy has no breach wording because no process exists | Privacy ("Security") | Owner and lawyer | Lawyer to say | OPEN |
| 9 | Live production values of price and trial settings | `BILLING_PRICE_MONTHLY_PAISE`, `BILLING_PRICE_ANNUAL_PAISE`, `BILLING_TRIAL_DAYS`, plus Razorpay plan amounts | Terms state ₹299, ₹1,499 and three days; code defaults match (29,900 / 149,900 paise / 3 days) but the live environment could not be read | Terms, Landing page, Billing UI | Owner | Yes (verify before publishing) | UNKNOWN |
| 10 | GST position confirmation | none | Owner decision: not GST-registered, no tax added to prices. A CA should confirm | Terms | Owner with CA | Lawyer/CA to confirm | OPEN (decision DONE; confirmation OPEN) |

## B. Facts already settled (do not change)

| Fact | Where it is in the product | Status |
|---|---|---|
| Brand: Iron Log AI; operated by an individual, not a registered company | Privacy, Terms, Contact | DONE |
| Support email `support@ironlog.app` (active, monitored) | `LEGAL.supportEmail` | DONE |
| Monthly ₹299, annual ₹1,499, no separate tax amount | Terms, Landing page | DONE (live values UNKNOWN, see 9) |
| Three-day trial, then selected paid plan | Terms (added in Stage 13) | DONE in text; billing lifecycle NOT verified (Stage 12 pending) |
| Refunds only for duplicates, incorrect charges, verified billing errors; no change-of-mind refunds | Refund Policy | DONE |
| 18+ for the whole Service including Body Scan; self-declaration | Terms, Privacy, signup | DONE |
| Referral programme excluded from initial launch | No referral wording or UI in `src` (checked, now tested) | DONE |
| Policy version labels are still `2026-11-draft-1` | `legalConfig.ts`, hosted `legal_policy_versions` (read-only check) | DONE (draft) |

## C. Not invented, deliberately absent

Telephone number, CIN/LLP number, GSTIN, registered office, named grievance officer, effective date, governing law, retention periods, Gemini tier.

## D. Order of work

1. Owner supplies items 1, 2, 6a, 6b, 6c, 6d, 7, 8a, 8b, 8e and 9.
2. Owner completes Stage 12 Razorpay Test Mode evidence (8d).
3. Indian lawyer decides items 4, 5, 8f and reviews 6 and 10.
4. Only then: final text, final version labels, a migration that adds those labels to `legal_policy_versions`, effective date, and (with separate owner approval) `LEGAL.isDraft = false`.
