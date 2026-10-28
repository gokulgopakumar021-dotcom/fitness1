import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { optionValue, UsageError } from './cli';
import { csvRow } from './csv';
import { catalogRow } from './ingest';
import { parseSampleText } from './sampleFile';

/**
 * Plans the NEXT batch of videos to ingest. Offline and read-only on the manifest: no ZIP, no network, no Supabase.
 * It writes three local files under <workdir>/batches/ and never overwrites an existing one:
 *
 *   batch-NN.txt          sample file (one SHA-256 per line) to pass to video:probe and video:ingest
 *   batch-NN.plan.csv     what each video would become in the catalog (review status, suggested key, size, path)
 *   batch-NN.publish.sql  supabase/manual/publish_videos.sql with this batch's hashes filled in. NOT run by anything.
 *
 * Which videos are eligible: manifest records with status 'ok', minus every hash that is already uploaded
 * (ingest-state.json), is in sample.txt, or is in an earlier batch-*.txt. Because earlier batch files are excluded
 * too, running this twice before ingesting produces batch 02 from the videos AFTER batch 01 rather than renumbering
 * batch 01, and a batch file you already probed or ingested is never changed.
 *
 * Order: normalized title, then archive path. Same-named videos (girl/ and men/ folders) are one group and are kept
 * in the same batch whenever the group fits, so a later review sees both variants together. A group larger than the
 * batch limits is split.
 *
 * Planning a batch maps nothing, approves nothing and publishes nothing.
 */

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_BATCH_MAX_BYTES = 100 * 1024 * 1024;
export const BATCH_FILE_RE = /^batch-(\d{2,})\.txt$/;

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

export interface BatchLimits { size: number; maxBytes: number }

const groupKey = (r: ManifestRecord) => r.title.trim().replace(/\s+/g, ' ').toLowerCase();
const byPath = (a: ManifestRecord, b: ManifestRecord) => a.entryName.toLowerCase().localeCompare(b.entryName.toLowerCase()) || a.entryName.localeCompare(b.entryName);

export interface BatchPick {
  records: ManifestRecord[];
  /** Eligible videos not in this batch (they stay for later batches). */
  remaining: number;
  remainingBytes: number;
  eligible: number;
}

/** Pure selection of the next batch from the eligible records. `excluded` holds hashes that must never be picked. */
export function pickNextBatch(records: ManifestRecord[], excluded: ReadonlySet<string>, limits: BatchLimits): BatchPick {
  if (!Number.isSafeInteger(limits.size) || limits.size < 1) throw new BatchError(`--size must be a whole number of at least 1, got ${limits.size}`);
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) throw new BatchError(`--max-mb must be a positive whole number`);

  const seen = new Set<string>();
  const eligible: ManifestRecord[] = [];
  for (const r of records) {
    if (r.status !== 'ok' || !r.sha256 || excluded.has(r.sha256) || seen.has(r.sha256)) continue;
    seen.add(r.sha256);
    eligible.push(r);
  }

  const groups = new Map<string, ManifestRecord[]>();
  for (const r of eligible) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r]);
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, g]) => [...g].sort(byPath));

  const picked: ManifestRecord[] = [];
  let bytes = 0;
  const fits = (n: number, b: number) => picked.length + n <= limits.size && bytes + b <= limits.maxBytes;
  for (const g of ordered) {
    const gBytes = g.reduce((n, r) => n + (r.sizeBytes ?? 0), 0);
    if (fits(g.length, gBytes)) { picked.push(...g); bytes += gBytes; continue; }
    if (picked.length > 0) break; // keep the group whole for the next batch
    // The group alone exceeds the limits: take as many of its videos as fit (at least one).
    for (const r of g) {
      const b = r.sizeBytes ?? 0;
      if (picked.length > 0 && !fits(1, b)) break;
      picked.push(r); bytes += b;
    }
    break;
  }

  const pickedSet = new Set(picked.map((r) => r.sha256));
  const rest = eligible.filter((r) => !pickedSet.has(r.sha256));
  return { records: picked, remaining: rest.length, remainingBytes: rest.reduce((n, r) => n + (r.sizeBytes ?? 0), 0), eligible: eligible.length };
}

