import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeCurrentPolicies,
  isPolicyNoticeSnoozed,
  POLICY_NOTICE_SNOOZE_KEY,
  snoozePolicyNotice,
  buildSignupAcceptanceMetadata,
  currentPolicyVersions,
  fetchPolicyNoticeStatus,
  validateLegalAcceptance
} from './policyAcceptance';
import { LEGAL, POLICY_VERSION_PATTERN } from './legalConfig';

describe('policy acceptance helpers', () => {
  it('sign-up metadata carries both current versions and NO client timestamp or anything else personal', () => {
    const meta = buildSignupAcceptanceMetadata();
    expect(meta).toEqual({
      legal_acceptance: { terms_version: LEGAL.termsVersion, privacy_version: LEGAL.privacyVersion }
    });
    expect(JSON.stringify(meta)).not.toContain('accepted_at');
    const v = currentPolicyVersions();
    expect(v.termsVersion).toMatch(POLICY_VERSION_PATTERN);
    expect(v.privacyVersion).toMatch(POLICY_VERSION_PATTERN);
  });

  it('validateLegalAcceptance requires an explicit true', () => {
    expect(validateLegalAcceptance(false)).toMatch(/Terms of Service/);
    expect(validateLegalAcceptance(true)).toBeNull();
  });

  it('fetchPolicyNoticeStatus: current / needs_notice / unknown (never throws)', async () => {
    const mk = (res: unknown, reject = false) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => (reject ? Promise.reject(new Error('x')) : Promise.resolve(res)) }) }) }) }) }) as any;
    expect(await fetchPolicyNoticeStatus(mk({ data: [{ id: 1 }], error: null }))).toBe('current');
    expect(await fetchPolicyNoticeStatus(mk({ data: [], error: null }))).toBe('needs_notice');
    expect(await fetchPolicyNoticeStatus(mk({ data: null, error: { message: 'no table' } }))).toBe('unknown');
    expect(await fetchPolicyNoticeStatus(mk(undefined, true))).toBe('unknown');
  });

  it('acknowledgeCurrentPolicies returns false on rpc error or exception, true on success', async () => {
    const ok = { rpc: vi.fn().mockResolvedValue({ error: null }) } as any;
    expect(await acknowledgeCurrentPolicies(ok)).toBe(true);
    expect(ok.rpc).toHaveBeenCalledWith('acknowledge_legal_update', { p_terms_version: LEGAL.termsVersion, p_privacy_version: LEGAL.privacyVersion });
    expect(await acknowledgeCurrentPolicies({ rpc: vi.fn().mockResolvedValue({ error: { message: 'x' } }) } as any)).toBe(false);
    expect(await acknowledgeCurrentPolicies({ rpc: vi.fn().mockRejectedValue(new Error('x')) } as any)).toBe(false);
  });
});

describe('"Remind me later" snooze is session-only (Stage 3: the reason sessionStorage is allow-listed in the IL-03 guard)', () => {
  const V = { termsVersion: '2026-11-draft-1', privacyVersion: '2026-11-draft-1' };
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('is not snoozed by default, and snoozing is remembered for the same user and versions', () => {
    expect(isPolicyNoticeSnoozed('user-1', V)).toBe(false);
    snoozePolicyNotice('user-1', V);
    expect(isPolicyNoticeSnoozed('user-1', V)).toBe(true);
  });

  it('stores only the user id and the two version labels, in sessionStorage and NOT in localStorage', () => {
    snoozePolicyNotice('user-1', V);
    expect(sessionStorage.getItem(POLICY_NOTICE_SNOOZE_KEY)).toBe('user-1|2026-11-draft-1|2026-11-draft-1');
    expect(localStorage.length).toBe(0);
  });

  it('belongs to one user and one version pair: another user, or a newer policy version, is NOT snoozed', () => {
    snoozePolicyNotice('user-1', V);
    expect(isPolicyNoticeSnoozed('user-2', V)).toBe(false);
    expect(isPolicyNoticeSnoozed('user-1', { ...V, termsVersion: '2026-12-v2' })).toBe(false);
    expect(isPolicyNoticeSnoozed('user-1', { ...V, privacyVersion: '2026-12-v2' })).toBe(false);
  });

  it('returns in a new session: once sessionStorage is gone, the notice is shown again', () => {
    snoozePolicyNotice('user-1', V);
    sessionStorage.clear(); // what closing the tab or browser does
    expect(isPolicyNoticeSnoozed('user-1', V)).toBe(false);
  });

  it('never throws when storage is unavailable (private mode): the notice simply shows again', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => snoozePolicyNotice('user-1', V)).not.toThrow();
    expect(isPolicyNoticeSnoozed('user-1', V)).toBe(false);
  });
});
