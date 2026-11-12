import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeCurrentPolicies,
  buildSignupAcceptanceMetadata,
  currentPolicyVersions,
  fetchPolicyNoticeStatus,
  validateLegalAcceptance
} from './policyAcceptance';
import { LEGAL, POLICY_VERSION_PATTERN } from './legalConfig';

describe('policy acceptance helpers', () => {
  it('sign-up metadata carries both current versions and a timestamp, and nothing else personal', () => {
    const meta = buildSignupAcceptanceMetadata(new Date('2026-11-11T10:00:00.000Z'));
    expect(meta).toEqual({
      legal_acceptance: { terms_version: LEGAL.termsVersion, privacy_version: LEGAL.privacyVersion, accepted_at_client: '2026-11-11T10:00:00.000Z' }
    });
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
