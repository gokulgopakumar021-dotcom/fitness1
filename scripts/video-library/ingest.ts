import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest, storageKeyFor } from '../../src/utils/videoLibrary/manifest';
import { checkEntryName, extractEntry, looksLikeMp4, walkZip } from './zipScan';

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

export async function runIngest(opts: IngestOptions): Promise<IngestSummary> {
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

  let candidates = records.filter((r) => r.status === 'ok' && r.sha256);
  if (opts.onlyMatched) candidates = candidates.filter((r) => r.match?.reviewStatus === 'matched');
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const zipPath = arg('zip');
  if (!zipPath) {
    console.error('Usage: npm run video:ingest -- --zip <archive.zip> [--workdir .video-library] [--limit N] [--only-matched] [--execute]');
    process.exit(2);
  }
  const execute = process.argv.includes('--execute');
  const workDir = arg('workdir') ?? '.video-library';
  const common = {
    zipPath,
    workDir,
    execute,
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    onlyMatched: process.argv.includes('--only-matched'),
    log: (m: string) => console.log(m)
  };

  if (!execute) {
    console.log(JSON.stringify(await runIngest(common), null, 2));
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
  console.log(JSON.stringify(await runIngest({ ...common, uploader, catalog }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
