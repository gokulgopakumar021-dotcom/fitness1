// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL } from '../legal/legalConfig';

/**
 * Stage 2D / Stage 1: server-side legal acceptance enforcement. Runs the REAL migrations 20261111000000 then 20261112000000 in an
 * in-process Postgres (same harness as rls.legalAcceptances.test.ts).
 *
 * Simulated: the `auth` schema (a bare auth.users table), auth.uid() and the Supabase roles, including supabase_auth_admin.
 * NOT covered (NOT VERIFIED until tested on a Supabase preview branch): that the hosted Auth service actually calls the hook,
 * which sign-up paths invoke it, how Auth words the error it gets back from a failing trigger, and the dashboard setting itself.
 * Neither migration has been applied to any Supabase project.
 */
const read = (p: string) => readFileSync(resolve(import.meta.dirname, '../../supabase', p), 'utf8');
const MIG_11 = read('migrations/20261111000000_legal_acceptances.sql');
const MIG_12 = read('migrations/20261112000000_legal_acceptance_enforcement.sql');
const ROLLBACK = read('manual/rollback_legal_enforcement.sql');

const T = LEGAL.termsVersion;
const P = LEGAL.privacyVersion;
const meta = (acc: unknown) => JSON.stringify({ full_name: 'X', legal_acceptance: acc });
const good = meta({ terms_version: T, privacy_version: P });

