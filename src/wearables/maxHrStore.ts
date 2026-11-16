import { scopedKey } from '../storage/storageScope';
import { validateUserMaxHr } from './heartRateZones';

// Base name only: always read and written through scopedKey() so the value is per account on this device.
const MAX_HR_BASE_KEY = 'ironlog_user_max_hr';

export function readUserMaxHr(): number | null {
  try {
    const raw = localStorage.getItem(scopedKey(MAX_HR_BASE_KEY));
    if (raw === null) return null;
    return validateUserMaxHr(Number(raw));
  } catch {
    return null;
  }
}

/** Returns the stored value, or null when cleared or invalid (invalid input is never stored). */
export function writeUserMaxHr(value: number | null): number | null {
  try {
    if (value === null) {
      localStorage.removeItem(scopedKey(MAX_HR_BASE_KEY));
      return null;
    }
    const valid = validateUserMaxHr(value);
    if (valid === null) return readUserMaxHr();
    localStorage.setItem(scopedKey(MAX_HR_BASE_KEY), String(valid));
    return valid;
  } catch {
    return null;
  }
}
