# Legal acceptance enforcement: design, release sequence and manual steps

Status: **written and tested locally only. Nothing is applied to Supabase. Enforcement is NOT ACTIVE in production.**
Covers Stage 2D, Stage 1 (Stage 2C findings F1, F2, F3).

## 1. What is enforced

| Rule | Where |
| --- | --- |
| No `auth.users` row without valid acceptance metadata | Layer A: strict trigger (`handle_new_user_legal_acceptance`), raises on violation, no exception handler |
| Clean 400 before the user is created | Layer B: Before User Created hook (`hook_before_user_created`), same check |
| Versions must be the CURRENT published ones | `public.legal_policy_versions` (server-controlled; no client access) |
| Timestamp from the database clock | `legal_acceptances.accepted_at default now()`; the browser no longer sends `accepted_at_client` |
| Same allowlist for existing users | `acknowledge_legal_update()` now rejects unknown versions |
| User isolation, unique `(user_id, terms_version, privacy_version)`, own-row SELECT only, no client writes | Unchanged from `20261112060134` |

Both layers call one function, `public.legal_signup_violation(jsonb)`, so they cannot disagree.

Layer A is the guarantee. Layer B only improves the error. A Before User Created hook is a dashboard setting and can be off or mistyped; a trigger is part of the database.

## 2. Supabase hook contract (checked against the official docs, search at time of writing)

- Hook "Before User Created", available on Free and Pro. Implementable as a Postgres function.
- Input: `{ "metadata": {uuid, time, name, ip_address}, "user": {id, aud, role, email, phone, app_metadata, user_metadata, identities, created_at, updated_at, is_anonymous} }`. The user is not yet in the database.
- Output: `{}` (or HTTP 200/204 with no error) allows. `{"error": {"http_code": 4xx, "message": "..."}}` rejects and the message reaches the client. Without `http_code` the response is a 500.
- Postgres hooks run in a transaction with a short time limit; errors are not retried.
- Grants the docs call for: `grant execute ... to supabase_auth_admin`, `grant usage on schema public to supabase_auth_admin`, `revoke execute ... from authenticated, anon, public`. The docs recommend NOT using `security definer` on the hook itself; `hook_before_user_created` follows that. Only the read-only helper `legal_signup_violation` is `security definer` (so it can read the locked-down allowlist), with `search_path = ''` and no API-role execute.

### Not stated by the docs, therefore NOT VERIFIED

- Which sign-up paths call the hook. The docs show email sign-up and OAuth providers; they do not state whether invites, admin `createUser`, anonymous sign-in or magic-link first sign-in call it. This is why Layer A exists: a trigger fires on every insert into `auth.users`, whatever the path.
- How hosted Auth words the error to the client when the TRIGGER (not the hook) raises. Expect a generic "Database error saving new user"; the browser form already prevents that case for honest users.
- That `supabase_auth_admin` can execute the helper on the hosted project exactly as in the local simulation.

All three are checked in section 5 on a Supabase preview branch before anything reaches production.

## 3. Compatibility

- The app uses only email + password sign-up (no OAuth, anonymous, magic-link or admin calls were found in `src` or the API). The browser already sends `legal_acceptance` with the current versions, so honest sign-ups keep working.
- **Stricter than before, on purpose:** any `auth.users` insert without valid metadata now fails. That includes users created by hand in the Supabase dashboard, invites and `auth.admin.createUser` (QA/test accounts need `user_metadata.legal_acceptance = {"terms_version": "...", "privacy_version": "..."}` with the current versions).
- Existing accounts are untouched and not back-filled; the existing-user notice keeps working.
- If a future OAuth provider is added, its first sign-in would be rejected by the trigger. That needs a deliberate design then (for example an acceptance screen before the OAuth redirect). Not built, not needed now.
- Fails closed: an empty or missing allowlist rejects every sign-up.
- Stage 2 (18+ declaration) will extend `legal_signup_violation` / the trigger in a further additive migration. Do not release 20261111 + 20261112 alone to production if the 18+ migration is meant to ship in the same launch; release the whole sequence together.

