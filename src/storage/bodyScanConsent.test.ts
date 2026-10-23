import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptBodyScanConsent,
  BODY_SCAN_CONSENT_KEY,
  clearBodyScanConsent,
  getBodyScanConsent,
  setPhotoStorageConsent,
} from './bodyScanConsent';

beforeEach(() => localStorage.clear());

describe('body scan consent', () => {
  it('has no consent by default', () => {
    expect(getBodyScanConsent()).toBeNull();
  });

  it('stores photos only when explicitly enabled (default off)', () => {
    const c = acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false });
    expect(c.photoStorage).toBe(false);
    expect(getBodyScanConsent()?.photoStorage).toBe(false);
  });

  it('refuses to record consent without both confirmations', () => {
    expect(() =>
      acceptBodyScanConsent({ ageConfirmed18Plus: false, limitsAcknowledged: true, photoStorage: false })
    ).toThrow();
    expect(() =>
      acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: false, photoStorage: false })
    ).toThrow();
    expect(getBodyScanConsent()).toBeNull();
  });

  it('toggles photo storage only after consent exists', () => {
    expect(() => setPhotoStorageConsent(true)).toThrow();
    acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false });
    expect(setPhotoStorageConsent(true).photoStorage).toBe(true);
    expect(setPhotoStorageConsent(false).photoStorage).toBe(false);
  });

  it('treats corrupt or tampered records as no consent / no photo storage', () => {
    localStorage.setItem(BODY_SCAN_CONSENT_KEY, '{not json');
    expect(getBodyScanConsent()).toBeNull();
    localStorage.setItem(BODY_SCAN_CONSENT_KEY, JSON.stringify({ version: 1, ageConfirmed18Plus: false, limitsAcknowledged: true }));
    expect(getBodyScanConsent()).toBeNull();
    localStorage.setItem(
      BODY_SCAN_CONSENT_KEY,
      JSON.stringify({ version: 1, ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: 'yes' })
    );
    expect(getBodyScanConsent()?.photoStorage).toBe(false);
  });

  it('clears consent', () => {
    acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: true });
    clearBodyScanConsent();
    expect(getBodyScanConsent()).toBeNull();
  });
});
