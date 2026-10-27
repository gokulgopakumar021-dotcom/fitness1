// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { UsageError } from './cli';
import { runInventory } from './inventory';
import { parseCsv } from './manifestFixture.testutil';
import { createFfprobe, FLAGS_HEADER, parseProbeArgs, readProbeSidecar, runProbe, type FullProber } from './probe';
import { parseFfprobeJson, type Measurement } from './probeAnalysis';
import { SampleFileError } from './sampleFile';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

let root: string;
let work: string;
let zipPath: string;
let samplePath: string;
const NOW = new Date('2026-10-27T10:00:00.000Z');
const clock = () => NOW;

const good = (): Measurement => parseFfprobeJson(JSON.stringify({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.5', tags: { major_brand: 'isom' } },
  streams: [{ codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: 1280, height: 720, disposition: { attached_pic: 0 } }]
}));
const hevc = (): Measurement => ({ ...good(), video: { ...good().video!, codec: 'hevc' } });

/** Fake ffprobe keyed on the seed text fakeMp4() embeds in each file. */
function fakeProber(table: Record<string, Measurement | 'unavailable' | Error>) {
  const calls: string[] = [];
  const prober: FullProber = async (file) => {
    const bytes = readFileSync(file);
    const seed = Object.keys(table).find((s) => bytes.includes(Buffer.from(s)));
    calls.push(seed ?? '?');
    const r = seed ? table[seed] : good();
    if (r instanceof Error) throw r;
    return r;
  };
  return { prober, calls };
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'prb-'));
  work = path.join(root, 'work');
  zipPath = path.join(root, 'lib.zip');
  samplePath = path.join(root, 'sample.txt');
  writeFileSync(zipPath, buildZip([
    { name: 'girl/Barbell Bench Press.mp4', data: fakeMp4('bench') },
    { name: 'Back Squat.mp4', data: fakeMp4('squat') },
    { name: 'Yoga Flow.mp4', data: fakeMp4('yoga') },
    { name: 'Dumbbell Lateral Raise.mp4', data: fakeMp4('lat') },
    { name: 'Misc/broken.mp4', data: Buffer.from('this is not video data at all') }
  ]));
  await runInventory({ zipPath, workDir: work, probe: null });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const manifestText = () => readFileSync(path.join(work, 'manifest.jsonl'), 'utf8');
const manifestRecords = () => parseManifest(manifestText()).records;
const shaOf = (file: string) => manifestRecords().find((r) => r.originalFilename === file && r.status === 'ok')!.sha256!;
const writeSample = (...files: string[]) => writeFileSync(samplePath, files.map(shaOf).join('\n') + '\n');
const opts = (prober: FullProber) => ({ zipPath, workDir: work, sampleFile: samplePath, prober, now: clock });
const sidecar = () => readProbeSidecar(path.join(work, 'probe.jsonl')).records;

