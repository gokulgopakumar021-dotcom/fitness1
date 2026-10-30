import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AVATAR_KEY, AVATAR_MAX_STORED_CHARS, clearAvatar, getAvatar, saveAvatar } from './avatarStore';
import { scopedKey, setStorageScope } from './storageScope';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GOOD = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

beforeEach(() => { localStorage.clear(); setStorageScope(A); });
afterEach(() => setStorageScope(null));

describe('avatarStore', () => {
  it('round-trips and clears', () => {
    expect(getAvatar()).toBeNull();
    expect(saveAvatar(GOOD)).toBe(true);
    expect(getAvatar()).toBe(GOOD);
    clearAvatar();
    expect(getAvatar()).toBeNull();
  });

  it('is private to the account scope', () => {
    saveAvatar(GOOD);
    setStorageScope(B);
    expect(getAvatar()).toBeNull();
    setStorageScope(A);
    expect(getAvatar()).toBe(GOOD);
  });

  it('rejects anything that is not a small JPEG data URL', () => {
    expect(saveAvatar('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(saveAvatar('https://example.com/a.jpg')).toBe(false);
    expect(saveAvatar('data:image/jpeg;base64,' + 'A'.repeat(AVATAR_MAX_STORED_CHARS))).toBe(false);
    expect(getAvatar()).toBeNull();
  });

  it('ignores a tampered stored value instead of rendering it', () => {
    localStorage.setItem(scopedKey(AVATAR_KEY), 'javascript:alert(1)');
    expect(getAvatar()).toBeNull();
  });
});
