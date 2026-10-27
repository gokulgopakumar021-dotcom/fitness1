import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { optionValue, UsageError } from './cli';
import { csvRow } from './csv';
import {
  evaluateMeasurement, EXPECTED_MEDIA, makeFlag, parseFfprobeJson,
  type Flag, type FlagCode, type MediaExpectations, type Measurement
} from './probeAnalysis';
import { loadSampleFile, SampleFileError } from './sampleFile';
import { checkEntryName, extractEntry, looksLikeMp4, walkZip } from './zipScan';

/**
 * Optional ffprobe enrichment, as a separate step. For the videos named in a sample file it extracts each file to a
 * temporary path, runs ffprobe, and records container, codecs, profile, pixel format, dimensions and duration in a
 * SIDECAR (<workdir>/probe.jsonl) plus a review list (<workdir>/probe-flags.csv). The manifest is never modified, and
 * nothing is uploaded or sent over the network. If ffprobe is not installed the step is skipped without error.
 *
 * Passing the checks is not proof of playback on a given iPhone: real-device Safari testing is still required.
 */

export type SidecarStatus = 'probed' | 'unreadable' | 'archive_mismatch' | 'not_in_archive';
const STATUSES: readonly SidecarStatus[] = ['probed', 'unreadable', 'archive_mismatch', 'not_in_archive'];

export interface ProbeRecord {
  version: 1;
  sha256: string;
  entryName: string;
  originalFilename: string;
  reviewStatus: string;
  sizeBytes: number | null;
  probedAt: string;
  status: SidecarStatus;
  detail?: string;
  /** null when the file could not be probed. */
  measurement: Measurement | null;
  flags: Flag[];
}

export type FullProber = (filePath: string) => Promise<Measurement | 'unavailable'>;

/** Real ffprobe. Resolves 'unavailable' when the binary is not installed; rejects when it cannot read the file. */
export function createFfprobe(bin = 'ffprobe'): FullProber {
  return (filePath) => new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '-i', filePath],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return resolve('unavailable');
          const why = String(stderr || err.message).trim().split('\n')[0].slice(0, 200);
          return reject(new Error(`ffprobe could not read the file: ${why}`));
        }
        try { resolve(parseFfprobeJson(stdout)); } catch (e) { reject(e); }
      }
    );
  });
}
export const ffprobeFull: FullProber = createFfprobe();

export interface ProbeOptions {
  zipPath: string;
  workDir: string;
  sampleFile: string;
  prober?: FullProber;
  expected?: MediaExpectations;
  maxFileBytes?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface ProbeSummary {
  ffprobe: 'available' | 'unavailable';
  requested: number;
  probed: number;
  unreadable: number;
  archiveMismatch: number;
  notInArchive: number;
  clean: number;
  withErrors: number;
  withWarningsOnly: number;
  flagCounts: Partial<Record<FlagCode, number>>;
  /** This run's records, in sample-file order. Empty when ffprobe is unavailable. */
  records: ProbeRecord[];
  probePath: string;
  flagsPath: string;
  /** False when nothing was written (ffprobe unavailable). */
  wroteFiles: boolean;
}

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const keyOf = (name: string, crc32: number, size: number) => `${name}\u0000${crc32}\u0000${size}`;

function atomicWrite(p: string, text: string) {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

function baseRecord(rec: ManifestRecord, probedAt: string): Omit<ProbeRecord, 'status' | 'measurement' | 'flags'> {
  return {
    version: 1,
    sha256: rec.sha256!,
    entryName: rec.entryName,
    originalFilename: rec.originalFilename,
    reviewStatus: rec.match?.reviewStatus ?? 'unmatched',
    sizeBytes: rec.sizeBytes,
    probedAt
  };
}

/** Reads an existing sidecar leniently: bad lines are skipped (and counted), never fatal. */
export function readProbeSidecar(file: string): { records: ProbeRecord[]; skipped: number } {
  if (!existsSync(file)) return { records: [], skipped: 0 };
  const records: ProbeRecord[] = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r?.version === 1 && /^[0-9a-f]{64}$/.test(r.sha256) && STATUSES.includes(r.status) && Array.isArray(r.flags)) records.push(r as ProbeRecord);
      else skipped++;
    } catch { skipped++; }
  }
  return { records, skipped };
}

