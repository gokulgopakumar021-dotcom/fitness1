import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptBodyScanConsent, getBodyScanConsent } from './bodyScanConsent';
import { db, DEFAULT_PROFILE } from './db';
import { saveAvatar, getAvatar } from './avatarStore';
import { eraseAccountLocalData } from './resetAll';
import { scopedKey, setStorageScope } from './storageScope';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => { localStorage.clear(); setStorageScope(null); });

describe('eraseAccountLocalData', () => {
  it("removes the active account's data entirely (no re-seeded defaults) and leaves other scopes alone", async () => {
    setStorageScope(B);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Bee' });
    setStorageScope(null);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Legacy' });

    setStorageScope(A);
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Ay' });
    saveAvatar('data:image/jpeg;base64,/9j/4AAQ');
    acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false });

    await eraseAccountLocalData();

    const keysA = Object.keys(localStorage).filter((k) => k.endsWith(`::u:${A}`));
    expect(keysA).toEqual([]);
    expect(getAvatar()).toBeNull();
    expect(getBodyScanConsent()).toBeNull();

    setStorageScope(B);
    expect(db.getProfile().name).toBe('Bee');
    setStorageScope(null);
    expect(db.getProfile().name).toBe('Legacy');
    expect(localStorage.getItem(scopedKey('ironlog_profile_v1'))).not.toBeNull();
  });
});