/** Fills the hash list of supabase/manual/publish_videos.sql. Fails loudly if the template no longer has the expected shape. */
export function renderPublishSql(template: string, hashes: readonly string[], label: string): string {
  const re = /(batch\s+text\[\]\s*:=\s*array\[)[\s\S]*?(\n?\s*\];)/;
  if (!re.test(template)) throw new BatchError('supabase/manual/publish_videos.sql no longer has the expected "batch text[] := array[ ... ];" block; refusing to generate a publish file from it.');
  if (hashes.length === 0) throw new BatchError('no hashes to publish');
  const list = hashes.map((h, i) => `    '${h}'${i < hashes.length - 1 ? ',' : ''}`).join('\n');
  const header = `-- GENERATED for ${label} by npm run video:batch. Review it, then run it yourself in the Supabase SQL Editor AFTER this batch is uploaded.\n-- It refuses (and changes nothing) for any hash that is unknown or not status = 'uploaded'.\n\n`;
  return header + template.replace(re, (_m, open: string, close: string) => `${open}\n${list}${close.startsWith('\n') ? close : `\n  ];`}`);
}

export const BATCH_PLAN_HEADER = [
  'batch', 'order', 'sha256', 'review_status', 'original_filename', 'entry_path', 'title', 'size_bytes',
  'exercise_key', 'suggested_exercise_key', 'match_method', 'match_confidence'
];

export function batchPlanCsv(label: string, records: ManifestRecord[]): string {
  const lines = [BATCH_PLAN_HEADER.join(',')];
  records.forEach((r, i) => {
    const row = catalogRow(r);
    lines.push(csvRow([label, i + 1, r.sha256, row.review_status, r.originalFilename, r.entryName, r.title, r.sizeBytes, row.exercise_key ?? '', row.suggested_exercise_key ?? '', row.match_method, row.match_confidence]));
  });
  return lines.join('\n') + '\n';
}

function uploadedHashes(statePath: string): Set<string> {
  if (!existsSync(statePath)) return new Set();
  let s: unknown;
  try { s = JSON.parse(readFileSync(statePath, 'utf8')); }
  catch { throw new BatchError(`${statePath} is not valid JSON; refusing to plan a batch without knowing what is already uploaded.`); }
  const items = (s as { items?: Record<string, { status?: string }> })?.items;
  if (!items || typeof items !== 'object') throw new BatchError(`${statePath} has no "items"; refusing to plan a batch without knowing what is already uploaded.`);
  return new Set(Object.entries(items).filter(([, v]) => v?.status === 'uploaded').map(([k]) => k));
}

function hashesInFile(file: string): string[] {
  return parseSampleText(readFileSync(file, 'utf8')).map((e) => e.sha256);
}

export interface BatchRunOptions {
  workDir: string;
  limits?: Partial<BatchLimits>;
  /** Path of the publish template. Defaults to supabase/manual/publish_videos.sql relative to the repo root. */
  publishTemplate?: string;
  log?: (m: string) => void;
}

export interface BatchRunResult extends BatchPick {
  label: string;
  number: number;
  batchPath: string;
  planPath: string;
  publishSqlPath: string;
  totalBytes: number;
}

