// @vitest-environment node
import { execFile, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL `20261102045148_ai_usage_quota.sql` migration against a REAL PostgreSQL server and exercises
 * `consume_ai_quota` over many genuine, simultaneous connections (one `psql` process per call, so each call is its own
 * session and transaction).
 *
 * Configuration (mirrors the Redis tests):
 *  - PG_TEST_URL         superuser URL of a THROW-AWAY server, e.g. postgresql://postgres:pw@127.0.0.1:5432/postgres.
 *                        The test creates and drops its own scratch database, but it also creates the cluster-wide
 *                        roles `anon` and `authenticated` (the migration hard-codes them) if they are missing.
 *                        Do not point it at a shared or production server.
 *  - REQUIRE_PG_TESTS=1  unreachable server or missing `psql` becomes a FAILING test instead of a reported skip (CI).
 * Needs the `psql` client on PATH (PostgreSQL 16 was used for the recorded run).
 *
 * What this does NOT prove: it is not Supabase. Supabase's `auth.uid()` reads the same `request.jwt.claim.sub` setting
 * and PostgREST sets the role per request; both are simulated here. Behaviour through the real PostgREST layer and a
 * real JWT is covered by `npm run verify:quota`, not by this file.
 */
const STRICT = process.env.REQUIRE_PG_TESTS === '1';
const ADMIN_URL = process.env.PG_TEST_URL;
const MIGRATION = resolve(import.meta.dirname, '../../../supabase/migrations/20261102045148_ai_usage_quota.sql');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const run = promisify(execFile);

const PSQL_FLAGS = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];

/** Connection details go through PG* environment variables so a failing command never echoes a password into logs. */
function pgEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'
  };
}
const lastLine = (s: string) => s.trim().split('\n').filter(Boolean).pop() ?? '';

/** One psql process = one session. `-c` with several statements returns the output of the LAST one. */
async function psql(url: string, sql: string): Promise<string> {
  const { stdout } = await run('psql', [...PSQL_FLAGS, '-c', sql], { env: pgEnv(url), timeout: 60_000 });
  return lastLine(stdout);
}
async function psqlFile(url: string, file: string): Promise<void> {
  await run('psql', [...PSQL_FLAGS, '-f', file], { env: pgEnv(url), timeout: 60_000 });
}
/** Simulates PostgREST: sets the JWT subject claim and the request role, then runs `sql` in a fresh session. */
const asRole = (url: string, role: 'authenticated' | 'anon', sub: string | null, sql: string, tz?: string) =>
  psql(url, `${tz ? `set timezone = '${tz}'; ` : ''}set request.jwt.claim.sub = '${sub ?? ''}'; set role ${role}; ${sql}`);
const consume = (url: string, sub: string | null, bucket: string, limit: number, tz?: string) =>
  asRole(url, 'authenticated', sub, `select allowed::text || ',' || used::text from public.consume_ai_quota('${bucket}', ${limit});`, tz);

let available = false;
let reason = 'PG_TEST_URL is not set';
let scratchName = '';
let url = '';

if (ADMIN_URL) {
  const probe = spawnSync('psql', [...PSQL_FLAGS, '-c', 'select 1'], { encoding: 'utf8', timeout: 10_000, env: pgEnv(ADMIN_URL) });
  available = probe.status === 0;
  if (!available) reason = probe.error ? 'psql is not installed / not on PATH' : 'PG_TEST_URL is not reachable';
}

function suite(name: string, body: () => void) {
  if (!available && STRICT) {
    describe(name, () => {
      it(`REQUIRE_PG_TESTS=1 but PostgreSQL is not usable (${reason})`, () => {
        throw new Error(`PostgreSQL integration tests cannot run: ${reason}, and strict mode is on.`);
      });
    });
    return;
  }
  if (!available) console.warn(`[pg-tests] SKIPPED "${name}": ${reason} (set PG_TEST_URL; REQUIRE_PG_TESTS=1 makes this a failure).`);
  (available ? describe : describe.skip)(name, body);
}

