# Supabase migration history reconciliation

Status: reconciled in the repository (Stage 9, 2026-11-13). Nothing was applied, repaired or reverted on the hosted project.

## 1. Why the versions differed

The hosted project's migrations were applied through the Supabase connector, which stamps each migration with its apply time. The repo files had been
hand-numbered (`20261027000000`, `20261110000000`, ...). Result: 13 of 15 local versions did not exist remotely, one remote migration
(`20261102082840_revoke_rls_auto_enable_execute`) had no local file, and `legal_acceptances` ran remotely before `referral_core` while the local
names said the reverse. SQL content was equivalent for every migration except one form-only difference (section 3).

## 2. What was done (Option A + C)

- The 13 local files were renamed to the exact remote versions (table below). SQL was not changed; only comment text that cited old filenames was updated.
- The remote-only migration was added under its exact remote version with the exact remote SQL.
- `src/test/migrationHistory.guard.test.ts` fails on drift; `src/test/migrationReconstruction.test.ts` replays the whole directory into an empty Postgres (PGlite).
- The stale `migration repair` instruction in `docs/legal/LEGAL_ACCEPTANCE_ENFORCEMENT.md` was removed.

| Old local file | Actual remote version | New local file | SQL vs remote (comments stripped, whitespace collapsed) |
|---|---|---|---|
| `20261027000000_auth_profiles.sql` | `20261027051824` | `20261027051824_auth_profiles.sql` | identical* |
| `20261027010000_exercise_videos_catalog.sql` | `20261027063157` | `20261027063157_exercise_videos_catalog.sql` | identical* |
| `20261027010100_exercise_videos_storage.sql` | `20261027064620` | `20261027064620_exercise_videos_storage.sql` | identical* |
| `20261028000000_exercise_videos_published.sql` | `20261028053743` | `20261028053743_exercise_videos_published.sql` | identical* |
| `20261030000000_delete_own_account.sql` | `20261030053401` | `20261030053401_delete_own_account.sql` | identical* |
| `20261031000000_ai_usage_quota.sql` | `20261102045148` | `20261102045148_ai_usage_quota.sql` | identical* |
| `20261103000000_ai_quota_bucket_allowlist.sql` | `20261103061647` | `20261103061647_ai_quota_bucket_allowlist.sql` | identical* |
| `20261106000000_billing_core.sql` | `20261106052859` | `20261106052859_billing_core.sql` | identical* |
| `20261106100000_billing_deletion_refund.sql` | `20261106071858` | `20261106071858_billing_deletion_refund.sql` | identical* |
| `20261110000000_referral_core.sql` | `20261112060254` | `20261112060254_referral_core.sql` | identical* |
| `20261111000000_legal_acceptances.sql` | `20261112060134` | `20261112060134_legal_acceptances.sql` | identical* |
| `20261112000000_legal_acceptance_enforcement.sql` | `20261113043228` | `20261113043228_legal_acceptance_enforcement.sql` | identical* |
| `20261112100000_age_eligibility.sql` | `20261113043241` | `20261113043241_age_eligibility.sql` | identical* |
| `20261105071106_workout_cloud_sync.sql` | `20261105071106` | unchanged | differs in form, same end state (section 3) |
| `20261105072929_workout_sync_no_client_delete.sql` | `20261105072929` | unchanged | identical* |
| (none) | `20261102082840` | `20261102082840_revoke_rls_auto_enable_execute.sql` | identical* (new file) |

\* "identical" means the normalized statement hash matched the remote stored statement. Formatting equivalence is not proof of semantic equivalence by itself;
the end-state check in section 3 compared the resulting catalog objects for the one migration that did not hash-match.

Dated reports written before this change (`IRONLOG_AI_SECURITY_REMEDIATION_REPORT.md`, `docs/internal-security/*`, the two Vercel audits, the cross-device sync
report, the Stage 2B implementation report) still cite the old versions on purpose: they describe the repo as it was. The guard test lists them explicitly.

## 3. `workout_cloud_sync` (same version, different SQL text)

The local file and the remote stored statement differ in form only:

| Area | Local file | Remote statement |
|---|---|---|
| Length check | `char_length(id) >= 1 and char_length(id) <= 128` | `char_length(id) between 1 and 128` (Postgres stores both as the same `>=`/`<=` expression) |
| Table revokes | `revoke all on <table> from anon, authenticated` | `... from public, anon, authenticated` (tables carry no default PUBLIC privilege, so this is a no-op) |
| Guard function revoke | `revoke all on function ... from public, anon, authenticated` | `revoke execute on function ...` (functions only have EXECUTE) |
| Function DDL | `$function$` quoting, `set search_path to ''`, implicit invoker; pull defined before push | `$$` quoting, explicit `security invoker`, `set search_path = ''`; push defined before pull |
| Statement order | RLS operations grouped | interleaved per table |

