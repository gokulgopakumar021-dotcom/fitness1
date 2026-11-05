import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_PPL_PLAN } from '../data/starterPlans';
import { loadConflicts } from '../sync/syncMeta';
import { db, DEFAULT_PROFILE } from './db';
import { mergeById } from './backupMerge';
import { setStorageScope } from './storageScope';

const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const plan = (id: string, name: string, updatedAt = '2026-11-01T10:00:00.000Z') =>
  ({ id, name, trainingSplit: 'Custom', createdAt: updatedAt, updatedAt, isActive: false, days: [] }) as never;
const sess = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, dayName: 'D', date, startTime: `${date}T08:00:00.000Z`, endTime: `${date}T09:00:00.000Z`, status: 'completed', exercises: [], ...extra }) as never;

beforeEach(() => { localStorage.clear(); setStorageScope(U); });

describe('mergeById (pure)', () => {
  const opts = { kind: 'sessions' as const };
  it('adds unknown ids, keeps local-only records, and reports identical ones', () => {
    const local = [{ id: 'a', date: '2026-11-01' }, { id: 'only-local', date: '2026-11-02' }];
    const r = mergeById(local, [{ id: 'a', date: '2026-11-01' }, { id: 'b', date: '2026-11-03' }], opts);
    expect(r.merged.map((x) => x.id)).toEqual(['a', 'only-local', 'b']);
    expect(r.stats).toMatchObject({ added: 1, identical: 1, replaced: 0, keptLocal: 0 });
  });
  it('same id: the later timestamp wins, a tie keeps LOCAL, and the loser is always returned', () => {
    const older = { id: 'a', date: '2026-11-01', startTime: '2026-11-01T08:00:00.000Z', note: 'old' };
    const newer = { id: 'a', date: '2026-11-01', startTime: '2026-11-01T08:00:00.000Z', endTime: '2026-11-01T10:00:00.000Z', note: 'new' };
    const takes = mergeById([older], [newer], opts);
    expect((takes.merged[0] as { note: string }).note).toBe('new');
    expect(takes.losers[0].data).toEqual(older);
    const keeps = mergeById([newer], [older], opts);
    expect((keeps.merged[0] as { note: string }).note).toBe('new');
    expect(keeps.losers[0].data).toEqual(older);
    const tie = mergeById([{ ...older, note: 'L' }], [{ ...older, note: 'I' }], opts);
    expect((tie.merged[0] as { note: string }).note).toBe('L');
    expect(tie.stats.keptLocal).toBe(1);
  });
  it('skips unusable entries (no id, wrong shape, demo) and never throws', () => {
    const r = mergeById<{ id: string }>([], [null, 5, 'x', { name: 'no id' }, { id: '' }, { id: 'd', isDemo: true }, { id: 'ok' }], opts);
    expect(r.merged.map((x) => x.id)).toEqual(['ok']);
    expect(r.stats.skipped).toBe(6);
  });
  it('an untouched starter plan has no user data: any different incoming version wins without a conflict', () => {
    const edited = { ...STARTER_PPL_PLAN, name: 'My PPL' };
    const r = mergeById([{ ...STARTER_PPL_PLAN }], [edited], { kind: 'plans' });
    expect(r.merged[0].id).toBe(STARTER_PPL_PLAN.id);
    expect((r.merged[0] as unknown as { name: string }).name).toBe('My PPL');
    expect(r.losers).toEqual([]);
  });
});

