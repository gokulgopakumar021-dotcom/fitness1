// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migration files in an in-process Postgres. Simulated: the `auth` schema (users table + auth.uid()
 * reading request.jwt.claim.sub, as PostgREST sets it) and the Supabase roles. NOT covered: Supabase's own auth
 * service (which also owns auth.sessions / refresh tokens / identities and cascades from auth.users), PostgREST, or the
 * live project. Verify on the real project before relying on it.
 */
const read = (f: string) => readFileSync(resolve(import.meta.dirname, '../../supabase/migrations', f), 'utf8');
const PROFILES = read('20261027000000_auth_profiles.sql');
const DELETE_FN = read('20261030000000_delete_own_account.sql');

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
const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(PROFILES);
  await pg.exec(DELETE_FN);
  await pg.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@example.com', '{"full_name":"Alice"}'),
      ('${B}', 'b@example.com', '{"full_name":"Bob"}');
  `);
}, 60000);
afterAll(async () => { await pg.close(); });

describe('delete_own_account()', () => {
  it('is idempotent to re-apply', async () => {
    await expect(pg.exec(DELETE_FN)).resolves.toBeDefined();
  });

  it('takes no arguments, so a caller cannot name another user', async () => {
    expect(await rows("select pronargs::int as n from pg_proc where proname = 'delete_own_account'")).toEqual([{ n: 0 }]);
  });

  it('is not executable by anon', async () => {
    await expect(as('anon', null, () => pg.query('select public.delete_own_account()'))).rejects.toThrow(/permission denied/i);
    expect(await rows('select count(*)::int as n from auth.users')).toEqual([{ n: 2 }]);
  });

  it('rejects an authenticated role with no user in the token', async () => {
    await expect(as('authenticated', null, () => pg.query('select public.delete_own_account()'))).rejects.toThrow(/Not authenticated/);
    expect(await rows('select count(*)::int as n from auth.users')).toEqual([{ n: 2 }]);
  });

  it("deletes only the caller's own user, and their profile cascades", async () => {
    await as('authenticated', A, () => pg.query('select public.delete_own_account()'));
    expect(await rows('select id from auth.users')).toEqual([{ id: B }]);
    expect(await rows('select id from public.profiles')).toEqual([{ id: B }]);
  });

  it('a second call by the already-deleted user changes nothing', async () => {
    await as('authenticated', A, () => pg.query('select public.delete_own_account()'));
    expect(await rows('select id from auth.users')).toEqual([{ id: B }]);
  });
});
