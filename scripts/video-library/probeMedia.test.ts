// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngest, type CatalogWriter, type Uploader } from './ingest';
import { runInventory } from './inventory';
import { mediaFromMeasurement, mediaFromProbeRecord, NO_MEDIA } from './probeMedia';
import { goodMeasurement, probeRecordFor, readManifestOk, writeProbeJsonl } from './probeSidecar.testutil';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

describe('mediaFromMeasurement', () => {
  it('reads duration and dimensions from a clean measurement', () => {
    expect(mediaFromMeasurement(goodMeasurement())).toEqual({ duration_seconds: 2.5, width: 1280, height: 720 });
  });
  it('rounds duration to two decimals to fit numeric(8,2)', () => {
    expect(mediaFromMeasurement({ ...goodMeasurement(), durationSeconds: 12.34567 }).duration_seconds).toBe(12.35);
  });
  it('swaps width and height for a 90 or 270 degree display rotation, but not for 0 or 180', () => {
    const rotated = (rotation: number | null) => {
      const m = goodMeasurement();
      return mediaFromMeasurement({ ...m, video: { ...m.video!, rotation } });
    };
    expect(rotated(90)).toMatchObject({ width: 720, height: 1280 });
    expect(rotated(-90)).toMatchObject({ width: 720, height: 1280 });
    expect(rotated(270)).toMatchObject({ width: 720, height: 1280 });
    expect(rotated(180)).toMatchObject({ width: 1280, height: 720 });
    expect(rotated(null)).toMatchObject({ width: 1280, height: 720 });
  });
  it('falls back to null for values the table constraints would reject', () => {
    const m = goodMeasurement();
    expect(mediaFromMeasurement({ ...m, durationSeconds: -1 }).duration_seconds).toBeNull();
    expect(mediaFromMeasurement({ ...m, durationSeconds: Number.NaN }).duration_seconds).toBeNull();
    expect(mediaFromMeasurement({ ...m, durationSeconds: null }).duration_seconds).toBeNull();
    expect(mediaFromMeasurement({ ...m, video: { ...m.video!, width: 0, height: -5 } })).toMatchObject({ width: null, height: null });
    expect(mediaFromMeasurement({ ...m, video: null })).toMatchObject({ width: null, height: null });
    expect(mediaFromMeasurement(null)).toEqual(NO_MEDIA);
  });
  it('keeps a zero duration (allowed by the table); the probe gate is what blocks it', () => {
    expect(mediaFromMeasurement({ ...goodMeasurement(), durationSeconds: 0 }).duration_seconds).toBe(0);
  });
});

describe('mediaFromProbeRecord', () => {
  let root: string;
  let work: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'media-'));
    work = path.join(root, 'work');
    writeFileSync(path.join(root, 'lib.zip'), buildZip([{ name: 'Back Squat.mp4', data: fakeMp4('squat') }]));
    await runInventory({ zipPath: path.join(root, 'lib.zip'), workDir: work, probe: null });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('yields all-null for a missing record or one that did not probe successfully', () => {
    const rec = readManifestOk(work)[0];
    expect(mediaFromProbeRecord(undefined)).toEqual(NO_MEDIA);
    expect(mediaFromProbeRecord(probeRecordFor(rec, { status: 'unreadable', measurement: null }))).toEqual(NO_MEDIA);
    expect(mediaFromProbeRecord(probeRecordFor(rec))).toEqual({ duration_seconds: 2.5, width: 1280, height: 720 });
  });

  it('ingest writes probe media into NEW rows, never changes the gate outcome, and never publishes', async () => {
    const rec = readManifestOk(work)[0];
    writeProbeJsonl(work, [probeRecordFor(rec)]);
    const rows = new Map<string, Record<string, unknown>>();
    const uploader: Uploader = { async uploadObject() { return 'uploaded'; } };
    const catalog: CatalogWriter = {
      async insertPending(row) { if (!rows.has(String(row.content_sha256))) rows.set(String(row.content_sha256), { ...row }); },
      async markUploaded() {}, async markFailed() {}
    };
    const s = await runIngest({ zipPath: path.join(root, 'lib.zip'), workDir: work, sleep: async () => {}, execute: true, uploader, catalog });
    expect(s).toMatchObject({ uploaded: 1, rejected: 0 });
    expect(rows.get(rec.sha256!)).toMatchObject({ duration_seconds: 2.5, width: 1280, height: 720 });
    expect(rows.get(rec.sha256!)).not.toHaveProperty('published');
  });

  it('a rejected video is still rejected and writes nothing, even when media could be read from its record', async () => {
    const rec = readManifestOk(work)[0];
    writeProbeJsonl(work, [probeRecordFor(rec, { status: 'unreadable', measurement: null })]);
    const calls: string[] = [];
    const uploader: Uploader = { async uploadObject() { calls.push('upload'); return 'uploaded'; } };
    const catalog: CatalogWriter = { async insertPending() { calls.push('insert'); }, async markUploaded() {}, async markFailed() {} };
    const s = await runIngest({ zipPath: path.join(root, 'lib.zip'), workDir: work, sleep: async () => {}, execute: true, uploader, catalog });
    expect(s).toMatchObject({ uploaded: 0, rejected: 1 });
    expect(calls).toEqual([]);
  });
});
