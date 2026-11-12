# Iron Log AI: Stage 2B implementation report (legal, privacy and commercial readiness)

**Everything here is DRAFT and subject to owner and Indian legal review. Nothing is legally approved.**

## 1. Branch and starting commit
- Branch: `implementation/stage-2b-legal-readiness` (local only)
- Starting commit: `ceac8b81a4f6eff7097f6fbce834604b85b4bf5c` (`main`, clean tree)
- All work is **uncommitted**, delivered as patch files.

## 2. Files added
- `docs/legal/AGE_ELIGIBILITY_RESEARCH.md`
- `docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md`
- `docs/legal/STAGE_2B_IMPLEMENTATION_REPORT.md` (this file)
- `src/components/legal/AiNotice.tsx`
- `src/components/legal/LegalLinks.tsx`
- `src/components/legal/LegalPage.tsx`
- `src/components/legal/LegalPrimitives.tsx`
- `src/components/legal/LegalRoot.tsx`
- `src/components/legal/PolicyUpdateNotice.test.tsx`
- `src/components/legal/PolicyUpdateNotice.tsx`
- `src/components/legal/content/CancellationPolicyPage.tsx`
- `src/components/legal/content/ContactPage.tsx`
- `src/components/legal/content/PrivacyPage.tsx`
- `src/components/legal/content/RefundPolicyPage.tsx`
- `src/components/legal/content/TermsPage.tsx`
- `src/legal/aiNotices.test.tsx`
- `src/legal/aiNotices.ts`
- `src/legal/disclosures.test.tsx`
- `src/legal/legalConfig.ts`
- `src/legal/legalPages.test.tsx`
- `src/legal/policyAcceptance.test.ts`
- `src/legal/policyAcceptance.ts`
- `src/legal/routes.ts`
- `src/test/rls.legalAcceptances.test.ts`
- `supabase/manual/rollback_legal_acceptances.sql`
- `supabase/migrations/20261111000000_legal_acceptances.sql`

## 3. Files modified
- `src/App.tsx`
- `src/components/auth/AuthScreens.tsx`
- `src/components/auth/auth.test.tsx`
- `src/components/billing/BillingPanel.tsx`
- `src/components/billing/BillingParts.tsx`
- `src/components/bodyscan/BodyScanFlow.tsx`
- `src/components/dashboard/AiRecoveryInsightsPanel.tsx`
- `src/components/home/LandingPageView.tsx`
- `src/components/nutrition/NutritionView.tsx`
- `src/components/plans/AiRoutineBuilderModal.tsx`
- `src/components/posture/ExercisePostureModal.tsx`
- `src/components/progression/ProgressionView.tsx`
- `src/components/settings/AccountSecurity.tsx`
- `src/components/settings/DataPanel.tsx`
- `src/components/settings/SettingsView.tsx`
- `src/components/trainer/AiTrainerView.tsx`
- `src/components/trainer/DreamPhysiqueModal.tsx`
- `src/components/trainer/DynamicWarmupModal.tsx`
- `src/components/trainer/FloatingTrainerWidget.tsx`
- `src/components/workoutMirror/WorkoutMirrorContainer.tsx`
- `src/context/AuthContext.tsx`
- `src/main.tsx`
- `vercel.json`

## 4. Routing
- `src/main.tsx` checks `window.location.pathname` once (`resolveLegalRoute`, exact match, trailing slash and case tolerated). A legal path mounts `LegalRoot` **instead of** `<App />`: no AuthProvider, Supabase client, storage scoping, billing gate or sync runs. Everything else (including `/`, hash routes `#signin`/`#signup`, auth callbacks, `/api/*`) mounts `<App />` unchanged.
- `vercel.json`: the `/api` rewrite is untouched and still first; five exact-path rewrites to `/index.html` were added (no wildcards).
- No routing library. Links between legal pages are plain links (a full page load equals a refresh, so refresh cannot break). In-app links open in a new tab so checkout or forms are not lost.

## 5. Legal pages
`/privacy`, `/terms`, `/refund-policy`, `/cancellation-policy`, `/contact` via a reusable `LegalPage` (skip link, header/footer nav with `aria-current`, contents list, semantic sections, scrollable tables, safe-area padding, existing design tokens and dark/light themes). Each shows a visible DRAFT banner; owner-to-complete fields are highlighted placeholders; reviewer notes are visible only while `LEGAL.isDraft`. Privacy follows the ten accuracy rules in the brief; Refund has no blanket no-refund rule, no timeline and no automatic ₹5 refund claim; Cancellation promises no untested outcome; Contact uses only `support@ironlog.app`.

## 6. Sign-up acceptance
Required checkbox, unchecked by default, approved wording, both documents are links (new tab). Blocked in the form and again in `AuthContext.signUp` (needs `acceptedLegal === true`). The current `termsVersion`/`privacyVersion` plus a browser timestamp ride in the sign-up metadata; a database trigger records them with the **database clock** in `public.legal_acceptances` (unique per user and version pair, so no duplicates). No new personal data. Existing authentication behaviour is otherwise unchanged.

## 7. Existing-user notification
`PolicyUpdateNotice` (non-blocking banner in the signed-in app). It appears only when the user's own rows contain no record for the **current** versions (all pre-existing accounts, and everyone after a version bump). Displaying it records nothing. "I've read the updates" calls `acknowledge_legal_update()` (server clock, no duplicates). "Remind me later" hides it for the browser session only (`sessionStorage`, per user and version). If the check fails (offline, table not migrated) nothing is shown and nothing is blocked. No authentication reset.

