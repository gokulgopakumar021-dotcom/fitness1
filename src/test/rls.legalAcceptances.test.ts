// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL Stage 2B migration in an in-process Postgres (same harness as rls.profiles.test.ts). Simulated: the `auth`
 * schema, auth.uid() and the Supabase roles. NOT covered: the live Supabase project, PostgREST or Supabase Auth itself.
 * The migration has not been applied to any Supabase project.
 */
const MIGRATION = readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/20261112060134_legal_acceptances.sql'), 'utf8');
const ROLLBACK = readFileSync(resolve(import.meta.dirname, '../../supabase/manual/rollback_legal_acceptances.sql'), 'utf8');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXISTING = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

const signupMeta = (t: string, p: string) => JSON.stringify({ full_name: 'X', legal_acceptance: { terms_version: t, privacy_version: p, accepted_at_client: '2020-01-01T00:00:00Z' } });

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
  // An account that pre-dates the migration: must get NO row (that is how the notice knows to appear).
  await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${EXISTING}', 'old@example.com', '{"full_name":"Old"}')`);
  await pg.exec(MIGRATION);
  await pg.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@example.com', '${signupMeta('t1', 'p1')}'),
      ('${B}', 'b@example.com', '{"full_name":"Bob"}');
  `);
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('legal_acceptances migration', () => {
  it('is idempotent', async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
    expect(await rows('select count(*)::int as n from public.legal_acceptances')).toEqual([{ n: 1 }]);
  });

  it('has RLS on, and one SELECT policy scoped to authenticated', async () => {
    expect(await rows("select relrowsecurity from pg_class where oid = 'public.legal_acceptances'::regclass")).toEqual([{ relrowsecurity: true }]);
    const pol = await rows("select cmd, roles::text as roles from pg_policies where tablename = 'legal_acceptances'");
    expect(pol).toEqual([{ cmd: 'SELECT', roles: '{authenticated}' }]);
  });
});

describe('sign-up recording (trigger)', () => {
  it('records the versions from signup metadata with the database clock and method signup', async () => {
    const r = await rows(`select terms_version, privacy_version, method, accepted_at from public.legal_acceptances where user_id = '${A}'`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ terms_version: 't1', privacy_version: 'p1', method: 'signup' });
    // The browser-supplied timestamp (2020) is NOT used.
    expect((r[0].accepted_at as Date).getFullYear()).toBeGreaterThan(2024);
  });

  it('records nothing when the metadata is missing', async () => {
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${B}'`)).toEqual([]);
  });

  it('does not back-fill accounts that existed before the migration', async () => {
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${EXISTING}'`)).toEqual([]);
  });

  it('ignores malformed versions and NEVER blocks account creation', async () => {
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await pg.exec(`insert into auth.users (id, raw_user_meta_data) values ('${C}', '${signupMeta('bad version!', 'p1')}')`);
    await pg.exec(`insert into auth.users (id, raw_user_meta_data) values ('${D}', '{"legal_acceptance": "not an object"}')`);
    expect(await rows(`select id from auth.users where id in ('${C}','${D}')`)).toHaveLength(2);
    expect(await rows(`select 1 from public.legal_acceptances where user_id in ('${C}','${D}')`)).toEqual([]);
  });

  it('is not executable through the API roles', async () => {
    await as('authenticated', A, async () => {
      await expect(pg.query('select public.handle_new_user_legal_acceptance()')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('existing-user acknowledgement (rpc)', () => {
  const T = 't2';
  const P = 'p2';

  it('records an acknowledgement for the caller only, without duplicates, keeping the first timestamp', async () => {
    await as('authenticated', EXISTING, () => pg.query(`select public.acknowledge_legal_update('${T}', '${P}')`));
    const first = await rows(`select method, accepted_at from public.legal_acceptances where user_id = '${EXISTING}'`);
    expect(first).toHaveLength(1);
    expect(first[0].method).toBe('existing_user_notice');
    await new Promise((r) => setTimeout(r, 5));
    await as('authenticated', EXISTING, () => pg.query(`select public.acknowledge_legal_update('${T}', '${P}')`));
    const second = await rows(`select accepted_at from public.legal_acceptances where user_id = '${EXISTING}'`);
    expect(second).toHaveLength(1);
    expect(second[0].accepted_at).toEqual(first[0].accepted_at);
  });

  it('adds a new row when the versions change', async () => {
    await as('authenticated', EXISTING, () => pg.query(`select public.acknowledge_legal_update('t3', 'p3')`));
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${EXISTING}'`)).toHaveLength(2);
  });

  it('has no user-id parameter, so it cannot record for anyone else', async () => {
    await as('authenticated', B, () => pg.query(`select public.acknowledge_legal_update('t9', 'p9')`));
    expect(await rows(`select user_id from public.legal_acceptances where terms_version = 't9'`)).toEqual([{ user_id: B }]);
  });

  it('rejects malformed versions and unauthenticated callers', async () => {
    await as('authenticated', B, async () => {
      await expect(pg.query(`select public.acknowledge_legal_update('has space', 'p')`)).rejects.toThrow(/Invalid policy version/);
      await expect(pg.query(`select public.acknowledge_legal_update(null, 'p')`)).rejects.toThrow(/Invalid policy version/);
    });
    await as('authenticated', null, async () => {
      await expect(pg.query(`select public.acknowledge_legal_update('t', 'p')`)).rejects.toThrow(/Not authenticated/);
    });
    await as('anon', null, async () => {
      await expect(pg.query(`select public.acknowledge_legal_update('t', 'p')`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('row level security', () => {
  it('lets a user read only their own records', async () => {
    const seenByA = await as('authenticated', A, () => rows('select user_id from public.legal_acceptances'));
    expect(seenByA.every((r) => r.user_id === A)).toBe(true);
    expect(seenByA.length).toBeGreaterThan(0);
    expect(await as('authenticated', B, () => rows(`select * from public.legal_acceptances where user_id = '${A}'`))).toEqual([]);
  });

  it('denies anon entirely, and denies any direct write, update or delete by authenticated users', async () => {
    await as('anon', null, async () => {
      await expect(pg.query('select * from public.legal_acceptances')).rejects.toThrow(/permission denied/);
    });
    await as('authenticated', A, async () => {
      await expect(pg.exec(`insert into public.legal_acceptances (user_id, terms_version, privacy_version, method) values ('${A}','x','y','signup')`)).rejects.toThrow(/permission denied/);
      await expect(pg.exec(`update public.legal_acceptances set terms_version = 'hack'`)).rejects.toThrow(/permission denied/);
      await expect(pg.exec(`delete from public.legal_acceptances`)).rejects.toThrow(/permission denied/);
    });
  });

  it('enforces one row per user per version pair and the allowed method values', async () => {
    await expect(pg.exec(`insert into public.legal_acceptances (user_id, terms_version, privacy_version, method) values ('${A}','t1','p1','signup')`)).rejects.toThrow(/duplicate key/);
    await expect(pg.exec(`insert into public.legal_acceptances (user_id, terms_version, privacy_version, method) values ('${A}','m1','m1','typed-by-hand')`)).rejects.toThrow(/check constraint/);
  });
});

describe('account deletion and rollback', () => {
  it('removes a deleted user\'s records (cascade)', async () => {
    await pg.exec(`delete from auth.users where id = '${A}'`);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${A}'`)).toEqual([]);
  });

  it('rollback script removes the objects and sign-up still works afterwards', async () => {
    await pg.exec(ROLLBACK);
    expect(await rows("select to_regclass('public.legal_acceptances')::text as t")).toEqual([{ t: null }]);
    await pg.exec(`insert into auth.users (id, raw_user_meta_data) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '${signupMeta('t1', 'p1')}')`);
    await expect(pg.exec(ROLLBACK)).resolves.toBeDefined(); // idempotent
  });
});
