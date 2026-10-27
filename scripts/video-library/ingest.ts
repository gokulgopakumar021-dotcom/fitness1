import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest, storageKeyFor } from '../../src/utils/videoLibrary/manifest';
import { checkEntryName, extractEntry, looksLikeMp4, walkZip } from './zipScan';
import { optionValue, UsageError } from './cli';
import { loadSampleFile, SampleFileError } from './sampleFile';

export { SampleFileError, loadSampleFile, parseSampleText, validateSampleHashes, validateSampleText } from './sampleFile';

/**
 * Resumable, idempotent upload of inventoried videos. Separate from inventory on purpose.
 *
 * Default is a DRY RUN that touches no network and no archive. `--execute` is required to upload.
 * Per video the order is: insert catalog row as 'pending' -> upload object -> mark row 'uploaded'. A row is
 * therefore never visible to users without its object. Existing rows are never overwritten (insert-only), so
 * review decisions made by a human survive a re-run. Object keys are content-addressed, so re-uploading the
 * same file cannot create a duplicate.
 */

export const BUCKET = 'exercise-videos';

export interface Uploader {
  /** Resolves 'exists' when the (content-addressed) object is already there. */
  uploadObject(storageKey: string, filePath: string, sizeBytes: number): Promise<'uploaded' | 'exists'>;
}

export interface CatalogWriter {
  insertPending(row: Record<string, unknown>): Promise<void>;
  markUploaded(sha256: string): Promise<void>;
  markFailed(sha256: string): Promise<void>;
}

interface StateItem { status: 'uploaded' | 'failed'; attempts: number; error?: string; at: string }
interface State { version: 1; items: Record<string, StateItem> }

export interface IngestOptions {
  zipPath: string;
  workDir: string;
  execute: boolean;
  uploader?: Uploader;
  catalog?: CatalogWriter;
  /** Cap per run, e.g. 30 for the sample stage. */
  limit?: number;
  /** Only upload videos whose automatic match is 'matched' (useful for the sample stage). */
  onlyMatched?: boolean;
  /**
   * Path of a sample file (one SHA-256 per line). When set, ONLY those videos are candidates. Every hash is validated
   * against the manifest first (malformed, unknown, duplicate or non-ok hashes abort the run). The file replaces the
   * selection filters, so it cannot be combined with `limit` or `onlyMatched`. Existing ingest-state is still honoured.
   */
  sampleFile?: string;
  maxFileBytes?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface IngestSummary {
  execute: boolean;
  candidates: number;
  alreadyUploaded: number;
  attempted: number;
  uploaded: number;
  failed: number;
  bytesToUpload: number;
  bytesUploaded: number;
  /** Present only with a sample file: what each video would become in the catalog. */
  plan?: PlanItem[];
}

export interface PlanItem {
  sha256: string;
  entryName: string;
  originalFilename: string;
  reviewStatus: string;
  suggestedExerciseKey: string | null;
  sizeBytes: number | null;
  /** True only for matched videos: the sole rows users can ever see (and only once uploaded). */
  visibleToUsers: boolean;
  alreadyUploaded: boolean;
  intendedRow: Record<string, unknown>;
}

function loadState(p: string): State {
  if (!existsSync(p)) return { version: 1, items: {} };
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    return s?.version === 1 && s.items ? s : { version: 1, items: {} };
  } catch {
    return { version: 1, items: {} };
  }
}
function saveState(p: string, s: State) {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, p); // atomic: a crash never leaves a half-written state file
}

export function catalogRow(r: ManifestRecord): Record<string, unknown> {
  const m = r.match;
  const matched = m?.reviewStatus === 'matched';
  return {
    content_sha256: r.sha256,
    original_filename: r.originalFilename,
    title: r.title,
    exercise_key: matched ? m!.exerciseKey : null,
    suggested_exercise_key: !matched ? m?.suggestedKey ?? null : null,
    storage_key: storageKeyFor(r.sha256!),
    size_bytes: r.sizeBytes,
    duration_seconds: r.durationSeconds,
    width: r.width,
    height: r.height,
    match_method: m?.method ?? 'none',
    match_confidence: m?.confidence ?? 0,
    review_status: m?.reviewStatus ?? 'unmatched',
    status: 'pending'
  };
}

function planFor(records: ManifestRecord[], state: State): PlanItem[] {
  return records.map((r) => {
    const row = catalogRow(r);
    return {
      sha256: r.sha256!,
      entryName: r.entryName,
      originalFilename: r.originalFilename,
      reviewStatus: String(row.review_status),
      suggestedExerciseKey: (row.suggested_exercise_key as string | null) ?? null,
      sizeBytes: r.sizeBytes,
      visibleToUsers: row.review_status === 'matched',
      alreadyUploaded: state.items[r.sha256!]?.status === 'uploaded',
      intendedRow: row
    };
  });
}

