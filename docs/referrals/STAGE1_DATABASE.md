# Referral system, Stage 1: database and security foundation

Migration: `supabase/migrations/20261112060254_referral_core.sql`. Status: the file is in the repository and is **recorded as applied on the hosted project** as `20261112060254` (per `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md`; not re-read in Stage 10). The objects it creates on the hosted project are NOT VERIFIED here. The referral programme is **deferred from the initial launch** and `referral_sync_commission` is not attached to billing, so no commission accrues. Tests: `src/test/rls.referrals.test.ts`.
Base: `main` @ `ceac8b8`. Additive only; no existing table, function, trigger or server file is changed.

## Tables
`app_admins`, `referral_partners`, `referral_attributions`, `referral_ledger_entries` (append-only), `referral_payouts` (append-only),
`referral_admin_audit` (append-only), `referral_visit_counters`. Money is `numeric(14,2)` rupees with a `currency = 'INR'` column.

## Policy encoded
20% lifetime (`commission_rate_bps` 2000, snapshotted per accrual); charges with `kind='charge'` and status captured/refunded only;
no trial/authorization/failed commission; refunds via the cumulative-target method; lost chargebacks reverse the remaining net;
manual payouts bounded by the payable balance (14-day default hold, flagged/void attributions held out).

## Deliberate Stage 1 choices
- `referral_sync_commission(payment_id)` exists and is tested but is **not attached** to `billing_payments`. Wiring it (trigger or server call) is a later stage so billing behaviour is unchanged here.
- Dispute hold-while-open (decision D2) and a `referral_disputes` mirror table are not included; only the lost-chargeback reversal is.
- Admin functions re-check the acting user against `app_admins`; service_role has no direct write on any referral table.
- Hold period (D1) is a function parameter defaulting to 14 days; attribution cut-off (D4) is "no billing row or payment yet".

## Applying (new project) and admin seed
This migration is already recorded on the hosted project; do not apply it there again, and read `docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md` (sections 4 to 6) before any push, because some migration-CLI commands are prohibited here. For a **new** project, apply it in filename order (after `20261112060134_legal_acceptances.sql`), on a branch/staging project first. Seed an admin manually:
`insert into public.app_admins (user_id) values ('<auth.users id>');`. (The local-vs-live migration version drift noted in Stage 0 was reconciled in Stage 9.) Rollback block is at the end of the migration.

## Proposed follow-up (not applied)
`supabase/proposed/20261114000000_referral_trigger_search_path.sql` pins `search_path = ''` on the three guard trigger functions. It is PROPOSED only, outside `supabase/migrations/`, and needs a separate owner approval. Rollback: `supabase/manual/rollback_referral_trigger_search_path.sql`.
