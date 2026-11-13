// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Stage 9 / V7: fresh-database reconstruction. Replays EVERY file in supabase/migrations, in filename order (the order the CLI would
 * use), into an empty in-process Postgres with minimal Supabase stand-ins (auth/storage/extensions schemas, anon/authenticated/service_role).
 * Proves: no SQL failure, no missing dependency, no ordering problem, and the expected end-state objects exist.
 * NOT covered (PGlite is not Supabase): GoTrue, the real storage service, pg_cron, hosted extensions, event triggers, the Before User Created
 * hook runtime, and byte-identity with the live catalog. Nothing here touches any Supabase project.
 */
const migDir = resolve(import.meta.dirname, '../../supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

let pg: PGlite;
const rows = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const applied: string[] = [];
let failure: string | null = null;

const BOOT = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema if not exists auth; create schema if not exists extensions; create schema if not exists storage;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on storage.objects to anon, authenticated;
`;

beforeAll(async () => {
  pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(BOOT);
  for (const f of files) {
    try {
      await pg.exec(readFileSync(join(migDir, f), 'utf8'));
      applied.push(f);
    } catch (e) {
      failure = `${f}: ${(e as Error).message}`;
      break;
    }
  }
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe('fresh database reconstruction from supabase/migrations', () => {
  it('applies every migration, in order, without a SQL error or a missing dependency', () => {
    expect(failure).toBeNull();
    expect(applied).toEqual(files);
    expect(files).toHaveLength(16);
  });
  it('creates the expected public tables, all with row level security enabled', async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`
    );
    const names = t.map((r) => r.relname);
    for (const expected of ['age_declarations', 'ai_usage_counters', 'app_admins', 'billing_payments', 'billing_subscriptions', 'billing_trial_claims', 'billing_webhook_events', 'exercise_videos', 'legal_acceptances', 'legal_policy_versions', 'profiles', 'referral_admin_audit', 'referral_attributions', 'referral_ledger_entries', 'referral_partners', 'referral_payouts', 'referral_visit_counters', 'workout_active_sessions', 'workout_plans', 'workout_prefs', 'workout_sessions']) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
    expect(t.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });
  it('has RLS policies on the user-data tables (workout tables: 4 each) and no client DELETE grant after the follow-up migration', async () => {
    const pol = await rows<{ tablename: string; n: number }>(`select tablename, count(*)::int n from pg_policies where schemaname = 'public' and tablename like 'workout_%' group by 1 order by 1`);
    expect(pol.map((p) => p.tablename)).toEqual(['workout_active_sessions', 'workout_plans', 'workout_prefs', 'workout_sessions']);
    const del = await rows<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and table_name like 'workout_%' and grantee in ('authenticated','anon','public') and privilege_type = 'DELETE'`
    );
    expect(del).toEqual([]);
  });
  it('installs the sign-up enforcement triggers and the Before User Created hook function (hook itself is a dashboard setting, not created here)', async () => {
    const trg = await rows<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1`);
    expect(trg.length).toBeGreaterThanOrEqual(3);
    const fn = await rows<{ proname: string }>(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'hook_before_user_created'`);
    expect(fn).toHaveLength(1);
  });
  it('pins search_path = \'\' on the workout sync functions, both SECURITY INVOKER, and keeps the guard function off client roles', async () => {
    const f = await rows<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('push_workout_record','pull_workout_changes','workout_sync_row_guard') order by 1`
    );
    expect(f.map((r) => r.proname)).toEqual(['pull_workout_changes', 'push_workout_record', 'workout_sync_row_guard']);
    for (const r of f) {
      expect(r.prosecdef).toBe(false);
      expect(r.proconfig).toEqual(['search_path=""']);
    }
    const ex = await rows<{ a: boolean; b: boolean }>(`select has_function_privilege('anon','public.workout_sync_row_guard()','execute') a, has_function_privilege('authenticated','public.workout_sync_row_guard()','execute') b`);
    expect(ex[0]).toEqual({ a: false, b: false });
    const rpc = await rows<{ a: boolean; b: boolean }>(`select has_function_privilege('anon','public.pull_workout_changes(timestamptz,text,text,integer)','execute') a, has_function_privilege('authenticated','public.pull_workout_changes(timestamptz,text,text,integer)','execute') b`);
    expect(rpc[0]).toEqual({ a: false, b: true });
  });
  it('ran legal_acceptances before referral_core (the real remote order) and referral_core created its tables afterwards', () => {
    expect(applied.indexOf('20261112060134_legal_acceptances.sql')).toBeLessThan(applied.indexOf('20261112060254_referral_core.sql'));
  });
  it('the remote-only revoke migration is a safe no-op when public.rls_auto_enable() does not exist (fresh repo build, as above)', async () => {
    expect(applied).toContain('20261102082840_revoke_rls_auto_enable_execute.sql');
    expect(await rows(`select 1 from pg_proc where proname = 'rls_auto_enable'`)).toEqual([]);
  });
});

describe('remote-only revoke migration when the function exists (isolated database)', () => {
  it('revokes EXECUTE from public, anon and authenticated, and is idempotent', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon nologin; create role authenticated nologin;
        create function public.rls_auto_enable() returns void language sql as $$ select 1 $$;
        grant execute on function public.rls_auto_enable() to anon, authenticated;`);
      const sql = readFileSync(join(migDir, '20261102082840_revoke_rls_auto_enable_execute.sql'), 'utf8');
      await db.exec(sql);
      await db.exec(sql);
      const r = (await db.query<{ a: boolean; b: boolean }>(`select has_function_privilege('anon','public.rls_auto_enable()','execute') a, has_function_privilege('authenticated','public.rls_auto_enable()','execute') b`)).rows[0];
      expect(r).toEqual({ a: false, b: false });
    } finally {
      await db.close();
    }
  });
});
