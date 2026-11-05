import { beforeEach, describe, expect, it } from 'vitest';
import { STARTER_PPL_PLAN } from '../data/starterPlans';
import { db } from '../storage/db';
import { setStorageScope } from '../storage/storageScope';
import { createSyncEngine } from './syncEngine';
import { PullCursor, PushArgs, PushResult, RemoteAdapter, RemoteRow, SyncKind } from './types';
import { hashOf } from './hash';

/** Minimal in-memory cloud with the same contract as the Stage 1 RPCs (the SQL itself is covered in syncEngine.test.ts). */
function memoryCloud(): RemoteAdapter & { rows: Map<string, RemoteRow> } {
  const rows = new Map<string, RemoteRow>();
  let tick = 0;
  const stamp = () => `2026-11-05T10:00:00.${String(++tick).padStart(6, '0')}Z`;
  return {
    rows,
    async pull(after: PullCursor | null, limit: number) {
      return [...rows.values()]
        .filter((r) => !after || `${r.updated_at}|${r.kind}|${r.id}` > `${after.ts}|${after.kind}|${after.id}`)
        .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, limit);
    },
    async push(a: PushArgs): Promise<PushResult> {
      const key = `${a.kind}/${a.id}`;
      const cur = rows.get(key);
      const mk = (version: number): RemoteRow => ({
        kind: a.kind as SyncKind, id: a.id, data: a.deleted ? {} : a.data, client_updated_at: a.clientUpdatedAt, version,
        deleted_at: a.deleted ? stamp() : null, updated_at: stamp(), device_id: a.deviceId
      });
      if (!cur || cur.version === a.baseVersion) { const row = mk((cur?.version ?? 0) + 1); rows.set(key, row); return { outcome: 'applied', row }; }
      if ((cur.deleted_at !== null) === a.deleted && (a.deleted || hashOf(cur.data) === hashOf(a.data))) return { outcome: 'applied', row: cur };
      return { outcome: 'conflict', row: cur };
    }
  };
}

const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const plan = (id: string, name: string) => ({ id, name, trainingSplit: 'x', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', isActive: false, days: [] });
const sess = (id: string, date: string) => ({ id, dayName: 'D', date, startTime: `${date}T08:00:00.000Z`, status: 'completed' as const, exercises: [] });
const mkEngine = (remote: RemoteAdapter, now = '2026-11-05T12:00:00.000Z') =>
  createSyncEngine({ userId: U, storage: localStorage, remote, deviceId: 'test-dev', now: () => new Date(now) });

beforeEach(() => { localStorage.clear(); setStorageScope(U); });

describe('backup / restore and the app storage layer keep working with sync', () => {
  it('the JSON backup format is unchanged and the sync bookkeeping is not part of it', async () => {
    db.savePlans([plan('p1', 'Plan 1')]); db.saveSessions([sess('s1', '2026-11-01')]); db.setActivePlanId('p1');
    await mkEngine(memoryCloud()).syncOnce();
    const backup = JSON.parse(db.exportFullBackupJSON());
    expect(Object.keys(backup).sort()).toEqual(['activePlanId', 'app', 'bodyMetrics', 'customFoods', 'exportedAt', 'nutritionLogs', 'plans', 'profile', 'recommendations', 'sessions', 'sleepLogs', 'version']);
    expect(backup.sessions.map((s: { id: string }) => s.id)).toEqual(['s1']);
    expect(JSON.stringify(backup)).not.toContain('ironlog_sync');
  });

  it('restoring a backup after a device wipe re-uploads the restored records and nothing is lost', async () => {
    const cloud = memoryCloud();
    db.savePlans([plan('p1', 'Plan 1')]); db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02')]);
    await mkEngine(cloud).syncOnce();
    const backup = db.exportFullBackupJSON();
    localStorage.clear(); setStorageScope(U);            // wiped device: data AND bookkeeping gone
    expect(db.importBackupJSON(backup).success).toBe(true);
    const r = await mkEngine(cloud).syncOnce();
    expect(r.ok).toBe(true);
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect([...cloud.rows.values()].filter((x) => x.kind === 'sessions' && !x.deleted_at)).toHaveLength(2);
  });

  it('restoring a backup that contains a record deleted since resurrects it (a newer local action wins)', async () => {
    const cloud = memoryCloud();
    db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02')]);
    await mkEngine(cloud, '2026-11-05T10:00:00.000Z').syncOnce();
    const backup = db.exportFullBackupJSON();
    db.deleteSession('s2'); await mkEngine(cloud, '2026-11-05T11:00:00.000Z').syncOnce();
    expect(cloud.rows.get('sessions/s2')?.deleted_at).not.toBeNull();
    db.importBackupJSON(backup);
    await mkEngine(cloud, '2026-11-05T12:00:00.000Z').syncOnce();
    expect(cloud.rows.get('sessions/s2')?.deleted_at).toBeNull();
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it("PINNED BEHAVIOUR: restoring a backup replaces local collections (existing import semantics), so records absent from the backup are deleted in the cloud too", async () => {
    const cloud = memoryCloud();
    db.saveSessions([sess('s1', '2026-11-01')]);
    await mkEngine(cloud).syncOnce();
    const oldBackup = db.exportFullBackupJSON();
    db.addOrUpdateSession(sess('s-new', '2026-11-03')); await mkEngine(cloud).syncOnce();
    db.importBackupJSON(oldBackup); await mkEngine(cloud).syncOnce();
    expect(db.getSessions().map((s) => s.id)).toEqual(['s1']);
    expect(cloud.rows.get('sessions/s-new')?.deleted_at).not.toBeNull();
  });

  it('db.getPlans() seeding starter plans neither uploads them nor disturbs real plans', async () => {
    const cloud = memoryCloud();
    expect(db.getPlans().map((p) => p.id)).toContain(STARTER_PPL_PLAN.id); // seeds on empty
    const r = await mkEngine(cloud).syncOnce();
    expect(r).toMatchObject({ ok: true, pushed: 0 });
    expect(cloud.rows.size).toBe(0);
  });

  it('the app still reads synced data through db after a download', async () => {
    const cloud = memoryCloud();
    db.saveSessions([sess('s1', '2026-11-01')]); db.savePlans([plan('p1', 'P')]); db.setActivePlanId('p1');
    await mkEngine(cloud).syncOnce();
    localStorage.clear(); setStorageScope(U);
    await mkEngine(cloud).syncOnce();
    expect(db.getSessions().map((s) => s.id)).toEqual(['s1']);
    expect(db.getPlans().map((p) => p.id)).toEqual(['p1']);
    expect(db.getActivePlanId()).toBe('p1');
  });
});
