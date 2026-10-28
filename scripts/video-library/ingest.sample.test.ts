// @vitest-environment node
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { UsageError } from './cli';
import { catalogRow, parseIngestArgs, runIngest, SampleFileError, type CatalogWriter, type Uploader } from './ingest';
import { runInventory } from './inventory';
import { writeCleanProbeSidecar } from './probeSidecar.testutil';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

let root: string;
let work: string;
let zipPath: string;
let samplePath: string;
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'ings-'));
  work = path.join(root, 'work');
  zipPath = path.join(root, 'lib.zip');
  samplePath = path.join(root, 'sample.txt');
  const same = fakeMp4('same');
  writeFileSync(zipPath, buildZip([
    { name: 'girl/Barbell Bench Press.mp4', data: fakeMp4('bench') },
    { name: 'men/Barbell Bench Press copy.mp4', data: fakeMp4('bench') }, // duplicate of the first
    { name: 'Back Squat.mp4', data: same },
    { name: 'Yoga Flow.mp4', data: fakeMp4('yoga') },
    { name: 'Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') },
    { name: 'Misc/broken.mp4', data: Buffer.from('this is not video data at all') }
  ]));
  await runInventory({ zipPath, workDir: work, probe: null });
  writeCleanProbeSidecar(work); // what a successful `npm run video:probe` leaves behind
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const records = () => parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8')).records;
const byFile = (name: string) => records().find((r) => r.originalFilename === name && r.status === 'ok')!;
const shaOf = (name: string) => byFile(name).sha256!;
const writeSample = (...lines: string[]) => writeFileSync(samplePath, lines.join('\n') + '\n');

function fakes() {
  const log: string[] = [];
  const objects = new Map<string, number>();
  const rows = new Map<string, Record<string, unknown>>();
  const uploader: Uploader = { async uploadObject(key, _f, size) { log.push(`upload ${key}`); if (objects.has(key)) return 'exists'; objects.set(key, size); return 'uploaded'; } };
  const catalog: CatalogWriter = {
    async insertPending(row) { log.push(`insert ${String(row.original_filename)}`); if (!rows.has(String(row.content_sha256))) rows.set(String(row.content_sha256), { ...row }); },
    async markUploaded(s) { log.push('uploaded-flag'); rows.get(s)!.status = 'uploaded'; },
    async markFailed(s) { log.push('failed-flag'); if (rows.get(s)) rows.get(s)!.status = 'failed'; }
  };
  return { log, objects, rows, uploader, catalog };
}
const base = () => ({ zipPath, workDir: work, sleep: async () => {} });

describe('fixture sanity', () => {
  it('covers matched, needs_review, unmatched, duplicate and invalid entries', () => {
    expect(byFile('Barbell Bench Press.mp4').match?.reviewStatus).toBe('matched');
    expect(byFile('Dumbbell Lateral Raise.mp4').match?.reviewStatus).toBe('needs_review');
    expect(byFile('Yoga Flow.mp4').match?.reviewStatus).toBe('unmatched');
    expect(records().some((r) => r.status === 'duplicate')).toBe(true);
    expect(records().some((r) => r.status === 'invalid_mp4')).toBe(true);
  });
});