## 4. Release sequence (no window where sign-up is unchecked)

`20261112060134_legal_acceptances.sql` on its own still has the swallowing trigger. If the two files were pushed one after the other, there would be a short interval in which sign-up is still bypassable. Close it by applying them in ONE transaction:

1. Apply to a Supabase **preview branch first**, then production only with the owner's explicit approval.
2. In the SQL editor (or `psql`), run:
   ```sql
   begin;
   -- paste 20261112060134_legal_acceptances.sql
   -- paste 20261113043228_legal_acceptance_enforcement.sql
   commit;
   ```
   (The local test `release sequence` proves this shape leaves no unchecked window.) **Historical note:** these two migrations are already applied to the hosted project (history rows `20261112060134` and `20261113043228`) and are recorded under exactly those versions in `supabase/migrations/`. There is nothing to mark as applied: do NOT run any `migration repair`. See `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md` before any future migration push.
3. Dashboard > Authentication > Hooks > Before User Created > Postgres function > `public.hook_before_user_created`. Save.
4. Deploy the web app (it only stops sending `accepted_at_client`; it is compatible before and after step 2).

Local CLI equivalent for step 3 (a `supabase/config.toml` does not exist in this repo, so none was added):
```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/hook_before_user_created"
```

Do not enable the hook before step 2: the function would not exist and every sign-up would fail.

## 5. Verification to run on the preview branch (all must pass before production)

Replace `<ref>` and `<anon>` with the preview project values. Never use the service-role key for these.

1. Direct sign-up with no metadata must be rejected and create nothing:
   `curl -s -X POST https://<ref>.supabase.co/auth/v1/signup -H "apikey: <anon>" -H "Content-Type: application/json" -d '{"email":"t1@example.com","password":"<strong>"}'`
   Expect a 4xx; then `select count(*) from auth.users where email='t1@example.com'` = 0.
2. Fabricated version: same call with `"data":{"legal_acceptance":{"terms_version":"x","privacy_version":"x"}}` must be rejected.
3. Valid current versions must succeed and create exactly one `legal_acceptances` row with `method = 'signup'` and a database timestamp.
4. Turn the hook OFF in the dashboard and repeat 1 and 2: they must still be rejected (proves Layer A alone).
5. Turn the hook back ON and repeat 1: the response should carry the readable message (proves Layer B).
6. Try each other path you intend to keep available (dashboard "Add user", invite, `auth.admin.createUser`) and record which are rejected and whether the hook was called (Auth logs). Record the result in the owner checklist.
7. Existing-user notice still works for a pre-existing account.

Until 1 to 5 pass on a preview branch, treat enforcement as NOT VERIFIED.

## 6. Publishing a new Terms / Privacy version later

In one reviewed migration and in the same release as `src/legal/legalConfig.ts`:
```sql
begin;
update public.legal_policy_versions set is_current = false where policy = 'terms';
insert into public.legal_policy_versions (policy, version, is_current) values ('terms', '<new>', true);
commit;
```
A browser still running the old bundle is then rejected with "The Terms of Service or Privacy Policy changed. Please refresh the page and try again." Forgetting the migration rejects every sign-up; the drift test (`src/test/rls.legalEnforcement.test.ts`) fails if `legalConfig.ts` and the seed disagree.

## 7. Rollback

`supabase/manual/rollback_legal_enforcement.sql`. **Disable the hook in the dashboard first**, otherwise dropping its function breaks all sign-ups. Rollback re-opens the bypass (F1/F2). Recorded acceptances are kept.

## 8. Limits

- The record proves that a sign-up request carried the current version labels. It is not proof that a person read the documents, and these pages are still drafts pending owner information and Indian legal review.
- Retention of acceptance evidence after account deletion (the table cascades on delete) remains a legal-review item.