## 8. AI and fitness notices
One concise, distinct notice per feature (registry `src/legal/aiNotices.ts`): AI Trainer (full view and quick widget), Workout Mirror, form guidance, warm-up, routine builder, nutrition/food analysis, recovery insights, overload suggestions, physique analysis, Body Scan. None says Gemini watches video; Mirror/Body Scan are described as on-device; preset physique images are described as preset, not AI-generated.

## 9. Landing, billing, settings, deletion
- Landing: PRIVACY nav now opens `/privacy`; footer links all five pages; "Free" wording removed from CTAs; new "what you can use / what needs a plan" section with ₹299/month and ₹1,499/year; the "tied to your private account" sentence replaced with an accurate local-vs-cloud statement; "ad trackers" claim removed.
- Billing: Terms, Refund and Cancellation links before checkout (next to the unchanged agree checkbox) and a help/refund link row on the Billing screen. No change to prices, trial, Razorpay logic or the existing disclosure lines.
- Settings: "Policies & support" card under Privacy & data, plus a footer link row.
- Account deletion: **wording only** (retained billing records, email hash, third-party copies, backups, other devices, Razorpay dependence). Deletion behaviour and database deletion logic are unchanged.

## 10. Database migration (NOT applied)
`supabase/migrations/20261111000000_legal_acceptances.sql` creates `legal_acceptances` (RLS: select-own only; no client writes), a sign-up trigger that cannot block account creation, and `acknowledge_legal_update(text,text)`. Existing accounts are deliberately not back-filled. Apply to staging first; Production only with explicit approval. Rollback: `supabase/manual/rollback_legal_acceptances.sql` (drops objects, **loses recorded acceptances**; sign-up keeps working; app hides the notice). No service-role credentials are used or exposed. The schema was inspected from the repo's migrations; the live Supabase project was **not** touched.

## 11. Tests executed (targeted, NOT the full suite, per instruction)
Command scope: `src/legal`, `src/components/{legal,auth,settings,billing,home,trainer,posture,workoutMirror,bodyscan,progression,nutrition,dashboard,plans}`, `src/test/{rls.legalAcceptances,rls.profiles,rls.deleteAccount,billingClientGuards,noXssSinks,brand}.test.ts`, `src/server/billing/routes.test.ts`, `src/server/billing/entitlement.test.ts` (both call `GET /api/health` and expect 200).
**Result: 54 files passed, 687 tests passed, 0 failed.** New tests: legalPages (41), aiNotices (25), disclosures, policyAcceptance (4), PolicyUpdateNotice (10), rls.legalAcceptances (16, runs the real migration in PGlite); `auth.test.tsx` updated (26 pass).
The full suite was **not** run.

## 12. Lint / type-check
`npx tsc --noEmit` (the repo's `lint` script): exit 0, no errors.

## 13. Build
`npm run build` (runs `bundle-api` then `vite build`): succeeded. `npm run check:api`: api bundle OK and unchanged. Only the existing chunk-size warning appeared.

## 14. Known limitations
- **No real browser was used.** Layout, mobile appearance, keyboard focus and screen-reader behaviour are **not browser-tested**; they are covered only by DOM-level tests and by code structure.
- Direct navigation was checked only over HTTP against `vite preview` (all five routes, a trailing-slash path and an unknown path return the app shell). **Vercel's rewrites were not exercised**; test on a Preview deployment, including refresh and trailing-slash URLs (`/privacy/` has no explicit Vercel rewrite).
- The migration ran only in PGlite, not on Supabase. Supabase Auth, PostgREST and the live trigger were not tested.
- The public Supabase sign-up endpoint can be called without the checkbox; such users get no record and later see the notice.
- Existing users see the notice only after the migration is applied.
- The in-app text still says the ₹5 debit is "refunded automatically" (unverified). Not changed (needs approval).
- Policy prices are hard-coded; tests pin them to the code defaults, not to production env values.

## 15. Unresolved owner decisions
See `STAGE_2B_OWNER_LEGAL_CHECKLIST.md`: operator name/address, effective date and version labels, minimum age, Gemini tier, retention periods, grievance contact, governing law, brand spelling, free/paid split, tax treatment.

## 16. Legal-review blockers
All items marked "Blocks release" in the checklist; the pages must not be published as final until counsel has reviewed them. The age policy (`AGE_ELIGIBILITY_RESEARCH.md`) is the largest open legal question.

## 17. Changes that need your approval
1. `vercel.json`: five rewrites (approved in principle; confirm on Preview).
2. Applying the migration to any Supabase project.
3. Changing the in-app ₹5 "refunded automatically" wording (`billingPresentation.ts`, `BillingOnboarding.tsx`) once verified.
4. Optional tax line in the billing disclosure after the CA confirms.
5. Switching `LEGAL.isDraft` to `false` and setting final versions and effective date.
6. Committing, pushing, merging, deploying.

## 18. Confirmation
Nothing was committed, pushed, merged or deployed. No production environment variable, Razorpay setting, billing enforcement, subscription price, trial setting, Redis config or referral code was changed. No migration was applied and no Supabase record was read or modified. No destructive Git operation was run. Work is on a local branch; `npm ci` and `vite preview` ran locally only.