suite('consume_ai_quota on real PostgreSQL (SEC-02, local database)', () => {
  beforeAll(async () => {
    scratchName = `ironlog_quota_${Math.random().toString(36).slice(2, 10)}`;
    await psql(ADMIN_URL!, `create database ${scratchName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${scratchName}`;
    url = u.toString();
    await psql(
      url,
      `do $$ begin
         if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
         if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
       end $$;
       create schema auth;
       create table auth.users (id uuid primary key);
       create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
       grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
       insert into auth.users values ('${A}'), ('${B}');
       create table public.test_results (who text, bucket text, allowed boolean, used int);
       grant insert on public.test_results to authenticated;`
    );
    await psqlFile(url, MIGRATION);
  }, 60_000);

  afterAll(async () => {
    if (scratchName) await psql(ADMIN_URL!, `drop database if exists ${scratchName} with (force)`).catch(() => {});
  });

  it('has the intended catalog state: RLS on, no policies, no client table privileges', async () => {
    expect(await psql(url, `select relrowsecurity::text from pg_class where oid = 'public.ai_usage_counters'::regclass`)).toBe('true');
    expect(await psql(url, `select count(*) from pg_policy where polrelid = 'public.ai_usage_counters'::regclass`)).toBe('0');
    for (const role of ['anon', 'authenticated']) {
      expect(await psql(url, `select has_table_privilege('${role}', 'public.ai_usage_counters', 'select,insert,update,delete')::text`)).toBe('false');
    }
  });

  it('is SECURITY DEFINER with an empty search_path, executable by authenticated only', async () => {
    expect(await psql(url, `select prosecdef::text from pg_proc where proname = 'consume_ai_quota'`)).toBe('true');
    expect(await psql(url, `select (proconfig = array['search_path=""'])::text from pg_proc where proname = 'consume_ai_quota'`)).toBe('true');
    const exec = (r: string) => psql(url, `select has_function_privilege('${r}', 'public.consume_ai_quota(text, integer)', 'execute')::text`);
    expect(await exec('authenticated')).toBe('true');
    expect(await exec('anon')).toBe('false');
    // grantee 0 = PUBLIC
    expect(await psql(url, `select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname = 'consume_ai_quota' and a.grantee = 0`)).toBe('0');
  });

  it('60 simultaneous connections against a limit of 10: exactly 10 allowed, counter values 1..10 each once', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, () => consume(url, A, 'conc', 10)));
    const allowed = results.filter((r) => r.startsWith('true'));
    expect(allowed.length).toBe(10);
    expect(results.filter((r) => r.startsWith('false')).length).toBe(50);
    expect(allowed.map((r) => Number(r.split(',')[1])).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await psql(url, `select used from public.ai_usage_counters where bucket = 'conc'`)).toBe('10');
  }, 90_000);

  it('keeps users and buckets independent under concurrent load', async () => {
    const combos = [
      [A, 'ix'],
      [A, 'iy'],
      [B, 'ix'],
      [B, 'iy']
    ] as const;
    const calls = combos.flatMap(([sub, bucket]) => Array.from({ length: 12 }, () => consume(url, sub, bucket, 5).then((r) => ({ sub, bucket, ok: r.startsWith('true') }))));
    const out = await Promise.all(calls);
    for (const [sub, bucket] of combos) {
      expect(out.filter((o) => o.sub === sub && o.bucket === bucket && o.ok).length).toBe(5);
    }
    expect(await psql(url, `select count(*) from public.ai_usage_counters where bucket in ('ix','iy') and used = 5`)).toBe('4');
  }, 90_000);

  it("a full counter from a previous UTC day does not block today, and is left untouched", async () => {
    await psql(url, `insert into public.ai_usage_counters values ('${A}', 'roll', (now() at time zone 'utc')::date - 1, 10)`);
    expect(await consume(url, A, 'roll', 10)).toBe('true,1');
    expect(await psql(url, `select used from public.ai_usage_counters where bucket = 'roll' and day = (now() at time zone 'utc')::date - 1`)).toBe('10');
  });

  it('keys the day on UTC regardless of the session time zone', async () => {
    await consume(url, A, 'tz', 10, 'Pacific/Kiritimati'); // UTC+14
    await consume(url, A, 'tz', 10, 'Etc/GMT+12'); // UTC-12
    expect(await psql(url, `select count(*) || ',' || count(distinct day) || ',' || (min(day) = (now() at time zone 'utc')::date)::text from public.ai_usage_counters where bucket = 'tz'`)).toBe('1,1,true');
    expect(await psql(url, `select used from public.ai_usage_counters where bucket = 'tz'`)).toBe('2');
  });

  it('limit 0 refuses and stores nothing; invalid arguments and anonymous callers are rejected with stable SQLSTATEs', async () => {
    expect(await consume(url, A, 'zero', 0)).toBe('false,0');
    expect(await psql(url, `select count(*) from public.ai_usage_counters where bucket = 'zero'`)).toBe('0');
    await expect(consume(url, null, 'b', 3)).rejects.toThrow(/28000/); // not authenticated
    await expect(consume(url, A, '', 3)).rejects.toThrow(/22023/);
    await expect(consume(url, A, 'b', -1)).rejects.toThrow(/22023/);
    await expect(consume(url, A, 'x'.repeat(65), 3)).rejects.toThrow(/22023/);
  });

  it('refuses the anon role and direct table access by clients', async () => {
    await expect(asRole(url, 'anon', A, `select * from public.consume_ai_quota('b', 3);`)).rejects.toThrow(/42501|permission denied/);
    await expect(asRole(url, 'authenticated', A, `select * from public.ai_usage_counters;`)).rejects.toThrow(/42501|permission denied/);
    await expect(asRole(url, 'authenticated', A, `update public.ai_usage_counters set used = 0;`)).rejects.toThrow(/42501|permission denied/);
  });
});
