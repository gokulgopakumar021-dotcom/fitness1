import { scopedKey } from './storageScope';

/**
 * Profile photo, kept on this device only (localStorage, scoped per account like all Iron Log data).
 * Stored under its own key, NOT inside UserProfile, so it never travels with the profile object into
 * props, backups or AI prompts. Always a small JPEG data URL produced by utils/avatarImage.
 */
export const AVATAR_KEY = 'ironlog_avatar_v1';
export const AVATAR_MAX_STORED_CHARS = 150_000; // ~110 KB of image

const DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function getAvatar(): string | null {
  try {
    const v = localStorage.getItem(scopedKey(AVATAR_KEY));
    return v && v.length <= AVATAR_MAX_STORED_CHARS && DATA_URL_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Returns true only when the write succeeded. Rejects anything that is not a small JPEG data URL. */
export function saveAvatar(dataUrl: string): boolean {
  if (dataUrl.length > AVATAR_MAX_STORED_CHARS || !DATA_URL_RE.test(dataUrl)) return false;
  try {
    localStorage.setItem(scopedKey(AVATAR_KEY), dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function clearAvatar(): void {
  try {
    localStorage.removeItem(scopedKey(AVATAR_KEY));
  } catch {
    /* ignore */
  }
}
