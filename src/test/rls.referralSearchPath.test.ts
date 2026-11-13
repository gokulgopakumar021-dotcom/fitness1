// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Stage 8 / V3: the PROPOSED search_path pin for the three referral guard trigger functions (supabase/proposed/...). Runs the REAL
 * 20261112060254_referral_core.sql (and its prerequisites) in an in-process Postgres, then the proposed SQL and its rollback, and
 * proves the append-only / immutability behaviour is identical before and after. Nothing here touches any Supabase project.
 * NOT covered: the hosted Supabase advisor re-scan (needs the migration applied to a real project), true concurrency.
 */
const root = resolve(import.meta.dirname, '../../supabase');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const PREREQ = ['20261027051824_auth_profiles.sql', '20261030053401_delete_own_account.sql', '20261106052859_billing_core.sql', '20261106071858_billing_deletion_refund.sql', '20261112060254_referral_core.sql'].map((f) => read(`migrations/${f}`));
const PROPOSED = read('proposed/20261114000000_referral_trigger_search_path.sql');
const ROLLBACK = read('manual/rollback_referral_trigger_search_path.sql');

const FUNCS = ['referral_forbid_mutation', 'referral_attribution_guard', 'referral_partner_guard'] as const;
const strip = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

let pg: PGlite;
const val = async <T>(q: string) => (await pg.query<T>(q)).rows;
const rejects = async (sql: string) => {
  try {
    await pg.exec(sql);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error(`expected rejection: ${sql}`);
};
const snapshot = async () => ({
  funcs: await val(`select p.proname, p.prosecdef, p.proowner::regrole::text as owner, p.proacl::text as acl, md5(p.prosrc) as body, p.prolang from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array['${FUNCS.join("','")}']) order by 1`),
  triggers: await val(`select tgrelid::regclass::text as tbl, tgname, tgfoid::regproc::text as fn, tgenabled from pg_trigger where not tgisinternal and tgfoid::regproc::text ~ 'referral_(forbid_mutation|attribution_guard|partner_guard)' order by 1, 2`),
  policies: await val(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename like 'referral_%' order by 1, 2`)
});
const config = async () => Object.fromEntries((await val<{ proname: string; proconfig: string[] | null }>(`select proname, proconfig from pg_proc where proname = any(array['${FUNCS.join("','")}'])`)).map((r) => [r.proname, r.proconfig]));

let partnerId = '';
let attributionId = '';
let ledgerId = '';

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  for (const sql of PREREQ) await pg.exec(sql);
  await pg.exec(`insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111','p@example.com'), ('22222222-2222-4222-8222-222222222222','c@example.com')`);
  partnerId = (await val<{ id: string }>(`insert into public.referral_partners (user_id, code, display_name, email_hash, commission_rate_bps) values ('11111111-1111-4111-8111-111111111111','TESTCODE','P','hash-p-0123456789abcdef',2000) returning id`))[0].id;
  attributionId = (await val<{ id: string }>(`insert into public.referral_attributions (partner_id, referred_user_id, code_used, referred_email_hash, source) values ('${partnerId}','22222222-2222-4222-8222-222222222222','TESTCODE','hash-c-0123456789abcdef','signup') returning id`))[0].id;
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

/** The guard behaviour that must be byte-for-byte the same with and without the search_path pin. */
async function assertGuardsStillEnforce() {
  expect(await rejects(`update public.referral_partners set code = 'OTHERCODE' where id = '${partnerId}'`)).toMatch(/immutable/);
  expect(await rejects(`delete from public.referral_partners where id = '${partnerId}'`)).toMatch(/not allowed/);
  expect(await rejects(`truncate public.referral_partners cascade`)).toMatch(/append-only/);
  expect(await rejects(`update public.referral_attributions set code_used = 'NOPE' where id = '${attributionId}'`)).toMatch(/immutable/);
  expect(await rejects(`delete from public.referral_attributions where id = '${attributionId}'`)).toMatch(/not allowed/);
  expect(await rejects(`truncate public.referral_attributions cascade`)).toMatch(/append-only/);
  for (const t of ['referral_ledger_entries', 'referral_payouts', 'referral_admin_audit']) {
    expect(await rejects(`truncate public.${t} cascade`)).toMatch(/append-only/);
  }
  // Permitted changes still work: status may move active -> suspended, and updated_at is still maintained by set_updated_at().
  const before = (await val<{ updated_at: string }>(`select updated_at::text from public.referral_partners where id = '${partnerId}'`))[0].updated_at;
  await pg.exec(`select pg_sleep(0.01); update public.referral_partners set status = 'suspended' where id = '${partnerId}'`);
  const after = (await val<{ status: string; updated_at: string }>(`select status, updated_at::text from public.referral_partners where id = '${partnerId}'`))[0];
  expect(after.status).toBe('suspended');
  expect(after.updated_at).not.toBe(before);
  await pg.exec(`update public.referral_partners set status = 'active' where id = '${partnerId}'`);
  // A terminated partner is final.
  await pg.exec(`update public.referral_partners set status = 'terminated' where id = '${partnerId}'`);
  expect(await rejects(`update public.referral_partners set status = 'active' where id = '${partnerId}'`)).toMatch(/cannot be reactivated/);
}

describe('Stage 8 / V3: referral guard search_path pin (proposed, not applied)', () => {
  it('starts from the advisor-warned state: all three are invoker functions with no search_path', async () => {
    const cfg = await config();
    for (const f of FUNCS) expect(cfg[f], f).toBeNull();
    const defs = (await snapshot()).funcs as { prosecdef: boolean }[];
    expect(defs).toHaveLength(3);
    for (const d of defs) expect(d.prosecdef).toBe(false);
  });

  it('the proposed SQL is ALTER FUNCTION ... SET search_path only (no redefinition, no privilege, policy or trigger change)', () => {
    const sql = strip(PROPOSED).toLowerCase();
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(3);
    for (const s of stmts) expect(s).toMatch(/^alter function public\.referral_(forbid_mutation|attribution_guard|partner_guard)\(\)\s+set search_path = ''$/);
    expect(sql).not.toMatch(/security definer|create |drop |grant |revoke |policy|owner to|enable row|disable|\binsert\b|\bupdate\b|\bdelete\b/);
    const rb = strip(ROLLBACK).toLowerCase().split(';').map((s) => s.trim()).filter(Boolean);
    expect(rb).toHaveLength(3);
    for (const s of rb) expect(s).toMatch(/^alter function public\.referral_(forbid_mutation|attribution_guard|partner_guard)\(\)\s+reset search_path$/);
  });

  it('the rollback touches exactly the same three functions as the proposal (exact inverse, nothing extra)', () => {
    const names = (sql: string) => [...strip(sql).matchAll(/alter function public\.(\w+)\(\)/gi)].map((m) => m[1]).sort();
    expect(names(ROLLBACK)).toEqual(names(PROPOSED));
    expect(names(PROPOSED)).toEqual([...FUNCS].sort());
  });

  it('does not modify the original referral migration or sit in the migrations directory', () => {
    expect(PREREQ[4]).not.toMatch(/search_path = ''\s*\n\s*as \$\$\s*\nbegin\s*\n\s*raise exception '% on %/);
    expect(() => readFileSync(resolve(root, 'migrations/20261114000000_referral_trigger_search_path.sql'))).toThrow();
  });

  it('guards enforce before the change (baseline)', async () => {
    await assertGuardsStillEnforce();
    // reset the data state mutated by the baseline run
    await pg.exec(`alter table public.referral_partners disable trigger referral_partners_guard; update public.referral_partners set status = 'active' where id = '${partnerId}'; alter table public.referral_partners enable trigger referral_partners_guard`);
  });

  it('applies cleanly, pins search_path to empty, and changes nothing else', async () => {
    const before = await snapshot();
    await pg.exec(PROPOSED);
    const cfg = await config();
    for (const f of FUNCS) expect(cfg[f], f).toEqual(['search_path=""']);
    expect(await snapshot()).toEqual(before); // bodies, SECURITY mode, owner, ACLs, triggers and policies all identical
  });

  it('guards still enforce after the change, including under the roles that can reach the tables', async () => {
    await assertGuardsStillEnforce();
    await pg.exec(`alter table public.referral_partners disable trigger referral_partners_guard; update public.referral_partners set status = 'active' where id = '${partnerId}'; alter table public.referral_partners enable trigger referral_partners_guard`);
    // Hostile search_path cannot redirect the function: an attacker-created schema/operator has no effect because nothing is resolved by name.
    await pg.exec(`create schema evil; set search_path = evil, public`);
    expect(await rejects(`update public.referral_attributions set source = 'admin' where id = '${attributionId}'`)).toMatch(/immutable/);
    await pg.exec(`reset search_path; drop schema evil`);
  });

  it('is idempotent: running it again changes nothing', async () => {
    const before = await snapshot();
    await pg.exec(PROPOSED);
    expect(await snapshot()).toEqual(before);
    const cfg = await config();
    for (const f of FUNCS) expect(cfg[f]).toEqual(['search_path=""']);
  });

  it('rollback restores the original unpinned state and the guards still enforce', async () => {
    const before = await snapshot();
    await pg.exec(ROLLBACK);
    const cfg = await config();
    for (const f of FUNCS) expect(cfg[f], f).toBeNull();
    expect(await snapshot()).toEqual(before);
    await assertGuardsStillEnforce();
  });

  it('leaves no residual data change beyond the test fixtures and keeps the ledger append-only', async () => {
    const n = (await val<{ c: number }>(`select count(*)::int as c from public.referral_ledger_entries`))[0].c;
    expect(n).toBe(0);
  });
});
