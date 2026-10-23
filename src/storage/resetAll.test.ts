import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptBodyScanConsent, getBodyScanConsent } from './bodyScanConsent';
import { BODY_SCAN_DB_NAME, BodyScanDeleteBlockedError, deleteBodyScanDatabase, getStorageSummary, saveScan } from './bodyScanStore';
import { db, DEFAULT_PROFILE } from './db';
import { resetAllAppData } from './resetAll';

async function seed() {
  db.saveProfile({ ...DEFAULT_PROFILE, name: 'Seeded User' });
  acceptBodyScanConsent({ ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: true });
  await saveScan(
    {
      id: 's1',
      date: '2026-10-01',
      createdAt: '2026-10-01T08:00:00.000Z',
      views: {},
      measurements: [{ key: 'waist_circumference', value: 80, unit: 'cm', source: 'manual' }],
    },
    {
      front: {
        view: 'front',
        blob: new NodeBlob([new Uint8Array(8)], { type: 'image/jpeg' }) as unknown as Blob,
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
      },
    }
  );
}

beforeEach(async () => {
  localStorage.clear();
  await deleteBodyScanDatabase();
});

describe('Reset All Data integration', () => {
  it('erases Body Scan scans, photos and consent along with the rest of the app data', async () => {
    await seed();
    expect((await getStorageSummary()).photoCount).toBe(1);

    await resetAllAppData();

    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(BODY_SCAN_DB_NAME);
    expect(getBodyScanConsent()).toBeNull();
    expect(db.getProfile().name).toBe('');
  });

  it('does not reset anything else, and rejects, if Body Scan data could not be deleted', async () => {
    await seed();
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(BODY_SCAN_DB_NAME);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await expect(resetAllAppData()).rejects.toBeInstanceOf(BodyScanDeleteBlockedError);
    expect(db.getProfile().name).toBe('Seeded User');
    expect(getBodyScanConsent()).not.toBeNull();
    held.close();
  });

  it('keeps Body Scan data out of the JSON backup export', async () => {
    await seed();
    const json = db.exportFullBackupJSON();
    expect(json).not.toMatch(/bodyscan|waist_circumference|s1:front/i);
  });
});
