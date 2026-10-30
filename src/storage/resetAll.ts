import { db } from './db';
import { eraseAllBodyScanData } from './bodyScanStore';
import { keysInCurrentScope } from './storageScope';

/**
 * Full "Reset All Data". Body Scan data lives in IndexedDB, which
 * db.resetAllData() (localStorage.clear()) does not touch, so it is erased
 * first. If that fails the rejection propagates and the rest of the data is
 * left untouched, so the UI never reports a reset that did not fully happen.
 */
export async function resetAllAppData(): Promise<void> {
  await eraseAllBodyScanData();
  db.resetAllData();
}

/**
 * Removes everything this account stored on this device (Body Scan IndexedDB first, then every localStorage key in
 * the active scope) WITHOUT re-seeding defaults. Used after the cloud account has been deleted. Other accounts'
 * and the legacy unscoped data are untouched (keysInCurrentScope).
 */
export async function eraseAccountLocalData(): Promise<void> {
  await eraseAllBodyScanData();
  for (const k of keysInCurrentScope()) localStorage.removeItem(k);
}
