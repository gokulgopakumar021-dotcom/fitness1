// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest, storageKeyFor } from '../../src/utils/videoLibrary/manifest';
import { catalogRow, runIngest, type CatalogWriter, type Uploader } from './ingest';
import { runInventory } from './inventory';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

let root: string;
let work: string;
let zipPath: string;
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'ing-'));
  work = path.join(root, 'work');
  zipPath = path.join(root, 'lib.zip');
  writeFileSync(zipPath, buildZip([
    { name: 'Barbell Bench Press.mp4', data: fakeMp4('bench') },
    { name: 'Back Squat.mp4', data: fakeMp4('squat') },
    { name: 'Yoga Flow.mp4', data: fakeMp4('yoga') },
    { name: 'Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') }
  ]));
  await runInventory({ zipPath, workDir: work, probe: null });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Records every call in order, with switchable failures. */
function fakes() {
  const log: string[] = [];
  const objects = new Map<string, number>();
  const rows = new Map<string, Record<string, unknown>>();
  const fail = { upload: 0, insert: 0 };
  const uploader: Uploader = {
    async uploadObject(key, filePath, size) {
      log.push(`upload ${key}`);
      if (fail.upload > 0) { fail.upload--; throw new Error('network reset'); }
      expect(readFileSync(filePath).length).toBe(size);
      if (objects.has(key)) return 'exists';
      objects.set(key, size);
      return 'uploaded';
    }
  };
  const catalog: CatalogWriter = {
    async insertPending(row) {
      log.push(`insert ${String(row.title)}`);
      if (fail.insert > 0) { fail.insert--; throw new Error('db unavailable'); }
      if (!rows.has(String(row.content_sha256))) rows.set(String(row.content_sha256), { ...row }); // insert-only, like ignoreDuplicates
    },
    async markUploaded(sha) { log.push('uploaded-flag'); rows.get(sha)!.status = 'uploaded'; },
    async markFailed(sha) { log.push('failed-flag'); if (rows.get(sha)) rows.get(sha)!.status = 'failed'; }
  };
  return { log, objects, rows, fail, uploader, catalog };
}
const base = () => ({ zipPath, workDir: work, sleep: async () => {} });

