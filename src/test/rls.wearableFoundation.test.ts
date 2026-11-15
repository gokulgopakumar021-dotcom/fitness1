// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the PROPOSED wearable migration in an in-process Postgres with a simulated auth schema and Supabase roles.
 * NOT covered: Supabase's own auth service/PostgREST, the live project (nothing here touches it), concurrency.
 */
const root = resolve(import.meta.dirname, '../..');
const SQL = readFileSync(resolve(root, 'supabase/proposed/20261116000000_wearable_foundation.sql'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'service_role' | 'postgres', uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
const deviceOf = async (uid: string, key = 'k1') =>
  (await as('authenticated', uid, () => pg.query<{ id: string }>(`insert into public.wearable_devices (user_id, device_key, manufacturer, ingestion_method) values ('${uid}','${key}','Polar','direct_ble') returning id`))).rows[0].id;
const sample = (uid: string, dev: string, over: Record<string, string> = {}) => {
  const c = { metric: "'heart_rate'", value: '70', unit: "'bpm'", origin: "'live'", dk: "'k|1'", ...over };
  return pg.query(`insert into public.wearable_samples (user_id, device_id, metric, value, unit, measured_at, origin, dedupe_key) values ('${uid}','${dev}',${c.metric},${c.value},${c.unit},'2026-11-15T10:00:00Z',${c.origin},${c.dk})`);
};

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(SQL);
  await pg.exec(`grant all on all tables in schema public to service_role`);
  await pg.exec(`insert into auth.users (id, email) values ('${A}','a@example.com'), ('${B}','b@example.com')`);
}, 60000);
afterAll(async () => { await pg.close(); });

const TABLES = ['wearable_connections', 'wearable_devices', 'wearable_samples', 'wearable_ai_consents', 'wearable_provider_credentials'];

