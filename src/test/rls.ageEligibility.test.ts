// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL } from '../legal/legalConfig';

/**
 * Stage 2D / Stage 2: platform-wide 18+ eligibility (self-declaration, no date of birth). Runs the REAL migrations
 * 20261111000000, 20261112000000 and 20261112100000 in an in-process Postgres (same harness as rls.legalEnforcement.test.ts).
 *
 * Simulated: the `auth` schema (a bare auth.users table), auth.uid() and the Supabase roles, including supabase_auth_admin.
 * NOT VERIFIED until tested on a Supabase preview branch: that the hosted Auth service calls the hook, which sign-up paths
 * invoke it, and how Auth words a trigger failure. No migration has been applied to any Supabase project.
 */
const read = (p: string) => readFileSync(resolve(import.meta.dirname, '../../supabase', p), 'utf8');
const MIG_11 = read('migrations/20261111000000_legal_acceptances.sql');
const MIG_12 = read('migrations/20261112000000_legal_acceptance_enforcement.sql');
const MIG_13 = read('migrations/20261112100000_age_eligibility.sql');
const ROLLBACK = read('manual/rollback_age_eligibility.sql');

const T = LEGAL.termsVersion;
const P = LEGAL.privacyVersion;
const legal = { terms_version: T, privacy_version: P };
const meta = (o: Record<string, unknown>) => JSON.stringify({ full_name: 'X', ...o });
const good = meta({ legal_acceptance: legal, age_declaration: { adult_18_plus: true } });

let pg: PGlite;
const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;
const q = (s: string) => s.replace(/'/g, "''");
const insertUser = (id: string, rawMeta: string | null, email: string | null = `${id.slice(-4)}@example.com`) =>
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
async function as<R>(role: string, fn: () => Promise<R>): Promise<R> {
  await pg.exec(`reset role; set role ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
  }
}
const asUser = <R>(userId: string, fn: () => Promise<R>) =>
  as('authenticated', async () => {
    await pg.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
    return fn();
  });
const canExec = async (role: string, fn: string) => (await rows(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;

const EXISTING = uid(900);
const OTHER = uid(901);

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
    create table public.profiles (id uuid primary key);
    create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as
      $$ begin insert into public.profiles (id) values (new.id); return new; end; $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  `);
  // Accounts that pre-date every migration.
  await insertUser(EXISTING, JSON.stringify({ full_name: 'Old' }), 'old@example.com');
  await insertUser(OTHER, JSON.stringify({ full_name: 'Other' }), 'other@example.com');
  await pg.exec(MIG_11);
  await pg.exec(MIG_12);
  await pg.exec(MIG_13);
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('age_declarations table', () => {
  it('stores no date of birth and no age number', async () => {
    const cols = (await rows("select column_name from information_schema.columns where table_schema='public' and table_name='age_declarations' order by 1")).map((r) => r.column_name);
    expect(cols).toEqual(['adult_18_plus', 'declared_at', 'method', 'terms_version', 'user_id']);
  });

  it('has RLS on, SELECT-own only, and no write access for any API role', async () => {
    expect((await rows("select relrowsecurity as on from pg_class where relname = 'age_declarations'"))[0].on).toBe(true);
    const pol = await rows("select cmd, roles::text as roles from pg_policies where tablename = 'age_declarations'");
    expect(pol).toHaveLength(1);
    expect(pol[0].cmd).toBe('SELECT');
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['insert', 'update', 'delete']) {
        expect((await rows(`select has_table_privilege('${role}', 'public.age_declarations', '${priv}') as ok`))[0].ok).toBe(false);
      }
    }
    expect((await rows("select has_table_privilege('anon', 'public.age_declarations', 'select') as ok"))[0].ok).toBe(false);
    expect((await rows("select has_table_privilege('authenticated', 'public.age_declarations', 'select') as ok"))[0].ok).toBe(true);
  });

  it('can never hold a negative declaration', async () => {
    await expect(pg.exec(`insert into public.age_declarations (user_id, adult_18_plus, terms_version, method) values ('${EXISTING}', false, '${T}', 'signup')`)).rejects.toThrow(/age_declarations_positive_only/);
  });

  it('is idempotent: the migration can run twice without error or data loss', async () => {
    await pg.exec(MIG_13);
    expect((await rows("select count(*)::int as n from pg_trigger where tgname = 'on_auth_user_created_age_declaration'"))[0].n).toBe(1);
  });

  it('does not back-fill accounts that existed before (they stay age-unknown)', async () => {
    expect(await rows(`select 1 from public.age_declarations where user_id in ('${EXISTING}', '${OTHER}')`)).toEqual([]);
  });
});

