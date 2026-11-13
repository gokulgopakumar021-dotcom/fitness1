# Iron Log AI: 18+ eligibility design (Stage 2D, Stage 2)

**Status: implemented in the repository. `supabase/migrations/20261113043241_age_eligibility.sql` is recorded as applied on the hosted project (per `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md`; not re-read in Stage 10). Hosted objects and the age trigger: present and enabled (read-only query, 2026-11-13); real signup rejection not exercised. Before User Created hook: UNKNOWN. Production `AGE_ENFORCEMENT`: not set per the owner (2026-11-13), so the API age gate is effectively `off`. Not legal advice.**
Owner decision: the entire platform, including Body Scan, is 18+. This was not reverted to 14+.

## What it is, and what it is not
A **self-declaration**: the user confirms they are 18 or older. It is **not** verified identity and **not** verified age. No date of birth
and no age number is collected or stored; a typed date of birth would be just as unverified and would add personal data.

## How it works
| Layer | Mechanism |
|---|---|
| Signup UI | Second checkbox, unchecked by default. `AuthContext.signUp` refuses to call Supabase without it. |
| Signup, database (primary) | Strict `AFTER INSERT` trigger on `auth.users` raises unless `age_declaration.adult_18_plus` is JSON `true`. No dashboard step needed. |
| Signup, database (clean error) | `hook_before_user_created` checks legal acceptance, then the age declaration. **Not active until selected in the dashboard.** |
| Record | `age_declarations`: user id, `true`, current Terms version (chosen by the server), method, database-clock timestamp. Own-row SELECT only; no client writes. Deleted with the account. |
| Existing accounts | No back-fill. Blocking confirmation screen; the person declares via `declare_adult_18_plus()` (takes no argument). "I am under 18" offers sign-out and account deletion. |
| API | `ageGate` after auth and rate limits, before body parsing. Reads `get_my_age_eligibility()` with the user's own token (no service-role key). 403 when unknown; 503 when it cannot tell (fail closed). Exempt: health, deletion-check, prepare-deletion, subscription cancel. |
| Body Scan | Runs on the device and has no server endpoint. The client fails closed unless the database holds the declaration; the AI endpoints it can feed are refused by the API gate. |

Nothing the browser holds (localStorage, sessionStorage, profile age, headers, request body) is used to decide eligibility.

## Known limits
- Self-declared age can be false.
- Local-only features (workout logging stored on the device) have no server to enforce them. If the lookup is unavailable (offline, or the database change not live), the client lets the offline-first app run; the API still fails closed and Body Scan stays shut.
- Locally verified only with an in-process Postgres. Hosted Auth hook behaviour is **NOT VERIFIED**.

## Stronger options (PROPOSED ONLY; need owner and legal approval; none implemented)
Payment-instrument-based adult check; third-party age-assurance or ID verification; parental-consent flows (only relevant if under-18 is ever allowed).

## Questions for an Indian lawyer
1. Is self-declaration sufficient for an 18+ service under the DPDP Act, 2023 and the Rules?
2. Wording of the Terms and Privacy sections, and what to do when someone reveals they are under 18.
3. Should the confirmation record be retained after account deletion (currently it is deleted with the account)?
4. Is blocking existing accounts until they confirm acceptable, or is notice sufficient?

## Production checklist (manual; steps 2 to 5 are not shown to have been done)
1. Migrations `20261112060134`, `20261113043228`, `20261113043241` are already recorded on the hosted project; do not re-apply or repair them. (For a new project, apply them together, in order, on a preview branch first.)
2. Authentication > Hooks: select `public.hook_before_user_created` for Before User Created (optional second layer; the trigger already enforces).
3. Set `AGE_ENFORCEMENT=shadow` on Vercel, watch logs for `age_shadow_would_deny`, then set `AGE_ENFORCEMENT=on`. Default is `off` so deploying before the migration cannot lock users out.
4. Test on the preview branch: direct signup without the declaration is rejected; an existing account sees the screen; an unconfirmed token gets 403 from an AI route.
5. Counsel review before `LEGAL.isDraft` is turned off.
Rollback: `supabase/manual/rollback_age_eligibility.sql` (set `AGE_ENFORCEMENT=off` first).
