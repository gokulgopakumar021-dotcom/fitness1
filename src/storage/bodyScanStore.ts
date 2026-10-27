import {
  BodyScanRecord,
  BodyScanStorageSummary,
  NewScanPhoto,
  ScanView,
  StoredScanPhoto,
} from '../types/bodyScan';
import { clearBodyScanConsent, getBodyScanConsent } from './bodyScanConsent';
import { scopedDbName } from './storageScope';

/**
 * On-device Body Scan storage (IndexedDB). Photos are Blobs and cannot live in
 * localStorage. Nothing here talks to a network. Intentionally separate from
 * db.ts: Body Scan data is never part of the JSON/CSV backups.
 */

export const BODY_SCAN_DB_NAME = 'ironlog_bodyscan';
/** The database name for the active account scope (equals BODY_SCAN_DB_NAME when no scope is set). */
const activeDbName = () => scopedDbName(BODY_SCAN_DB_NAME);
const DB_VERSION = 1;
const SCANS = 'scans';
const PHOTOS = 'photos';

export class BodyScanStorageUnavailableError extends Error {
  constructor() {
    super('Local storage for Body Scan is not available in this browser.');
    this.name = 'BodyScanStorageUnavailableError';
  }
}
export class BodyScanConsentRequiredError extends Error {
  constructor() {
    super('Body Scan consent is required before saving scan data.');
    this.name = 'BodyScanConsentRequiredError';
  }
}
export class PhotoStorageNotConsentedError extends Error {
  constructor() {
    super('Photo storage has not been enabled by the user.');
    this.name = 'PhotoStorageNotConsentedError';
  }
}
export class BodyScanDeleteBlockedError extends Error {
  constructor() {
    super('Deletion is blocked by another open Iron Log tab. Close other tabs and try again.');
    this.name = 'BodyScanDeleteBlockedError';
  }
}

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) {
      reject(new BodyScanStorageUnavailableError());
      return;
    }
    const req = indexedDB.open(activeDbName(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCANS)) {
        const scans = db.createObjectStore(SCANS, { keyPath: 'id' });
        scans.createIndex('by_date', 'date');
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        const photos = db.createObjectStore(PHOTOS, { keyPath: 'id' });
        photos.createIndex('by_scan', 'scanId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let deleteDatabase() from another tab proceed instead of being blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new BodyScanStorageUnavailableError());
    req.onblocked = () => reject(new BodyScanStorageUnavailableError());
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs `work` inside one transaction. `work` must only await IndexedDB
 * requests (otherwise the transaction auto-commits early). The promise
 * resolves with work's result only after the transaction has committed.
 */
async function withTx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result: T;
      let hasResult = false;
      tx.oncomplete = () => (hasResult ? resolve(result) : reject(new Error('Transaction ended without a result')));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      work(tx).then(
        (r) => {
          result = r;
          hasResult = true;
        },
        (err) => {
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
          reject(err);
        }
      );
    });
  } finally {
    db.close();
  }
}

function photoIdFor(scanId: string, view: ScanView): string {
  return `${scanId}:${view}`;
}

function stripPhotoIds(scan: BodyScanRecord): BodyScanRecord {
  const views: BodyScanRecord['views'] = {};
  (Object.keys(scan.views) as ScanView[]).forEach((v) => {
    const data = scan.views[v];
    if (data) {
      const { photoId: _removed, ...rest } = data;
      views[v] = rest;
    }
  });
  return { ...scan, views };
}

/**
 * Saves a scan. Requires valid consent. Photos are only written when the user
 * has explicitly opted in to photo storage; otherwise this throws and nothing
 * is written. Existing photo references are kept only if the photo still exists.
 */
export async function saveScan(
  scan: BodyScanRecord,
  photos: Partial<Record<ScanView, NewScanPhoto>> = {}
): Promise<BodyScanRecord> {
  const consent = getBodyScanConsent();
  if (!consent) throw new BodyScanConsentRequiredError();
  const photoEntries = (Object.entries(photos) as [ScanView, NewScanPhoto | undefined][]).filter(
    (e): e is [ScanView, NewScanPhoto] => !!e[1]
  );
  if (photoEntries.length > 0 && !consent.photoStorage) {
    throw new PhotoStorageNotConsentedError();
  }

  return withTx([SCANS, PHOTOS], 'readwrite', async (tx) => {
    const photoStore = tx.objectStore(PHOTOS);
    const scanStore = tx.objectStore(SCANS);
    const now = new Date().toISOString();
    const next: BodyScanRecord = { ...scan, views: { ...scan.views } };

    // Drop references to photos that no longer exist.
    for (const v of Object.keys(next.views) as ScanView[]) {
      const data = next.views[v];
      if (data?.photoId) {
        const existing = await reqToPromise(photoStore.get(data.photoId));
        if (!existing) {
          const { photoId: _gone, ...rest } = data;
          next.views[v] = rest;
        }
      }
    }

    for (const [view, photo] of photoEntries) {
      const id = photoIdFor(scan.id, view);
      const record: StoredScanPhoto = { ...photo, id, scanId: scan.id, view, createdAt: now };
      await reqToPromise(photoStore.put(record));
      next.views[view] = { ...(next.views[view] ?? {}), photoId: id };
    }

    await reqToPromise(scanStore.put(next));
    return next;
  });
}

