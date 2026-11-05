import { db } from './db';
import { eraseAllBodyScanData } from './bodyScanStore';
import { keysInCurrentScope } from './storageScope';
import { syncBeforeBulkDelete, type PreDeleteSync } from '../sync/bulkDelete';

/**
 * Full "Reset All Data". Body Scan data lives in IndexedDB, which
 * db.resetAllData() (localStorage.clear()) does not touch, so it is erased
 * first. If that fails the rejection propagates and the rest of the data is
 * left untouched, so the UI never reports a reset that did not fully happen.
 *
 * Cloud: the local wipe keeps the sync bookkeeping, so every synchronised plan, session and active session is
 * tombstoned in Supabase (queued while offline). Deleted records never come back on a later sync.
 */
export async function resetAllAppData(): Promise<PreDeleteSync> {
  await eraseAllBodyScanData();
  // Learn every record the cloud holds first, so all of them (not only the ones this device already has) are
  // tombstoned. Best-effort: offline, the reset still happens and the deletions stay queued until the cloud confirms.
  const pre = await syncBeforeBulkDelete();
  db.resetAllData();
  return pre;
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