describe('Restore from backup now MERGES by record id (Stage 3 decision 2)', () => {
  it('adds missing records and keeps records that are absent from the backup', () => {
    db.savePlans([plan('p-local', 'Local only')]);
    db.saveSessions([sess('s-local', '2026-11-03')]);
    const backup = JSON.stringify({ plans: [plan('p-backup', 'From backup')], sessions: [sess('s-backup', '2026-10-01')] });
    const r = db.importBackupJSON(backup);
    expect(r.success).toBe(true);
    expect(r.summary?.sessions.added).toBe(1);
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['s-backup', 's-local']);
    expect(db.getPlans().map((p) => p.id)).toEqual(expect.arrayContaining(['p-local', 'p-backup']));
  });

  it('a newer local record beats an older backup copy, and the backup copy is archived (nothing silently lost)', () => {
    db.saveSessions([sess('s1', '2026-11-01', { notes: 'edited after the backup', endTime: '2026-11-01T12:00:00.000Z' })]);
    const r = db.importBackupJSON(JSON.stringify({ sessions: [sess('s1', '2026-11-01', { notes: 'old copy' })] }));
    expect(r.success).toBe(true);
    expect((db.getSessions()[0] as unknown as { notes: string }).notes).toBe('edited after the backup');
    const archived = loadConflicts(localStorage, U);
    expect(archived).toHaveLength(1);
    expect((archived[0].data as { notes: string }).notes).toBe('old copy');
  });

  it('a newer backup record replaces the older local one and the local copy is archived', () => {
    db.saveSessions([sess('s1', '2026-11-01', { notes: 'old local' })]);
    db.importBackupJSON(JSON.stringify({ sessions: [sess('s1', '2026-11-01', { notes: 'newer', endTime: '2026-11-01T15:00:00.000Z' })] }));
    expect((db.getSessions()[0] as unknown as { notes: string }).notes).toBe('newer');
    expect((loadConflicts(localStorage, U)[0].data as { notes: string }).notes).toBe('old local');
  });

  it('restoring the same backup twice changes nothing the second time (idempotent)', () => {
    const backup = JSON.stringify({ plans: [plan('p1', 'P')], sessions: [sess('s1', '2026-11-01')] });
    db.importBackupJSON(backup);
    const first = localStorage.getItem(`ironlog_sessions_v1::u:${U}`);
    const r = db.importBackupJSON(backup);
    expect(localStorage.getItem(`ironlog_sessions_v1::u:${U}`)).toBe(first);
    expect(r.summary?.sessions).toMatchObject({ added: 0, replaced: 0, keptLocal: 0 });
  });

  it('does not overwrite the profile of an account that is already set up; fills a fresh one', () => {
    const backup = JSON.stringify({ profile: { ...DEFAULT_PROFILE, name: 'From backup', onboardingCompleted: true } });
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Current', onboardingCompleted: true });
    db.importBackupJSON(backup);
    expect(db.getProfile().name).toBe('Current');
    localStorage.clear();
    expect(db.importBackupJSON(backup).summary?.profileApplied).toBe(true);
    expect(db.getProfile().name).toBe('From backup');
  });

  it('keeps the current active plan when it still exists', () => {
    db.savePlans([plan('p1', 'One'), plan('p2', 'Two')]);
    db.setActivePlanId('p1');
    db.importBackupJSON(JSON.stringify({ activePlanId: 'p2' }));
    expect(db.getActivePlanId()).toBe('p1');
  });

  it('rejects garbage without touching anything', () => {
    db.saveSessions([sess('s1', '2026-11-01')]);
    for (const bad of ['not json', 'null', '[]', '"x"']) expect(db.importBackupJSON(bad).success).toBe(false);
    expect(db.getSessions()).toHaveLength(1);
  });

  it('if the merged data cannot be written, nothing is half-applied and success is NOT reported', () => {
    db.saveSessions([sess('s1', '2026-11-01')]);
    const before = localStorage.getItem(`ironlog_sessions_v1::u:${U}`);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const r = db.importBackupJSON(JSON.stringify({ sessions: [sess('s2', '2026-11-02')] }));
    spy.mockRestore();
    expect(r.success).toBe(false);
    expect(localStorage.getItem(`ironlog_sessions_v1::u:${U}`)).toBe(before);
  });

  it('explicit replace mode makes the collections match the backup exactly (the destructive path)', () => {
    db.saveSessions([sess('s-local', '2026-11-03')]);
    expect(db.importBackupJSON(JSON.stringify({ sessions: [sess('s-backup', '2026-10-01')] }), { mode: 'replace' }).success).toBe(true);
    expect(db.getSessions().map((s) => s.id)).toEqual(['s-backup']);
  });

  it('a backup exported by this app restores into a wiped account and round-trips', () => {
    db.savePlans([plan('p1', 'P')]); db.saveSessions([sess('s1', '2026-11-01'), sess('s2', '2026-11-02')]);
    const backup = db.exportFullBackupJSON();
    localStorage.clear();
    expect(db.importBackupJSON(backup).success).toBe(true);
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(db.getPlans().map((p) => p.id)).toContain('p1');
  });
});
