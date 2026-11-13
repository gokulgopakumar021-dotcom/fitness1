# Iron Log AI: Stage 6 owner information and legal release protection (Stage 2D)

**Status: the legal pages remain DRAFTS. Nothing here is legal advice, and no legal fact has been added or invented in Stage 6.**
`LEGAL.isDraft` is still `true`, the "DRAFT: NOT YET LEGALLY REVIEWED" banner shows on all five pages, and the policy version labels are unchanged
(`2026-11-draft-1`, which is what the production database allowlist holds).

## 1. What Stage 6 changed (code and tests only)
| File | Purpose |
|---|---|
| `src/legal/releaseGate.ts` (new, tests-only helper) | Defines what may not survive into a published policy: draft-era wording, unfilled owner fields, draft version labels, a missing or malformed effective date, and invented-fact shapes. |
| `src/legal/legalReleaseGate.test.tsx` (new) | Proves the draft state is protected now, proves the gate catches each bad case, and links the policy versions to the database allowlist. |
| `docs/legal/AGE_ELIGIBILITY_RESEARCH.md` | Marked SUPERSEDED (it still described the old 14+ preference). |
| `docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md` | Points here for the current consolidated list. |

No policy wording, version label, banner, placeholder or `isDraft` value was changed. The 18+ decision was re-checked end to end and is consistent
(signup checkbox, Terms, Privacy, Body Scan screens, existing-user gate, server gate); `ageText.test.tsx` and the new test guard it.

## 2. How to list everything still blocking release
```
LEGAL_RELEASE_CHECK=1 npx vitest run src/legal/legalReleaseGate.test.tsx
```
It fails on purpose while drafts remain and prints every blocker. In normal runs that one test is reported as **skipped** (not passed) until `isDraft` is false.

Result at Stage 6 (17 blockers): effective date missing; both version labels are draft labels; "draft" appears 7 times in public text (the version lines and "This version" lines on Terms and Privacy, plus "audited for this
draft", "At the time of this draft" and "in this draft"); "audited" appears 4 times in Privacy; "which we have not verified" appears 3 times in Privacy.

## 3. Information only the owner can supply (never invented)
| Field | Appears on | Status |
|---|---|---|
| Operator legal name (an individual) | Terms, Privacy, Contact | `[OWNER TO PROVIDE]` |
| Operator address and jurisdiction | Terms, Privacy, Contact | `[OWNER TO PROVIDE]` |
| Effective date | all versioned pages | `[OWNER TO PROVIDE]` |
| Governing law and courts / dispute venue | Terms | `[OWNER TO PROVIDE]`, no arbitration clause proposed |
| Grievance officer or designated contact, if required | Terms, Privacy, Contact | `[OWNER TO PROVIDE]` (counsel to say whether required) |
| Payment-record retention period | Privacy | `[OWNER TO PROVIDE]` |
| Trial-prevention hash retention period | Privacy | `[OWNER TO PROVIDE]` |
| Gemini API tier and applicable Google data terms | Privacy | `[OWNER TO PROVIDE]`; the policy deliberately does not say whether Google retains or trains on the data |
| GST registration details | none | Owner decision recorded: not registered. No GST statement or number is published. Ask a CA whether to say so, and how invoicing applies |

Owner-approved facts already in the pages and guarded by tests: support email `support@ironlog.app`; ₹299 per month, ₹1,499 per year; refunds only for duplicate,
incorrect and verified billing errors, subject to applicable Indian law; whole platform 18+, self-declared and not verified; individual operator.

## 4. Statements in the public text that need an owner or counsel decision
These are not placeholders, so they would not be caught as "unfilled". They are in the draft because an earlier stage proposed them. Confirm, change or remove each.
1. **Liability cap of three months of fees** (Terms). A proposal, not an owner decision or a verified standard.
2. **"We do not sell your personal information"** (Privacy). Counsel to confirm the wording.
3. **"We do not use advertising or analytics trackers"** (Privacy). True of the code audited for Stage 2B; re-verify at release.
4. **Body Scan and Workout Mirror photos stay on the device**, "in the audited version". Re-verify against the released build, then drop "audited" wording.
5. **Backups, Vercel log retention, Upstash configuration, Supabase region**: unverified. State the verified facts, or say plainly that retention is set by the provider.
6. **Cross-border processing** (Vercel functions run in Tokyo, `hnd1` in `vercel.json`; Gemini) needs legal review.
7. **The ₹5 verification debit** (Refund Policy, Terms): Razorpay's own documentation is the only support for the refund; it has NOT been tested in Razorpay Test Mode for this account.
8. **Retention of acceptance records after account deletion**, and whether a self-declared 18+ confirmation is enough (see `AGE_ELIGIBILITY_DESIGN.md`).

## 5. Questions for the Indian lawyer
DPDP Act 2023 and Rules (whether notice, consent and grievance wording are required and what it must say, and whether self-declaration is adequate for an 18+ gate); consumer law
for auto-renewing digital subscriptions and refunds; whether a grievance officer or e-commerce disclosure is needed for an individual operator; governing law and venue; the liability cap; GST; retention of
acceptance evidence; cross-border transfer wording; overall acceptability of all five pages.

## 6. Release procedure (all manual, none done in Stage 6)
Do these in order. The code side is blocked by tests until each is true.
1. Fill every field in section 3 in `src/components/legal/content/*` and `legalConfig.ts`. Resolve every item in section 4. Reword the 14 draft-era sentences from section 2 with verified facts.
2. Counsel reviews the five pages.
3. Choose final version labels (no "draft") and an effective date `YYYY-MM-DD`. Set `termsVersion`, `privacyVersion` and `effectiveDate` in `legalConfig.ts`.
4. **Database allowlist, in the SAME release.** Only the `is_current` version is accepted at signup and by the existing-user notice. If the labels in the code are not in the database, EVERY signup is
   rejected. `legalReleaseGate.test.tsx` fails if the code's labels are not seeded by a migration in `supabase/migrations/`. Write a new reviewed, additive migration (do not edit applied ones), roughly:
   ```sql
   begin;
   update public.legal_policy_versions set is_current = false where policy in ('terms','privacy') and is_current;
   insert into public.legal_policy_versions (policy, version, is_current) values
     ('terms',   '<FINAL_TERMS_VERSION>',   true),
     ('privacy', '<FINAL_PRIVACY_VERSION>', true)
   on conflict (policy, version) do update set is_current = true;
   commit;
   ```
   Old versions stay in the table, and existing `legal_acceptances` rows are untouched. Rollback: set the previous version back to current and the new one to false.
5. Timing: apply the migration immediately before promoting the new deployment. Between the two, signups from the other side are rejected for a few minutes. Existing users see the
   "we've updated our Terms and Privacy Policy" notice again after the bump, by design.
6. Set `LEGAL.isDraft = false`. Several tests that pin the draft state will then fail on purpose (`legalPages.test.tsx` "shows the draft banner…", `legalReleaseGate.test.tsx` "the pages are still drafts…" and "every one of the five pages shows the banner…", and `ageText.test.tsx` "keep the draft state"). Update those deliberately in the same commit. Then run `npx vitest run src/legal`: the RELEASE GATE tests now run (not skipped) and must pass.
7. Production checks by hand: sign up on the live site; open all five legal URLs directly and after refresh; confirm no draft banner and no placeholder is visible.
