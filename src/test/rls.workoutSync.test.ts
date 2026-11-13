// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migration files, in order, in an in-process Postgres. Simulated: the `auth` schema (users table +
 * auth.uid() reading request.jwt.claim.sub, as PostgREST sets it) and the Supabase roles. NOT covered: Supabase's own
 * auth service, PostgREST, or the live project (the live catalog was compared by hand when the migration was written).
 * PGlite is a single connection, so concurrent pushes are not exercised here.
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const PROFILES = read('20261027051824_auth_profiles.sql');
const DELETE_FN = read('20261030053401_delete_own_account.sql');
const SYNC = read('20261105071106_workout_cloud_sync.sql');
const HARDEN = read('20261105072929_workout_sync_no_client_delete.sql');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TABLES = ['workout_plans', 'workout_sessions', 'workout_active_sessions', 'workout_prefs'] as const;
const KINDS: Record<string, string> = { plans: 'workout_plans', sessions: 'workout_sessions', active_sessions: 'workout_active_sessions', prefs: 'workout_prefs' };
let pg: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'postgres', uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
type PushRow = { outcome: string; kind: string; id: string; data: Record<string, unknown>; version: string | number; deleted_at: string | null; client_updated_at: string; device_id: string | null };
const push = (kind: string, id: string, data: unknown, base: number, deleted = false, cua = '2026-11-01T10:00:00Z', dev = 'dev-1') =>
  pg.query<PushRow>('select * from public.push_workout_record($1,$2,$3::jsonb,$4::timestamptz,$5,$6,$7)', [kind, id, JSON.stringify(data), cua, base, deleted, dev]).then((r) => r.rows[0]);
const pull = (limit = 500, after?: { ts: string; kind: string; id: string }) =>
  pg.query<{ kind: string; id: string; version: string | number; deleted_at: string | null; updated_at: string }>(
    'select * from public.pull_workout_changes($1::timestamptz,$2,$3,$4)', [after?.ts ?? null, after?.kind ?? null, after?.id ?? null, limit]).then((r) => r.rows);
const count = async (table: string, uid?: string) =>
  (await pg.query<{ n: number }>(`select count(*)::int as n from public.${table}${uid ? ` where user_id='${uid}'` : ''}`)).rows[0].n;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(PROFILES);
  await pg.exec(DELETE_FN);
  await pg.exec(SYNC);
  await pg.exec(`insert into auth.users (id, email) values ('${A}','a@example.com'), ('${B}','b@example.com')`);
}, 60000);
afterAll(async () => { await pg.close(); });

