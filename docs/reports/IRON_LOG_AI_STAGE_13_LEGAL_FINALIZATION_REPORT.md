# Iron Log AI — Stage 13 Legal Finalization Report

Date: 2026-11-14. Status legend: **DONE**, **OPEN**, **BLOCKED**, **UNKNOWN**.
**This report does not declare the application legally compliant, does not publish final policies and does not authorise release. No lawyer has reviewed anything.**

## 1. Verdict
**PASS WITH LIMITATIONS — review packet prepared, but specific technical and owner items remain.** The repository is ready for an Indian lawyer to review. It is not ready to publish: eight owner facts are missing, Stage 12 is pending, and two design points (existing-user acceptance, API age enforcement) need an owner and lawyer decision.

## 2. Branch, HEAD and initial worktree
- Repository `gokulgopakumar021-dotcom/fitness1`, branch `feature/ironlog-billing-referrals-launch`, HEAD `366eb9c99bdda6f3d5e08f1984d867553c41972d` ("ironlog-stage10-results-update2").
- Working copy: a fresh clone (not the owner's local checkout). Initial `git status --short`: clean (no staged, unstaged or untracked changes). Nothing of the owner's was reset, cleaned, stashed or overwritten. The owner's local checkout may differ.
- Nothing was committed, pushed, merged or deployed.

## 3. Existing legal architecture (DONE: inspected)
- `src/legal/legalConfig.ts`: brand, support email, `isDraft: true`, versions `2026-11-draft-1` (terms and privacy), `effectiveDate: null`, eight `OWNER_PLACEHOLDERS`.
- Pages in `src/components/legal/content/` (Privacy, Terms, Refund, Cancellation, Contact), rendered by `LegalRoot`/`LegalPage`; routes in `src/legal/routes.ts`; Vercel rewrites for the five approved paths.
- Acceptance: `policyAcceptance.ts`, `PolicyUpdateNotice.tsx`; DB tables `legal_acceptances`, `legal_policy_versions`; functions `acknowledge_legal_update` and a signup trigger (migrations 20261112060134, 20261113043228).
- Age: `ageEligibility.ts`, `AgeEligibilityGate.tsx`, table `age_declarations`, functions `declare_adult_18_plus`, `get_my_age_eligibility` (migration 20261113043241); server gate `src/server/security/ageGate.ts` (`AGE_ENFORCEMENT`); Body Scan gate `getBodyScanGate`.
- Release gate: `src/legal/releaseGate.ts` and `legalReleaseGate.test.tsx`.

## 4. Policy findings
| # | Finding | Status |
|---|---|---|
| 1 | Existing drafts were already careful (no compliance claims, no invented facts, no referral wording). Checked against code rather than assumed. | DONE |
| 2 | Terms did not state the three-day trial. Added "currently three days" and a review note on live env values and the 30-minute authorisation window. **Stage 13.1 correction:** the review note said the first charge follows "sign-up"; it is fixed at checkout creation. Corrected. | DONE (corrected in 13.1) |
| 3 | Terms had no Body Scan limitation. Added a bullet (18+, device-based, no body-fat estimate, approximate, not clinical), mirroring the in-app consent screen. | DONE |
| 4 | Privacy did not mention support emails. Added; no retention period invented. | DONE |
| 5 | Privacy did not say acceptance and 18+ records are deleted with the account (they are: `ON DELETE CASCADE`). Added to the data table and deletion list; counsel note added. | DONE text / OPEN (lawyer) |
| 6 | Supabase region read-only: `ap-northeast-1`. Review note updated. | DONE |
| 7 | No breach-notification, grievance process or deletion-timeline wording exists. A review note was added; no promise made. | OPEN |
| 8 | Draft-era admissions remain in public body text ("audited", "have not verified", "draft") by design; the gate lists them. | OPEN |
| 9 | Liability cap of three months' payments is a placeholder proposal. | OPEN (lawyer) |

## 5. Owner-information gaps
Full table in `docs/legal/IRON_LOG_AI_OWNER_INFORMATION_REQUIRED.md`. Operator legal name, address, effective date, governing law (lawyer), grievance contact (lawyer), retention periods (payment records, trial hash, support mail, logs), Gemini tier, Vercel and Upstash facts, live price and trial settings: all **OPEN**, **BLOCKED** or **UNKNOWN**. Nothing was invented.

## 6. Privacy and third-party processing findings
- Body Scan: no network call in `src/components/bodyscan`; photos, measurements and consent stay in the browser (DONE from code; no device test).
- AI: 16 Gemini-backed server routes; content not stored in the database (counters only). Only `/api/extract-plan` takes files or images (PDF, PNG, JPEG, WebP, TXT, CSV up to 14 MB). Physique routes are text-only.
- Analytics: none found in `package.json`, `index.html` or `src`. Google Fonts and Razorpay checkout are disclosed.
- Gemini terms: UNKNOWN. Vercel log retention, Upstash configuration, backup retention: UNKNOWN.

## 7. Subscription and refund wording findings
- Prices and trial in code defaults equal the owner decision (29,900 and 149,900 paise, 3 days); now tested. Live Vercel and Razorpay values were not readable: **UNKNOWN**.
- First charge is scheduled for checkout creation + 30-minute authorisation window + trial length (not "after sign-up", corrected in Stage 13.1); the date is fixed at checkout and not promised as 72 hours after authorisation. See the Stage 13.1 correction report.
- Cancellation code matches the page: trial cancels at once with access until the trial end; paid cancels at cycle end; deletion cancels immediately, no refund of the current period.
- Refund page matches the owner's limited-refund decision; no automatic or timed refund promise; ₹5 return not promised.
- Stage 12 Razorpay Test Mode verification remains pending, so provider behaviour is **BLOCKED / not verified**. No payment or refund was made.

## 8. 18+ declaration findings
- Both signup checkboxes start unchecked; signup is blocked without both (`AuthScreens.tsx`): DONE.
- Wording is a self-declaration; tests forbid verification claims: DONE.
- Hosted functions, read-only: `acknowledge_legal_update`, `declare_adult_18_plus`, `get_my_age_eligibility`, `delete_own_account` are SECURITY DEFINER with `search_path=""`, executable only by authenticated and service_role: DONE. (Function body hashes were read, not diffed against the migrations.)
- Body Scan is gated client-side on database status and fails safe; the feature has no API.
- API-level gate exists but `AGE_ENFORCEMENT` was unset in production per Stage 10; not re-read now: **OPEN** (owner decision, not changed).

## 9. Existing-user update findings
- Correctly identifies users whose latest record is not the current pair, re-triggers on a new version, links to the pages, records version and database time, never records silently: DONE.
- **OPEN:** the notice is non-blocking, "Remind me later" hides it for the session, and its copy says the button records that the user has *seen* the update. This is not an explicit blocking acceptance and can be bypassed. It was not changed (a hard gate is a product and legal decision). Options for the owner and lawyer are in section 12 of the lawyer packet.

## 10. Policy versioning findings
Labels `2026-11-draft-1` match across `legalConfig.ts`, the migration seed (existing test) and the hosted `legal_policy_versions` allowlist (read-only check): DONE. Final labels are not published (draft rule).

## 11. Migration changes
**None.** No schema, allowlist or function change was needed. No migration was applied; migration history was not repaired; no production record was modified. Only read-only SELECTs and list calls were made against Supabase (project listing, migration list of 16 rows matching the repository, version allowlist, function metadata).

## 12. Tests executed (Node v22.23.4 here; package requires 24.x, EBADENGINE warning only)
| Command | Result |
|---|---|
| `npm ci` | PASS, 434 packages |
| Legal, auth and age subset (`src/legal`, `src/components/legal`, `src/components/auth`, `BodyScanFlow.age`) | PASS: 12 files, 190 passed, 1 skipped |
| `LEGAL_RELEASE_CHECK=1` gate test | Fails by design with 17 listed blockers (missing effective date, two draft labels, draft wording, and so on). This proves the gate blocks release. |
| `npm run lint` (`tsc --noEmit`) | PASS |
| `npm run check:api` | PASS (`api/index.js` 226,123 bytes, 40 source files) |
| `npm run build` | PASS (chunk-size warning only) |
| `npm test` (full) | PASS: 205 files passed, 2 skipped; **3,730 tests passed, 0 failed, 47 skipped**; 320 s |
The 47 skipped tests match the Stage 10 count and were not touched. No skips, retries or timeouts were added. Browser and device testing was **not** repeated. Migration-history tests ran as part of the full suite; migration files did not change.

## 13. Files changed (all uncommitted)
- Modified: `src/components/legal/content/PrivacyPage.tsx`, `src/components/legal/content/TermsPage.tsx`.
- Added: `src/legal/stage13Consistency.test.tsx` (12 tests).
- Added docs: `docs/legal/IRON_LOG_AI_OWNER_INFORMATION_REQUIRED.md`, `docs/legal/IRON_LOG_AI_INDIAN_LAWYER_REVIEW_PACKET.md`, `docs/reports/IRON_LOG_AI_STAGE_13_POLICY_REVIEW_MATRIX.md`, this report.
- Not touched: `LEGAL.isDraft` (still `true`), draft banners, release gate, enforcement code, migrations, configuration.

## 14. Remaining blockers
1. Missing owner facts (section 5). **BLOCKED**
2. Stage 12 Razorpay Test Mode evidence. **BLOCKED**
3. Indian lawyer review and incorporation of feedback. **OPEN**
4. Existing-user acceptance mechanism decision. **OPEN**
5. Production env values (`BILLING_PRICE_*`, `BILLING_TRIAL_DAYS`, `AGE_ENFORCEMENT`, `BILLING_ENFORCEMENT`) not readable here. **UNKNOWN**
6. Final version labels, matching migration and effective date. **BLOCKED** on 1 to 3.

## 15. Owner actions
Supply the items in the owner-information file; read the production env values and confirm them; finish Stage 12; decide on the existing-user acceptance design and whether to enable `AGE_ENFORCEMENT`; give the lawyer the packet; commit or apply this patch if you accept it.

## 16. Lawyer actions
Work through the 14 questions and the checklist in the lawyer packet, including grievance officer, governing law, retention, consumer and e-commerce disclosure, DPDP treatment of the age self-declaration and body-related data, and the liability cap.

## 17. Recommended next stage
Stage 12 Razorpay Test Mode verification, in parallel with owner collection of the missing facts; then lawyer review; then Stage 14: final text, final version labels, the matching migration (reviewed, with rollback), effective date and a separate owner-approved flip of `LEGAL.isDraft`. Do not flip it before that.
