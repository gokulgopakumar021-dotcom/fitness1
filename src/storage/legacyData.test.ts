import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_PPL_PLAN } from '../data/starterPlans';
import { db } from './db';
import { claimLegacyData, dismissLegacyPrompt, getClaimState, readLegacyWorkoutData, shouldPromptLegacyClaim } from './legacyData';
import { setStorageScope } from './storageScope';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const plan = (id: string, name: string) => ({ id, name, trainingSplit: 'Custom', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', isActive: false, days: [] });
const sess = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, dayName: 'D', date, startTime: `${date}T08:00:00.000Z`, endTime: `${date}T09:00:00.000Z`, status: 'completed' as const, exercises: [], ...extra });

/** Old, pre-account data: plain unscoped keys. */
function seedLegacy(plans: unknown[], sessions: unknown[]) {
  localStorage.setItem('ironlog_plans_v1', JSON.stringify(plans));
  localStorage.setItem('ironlog_sessions_v1', JSON.stringify(sessions));
}
const legacyRaw = () => [localStorage.getItem('ironlog_plans_v1'), localStorage.getItem('ironlog_sessions_v1')];

beforeEach(() => { localStorage.clear(); setStorageScope(A); });

describe('legacy data detection', () => {
  it('finds unnamespaced plans and sessions, ignoring untouched starters and demo sessions', () => {
    seedLegacy([{ ...STARTER_PPL_PLAN }, plan('lp1', 'Mine')], [sess('ls1', '2026-09-02'), sess('ls2', '2026-09-03'), sess('demo', '2026-09-04', { isDemo: true })]);
    const d = readLegacyWorkoutData();
    expect(d.plans.map((p) => p.id)).toEqual(['lp1']);
    expect(d.sessions.map((s) => s.id)).toEqual(['ls1', 'ls2']);
    expect(shouldPromptLegacyClaim()).toEqual({ plans: 1, sessions: 2 });
  });
  it('nothing to offer when there is no legacy data', () => {
    expect(shouldPromptLegacyClaim()).toBeNull();
    seedLegacy([{ ...STARTER_PPL_PLAN }], []);
    expect(shouldPromptLegacyClaim()).toBeNull();
  });
  it('is NEVER claimed automatically: a signed-in account does not see legacy records until the user imports', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02')]);
    expect(db.getSessions()).toEqual([]);
    expect(db.getPlans().map((p) => p.id)).not.toContain('lp1');
    shouldPromptLegacyClaim();
    expect(db.getSessions()).toEqual([]);
  });
  it('unreadable legacy data is reported, never imported, never modified', () => {
    localStorage.setItem('ironlog_sessions_v1', '{broken');
    expect(readLegacyWorkoutData().unreadable).toBe(true);
    const r = claimLegacyData();
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('ironlog_sessions_v1')).toBe('{broken');
    expect(getClaimState()).toBeNull();
  });
});

describe('explicit claim', () => {
  it('merges by id into the account, keeps the legacy records untouched, and stops prompting', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02'), sess('ls2', '2026-09-03')]);
    db.saveSessions([sess('already', '2026-11-01')]);
    const before = legacyRaw();
    const r = claimLegacyData();
    expect(r.ok).toBe(true);
    expect(r.sessions).toMatchObject({ found: 2, added: 2 });
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['already', 'ls1', 'ls2']);
    expect(db.getPlans().map((p) => p.id)).toContain('lp1');
    expect(legacyRaw()).toEqual(before); // original legacy records preserved byte-for-byte
    expect(getClaimState()).toMatchObject({ status: 'claimed', plans: 1, sessions: 2 });
    expect(shouldPromptLegacyClaim()).toBeNull();
  });
  it('is idempotent and never duplicates records', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02')]);
    claimLegacyData();
    const r2 = claimLegacyData();
    expect(r2.ok).toBe(true);
    expect(db.getSessions()).toHaveLength(1);
    expect(r2.sessions).toMatchObject({ added: 0, identical: 1 });
  });
  it('a record already in the account with different content is resolved by timestamp and the loser is archived', () => {
    db.saveSessions([sess('x', '2026-09-02', { notes: 'account copy', endTime: '2026-09-02T20:00:00.000Z' })]);
    seedLegacy([], [sess('x', '2026-09-02', { notes: 'legacy copy' })]);
    claimLegacyData();
    expect((db.getSessions().find((s) => s.id === 'x') as unknown as { notes: string }).notes).toBe('account copy');
  });
  it('if the import cannot be verified, the account is restored exactly and the legacy data stays', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02')]);
    db.saveSessions([sess('already', '2026-11-01')]);
    const accountBefore = localStorage.getItem(`ironlog_sessions_v1::u:${A}`);
    const legacyBefore = legacyRaw();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const r = claimLegacyData();
    spy.mockRestore();
    expect(r.ok).toBe(false);
    expect(localStorage.getItem(`ironlog_sessions_v1::u:${A}`)).toBe(accountBefore);
    expect(legacyRaw()).toEqual(legacyBefore);
    expect(getClaimState()).toBeNull(); // not marked claimed, so it can be offered again
  });
  it('"Not now" is remembered per account and imports nothing; another account is still offered the data', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02')]);
    dismissLegacyPrompt();
    expect(shouldPromptLegacyClaim()).toBeNull();
    expect(db.getSessions()).toEqual([]);
    setStorageScope(B);
    expect(shouldPromptLegacyClaim()).toEqual({ plans: 1, sessions: 1 });
  });
  it('claimed records are private to the claiming account', () => {
    seedLegacy([plan('lp1', 'Mine')], [sess('ls1', '2026-09-02')]);
    claimLegacyData();
    setStorageScope(B);
    expect(db.getSessions()).toEqual([]);
  });
});
