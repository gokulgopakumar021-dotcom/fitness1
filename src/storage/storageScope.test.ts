import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, DEFAULT_PROFILE } from './db';
import { SIGNED_OUT_SCOPE, getStorageScope, keysInCurrentScope, scopedKey, setStorageScope } from './storageScope';
import 'fake-indexeddb/auto';
import { BODY_SCAN_DB_NAME, saveScan, listScans, eraseAllBodyScanData } from './bodyScanStore';
import { acceptBodyScanConsent, getBodyScanConsent } from './bodyScanConsent';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
});
afterEach(() => setStorageScope(null));

describe('storage scope: per-account isolation', () => {
  it('uses the legacy key names when no scope is set (existing behaviour and data unchanged)', () => {
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Legacy' });
    expect(localStorage.getItem('ironlog_profile_v1')).toContain('Legacy');
    expect(scopedKey('ironlog_profile_v1')).toBe('ironlog_profile_v1');
  });

  it('lets one account never read another account\'s workouts, nutrition, body metrics, sleep, profile', () => {
    setStorageScope(A);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Alice' });
    db.saveSessions([{ id: 's1', dayName: 'A day', date: '2026-10-01', exercises: [], status: 'completed', startTime: '', notes: '' } as never]);
    db.saveNutritionLogs([{ id: 'n1', date: '2026-10-01', entries: [], waterMl: 1 } as never]);
    db.saveBodyMetrics([{ id: 'm1', date: '2026-10-01', weightKg: 80 } as never]);
    db.saveSleepLogs([{ id: 'sl1', date: '2026-10-01', hoursSlept: 8 } as never]);

    setStorageScope(B);
    expect(db.getProfile().name).toBe('');
    expect(db.getSessions()).toEqual([]);
    expect(db.getNutritionLogs()).toEqual([]);
    expect(db.getBodyMetrics()).toEqual([]);
    expect(db.getSleepLogs()).toEqual([]);

    setStorageScope(A);
    expect(db.getProfile().name).toBe('Alice');
    expect(db.getSessions()).toHaveLength(1);
  });

  it('keeps pre-existing unscoped data untouched and invisible to a signed-in account', () => {
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Legacy', sex: 'unspecified' });
    db.saveSessions([{ id: 'old', dayName: 'x', date: '2026-09-01', exercises: [], status: 'completed', startTime: '', notes: '' } as never]);
    const before = { p: localStorage.getItem('ironlog_profile_v1'), s: localStorage.getItem('ironlog_sessions_v1') };

    setStorageScope(A);
    expect(db.getSessions()).toEqual([]);
    expect(db.getProfile().name).toBe('');
    db.initProfileIfAbsent('Alice');
    db.saveSessions([]);
    db.resetAllData();

    setStorageScope(null);
    expect(localStorage.getItem('ironlog_profile_v1')).toBe(before.p);
    expect(localStorage.getItem('ironlog_sessions_v1')).toBe(before.s);
  });

  it('resetAllData only clears the active account scope', () => {
    setStorageScope(A);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Alice' });
    setStorageScope(B);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Bob' });
    localStorage.setItem('ironlog_athlete_theme', 'light'); // device preference, shared on purpose

    setStorageScope(A);
    db.resetAllData();
    expect(db.getProfile().name).toBe('');
    setStorageScope(B);
    expect(db.getProfile().name).toBe('Bob');
    expect(localStorage.getItem('ironlog_athlete_theme')).toBe('light');
  });

  it('keysInCurrentScope never returns another scope\'s keys', () => {
    localStorage.setItem('ironlog_x', '1');
    setStorageScope(A);
    localStorage.setItem(scopedKey('ironlog_x'), '2');
    expect(keysInCurrentScope()).toEqual([scopedKey('ironlog_x')]);
    setStorageScope(null);
    expect(keysInCurrentScope()).toEqual(['ironlog_x']);
  });

  it('rejects a malformed scope id', () => {
    expect(() => setStorageScope('../etc')).toThrow();
    expect(() => setStorageScope('user@example.com')).toThrow();
    expect(getStorageScope()).toBeNull();
  });

  it('the signed-out scope is an empty namespace that cannot reach legacy or account data', () => {
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Legacy' });
    setStorageScope(A);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Alice' });
    setStorageScope(SIGNED_OUT_SCOPE);
    expect(db.getProfile().name).toBe('');
    db.saveSessions([]); // a late stray write lands in the sandbox
    setStorageScope(A);
    expect(db.getProfile().name).toBe('Alice');
    setStorageScope(null);
    expect(db.getProfile().name).toBe('Legacy');
  });
});

