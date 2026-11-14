# Iron Log AI — Packet for Review by an Indian Lawyer

Prepared 2026-11-14 from repository branch `feature/ironlog-billing-referrals-launch`. **This packet is a factual briefing, not legal advice, not a compliance assessment and not a substitute for an Indian lawyer.** No policy has been approved, and no law is claimed to be satisfied. The live site shows every policy as an unreviewed draft (`LEGAL.isDraft = true`).

## 1. Product description
Iron Log AI (https://fitness1-five.vercel.app/) is a fitness tracking web app and installable app. Users log workouts, plan training, log food and body metrics, and use AI-assisted features: AI Personal Trainer, form cues, warm-up and routine generation, progressive-overload tuning, recovery insights, food parsing, physique analysis, plan import from uploaded documents, Workout Mirror (camera, on-device pose model) and Body Scan (camera photos, on device).

## 2. Operator structure
Operated by one individual, **not a registered company, LLP or other entity**. Exact legal name and address: **not supplied**. Operator is **not GST-registered**. Support: `support@ironlog.app`. The operator's country of residence for legal purposes has not been stated to this audit.

## 3. Subscription and trial model
- Monthly ₹299, annual ₹1,499, no separate tax amount added.
- Three-day trial, then automatic renewal at the selected plan price until cancelled. Billing through Razorpay Subscriptions.
- Implementation facts (from code): a trial starts only after Razorpay confirms payment authorisation; a small verification debit (₹5, 500 paise) may be made on authorisation; the first charge is scheduled the trial length plus a 30-minute authorisation window after sign-up; one trial per verified email, enforced by a salted one-way hash that is kept after account deletion.
- Entitlement gating (`BILLING_ENFORCEMENT`) is **off** in production, so AI features are not currently restricted by subscription. The Stage 12 Razorpay Test Mode verification (authorisation, trial conversion, cancellation, failed payment, refund behaviour, ₹5 return) is **pending**; none of it is claimed as verified.
- Cancellation (code): during trial, cancels immediately at Razorpay and the user keeps access until the trial end; on an active paid plan, cancels at the end of the paid cycle; pending/failed states stop billing with no access to keep. Account deletion cancels immediately with no refund of the current period and is refused until Razorpay confirms the stop.

## 4. Refund preference (owner)
Refunds considered for duplicate payments, incorrect charges and verified billing errors; no general change-of-mind refunds; statutory rights not excluded; no fixed processing time promised; no promise that the ₹5 debit is returned automatically.

## 5. Minimum age
18+ for the whole Service and Body Scan. Self-declaration only (checkbox at sign-up; a one-time declaration for pre-existing accounts); no date of birth, no ID verification. The database records only that the declaration was made, when, and the Terms version. Both signup checkboxes (Terms/Privacy, 18+) start unchecked and signup is blocked without both. Server-side age gating exists in code (`AGE_ENFORCEMENT`) but is **not enabled** in production.



## 6. Data collection and AI processing overview
| Data | Where it lives | Source of this statement |
|---|---|---|
| Email, hashed password, display name, session | Supabase (Auth + Postgres), project region ap-northeast-1 (Tokyo) | code, read-only project listing |
| Workout plans, sessions, active workout | Device and Supabase | code |
| Fitness profile, nutrition, body metrics, sleep, uploaded plan documents, custom foods | Device only (browser storage) | code and privacy page; not backed up |
| AI prompts and context | Sent from Vercel server functions to Google Gemini; content not stored in Iron Log's database (only per-day usage counters) | code |
| Plan-import files (PDF, PNG, JPEG, WebP, TXT, CSV, up to 14 MB) | Sent to Gemini during import | code |
| Subscription and payment records, Razorpay identifiers | Supabase and Razorpay; kept after account deletion, unlinked | code |
| Legal acceptance and 18+ records | Supabase; deleted with the account (cascade) | migrations |
| Request logs, rate-limit counters (IP, account id) | Vercel logs; Upstash Redis | code; retention UNKNOWN |
| Barcodes | Sent from the server to Open Food Facts | code |
| Font requests | Google Fonts (visitor IP) | `index.html` |

No analytics or advertising SDK was found in `package.json`, `index.html` or `src`. Gemini tier, retention and training-use terms: **unknown**. The policy deliberately does not deny training use.

## 7. Body Scan and camera functionality
Body Scan and Workout Mirror use the camera. Body Scan photos, measurements and a consent record are stored in the browser (IndexedDB) on the user's device only; saving photos is optional and off by default. No network call exists in the Body Scan components, and the in-app consent screen states that photos are not uploaded to Iron Log servers, AI services or analytics. The pose model is bundled with the app and frames are analysed on device. The feature states it cannot estimate body-fat percentage from photos. The Terms say it is not medical or clinical. **Open for review:** body images and measurements are sensitive-looking data even when kept on device; confirm what notice and consent wording is expected.

## 8. Third-party service providers
Supabase (auth, database), Vercel (hosting, serverless functions, logs), Google Gemini API, Razorpay (payments), Upstash (rate limiting), Open Food Facts (barcodes), Google Fonts, GitHub Actions (scheduled billing reconciliation; receives billing identifiers only). Cross-border processing includes Supabase Tokyo and Vercel functions (region reported in earlier audits as Tokyo).

## 9. Account deletion and retention
Self-service deletion (password re-entry and typed confirmation). Removes sign-in account, display name, synchronised workout data, usage counters, acceptance and 18+ records. Keeps unlinked payment records and the trial-prevention hash (periods **not set**). Device-only data is erased best-effort on the deleting device only. Provider backups and logs age out on provider schedules (unverified). Support-email retention not set.

## 10. Existing policy drafts
`/privacy`, `/terms`, `/refund-policy`, `/cancellation-policy`, `/contact`, source in `src/components/legal/content/`. They contain visible draft banners, owner placeholders and reviewer notes. Version labels `2026-11-draft-1` (Terms and Privacy). No effective date. No governing law.

## 11. Outstanding owner information
See `docs/legal/IRON_LOG_AI_OWNER_INFORMATION_REQUIRED.md`: operator name, address, effective date, governing law, grievance contact, retention periods, Gemini tier, Vercel/Upstash facts, live price and trial settings, Razorpay Test Mode evidence.

## 12. Questions requiring legal advice
1. Can an individual sole operator contract on these Terms, including if based outside India? Is a business-name or other registration expected before charging customers?
2. Which Indian laws apply to the service and to the operator (including the Digital Personal Data Protection Act 2023 and Rules, the Information Technology Act 2000 and its intermediary and reasonable-security rules, the Consumer Protection Act 2019 and the Consumer Protection (E-Commerce) Rules 2020, and any rules on recurring online payments)? What notices, consent forms, grievance officer details and response times follow? (No claim is made that any of these is satisfied.)
3. Is a grievance officer or other designated contact required for this operator? What must be published?
4. Is a self-declared 18+ checkbox sufficient, including under the DPDP Act's treatment of children? What should the Terms say if someone is later found to be under 18?
5. Are body photos/measurements (kept on device) and health-related fitness data subject to additional notice or consent requirements even though they are not uploaded?
6. Is the cross-border transfer disclosure (Supabase Tokyo, Vercel, Google) adequate? Is a Gemini data-processing agreement needed, and what may the policy say about Google's use of data?
7. Deletion design: is retaining unlinked payment records and the email hash acceptable, for how long, and what retention periods should be stated? Should a minimal acceptance record be retained after deletion (currently deleted with the account)?
8. Refund and cancellation wording: does the "duplicates, incorrect charges, verified errors only" approach comply with consumer and e-commerce rules for a digital subscription with an automatic trial-to-paid conversion? Is the trial disclosure adequate, and does the ₹5 authorisation need different disclosure?
9. Is a limitation of liability capped at three months' payments, and the fitness-injury disclaimer, enforceable under Indian law? (The cap figure is a placeholder proposal.)
10. Governing law, venue and whether arbitration is appropriate given consumer rules.
11. Existing-user notice: is a non-blocking notice with an optional "I've read the updates" button enough for a material policy change, or must existing users give an explicit blocking acceptance? (See inconsistency 3 below.)
12. Taxes: the owner is not GST-registered and prices carry no tax line; the owner should take advice from a chartered accountant on registration thresholds and invoicing.
13. Uploaded plan documents and AI output: any intermediary or user-content obligations and the content licence wording.
14. Security incidents: what notice to users and authorities is required, and what internal process should exist.

## 13. Apparent policy inconsistencies and gaps found by this audit
1. **Notice vs acceptance (existing users).** The existing-user notice is a non-blocking banner. "Remind me later" hides it for the browser session only, and the button text and notice copy say it records that the user has *seen* the updates, not agreement. This is weaker than an explicit blocking acceptance; it is documented, not changed.
2. **Acceptance records are deleted with the account**, so the operator cannot later show who accepted which version. The Privacy Policy now says so (Stage 13 edit); counsel should decide.
3. **Enforcement flags are off in production** (`AGE_ENFORCEMENT`, `BILLING_ENFORCEMENT` unset per the Stage 10 report; the Vercel environment was not re-read in Stage 13). The age gate is therefore not enforced at the API, and AI features are not yet paywalled, although the policies describe both as the intended design.
4. **"Three days" is approximate**: the first charge is trial length plus a 30-minute authorisation window; the app shows the exact date.
5. **Several draft admissions remain in public body text** on purpose (for example "audited", "have not verified"); the release gate lists them and will block publication until replaced.
6. **No breach-notification, grievance-process or deletion-timeline wording** exists because no process or period has been set.
7. **Landing page and Billing UI** repeat the prices and must be re-checked whenever the Terms change (production price and trial settings were not read).

## 14. Recommended review checklist
- [ ] Confirm operator identity, address and any registration or tax position.
- [ ] Review Privacy Policy against actual data flows in section 6.
- [ ] Review Terms: eligibility, subscription and trial disclosure, AI and fitness disclaimers, liability, disputes.
- [ ] Review Refund and Cancellation against the Razorpay Test Mode evidence once Stage 12 is done.
- [ ] Decide existing-user acceptance mechanism and acceptance-record retention.
- [ ] Decide grievance officer, governing law and venue.
- [ ] Approve retention periods and deletion schedule.
- [ ] Approve final wording; owner then sets effective date, final version labels and the matching database migration; separate approval before `LEGAL.isDraft = false`.
