// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../server/security/endpoints';

/**
 * IL-04 (DRAFT migration, not applied to any live database). Runs the original quota migration and then the
 * allow-list/cleanup migration, in order, in an in-process Postgres with a simulated auth schema, and checks:
 *  - the allow-list in the SQL equals the `ai: true` buckets of src/server/security/endpoints.ts,
 *  - unknown buckets are refused and create no row, every real bucket still works,
 *  - one user's row count is bounded, and old counters are cleaned up (own rows only),
 *  - previous guarantees (grants, RLS, atomic limit, argument validation) still hold.
 * PGlite is a single connection: concurrency is not exercised here (see quota.pg.integration.test.ts for that).
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const BASE = readFileSync(resolve(dir, '20261102045148_ai_usage_quota.sql'), 'utf8');
const HARDEN = readFileSync(resolve(dir, '20261103061647_ai_quota_bucket_allowlist.sql'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: PGlite;

const aiBuckets = Object.values(ENDPOINTS).filter((p) => p.ai).map((p) => p.bucket);

async function as<T>(role: 'anon' | 'authenticated' | 'postgres', uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
const consume = (bucket: string, limit: number) =>
  pg.query<{ allowed: boolean; used: number }>(`select * from public.consume_ai_quota('${bucket}', ${limit})`).then((r) => r.rows[0]);
const count = async (where = 'true') =>
  (await pg.query<{ n: number }>(`select count(*)::int as n from public.ai_usage_counters where ${where}`)).rows[0].n;

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
  await pg.exec(BASE);
}, 60_000); // PGlite boot + migration: ~3-4 s alone, >10 s when the full suite saturates the CPU
afterAll(() => pg.close());

describe('IL-04 draft migration: bucket allow-list and cleanup', () => {
  it('the SQL allow-list is exactly the ai:true buckets of endpoints.ts (both occurrences in the file)', () => {
    expect(aiBuckets.length).toBe(15);
    const lists = [...HARDEN.matchAll(/array\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(lists).toHaveLength(2); // one-time cleanup + function constant
    for (const l of lists) expect([...l].sort()).toEqual([...aiBuckets].sort());
  });

  it('seeds old data to prove the one-time cleanup, then applies the migration', async () => {
    await pg.exec(`insert into public.ai_usage_counters values
      ('${A}','ai-food-parser',(now() at time zone 'utc')::date - 30, 4),
      ('${A}','ai-food-parser',(now() at time zone 'utc')::date - 1, 2),
      ('${A}','junk-bucket',(now() at time zone 'utc')::date, 9),
      ('${B}','ai-food-parser',(now() at time zone 'utc')::date - 20, 1)`);
    await pg.exec(HARDEN);
    expect(await count()).toBe(1); // only A / ai-food-parser / yesterday survives
    expect(await count(`user_id='${A}' and used = 2`)).toBe(1);
  });

  it('every real AI bucket still works for a signed-in user', async () => {
    for (const b of aiBuckets) {
      const r = await as('authenticated', B, () => consume(b, 5));
      expect(r).toEqual({ allowed: true, used: 1 });
    }
    expect(await count(`user_id='${B}'`)).toBe(15);
  });

  it('refuses unknown, near-miss and case-variant buckets and stores nothing for them', async () => {
    const before = await count();
    for (const b of ['b1', 'ai-food-parsr', 'AI-FOOD-PARSER', 'barcode', 'x'.repeat(64)]) {
      await expect(as('authenticated', A, () => consume(b, 3))).rejects.toThrow(/unknown bucket/);
    }
    await expect(as('authenticated', A, () => consume('junk', 0))).rejects.toThrow(/unknown bucket/); // even with limit 0
    expect(await count()).toBe(before);
  });

  it('keeps previous behaviour: limit, argument validation, auth, grants, RLS', async () => {
    const seq = await as('authenticated', A, async () => [await consume('generate-plan', 2), await consume('generate-plan', 2), await consume('generate-plan', 2)]);
    expect(seq.map((r) => [r.allowed, r.used])).toEqual([[true, 1], [true, 2], [false, 2]]);
    expect((await as('authenticated', A, () => consume('exercise-coach', 0))).allowed).toBe(false);
    expect(await count(`user_id='${A}' and bucket='exercise-coach'`)).toBe(0);
    await expect(as('authenticated', A, () => consume('', 3))).rejects.toThrow(/invalid/);
    await expect(as('authenticated', A, () => consume('generate-plan', -1))).rejects.toThrow(/invalid/);
    await expect(as('authenticated', null, () => consume('generate-plan', 3))).rejects.toThrow(/not authenticated/);
    await expect(as('anon', null, () => consume('generate-plan', 3))).rejects.toThrow();
    await expect(as('authenticated', A, () => pg.query('select * from public.ai_usage_counters'))).rejects.toThrow();
    const f = await pg.query<{ definer: boolean; cfg: string[] }>(`select prosecdef as definer, proconfig as cfg from pg_proc where proname='consume_ai_quota'`);
    expect(f.rows[0].definer).toBe(true);
    expect(f.rows[0].cfg).toEqual(['search_path=""']);
    const exec = async (r: string) => (await pg.query<{ x: boolean }>(`select has_function_privilege('${r}','public.consume_ai_quota(text,integer)','execute') as x`)).rows[0].x;
    expect([await exec('anon'), await exec('authenticated')]).toEqual([false, true]);
  });

  it('first use of a bucket on a new day deletes only the caller\'s counters older than 7 days', async () => {
    await pg.exec(`delete from public.ai_usage_counters;
      insert into public.ai_usage_counters values
        ('${A}','ai-food-parser',(now() at time zone 'utc')::date - 8, 3),
        ('${A}','ai-form-analyzer',(now() at time zone 'utc')::date - 7, 3),
        ('${A}','ai-form-analyzer',(now() at time zone 'utc')::date - 2, 3),
        ('${B}','ai-food-parser',(now() at time zone 'utc')::date - 30, 3)`);
    // First use of this bucket today (new row, used = 1) triggers the caller's cleanup.
    await as('authenticated', A, () => consume('ai-form-analyzer', 50));
    expect(await count(`user_id='${A}' and day < (now() at time zone 'utc')::date - 7`)).toBe(0);
    expect(await count(`user_id='${A}' and day = (now() at time zone 'utc')::date - 7`)).toBe(1); // exactly 7 days old is kept
    expect(await count(`user_id='${B}'`)).toBe(1); // another user's stale row is untouched
    expect(await count(`user_id='${A}' and day = (now() at time zone 'utc')::date - 2`)).toBe(1);
  });

  it('a stale row is not cleaned by a call that is not the first of the day for its bucket', async () => {
    await pg.exec(`insert into public.ai_usage_counters values ('${A}','ai-warmup-generator',(now() at time zone 'utc')::date - 40, 1)`);
    await as('authenticated', A, () => consume('ai-form-analyzer', 50)); // used becomes 2: no cleanup
    expect(await count(`user_id='${A}' and bucket='ai-warmup-generator'`)).toBe(1);
    await as('authenticated', A, () => consume('ai-personal-trainer', 50)); // first use of another bucket today: cleanup
    expect(await count(`user_id='${A}' and bucket='ai-warmup-generator'`)).toBe(0);
  });

  it('a user cannot hold more than buckets x (retention+1 days) rows', async () => {
    await pg.exec(`delete from public.ai_usage_counters`);
    // 15 buckets x 8 days is the ceiling the retention window allows; the allow-list makes extra names impossible.
    for (const b of aiBuckets) await as('authenticated', A, () => consume(b, 5));
    expect(await count(`user_id='${A}'`)).toBeLessThanOrEqual(15 * 8);
    await expect(as('authenticated', A, () => consume('flood-1', 5))).rejects.toThrow();
    expect(await count(`user_id='${A}'`)).toBe(15);
  });
});