describe('storage scope: demo mode safeguards', () => {
  it('demo data and the demo flag are per-account and never leak into another account or the legacy data', () => {
    setStorageScope(A);
    db.loadDemoData();
    expect(db.isDemoModeActive()).toBe(true);
    expect(db.getSessions().some((s) => s.isDemo)).toBe(true);

    setStorageScope(B);
    expect(db.isDemoModeActive()).toBe(false);
    expect(db.getSessions()).toEqual([]);
    expect(db.getBodyMetrics()).toEqual([]);

    setStorageScope(null);
    expect(db.isDemoModeActive()).toBe(false);
    expect(db.getSessions()).toEqual([]);
  });

  it('loading demo data never overwrites the account\'s real records', () => {
    setStorageScope(A);
    db.saveSessions([{ id: 'real', dayName: 'Real', date: '2026-10-02', exercises: [], status: 'completed', startTime: '', notes: '' } as never]);
    db.loadDemoData();
    expect(db.getSessions().some((s) => s.id === 'real' && !s.isDemo)).toBe(true);
    db.clearDemoData();
    expect(db.getSessions().map((s) => s.id)).toEqual(['real']);
  });
});

describe('profile initialisation', () => {
  it('seeds a new account profile once, with the account name, and never overwrites it afterwards', () => {
    setStorageScope(A);
    expect(db.initProfileIfAbsent('Alice')).toBe(true);
    expect(db.getProfile().name).toBe('Alice');
    db.saveProfile({ ...db.getProfile(), age: 41, sex: 'unspecified', dailyCalorieTarget: 1234 });
    expect(db.initProfileIfAbsent('Someone Else')).toBe(false);
    const p = db.getProfile();
    expect(p.name).toBe('Alice');
    expect(p.age).toBe(41);
    expect(p.sex).toBe('unspecified'); // not silently converted
    expect(p.dailyCalorieTarget).toBe(1234);
  });

  it('does not seed when a stored profile (even an unreadable one) already exists', () => {
    setStorageScope(A);
    localStorage.setItem(scopedKey('ironlog_profile_v1'), '{broken');
    expect(db.initProfileIfAbsent('Alice')).toBe(false);
    expect(localStorage.getItem(scopedKey('ironlog_profile_v1'))).toBe('{broken');
  });
});

describe('Body Scan storage (IndexedDB + consent) is scoped too', () => {
  const scan = (id: string) => ({
    id,
    date: '2026-10-01',
    createdAt: '2026-10-01T08:00:00.000Z',
    views: { front: { quality: { level: 'good', issues: [] } } },
    measurements: [{ key: 'waist_circumference', value: 82, unit: 'cm', source: 'manual' }]
  });

  it('keeps scans in a per-account database and the consent record per account', async () => {
    setStorageScope(A);
    acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false });
    await saveScan(scan('scan-a') as never);
    expect((await listScans()).map((x) => x.id)).toEqual(['scan-a']);
    expect((await indexedDB.databases()).map((d) => d.name)).toContain(`${BODY_SCAN_DB_NAME}::u:${A}`);

    setStorageScope(B);
    expect(getBodyScanConsent()).toBeNull();
    expect(await listScans()).toEqual([]);

    // Erasing B's data must not touch A's database.
    await eraseAllBodyScanData();
    setStorageScope(A);
    expect((await listScans()).map((x) => x.id)).toEqual(['scan-a']);
    expect(getBodyScanConsent()).not.toBeNull();
    await eraseAllBodyScanData();
  });
});