describe('workout_cloud_sync migration (as originally applied: client DELETE still granted)', () => {
  it('is idempotent to re-apply', async () => {
    await expect(pg.exec(SYNC)).resolves.toBeDefined();
  });

  it('enables RLS on all four tables and grants nothing to anon', async () => {
    for (const t of TABLES) {
      expect((await pg.query<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid = 'public.${t}'::regclass`)).rows[0].r).toBe(true);
      const g = await pg.query(`select 1 from information_schema.role_table_grants where table_name='${t}' and grantee='anon'`);
      expect(g.rows).toHaveLength(0);
      await expect(as('anon', null, () => pg.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/i);
    }
  });

  it('anon cannot call the RPCs; the row-guard function is not callable by clients', async () => {
    await expect(as('anon', null, () => push('plans', 'p1', {}, 0))).rejects.toThrow(/permission denied/i);
    await expect(as('anon', null, () => pull())).rejects.toThrow(/permission denied/i);
    await expect(as('authenticated', A, () => pg.query('select public.workout_sync_row_guard()'))).rejects.toThrow(/permission denied/i);
  });

  it('an authenticated role with no user in the token is refused', async () => {
    await expect(as('authenticated', null, () => push('plans', 'p1', {}, 0))).rejects.toThrow(/not authenticated/);
    expect(await as('authenticated', null, () => pull())).toEqual([]);
  });

  it('rejects an unknown kind and invalid arguments', async () => {
    await expect(as('authenticated', A, () => push('nutrition', 'x', {}, 0))).rejects.toThrow(/invalid kind/);
    await expect(as('authenticated', A, () => push('plans', '', {}, 0))).rejects.toThrow(/invalid arguments/);
    await expect(as('authenticated', A, () => push('plans', 'x'.repeat(129), {}, 0))).rejects.toThrow(/invalid arguments/);
    await expect(as('authenticated', A, () => push('plans', 'x', {}, -1))).rejects.toThrow(/invalid arguments/);
  });

  it('a first push is applied at version 1 in the right table, owned by the caller', async () => {
    const r = await as('authenticated', A, () => push('plans', 'plan-1', { name: 'Mine' }, 0));
    expect(r.outcome).toBe('applied');
    expect(Number(r.version)).toBe(1);
    expect(r.data).toEqual({ name: 'Mine' });
    expect(await count('workout_plans', A)).toBe(1);
    for (const [kind, table] of Object.entries(KINDS)) {
      const id = `k-${kind}`;
      expect((await as('authenticated', A, () => push(kind, id, { kind }, 0))).outcome).toBe('applied');
      expect((await pg.query(`select 1 from public.${table} where user_id='${A}' and id='${id}'`)).rows).toHaveLength(1);
    }
  });

  it('replaying an identical push is idempotent: no duplicate, no version bump', async () => {
    await as('authenticated', A, () => push('sessions', 's-replay', { date: '2026-11-01', status: 'completed' }, 0));
    const again = await as('authenticated', A, () => push('sessions', 's-replay', { date: '2026-11-01', status: 'completed' }, 0));
    expect(again.outcome).toBe('applied');
    expect(Number(again.version)).toBe(1);
    expect((await pg.query(`select 1 from public.workout_sessions where user_id='${A}' and id='s-replay'`)).rows).toHaveLength(1);
  });

  it('a push from a stale base version is a conflict: nothing is written and the stored row is returned', async () => {
    await as('authenticated', A, () => push('plans', 'plan-c', { name: 'v1' }, 0));
    const ok = await as('authenticated', A, () => push('plans', 'plan-c', { name: 'v2 from device 1' }, 1, false, '2026-11-01T11:00:00Z', 'dev-1'));
    expect(ok.outcome).toBe('applied');
    expect(Number(ok.version)).toBe(2);
    const stale = await as('authenticated', A, () => push('plans', 'plan-c', { name: 'edit from device 2' }, 1, false, '2026-11-01T12:00:00Z', 'dev-2'));
    expect(stale.outcome).toBe('conflict');
    expect(stale.data).toEqual({ name: 'v2 from device 1' });
    expect(Number(stale.version)).toBe(2);
    expect((await pg.query<{ data: unknown }>(`select data from public.workout_plans where user_id='${A}' and id='plan-c'`)).rows[0].data).toEqual({ name: 'v2 from device 1' });
  });

  it('tombstones keep the row, drop the content, and a stale live push cannot resurrect it', async () => {
    await as('authenticated', A, () => push('sessions', 's-del', { date: '2026-11-02', status: 'completed', notes: 'x' }, 0));
    const del = await as('authenticated', A, () => push('sessions', 's-del', {}, 1, true));
    expect(del.outcome).toBe('applied');
    expect(del.deleted_at).not.toBeNull();
    expect(del.data).toEqual({});
    const stale = await as('authenticated', A, () => push('sessions', 's-del', { date: '2026-11-02', status: 'completed', notes: 'x' }, 1));
    expect(stale.outcome).toBe('conflict');
    expect(stale.deleted_at).not.toBeNull();
    expect(await count('workout_sessions', A)).toBeGreaterThan(0);
    const replay = await as('authenticated', A, () => push('sessions', 's-del', {}, 1, true));
    expect(replay.outcome).toBe('applied'); // identical delete replay
    expect(Number(replay.version)).toBe(2);
    const feed = await as('authenticated', A, () => pull());
    expect(feed.find((r) => r.kind === 'sessions' && r.id === 's-del')?.deleted_at).not.toBeNull();
  });

  it('an explicit re-create at the current version clears the tombstone', async () => {
    const r = await as('authenticated', A, () => push('sessions', 's-del', { date: '2026-11-02', status: 'completed' }, 2));
    expect(r.outcome).toBe('applied');
    expect(r.deleted_at).toBeNull();
    expect(Number(r.version)).toBe(3);
  });

  it('sessions expose generated columns derived from data', async () => {
    await as('authenticated', A, () => push('sessions', 's-gen', { date: '2026-11-03', status: 'completed', planId: 'plan-1' }, 0));
    await as('authenticated', A, () => push('sessions', 's-bad-date', { date: 'not-a-date', status: 'abandoned' }, 0));
    const rows = (await pg.query<{ id: string; session_date: string | null; status: string; plan_id: string | null }>(
      `select id, session_date, status, plan_id from public.workout_sessions where user_id='${A}' and id in ('s-gen','s-bad-date') order by id`)).rows;
    expect(rows).toEqual([
      { id: 's-bad-date', session_date: null, status: 'abandoned', plan_id: null },
      { id: 's-gen', session_date: '2026-11-03', status: 'completed', plan_id: 'plan-1' }
    ]);
  });

  it('pull is limited to the caller, ordered, and keyset-paginates without skipping or repeating', async () => {
    const all = await as('authenticated', A, () => pull(1000));
    expect(all.length).toBeGreaterThan(8);
    const seen: string[] = [];
    let after: { ts: string; kind: string; id: string } | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await as('authenticated', A, () => pull(3, after));
      if (page.length === 0) break;
      for (const r of page) seen.push(`${r.kind}/${r.id}`);
      const last = page[page.length - 1];
      after = { ts: new Date(last.updated_at).toISOString(), kind: last.kind, id: last.id };
    }
    expect(seen).toEqual(all.map((r) => `${r.kind}/${r.id}`));
    expect(new Set(seen).size).toBe(seen.length);
    expect(await as('authenticated', B, () => pull())).toEqual([]);
  });
});

describe('account isolation (RLS)', () => {
  it("B cannot read A's rows through the tables or the feed", async () => {
    for (const t of TABLES) {
      expect((await as('authenticated', B, () => pg.query(`select * from public.${t}`))).rows).toEqual([]);
    }
    expect(await as('authenticated', B, () => pull())).toEqual([]);
  });

  it("B cannot insert a row owned by A (explicit user_id)", async () => {
    for (const t of TABLES) {
      await expect(as('authenticated', B, () => pg.query(`insert into public.${t} (user_id, id) values ('${A}', 'spoof')`))).rejects.toThrow(/row-level security/i);
    }
  });

  it("B cannot update A's rows, or reassign a row to A", async () => {
    const upd = await as('authenticated', B, () => pg.query(`update public.workout_plans set data='{"hacked":true}'::jsonb where user_id='${A}' and id='plan-1'`));
    expect(upd.affectedRows).toBe(0);
    await as('authenticated', B, () => push('plans', 'b-plan', { name: 'B' }, 0));
    // The BEFORE-UPDATE identity guard fires ahead of the RLS WITH CHECK; either way the reassignment is refused.
    await expect(as('authenticated', B, () => pg.query(`update public.workout_plans set user_id='${A}' where id='b-plan'`))).rejects.toThrow(/identity is immutable|row-level security/i);
    expect((await pg.query(`select 1 from public.workout_plans where user_id='${B}' and id='b-plan'`)).rows).toHaveLength(1);
    expect((await pg.query<{ data: unknown }>(`select data from public.workout_plans where user_id='${A}' and id='plan-1'`)).rows[0].data).toEqual({ name: 'Mine' });
  });

  it('the same record id under two accounts is two independent rows', async () => {
    await as('authenticated', B, () => push('plans', 'plan-1', { name: 'Bob plan' }, 0));
    expect(await count('workout_plans', A)).toBeGreaterThan(0);
    expect((await pg.query<{ data: unknown }>(`select data from public.workout_plans where user_id='${B}' and id='plan-1'`)).rows[0].data).toEqual({ name: 'Bob plan' });
    expect((await pg.query<{ data: unknown }>(`select data from public.workout_plans where user_id='${A}' and id='plan-1'`)).rows[0].data).toEqual({ name: 'Mine' });
  });

  it('push derives ownership from the token; a client-supplied owner does not exist as an argument', async () => {
    const args = (await pg.query<{ a: string }>("select pg_get_function_identity_arguments(oid) as a from pg_proc where proname='push_workout_record'")).rows[0].a;
    expect(args).not.toMatch(/user/i);
  });
});

describe('row guard (server-controlled fields)', () => {
  it('identity is immutable and version/created_at cannot be forged by a direct write', async () => {
    await as('authenticated', A, () => push('prefs', 'active_plan', { id: 'plan-1' }, 0));
    await expect(as('authenticated', A, () => pg.query(`update public.workout_prefs set id='other' where id='active_plan'`))).rejects.toThrow(/identity is immutable/);
    const before = (await pg.query<{ version: string; created_at: string }>(`select version, created_at from public.workout_prefs where user_id='${A}' and id='active_plan'`)).rows[0];
    await as('authenticated', A, () => pg.query(`update public.workout_prefs set version=999, created_at='2000-01-01' where id='active_plan'`));
    const after = (await pg.query<{ version: string; created_at: string }>(`select version, created_at from public.workout_prefs where user_id='${A}' and id='active_plan'`)).rows[0];
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(after.created_at).toEqual(before.created_at);
  });

  it('a device clock far in the future is clamped to server time', async () => {
    const r = await as('authenticated', A, () => push('plans', 'plan-future', { name: 'f' }, 0, false, '2099-01-01T00:00:00Z'));
    expect(new Date(r.client_updated_at).getTime()).toBeLessThan(Date.now() + 2 * 86400_000);
  });

  it('refuses a record larger than 1 MB, a non-object payload, and an over-long device id', async () => {
    await expect(as('authenticated', A, () => push('sessions', 'huge', { blob: randomBytes(2_500_000).toString('base64') }, 0))).rejects.toThrow(/data_size|check constraint/i);
    await expect(as('authenticated', A, () => pg.query(`insert into public.workout_plans (id, data) values ('arr', '[]'::jsonb)`))).rejects.toThrow(/data_object|check constraint/i);
    await expect(as('authenticated', A, () => push('plans', 'dev', {}, 0, false, '2026-11-01T10:00:00Z', 'd'.repeat(65)))).rejects.toThrow(/device_length|check constraint/i);
  });
});

describe('workout_sync_no_client_delete migration', () => {
  it('before it: a client could hard-delete a tombstone (the gap it closes)', async () => {
    await as('authenticated', A, () => push('plans', 'gap', {}, 0));
    await as('authenticated', A, () => push('plans', 'gap', {}, 1, true));
    const d = await as('authenticated', A, () => pg.query(`delete from public.workout_plans where id='gap'`));
    expect(d.affectedRows).toBe(1);
  });

  it('applies, and is idempotent to re-apply', async () => {
    await pg.exec(HARDEN);
    await expect(pg.exec(HARDEN)).resolves.toBeDefined();
  });

  it('afterwards no sync table is deletable by clients and no delete policy remains', async () => {
    for (const t of TABLES) {
      await expect(as('authenticated', A, () => pg.query(`delete from public.${t}`))).rejects.toThrow(/permission denied/i);
      const p = await pg.query(`select 1 from pg_policies where tablename='${t}' and cmd='DELETE'`);
      expect(p.rows).toHaveLength(0);
    }
  });

  it('read, insert and update (and so push/pull) still work after it', async () => {
    const r = await as('authenticated', A, () => push('plans', 'after-harden', { name: 'still works' }, 0));
    expect(r.outcome).toBe('applied');
    const t = await as('authenticated', A, () => push('plans', 'after-harden', {}, 1, true));
    expect(t.deleted_at).not.toBeNull();
    expect((await as('authenticated', A, () => pull(1000))).some((x) => x.id === 'after-harden')).toBe(true);
  });
});

describe('account deletion', () => {
  it("delete_own_account() removes the caller's workout rows in every table and leaves other accounts alone", async () => {
    for (const k of Object.keys(KINDS)) await as('authenticated', B, () => push(k, `b-${k}`, { k }, 0));
    for (const t of TABLES) expect(await count(t, A)).toBeGreaterThan(0);
    await as('authenticated', A, () => pg.query('select public.delete_own_account()'));
    for (const t of TABLES) {
      expect(await count(t, A)).toBe(0);
      expect(await count(t, B)).toBeGreaterThan(0);
    }
  });
});