let pg: PGlite;
const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;
const q = (s: string) => s.replace(/'/g, "''");
const insertUser = (id: string, rawMeta: string | null, email: string | null = `${id.slice(0, 4)}@example.com`) =>
  pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', ${email === null ? 'null' : `'${email}'`}, ${rawMeta === null ? 'null' : `'${q(rawMeta)}'`})`);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error('expected the statement to be rejected');
};
async function as<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; set role ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
  }
}
const canExec = async (role: string, fn: string) => (await rows(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;

const EXISTING = uid(900);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, supabase_auth_admin;
    grant execute on function auth.uid() to anon, authenticated;
    -- Stand-in for the existing profile trigger: proves a rejected sign-up leaves NOTHING behind.
    create table public.profiles (id uuid primary key);
    create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as
      $$ begin insert into public.profiles (id) values (new.id); return new; end; $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  `);
  // An account that pre-dates both migrations.
  await insertUser(EXISTING, JSON.stringify({ full_name: 'Old' }), 'old@example.com');
  await pg.exec(MIG_11);
  await pg.exec(MIG_12);
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('allowlist table', () => {
  it('is seeded with exactly the versions in legalConfig.ts (drift guard)', async () => {
    const r = await rows('select policy, version, is_current from public.legal_policy_versions order by policy');
    expect(r).toEqual([
      { policy: 'privacy', version: P, is_current: true },
      { policy: 'terms', version: T, is_current: true }
    ]);
  });

  it('is idempotent and keeps the migration additive', async () => {
    await expect(pg.exec(MIG_12)).resolves.toBeDefined();
    expect(await rows('select count(*)::int as n from public.legal_policy_versions')).toEqual([{ n: 2 }]);
    expect(await rows('select count(*)::int as n from public.legal_acceptances')).toEqual([{ n: 0 }]);
    expect(MIG_12).not.toMatch(/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  });

  it('has RLS on, no policy and no API-role access at all', async () => {
    expect(await rows("select relrowsecurity from pg_class where oid = 'public.legal_policy_versions'::regclass")).toEqual([{ relrowsecurity: true }]);
    expect(await rows("select count(*)::int as n from pg_policies where tablename = 'legal_policy_versions'")).toEqual([{ n: 0 }]);
    for (const role of ['anon', 'authenticated']) {
      await expect(as(role, () => pg.exec('select * from public.legal_policy_versions'))).rejects.toThrow(/permission denied/);
      await expect(as(role, () => pg.exec("insert into public.legal_policy_versions (policy, version, is_current) values ('terms','evil',true)"))).rejects.toThrow(/permission denied/);
      await expect(as(role, () => pg.exec('update public.legal_policy_versions set is_current = true'))).rejects.toThrow(/permission denied/);
    }
  });

  it('allows at most one current version per policy and only known policy names / safe version labels', async () => {
    await expect(pg.exec("insert into public.legal_policy_versions (policy, version, is_current) values ('terms','other',true)")).rejects.toThrow();
    await expect(pg.exec("insert into public.legal_policy_versions (policy, version) values ('cookies','v1')")).rejects.toThrow();
    await expect(pg.exec("insert into public.legal_policy_versions (policy, version) values ('terms','bad version!')")).rejects.toThrow();
  });
});

describe('Layer A: strict trigger rejects every unaccepted account creation', () => {
  it('rejects a direct sign-up with NO metadata, and leaves no user, profile or acceptance row', async () => {
    const e = await failure(insertUser(uid(1), JSON.stringify({ full_name: 'X' })));
    expect(e.message).toMatch(/Terms of Service/);
    expect(e.code).toBe('23514');
    expect(await rows(`select 1 from auth.users where id = '${uid(1)}'`)).toEqual([]);
    expect(await rows(`select 1 from public.profiles where id = '${uid(1)}'`)).toEqual([]);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${uid(1)}'`)).toEqual([]);
  });

  it('rejects null metadata and an email-less (anonymous-style) account', async () => {
    await failure(insertUser(uid(2), null));
    await failure(insertUser(uid(3), JSON.stringify({}), null));
    expect(await rows(`select count(*)::int as n from auth.users where id in ('${uid(2)}','${uid(3)}')`)).toEqual([{ n: 0 }]);
  });

  it.each([
    ['a fabricated version', { terms_version: 'made-up', privacy_version: P }],
    ['a fabricated privacy version', { terms_version: T, privacy_version: 'made-up' }],
    ['a well-formed but unknown version', { terms_version: '9999-01-01', privacy_version: '9999-01-01' }],
    ['a missing privacy version', { terms_version: T }],
    ['a missing terms version', { privacy_version: P }],
    ['numeric versions', { terms_version: 1, privacy_version: 1 }],
    ['array versions', { terms_version: [T], privacy_version: [P] }],
    ['object versions', { terms_version: { v: T }, privacy_version: { v: P } }],
    ['null versions', { terms_version: null, privacy_version: null }],
    ['a different case', { terms_version: T.toUpperCase(), privacy_version: P.toUpperCase() }],
    ['padded whitespace', { terms_version: ` ${T}`, privacy_version: `${P} ` }]
  ])('rejects %s', async (_label, acc) => {
    const e = await failure(insertUser(uid(10), meta(acc)));
    expect(e.message).toMatch(/Terms of Service|Privacy Policy/);
    expect(await rows(`select 1 from auth.users where id = '${uid(10)}'`)).toEqual([]);
  });

  it.each([
    ['a string', '"yes"'],
    ['an array', '[]'],
    ['true', 'true'],
    ['null', 'null']
  ])('rejects legal_acceptance that is %s', async (_l, raw) => {
    await failure(pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${uid(11)}', 'x@example.com', '{"legal_acceptance": ${raw}}')`));
    expect(await rows(`select 1 from auth.users where id = '${uid(11)}'`)).toEqual([]);
  });

  it('accepts the current versions, records them with the DATABASE clock and ignores any client timestamp', async () => {
    await insertUser(uid(20), meta({ terms_version: T, privacy_version: P, accepted_at_client: '2020-01-01T00:00:00Z', accepted_at: '2020-01-01T00:00:00Z' }));
    const r = await rows(`select terms_version, privacy_version, method, accepted_at from public.legal_acceptances where user_id = '${uid(20)}'`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ terms_version: T, privacy_version: P, method: 'signup' });
    expect((r[0].accepted_at as Date).getFullYear()).toBeGreaterThan(2024);
    expect(await rows(`select 1 from public.profiles where id = '${uid(20)}'`)).toHaveLength(1);
  });

  it('does not swallow errors: the trigger function has no exception handler', async () => {
    const [{ src }] = await rows("select pg_get_functiondef('public.handle_new_user_legal_acceptance()'::regprocedure) as src");
    expect(String(src)).toMatch(/raise exception/i);
    expect(String(src)).not.toMatch(/exception\s+when/i);
  });

  it('keeps the unique constraint and user isolation from the first migration', async () => {
    expect(await rows("select conname from pg_constraint where conname = 'legal_acceptances_one_per_version'")).toHaveLength(1);
    await expect(as('authenticated', () => pg.exec(`insert into public.legal_acceptances (user_id, terms_version, privacy_version, method) values ('${uid(20)}','${T}','${P}','signup')`))).rejects.toThrow(/permission denied/);
    await expect(as('anon', () => pg.exec('select * from public.legal_acceptances'))).rejects.toThrow(/permission denied/);
  });

  it('does not touch or back-fill accounts that already existed', async () => {
    expect(await rows(`select 1 from auth.users where id = '${EXISTING}'`)).toHaveLength(1);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${EXISTING}'`)).toEqual([]);
  });

  it('is not executable through the API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await canExec(role, 'public.handle_new_user_legal_acceptance()')).toBe(false);
      expect(await canExec(role, 'public.legal_signup_violation(jsonb)')).toBe(false);
      expect(await canExec(role, 'public.hook_before_user_created(jsonb)')).toBe(false);
    }
  });
});