describe('runIngest', () => {
  it('is a dry run by default: no uploads, no catalog writes, but an accurate plan', async () => {
    const f = fakes();
    const s = await runIngest({ ...base(), execute: false, uploader: f.uploader, catalog: f.catalog });
    expect(f.log).toEqual([]);
    expect(s).toMatchObject({ execute: false, candidates: 4, attempted: 0, uploaded: 0 });
    expect(s.bytesToUpload).toBeGreaterThan(0);
  });

  it('refuses to execute without an uploader and catalog writer', async () => {
    await expect(runIngest({ ...base(), execute: true })).rejects.toThrow(/uploader/);
  });

  it('inserts the pending row, then uploads, then flags uploaded (never visible without its object)', async () => {
    const f = fakes();
    const s = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s).toMatchObject({ attempted: 4, uploaded: 4, failed: 0 });
    for (let i = 0; i < f.log.length; i += 3) {
      expect(f.log[i]).toMatch(/^insert /);
      expect(f.log[i + 1]).toMatch(/^upload videos\/[0-9a-f]{2}\/[0-9a-f]{64}\.mp4$/);
      expect(f.log[i + 2]).toBe('uploaded-flag');
    }
    const row = [...f.rows.values()].find((r) => r.title === 'Barbell Bench Press')!;
    expect(row).toMatchObject({ exercise_key: 'barbell-bench-press', review_status: 'matched', status: 'uploaded', match_method: 'exact_key' });
    const review = [...f.rows.values()].find((r) => r.title === 'Dumbbell Lateral Raise')!;
    expect(review).toMatchObject({ exercise_key: null, suggested_exercise_key: 'cable-lateral-raise', review_status: 'needs_review' });
    expect([...f.rows.values()].find((r) => r.title === 'Yoga Flow')).toMatchObject({ exercise_key: null, review_status: 'unmatched' });
    expect(readdirSync(path.join(work, 'tmp'))).toEqual([]);
  });

  it('is idempotent: a second run uploads nothing and a re-run never overwrites review decisions', async () => {
    const f = fakes();
    await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    // A human approves the equipment-conflict video by hand.
    const lat = [...f.rows.values()].find((r) => r.title === 'Dumbbell Lateral Raise')!;
    Object.assign(lat, { review_status: 'matched', exercise_key: 'cable-lateral-raise', match_method: 'manual' });
    f.log.length = 0;
    const again = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(again).toMatchObject({ attempted: 0, uploaded: 0, alreadyUploaded: 4 });
    expect(f.log).toEqual([]);
    expect(lat).toMatchObject({ review_status: 'matched', match_method: 'manual' });
  });

  it('retries transient failures with backoff and then succeeds', async () => {
    const f = fakes();
    f.fail.upload = 2;
    const delays: number[] = [];
    const s = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog, limit: 1, sleep: async (ms) => { delays.push(ms); } });
    expect(s).toMatchObject({ attempted: 1, uploaded: 1, failed: 0 });
    expect(delays).toEqual([500, 1000]);
  });

  it('records a persistent failure, keeps going, and picks the video up again on the next run', async () => {
    const f = fakes();
    f.fail.insert = 3; // exhausts the retries of the first video only
    const s1 = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s1).toMatchObject({ attempted: 4, uploaded: 3, failed: 1 });
    const state = JSON.parse(readFileSync(path.join(work, 'ingest-state.json'), 'utf8'));
    expect(Object.values(state.items as Record<string, { status: string; error?: string }>).filter((i) => i.status === 'failed')).toHaveLength(1);
    expect(JSON.stringify(state)).not.toMatch(/service|secret|key/i);

    const s2 = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s2).toMatchObject({ attempted: 1, uploaded: 1, failed: 0, alreadyUploaded: 3 });
    expect([...f.rows.values()].every((r) => r.status === 'uploaded')).toBe(true);
  });

  it('treats an object that already exists as success (interrupted earlier upload)', async () => {
    const f = fakes();
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    f.objects.set(storageKeyFor(records[0].sha256!), 1);
    const s = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s).toMatchObject({ uploaded: 4, failed: 0 });
    expect(f.objects.size).toBe(4);
  });

  it('honours --limit and --only-matched for the sample stage', async () => {
    const f = fakes();
    const s = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog, onlyMatched: true });
    expect(s.candidates).toBe(2);
    expect(s.uploaded).toBe(2);
    expect([...f.rows.values()].every((r) => r.review_status === 'matched')).toBe(true);
    const f2 = fakes();
    expect((await runIngest({ ...base(), workDir: work, execute: true, uploader: f2.uploader, catalog: f2.catalog, limit: 1 })).attempted).toBe(1);
  });

  it('refuses to upload when the archive no longer matches the manifest', async () => {
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    // Same entry name, CRC and size but different content cannot be built, so corrupt the recorded hash instead.
    const tampered = records.map((r, i) => (i === 0 ? { ...r, sha256: 'b'.repeat(64) } : r));
    writeFileSync(path.join(work, 'manifest.jsonl'), tampered.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const f = fakes();
    const s = await runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s).toMatchObject({ uploaded: 3, failed: 1 });
    expect(f.log.filter((l) => l.includes('bbbbbbbb'))).toEqual([]);
  });
});

describe('catalogRow', () => {
  it('writes only an exercise key for matched videos and keeps suggestions out of exercise_key', () => {
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    for (const r of records) {
      const row = catalogRow(r);
      expect(row.status).toBe('pending');
      expect(row.storage_key).toBe(storageKeyFor(r.sha256!));
      if (row.review_status !== 'matched') expect(row.exercise_key).toBeNull();
      else expect(row.exercise_key).toBeTruthy();
    }
  });
});