function logPlan(plan: PlanItem[], execute: boolean, log: (m: string) => void) {
  const total = plan.reduce((n, p) => n + (p.sizeBytes ?? 0), 0);
  log(`SAMPLE PLAN: ${plan.length} video(s), ${total} bytes. ${execute ? 'EXECUTE mode.' : 'Dry run: nothing is written.'}`);
  log('Each row is inserted as status=pending and only flipped to uploaded after its object is stored. exercise_key stays null unless review_status=matched.');
  plan.forEach((p, i) => {
    log(`[${i + 1}/${plan.length}] sha256: ${p.sha256}`);
    log(`    file: ${p.originalFilename}`);
    log(`    path: ${p.entryName}`);
    log(`    review_status: ${p.reviewStatus} | exercise_key: ${String(p.intendedRow.exercise_key ?? '(none)')} | suggested_exercise_key: ${p.suggestedExerciseKey ?? '(none)'}`);
    log(`    size_bytes: ${p.sizeBytes} | visible to users once uploaded: ${p.visibleToUsers ? 'yes' : 'no'} | already uploaded (ingest-state.json): ${p.alreadyUploaded ? 'yes' : 'no'}`);
    log(`    intended row: ${JSON.stringify(p.intendedRow)}`);
  });
}

export async function runIngest(opts: IngestOptions): Promise<IngestSummary> {
  if (opts.sampleFile !== undefined && (opts.limit !== undefined || opts.onlyMatched)) {
    throw new SampleFileError('--sample-file cannot be combined with --limit or --only-matched: the sample file already names exactly which videos to process.');
  }
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 3;
  const maxBytes = opts.maxFileBytes ?? 100 * 1024 * 1024;
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  const statePath = path.join(opts.workDir, 'ingest-state.json');
  const tmpDir = path.join(opts.workDir, 'tmp');

  const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (errors.length) log(`manifest: ${errors.length} unreadable line(s) ignored`);
  const state = loadState(statePath);

  let candidates: ManifestRecord[];
  if (opts.sampleFile !== undefined) {
    // Strict: a manifest with unreadable lines may be hiding records, so a sample cannot be trusted against it.
    if (errors.length) throw new SampleFileError(`manifest has ${errors.length} unreadable line(s); refusing to use a sample file against an incomplete manifest. Re-run the inventory.`);
    candidates = loadSampleFile(opts.sampleFile, records);
  } else {
    candidates = records.filter((r) => r.status === 'ok' && r.sha256);
    if (opts.onlyMatched) candidates = candidates.filter((r) => r.match?.reviewStatus === 'matched');
  }
  const pending = candidates.filter((r) => state.items[r.sha256!]?.status !== 'uploaded');
  const work = opts.limit !== undefined ? pending.slice(0, opts.limit) : pending;

  const summary: IngestSummary = {
    execute: opts.execute,
    candidates: candidates.length,
    alreadyUploaded: candidates.length - pending.length,
    attempted: 0,
    uploaded: 0,
    failed: 0,
    bytesToUpload: work.reduce((n, r) => n + (r.sizeBytes ?? 0), 0),
    bytesUploaded: 0
  };
  if (opts.sampleFile !== undefined) {
    summary.plan = planFor(candidates, state);
    logPlan(summary.plan, opts.execute, log);
  }
  if (!opts.execute) { log('DRY RUN: nothing was uploaded or written to the catalog.'); return summary; }
  if (!opts.uploader || !opts.catalog) throw new Error('execute mode needs an uploader and a catalog writer');
  const { uploader, catalog } = opts;

  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const wanted = new Map(work.map((r) => [`${r.entryName}\u0000${r.crc32}\u0000${r.declaredSize}`, r]));

  await walkZip(opts.zipPath, async (entry, zip) => {
    if (entry.isDirectory || wanted.size === 0) return;
    const rec = wanted.get(`${entry.name}\u0000${entry.crc32}\u0000${entry.declaredSize}`);
    if (!rec) return;
    wanted.delete(`${entry.name}\u0000${entry.crc32}\u0000${entry.declaredSize}`);
    const sha = rec.sha256!;
    summary.attempted++;

    const fail = async (message: string) => {
      const prev = state.items[sha];
      state.items[sha] = { status: 'failed', attempts: (prev?.attempts ?? 0) + 1, error: message.slice(0, 300), at: new Date().toISOString() };
      saveState(statePath, state);
      summary.failed++;
      log(`FAILED   ${rec.originalFilename}: ${message}`);
      try { await catalog.markFailed(sha); } catch { /* the state file already records the failure */ }
    };

    if (!checkEntryName(entry.name).ok || entry.isSymlink) return fail('entry is no longer safe to read');
    let extracted;
    try {
      extracted = await extractEntry(zip, entry, tmpDir, maxBytes);
    } catch (e) {
      return fail(`extract: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      if (extracted.sha256 !== sha || !looksLikeMp4(extracted.head)) return fail('archive content no longer matches the manifest; re-run the inventory');

      let lastError = '';
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await catalog.insertPending(catalogRow(rec));
          await uploader.uploadObject(storageKeyFor(sha), extracted.filePath, extracted.bytes);
          await catalog.markUploaded(sha);
          const prev = state.items[sha];
          state.items[sha] = { status: 'uploaded', attempts: (prev?.attempts ?? 0) + attempt, at: new Date().toISOString() };
          saveState(statePath, state);
          summary.uploaded++;
          summary.bytesUploaded += extracted.bytes;
          log(`uploaded ${rec.originalFilename}`);
          return;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          if (attempt < maxRetries) await sleep(500 * 2 ** (attempt - 1));
        }
      }
      return fail(`gave up after ${maxRetries} attempts: ${lastError}`);
    } finally {
      rmSync(extracted.filePath, { force: true });
    }
  });

  for (const r of wanted.values()) { summary.failed++; log(`FAILED   ${r.originalFilename}: not found in the archive`); }
  return summary;
}

export const INGEST_USAGE = 'Usage: npm run video:ingest -- --zip <archive.zip> [--workdir .video-library] [--limit N | --only-matched | --sample-file <sample.txt>] [--execute]';

export interface IngestCliOptions {
  zipPath: string;
  workDir: string;
  execute: boolean;
  limit?: number;
  onlyMatched: boolean;
  sampleFile?: string;
}

/** Parses and validates the CLI flags. Pure, so it can be tested. Throws UsageError with a clear message. */
export function parseIngestArgs(argv: readonly string[]): IngestCliOptions {
  const zipPath = optionValue(argv, 'zip');
  if (!zipPath) throw new UsageError('--zip <archive.zip> is required');
  const limitRaw = optionValue(argv, 'limit');
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!/^\d+$/.test(limitRaw) || !Number.isSafeInteger(limit)) throw new UsageError(`--limit must be a whole number, got "${limitRaw}"`);
  }
  const sampleFile = optionValue(argv, 'sample-file');
  const onlyMatched = argv.includes('--only-matched');
  if (sampleFile !== undefined && (limit !== undefined || onlyMatched)) {
    throw new UsageError('--sample-file cannot be combined with --limit or --only-matched: the sample file already names exactly which videos to process.');
  }
  return { zipPath, workDir: optionValue(argv, 'workdir') ?? '.video-library', execute: argv.includes('--execute'), limit, onlyMatched, sampleFile };
}

async function main() {
  let cli: IngestCliOptions;
  try {
    cli = parseIngestArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${INGEST_USAGE}`); process.exit(2); }
    throw e;
  }
  const { execute } = cli;
  const common = {
    zipPath: cli.zipPath,
    workDir: cli.workDir,
    execute,
    limit: cli.limit,
    onlyMatched: cli.onlyMatched,
    sampleFile: cli.sampleFile,
    log: (m: string) => console.log(m)
  };

  if (!execute) {
    const { plan: _plan, ...dry } = await runIngest(common);
    console.log(JSON.stringify(dry, null, 2));
    console.log('\nDry run only. Add --execute (with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set) to upload.');
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell (never in a VITE_* variable or a committed file).');
  const { createClient } = await import('@supabase/supabase-js');
  const { readFileSync: read } = await import('node:fs');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`Uploading to project host: ${new URL(url).host}`);

  const uploader: Uploader = {
    async uploadObject(key, filePath) {
      const { error } = await sb.storage.from(BUCKET).upload(key, read(filePath), { contentType: 'video/mp4', upsert: false });
      if (!error) return 'uploaded';
      if (/already exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) return 'exists';
      throw new Error(error.message);
    }
  };
  const catalog: CatalogWriter = {
    async insertPending(row) {
      const { error } = await sb.from('exercise_videos').upsert(row, { onConflict: 'content_sha256', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    async markUploaded(sha) {
      const { error } = await sb.from('exercise_videos').update({ status: 'uploaded' }).eq('content_sha256', sha);
      if (error) throw new Error(error.message);
    },
    async markFailed(sha) {
      await sb.from('exercise_videos').update({ status: 'failed' }).eq('content_sha256', sha).neq('status', 'uploaded');
    }
  };
  const { plan: _plan, ...done } = await runIngest({ ...common, uploader, catalog });
  console.log(JSON.stringify(done, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