export const FLAGS_HEADER = [
  'sha256', 'original_filename', 'entry_path', 'review_status', 'severity', 'flag', 'detail',
  'container', 'video_codec', 'pixel_format', 'width', 'height', 'duration_seconds'
];

/** One row per flag, errors before warnings. Only records with at least one flag appear. */
export function probeFlagsCsv(records: ProbeRecord[]): string {
  const lines = [FLAGS_HEADER.join(',')];
  const rows = records.flatMap((r) => r.flags.map((f) => ({ r, f })));
  rows.sort((a, b) => Number(b.f.severity === 'error') - Number(a.f.severity === 'error'));
  for (const { r, f } of rows) {
    const m = r.measurement;
    lines.push(csvRow([
      r.sha256, r.originalFilename, r.entryName, r.reviewStatus, f.severity, f.code, f.detail,
      m?.container ?? '', m?.video?.codec ?? '', m?.video?.pixelFormat ?? '', m?.video?.width ?? '', m?.video?.height ?? '', m?.durationSeconds ?? ''
    ]));
  }
  return lines.join('\n') + '\n';
}

export async function runProbe(opts: ProbeOptions): Promise<ProbeSummary> {
  const log = opts.log ?? (() => {});
  const prober = opts.prober ?? ffprobeFull;
  const now = opts.now ?? (() => new Date());
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  const probePath = path.join(opts.workDir, 'probe.jsonl');
  const flagsPath = path.join(opts.workDir, 'probe-flags.csv');
  const tmpDir = path.resolve(opts.workDir, 'tmp');

  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}. Run video:inventory first.`);
  const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (errors.length) throw new SampleFileError(`manifest has ${errors.length} unreadable line(s); refusing to probe against an incomplete manifest. Re-run the inventory.`);
  // Same strict validation as ingest: malformed, unknown, repeated and non-ok hashes abort before anything is read.
  const sample = loadSampleFile(opts.sampleFile, records);
  if (!existsSync(opts.zipPath)) throw new Error(`Archive not found: ${opts.zipPath}`);

  const probedAt = now().toISOString();
  const wanted = new Map(sample.map((r) => [keyOf(r.entryName, r.crc32, r.declaredSize), r]));
  const results = new Map<string, ProbeRecord>();
  const put = (rec: ManifestRecord, status: SidecarStatus, flags: Flag[], extra: Partial<ProbeRecord> = {}) =>
    results.set(rec.sha256!, { ...baseRecord(rec, probedAt), status, measurement: null, flags, ...extra });
  let unavailable = false;

  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  await walkZip(opts.zipPath, async (entry, zip) => {
    if (unavailable || entry.isDirectory || wanted.size === 0) return;
    const k = keyOf(entry.name, entry.crc32, entry.declaredSize);
    const rec = wanted.get(k);
    if (!rec) return;
    wanted.delete(k);

    if (!checkEntryName(entry.name).ok || entry.isSymlink) {
      return void put(rec, 'archive_mismatch', [makeFlag('archive_mismatch', 'entry is no longer safe to read')], { detail: 'entry is no longer safe to read' });
    }
    let extracted;
    try { extracted = await extractEntry(zip, entry, tmpDir, maxBytes); }
    catch (e) {
      const detail = `extract: ${e instanceof Error ? e.message : String(e)}`;
      return void put(rec, 'archive_mismatch', [makeFlag('archive_mismatch', detail)], { detail });
    }
    try {
      if (extracted.sha256 !== rec.sha256 || !looksLikeMp4(extracted.head)) {
        const detail = 'archive content no longer matches the manifest; re-run the inventory';
        return void put(rec, 'archive_mismatch', [makeFlag('archive_mismatch', detail)], { detail });
      }
      let out;
      try { out = await prober(extracted.filePath); }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return void put(rec, 'unreadable', [makeFlag('ffprobe_unreadable', detail)], { detail });
      }
      if (out === 'unavailable') { unavailable = true; return; }
      put(rec, 'probed', evaluateMeasurement(out, opts.expected ?? EXPECTED_MEDIA), { measurement: out });
      log(`probed   ${rec.originalFilename}`);
    } finally {
      rmSync(extracted.filePath, { force: true });
    }
  });

  const empty = { probed: 0, unreadable: 0, archiveMismatch: 0, notInArchive: 0, clean: 0, withErrors: 0, withWarningsOnly: 0, flagCounts: {} };
  if (unavailable) {
    log('ffprobe is not installed or not on PATH: the probe step was skipped and nothing was written.');
    return { ffprobe: 'unavailable', requested: sample.length, ...empty, records: [], probePath, flagsPath, wroteFiles: false };
  }
  for (const rec of wanted.values()) {
    put(rec, 'not_in_archive', [makeFlag('not_in_archive', 'not found in the archive (name, CRC and size must match the manifest)')], { detail: 'not found in the archive' });
  }

  const fresh = sample.map((r) => results.get(r.sha256!)!);

  // Merge by hash: this run replaces its own videos and keeps results from earlier runs for other videos.
  const prior = readProbeSidecar(probePath);
  if (prior.skipped) log(`probe.jsonl: ${prior.skipped} unreadable line(s) from an earlier run were dropped`);
  const merged = new Map(prior.records.map((r) => [r.sha256, r]));
  for (const r of fresh) merged.set(r.sha256, r);
  const all = [...merged.values()];
  mkdirSync(opts.workDir, { recursive: true });
  atomicWrite(probePath, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
  atomicWrite(flagsPath, probeFlagsCsv(all));

  const flagCounts: Partial<Record<FlagCode, number>> = {};
  for (const r of fresh) for (const f of r.flags) flagCounts[f.code] = (flagCounts[f.code] ?? 0) + 1;
  const errored = fresh.filter((r) => r.flags.some((f) => f.severity === 'error'));
  const warned = fresh.filter((r) => r.flags.length > 0 && !r.flags.some((f) => f.severity === 'error'));
  return {
    ffprobe: 'available',
    requested: sample.length,
    probed: fresh.filter((r) => r.status === 'probed').length,
    unreadable: fresh.filter((r) => r.status === 'unreadable').length,
    archiveMismatch: fresh.filter((r) => r.status === 'archive_mismatch').length,
    notInArchive: fresh.filter((r) => r.status === 'not_in_archive').length,
    clean: fresh.filter((r) => r.flags.length === 0).length,
    withErrors: errored.length,
    withWarningsOnly: warned.length,
    flagCounts,
    records: fresh,
    probePath,
    flagsPath,
    wroteFiles: true
  };
}

export const PROBE_USAGE = 'Usage: npm run video:probe -- --zip <archive.zip> --sample-file <sample.txt> [--workdir .video-library]';

export interface ProbeCliOptions { zipPath: string; sampleFile: string; workDir: string }

/** Pure flag parsing. Both --zip and --sample-file are required: probing is limited to a named sample. */
export function parseProbeArgs(argv: readonly string[]): ProbeCliOptions {
  const zipPath = optionValue(argv, 'zip');
  if (!zipPath) throw new UsageError('--zip <archive.zip> is required');
  const sampleFile = optionValue(argv, 'sample-file');
  if (!sampleFile) throw new UsageError('--sample-file <sample.txt> is required (probing is limited to a named sample)');
  return { zipPath, sampleFile, workDir: optionValue(argv, 'workdir') ?? '.video-library' };
}

async function main() {
  let cli: ProbeCliOptions;
  try { cli = parseProbeArgs(process.argv.slice(2)); }
  catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${PROBE_USAGE}`); process.exit(2); }
    throw e;
  }
  const s = await runProbe({ ...cli, log: (m) => console.log(m) });
  if (s.ffprobe === 'unavailable') {
    console.log('\nInstall ffmpeg (it includes ffprobe), make sure `ffprobe -version` works in this terminal, and run this again.');
    console.log('This is not an error: the manifest and the sample are unchanged.');
    return;
  }
  console.log(`\nProbed ${s.probed} of ${s.requested} sample video(s): ${s.clean} without flags, ${s.withWarningsOnly} with warnings only, ${s.withErrors} with errors.`);
  if (s.unreadable || s.archiveMismatch || s.notInArchive) console.log(`Not probed: ${s.unreadable} unreadable, ${s.archiveMismatch} changed in the archive, ${s.notInArchive} missing from the archive.`);
  for (const [code, n] of Object.entries(s.flagCounts)) console.log(`  ${code}: ${n}`);
  console.log(`Wrote ${s.probePath}\nWrote ${s.flagsPath}`);
  console.log('The manifest was not modified. A clean result is not proof of playback: test on a real iPhone in Safari.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