describe('proposed wearable migration', () => {
  it('is not placed in supabase/migrations (history guard) and is idempotent to re-apply', async () => {
    expect(readdirSync(resolve(root, 'supabase/migrations')).some((f) => f.includes('wearable'))).toBe(false);
    expect(existsSync(resolve(root, 'supabase/proposed/README.md'))).toBe(true);
    await expect(pg.exec(SQL)).resolves.toBeDefined();
  });
  it('enables RLS everywhere and grants nothing to anon', async () => {
    for (const t of TABLES) {
      expect((await pg.query<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid='public.${t}'::regclass`)).rows[0].r).toBe(true);
      expect((await pg.query(`select 1 from information_schema.role_table_grants where table_name='${t}' and grantee='anon'`)).rows).toHaveLength(0);
    }
  });
  it('anon cannot read or write', async () => {
    await expect(as('anon', null, () => pg.query('select * from public.wearable_samples'))).rejects.toThrow(/permission denied/);
  });
  it('owner can create a device and a sample; another user cannot see them', async () => {
    const d = await deviceOf(A);
    await as('authenticated', A, () => sample(A, d));
    expect((await as('authenticated', A, () => pg.query('select 1 from public.wearable_samples'))).rows).toHaveLength(1);
    expect((await as('authenticated', B, () => pg.query('select 1 from public.wearable_samples'))).rows).toHaveLength(0);
    expect((await as('authenticated', B, () => pg.query('select 1 from public.wearable_devices'))).rows).toHaveLength(0);
  });
  it('cannot insert under another user identity', async () => {
    const d = await deviceOf(B, 'kb');
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_devices (user_id, device_key, manufacturer, ingestion_method) values ('${B}','x','Polar','direct_ble')`))).rejects.toThrow(/row-level security/);
    await expect(as('authenticated', A, () => sample(A, d, { dk: "'forged'" }))).rejects.toThrow(/foreign key/);   // A cannot attach a sample to B's device
    await expect(as('authenticated', A, () => sample(B, d, { dk: "'forged2'" }))).rejects.toThrow(/row-level security/);
  });
  it('rejects simulated origin, bad units, out-of-range plumbing and non-finite values', async () => {
    const d = await deviceOf(A, 'k2');
    await expect(as('authenticated', A, () => sample(A, d, { origin: "'simulated'", dk: "'s1'" }))).rejects.toThrow(/check/);
    await expect(as('authenticated', A, () => sample(A, d, { unit: "'kcal'", dk: "'s2'" }))).rejects.toThrow(/check/);
    await expect(as('authenticated', A, () => sample(A, d, { value: "'NaN'::float8", dk: "'s3'" }))).rejects.toThrow(/check/);
    await expect(as('authenticated', A, () => sample(A, d, { metric: "'glucose'", dk: "'s4'" }))).rejects.toThrow(/check/);
  });
  it('duplicate imports collapse on (user_id, dedupe_key)', async () => {
    const d = await deviceOf(A, 'k3');
    await as('authenticated', A, () => sample(A, d, { dk: "'dup'" }));
    await expect(as('authenticated', A, () => sample(A, d, { dk: "'dup'" }))).rejects.toThrow(/unique|duplicate/);
    await as('authenticated', A, () => pg.query(`insert into public.wearable_samples (user_id, device_id, metric, value, unit, measured_at, origin, dedupe_key) values ('${A}','${d}','heart_rate',70,'bpm','2026-11-15T10:00:00Z','live','dup') on conflict (user_id, dedupe_key) do nothing`));
  });
  it('clients cannot update samples or touch provider credentials', async () => {
    await expect(as('authenticated', A, () => pg.query(`update public.wearable_samples set value = 1`))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, () => pg.query('select * from public.wearable_provider_credentials'))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_provider_credentials (connection_id,user_id,secret_ref) values (gen_random_uuid(),'${A}','x')`))).rejects.toThrow(/permission denied/);
  });
  it('clients cannot create cloud connections (service_role only), service_role can, and credentials are never client-readable', async () => {
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_connections (user_id, provider, ingestion_method) values ('${A}','garmin','cloud_api')`))).rejects.toThrow(/permission denied/);
    const c = (await as('service_role', null, () => pg.query<{ id: string }>(`insert into public.wearable_connections (user_id, provider, ingestion_method, status) values ('${A}','garmin','cloud_api','active') returning id`))).rows[0].id;
    await as('service_role', null, () => pg.query(`insert into public.wearable_provider_credentials (connection_id,user_id,secret_ref) values ('${c}','${A}','vault:abc')`));
    expect((await as('authenticated', B, () => pg.query('select 1 from public.wearable_connections'))).rows).toHaveLength(0);
    // Disconnect = owner deletes the connection; credentials cascade away with it.
    await as('authenticated', A, () => pg.query(`delete from public.wearable_connections where id='${c}'`));
    expect((await pg.query('select 1 from public.wearable_provider_credentials')).rows).toHaveLength(0);
  });
  it('AI consent: no row by default, owner-only, categories validated, revocable', async () => {
    expect((await as('authenticated', A, () => pg.query('select 1 from public.wearable_ai_consents'))).rows).toHaveLength(0);
    await as('authenticated', A, () => pg.query(`insert into public.wearable_ai_consents (user_id, version, categories) values ('${A}',1,array['live_heart_rate'])`));
    await expect(as('authenticated', B, () => pg.query(`insert into public.wearable_ai_consents (user_id, version, categories) values ('${A}',1,array['live_heart_rate'])`))).rejects.toThrow();
    await expect(as('authenticated', B, () => pg.query(`insert into public.wearable_ai_consents (user_id, version, categories) values ('${B}',1,array['everything'])`))).rejects.toThrow(/check/);
    expect((await as('authenticated', B, () => pg.query('select 1 from public.wearable_ai_consents'))).rows).toHaveLength(0);
    await as('authenticated', A, () => pg.query('delete from public.wearable_ai_consents'));
    expect((await as('authenticated', A, () => pg.query('select 1 from public.wearable_ai_consents'))).rows).toHaveLength(0);
  });
  it('account deletion cascades to every wearable table', async () => {
    await as('postgres', null, () => pg.query(`delete from auth.users where id='${A}'`));
    for (const t of TABLES) expect((await pg.query(`select 1 from public.${t} where user_id='${A}'`)).rows).toHaveLength(0);
  });
});
