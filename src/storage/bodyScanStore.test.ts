import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { BodyScanRecord, NewScanPhoto } from '../types/bodyScan';
import { acceptBodyScanConsent, getBodyScanConsent } from './bodyScanConsent';
import {
  BODY_SCAN_DB_NAME,
  BodyScanConsentRequiredError,
  BodyScanDeleteBlockedError,
  deleteAllPhotos,
  deleteAllScans,
  deleteBodyScanDatabase,
  deleteScan,
  deleteScanPhotos,
  eraseAllBodyScanData,
  getScan,
  getScanPhoto,
  getStorageSummary,
  listScans,
  PhotoStorageNotConsentedError,
  saveScan,
} from './bodyScanStore';

function scan(id: string, date: string): BodyScanRecord {
  return {
    id,
    date,
    createdAt: `${date}T08:00:00.000Z`,
    views: { front: { quality: { level: 'good', issues: [] } } },
    measurements: [{ key: 'waist_circumference', value: 82, unit: 'cm', source: 'manual' }],
  };
}

function photo(view: 'front' | 'side', bytes = 10): NewScanPhoto {
  return { view, // Node's Blob: jsdom's Blob is not structured-cloneable by fake-indexeddb (test-env limitation only;
    // real browsers store Blobs natively).
    blob: new NodeBlob([new Uint8Array(bytes)], { type: 'image/jpeg' }) as unknown as Blob, mimeType: 'image/jpeg', width: 3, height: 4 };
}

async function dbNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '');
}

beforeEach(async () => {
  localStorage.clear();
  await deleteBodyScanDatabase();
});

const consentNoPhotos = () =>
  acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false });
const consentWithPhotos = () =>
  acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: true });

describe('consent enforcement', () => {
  it('refuses to save anything without consent', async () => {
    await expect(saveScan(scan('a', '2026-10-01'))).rejects.toBeInstanceOf(BodyScanConsentRequiredError);
    expect(await dbNames()).not.toContain(BODY_SCAN_DB_NAME);
  });

  it('saves measurements without photos when photo storage is off', async () => {
    consentNoPhotos();
    await saveScan(scan('a', '2026-10-01'));
    expect((await getScan('a'))?.measurements[0].value).toBe(82);
    expect((await getStorageSummary()).photoCount).toBe(0);
  });

  it('rejects photos when photo storage is off and writes nothing', async () => {
    consentNoPhotos();
    await expect(saveScan(scan('a', '2026-10-01'), { front: photo('front') })).rejects.toBeInstanceOf(
      PhotoStorageNotConsentedError
    );
    expect(await listScans()).toHaveLength(0);
    expect((await getStorageSummary()).photoCount).toBe(0);
  });
});

describe('saving and reading', () => {
  beforeEach(() => {
    consentWithPhotos();
  });

  it('stores photos and links them from the scan', async () => {
    const saved = await saveScan(scan('a', '2026-10-01'), { front: photo('front', 25), side: photo('side', 5) });
    expect(saved.views.front?.photoId).toBeTruthy();
    expect(saved.views.side?.photoId).toBeTruthy();
    const front = await getScanPhoto('a', 'front');
    expect(front?.blob.size).toBe(25);
    expect(front?.mimeType).toBe('image/jpeg');
    const summary = await getStorageSummary();
    expect(summary).toEqual({ scanCount: 1, photoCount: 2, photoBytes: 30 });
  });

  it('lists scans oldest first', async () => {
    await saveScan(scan('b', '2026-10-10'));
    await saveScan(scan('a', '2026-10-01'));
    expect((await listScans()).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps a valid photo reference on update and drops a dangling one', async () => {
    const saved = await saveScan(scan('a', '2026-10-01'), { front: photo('front') });
    const updated = await saveScan({ ...saved, notes: 'edited' });
    expect(updated.views.front?.photoId).toBe(saved.views.front?.photoId);

    const dangling: BodyScanRecord = {
      ...scan('c', '2026-10-02'),
      views: { side: { photoId: 'c:side' } },
    };
    const clean = await saveScan(dangling);
    expect(clean.views.side?.photoId).toBeUndefined();
  });
});

describe('deletion', () => {
  beforeEach(async () => {
    consentWithPhotos();
    await saveScan(scan('a', '2026-10-01'), { front: photo('front'), side: photo('side') });
    await saveScan(scan('b', '2026-10-02'), { front: photo('front') });
  });

  it('deleteScan removes the record and only its photos', async () => {
    await deleteScan('a');
    expect(await getScan('a')).toBeUndefined();
    expect(await getScanPhoto('a', 'front')).toBeUndefined();
    expect(await getScanPhoto('a', 'side')).toBeUndefined();
    expect(await getScanPhoto('b', 'front')).toBeDefined();
    expect((await getStorageSummary()).photoCount).toBe(1);
  });

  it('deleteScanPhotos keeps measurements but removes photos and references', async () => {
    await deleteScanPhotos('a');
    const a = await getScan('a');
    expect(a?.measurements).toHaveLength(1);
    expect(a?.views.front?.photoId).toBeUndefined();
    expect(a?.views.side?.photoId).toBeUndefined();
    expect(await getScanPhoto('a', 'front')).toBeUndefined();
    expect(await getScanPhoto('b', 'front')).toBeDefined();
  });

  it('deleteAllPhotos keeps all scan records', async () => {
    await deleteAllPhotos();
    expect(await listScans()).toHaveLength(2);
    expect((await listScans()).every((s) => !s.views.front?.photoId && !s.views.side?.photoId)).toBe(true);
    expect((await getStorageSummary()).photoCount).toBe(0);
  });

  it('deleteAllScans removes records and photos', async () => {
    await deleteAllScans();
    expect(await getStorageSummary()).toEqual({ scanCount: 0, photoCount: 0, photoBytes: 0 });
  });

  it('eraseAllBodyScanData deletes the database and the consent record', async () => {
    await eraseAllBodyScanData();
    expect(await dbNames()).not.toContain(BODY_SCAN_DB_NAME);
    expect(getBodyScanConsent()).toBeNull();
    // Reopening yields an empty store.
    consentNoPhotos();
    expect(await listScans()).toHaveLength(0);
  });

  it('reports a blocked delete instead of claiming success', async () => {
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(BODY_SCAN_DB_NAME);
      r.onsuccess = () => resolve(r.result); // deliberately no onversionchange handler
      r.onerror = () => reject(r.error);
    });
    await expect(deleteBodyScanDatabase()).rejects.toBeInstanceOf(BodyScanDeleteBlockedError);
    held.close();
  });
});
