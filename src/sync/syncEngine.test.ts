// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STARTER_PPL_PLAN } from '../data/starterPlans';
import { hashOf } from './hash';
import { LOCAL_KEYS } from './localAdapter';
import { createSyncEngine } from './syncEngine';
import { archiveConflict, loadConflicts, loadMeta, scopedKeyFor } from './syncMeta';
import { createPgRemote, Faults, MemoryStorage, withFaults } from './testutil';
import { RemoteAdapter } from './types';

/**
 * Engine tests against the REAL Stage 1 migrations in an in-process Postgres (PGlite): row-level security,
 * versioning, tombstones and idempotent replay are the production SQL, not a re-implementation.
 * Each "device" is its own in-memory localStorage + engine; two devices of one account share a user id.
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
  for (const f of ['20261027000000_auth_profiles.sql', '20261030000000_delete_own_account.sql',
    '20261105071106_workout_cloud_sync.sql', '20261105072929_workout_sync_no_client_delete.sql']) await pg.exec(read(f));
}, 60000);
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec(`reset role; truncate public.workout_plans, public.workout_sessions, public.workout_active_sessions, public.workout_prefs;
    delete from auth.users; insert into auth.users (id, email) values ('${A}','a@x.com'), ('${B}','b@x.com')`);
});

// ---------------------------------------------------------------- helpers
const plan = (id: string, name: string, updatedAt = '2026-11-01T10:00:00.000Z', extra: Record<string, unknown> = {}) =>
  ({ id, name, trainingSplit: 'Custom', createdAt: updatedAt, updatedAt, isActive: false, days: [], ...extra });
const session = (id: string, date = '2026-11-01', status = 'completed', extra: Record<string, unknown> = {}) =>
  ({ id, dayName: 'Push', date, startTime: `${date}T08:00:00.000Z`, endTime: `${date}T09:00:00.000Z`, status, exercises: [], ...extra });

interface Device {
  storage: MemoryStorage;
  engine: ReturnType<typeof createSyncEngine>;
  setNow(iso: string): void;
  put(kind: 'plans' | 'sessions', rec: Record<string, unknown>): void;
  remove(kind: 'plans' | 'sessions', id: string): void;
  list(kind: 'plans' | 'sessions'): Record<string, unknown>[];
  setActive(rec: Record<string, unknown> | null): void;
  active(): Record<string, unknown> | null;
  setPref(v: string | null): void;
  pref(): string | null;
  sync(): ReturnType<ReturnType<typeof createSyncEngine>['syncOnce']>;
}

function device(uid: string, deviceId: string, opts: { storage?: MemoryStorage; faults?: Faults; remote?: RemoteAdapter } = {}): Device {
  const storage = opts.storage ?? new MemoryStorage();
  let clock = '2026-11-02T00:00:00.000Z';
  const remote = opts.remote ?? withFaults(createPgRemote(pg, uid), opts.faults ?? {});
  const engine = createSyncEngine({ userId: uid, storage, remote, deviceId, now: () => new Date(clock) });
  const key = (k: string) => scopedKeyFor(k, uid);
  const base = (kind: 'plans' | 'sessions') => (kind === 'plans' ? LOCAL_KEYS.plans : LOCAL_KEYS.sessions);
  const read = (kind: 'plans' | 'sessions'): Record<string, unknown>[] => JSON.parse(storage.getItem(key(base(kind))) ?? '[]');
  return {
    storage, engine,
    setNow: (iso) => { clock = iso; },
    put(kind, rec) {
      const l = read(kind); const i = l.findIndex((x) => x.id === rec.id);
      if (i >= 0) l[i] = rec; else l.push(rec);
      storage.setItem(key(base(kind)), JSON.stringify(l));
    },
    remove(kind, id) { storage.setItem(key(base(kind)), JSON.stringify(read(kind).filter((x) => x.id !== id))); },
    list: read,
    setActive: (rec) => (rec ? storage.setItem(key(LOCAL_KEYS.activeSession), JSON.stringify(rec)) : storage.removeItem(key(LOCAL_KEYS.activeSession))),
    active: () => { const r = storage.getItem(key(LOCAL_KEYS.activeSession)); return r ? JSON.parse(r) : null; },
    setPref: (v) => (v === null ? storage.removeItem(key(LOCAL_KEYS.activePlanId)) : storage.setItem(key(LOCAL_KEYS.activePlanId), v)),
    pref: () => storage.getItem(key(LOCAL_KEYS.activePlanId)),
    sync: () => engine.syncOnce()
  };
}

const rows = async (table: string, uid = A) =>
  (await pg.query<{ id: string; version: number; deleted_at: string | null; data: Record<string, unknown> }>(
    `select id, version::int as version, deleted_at, data from public.${table} where user_id='${uid}' order by id`)).rows;
const ids = (l: Record<string, unknown>[]) => l.map((x) => x.id as string).sort();

// ---------------------------------------------------------------- tests
describe('upload and download', () => {
  it('uploads local plans, sessions and the active plan id to the cloud (local -> cloud)', async () => {
    const d = device(A, 'dev-a');
    d.put('plans', plan('p1', 'My Plan')); d.put('sessions', session('s1')); d.setPref('p1');
    const r = await d.sync();
    expect(r).toMatchObject({ ok: true, pending: 0, pushed: 3 });
    expect(ids(await rows('workout_plans'))).toEqual(['p1']);
    expect((await rows('workout_sessions'))[0].data).toMatchObject({ id: 's1', status: 'completed' });
    expect((await rows('workout_prefs'))[0].data).toEqual({ value: 'p1' });
    expect(d.engine.getMeta().lastSyncAt).toBe('2026-11-02T00:00:00.000Z');
  });

  it('downloads cloud records on a second device of the same account (cloud -> local) and keeps its own', async () => {
    const mobile = device(A, 'mobile'); const desktop = device(A, 'desktop');
    mobile.put('plans', plan('p-mobile', 'From mobile')); mobile.put('sessions', session('s-mobile'));
    await mobile.sync();
    desktop.put('plans', plan('p-desktop', 'From desktop'));
    await desktop.sync();
    expect(ids(desktop.list('plans'))).toEqual(['p-desktop', 'p-mobile']);
    expect(ids(desktop.list('sessions'))).toEqual(['s-mobile']);
    await mobile.sync();
    expect(ids(mobile.list('plans'))).toEqual(['p-desktop', 'p-mobile']); // desktop -> mobile too
  });

  it('merges per record: existing local history is preserved and never replaced by the cloud collection', async () => {
    const first = device(A, 'first'); first.put('sessions', session('old-1', '2026-10-01')); first.put('sessions', session('old-2', '2026-10-02'));
    await first.sync();
    const second = device(A, 'second'); second.put('sessions', session('local-only', '2026-10-03'));
    await second.sync();
    expect(ids(second.list('sessions'))).toEqual(['local-only', 'old-1', 'old-2']);
    expect(ids(await rows('workout_sessions'))).toEqual(['local-only', 'old-1', 'old-2']);
  });

  it('never touches unrelated local entries or the order of existing records', async () => {
    const d = device(A, 'd');
    d.put('plans', plan('keep-1', 'K1')); d.put('plans', plan('keep-2', 'K2'));
    const other = device(A, 'o'); other.put('plans', plan('remote-1', 'R1')); await other.sync();
    await d.sync();
    expect(d.list('plans').map((p) => p.id)).toEqual(['keep-1', 'keep-2', 'remote-1']);
  });
});

describe('account isolation', () => {
  it("a different account never receives, and cannot overwrite, another account's records", async () => {
    const a = device(A, 'a1'); a.put('plans', plan('shared-id', 'A secret plan')); a.put('sessions', session('sa'));
    await a.sync();
    const b = device(B, 'b1'); b.put('plans', plan('shared-id', 'B plan'));
    await b.sync();
    expect(b.list('plans').map((p) => p.name)).toEqual(['B plan']);
    expect(ids(b.list('sessions'))).toEqual([]);
    expect((await rows('workout_plans', A))[0].data).toMatchObject({ name: 'A secret plan' });
    expect((await rows('workout_plans', B))[0].data).toMatchObject({ name: 'B plan' });
  });

  it('local data and bookkeeping are namespaced per user id on one device', async () => {
    const storage = new MemoryStorage();
    const a = device(A, 'dev', { storage }); const b = device(B, 'dev', { storage });
    a.put('plans', plan('pa', 'A')); b.put('plans', plan('pb', 'B'));
    await a.sync(); await b.sync();
    expect(ids(a.list('plans'))).toEqual(['pa']);
    expect(ids(b.list('plans'))).toEqual(['pb']);
    expect(Object.keys(loadMeta(storage, A).records.plans)).toEqual(['pa']);
    expect(Object.keys(loadMeta(storage, B).records.plans)).toEqual(['pb']);
  });
});

describe('duplicates and idempotency', () => {
  it('repeated syncs create no duplicates and no version churn', async () => {
    const d = device(A, 'd'); d.put('plans', plan('p', 'P')); d.put('sessions', session('s'));
    await d.sync(); await d.sync(); await d.sync();
    expect(await rows('workout_plans')).toHaveLength(1);
    expect((await rows('workout_sessions'))[0].version).toBe(1);
    expect(d.list('plans')).toHaveLength(1);
  });

  it('a push whose response was lost is replayed safely on the next cycle (no duplicate, no conflict)', async () => {
    const d = device(A, 'd', { faults: { loseResponseOnPush: 1 } });
    d.put('sessions', session('s1'));
    const first = await d.sync();
    expect(first.ok).toBe(false); expect(first.error?.kind).toBe('transient');
    expect(await rows('workout_sessions')).toHaveLength(1); // the server did write it
    const retry = device(A, 'd', { storage: d.storage });   // same profile, healthy network
    const second = await retry.sync();
    expect(second).toMatchObject({ ok: true, pending: 0 });
    expect(await rows('workout_sessions')).toHaveLength(1);
    expect((await rows('workout_sessions'))[0].version).toBe(1);
  });

  it('the same content created independently on two devices is adopted, not duplicated or flagged', async () => {
    const x = device(A, 'x'); const y = device(A, 'y');
    const s = session('same-id'); x.put('sessions', s); y.put('sessions', s);
    await x.sync(); const r = await y.sync();
    expect(r.ok).toBe(true);
    expect(await rows('workout_sessions')).toHaveLength(1);
    expect(loadConflicts(y.storage, A)).toHaveLength(0);
  });
});

describe('deletions (tombstones)', () => {
  it('a delete propagates and the record does not come back', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('plans', plan('gone', 'Doomed')); await a.sync(); await b.sync();
    expect(ids(b.list('plans'))).toEqual(['gone']);
    a.remove('plans', 'gone'); await a.sync();
    expect((await rows('workout_plans'))[0].deleted_at).not.toBeNull();
    await b.sync();
    expect(b.list('plans')).toEqual([]);
    await a.sync(); await b.sync();
    expect(a.list('plans')).toEqual([]); expect(b.list('plans')).toEqual([]);
  });

  it('a device that was offline during the delete (with an unchanged copy) does not resurrect the record', async () => {
    const a = device(A, 'a'); const stale = device(A, 'stale');
    a.put('sessions', session('s-del')); await a.sync(); await stale.sync();
    a.remove('sessions', 's-del'); await a.sync();
    await stale.sync(); // unchanged stale copy: nothing to push, tombstone wins
    expect(stale.list('sessions')).toEqual([]);
    expect((await rows('workout_sessions'))[0].deleted_at).not.toBeNull();
  });

  it('a tombstone is never hard-deleted by the client and holds no record content', async () => {
    const a = device(A, 'a'); a.put('plans', plan('p', 'Secret name')); await a.sync();
    a.remove('plans', 'p'); await a.sync();
    expect((await rows('workout_plans'))[0].data).toEqual({});
  });

  it('wiped local storage re-downloads from the cloud instead of deleting it', async () => {
    const a = device(A, 'a'); a.put('plans', plan('p', 'P')); a.put('sessions', session('s')); await a.sync();
    const wiped = device(A, 'a'); // brand-new storage: no data AND no bookkeeping
    const r = await wiped.sync();
    expect(r.ok).toBe(true);
    expect(ids(wiped.list('plans'))).toEqual(['p']); expect(ids(wiped.list('sessions'))).toEqual(['s']);
    expect((await rows('workout_plans'))[0].deleted_at).toBeNull();
  });
});

describe('conflicts never silently destroy data', () => {
  it('edit vs edit: the later edit wins and the other plan version survives as a visible conflict copy', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('plans', plan('p', 'Original')); await a.sync(); await b.sync();
    a.setNow('2026-11-03T10:00:00.000Z'); a.put('plans', plan('p', 'Edited on A', '2026-11-03T10:00:00.000Z')); a.engine.reconcileLocal();
    b.setNow('2026-11-03T11:00:00.000Z'); b.put('plans', plan('p', 'Edited on B', '2026-11-03T11:00:00.000Z')); b.engine.reconcileLocal();
    await a.sync();           // A pushes first
    const r = await b.sync(); // B conflicts, and B is later
    expect(r.conflicts).toBeGreaterThan(0);
    expect((await rows('workout_plans')).find((p) => p.id === 'p')?.data).toMatchObject({ name: 'Edited on B' });
    const copies = b.list('plans').filter((p) => String(p.id).startsWith('p~c'));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ name: 'Edited on A (conflict copy)', isActive: false });
    await a.sync();
    expect(a.list('plans').find((p) => p.id === 'p')).toMatchObject({ name: 'Edited on B' });
    expect(a.list('plans').some((p) => p.name === 'Edited on A (conflict copy)')).toBe(true);
    expect(ids(a.list('plans'))).toEqual(ids(b.list('plans'))); // both devices converge
  });

  it('is deterministic: the earlier edit loses regardless of which device syncs first', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('plans', plan('p', 'Orig')); await a.sync(); await b.sync();
    a.setNow('2026-11-03T10:00:00.000Z'); a.put('plans', plan('p', 'A-later', '2026-11-03T12:00:00.000Z')); a.engine.reconcileLocal();
    b.setNow('2026-11-03T09:00:00.000Z'); b.put('plans', plan('p', 'B-earlier', '2026-11-03T09:00:00.000Z')); b.engine.reconcileLocal();
    await b.sync(); await a.sync(); await b.sync();
    expect((await rows('workout_plans')).find((p) => p.id === 'p')?.data).toMatchObject({ name: 'A-later' });
    expect(b.list('plans').find((p) => p.id === 'p')).toMatchObject({ name: 'A-later' });
  });

  it('session edit conflict: loser is archived, not dropped', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('sessions', session('s', '2026-10-30', 'completed', { notes: 'v0' })); await a.sync(); await b.sync();
    a.setNow('2026-11-03T10:00:00.000Z'); a.put('sessions', session('s', '2026-10-30', 'completed', { notes: 'from A' })); a.engine.reconcileLocal();
    b.setNow('2026-11-03T11:00:00.000Z'); b.put('sessions', session('s', '2026-10-30', 'completed', { notes: 'from B' })); b.engine.reconcileLocal();
    await a.sync(); await b.sync();
    expect((await rows('workout_sessions'))[0].data).toMatchObject({ notes: 'from B' });
    expect(loadConflicts(b.storage, A).some((c) => (c.data as { notes?: string } | null)?.notes === 'from A')).toBe(true);
  });

  it('edit after a remote delete keeps (resurrects) the edit; delete after an edit wins and archives the edit', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('plans', plan('p1', 'P1')); a.put('plans', plan('p2', 'P2')); await a.sync(); await b.sync();
    a.setNow('2026-11-03T10:00:00.000Z'); a.remove('plans', 'p1'); a.remove('plans', 'p2'); a.engine.reconcileLocal(); await a.sync();
    b.setNow('2026-11-03T12:00:00.000Z'); b.put('plans', plan('p1', 'P1 edited later', '2026-11-03T12:00:00.000Z')); b.engine.reconcileLocal();
    b.setNow('2026-11-03T09:00:00.000Z'); b.put('plans', plan('p2', 'P2 edited earlier', '2026-11-03T09:00:00.000Z')); b.engine.reconcileLocal();
    // p2 was reconciled with the earlier clock, p1 with the later one
    await b.sync();
    const cloud = await rows('workout_plans');
    expect(cloud.find((p) => p.id === 'p1')?.deleted_at).toBeNull();
    expect(cloud.find((p) => p.id === 'p2')?.deleted_at).not.toBeNull();
    expect(b.list('plans').map((p) => p.id)).toEqual(['p1']);
    expect(loadConflicts(b.storage, A).some((c) => c.id === 'p2' && (c.data as { name?: string } | null)?.name === 'P2 edited earlier')).toBe(true);
  });

  it('the conflict archive is capped', () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 80; i++) archiveConflict(s, A, { at: 'x', kind: 'plans', id: `p${i}`, reason: 'r', data: null });
    expect(loadConflicts(s, A)).toHaveLength(50);
    expect(loadConflicts(s, A).at(-1)?.id).toBe('p79');
  });
});

describe('offline, retry and interruption', () => {
  it('offline edits stay local and queued, then upload after reconnection without repeating anything', async () => {
    const storage = new MemoryStorage();
    const offline = device(A, 'd', { storage, faults: { offline: true } });
    offline.put('sessions', session('w1')); offline.put('sessions', session('w2', '2026-11-02'));
    const r = await offline.sync();
    expect(r).toMatchObject({ ok: false, pending: 2 }); expect(r.error?.kind).toBe('transient');
    expect(offline.list('sessions')).toHaveLength(2);
    expect(offline.engine.getMeta().lastSyncAt).toBeNull(); // not reported as synced
    const online = device(A, 'd', { storage });
    expect(await online.sync()).toMatchObject({ ok: true, pending: 0, pushed: 2 });
    expect(await rows('workout_sessions')).toHaveLength(2);
  });

  it('a device offline for days merges cleanly with what changed meanwhile', async () => {
    const a = device(A, 'a'); const away = device(A, 'away');
    a.put('plans', plan('shared', 'Shared')); await a.sync(); await away.sync();
    away.put('sessions', session('away-1', '2026-10-20')); // logged offline
    for (let i = 0; i < 5; i++) { a.put('sessions', session(`home-${i}`, `2026-10-2${i}`)); }
    await a.sync();
    await away.sync();
    expect(ids(away.list('sessions'))).toEqual(['away-1', 'home-0', 'home-1', 'home-2', 'home-3', 'home-4']);
    await a.sync();
    expect(ids(a.list('sessions'))).toContain('away-1');
  });

  it('an interrupted push resumes: already-uploaded records are not repeated, nothing is lost or duplicated', async () => {
    const storage = new MemoryStorage();
    const flaky = device(A, 'd', { storage, faults: { failPushesAfter: 3 } });
    for (let i = 0; i < 8; i++) flaky.put('sessions', session(`s${i}`, `2026-10-0${i + 1}`));
    const r1 = await flaky.sync();
    expect(r1).toMatchObject({ ok: false, pushed: 3, pending: 5 });
    expect(await rows('workout_sessions')).toHaveLength(3);
    const healthy = device(A, 'd', { storage });
    const r2 = await healthy.sync();
    expect(r2).toMatchObject({ ok: true, pushed: 5, pending: 0 });
    expect(await rows('workout_sessions')).toHaveLength(8);
    expect(healthy.list('sessions')).toHaveLength(8);
  });

  it('a transient pull failure changes nothing locally', async () => {
    const seed = device(A, 'seed'); seed.put('plans', plan('p', 'P')); await seed.sync();
    const d = device(A, 'd', { faults: { offline: true } });
    d.put('plans', plan('local', 'Local'));
    await d.sync();
    expect(ids(d.list('plans'))).toEqual(['local']);
  });

  it('survives the page being closed mid-sync: a fresh engine on the same storage finishes the job', async () => {
    const storage = new MemoryStorage();
    const d1 = device(A, 'd', { storage }); d1.put('plans', plan('p', 'P')); d1.engine.reconcileLocal();
    const d2 = device(A, 'd', { storage });
    expect(d2.engine.pendingCount()).toBe(1);
    expect((await d2.sync()).pending).toBe(0);
  });
});

describe('starter plans and legacy data', () => {
  it('untouched starter plans are never uploaded, so they cannot overwrite or pollute the cloud', async () => {
    const fresh = device(A, 'fresh');
    fresh.put('plans', { ...STARTER_PPL_PLAN } as unknown as Record<string, unknown>);
    const r = await fresh.sync();
    expect(r).toMatchObject({ ok: true, pushed: 0 });
    expect(await rows('workout_plans')).toHaveLength(0);
  });

  it("a new device that only has starters keeps them AND receives the user's real plans; the cloud plans are untouched", async () => {
    const real = device(A, 'real'); real.put('plans', plan('my-plan', 'Real work')); await real.sync();
    const fresh = device(A, 'fresh'); fresh.put('plans', { ...STARTER_PPL_PLAN } as unknown as Record<string, unknown>);
    await fresh.sync();
    expect(ids(fresh.list('plans'))).toEqual(['my-plan', STARTER_PPL_PLAN.id].sort());
    expect(ids(await rows('workout_plans'))).toEqual(['my-plan']);
  });

  it('a starter the user actually edited does sync, and a pristine starter elsewhere is replaced by it', async () => {
    const a = device(A, 'a'); a.put('plans', { ...STARTER_PPL_PLAN, name: 'My tuned PPL', updatedAt: '2026-11-02T00:00:00.000Z' } as unknown as Record<string, unknown>);
    await a.sync();
    expect(ids(await rows('workout_plans'))).toEqual([STARTER_PPL_PLAN.id]);
    const b = device(A, 'b'); b.put('plans', { ...STARTER_PPL_PLAN } as unknown as Record<string, unknown>);
    await b.sync();
    expect(b.list('plans').find((p) => p.id === STARTER_PPL_PLAN.id)).toMatchObject({ name: 'My tuned PPL' });
    expect(b.list('plans')).toHaveLength(1);
  });

  it('un-namespaced legacy localStorage is never read, uploaded or modified', async () => {
    const d = device(A, 'd');
    const legacy = JSON.stringify([plan('legacy-plan', 'Legacy')]);
    d.storage.setItem(LOCAL_KEYS.plans, legacy);
    d.storage.setItem(LOCAL_KEYS.sessions, JSON.stringify([session('legacy-s')]));
    d.put('plans', plan('scoped', 'Scoped'));
    await d.sync();
    expect(ids(await rows('workout_plans'))).toEqual(['scoped']);
    expect(await rows('workout_sessions')).toHaveLength(0);
    expect(d.storage.getItem(LOCAL_KEYS.plans)).toBe(legacy);
  });

  it('demo sessions are never uploaded', async () => {
    const d = device(A, 'd'); d.put('sessions', session('demo', '2026-11-01', 'completed', { isDemo: true })); d.put('sessions', session('real'));
    await d.sync();
    expect(ids(await rows('workout_sessions'))).toEqual(['real']);
  });
});

describe('active workout across devices', () => {
  it('an in-progress workout can be resumed on another device, and finishing it removes it everywhere', async () => {
    const phone = device(A, 'phone'); const laptop = device(A, 'laptop');
    phone.setActive(session('live', '2026-11-04', 'in_progress', { endTime: undefined })); await phone.sync(); await laptop.sync();
    expect(laptop.active()).toMatchObject({ id: 'live', status: 'in_progress' });
    phone.put('sessions', session('live', '2026-11-04', 'completed')); phone.setActive(null); await phone.sync();
    await laptop.sync();
    expect(laptop.active()).toBeNull();
    expect(laptop.list('sessions')).toHaveLength(1);
  });

  it('two different in-progress workouts: the later-started stays active, the other is kept in history as abandoned', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.setActive(session('w-early', '2026-11-04', 'in_progress', { startTime: '2026-11-04T07:00:00.000Z' })); await a.sync();
    b.setActive(session('w-late', '2026-11-04', 'in_progress', { startTime: '2026-11-04T09:00:00.000Z' }));
    await b.sync();
    expect(b.active()).toMatchObject({ id: 'w-late' });
    expect(b.list('sessions')).toEqual([expect.objectContaining({ id: 'w-early', status: 'abandoned' })]);
    await a.sync();
    expect(a.active()).toMatchObject({ id: 'w-late' });
    expect(a.list('sessions').map((s) => s.id)).toContain('w-early');
  });

  it('a stale active row for a workout that already finished on this device is ignored and cleaned up', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.setActive(session('w', '2026-11-04', 'in_progress')); await a.sync();
    b.put('sessions', session('w', '2026-11-04', 'completed')); // finished locally on b
    await b.sync();
    expect(b.active()).toBeNull();
    expect((await rows('workout_active_sessions'))[0].deleted_at).not.toBeNull();
  });
});

describe('active plan preference', () => {
  it('syncs between devices and clears when unset', async () => {
    const a = device(A, 'a'); const b = device(A, 'b');
    a.put('plans', plan('p', 'P')); a.setPref('p'); await a.sync(); await b.sync();
    expect(b.pref()).toBe('p');
    a.setPref(null); await a.sync(); await b.sync();
    expect(b.pref()).toBeNull();
  });
});

describe('safety', () => {
  it('unreadable local data pauses sync with a local error and uploads nothing, deletes nothing', async () => {
    const seed = device(A, 'seed'); seed.put('sessions', session('s1')); await seed.sync();
    const d = device(A, 'd', { storage: seed.storage });
    d.storage.setItem(scopedKeyFor(LOCAL_KEYS.sessions, A), '{not json');
    const r = await d.sync();
    expect(r.ok).toBe(false); expect(r.error?.kind).toBe('local');
    expect((await rows('workout_sessions'))[0].deleted_at).toBeNull();
    expect(d.storage.getItem(scopedKeyFor(LOCAL_KEYS.sessions, A))).toBe('{not json');
  });

  it('malformed remote records are rejected and never written into the working copy', async () => {
    await pg.exec(`reset role; insert into public.workout_plans (user_id, id, data) values ('${A}', 'bad', '{"id":"other"}'), ('${A}', 'bad2', '{"id":"bad2"}')`);
    const d = device(A, 'd'); const r = await d.sync();
    expect(r.rejected).toBe(2); expect(d.list('plans')).toEqual([]);
  });

  it('oversized records are skipped (not dropped) and reported as pending', async () => {
    const d = device(A, 'd'); d.put('sessions', session('big', '2026-11-01', 'completed', { notes: 'x'.repeat(950_000) })); d.put('sessions', session('ok'));
    const r = await d.sync();
    expect(ids(await rows('workout_sessions'))).toEqual(['ok']);
    expect(d.list('sessions')).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  it('single-flight: concurrent syncOnce calls share one cycle', async () => {
    const d = device(A, 'd'); d.put('plans', plan('p', 'P'));
    const [r1, r2] = await Promise.all([d.sync(), d.sync()]);
    expect(r1).toBe(r2);
    expect(await rows('workout_plans')).toHaveLength(1);
  });

  it('the first sync never overwrites either side: empty cloud, existing cloud, and both-different all merge', async () => {
    const empty = device(A, 'e1'); empty.put('plans', plan('x', 'X')); await empty.sync();
    expect(await rows('workout_plans')).toHaveLength(1);
    const diff = device(A, 'e2'); diff.put('plans', plan('y', 'Y')); await diff.sync();
    expect(ids(diff.list('plans'))).toEqual(['x', 'y']);
    expect(ids(await rows('workout_plans'))).toEqual(['x', 'y']);
    const noLocal = device(A, 'e3'); await noLocal.sync();
    expect(ids(noLocal.list('plans'))).toEqual(['x', 'y']);
  });
});

describe('account deletion', () => {
  it('deleting the account removes the cloud workout data; another account and a re-created account start clean', async () => {
    const a = device(A, 'a'); a.put('plans', plan('p', 'P')); a.put('sessions', session('s')); a.setActive(session('act', '2026-11-04', 'in_progress')); a.setPref('p');
    await a.sync();
    const b = device(B, 'b'); b.put('plans', plan('pb', 'PB')); await b.sync();
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${A}',false); set role authenticated`);
    await pg.query('select public.delete_own_account()');
    await pg.exec('reset role');
    for (const t of ['workout_plans', 'workout_sessions', 'workout_active_sessions', 'workout_prefs']) expect(await rows(t, A)).toHaveLength(0);
    expect(await rows('workout_plans', B)).toHaveLength(1);
  });
});

describe('bookkeeping', () => {
  it('scopedKeyFor matches the app’s real storage scoping', async () => {
    const { setStorageScope, scopedKey } = await import('../storage/storageScope');
    setStorageScope(A);
    expect(scopedKeyFor(LOCAL_KEYS.plans, A)).toBe(scopedKey(LOCAL_KEYS.plans));
    setStorageScope(null);
  });

  it('hashing ignores key order', () => {
    expect(hashOf({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(hashOf({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});