describe('Layer A: strict trigger rejects every sign-up without the 18+ declaration', () => {
  it.each([
    ['no age_declaration key', meta({ legal_acceptance: legal })],
    ['adult_18_plus false', meta({ legal_acceptance: legal, age_declaration: { adult_18_plus: false } })],
    ['the STRING "true"', meta({ legal_acceptance: legal, age_declaration: { adult_18_plus: 'true' } })],
    ['the number 1', meta({ legal_acceptance: legal, age_declaration: { adult_18_plus: 1 } })],
    ['age_declaration as a bare boolean', meta({ legal_acceptance: legal, age_declaration: true })],
    ['an empty age_declaration object', meta({ legal_acceptance: legal, age_declaration: {} })],
    ['a stated age instead of the declaration', meta({ legal_acceptance: legal, age_declaration: { age: 30 } })]
  ])('rejects %s and leaves no user, profile, acceptance or declaration row', async (_l, m) => {
    const id = uid(10 + Math.floor(Math.random() * 1000));
    const e = await failure(insertUser(id, m));
    expect(e.message).toMatch(/18 years of age or older/);
    expect(e.code).toBe('23514');
    expect(await rows(`select 1 from auth.users where id = '${id}'`)).toEqual([]);
    expect(await rows(`select 1 from public.profiles where id = '${id}'`)).toEqual([]);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${id}'`)).toEqual([]);
    expect(await rows(`select 1 from public.age_declarations where user_id = '${id}'`)).toEqual([]);
  });

  it('still rejects missing legal acceptance even when the age declaration is present', async () => {
    const e = await failure(insertUser(uid(2), meta({ age_declaration: { adult_18_plus: true } })));
    expect(e.message).toMatch(/Terms of Service/);
    expect(await rows(`select 1 from public.age_declarations where user_id = '${uid(2)}'`)).toEqual([]);
  });

  it('rejects null metadata and an anonymous-style (email-less) account', async () => {
    await failure(insertUser(uid(3), null));
    await failure(insertUser(uid(4), JSON.stringify({}), null));
  });

  it('accepts a complete sign-up and records the declaration with the DATABASE clock and the SERVER-chosen version', async () => {
    await insertUser(uid(20), good);
    const r = await rows(`select terms_version, method, adult_18_plus, declared_at > now() - interval '1 minute' as fresh from public.age_declarations where user_id = '${uid(20)}'`);
    expect(r).toEqual([{ terms_version: T, method: 'signup', adult_18_plus: true, fresh: true }]);
    expect(await rows(`select 1 from public.legal_acceptances where user_id = '${uid(20)}'`)).toHaveLength(1);
  });

  it('ignores a client-supplied timestamp or version inside age_declaration', async () => {
    await insertUser(uid(21), meta({ legal_acceptance: legal, age_declaration: { adult_18_plus: true, declared_at: '2001-01-01T00:00:00Z', terms_version: 'forged-1' } }));
    const r = await rows(`select terms_version, declared_at > now() - interval '1 minute' as fresh from public.age_declarations where user_id = '${uid(21)}'`);
    expect(r).toEqual([{ terms_version: T, fresh: true }]);
  });

  it('does not swallow errors: the trigger function has no exception handler', async () => {
    const def = String((await rows("select pg_get_functiondef(oid) as d from pg_proc where proname = 'handle_new_user_age_declaration'"))[0].d);
    expect(def).not.toMatch(/exception\s+when/i);
  });

  it('is not executable through the API roles', async () => {
    for (const role of ['anon', 'authenticated']) expect(await canExec(role, 'public.handle_new_user_age_declaration()')).toBe(false);
  });
});