export function runBatch(opts: BatchRunOptions): BatchRunResult {
  const limits: BatchLimits = { size: opts.limits?.size ?? DEFAULT_BATCH_SIZE, maxBytes: opts.limits?.maxBytes ?? DEFAULT_BATCH_MAX_BYTES };
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) throw new BatchError(`Manifest not found: ${manifestPath}. Run video:inventory first.`);
  const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (errors.length) throw new BatchError(`manifest has ${errors.length} unreadable line(s) (first: line ${errors[0].line}: ${errors[0].message}); a batch cannot be planned from an incomplete manifest. Re-run the inventory.`);

  const excluded = uploadedHashes(path.join(opts.workDir, 'ingest-state.json'));
  const samplePath = path.join(opts.workDir, 'sample.txt');
  if (existsSync(samplePath)) for (const h of hashesInFile(samplePath)) excluded.add(h);

  const batchDir = path.join(opts.workDir, 'batches');
  let last = 0;
  if (existsSync(batchDir)) {
    for (const name of readdirSync(batchDir)) {
      const m = BATCH_FILE_RE.exec(name);
      if (!m) continue;
      last = Math.max(last, Number(m[1]));
      for (const h of hashesInFile(path.join(batchDir, name))) excluded.add(h);
    }
  }

  const pick = pickNextBatch(records, excluded, limits);
  if (pick.records.length === 0) throw new BatchError('Nothing left to batch: every ok video in the manifest is already uploaded, in sample.txt, or in an earlier batch file.');

  const number = last + 1;
  const label = `batch-${String(number).padStart(2, '0')}`;
  const batchPath = path.join(batchDir, `${label}.txt`);
  const planPath = path.join(batchDir, `${label}.plan.csv`);
  const publishSqlPath = path.join(batchDir, `${label}.publish.sql`);
  for (const p of [batchPath, planPath, publishSqlPath]) if (existsSync(p)) throw new BatchError(`${p} already exists; batch files are never overwritten.`);

  const hashes = pick.records.map((r) => r.sha256!);
  const templatePath = opts.publishTemplate ?? path.resolve('supabase/manual/publish_videos.sql');
  if (!existsSync(templatePath)) throw new BatchError(`Publish template not found: ${templatePath} (run this from the repository root).`);
  const publishSql = renderPublishSql(readFileSync(templatePath, 'utf8'), hashes, label);

  mkdirSync(batchDir, { recursive: true });
  const totalBytes = pick.records.reduce((n, r) => n + (r.sizeBytes ?? 0), 0);
  writeFileSync(batchPath, `# ${label}: ${hashes.length} video(s), ${totalBytes} bytes. Planned only: maps nothing, approves nothing, publishes nothing.\n${hashes.join('\n')}\n`, { flag: 'wx' });
  writeFileSync(planPath, batchPlanCsv(label, pick.records), { flag: 'wx' });
  writeFileSync(publishSqlPath, publishSql, { flag: 'wx' });
  return { ...pick, label, number, batchPath, planPath, publishSqlPath, totalBytes };
}

export const BATCH_USAGE = 'Usage: npm run video:batch -- [--workdir .video-library] [--size 50] [--max-mb 100]';

function parseWhole(argv: readonly string[], name: string): number | undefined {
  const raw = optionValue(argv, name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new UsageError(`--${name} must be a whole number of at least 1, got "${raw}"`);
  return Number(raw);
}

function main() {
  let workDir: string; let size: number | undefined; let maxMb: number | undefined;
  try {
    const argv = process.argv.slice(2);
    workDir = optionValue(argv, 'workdir') ?? '.video-library';
    size = parseWhole(argv, 'size');
    maxMb = parseWhole(argv, 'max-mb');
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${BATCH_USAGE}`); process.exit(2); }
    throw e;
  }
  const r = runBatch({ workDir, limits: { size, maxBytes: maxMb === undefined ? undefined : maxMb * 1024 * 1024 } });
  const counts = { matched: 0, needs_review: 0, unmatched: 0 } as Record<string, number>;
  for (const rec of r.records) counts[rec.match?.reviewStatus ?? 'unmatched']++;
  console.log(`${r.label}: ${r.records.length} video(s), ${r.totalBytes} bytes (matched ${counts.matched}, needs_review ${counts.needs_review}, unmatched ${counts.unmatched}).`);
  console.log(`Still unbatched after this one: ${r.remaining} video(s), ${r.remainingBytes} bytes.`);
  console.log(`Wrote ${r.batchPath}\nWrote ${r.planPath}\nWrote ${r.publishSqlPath}  (not run; you run it yourself after upload)`);
  console.log(`\nNext, in order (nothing below runs automatically):`);
  console.log(`  1. npm run video:probe  -- --zip "%ZIP%" --sample-file ${r.batchPath} --workdir ${workDir}`);
  console.log(`  2. Read ${path.join(workDir, 'probe-flags.csv')}: fix or drop any error-severity video, re-probe.`);
  console.log(`  3. npm run video:ingest -- --zip "%ZIP%" --sample-file ${r.batchPath} --workdir ${workDir}        (dry run)`);
  console.log(`  4. Same command with --execute after setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY yourself.`);
  console.log(`  5. Run ${r.publishSqlPath} in the Supabase SQL Editor.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