describe('runIngest with --sample-file: dry run by default', () => {
  it('touches neither the archive nor Supabase, and prints a per-file plan', async () => {
    writeSample(shaOf('Yoga Flow.mp4'), shaOf('Dumbbell Lateral Raise.mp4'), shaOf('Barbell Bench Press.mp4'));
    const f = fakes();
    const lines: string[] = [];
    // A missing archive proves a dry run never opens it.
    const s = await runIngest({ ...base(), zipPath: path.join(root, 'does-not-exist.zip'), sampleFile: samplePath, execute: false, uploader: f.uploader, catalog: f.catalog, log: (m) => lines.push(m) });
    expect(f.log).toEqual([]);
    expect(s).toMatchObject({ execute: false, candidates: 3, attempted: 0, uploaded: 0, failed: 0, alreadyUploaded: 0 });
    expect(s.bytesToUpload).toBe(s.plan!.reduce((n, p) => n + (p.sizeBytes ?? 0), 0));
    expect(lines[0]).toContain('SAMPLE PLAN: 3 video(s)');
    expect(lines.join('\n')).toContain('DRY RUN: nothing was uploaded');
  });

  it('plans exactly the listed videos, in file order, with sha, file, path, review status, suggested key, size and intended row', async () => {
    writeSample(shaOf('Yoga Flow.mp4'), shaOf('Dumbbell Lateral Raise.mp4'), shaOf('Barbell Bench Press.mp4'));
    const lines: string[] = [];
    const { plan } = await runIngest({ ...base(), sampleFile: samplePath, execute: false, log: (m) => lines.push(m) });
    expect(plan!.map((p) => p.originalFilename)).toEqual(['Yoga Flow.mp4', 'Dumbbell Lateral Raise.mp4', 'Barbell Bench Press.mp4']);
    const [yoga, lat, bench] = plan!;
    expect(yoga).toMatchObject({ reviewStatus: 'unmatched', suggestedExerciseKey: null, visibleToUsers: false, alreadyUploaded: false });
    expect(lat).toMatchObject({ reviewStatus: 'needs_review', visibleToUsers: false });
    expect(lat.suggestedExerciseKey).toBeTruthy();
    expect(lat.intendedRow.exercise_key).toBeNull();
    expect(bench).toMatchObject({ reviewStatus: 'matched', visibleToUsers: true });
    expect(bench.intendedRow.exercise_key).toBeTruthy();
    expect(bench.intendedRow).toEqual(catalogRow(byFile('Barbell Bench Press.mp4')));
    const text = lines.join('\n');
    for (const p of plan!) { expect(text).toContain(p.sha256); expect(text).toContain(p.originalFilename); expect(text).toContain(p.entryName); }
    expect(text).toContain('suggested_exercise_key');
    expect(text).toContain('size_bytes');
    expect(text).toContain('intended row');
  });

  it('does not change mapping decisions: the intended rows equal what plain ingest would insert', async () => {
    writeSample(shaOf('Yoga Flow.mp4'), shaOf('Dumbbell Lateral Raise.mp4'));
    const { plan } = await runIngest({ ...base(), sampleFile: samplePath, execute: false });
    for (const p of plan!) expect(p.intendedRow).toEqual(catalogRow(records().find((r) => r.sha256 === p.sha256 && r.status === 'ok')!));
  });

  it('accepts the hash of a video that also has a duplicate record, and plans the kept path', async () => {
    writeSample(shaOf('Barbell Bench Press.mp4'));
    const { plan } = await runIngest({ ...base(), sampleFile: samplePath, execute: false });
    expect(plan).toHaveLength(1);
    expect(plan![0].entryName).toBe('girl/Barbell Bench Press.mp4');
  });

  it('has no plan when no sample file is given (existing behaviour)', async () => {
    const s = await runIngest({ ...base(), execute: false });
    expect(s.plan).toBeUndefined();
    expect(s.candidates).toBe(4);
  });
});