describe('runProbe: sidecar for the sample', () => {
  it('probes only the sample, in sample order, and records what ffprobe reported', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4');
    const { prober, calls } = fakeProber({ yoga: good(), bench: good() });
    const s = await runProbe(opts(prober));
    expect(calls.sort()).toEqual(['bench', 'yoga']);
    expect(s).toMatchObject({ ffprobe: 'available', requested: 2, probed: 2, clean: 2, withErrors: 0, withWarningsOnly: 0, wroteFiles: true });
    expect(s.records.map((r) => r.originalFilename)).toEqual(['Yoga Flow.mp4', 'Barbell Bench Press.mp4']);
    const [yoga] = sidecar();
    expect(yoga).toMatchObject({
      version: 1, sha256: shaOf('Yoga Flow.mp4'), entryName: 'Yoga Flow.mp4', reviewStatus: 'unmatched', status: 'probed', probedAt: NOW.toISOString(), flags: []
    });
    expect(yoga.measurement).toMatchObject({ container: 'mov,mp4,m4a,3gp,3g2,mj2', durationSeconds: 2.5, video: { codec: 'h264', pixelFormat: 'yuv420p', width: 1280, height: 720, profile: 'High' } });
  });

  it('never modifies the manifest and leaves no extracted files behind', async () => {
    writeSample('Yoga Flow.mp4', 'Dumbbell Lateral Raise.mp4');
    const before = manifestText();
    await runProbe(opts(fakeProber({}).prober));
    expect(manifestText()).toBe(before);
    expect(readdirSync(path.join(work, 'tmp'))).toEqual([]);
    expect(existsSync(path.join(work, 'manifest.jsonl.tmp'))).toBe(false);
  });

  it('removes the extracted file even when ffprobe throws', async () => {
    writeSample('Yoga Flow.mp4');
    await runProbe(opts(fakeProber({ yoga: new Error('boom') }).prober));
    expect(readdirSync(path.join(work, 'tmp'))).toEqual([]);
  });

  it('flags warnings and errors per video and summarises them', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4', 'Dumbbell Lateral Raise.mp4');
    const noVideo: Measurement = { ...good(), video: null, videoStreamCount: 0 };
    const s = await runProbe(opts(fakeProber({ yoga: hevc(), bench: good(), lat: noVideo }).prober));
    expect(s).toMatchObject({ probed: 3, clean: 1, withWarningsOnly: 1, withErrors: 1 });
    expect(s.flagCounts).toEqual({ unexpected_video_codec: 1, no_video_stream: 1 });
  });

  it('keeps going when one file is unreadable, and records it as an error', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4');
    const s = await runProbe(opts(fakeProber({ yoga: new Error('ffprobe could not read the file: Invalid data'), bench: good() }).prober));
    expect(s).toMatchObject({ probed: 1, unreadable: 1, withErrors: 1 });
    const r = s.records.find((x) => x.originalFilename === 'Yoga Flow.mp4')!;
    expect(r).toMatchObject({ status: 'unreadable', measurement: null });
    expect(r.flags[0]).toMatchObject({ code: 'ffprobe_unreadable', severity: 'error' });
    expect(r.flags[0].detail).toContain('Invalid data');
  });
});

describe('runProbe: sample validation happens first', () => {
  it('rejects a malformed, unknown, repeated or non-ok hash before reading the archive or writing anything', async () => {
    const bad = manifestRecords().find((r) => r.status === 'invalid_mp4')!.sha256!;
    const missingZip = path.join(root, 'nope.zip');
    for (const lines of [['zzz'], ['a'.repeat(64)], [shaOf('Yoga Flow.mp4'), shaOf('Yoga Flow.mp4')], [bad], []]) {
      writeFileSync(samplePath, lines.join('\n'));
      await expect(runProbe({ ...opts(fakeProber({}).prober), zipPath: missingZip })).rejects.toBeInstanceOf(SampleFileError);
    }
    expect(existsSync(path.join(work, 'probe.jsonl'))).toBe(false);
    expect(existsSync(path.join(work, 'probe-flags.csv'))).toBe(false);
  });

  it('says so plainly when the archive itself is missing (after the sample has been validated)', async () => {
    writeSample('Yoga Flow.mp4');
    await expect(runProbe({ ...opts(fakeProber({}).prober), zipPath: path.join(root, 'gone.zip') })).rejects.toThrow(/Archive not found: .*gone\.zip/);
    expect(existsSync(path.join(work, 'probe.jsonl'))).toBe(false);
  });

  it('fails clearly for a missing sample file or manifest, and refuses an incomplete manifest', async () => {
    await expect(runProbe(opts(fakeProber({}).prober))).rejects.toThrow(/not found or unreadable/);
    writeSample('Yoga Flow.mp4');
    await expect(runProbe({ ...opts(fakeProber({}).prober), workDir: path.join(root, 'empty') })).rejects.toThrow(/Manifest not found/);
    writeFileSync(path.join(work, 'manifest.jsonl'), manifestText() + '{broken\n');
    await expect(runProbe(opts(fakeProber({}).prober))).rejects.toThrow(/unreadable line/);
  });
});

