import { describe, expect, it } from 'vitest';
import { getBodyScanGate } from './bodyScanEligibility';
import { BodyScanConsent } from '../types/bodyScan';

const consent: BodyScanConsent = {
  version: 1,
  ageConfirmed18Plus: true,
  limitsAcknowledged: true,
  photoStorage: false,
  acceptedAt: '2026-10-23T00:00:00.000Z',
};

describe('getBodyScanGate', () => {
  it('blocks profiles under 18 even with a consent record', () => {
    expect(getBodyScanGate(17, consent, 'declared').status).toBe('blocked_underage');
    expect(getBodyScanGate(0, null, 'declared').status).toBe('blocked_underage');
  });
  it('allows exactly 18', () => {
    expect(getBodyScanGate(18, consent, 'declared').status).toBe('ready');
  });
  it('requires consent even for adult profiles (profile age alone never grants access)', () => {
    expect(getBodyScanGate(30, null, 'declared').status).toBe('needs_consent');
  });
  it('requires the explicit 18+ confirmation inside the consent record', () => {
    expect(getBodyScanGate(30, { ...consent, ageConfirmed18Plus: false }, 'declared').status).toBe('needs_consent');
  });
  it('does not block on a missing or non-finite age, but still needs consent', () => {
    expect(getBodyScanGate(undefined, null, 'declared').status).toBe('needs_consent');
    expect(getBodyScanGate(Number.NaN, null, 'declared').status).toBe('needs_consent');
    expect(getBodyScanGate(Number.NaN, consent, 'declared').status).toBe('ready');
  });
  it.each(['loading', 'unknown', 'unavailable'] as const)(
    'FAILS CLOSED while the database eligibility is "%s": even a perfect profile and consent record do not open Body Scan',
    (state) => {
      expect(getBodyScanGate(30, consent, state).status).toBe('blocked_age_unconfirmed');
      expect(getBodyScanGate(undefined, null, state).status).toBe('blocked_age_unconfirmed');
    }
  );
  it('an adult-looking profile age and a stored consent can never replace the database declaration', () => {
    expect(getBodyScanGate(99, { ...consent, ageConfirmed18Plus: true, limitsAcknowledged: true }, 'unknown').status).toBe('blocked_age_unconfirmed');
  });
  it('the declaration alone is not enough: consent is still required, and a profile under 18 still blocks', () => {
    expect(getBodyScanGate(30, null, 'declared').status).toBe('needs_consent');
    expect(getBodyScanGate(17, consent, 'declared').status).toBe('blocked_underage');
  });
});
