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
    expect(getBodyScanGate(17, consent).status).toBe('blocked_underage');
    expect(getBodyScanGate(0, null).status).toBe('blocked_underage');
  });
  it('allows exactly 18', () => {
    expect(getBodyScanGate(18, consent).status).toBe('ready');
  });
  it('requires consent even for adult profiles (profile age alone never grants access)', () => {
    expect(getBodyScanGate(30, null).status).toBe('needs_consent');
  });
  it('requires the explicit 18+ confirmation inside the consent record', () => {
    expect(getBodyScanGate(30, { ...consent, ageConfirmed18Plus: false }).status).toBe('needs_consent');
  });
  it('does not block on a missing or non-finite age, but still needs consent', () => {
    expect(getBodyScanGate(undefined, null).status).toBe('needs_consent');
    expect(getBodyScanGate(Number.NaN, null).status).toBe('needs_consent');
    expect(getBodyScanGate(Number.NaN, consent).status).toBe('ready');
  });
});