describe('Layer B: Before User Created hook (called here as supabase_auth_admin)', () => {
  const callHook = (userMeta: unknown) =>
    as('supabase_auth_admin', async () => {
      const ev = JSON.stringify({ metadata: { name: 'before-user-created' }, user: { email: 'h@example.com', user_metadata: userMeta } });
      return (await rows(`select public.hook_before_user_created('${q(ev)}'::jsonb) as r`))[0].r as Record<string, unknown>;
    });

  it('allows a valid sign-up with the documented empty-object response', async () => {
    expect(await callHook({ full_name: 'X', legal_acceptance: { terms_version: T, privacy_version: P } })).toEqual({});
  });

  it.each([
    ['missing acceptance', {}],
    ['a fabricated version', { legal_acceptance: { terms_version: 'nope', privacy_version: P } }],
    ['a non-object payload', 'text']
  ])('rejects %s with the documented error shape (http_code 400 + message)', async (_l, m) => {
    const r = await callHook(m);
    expect(r).toEqual({ error: { http_code: 400, message: expect.stringMatching(/Terms of Service|Privacy Policy/) } });
  });

  it('rejects when the event has no user_metadata at all', async () => {
    const r = await as('supabase_auth_admin', async () => (await rows(`select public.hook_before_user_created('{"user":{}}'::jsonb) as r`))[0].r);
    expect(r).toMatchObject({ error: { http_code: 400 } });
  });

  it('is executable by supabase_auth_admin only (not anon, authenticated or public)', async () => {
    expect(await canExec('supabase_auth_admin', 'public.hook_before_user_created(jsonb)')).toBe(true);
    expect(await canExec('supabase_auth_admin', 'public.legal_signup_violation(jsonb)')).toBe(true);
    expect(await canExec('anon', 'public.hook_before_user_created(jsonb)')).toBe(false);
    expect(await canExec('authenticated', 'public.hook_before_user_created(jsonb)')).toBe(false);
    await expect(as('anon', () => pg.exec(`select public.hook_before_user_created('{}'::jsonb)`))).rejects.toThrow(/permission denied/);
  });

  it('is not SECURITY DEFINER (as the Supabase docs recommend) and pins its search_path', async () => {
    const r = await rows("select prosecdef, array_to_string(proconfig, ',') as cfg from pg_proc where proname = 'hook_before_user_created'");
    expect(r[0].prosecdef).toBe(false);
    expect(String(r[0].cfg)).toContain('search_path=""');
  });

  it('every SECURITY DEFINER function in this migration pins search_path', async () => {
    const r = await rows("select proname, array_to_string(proconfig, ',') as cfg from pg_proc where prosecdef and proname in ('legal_signup_violation','handle_new_user_legal_acceptance','acknowledge_legal_update')");
    expect(r).toHaveLength(3);
    for (const f of r) expect(String(f.cfg)).toContain('search_path=""');
  });
});

