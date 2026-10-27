import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getExerciseIndex } from '../../src/data/exerciseIndex';
import type { InventoryStatus, ManifestRecord, ProbeStatus } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { matchNormalizedName, prepareIndex, type PreparedIndex } from '../../src/utils/videoLibrary/matcher';
import { normalizeVideoFilename } from '../../src/utils/videoLibrary/normalize';
import { checkEntryName, extractEntry, isSuspiciousRatio, looksLikeMp4, walkZip } from './zipScan';

/**
 * Resumable archive inventory: validates, hashes, probes and matches every MP4 in a ZIP and appends one JSON
 * line per entry to <workdir>/manifest.jsonl. Nothing is uploaded and no network is used. Re-running skips entries
 * already recorded (same name, CRC and size), so an interrupted run continues where it stopped.
 */

export interface ProbeResult { durationSeconds: number | null; width: number | null; height: number | null }
export type Prober = (filePath: string) => Promise<ProbeResult | 'unavailable'>;

export interface InventoryOptions {
  zipPath: string;
  workDir: string;
  maxFileBytes?: number;
  probe?: Prober | null;
  matchIndex?: PreparedIndex;
  log?: (msg: string) => void;
}

export interface InventorySummary {
  entriesSeen: number;
  entriesSkippedAsAlreadyDone: number;
  byStatus: Partial<Record<InventoryStatus, number>>;
  uniqueVideos: number;
  uniqueBytes: number;
  duplicates: number;
  review: { matched: number; needs_review: number; unmatched: number };
  probe: Partial<Record<ProbeStatus, number>>;
}

export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024; // matches the bucket's file_size_limit

export const ffprobe: Prober = (filePath) =>
  new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', filePath],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return (err as NodeJS.ErrnoException).code === 'ENOENT' ? resolve('unavailable') : reject(err);
        try {
          const j = JSON.parse(stdout);
          const s = j.streams?.[0];
          const d = Number(j.format?.duration);
          resolve({
            durationSeconds: Number.isFinite(d) ? Math.round(d * 100) / 100 : null,
            width: Number.isInteger(s?.width) ? s.width : null,
            height: Number.isInteger(s?.height) ? s.height : null
          });
        } catch (e) { reject(e); }
      }
    );
  });

/**
 * A crash mid-write can leave a partial last line with no newline. The next append would then be glued onto it
 * and lost, so the partial line (never a valid record) is cut off before resuming.
 */