describe('runIngest with --sample-file: rejections (nothing is touched)', () => {
  const expectRejected = async (message: RegExp, extra: Record<string, unknown> = {}) => {
    const f = fakes();
    await expect(runIngest({ ...base(), sampleFile: samplePath, execute: true, uploader: f.uploader, catalog: f.catalog, ...extra })).rejects.toThrow(message);
    expect(f.log).toEqual([]);
  };

  it('malformed hash', async () => { writeSample(shaOf('Yoga Flow.mp4'), 'not-a-hash'); await expectRejected(/line 2.*not a 64-character/s); });
  it('unknown hash', async () => { writeSample('a'.repeat(64)); await expectRejected(/is not in the manifest/); });
  it('non-ok entry', async () => {
    const bad = records().find((r) => r.status === 'invalid_mp4')!;
    writeSample(bad.sha256!);
    await expectRejected(/not an ok manifest entry \(status: invalid_mp4/);
  });
  it('duplicate hash in the sample file', async () => { writeSample(shaOf('Yoga Flow.mp4'), shaOf('Yoga Flow.mp4')); await expectRejected(/listed twice/); });
  it('empty sample file', async () => { writeFileSync(samplePath, ''); await expectRejected(/no SHA-256 values/); });
  it('missing sample file', async () => { await expectRejected(/not found or unreadable/); });
  it('an incomplete manifest (unreadable line)', async () => {
    writeSample(shaOf('Yoga Flow.mp4'));
    appendFileSync(path.join(work, 'manifest.jsonl'), '{broken\n');
    await expectRejected(/unreadable line/);
  });

  it('refuses to combine --sample-file with --limit or --only-matched, before reading anything', async () => {
    const f = fakes();
    const missingWork = path.join(root, 'no-such-workdir');
    await expect(runIngest({ zipPath, workDir: missingWork, sampleFile: samplePath, limit: 5, execute: false })).rejects.toThrow(/cannot be combined/);
    await expect(runIngest({ zipPath, workDir: missingWork, sampleFile: samplePath, onlyMatched: true, execute: false })).rejects.toThrow(/cannot be combined/);
    await expect(runIngest({ zipPath, workDir: missingWork, sampleFile: samplePath, limit: 0, execute: true, uploader: f.uploader, catalog: f.catalog })).rejects.toBeInstanceOf(SampleFileError);
    expect(f.log).toEqual([]);
  });
});

describe('runIngest with --sample-file: execute (fake Supabase) keeps every existing protection', () => {
  it('uploads only the listed videos, inserts pending first, and leaves non-matched rows unmapped', async () => {
    writeSample(shaOf('Yoga Flow.mp4'), shaOf('Dumbbell Lateral Raise.mp4'), shaOf('Barbell Bench Press.mp4'));
    const f = fakes();
    const s = await runIngest({ ...base(), sampleFile: samplePath, execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s).toMatchObject({ candidates: 3, attempted: 3, uploaded: 3, failed: 0 });
    expect(f.rows.size).toBe(3);
    expect(f.objects.size).toBe(3);
    const row = (name: string) => f.rows.get(shaOf(name))!;
    expect(row('Yoga Flow.mp4')).toMatchObject({ review_status: 'unmatched', exercise_key: null, suggested_exercise_key: null, status: 'uploaded' });
    expect(row('Dumbbell Lateral Raise.mp4')).toMatchObject({ review_status: 'needs_review', exercise_key: null, status: 'uploaded' });
    expect(row('Dumbbell Lateral Raise.mp4').suggested_exercise_key).toBeTruthy();
    expect(row('Barbell Bench Press.mp4').exercise_key).toBeTruthy();
    expect(f.log.indexOf(`insert Yoga Flow.mp4`)).toBeLessThan(f.log.indexOf(`upload ${row('Yoga Flow.mp4').storage_key}`));
    expect(f.rows.has(shaOf('Back Squat.mp4'))).toBe(false); // not in the sample, not touched
  });

  it('is idempotent via ingest-state: a second run uploads nothing and the plan says so', async () => {
    writeSample(shaOf('Yoga Flow.mp4'), shaOf('Barbell Bench Press.mp4'));
    const f = fakes();
    await runIngest({ ...base(), sampleFile: samplePath, execute: true, uploader: f.uploader, catalog: f.catalog });
    const before = [...f.log];
    const again = await runIngest({ ...base(), sampleFile: samplePath, execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(f.log).toEqual(before);
    expect(again).toMatchObject({ candidates: 2, alreadyUploaded: 2, attempted: 0, uploaded: 0, bytesToUpload: 0 });
    expect(again.plan!.every((p) => p.alreadyUploaded)).toBe(true);
  });

  it('still refuses to upload when the archive no longer matches the manifest', async () => {
    writeSample(shaOf('Yoga Flow.mp4'));
    writeFileSync(zipPath, buildZip([{ name: 'Yoga Flow.mp4', data: fakeMp4('yoga') }].map((e) => ({ ...e, data: Buffer.concat([e.data.subarray(0, e.data.length - 1), Buffer.from([0x7f])]) }))));
    const f = fakes();
    const s = await runIngest({ ...base(), sampleFile: samplePath, execute: true, uploader: f.uploader, catalog: f.catalog });
    expect(s.uploaded).toBe(0);
    expect(f.log.filter((l) => l.startsWith('upload'))).toEqual([]);
  });

  it('still needs an uploader and a catalog writer to execute', async () => {
    writeSample(shaOf('Yoga Flow.mp4'));
    await expect(runIngest({ ...base(), sampleFile: samplePath, execute: true })).rejects.toThrow(/needs an uploader/);
  });
});

describe('parseIngestArgs', () => {
  const zip = ['--zip', 'a.zip'];
  it('defaults to a dry run with the default workdir', () => {
    expect(parseIngestArgs(zip)).toEqual({ zipPath: 'a.zip', workDir: '.video-library', execute: false, limit: undefined, onlyMatched: false, sampleFile: undefined });
  });
  it('parses the existing flags unchanged', () => {
    expect(parseIngestArgs([...zip, '--workdir', 'w', '--limit', '10', '--only-matched', '--execute'])).toMatchObject({ workDir: 'w', limit: 10, onlyMatched: true, execute: true });
  });
  it('parses --sample-file', () => {
    expect(parseIngestArgs([...zip, '--sample-file', 's.txt'])).toMatchObject({ sampleFile: 's.txt', execute: false });
  });
  it('requires --zip', () => { expect(() => parseIngestArgs([])).toThrow(UsageError); expect(() => parseIngestArgs(['--zip'])).toThrow(/needs a value/); });
  it('rejects --sample-file without a value, and never swallows the next flag as its value', () => {
    expect(() => parseIngestArgs([...zip, '--sample-file'])).toThrow(/--sample-file needs a value/);
    expect(() => parseIngestArgs([...zip, '--sample-file', '--execute'])).toThrow(/--sample-file needs a value/);
  });
  it('rejects --sample-file with --limit or --only-matched', () => {
    expect(() => parseIngestArgs([...zip, '--sample-file', 's.txt', '--limit', '5'])).toThrow(/cannot be combined/);
    expect(() => parseIngestArgs([...zip, '--sample-file', 's.txt', '--only-matched'])).toThrow(/cannot be combined/);
  });
  it('rejects a --limit that is not a whole number (it used to silently select nothing)', () => {
    for (const bad of ['abc', '-1', '1.5', '', '1e3']) expect(() => parseIngestArgs([...zip, '--limit', bad]), bad).toThrow(UsageError);
  });
});
