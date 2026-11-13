import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db';
import { setStorageScope } from '../storage/storageScope';
import { syncBeforeBulkDelete } from './bulkDelete';
import { createSyncController } from './syncController';
import { createSyncEngine } from './syncEngine';
import { loadMeta } from './syncMeta';
import { setActiveSync } from './syncRuntime';
import { createPgRemote, MemoryStorage, withFaults } from './testutil';
import type { RemoteAdapter } from './types';

/**
 * Stage 3 decisions 1: "Reset All Data" and "Delete Workout History" propagate as tombstones, offline deletions stay
 * queued, and deleted records never come back. Real Stage 1 SQL (PGlite) + the real db layer on THIS device
 * (jsdom localStorage); the second device is an independent in-memory profile of the same account.
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const f of ['20261027051824_auth_profiles.sql', '20261030053401_delete_own_account.sql',
    '20261105071106_workout_cloud_sync.sql', '20261105072929_workout_sync_no_client_delete.sql']) await pg.exec(read(f));
}, 60000);
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec(`reset role; truncate public.workout_plans, public.workout_sessions, public.workout_active_sessions, public.workout_prefs;
    delete from auth.users; insert into auth.users (id, email) values ('${U}','a@x.com')`);
  localStorage.clear();
  setStorageScope(U);
});
afterEach(() => setActiveSync(null));

const plan = (id: string, name: string) => ({ id, name, trainingSplit: 'Custom', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', isActive: false, days: [] }) as never;
const sess = (id: string, date: string, status = 'completed') => ({ id, dayName: 'Push', date, startTime: `${date}T08:00:00.000Z`, endTime: `${date}T09:00:00.000Z`, status, exercises: [] }) as never;

let clock = Date.parse('2026-11-05T10:00:00.000Z');
const tick = () => new Date((clock += 60_000));
const thisDevice = (remote: RemoteAdapter = createPgRemote(pg, U)) =>
  createSyncEngine({ userId: U, storage: localStorage, remote, deviceId: 'device-A', now: tick });
const otherDevice = () => {
  const storage = new MemoryStorage();
  const engine = createSyncEngine({ userId: U, storage, remote: createPgRemote(pg, U), deviceId: 'device-B', now: tick });
  const key = (b: string) => `${b}::u:${U}`;
  return {
    engine, storage,
    sessions: () => (JSON.parse(storage.getItem(key('ironlog_sessions_v1')) ?? '[]') as { id: string }[]).map((s) => s.id).sort(),
    plans: () => (JSON.parse(storage.getItem(key('ironlog_plans_v1')) ?? '[]') as { id: string }[]).map((s) => s.id).sort(),
    hasActive: () => storage.getItem(key('ironlog_active_session_v1')) !== null
  };
};
const cloud = async (table: string) =>
  (await pg.query<{ id: string; deleted_at: string | null }>(`select id, deleted_at from public.${table} order by id`)).rows;
const live = async (table: string) => (await cloud(table)).filter((r) => !r.deleted_at).map((r) => r.id);
const tombstoned = async (table: string) => (await cloud(table)).filter((r) => r.deleted_at).map((r) => r.id);

describe('Delete Workout History', () => {
  it('tombstones every session in the cloud, keeps plans, and the sessions never reappear on any device', async () => {
    db.savePlans([plan('p1', 'Mine')]);
    db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02')]);
    await thisDevice().syncOnce();
    const b = otherDevice();
    await b.engine.syncOnce();
    expect(b.sessions()).toEqual(['s1', 's2']);

    db.saveSessions([]); // what the "Delete workout history" action does
    const r = await thisDevice().syncOnce();
    expect(r).toMatchObject({ ok: true, pending: 0 });
    expect(await tombstoned('workout_sessions')).toEqual(['s1', 's2']);
    expect(await live('workout_plans')).toEqual(['p1']);

    await b.engine.syncOnce();
    expect(b.sessions()).toEqual([]);
    for (let i = 0; i < 3; i++) { await thisDevice().syncOnce(); await b.engine.syncOnce(); }
    expect(db.getSessions()).toEqual([]);
    expect(b.sessions()).toEqual([]);
    expect(await live('workout_sessions')).toEqual([]);
  });

  it('an offline deletion stays queued (across a restart) and is delivered when connectivity returns', async () => {
    db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02')]);
    await thisDevice().syncOnce();

    db.saveSessions([]);
    const offline = thisDevice(withFaults(createPgRemote(pg, U), { offline: true }));
    const down = await offline.syncOnce();
    expect(down.ok).toBe(false);
    expect(down.pending).toBe(2);
    expect(await live('workout_sessions')).toEqual(['s1', 's2']); // cloud untouched while offline

    // "app restart": a brand-new engine reads the persisted bookkeeping
    const restarted = thisDevice();
    expect(restarted.pendingCount()).toBe(2);
    const up = await restarted.syncOnce();
    expect(up).toMatchObject({ ok: true, pending: 0 });
    expect(await tombstoned('workout_sessions')).toEqual(['s1', 's2']);
    expect(db.getSessions()).toEqual([]); // and nothing was re-downloaded
  });

  it('a delete interrupted mid-push keeps the unsent tombstones pending and finishes later', async () => {
    db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02'), sess('s3', '2026-11-03')]);
    await thisDevice().syncOnce();
    db.saveSessions([]);
    const flaky = await thisDevice(withFaults(createPgRemote(pg, U), { failPushesAfter: 1 })).syncOnce();
    expect(flaky.ok).toBe(false);
    expect(flaky.pending).toBe(2);
    expect((await tombstoned('workout_sessions')).length).toBe(1);
    const done = await thisDevice().syncOnce();
    expect(done).toMatchObject({ ok: true, pending: 0 });
    expect(await tombstoned('workout_sessions')).toEqual(['s1', 's2', 's3']);
  });
});

describe('Reset All Data', () => {
  it('keeps the sync bookkeeping so every synced plan, session and active session is tombstoned (and nothing is re-downloaded)', async () => {
    db.savePlans([plan('p1', 'Mine'), plan('p2', 'Other')]);
    db.setActivePlanId('p1');
    db.saveSessions([sess('s1', '2026-11-01')]);
    db.saveActiveSession(sess('live', '2026-11-04', 'in_progress'));
    await thisDevice().syncOnce();
    const b = otherDevice();
    await b.engine.syncOnce();
    expect(b.plans()).toEqual(['p1', 'p2']);
    expect(b.hasActive()).toBe(true);

    db.resetAllData();
    expect(loadMeta(localStorage, U).records.plans.p1).toBeDefined(); // bookkeeping survived the wipe
    const r = await thisDevice().syncOnce();
    expect(r).toMatchObject({ ok: true, pending: 0 });
    expect(await tombstoned('workout_plans')).toEqual(['p1', 'p2']);
    expect(await tombstoned('workout_sessions')).toEqual(['s1']);
    expect(await tombstoned('workout_active_sessions')).toEqual(['live']);

    // local side: only the seeded starters remain, none of the user's records came back
    expect(db.getSessions()).toEqual([]);
    expect(db.getActiveSession()).toBeNull();
    expect(db.getPlans().every((p) => p.isStarter)).toBe(true);
    await b.engine.syncOnce();
    expect(b.plans()).toEqual([]);
    expect(b.sessions()).toEqual([]);
    expect(b.hasActive()).toBe(false);
    for (let i = 0; i < 3; i++) { await thisDevice().syncOnce(); await b.engine.syncOnce(); }
    expect(db.getSessions()).toEqual([]);
    expect(await live('workout_plans')).toEqual([]);
    expect(await live('workout_sessions')).toEqual([]);
  });

  it('an offline reset is queued across restarts and delivered later; starter plans are never uploaded', async () => {
    db.savePlans([plan('p1', 'Mine')]);
    db.saveSessions([sess('s1', '2026-11-01')]);
    await thisDevice().syncOnce();
    db.resetAllData();
    const down = await thisDevice(withFaults(createPgRemote(pg, U), { offline: true })).syncOnce();
    expect(down.ok).toBe(false);
    expect(await live('workout_plans')).toEqual(['p1']);
    const up = await thisDevice().syncOnce();
    expect(up).toMatchObject({ ok: true, pending: 0 });
    expect(await live('workout_plans')).toEqual([]);
    expect(await live('workout_sessions')).toEqual([]);
    expect((await cloud('workout_plans')).map((r) => r.id)).toEqual(['p1']); // no starter row was ever created
  });

  it('only the signed-in account is affected: another account on the same device keeps its data and bookkeeping', async () => {
    const V = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    setStorageScope(V);
    db.saveSessions([sess('v1', '2026-11-01')]);
    setStorageScope(U);
    db.saveSessions([sess('s1', '2026-11-01')]);
    db.resetAllData();
    setStorageScope(V);
    expect(db.getSessions().map((s) => s.id)).toEqual(['v1']);
  });
});

describe('a delete is never forgotten, even when the earlier upload was only half-confirmed', () => {
  it('push reached the server but the reply was lost, then the record is deleted: the tombstone is still sent', async () => {
    db.saveSessions([sess('s1', '2026-11-01')]);
    const lost = await thisDevice(withFaults(createPgRemote(pg, U), { loseResponseOnPush: 1 })).syncOnce();
    expect(lost.ok).toBe(false);
    expect(await live('workout_sessions')).toEqual(['s1']); // the server has it; this device never learned that

    db.saveSessions([]);
    const r = await thisDevice().syncOnce();
    expect(r).toMatchObject({ ok: true, pending: 0 });
    expect(await tombstoned('workout_sessions')).toEqual(['s1']);
    expect(db.getSessions()).toEqual([]);
  });
});

describe('deleting also removes records this device had not downloaded yet (pre-delete sync)', () => {
  it('Delete Workout History after a fresh sync tombstones sessions created on another device', async () => {
    const b = otherDevice();
    const keyB = (base: string) => `${base}::u:${U}`;
    b.storage.setItem(keyB('ironlog_sessions_v1'), JSON.stringify([sess('from-b', '2026-11-02')]));
    await b.engine.syncOnce();

    db.saveSessions([sess('mine', '2026-11-01')]);
    await thisDevice().syncOnce(); // meta now knows 'mine' and 'from-b'
    // another session appears on B afterwards and this device has not synced since
    b.storage.setItem(keyB('ironlog_sessions_v1'), JSON.stringify([sess('from-b', '2026-11-02'), sess('late-b', '2026-11-03')]));
    await b.engine.syncOnce();

    const controller = createSyncController({ engine: thisDevice(), isOnline: () => true });
    setActiveSync(controller);
    const pre = await syncBeforeBulkDelete(5000);
    expect(pre).toEqual({ cloudEnabled: true, cloudChecked: true });
    db.saveSessions([]);
    await thisDevice().syncOnce();
    expect(await live('workout_sessions')).toEqual([]);
    expect(await tombstoned('workout_sessions')).toEqual(['from-b', 'late-b', 'mine']);
  });

  it('offline, the pre-delete sync reports cloudChecked=false but never blocks the delete', async () => {
    db.saveSessions([sess('s1', '2026-11-01')]);
    const engine = thisDevice(withFaults(createPgRemote(pg, U), { offline: true }));
    setActiveSync(createSyncController({ engine, isOnline: () => true, maxAttempts: 1 }));
    const pre = await syncBeforeBulkDelete(5000);
    expect(pre.cloudEnabled).toBe(true);
    expect(pre.cloudChecked).toBe(false);
  });

  it('with no active sync (signed out / not configured) it is a no-op', async () => {
    expect(await syncBeforeBulkDelete()).toEqual({ cloudEnabled: false, cloudChecked: false });
  });
});
