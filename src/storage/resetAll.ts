import { db } from './db';
import { eraseAllBodyScanData } from './bodyScanStore';

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