export function repairManifestTail(manifestPath: string): void {
  if (!existsSync(manifestPath)) return;
  const text = readFileSync(manifestPath, 'utf8');
  if (text === '' || text.endsWith('\n')) return;
  truncateSync(manifestPath, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
}

const keyOf = (name: string, crc32: number, size: number) => `${name}\u0000${crc32}\u0000${size}`;

function displayTitle(raw: string): string {
  const t = raw.trim();
  const cased = t === t.toLowerCase() ? t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t;
  return cased.slice(0, 200) || 'Untitled';
}

export async function runInventory(opts: InventoryOptions): Promise<InventorySummary> {
  const log = opts.log ?? (() => {});
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const index = opts.matchIndex ?? prepareIndex(getExerciseIndex());
  const tmpDir = path.join(opts.workDir, 'tmp');
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  repairManifestTail(manifestPath);

  const done = new Set<string>();
  const sha = new Map<string, string>(); // sha256 -> first entryName
  if (existsSync(manifestPath)) {
    const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
    for (const r of records) {
      done.add(keyOf(r.entryName, r.crc32, r.declaredSize));
      if (r.status === 'ok' && r.sha256) sha.set(r.sha256, r.entryName);
    }
    if (errors.length) log(`manifest: ${errors.length} unreadable line(s) ignored; those entries will be re-processed`);
  }

  let seen = 0;
  let skippedDone = 0;
  const append = (r: ManifestRecord) => appendFileSync(manifestPath, JSON.stringify(r) + '\n');

  await walkZip(opts.zipPath, async (entry, zip) => {
    if (entry.isDirectory) return;
    seen++;
    if (done.has(keyOf(entry.name, entry.crc32, entry.declaredSize))) { skippedDone++; return; }

    const originalFilename = (entry.name.split(/[\\/]/).pop() || entry.name).slice(0, 255);
    const n = normalizeVideoFilename(originalFilename);
    const base: ManifestRecord = {
      entryIndex: entry.index,
      entryName: entry.name,
      originalFilename,
      crc32: entry.crc32,
      declaredSize: entry.declaredSize,
      status: 'ok',
      sha256: null,
      sizeBytes: null,
      probe: 'skipped',
      durationSeconds: null,
      width: null,
      height: null,
      title: displayTitle(n.title),
      match: null
    };
    const finish = (status: InventoryStatus, detail?: string, extra: Partial<ManifestRecord> = {}) => {
      const rec = { ...base, ...extra, status, ...(detail ? { detail } : {}) };
      append(rec);
      log(`${status.padEnd(16)} ${entry.name}${detail ? ` (${detail})` : ''}`);
    };

    const nameCheck = checkEntryName(entry.name);
    if (!nameCheck.ok) return finish('unsafe_path', nameCheck.reason);
    if (entry.isSymlink) return finish('symlink', 'symlink entries are never extracted');
    if (entry.name.startsWith('__MACOSX/') || originalFilename.startsWith('._')) return finish('skipped_non_mp4', 'macOS metadata file');
    if (!/\.mp4$/i.test(originalFilename)) return finish('skipped_non_mp4', 'not an .mp4 file');
    if (entry.declaredSize > maxBytes) return finish('too_large', `${entry.declaredSize} bytes exceeds the ${maxBytes}-byte limit`);
    if (isSuspiciousRatio(entry)) return finish('suspicious_ratio', 'compression ratio looks like a zip bomb');

    let extracted;
    try {
      extracted = await extractEntry(zip, entry, tmpDir, maxBytes);
    } catch (e) {
      rmSync(path.join(tmpDir, `e${entry.index}.part`), { force: true });
      const msg = e instanceof Error ? e.message : String(e);
      return finish(/size|bytes/i.test(msg) ? 'size_mismatch' : 'read_error', msg);
    }

    try {
      const common = { sha256: extracted.sha256, sizeBytes: extracted.bytes };
      if (extracted.bytes === 0 || !looksLikeMp4(extracted.head)) return finish('invalid_mp4', 'not an MP4 container', common);

      const first = sha.get(extracted.sha256);
      if (first !== undefined) return finish('duplicate', undefined, { ...common, duplicateOf: first });

      let probe: ProbeStatus = 'skipped';
      let meta = { durationSeconds: null as number | null, width: null as number | null, height: null as number | null };
      if (opts.probe) {
        try {
          const p = await opts.probe(extracted.filePath);
          if (p === 'unavailable') probe = 'unavailable';
          else { probe = 'ok'; meta = p; }
        } catch {
          // ffprobe is present but cannot read the file: treat as unreadable/corrupt.
          return finish('invalid_mp4', 'ffprobe could not read the file', { ...common, probe: 'failed' });
        }
      }
      sha.set(extracted.sha256, entry.name);
      finish('ok', undefined, { ...common, probe, ...meta, match: matchNormalizedName(n.normalized, n.tokens, index) });
    } finally {
      rmSync(extracted.filePath, { force: true });
    }
  });

  const summary = summarize(manifestPath);
  summary.entriesSeen = seen;
  summary.entriesSkippedAsAlreadyDone = skippedDone;
  writeFileSync(path.join(opts.workDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeReviewCsv(manifestPath, path.join(opts.workDir, 'review.csv'));
  return summary;
}

export function summarize(manifestPath: string): InventorySummary {
  const { records } = parseManifest(readFileSync(manifestPath, 'utf8'));
  const s: InventorySummary = {
    entriesSeen: records.length,
    entriesSkippedAsAlreadyDone: 0,
    byStatus: {},
    uniqueVideos: 0,
    uniqueBytes: 0,
    duplicates: 0,
    review: { matched: 0, needs_review: 0, unmatched: 0 },
    probe: {}
  };
  for (const r of records) {
    s.byStatus[r.status] = (s.byStatus[r.status] ?? 0) + 1;
    if (r.status === 'duplicate') s.duplicates++;
    if (r.status !== 'ok') continue;
    s.uniqueVideos++;
    s.uniqueBytes += r.sizeBytes ?? 0;
    s.probe[r.probe] = (s.probe[r.probe] ?? 0) + 1;
    const rs = r.match?.reviewStatus ?? 'unmatched';
    if (rs === 'matched' || rs === 'needs_review' || rs === 'unmatched') s.review[rs]++;
  }
  return s;
}

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Everything a human must look at: ambiguous, fuzzy and unmatched videos, with the suggestion if any. */
export function writeReviewCsv(manifestPath: string, outPath: string): void {
  const { records } = parseManifest(readFileSync(manifestPath, 'utf8'));
  const lines = ['sha256,original_filename,title,review_status,reason,suggested_key,confidence,candidates'];
  for (const r of records) {
    if (r.status !== 'ok' || !r.match || r.match.reviewStatus === 'matched') continue;
    lines.push([
      r.sha256, r.originalFilename, r.title, r.match.reviewStatus, r.match.reason, r.match.suggestedKey ?? '', r.match.confidence,
      r.match.candidates.map((c) => `${c.key}:${c.score}`).join(' ')
    ].map(csv).join(','));
  }
  writeFileSync(outPath, lines.join('\n') + '\n');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const zipPath = arg('zip');
  if (!zipPath) {
    console.error('Usage: npm run video:inventory -- --zip <archive.zip> [--workdir .video-library] [--no-probe] [--max-file-mb 100]');
    process.exit(2);
  }
  const workDir = arg('workdir') ?? '.video-library';
  mkdirSync(workDir, { recursive: true });
  const summary = await runInventory({
    zipPath,
    workDir,
    maxFileBytes: arg('max-file-mb') ? Number(arg('max-file-mb')) * 1024 * 1024 : undefined,
    probe: process.argv.includes('--no-probe') ? null : ffprobe,
    log: (m) => console.log(m)
  });
  console.log('\nInventory summary (measured from this archive):');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nManifest: ${path.join(workDir, 'manifest.jsonl')}\nReview list: ${path.join(workDir, 'review.csv')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
