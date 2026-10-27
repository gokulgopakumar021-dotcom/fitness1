// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migration file in an in-process Postgres and exercises the RLS policies as the `anon` and
 * `authenticated` roles. What is simulated: the `auth` schema (users table + auth.uid() reading the same
 * `request.jwt.claim.sub` setting PostgREST sets) and the Supabase roles. What is NOT covered: Supabase's own
 * auth service, PostgREST, or the live project — this does not replace verifying on the real project.
 */
const MIGRATION = readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/20261027000000_auth_profiles.sql'), 'utf8');

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
  await pg.exec(MIGRATION);
  await pg.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@example.com', '{"full_name": "  Alice  "}'),
      ('${B}', 'b@example.com', '{"full_name": "Bob"}');
  `);
}, 60000);
afterAll(async () => { await pg.close(); });

describe('profiles migration', () => {
  it('is idempotent (re-running changes nothing and does not error)', async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
    expect(await rows('select count(*)::int as n from public.profiles')).toEqual([{ n: 2 }]);
  });

  it('has RLS enabled and every policy scoped to the authenticated role', async () => {
    expect(await rows("select relrowsecurity from pg_class where oid = 'public.profiles'::regclass")).toEqual([{ relrowsecurity: true }]);
    const pol = await rows("select policyname, cmd, roles::text as roles from pg_policies where tablename = 'profiles' order by cmd");
    expect(pol.map((p) => p.cmd)).toEqual(['SELECT', 'UPDATE']);
    for (const p of pol) expect(p.roles).toBe('{authenticated}');
  });
});

describe('profile creation trigger', () => {
  it('creates exactly one profile per user, trimming the name, from signup metadata', async () => {
    expect(await rows(`select id, full_name from public.profiles order by full_name`)).toEqual([
      { id: A, full_name: 'Alice' },
      { id: B, full_name: 'Bob' }
    ]);
  });

  it('stores null for a missing/blank name and caps the length at 100', async () => {
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await pg.exec(`insert into auth.users (id, raw_user_meta_data) values ('${C}', null), ('${D}', '{"full_name":"${'x'.repeat(150)}"}')`);
    expect(await rows(`select full_name from public.profiles where id = '${C}'`)).toEqual([{ full_name: null }]);
    expect((await rows(`select char_length(full_name)::int as n from public.profiles where id = '${D}'`))[0].n).toBe(100);
  });

  it('cannot create a second profile for the same user (primary key)', async () => {
    await expect(pg.exec(`insert into public.profiles (id) values ('${A}')`)).rejects.toThrow(/duplicate key/);
  });

  it('refuses a profile for a user that does not exist (foreign key)', async () => {
    await expect(pg.exec(`insert into public.profiles (id) values ('99999999-9999-4999-8999-999999999999')`)).rejects.toThrow(/foreign key/);
  });

  it('is not executable through the API roles', async () => {
    await as('authenticated', A, async () => {
      await expect(pg.query('select public.handle_new_user()')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('row level security', () => {
  it('lets a user read only their own profile', async () => {
    const seenByA = await as('authenticated', A, () => rows('select id from public.profiles'));
    expect(seenByA).toEqual([{ id: A }]);
    const seenByB = await as('authenticated', B, () => rows('select id from public.profiles'));
    expect(seenByB).toEqual([{ id: B }]);
  });

  it('cannot read another user\'s profile even by asking for it by id', async () => {
    expect(await as('authenticated', A, () => rows(`select * from public.profiles where id = '${B}'`))).toEqual([]);
  });

  it('denies an authenticated caller with no subject claim', async () => {
    expect(await as('authenticated', null, () => rows('select * from public.profiles'))).toEqual([]);
  });

  it('denies unauthenticated (anon) reads and writes outright', async () => {
    await as('anon', null, async () => {
      await expect(pg.query('select * from public.profiles')).rejects.toThrow(/permission denied/);
      await expect(pg.exec(`update public.profiles set full_name = 'x'`)).rejects.toThrow(/permission denied/);
      await expect(pg.exec(`insert into public.profiles (id) values ('${A}')`)).rejects.toThrow(/permission denied/);
    });
  });

  it('lets a user update their own name and bumps updated_at', async () => {
    const before = (await rows(`select updated_at from public.profiles where id = '${A}'`))[0].updated_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    const res = await as('authenticated', A, () => pg.query(`update public.profiles set full_name = 'Alice L' where id = '${A}'`));
    expect(res.affectedRows).toBe(1);
    const after = (await rows(`select full_name, updated_at from public.profiles where id = '${A}'`))[0];
    expect(after.full_name).toBe('Alice L');
    expect((after.updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
  });

  it('cannot update another user\'s profile (zero rows affected, data unchanged)', async () => {
    const res = await as('authenticated', A, () => pg.query(`update public.profiles set full_name = 'HACKED' where id = '${B}'`));
    expect(res.affectedRows).toBe(0);
    expect(await rows(`select full_name from public.profiles where id = '${B}'`)).toEqual([{ full_name: 'Bob' }]);
  });

  it('cannot reassign ownership (id column is not updatable)', async () => {
    await as('authenticated', A, async () => {
      await expect(pg.exec(`update public.profiles set id = '${B}' where id = '${A}'`)).rejects.toThrow(/permission denied/);
    });
  });

  it('cannot insert or delete profiles through the API', async () => {
    await as('authenticated', A, async () => {
      await expect(pg.exec(`insert into public.profiles (id) values ('${A}')`)).rejects.toThrow(/permission denied/);
      await expect(pg.exec(`delete from public.profiles where id = '${A}'`)).rejects.toThrow(/permission denied/);
    });
    expect(await rows(`select id from public.profiles where id = '${A}'`)).toHaveLength(1);
  });

  it('removes the profile when the auth user is deleted (cascade)', async () => {
    await pg.exec(`delete from auth.users where id = '${B}'`);
    expect(await rows(`select id from public.profiles where id = '${B}'`)).toEqual([]);
  });
});