describe('Layer B: the Before User Created hook now checks the age declaration too', () => {
  const callHook = (userMeta: unknown) =>
    as('supabase_auth_admin', async () => {
      const ev = JSON.stringify({ metadata: { name: 'before-user-created' }, user: { email: 'h@example.com', user_metadata: userMeta } });
      return (await rows(`select public.hook_before_user_created('${q(ev)}'::jsonb) as r`))[0].r as Record<string, unknown>;
    });

  it('allows a complete sign-up with the documented empty-object response', async () => {
    expect(await callHook({ legal_acceptance: legal, age_declaration: { adult_18_plus: true } })).toEqual({});
  });

  it.each([
    ['no age declaration', { legal_acceptance: legal }],
    ['false', { legal_acceptance: legal, age_declaration: { adult_18_plus: false } }],
    ['the string "true"', { legal_acceptance: legal, age_declaration: { adult_18_plus: 'true' } }]
  ])('rejects %s with http_code 400 and the age message', async (_l, m) => {
    expect(await callHook(m)).toEqual({ error: { http_code: 400, message: expect.stringMatching(/18 years of age or older/) } });
  });

  it('reports the legal-acceptance problem first when both are missing', async () => {
    expect(await callHook({})).toEqual({ error: { http_code: 400, message: expect.stringMatching(/Terms of Service/) } });
  });

  it('keeps the Stage 1 grants: supabase_auth_admin only', async () => {
    expect(await canExec('supabase_auth_admin', 'public.hook_before_user_created(jsonb)')).toBe(true);
    expect(await canExec('supabase_auth_admin', 'public.age_signup_violation(jsonb)')).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      expect(await canExec(role, 'public.hook_before_user_created(jsonb)')).toBe(false);
      expect(await canExec(role, 'public.age_signup_violation(jsonb)')).toBe(false);
    }
  });
});

