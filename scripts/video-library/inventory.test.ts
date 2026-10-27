// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { ffprobe, runInventory, type Prober } from './inventory';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

let root: string;
let work: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'inv-')); work = path.join(root, 'work'); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const fakeProbe: Prober = async () => ({ durationSeconds: 7.5, width: 1280, height: 720 });

function sampleArchive(): string {
  const dup = fakeMp4('dup');
  const zipPath = path.join(root, 'lib.zip');
  writeFileSync(zipPath, buildZip([
    { name: 'Chest/', },
    { name: 'Chest/Barbell Bench Press.mp4', data: fakeMp4('bench'), method: 'deflate' },
    { name: 'Legs/0042_Back_Squat.mp4', data: dup },
    { name: 'Legs/Back Squat copy.mp4', data: dup },                    // same bytes -> duplicate
    { name: 'Shoulders/Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') },
    { name: 'Misc/Yoga Flow.mp4', data: fakeMp4('yoga') },
    { name: 'Misc/broken.mp4', data: Buffer.from('this is not video data at all') },
    { name: '__MACOSX/Chest/._Barbell Bench Press.mp4', data: Buffer.from([0, 5, 22, 7]) },
    { name: 'notes.txt', data: Buffer.from('hello') },
    { name: '../escape.mp4', data: fakeMp4('escape') },
    { name: 'Misc/link.mp4', data: Buffer.from('/etc/passwd'), unixMode: 0o120777 },
    { name: 'Misc/huge.mp4', data: fakeMp4('huge', 5000) }
  ]));
  return zipPath;
}

const statusOf = (records: ReturnType<typeof parseManifest>['records']) => Object.fromEntries(records.map((r) => [r.entryName, r.status]));

