import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ attributeReferral: vi.fn() }));
vi.mock('./billingApi', async (orig) => ({ ...(await orig<typeof import('./billingApi')>()), ...api }));

import { BillingApiError } from './billingApi';
import {
  attemptPendingReferral, captureReferralFromUrl, cleanCreatorCode, clearPendingCreatorCode, readPendingCreatorCode, REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_MS, sanitiseCreatorInput, storePendingCreatorCode
} from './referralSignup';

beforeEach(() => {
  localStorage.clear();
  api.attributeReferral.mockReset();
  api.attributeReferral.mockResolvedValue({ success: true });
});

describe('code format', () => {
  it('accepts uppercase letters and digits, 4 to 20 characters, and uppercases what it is given', () => {
    expect(cleanCreatorCode('creator20')).toBe('CREATOR20');
    expect(cleanCreatorCode('ABCD')).toBe('ABCD');
    expect(cleanCreatorCode('A'.repeat(20))).toBe('A'.repeat(20));
  });
  it.each([['abc'], ['A'.repeat(21)], ['AB CD'], ['AB-CD1'], [''], ['  '], [undefined], [null], [12345678]])('rejects %j', (v) => {
    expect(cleanCreatorCode(v)).toBeUndefined();
  });
  it('the field input keeps only uppercase letters and digits, at most 20', () => {
    expect(sanitiseCreatorInput('cre-ator 20!')).toBe('CREATOR20');
    expect(sanitiseCreatorInput('a'.repeat(30))).toHaveLength(20);
  });
});

describe('browser storage', () => {
  it('stores a well-formed code with an expiry and reads it back', () => {
    expect(storePendingCreatorCode('creator20', 1000)).toBe(true);
    expect(readPendingCreatorCode(1000 + 5)).toBe('CREATOR20');
    expect(JSON.parse(localStorage.getItem(REFERRAL_STORAGE_KEY)!).exp).toBe(1000 + REFERRAL_TTL_MS);
  });
  it('stores nothing for a malformed code', () => {
    expect(storePendingCreatorCode('x')).toBe(false);
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
  it('an expired code is dropped', () => {
    storePendingCreatorCode('CREATOR20', 1000);
    expect(readPendingCreatorCode(1000 + REFERRAL_TTL_MS + 1)).toBeUndefined();
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
  it('garbage in storage is dropped, never thrown', () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, '{not json');
    expect(readPendingCreatorCode()).toBeUndefined();
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
});

describe('?ref= link', () => {
  it('captures a well-formed code', () => {
    captureReferralFromUrl('?utm=x&ref=creator20');
    expect(readPendingCreatorCode()).toBe('CREATOR20');
  });
  it.each([['?ref=ab'], ['?ref='], ['?other=CREATOR20'], ['?ref=bad%20code'], ['']])('ignores %j', (search) => {
    captureReferralFromUrl(search);
    expect(readPendingCreatorCode()).toBeUndefined();
  });
});

describe('the one attempt', () => {
  it('sends the stored code once and clears it', async () => {
    storePendingCreatorCode('CREATOR20');
    await attemptPendingReferral();
    expect(api.attributeReferral).toHaveBeenCalledTimes(1);
    expect(api.attributeReferral).toHaveBeenCalledWith('CREATOR20');
    expect(readPendingCreatorCode()).toBeUndefined();
  });
  it('does nothing when no code is stored', async () => {
    await attemptPendingReferral();
    expect(api.attributeReferral).not.toHaveBeenCalled();
  });
  it.each([[500], [503], [0]])('keeps the code when the server could not be reached or failed (%i)', async (status) => {
    storePendingCreatorCode('CREATOR20');
    api.attributeReferral.mockRejectedValue(new BillingApiError(status, 'x', 'x'));
    await expect(attemptPendingReferral()).resolves.toBeUndefined();
    expect(readPendingCreatorCode()).toBe('CREATOR20');
  });
  it.each([[401, 'auth_required'], [403, 'email_not_verified'], [429, 'rate_limited']])('keeps the code when the attempt was not really made (%i)', async (status, code) => {
    storePendingCreatorCode('CREATOR20');
    api.attributeReferral.mockRejectedValue(new BillingApiError(status, code, 'x'));
    await attemptPendingReferral();
    expect(readPendingCreatorCode()).toBe('CREATOR20');
  });
  it('clears the code after any other answer from the server, and never throws', async () => {
    storePendingCreatorCode('CREATOR20');
    api.attributeReferral.mockRejectedValue(new BillingApiError(400, 'validation_failed', 'x'));
    await expect(attemptPendingReferral()).resolves.toBeUndefined();
    expect(readPendingCreatorCode()).toBeUndefined();
  });
  it('clearPendingCreatorCode removes it', () => {
    storePendingCreatorCode('CREATOR20');
    clearPendingCreatorCode();
    expect(readPendingCreatorCode()).toBeUndefined();
  });
});