describe('existing users: declare for themselves only, read their own status', () => {
  const status = (userId: string) => asUser(userId, async () => (await rows('select public.get_my_age_eligibility() as s'))[0].s);

  it('every pre-existing account starts as "unknown"', async () => {
    expect(await status(EXISTING)).toBe('unknown');
    expect(await status(OTHER)).toBe('unknown');
  });

  it('declaring flips only the caller, and is idempotent', async () => {
    await asUser(EXISTING, () => pg.exec('select public.declare_adult_18_plus()'));
    await asUser(EXISTING, () => pg.exec('select public.declare_adult_18_plus()'));
    expect(await status(EXISTING)).toBe('declared');
    expect(await status(OTHER)).toBe('unknown');
    expect(await rows(`select method, terms_version from public.age_declarations where user_id = '${EXISTING}'`)).toEqual([{ method: 'existing_user_gate', terms_version: T }]);
  });

  it('takes no argument, so nobody can declare on behalf of someone else', async () => {
    const r = await rows("select pronargs from pg_proc where proname = 'declare_adult_18_plus'");
    expect(r[0].pronargs).toBe(0);
  });

  it('a signed-in user sees only their own declaration row', async () => {
    const seen = await asUser(EXISTING, () => rows('select user_id from public.age_declarations'));
    expect(seen).toEqual([{ user_id: EXISTING }]);
  });

  it('clients cannot write, change or delete declarations directly', async () => {
    await expect(asUser(OTHER, () => pg.exec(`insert into public.age_declarations (user_id, terms_version, method) values ('${OTHER}', '${T}', 'signup')`))).rejects.toThrow(/permission denied/);
    await expect(asUser(EXISTING, () => pg.exec(`update public.age_declarations set method = 'signup'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(EXISTING, () => pg.exec('delete from public.age_declarations'))).rejects.toThrow(/permission denied/);
  });

  it('refuses unauthenticated and anonymous callers', async () => {
    await pg.exec("select set_config('request.jwt.claim.sub', '', false)");
    await expect(as('authenticated', () => pg.exec('select public.declare_adult_18_plus()'))).rejects.toThrow(/Not authenticated/);
    await expect(as('authenticated', () => pg.exec('select public.get_my_age_eligibility()'))).rejects.toThrow(/Not authenticated/);
    await expect(as('anon', () => pg.exec('select public.declare_adult_18_plus()'))).rejects.toThrow(/permission denied/);
    await expect(as('anon', () => pg.exec('select public.get_my_age_eligibility()'))).rejects.toThrow(/permission denied/);
  });

  it('every SECURITY DEFINER function in this migration pins search_path', async () => {
    const r = await rows("select proname, array_to_string(proconfig, ',') as cfg from pg_proc where prosecdef and proname in ('handle_new_user_age_declaration','declare_adult_18_plus','get_my_age_eligibility')");
    expect(r).toHaveLength(3);
    for (const f of r) expect(String(f.cfg)).toContain('search_path=""');
  });

  it('an empty allowlist fails CLOSED for declarations (no row is written)', async () => {
    await pg.exec('update public.legal_policy_versions set is_current = false');
    try {
      await expect(asUser(OTHER, () => pg.exec('select public.declare_adult_18_plus()'))).rejects.toThrow(/No current policy version/);
    } finally {
      await pg.exec(`update public.legal_policy_versions set is_current = true where version = '${T}'`);
    }
    expect(await rows(`select 1 from public.age_declarations where user_id = '${OTHER}'`)).toEqual([]);
  });

  it('deleting the account removes its declaration (data minimisation)', async () => {
    await insertUser(uid(30), good);
    await pg.exec(`delete from auth.users where id = '${uid(30)}'`);
    expect(await rows(`select 1 from public.age_declarations where user_id = '${uid(30)}'`)).toEqual([]);
  });
});

describe('rollback script', () => {
  it('drops the age objects, restores the legal-only hook and keeps the legal records', async () => {
    const before = (await rows('select count(*)::int as n from public.legal_acceptances'))[0].n as number;
    await pg.exec(ROLLBACK);
    expect(await rows("select 1 from pg_proc where proname in ('declare_adult_18_plus','get_my_age_eligibility','handle_new_user_age_declaration','age_signup_violation')")).toEqual([]);
    expect(await rows("select 1 from pg_tables where tablename = 'age_declarations'")).toEqual([]);
    expect((await rows('select count(*)::int as n from public.legal_acceptances'))[0].n).toBe(before);
    // The legal-only hook still rejects a missing legal acceptance and no longer asks about age.
    const ok = await as('supabase_auth_admin', async () => (await rows(`select public.hook_before_user_created('${q(JSON.stringify({ user: { user_metadata: { legal_acceptance: legal } } }))}'::jsonb) as r`))[0].r);
    expect(ok).toEqual({});
    // Strict legal enforcement from the previous migration is untouched.
    await failure(insertUser(uid(40), meta({ age_declaration: { adult_18_plus: true } })));
  });
});

describe('release sequence', () => {
  it('all three migrations in ONE transaction on a fresh database enforce both checks from the first sign-up', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(`
        create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
        create schema auth;
        create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema public, auth to anon, authenticated, supabase_auth_admin;
      `);
      await fresh.exec(`begin;\n${MIG_11}\n${MIG_12}\n${MIG_13}\ncommit;`);
      await expect(fresh.exec(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'a@b.c', '{"legal_acceptance":{"terms_version":"${T}","privacy_version":"${P}"}}')`)).rejects.toThrow(/18 years/);
      await fresh.exec(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'a@b.c', '${q(good)}')`);
      expect((await fresh.query<{ n: number }>('select count(*)::int as n from public.age_declarations')).rows[0].n).toBe(1);
    } finally {
      await fresh.close();
    }
  }, 60000);
});
