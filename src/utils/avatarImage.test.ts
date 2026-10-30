import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_INPUT_BYTES, initialsFromName, validateAvatarFile } from './avatarImage';

describe('validateAvatarFile', () => {
  it('accepts jpeg, png and webp within the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateAvatarFile({ type, size: 1000 })).toBeNull();
    }
  });
  it('rejects other types (including svg and gif), oversize and empty files', () => {
    expect(validateAvatarFile({ type: 'image/svg+xml', size: 1000 })).toMatch(/JPEG, PNG or WebP/);
    expect(validateAvatarFile({ type: 'image/gif', size: 1000 })).not.toBeNull();
    expect(validateAvatarFile({ type: 'application/pdf', size: 1000 })).not.toBeNull();
    expect(validateAvatarFile({ type: 'image/png', size: AVATAR_MAX_INPUT_BYTES + 1 })).toMatch(/8 MB/);
    expect(validateAvatarFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('initialsFromName', () => {
  it('uses first and last initial, uppercased', () => {
    expect(initialsFromName('alex')).toBe('A');
    expect(initialsFromName('  alex  morgan ')).toBe('AM');
    expect(initialsFromName('Mary Jane Watson')).toBe('MW');
  });
  it('returns empty for blank names so no fake initials are shown', () => {
    expect(initialsFromName('')).toBe('');
    expect(initialsFromName('   ')).toBe('');
  });
});
