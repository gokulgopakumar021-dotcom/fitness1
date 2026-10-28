// @vitest-environment node
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { ProbeGateError, runIngest, type CatalogWriter, type Uploader } from './ingest';
import { runInventory } from './inventory';
import { runProbe } from './probe';
import { evaluateProbeGate, loadProbeGate } from './probeGate';
import { goodMeasurement, probeRecordFor, readManifestOk, writeCleanProbeSidecar, writeProbeJsonl } from './probeSidecar.testutil';
import { makeFlag } from './probeAnalysis';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

/**
 * Probe gate (audit finding F1): a video whose MP4 header looks valid must still not be uploaded or published unless a
 * successful ffprobe result exists for exactly its bytes. Every rejection must leave Supabase untouched.
 */

let root: string;
let work: string;
let zipPath: string;
let samplePath: string;
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'gate-'));
  work = path.join(root, 'work');
  zipPath = path.join(root, 'lib.zip');
  samplePath = path.join(root, 'sample.txt');
  writeFileSync(zipPath, buildZip([
    { name: 'Barbell Bench Press.mp4', data: fakeMp4('bench') },
    { name: 'Back Squat.mp4', data: fakeMp4('squat') },
    { name: 'Yoga Flow.mp4', data: fakeMp4('yoga') },
    { name: 'Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') }
  ]));
  await runInventory({ zipPath, workDir: work, probe: null });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const ok = () => readManifestOk(work);
const byFile = (name: string) => ok().find((r) => r.originalFilename === name)!;
const shaOf = (name: string) => byFile(name).sha256!;
const writeSample = (...names: string[]) => writeFileSync(samplePath, names.map(shaOf).join('\n') + '\n');
const statePath = () => path.join(work, 'ingest-state.json');
const stateItems = (): Record<string, { status: string }> => (existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), 'utf8')).items : {});

/** Records every call, so "nothing was uploaded or published" can be asserted exactly. */
function fakes() {
  const log: string[] = [];
  const objects = new Map<string, number>();
  const rows = new Map<string, Record<string, unknown>>();
  const uploader: Uploader = { async uploadObject(key, _f, size) { log.push(`upload ${key}`); objects.set(key, size); return 'uploaded'; } };
  const catalog: CatalogWriter = {
    async insertPending(row) { log.push(`insert ${String(row.original_filename)}`); if (!rows.has(String(row.content_sha256))) rows.set(String(row.content_sha256), { ...row }); },
    async markUploaded(s) { log.push('uploaded-flag'); rows.get(s)!.status = 'uploaded'; },
    async markFailed(s) { log.push('failed-flag'); if (rows.get(s)) rows.get(s)!.status = 'failed'; }
  };
  return { log, objects, rows, uploader, catalog };
}
const base = () => ({ zipPath, workDir: work, sleep: async () => {} });
const execute = (f: ReturnType<typeof fakes>, extra: Record<string, unknown> = {}) =>
  runIngest({ ...base(), execute: true, uploader: f.uploader, catalog: f.catalog, ...extra });

/** Asserts a rejected video left no trace anywhere. */
function expectUntouched(f: ReturnType<typeof fakes>, name: string) {
  const sha = shaOf(name);
  expect(f.log.filter((l) => l.includes(name))).toEqual([]);
  expect(f.rows.has(sha)).toBe(false);
  expect([...f.objects.keys()].some((k) => k.includes(sha))).toBe(false);
  expect(stateItems()[sha]).toBeUndefined();
}