describe('runProbe: ffprobe unavailable is not an error', () => {
  it('skips cleanly: no throw, nothing written, manifest untouched, and it stops after the first miss', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4', 'Dumbbell Lateral Raise.mp4');
    const before = manifestText();
    const { prober, calls } = fakeProber({ yoga: 'unavailable', bench: 'unavailable', lat: 'unavailable' });
    const s = await runProbe(opts(prober));
    expect(s).toMatchObject({ ffprobe: 'unavailable', requested: 3, probed: 0, wroteFiles: false, records: [] });
    expect(calls).toHaveLength(1);
    expect(existsSync(path.join(work, 'probe.jsonl'))).toBe(false);
    expect(existsSync(path.join(work, 'probe-flags.csv'))).toBe(false);
    expect(manifestText()).toBe(before);
    expect(readdirSync(path.join(work, 'tmp'))).toEqual([]);
  });

  it('does not clobber results from an earlier run', async () => {
    writeSample('Yoga Flow.mp4');
    await runProbe(opts(fakeProber({ yoga: hevc() }).prober));
    const before = readFileSync(path.join(work, 'probe.jsonl'), 'utf8');
    const csvBefore = readFileSync(path.join(work, 'probe-flags.csv'), 'utf8');
    await runProbe(opts(fakeProber({ yoga: 'unavailable' }).prober));
    expect(readFileSync(path.join(work, 'probe.jsonl'), 'utf8')).toBe(before);
    expect(readFileSync(path.join(work, 'probe-flags.csv'), 'utf8')).toBe(csvBefore);
  });

  it('the real ffprobe wrapper reports a missing binary as unavailable', async () => {
    writeSample('Yoga Flow.mp4');
    const s = await runProbe({ ...opts(fakeProber({}).prober), prober: createFfprobe('ffprobe-definitely-not-installed') });
    expect(s.ffprobe).toBe('unavailable');
  });
});

describe('runProbe: archive checks', () => {
  it('does not probe a file whose bytes no longer match the manifest hash', async () => {
    writeSample('Yoga Flow.mp4');
    const sha = shaOf('Yoga Flow.mp4');
    writeFileSync(path.join(work, 'manifest.jsonl'), manifestText().replace(sha, 'b'.repeat(64)));
    writeFileSync(samplePath, 'b'.repeat(64) + '\n');
    const { prober, calls } = fakeProber({});
    const s = await runProbe(opts(prober));
    expect(calls).toEqual([]);
    expect(s).toMatchObject({ archiveMismatch: 1, withErrors: 1, probed: 0 });
    expect(s.records[0]).toMatchObject({ status: 'archive_mismatch', measurement: null });
    expect(s.records[0].flags[0].code).toBe('archive_mismatch');
  });

  it('flags a sample video that is missing from, or changed in, the archive', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4');
    writeFileSync(zipPath, buildZip([
      { name: 'girl/Barbell Bench Press.mp4', data: fakeMp4('bench') },
      { name: 'Yoga Flow.mp4', data: fakeMp4('yoga-CHANGED') } // same name, different bytes: CRC/size differ
    ]));
    const s = await runProbe(opts(fakeProber({}).prober));
    expect(s).toMatchObject({ notInArchive: 1, probed: 1 });
    expect(s.records.find((r) => r.originalFilename === 'Yoga Flow.mp4')!.flags[0].code).toBe('not_in_archive');
  });
});