describe('runInventory', () => {
  it('classifies every entry, hashes, dedupes and matches, and never leaves temp files', async () => {
    const summary = await runInventory({ zipPath: sampleArchive(), workDir: work, probe: fakeProbe, maxFileBytes: 4000 });
    const { records, errors } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    expect(errors).toEqual([]);
    expect(statusOf(records)).toEqual({
      'Chest/Barbell Bench Press.mp4': 'ok',
      'Legs/0042_Back_Squat.mp4': 'ok',
      'Legs/Back Squat copy.mp4': 'duplicate',
      'Shoulders/Dumbbell Lateral Raise.mp4': 'ok',
      'Misc/Yoga Flow.mp4': 'ok',
      'Misc/broken.mp4': 'invalid_mp4',
      '__MACOSX/Chest/._Barbell Bench Press.mp4': 'skipped_non_mp4',
      'notes.txt': 'skipped_non_mp4',
      '../escape.mp4': 'unsafe_path',
      'Misc/link.mp4': 'symlink',
      'Misc/huge.mp4': 'too_large'
    });
    const dup = records.find((r) => r.status === 'duplicate')!;
    expect(dup.duplicateOf).toBe('Legs/0042_Back_Squat.mp4');

    const byName = Object.fromEntries(records.map((r) => [r.entryName, r]));
    expect(byName['Chest/Barbell Bench Press.mp4'].match).toMatchObject({ exerciseKey: 'barbell-bench-press', reviewStatus: 'matched' });
    expect(byName['Legs/0042_Back_Squat.mp4'].match).toMatchObject({ exerciseKey: 'barbell-squat', method: 'exact_alias' });
    expect(byName['Shoulders/Dumbbell Lateral Raise.mp4'].match).toMatchObject({ reviewStatus: 'needs_review', reason: 'equipment_conflict' });
    expect(byName['Misc/Yoga Flow.mp4'].match).toMatchObject({ reviewStatus: 'unmatched' });
    expect(byName['Chest/Barbell Bench Press.mp4']).toMatchObject({ durationSeconds: 7.5, width: 1280, height: 720, probe: 'ok', title: 'Barbell Bench Press' });
    expect(byName['Chest/Barbell Bench Press.mp4'].sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(summary.uniqueVideos).toBe(4);
    expect(summary.duplicates).toBe(1);
    expect(summary.review).toEqual({ matched: 2, needs_review: 1, unmatched: 1 });
    expect(readdirSync(path.join(work, 'tmp'))).toEqual([]);
    // Nothing escaped the work dir: the traversal entry produced no file next to it.
    expect(readdirSync(root).sort()).toEqual(['lib.zip', 'work']);
  });

  it('writes a review CSV that lists only videos a human must look at', async () => {
    await runInventory({ zipPath: sampleArchive(), workDir: work, probe: null, maxFileBytes: 4000 });
    const csv = readFileSync(path.join(work, 'review.csv'), 'utf8');
    expect(csv).toContain('Dumbbell Lateral Raise.mp4');
    expect(csv).toContain('equipment_conflict');
    expect(csv).toContain('Yoga Flow.mp4');
    expect(csv).not.toContain('Barbell Bench Press.mp4');
  });

  it('resumes: a second run does no work and does not change the manifest', async () => {
    const zipPath = sampleArchive();
    await runInventory({ zipPath, workDir: work, probe: fakeProbe, maxFileBytes: 4000 });
    const before = readFileSync(path.join(work, 'manifest.jsonl'), 'utf8');
    const again = await runInventory({ zipPath, workDir: work, probe: fakeProbe, maxFileBytes: 4000 });
    expect(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8')).toBe(before);
    expect(again.entriesSkippedAsAlreadyDone).toBe(again.entriesSeen);
  });

  it('continues after an interruption: only the missing entries are processed, duplicates still detected', async () => {
    const zipPath = sampleArchive();
    await runInventory({ zipPath, workDir: work, probe: null, maxFileBytes: 4000 });
    const manifest = path.join(work, 'manifest.jsonl');
    const lines = readFileSync(manifest, 'utf8').trim().split('\n');
    // Simulate a crash after the first 2 entries plus a half-written final line.
    writeFileSync(manifest, lines.slice(0, 2).join('\n') + '\n{"entryIndex":2,"entryNa');
    const resumed = await runInventory({ zipPath, workDir: work, probe: null, maxFileBytes: 4000 });
    const { records, errors } = parseManifest(readFileSync(manifest, 'utf8'));
    expect(errors).toEqual([]); // the half-written line was cut off, not glued onto the next record
    const names = records.map((r) => r.entryName);
    expect(new Set(names).size).toBe(names.length);
    expect(statusOf(records)['Legs/Back Squat copy.mp4']).toBe('duplicate');
    expect(resumed.uniqueVideos).toBe(4);
  });

  it('reports probe as unavailable instead of inventing metadata', async () => {
    await runInventory({ zipPath: sampleArchive(), workDir: work, probe: async () => 'unavailable', maxFileBytes: 4000 });
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    const ok = records.filter((r) => r.status === 'ok');
    expect(ok.every((r) => r.probe === 'unavailable' && r.durationSeconds === null && r.width === null)).toBe(true);
  });

  it('marks a file unreadable by ffprobe as invalid rather than ok', async () => {
    await runInventory({ zipPath: sampleArchive(), workDir: work, probe: async () => { throw new Error('moov atom not found'); }, maxFileBytes: 4000 });
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    expect(records.filter((r) => r.status === 'ok')).toHaveLength(0);
    expect(records.find((r) => r.entryName === 'Chest/Barbell Bench Press.mp4')).toMatchObject({ status: 'invalid_mp4', probe: 'failed' });
  });

  it('fails clearly on an input that is not a ZIP (for example a RAR)', async () => {
    const rar = path.join(root, 'lib.rar');
    writeFileSync(rar, Buffer.concat([Buffer.from('Rar!\x1a\x07\x01\x00', 'latin1'), Buffer.alloc(64)]));
    await expect(runInventory({ zipPath: rar, workDir: work, probe: null })).rejects.toThrow();
  });
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe.skipIf(!hasFfmpeg)('real ffprobe (skipped when ffmpeg is not installed)', () => {
  it('reads real duration and resolution from a generated MP4 and rejects a truncated one', async () => {
    const mp4 = path.join(root, 'real.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x90:rate=10', '-pix_fmt', 'yuv420p', '-y', mp4]);
    const meta = await ffprobe(mp4);
    expect(meta).toMatchObject({ width: 160, height: 90 });
    expect((meta as { durationSeconds: number }).durationSeconds).toBeGreaterThan(0.5);

    const zipPath = path.join(root, 'real.zip');
    const good = readFileSync(mp4);
    writeFileSync(zipPath, buildZip([
      { name: 'Barbell Bench Press.mp4', data: good },
      { name: 'Truncated Squat.mp4', data: good.subarray(0, 64) } // has 'ftyp' but no media
    ]));
    await runInventory({ zipPath, workDir: work, probe: ffprobe });
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    expect(statusOf(records)).toEqual({ 'Barbell Bench Press.mp4': 'ok', 'Truncated Squat.mp4': 'invalid_mp4' });
    expect(records[0]).toMatchObject({ probe: 'ok', width: 160, height: 90 });
  });
});
