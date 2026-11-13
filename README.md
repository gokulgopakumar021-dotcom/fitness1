<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9e70170b-d25f-42c0-b10e-2f9d8cddd35b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Accounts (Supabase Auth)

Iron Log AI requires sign-in. Authentication uses Supabase Auth (email + password, email verification, password reset).

### 1. Configure the app
1. `cp .env.example .env.local`
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase dashboard → Project Settings → API Keys → *publishable* key; the legacy `anon` key also works, and `VITE_SUPABASE_ANON_KEY` is accepted as an alias).
3. Never use the secret / `service_role` key or the database password in the frontend. The app refuses to start with a service-role key.
4. Restart `npm run dev`. If configuration is missing, the app shows a setup screen instead of the sign-in form.

### 2. Database migrations
**Fresh Supabase project (empty database) only:** run the files in `supabase/migrations/` in filename order (Supabase dashboard → SQL Editor, or a reviewed CLI push to the new project). The first, `20261027051824_auth_profiles.sql`, creates `public.profiles`, Row Level Security policies and the trigger that creates a profile for each new user. The later files add the other tables and signup enforcement; the legal-acceptance, referral and age-eligibility files have release-sequence notes in their own docs (`docs/legal/LEGAL_ACCEPTANCE_ENFORCEMENT.md`, `docs/referrals/STAGE1_DATABASE.md`), so read them first.

**Existing project that already has migration history (the hosted Iron Log AI project is recorded as one, per `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md`):** do NOT re-run `20261027051824_auth_profiles.sql` or any other file already recorded. Several migration-CLI commands are prohibited for this repository; read `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md` (sections 4 to 6) before any push, and apply only new migrations, to a preview branch first.

### 3. Supabase dashboard → Authentication → URL Configuration
- **Site URL:** your deployed URL (e.g. `https://your-app.example.com`).
- **Redirect URLs:** add the deployed URL with a trailing slash (`https://your-app.example.com/`) and, for local development, `http://localhost:3000/`.
- Set `VITE_SITE_URL` to the deployed origin in production so emailed links never point at localhost.
- Authentication → Providers → Email: keep **Confirm email** enabled. Optionally raise the minimum password length to match the app (8).
- Verification and reset links use the PKCE flow: open them in the same browser that requested them.

### Where data lives
Fitness data is still stored in this browser (localStorage / IndexedDB), now **namespaced per account** (`<key>::u:<user id>`). Data saved before accounts existed stays under the old key names; it is not deleted, not migrated and not visible to signed-in accounts. Cloud sync of fitness data is not implemented yet.

### Tests
`npm test` runs everything, including the auth tests and an in-process Postgres (PGlite) check of the RLS policies.