All other statements, including every function body, matched by hash. The file was NOT rewritten to look identical. Behavioural check: the same catalog
fingerprint query (constraints, policies, anon/authenticated/PUBLIC table grants, function signature, security mode, volatility, language, search_path,
body hash, function EXECUTE grants, triggers, indexes, columns, RLS flags for the four workout tables and three functions) was run read-only on the hosted
project and on a fresh PGlite build of the repo migrations; all nine fingerprints were identical. Not compared: object owners, grantors, table/column comments,
roles other than anon/authenticated/PUBLIC, and any catalog area outside the workout objects.

## 4. Why `migration repair` is not used

Do not use it: `supabase migration repair` rewrites remote history rows. It would need about 26 manual commands, can lose the stored statement text of reverted rows, and
changes the hosted project to fit the repo when the repo can simply be corrected. The remote history is the record of what actually ran, so the repo was aligned to it.

## 5. Why `db push --include-all` is prohibited

Prohibited: `--include-all` pushes every local migration missing from the remote history. Before reconciliation that meant replaying already-applied migrations
(for example `legal_acceptances`, which redefines a trigger function later replaced by the strict one). Do NOT run it for this repository unless the checks in
section 6 pass and the owner approves. The stale command `supabase migration repair --status applied 20261111000000 20261112000000` (old versions that never existed remotely) must never be run.

## 6. Before ANY future migration push

1. Inspect remote history (read-only): `supabase migration list` (needs the project linked; this repo has no `supabase/config.toml`) or
   `select version, name from supabase_migrations.schema_migrations order by version;`.
2. Confirm every remote row has a local file with the same version and name, and the reverse. `src/test/migrationHistory.guard.test.ts` encodes the known 16 rows.
3. Confirm nothing already applied would be replayed: the push dry run (`supabase db push --dry-run`) must list only the new migration.
4. Apply new migrations to a preview branch or staging project first; then production only with owner approval.
5. After applying, add the exact applied version and name to `REMOTE_HISTORY` in the guard test in the same commit.
6. Never use `--include-all`, `migration repair` or `migration revert` as a shortcut.

## 7. If a mismatch is found

Stop. Do not push, repair or revert. Record local versions, remote versions, and a normalized-SQL comparison per migration; classify each as
(a) name-only, (b) SQL difference, (c) local-only, (d) remote-only. Fix the repo to match the remote history when the SQL is equivalent
(file rename or add); escalate any real SQL difference to the owner before touching the database.

## 8. Status vocabulary used across the docs

These nine states are separate. One being true does not prove another. "Evidence in Stage 10" says what the Stage 10 audit (repository only, 10A/10B) actually checked.

| # | State | Evidence in Stage 10 |
|---|---|---|
| 1 | Migration file exists locally in `supabase/migrations/` | Verified (16 files). |
| 2 | Migration is recorded as applied remotely (a row in the hosted migration history) | Taken from section 2 above (read during Stage 9). NOT re-read in Stage 10. |
| 3 | Database objects created by the migration exist on the hosted project | NOT VERIFIED. Only the workout-sync objects were compared (section 3). |
| 4 | Signup trigger is installed and active on `auth.users` | NOT VERIFIED on the hosted project. Locally replayed in PGlite only. |
| 5 | Supabase "Before User Created" hook is configured and enabled | UNKNOWN. A dashboard setting; not readable from the repository. |
| 6 | Age-enforcement API gate is on in production (`AGE_ENFORCEMENT=on`) | UNKNOWN. Code default is `off`. |
| 7 | Billing-enforcement gate is on in production (`BILLING_ENFORCEMENT`) | UNKNOWN. Code default is `off`. |
| 8 | Legal release gate has been cleared (`LEGAL.isDraft = false` and the gate test passes) | NO. `LEGAL.isDraft` is `true` in `src/legal/legalConfig.ts`. |
| 9 | Legal documents are finalized and approved by counsel | NO. Drafts; Indian legal review outstanding. |

Words are not interchangeable: "applied" means state 2 only; "enabled" means a runtime setting (5 to 7); "approved" means state 9 only.