describe('runProbe: merging and the flags CSV', () => {
  it('keeps earlier results for other videos, and a re-run replaces only its own', async () => {
    writeSample('Yoga Flow.mp4');
    await runProbe(opts(fakeProber({ yoga: good() }).prober));
    writeSample('Barbell Bench Press.mp4');
    await runProbe(opts(fakeProber({ bench: hevc() }).prober));
    expect(sidecar().map((r) => r.originalFilename)).toEqual(['Yoga Flow.mp4', 'Barbell Bench Press.mp4']);
    writeSample('Yoga Flow.mp4');
    await runProbe({ ...opts(fakeProber({ yoga: hevc() }).prober), now: () => new Date('2026-10-28T00:00:00.000Z') });
    const all = sidecar();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.originalFilename === 'Yoga Flow.mp4')).toMatchObject({ probedAt: '2026-10-28T00:00:00.000Z', flags: [{ code: 'unexpected_video_codec' }] });
  });

  it('drops unreadable lines from an old sidecar instead of failing', async () => {
    writeSample('Yoga Flow.mp4');
    writeFileSync(path.join(work, 'probe.jsonl'), 'garbage\n{"version":2}\n');
    const logs: string[] = [];
    await runProbe({ ...opts(fakeProber({}).prober), log: (m) => logs.push(m) });
    expect(sidecar()).toHaveLength(1);
    expect(logs.join('\n')).toContain('2 unreadable line(s)');
  });

  it('writes one CSV row per flag, errors first, and nothing for clean videos', async () => {
    writeSample('Yoga Flow.mp4', 'Barbell Bench Press.mp4', 'Dumbbell Lateral Raise.mp4', 'Back Squat.mp4');
    const noVideo: Measurement = { ...good(), video: null, videoStreamCount: 0 };
    await runProbe(opts(fakeProber({ yoga: hevc(), bench: good(), lat: noVideo, squat: new Error('ffprobe could not read the file: bad') }).prober));
    const [header, ...rows] = parseCsv(readFileSync(path.join(work, 'probe-flags.csv'), 'utf8'));
    expect(header).toEqual(FLAGS_HEADER);
    const c = (row: string[], n: string) => row[header.indexOf(n)];
    expect(rows).toHaveLength(3);
    expect(rows.slice(0, 2).map((r) => `${c(r, 'severity')}:${c(r, 'flag')}`).sort()).toEqual(['error:ffprobe_unreadable', 'error:no_video_stream']);
    expect(`${c(rows[2], 'severity')}:${c(rows[2], 'flag')}`).toBe('warning:unexpected_video_codec');
    expect(rows.map((r) => c(r, 'original_filename')).sort()).toEqual(['Back Squat.mp4', 'Dumbbell Lateral Raise.mp4', 'Yoga Flow.mp4']);
    const yoga = rows.find((r) => c(r, 'original_filename') === 'Yoga Flow.mp4')!;
    expect(c(yoga, 'video_codec')).toBe('hevc');
    expect(c(yoga, 'pixel_format')).toBe('yuv420p');
    expect(c(yoga, 'width')).toBe('1280');
    expect(c(yoga, 'duration_seconds')).toBe('2.5');
    expect(c(yoga, 'review_status')).toBe('unmatched');
  });
});

describe('parseProbeArgs', () => {
  it('requires --zip and --sample-file, with a default workdir', () => {
    expect(parseProbeArgs(['--zip', 'a.zip', '--sample-file', 's.txt'])).toEqual({ zipPath: 'a.zip', sampleFile: 's.txt', workDir: '.video-library' });
    expect(parseProbeArgs(['--zip', 'a.zip', '--sample-file', 's.txt', '--workdir', 'w']).workDir).toBe('w');
    expect(() => parseProbeArgs([])).toThrow(UsageError);
    expect(() => parseProbeArgs(['--zip', 'a.zip'])).toThrow(/--sample-file/);
    expect(() => parseProbeArgs(['--zip', 'a.zip', '--sample-file'])).toThrow(/needs a value/);
    expect(() => parseProbeArgs(['--zip', 'a.zip', '--sample-file', '--workdir', 'w'])).toThrow(/needs a value/);
  });
});

// ---- Real ffprobe on real MP4 files (skipped when ffmpeg/ffprobe are not installed) -------------------------------

const has = (bin: string) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const hasFf = has('ffmpeg') && has('ffprobe');
const hasEncoder = (n: string) => { try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(` ${n} `); } catch { return false; } };