export async function getScan(id: string): Promise<BodyScanRecord | undefined> {
  return withTx([SCANS], 'readonly', (tx) => reqToPromise(tx.objectStore(SCANS).get(id)));
}

/** All scans, oldest first. */
export async function listScans(): Promise<BodyScanRecord[]> {
  const all = await withTx([SCANS], 'readonly', (tx) =>
    reqToPromise(tx.objectStore(SCANS).getAll() as IDBRequest<BodyScanRecord[]>)
  );
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export async function getScanPhoto(scanId: string, view: ScanView): Promise<StoredScanPhoto | undefined> {
  return withTx([PHOTOS], 'readonly', (tx) => reqToPromise(tx.objectStore(PHOTOS).get(photoIdFor(scanId, view))));
}

/** Deletes one scan and all of its photos. */
export async function deleteScan(id: string): Promise<void> {
  await withTx([SCANS, PHOTOS], 'readwrite', async (tx) => {
    const photoStore = tx.objectStore(PHOTOS);
    const keys = await reqToPromise(photoStore.index('by_scan').getAllKeys(id));
    for (const k of keys) await reqToPromise(photoStore.delete(k));
    await reqToPromise(tx.objectStore(SCANS).delete(id));
  });
}

/** Deletes the photos of one scan but keeps its measurements. */
export async function deleteScanPhotos(id: string): Promise<void> {
  await withTx([SCANS, PHOTOS], 'readwrite', async (tx) => {
    const photoStore = tx.objectStore(PHOTOS);
    const keys = await reqToPromise(photoStore.index('by_scan').getAllKeys(id));
    for (const k of keys) await reqToPromise(photoStore.delete(k));
    const scanStore = tx.objectStore(SCANS);
    const scan = await reqToPromise(scanStore.get(id) as IDBRequest<BodyScanRecord | undefined>);
    if (scan) await reqToPromise(scanStore.put(stripPhotoIds(scan)));
  });
}

/** Deletes every stored photo; scan records and measurements are kept. */
export async function deleteAllPhotos(): Promise<void> {
  await withTx([SCANS, PHOTOS], 'readwrite', async (tx) => {
    await reqToPromise(tx.objectStore(PHOTOS).clear());
    const scanStore = tx.objectStore(SCANS);
    const scans = await reqToPromise(scanStore.getAll() as IDBRequest<BodyScanRecord[]>);
    for (const s of scans) await reqToPromise(scanStore.put(stripPhotoIds(s)));
  });
}

/** Deletes all scan records (measurements, landmarks) and all photos. */
export async function deleteAllScans(): Promise<void> {
  await withTx([SCANS, PHOTOS], 'readwrite', async (tx) => {
    await reqToPromise(tx.objectStore(PHOTOS).clear());
    await reqToPromise(tx.objectStore(SCANS).clear());
  });
}

export async function getStorageSummary(): Promise<BodyScanStorageSummary> {
  if (!isAvailable()) return { scanCount: 0, photoCount: 0, photoBytes: 0 };
  return withTx([SCANS, PHOTOS], 'readonly', async (tx) => {
    const scanCount = await reqToPromise(tx.objectStore(SCANS).count());
    const photos = await reqToPromise(tx.objectStore(PHOTOS).getAll() as IDBRequest<StoredScanPhoto[]>);
    return {
      scanCount,
      photoCount: photos.length,
      photoBytes: photos.reduce((sum, p) => sum + (p.blob?.size ?? 0), 0),
    };
  });
}

/**
 * Removes the entire Body Scan database. Resolves only when the browser has
 * actually deleted it. Rejects (and the caller must NOT claim success) if
 * another tab is holding the database open or the delete fails.
 */
export function deleteBodyScanDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) {
      resolve(); // nothing can have been stored
      return;
    }
    const req = indexedDB.deleteDatabase(activeDbName());
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to delete Body Scan data'));
    req.onblocked = () => reject(new BodyScanDeleteBlockedError());
  });
}

/**
 * Permanently erases ALL Body Scan data: database (scans, landmarks, photos)
 * and the consent record. Used by "Withdraw consent" and Reset All Data.
 */
export async function eraseAllBodyScanData(): Promise<void> {
  await deleteBodyScanDatabase();
  clearBodyScanConsent();
}
