# BT-04C (continued) — Iron Log AI: after task 8

Repo: gokulgopakumar021-dotcom/fitness1 (GitHub and Supabase connected). Strategy: PWA first. Native apps later.

## Attach with this prompt
Required: `bt-04b-plus-04c-task1-8-combined.patch` (applies on `origin/feature/bt-04-pwa-wearable-foundation`), `IRON_LOG_AI_BT_04_COMBINED_REPORT.md`, `PROJECT_PROGRESS.md` (the owner must provide it; it was not available in the last session).
Not needed: earlier patches and continuation prompts.

## State
Nothing is committed, pushed, merged or deployed. BT-04 is NOT merged to main. Working branch `feature/bt-04b-pwa-wearables`.
Step 1: clone, check `git status`/branch/HEAD and whether the patch is applied; if not, create the branch from the base, `git apply --check`, apply. No destructive git. If it fails, stop. Node 24 via `npm install node@24` in a scratch dir, then `npm ci`.

## Done (tasks 1–6 tested at targeted level; 7 prepared; 8 reports done)
1 zones · 2 ingest session verification (proposed SQL) · 3 workout HR in history · 4 consent history · 5 historical HR for Coach Iron · 6 persisted outbox (`src/wearables/outboxStore.ts`) · 7 `scripts/staging/verifyWearableMigration.mjs` + `docs/reports/IRON_LOG_AI_BT_04C_STAGING_VERIFICATION.md` (never run) · 8 reports updated (`IRON_LOG_AI_BT_04C_IMPLEMENTATION_REPORT.md` is current).
Last targeted run: 28 files, 577 tests passed; lint clean; `check:api` OK.

## Supabase facts
One project, `nerfdflkrtikkbttofwk` = PRODUCTION, no branches. Branch cost $0.01344/hour (org `wkqcdnpzydqhnjwwswoz`). Proposed migration `20261117000000_wearable_consent_ingest_hardening.sql` is UNAPPLIED. Applied `20261115131442` is never edited.

## Owner decisions pending (do not assume answers)
Staging target + cost confirmation + test accounts + branch deletion; apply to production after staging; Gemini terms; audit-row retention; other `|| 26` fallbacks; own-HR read needs no consent; outbox expiry/clear behaviour.

## Remaining work
A. Task 7 live run once the owner confirms a target. Create the branch, compare its migration list to production, apply the proposed SQL to the BRANCH only, run the script (29 steps), report PASS/FAIL, delete the branch if approved. Ask before every live request.
B. Update `PROJECT_PROGRESS.md` from the real file once provided.
C. Real-browser QA, accessibility, dated hardware test records (none exist).

## Do NOT
Re-test or modify the signup fix; commit/push/merge/deploy; apply migrations to production; change Supabase config or env vars; touch real user data, Razorpay, subscriptions, legal text or `LEGAL.isDraft`; mark any device Verified; add native code, HealthKit, Health Connect, fake OAuth, scraping or reverse-engineered APIs; re-enable unconsented wearable data; read the query string in backend code; run the full suite (targeted files only).

## Environment notes
`api/index.js` is a committed bundle: after server changes run `npm run build:api` then `npm run check:api`. Guard tests: `src/server/app.sideEffects.test.ts`, `src/server/security/clientRouteContract.test.ts`, `src/server/serverless/normalizeUrl.test.ts`, `src/test/migrationReconstruction.test.ts`, `src/storage/localStorageScopeGuard.test.ts`, `src/components/workouts/workout-design-compliance.test.ts`. No testing-library in the repo: use `createRoot` + `act`. Type errors surface in `npm run lint`.

## Working style
Terse. Patch at the end of each task (incremental + combined), verified with `git apply --check` in a fresh clone; wait for approval before the next. Report Implemented / Tested / Not tested / Deferred / Needs approval separately. Never claim a feature works if untested. Never draft a file without its real source in-session.
