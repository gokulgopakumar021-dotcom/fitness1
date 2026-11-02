// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL ai_usage_quota migration in an in-process Postgres with a simulated auth schema and roles (same approach
 * as the other rls.*.test.ts). PGlite is single-connection, so true multi-connection concurrency is NOT exercised here;
 * the atomicity argument rests on INSERT .. ON CONFLICT DO UPDATE .. WHERE and must be verified on the live project.
 */
const MIGRATION = readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/20261031000000_ai_usage_quota.sql'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'postgres', uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
  }
}
const consume = (bucket: string, limit: number) =>
  pg.query<{ allowed: boolean; used: number }>(`select * from public.consume_ai_quota('${bucket}', ${limit})`).then((r) => r.rows[0]);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await pg.exec(MIGRATION);
});
afterAll(() => pg.close());

describe('consume_ai_quota (SEC-02 persistent quota)', () => {
  it('allows up to the limit, then refuses without incrementing further', async () => {
    const seq = await as('authenticated', A, async () => [await consume('b1', 3), await consume('b1', 3), await consume('b1', 3), await consume('b1', 3), await consume('b1', 3)]);
    expect(seq.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(seq.map((r) => r.used)).toEqual([1, 2, 3, 3, 3]);
  });

  it('counts per user and per bucket', async () => {
    expect((await as('authenticated', B, () => consume('b1', 3))).used).toBe(1);
    expect((await as('authenticated', A, () => consume('b2', 3))).used).toBe(1);
  });

  it('a limit of 0 always refuses and never stores a row', async () => {
    expect((await as('authenticated', A, () => consume('zero', 0))).allowed).toBe(false);
    const n = await pg.query(`select count(*)::int as n from public.ai_usage_counters where bucket = 'zero'`);
    expect((n.rows[0] as { n: number }).n).toBe(0);
  });

  it('refuses anonymous callers and invalid arguments', async () => {
    await expect(as('anon', null, () => consume('b1', 3))).rejects.toThrow();
    await expect(as('authenticated', null, () => consume('b1', 3))).rejects.toThrow(/not authenticated/);
    await expect(as('authenticated', A, () => consume('', 3))).rejects.toThrow(/invalid/);
    await expect(as('authenticated', A, () => consume('b1', -1))).rejects.toThrow(/invalid/);
  });

  it('exposes no direct table access to clients (RLS on, no grants)', async () => {
    await expect(as('authenticated', A, () => pg.query('select * from public.ai_usage_counters'))).rejects.toThrow();
    await expect(as('authenticated', A, () => pg.query(`update public.ai_usage_counters set used = 0`))).rejects.toThrow();
    await expect(as('authenticated', A, () => pg.query(`insert into public.ai_usage_counters values ('${A}','x',current_date,0)`))).rejects.toThrow();
    const rls = await pg.query(`select relrowsecurity from pg_class where relname = 'ai_usage_counters'`);
    expect((rls.rows[0] as { relrowsecurity: boolean }).relrowsecurity).toBe(true);
  });

  it('is resolved on the server-side UTC day (the caller cannot pick the day)', async () => {
    const today = await pg.query<{ d: string }>(`select (now() at time zone 'utc')::date::text as d`);
    const row = await pg.query<{ day: string }>(`select day::text as day from public.ai_usage_counters where user_id = '${A}' limit 1`);
    expect(row.rows[0].day).toBe(today.rows[0].d);
  });
});