describe.skipIf(!hasFf || !hasEncoder('libx264') || !hasEncoder('aac'))('real ffprobe on generated MP4s', () => {
  let dir: string;
  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=duration=1', ...args, '-y', out]);
    return out;
  };
  const probe = createFfprobe();
  const flagCodes = async (file: string) => {
    const m = await probe(file);
    if (m === 'unavailable') throw new Error('ffprobe unavailable');
    const { evaluateMeasurement } = await import('./probeAnalysis');
    return { m, codes: evaluateMeasurement(m).map((f) => f.code) };
  };
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'real-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads a good H.264/yuv420p/AAC file completely and flags nothing', async () => {
    const f = make('good.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    const { m, codes } = await flagCodes(f);
    expect(codes).toEqual([]);
    expect(m.container).toContain('mp4');
    expect(m.majorBrand).toBe('isom');
    expect(m.video).toMatchObject({ codec: 'h264', pixelFormat: 'yuv420p', width: 160, height: 90 });
    expect(m.video?.profile).toBeTruthy();
    expect(m.audio?.codec).toBe('aac');
    expect(m.durationSeconds).toBeGreaterThan(0.5);
  });

  it('accepts a silent H.264 file', async () => {
    expect((await flagCodes(make('silent.mp4', ['-map', '0:v', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']))).codes).toEqual([]);
  });

  it('flags 4:4:4 H.264 as an unexpected pixel format', async () => {
    const { m, codes } = await flagCodes(make('444.mp4', ['-map', '0:v', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']));
    expect(m.video?.codec).toBe('h264');
    expect(codes).toEqual(['unexpected_pixel_format']);
  });

  it.skipIf(!hasEncoder('libx265'))('flags HEVC as an unexpected video codec', async () => {
    const { codes } = await flagCodes(make('hevc.mp4', ['-map', '0:v', '-c:v', 'libx265', '-x265-params', 'log-level=none', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1']));
    expect(codes).toEqual(['unexpected_video_codec']);
  });

  it.skipIf(!hasEncoder('libmp3lame'))('flags non-AAC audio', async () => {
    const { codes } = await flagCodes(make('mp3.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-shortest']));
    expect(codes).toEqual(['unexpected_audio_codec']);
  });

  it('flags an MP4 with audio but no video stream', async () => {
    const { m, codes } = await flagCodes(make('audio-only.mp4', ['-map', '1:a', '-c:a', 'aac']));
    expect(m.video).toBeNull();
    expect(codes).toEqual(['no_video_stream']);
  });

  it('rejects a truncated file with a readable message', async () => {
    const good = readFileSync(make('g.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']));
    const t = path.join(dir, 'trunc.mp4');
    writeFileSync(t, good.subarray(0, 64));
    await expect(probe(t)).rejects.toThrow(/ffprobe could not read the file/);
  });

  it('reports a missing binary as unavailable', async () => {
    expect(await createFfprobe('ffprobe-definitely-not-installed')(path.join(dir, 'x.mp4'))).toBe('unavailable');
  });

  it('end to end: inventory, sample, probe a real ZIP; flags match, manifest untouched', async () => {
    const goodF = readFileSync(make('a.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']));
    const f444 = readFileSync(make('b.mp4', ['-map', '0:v', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']));
    const audioOnly = readFileSync(make('c.mp4', ['-map', '1:a', '-c:a', 'aac']));
    const trunc = goodF.subarray(0, 64);
    const z = path.join(dir, 'real.zip');
    const w = path.join(dir, 'w');
    writeFileSync(z, buildZip([
      { name: 'Good Clip.mp4', data: goodF }, { name: 'Wide Chroma.mp4', data: f444 },
      { name: 'Only Sound.mp4', data: audioOnly }, { name: 'Truncated Clip.mp4', data: trunc }
    ]));
    mkdirSync(w, { recursive: true });
    await runInventory({ zipPath: z, workDir: w, probe: null });
    const man = readFileSync(path.join(w, 'manifest.jsonl'), 'utf8');
    const recs = parseManifest(man).records.filter((r) => r.status === 'ok');
    expect(recs).toHaveLength(4);
    const sample = path.join(dir, 'sample.txt');
    writeFileSync(sample, recs.map((r) => r.sha256).join('\n') + '\n');

    const s = await runProbe({ zipPath: z, workDir: w, sampleFile: sample });
    expect(s).toMatchObject({ ffprobe: 'available', requested: 4, probed: 3, unreadable: 1, clean: 1, withErrors: 2, withWarningsOnly: 1 });
    const byName = Object.fromEntries(s.records.map((r) => [r.originalFilename, r.flags.map((f) => f.code)]));
    expect(byName).toEqual({
      'Good Clip.mp4': [], 'Wide Chroma.mp4': ['unexpected_pixel_format'], 'Only Sound.mp4': ['no_video_stream'], 'Truncated Clip.mp4': ['ffprobe_unreadable']
    });
    expect(readFileSync(path.join(w, 'manifest.jsonl'), 'utf8')).toBe(man);
    expect(readdirSync(path.join(w, 'tmp'))).toEqual([]);
  });
});