describe('probe gate: a valid file with a successful probe', () => {
  it('is uploaded and published exactly as before', async () => {
    writeCleanProbeSidecar(work);
    const f = fakes();
    const s = await execute(f, { onlyMatched: true });
    expect(s).toMatchObject({ attempted: 2, uploaded: 2, failed: 0, rejected: 0, rejections: [] });
    expect(f.rows.get(shaOf('Barbell Bench Press.mp4'))).toMatchObject({ status: 'uploaded', review_status: 'matched' });
    expect(f.log.slice(0, 3)).toEqual([expect.stringMatching(/^insert /), expect.stringMatching(/^upload videos\//), 'uploaded-flag']);
  });

  it('is not blocked by warnings or by a silent video (the gate requires only what the probe guarantees)', async () => {
    const bench = byFile('Barbell Bench Press.mp4');
    const hevcNoAudio = { ...goodMeasurement(), video: { ...goodMeasurement().video!, codec: 'hevc' }, audio: null, audioStreamCount: 0 };
    writeProbeJsonl(work, [probeRecordFor(bench, { measurement: hevcNoAudio, flags: [makeFlag('unexpected_video_codec', 'video codec is hevc; baseline is h264')] })]);
    expect(evaluateProbeGate(bench, loadProbeGate(work))).toEqual({ ok: true });
  });
});

describe('probe gate: missing probe result', () => {
  it('rejects everything when probe.jsonl does not exist: execute stops with the exact command to run, and nothing is touched', async () => {
    const f = fakes();
    const err = await execute(f).catch((e) => e);
    expect(err).toBeInstanceOf(ProbeGateError);
    expect(err.message).toContain('npm run video:probe -- --zip <archive.zip> --sample-file <sample.txt> --workdir ' + work);
    expect(err.message).toContain('ffprobe -version');
    expect(f.log).toEqual([]);
    expect(existsSync(statePath())).toBe(false);
  });

  it('a dry run reports the rejection and how to fix it, but does not throw or write anything', async () => {
    const f = fakes();
    const lines: string[] = [];
    const s = await runIngest({ ...base(), execute: false, uploader: f.uploader, catalog: f.catalog, log: (m) => lines.push(m) });
    expect(s).toMatchObject({ execute: false, candidates: 4, rejected: 4, uploaded: 0 });
    expect(s.rejections.every((r) => r.code === 'sidecar_missing')).toBe(true);
    expect(s.bytesToUpload).toBe(0);
    expect(lines.join('\n')).toContain('PROBE GATE: 4 video(s)');
    expect(lines.join('\n')).toContain('npm run video:probe');
    expect(f.log).toEqual([]);
    expect(existsSync(statePath())).toBe(false);
  });

  it('a sidecar that exists but has no record for one video rejects only that video', async () => {
    writeProbeJsonl(work, ok().filter((r) => r.originalFilename !== 'Yoga Flow.mp4').map((r) => probeRecordFor(r)));
    const f = fakes();
    const s = await execute(f);
    expect(s).toMatchObject({ uploaded: 3, rejected: 1 });
    expect(s.rejections[0]).toMatchObject({ originalFilename: 'Yoga Flow.mp4', code: 'no_probe_result' });
    expectUntouched(f, 'Yoga Flow.mp4');
  });

  it('a corrupt line in the sidecar never makes a video pass', async () => {
    writeFileSync(path.join(work, 'probe.jsonl'), '');
    appendFileSync(path.join(work, 'probe.jsonl'), '{not json\n');
    const f = fakes();
    const s = await runIngest({ ...base(), execute: false });
    expect(s.rejected).toBe(4);
    await expect(execute(f)).resolves.toMatchObject({ uploaded: 0, rejected: 4 });
    expect(f.log).toEqual([]);
  });
});

describe('probe gate: skipped or unavailable probe', () => {
  it('ffprobe not installed: the probe step writes nothing, and ingest refuses to upload', async () => {
    writeSample('Barbell Bench Press.mp4');
    const probe = await runProbe({ zipPath, workDir: work, sampleFile: samplePath, prober: async () => 'unavailable' });
    expect(probe).toMatchObject({ ffprobe: 'unavailable', wroteFiles: false });
    expect(existsSync(path.join(work, 'probe.jsonl'))).toBe(false);
    const f = fakes();
    await expect(execute(f, { sampleFile: samplePath })).rejects.toBeInstanceOf(ProbeGateError);
    expect(f.log).toEqual([]);
  });

  it('the manifest\'s own "probe: skipped" (inventory run with --no-probe) is irrelevant: only the sidecar counts', async () => {
    expect(ok().every((r) => r.probe === 'skipped')).toBe(true);
    writeCleanProbeSidecar(work);
    const f = fakes();
    expect(await execute(f)).toMatchObject({ uploaded: 4, rejected: 0 });
  });

  it.each(['archive_mismatch', 'not_in_archive'] as const)('a record with status %s (not probed) is rejected', async (status) => {
    const yoga = byFile('Yoga Flow.mp4');
    writeProbeJsonl(work, ok().map((r) => (r.sha256 === yoga.sha256
      ? probeRecordFor(r, { status, measurement: null, flags: [makeFlag(status, 'x')], detail: 'archive changed' })
      : probeRecordFor(r))));
    const f = fakes();
    const s = await execute(f);
    expect(s.rejections).toEqual([expect.objectContaining({ originalFilename: 'Yoga Flow.mp4', code: 'probe_not_successful' })]);
    expectUntouched(f, 'Yoga Flow.mp4');
  });

  it('a record without a measurement is rejected even when it claims to have been probed', () => {
    const yoga = byFile('Yoga Flow.mp4');
    writeProbeJsonl(work, [probeRecordFor(yoga, { measurement: null, flags: [] })]);
    expect(evaluateProbeGate(yoga, loadProbeGate(work))).toMatchObject({ ok: false, code: 'probe_result_invalid' });
  });
});

describe('probe gate: failed probe', () => {
  it('an unreadable file is rejected with the probe\'s own explanation, and never uploaded', async () => {
    const lat = byFile('Dumbbell Lateral Raise.mp4');
    writeProbeJsonl(work, ok().map((r) => (r.sha256 === lat.sha256
      ? probeRecordFor(r, { status: 'unreadable', measurement: null, flags: [makeFlag('ffprobe_unreadable', 'moov atom not found')], detail: 'ffprobe could not read the file: moov atom not found' })
      : probeRecordFor(r))));
    const f = fakes();
    const s = await execute(f);
    expect(s).toMatchObject({ uploaded: 3, rejected: 1 });
    expect(s.rejections[0].reason).toContain('moov atom not found');
    expectUntouched(f, 'Dumbbell Lateral Raise.mp4');
  });
});

describe('probe gate: blocking probe flags', () => {
  it.each([
    ['no_video_stream', { video: null, videoStreamCount: 0 }],
    ['invalid_duration', { durationSeconds: 0 }],
    ['invalid_dimensions', { video: { ...goodMeasurement().video!, width: 0 } }]
  ] as const)('%s rejects the video', async (code, patch) => {
    const yoga = byFile('Yoga Flow.mp4');
    const m = { ...goodMeasurement(), ...patch };
    // Flags are recorded exactly as `video:probe` would record them.
    const { evaluateMeasurement } = await import('./probeAnalysis');
    writeProbeJsonl(work, ok().map((r) => (r.sha256 === yoga.sha256 ? probeRecordFor(r, { measurement: m, flags: evaluateMeasurement(m) }) : probeRecordFor(r))));
    const f = fakes();
    const s = await execute(f);
    expect(s.rejections).toEqual([expect.objectContaining({ originalFilename: 'Yoga Flow.mp4', code: 'blocking_probe_flag', reason: expect.stringContaining(code) })]);
    expectUntouched(f, 'Yoga Flow.mp4');
  });

  it('an error flag in the record blocks even when the measurement looks fine', () => {
    const yoga = byFile('Yoga Flow.mp4');
    writeProbeJsonl(work, [probeRecordFor(yoga, { flags: [makeFlag('invalid_duration', 'duration is 0 seconds')] })]);
    expect(evaluateProbeGate(yoga, loadProbeGate(work))).toMatchObject({ ok: false, code: 'blocking_probe_flag' });
  });

  it('a hand-edited empty flag list cannot hide a broken measurement', () => {
    const yoga = byFile('Yoga Flow.mp4');
    writeProbeJsonl(work, [probeRecordFor(yoga, { measurement: { ...goodMeasurement(), video: null, videoStreamCount: 0 }, flags: [] })]);
    expect(evaluateProbeGate(yoga, loadProbeGate(work))).toMatchObject({ ok: false, code: 'blocking_probe_flag' });
  });

  it('a flag whose severity was edited down still blocks (severity comes from the flag code)', () => {
    const yoga = byFile('Yoga Flow.mp4');
    writeProbeJsonl(work, [probeRecordFor(yoga, { flags: [{ code: 'ffprobe_unreadable', severity: 'warning', detail: 'x' }] })]);
    expect(evaluateProbeGate(yoga, loadProbeGate(work))).toMatchObject({ ok: false, code: 'blocking_probe_flag' });
  });
});

describe('probe gate: stale probe result for a different file', () => {
  it('a result recorded for an earlier version of the file is not accepted for the new bytes', async () => {
    writeCleanProbeSidecar(work); // probed against the OLD archive
    writeFileSync(zipPath, buildZip([
      { name: 'Barbell Bench Press.mp4', data: fakeMp4('bench-REPLACED') }, // same name, different bytes
      { name: 'Back Squat.mp4', data: fakeMp4('squat') },
      { name: 'Yoga Flow.mp4', data: fakeMp4('yoga') },
      { name: 'Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') }
    ]));
    rmSync(path.join(work, 'manifest.jsonl'));
    await runInventory({ zipPath, workDir: work, probe: null }); // re-inventory: the bench video has a new SHA-256
    const f = fakes();
    const s = await execute(f);
    expect(s).toMatchObject({ uploaded: 3, rejected: 1 });
    expect(s.rejections[0]).toMatchObject({ originalFilename: 'Barbell Bench Press.mp4', code: 'no_probe_result' });
    expectUntouched(f, 'Barbell Bench Press.mp4');
  });

  it('a record whose hash matches but whose size does not describe this file is rejected', () => {
    const bench = byFile('Barbell Bench Press.mp4');
    writeProbeJsonl(work, [probeRecordFor(bench, { sizeBytes: (bench.sizeBytes ?? 0) + 1 })]);
    expect(evaluateProbeGate(bench, loadProbeGate(work))).toMatchObject({ ok: false, code: 'probe_result_mismatch' });
  });

  it('a result for another video never satisfies this one', () => {
    const bench = byFile('Barbell Bench Press.mp4');
    const squat = byFile('Back Squat.mp4');
    writeProbeJsonl(work, [probeRecordFor(squat)]);
    expect(evaluateProbeGate(bench, loadProbeGate(work))).toMatchObject({ ok: false, code: 'no_probe_result' });
  });

  it('even a passing probe cannot get changed bytes through: ingest still re-hashes the archive', async () => {
    writeCleanProbeSidecar(work);
    writeFileSync(zipPath, buildZip([{ name: 'Yoga Flow.mp4', data: Buffer.concat([fakeMp4('yoga').subarray(0, 100), Buffer.from([0x7f])]) }]));
    writeSample('Yoga Flow.mp4');
    const f = fakes();
    const s = await execute(f, { sampleFile: samplePath });
    expect(s.uploaded).toBe(0);
    expect(f.log.filter((l) => l.startsWith('upload'))).toEqual([]);
  });
});

describe('probe gate: retry after a failed probe', () => {
  it('a rejected video leaves no state behind, and passes once the probe is fixed and re-run', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4');
    // First probe run: ffprobe cannot read the yoga video.
    const first = await runProbe({
      zipPath, workDir: work, sampleFile: samplePath,
      prober: async (file) => { if (readFileSync(file).includes(Buffer.from('yoga'))) throw new Error('ffprobe could not read the file: moov atom not found'); return goodMeasurement(); }
    });
    expect(first).toMatchObject({ probed: 1, unreadable: 1 });

    const f = fakes();
    const s1 = await execute(f, { sampleFile: samplePath });
    expect(s1).toMatchObject({ uploaded: 1, rejected: 1 });
    expect(s1.rejections[0]).toMatchObject({ originalFilename: 'Yoga Flow.mp4', code: 'probe_not_successful' });
    expectUntouched(f, 'Yoga Flow.mp4');
    expect(stateItems()[shaOf('Barbell Bench Press.mp4')]?.status).toBe('uploaded');

    // The person fixes the problem and re-runs the probe; the new record replaces the failed one.
    await runProbe({ zipPath, workDir: work, sampleFile: samplePath, prober: async () => goodMeasurement() });
    const s2 = await execute(f, { sampleFile: samplePath });
    expect(s2).toMatchObject({ attempted: 1, uploaded: 1, rejected: 0, alreadyUploaded: 1 });
    expect(f.rows.get(shaOf('Yoga Flow.mp4'))).toMatchObject({ status: 'uploaded' });
  });
});

describe('probe gate: rejected files never reach Supabase, and existing guarantees hold', () => {
  it('when every video is rejected, no catalog write, no upload and no ingest-state entry happens', async () => {
    writeProbeJsonl(work, ok().map((r) => probeRecordFor(r, { status: 'unreadable', measurement: null, flags: [makeFlag('ffprobe_unreadable', 'x')] })));
    const f = fakes();
    const s = await execute(f);
    expect(s).toMatchObject({ attempted: 0, uploaded: 0, failed: 0, rejected: 4 });
    expect(f.log).toEqual([]);
    expect(f.rows.size).toBe(0);
    expect(f.objects.size).toBe(0);
    expect(stateItems()).toEqual({});
  });

  it('dry run stays the default: with a sample file the plan shows each video\'s probe verdict and nothing is written', async () => {
    writeProbeJsonl(work, ok().filter((r) => r.originalFilename !== 'Yoga Flow.mp4').map((r) => probeRecordFor(r)));
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4');
    const f = fakes();
    const lines: string[] = [];
    const s = await runIngest({ ...base(), sampleFile: samplePath, execute: false, uploader: f.uploader, catalog: f.catalog, log: (m) => lines.push(m) });
    expect(s.plan!.map((p) => [p.originalFilename, p.probe.ok])).toEqual([['Yoga Flow.mp4', false], ['Barbell Bench Press.mp4', true]]);
    expect(lines.join('\n')).toContain('probe: REJECTED (no_probe_result)');
    expect(lines.join('\n')).toContain('probe: passed');
    expect(f.log).toEqual([]);
    expect(existsSync(statePath())).toBe(false);
  });

  it('stays idempotent and never overwrites a manual review decision', async () => {
    writeCleanProbeSidecar(work);
    const f = fakes();
    await execute(f);
    const lat = f.rows.get(shaOf('Dumbbell Lateral Raise.mp4'))!;
    Object.assign(lat, { review_status: 'matched', exercise_key: 'cable-lateral-raise', match_method: 'manual' });
    f.log.length = 0;
    rmSync(path.join(work, 'probe.jsonl')); // finished videos are skipped, not re-gated
    const again = await execute(f);
    expect(again).toMatchObject({ attempted: 0, uploaded: 0, rejected: 0, alreadyUploaded: 4 });
    expect(f.log).toEqual([]);
    expect(lat).toMatchObject({ review_status: 'matched', match_method: 'manual' });
  });

  it('limit applies before the gate, so a rejection is reported for exactly the videos that would have been attempted', async () => {
    writeProbeJsonl(work, ok().filter((r) => r.originalFilename !== 'Barbell Bench Press.mp4').map((r) => probeRecordFor(r)));
    const f = fakes();
    const s = await execute(f, { limit: 1 });
    expect(s).toMatchObject({ attempted: 0, uploaded: 0, rejected: 1 });
    expect(parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8')).errors).toEqual([]);
  });
});