describe('existing-user acknowledgement now uses the allowlist (F2)', () => {
  const ack = (userId: string, t: string, p: string) =>
    as('authenticated', async () => {
      await pg.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
      return pg.exec(`select public.acknowledge_legal_update('${t}', '${p}')`);
    });

  it('rejects a well-formed but unknown version and records nothing', async () => {
    await expect(ack(EXISTING, 'fabricated-1', P)).rejects.toThrow(/Invalid policy version/);
    await expect(ack(EXISTING, T, 'fabricated-1')).rejects.toThrow(/Invalid policy version/);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${EXISTING}'`)).toEqual([]);
  });

  it('records the current versions for the caller only, once', async () => {
    await ack(EXISTING, T, P);
    await ack(EXISTING, T, P);
    expect(await rows(`select method from public.legal_acceptances where user_id = '${EXISTING}'`)).toEqual([{ method: 'existing_user_notice' }]);
  });

  it('still refuses unauthenticated callers', async () => {
    await pg.exec("select set_config('request.jwt.claim.sub', '', false)");
    await expect(as('authenticated', () => pg.exec(`select public.acknowledge_legal_update('${T}', '${P}')`))).rejects.toThrow(/Not authenticated/);
  });
});

describe('publishing a new policy version (documented release procedure)', () => {
  it('after the allowlist flips, the old version is rejected and the new one accepted', async () => {
    await pg.exec(`
      begin;
      update public.legal_policy_versions set is_current = false where policy = 'terms';
      insert into public.legal_policy_versions (policy, version, is_current) values ('terms', 'next-1', true);
      commit;
    `);
    await failure(insertUser(uid(30), good));
    await insertUser(uid(31), meta({ terms_version: 'next-1', privacy_version: P }));
    expect(await rows(`select terms_version from public.legal_acceptances where user_id = '${uid(31)}'`)).toEqual([{ terms_version: 'next-1' }]);
    // restore for the tests below
    await pg.exec(`
      begin;
      update public.legal_policy_versions set is_current = false where version = 'next-1';
      update public.legal_policy_versions set is_current = true where policy = 'terms' and version = '${T}';
      commit;
    `);
  });

  it('an empty allowlist fails CLOSED (no sign-ups) rather than open', async () => {
    await pg.exec('begin; update public.legal_policy_versions set is_current = false; commit;');
    await failure(insertUser(uid(32), good));
    await pg.exec(`update public.legal_policy_versions set is_current = true where version in ('${T}', '${P}')`);
    await insertUser(uid(33), good);
  });
});

describe('rollback script', () => {
  it('restores the previous behaviour, drops the new objects and keeps recorded acceptances', async () => {
    const before = (await rows('select count(*)::int as n from public.legal_acceptances'))[0].n as number;
    await pg.exec(ROLLBACK);
    expect(await rows("select 1 from pg_proc where proname in ('hook_before_user_created','legal_signup_violation')")).toEqual([]);
    expect(await rows("select to_regclass('public.legal_policy_versions') as t")).toEqual([{ t: null }]);
    expect((await rows('select count(*)::int as n from public.legal_acceptances'))[0].n).toBe(before);
    // Known and documented: the bypass is open again after rollback.
    await insertUser(uid(40), JSON.stringify({ full_name: 'X' }));
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${uid(40)}'`)).toEqual([]);
    // Re-applying the enforcement migration closes it again.
    await pg.exec(MIG_12);
    await failure(insertUser(uid(41), JSON.stringify({ full_name: 'X' })));
  });
});

describe('release sequence', () => {
  it('both migrations applied in ONE transaction leave no window in which the old, swallowing trigger is live', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(`
        create role anon nologin; create role authenticated nologin;
        create schema auth;
        create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        grant usage on schema public, auth to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
      `);
      await fresh.exec(`begin;\n${MIG_11}\n${MIG_12}\ncommit;`);
      await expect(fresh.exec("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'n@example.com', '{}')")).rejects.toThrow(/Terms of Service/);
      expect((await fresh.query<{ n: number }>('select count(*)::int as n from auth.users')).rows[0].n).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  it('the first migration alone is still the old behaviour (so it must never be released on its own)', () => {
    expect(MIG_11).toMatch(/exception when others then/);
  });
});
