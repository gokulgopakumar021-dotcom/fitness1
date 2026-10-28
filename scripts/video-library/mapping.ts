import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getExerciseIndex } from '../../src/data/exerciseIndex';
import type { ExerciseIndexEntry, ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { equipmentFamilies, normalizeVideoFilename, tokenize } from '../../src/utils/videoLibrary/normalize';
import { optionValue, UsageError } from './cli';
import { csvRow, parseCsv } from './csv';

/**
 * Manual exercise-key mapping, KEY-FIRST. Only a few dozen exercise keys exist in the app (the exercise index), so a
 * person reviews "which videos show this exercise?" for each key instead of judging hundreds of videos one by one.
 *
 *   video:map-candidates   reads manifest.jsonl (offline, read-only) and writes mapping/candidates-NN.csv: for every
 *                          exercise key, the best-scoring videos. You fill the `decision` column.
 *   video:map-sql          validates your edited CSV and writes <csv>.map.sql, a guarded SQL file you run yourself in
 *                          the SQL Editor. It appends every decision to mapping/decisions.jsonl.
 *
 * Nothing here connects to Supabase, uploads, publishes or applies anything. Decisions already made are never
 * overwritten: the ledger refuses a different key for a video it already mapped, candidate files skip decided videos
 * and decided (video, key) pairs, and the generated SQL only touches rows that are still needs_review or unmatched.
 */

export const DECISIONS = ['map', 'map_equipment_ok', 'skip'] as const;
export type Decision = (typeof DECISIONS)[number];

export const CANDIDATE_HEADER = ['key', 'key_name', 'rank', 'sha256', 'title', 'entry_path', 'demo', 'score', 'equipment_conflict', 'decision', 'sort_order'];
export const DEFAULT_PER_KEY = 6;
export const DEFAULT_MIN_SCORE = 0.4;
/** New manual mappings sort after anything already mapped (those have sort_order 0). */
export const DEFAULT_SORT_BASE = 100;
export const MAX_SORT_ORDER = 9999;

export class MappingError extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
    this.name = 'MappingError';
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9]+(?::[a-z0-9]+)?$/;

/** Which demonstrator the video shows, from the archive folder ("girl" / "men"). Empty when the path says neither. */
export function demoOf(entryName: string): 'female' | 'male' | '' {
  const parts = entryName.replace(/\\/g, '/').toLowerCase().split('/');
  if (parts.includes('girl')) return 'female';
  if (parts.includes('men')) return 'male';
  return '';
}

const demoTags = (entryName: string): string[] => {
  const d = demoOf(entryName);
  return d ? [`demo:${d}`] : [];
};

// ---------------------------------------------------------------- scoring

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

interface PreparedKey { entry: ExerciseIndexEntry; forms: Set<string>[]; equipment: Set<string> }

function prepareKeys(index: readonly ExerciseIndexEntry[]): PreparedKey[] {
  return index.map((entry) => ({
    entry,
    forms: [entry.name, ...entry.aliases].map((s) => new Set(tokenize(s))),
    equipment: equipmentFamilies(tokenize(entry.name))
  }));
}

function equipmentConflict(videoTokens: string[], key: PreparedKey): boolean {
  const v = equipmentFamilies(videoTokens);
  return v.size > 0 && key.equipment.size > 0 && ![...v].some((e) => key.equipment.has(e));
}

/** Best token overlap between a video title and the key's name or any alias, 0..1. A suggestion, never a decision. */
export function scoreVideoForKey(title: string, entry: ExerciseIndexEntry): { score: number; equipmentConflict: boolean } {
  const [prepared] = prepareKeys([entry]);
  const tokens = normalizeVideoFilename(title).tokens;
  const set = new Set(tokens);
  return { score: round2(Math.max(0, ...prepared.forms.map((f) => jaccard(set, f)))), equipmentConflict: equipmentConflict(tokens, prepared) };
}

// ---------------------------------------------------------------- ledger

export interface LedgerEntry { sha256: string; key: string; decision: 'map' | 'skip'; sortOrder?: number; equipmentConfirmed?: boolean; at: string }

export function parseLedger(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      if (!SHA256_RE.test(e.sha256) || !KEY_RE.test(e.key) || (e.decision !== 'map' && e.decision !== 'skip')) throw new Error('not a ledger entry');
      out.push(e);
    } catch { problems.push(`line ${i + 1} is not a valid ledger entry`); }
  });
  // The ledger is the record of what was decided. A damaged one must stop the run, not be skipped over.
  if (problems.length) throw new MappingError(`decisions.jsonl is damaged (${problems.length} problem${problems.length === 1 ? '' : 's'}); refusing to continue so no decision is repeated or contradicted.\n${problems.map((p) => `  - ${p}`).join('\n')}`, problems);
  return out;
}

export interface LedgerView {
  mappedTo: Map<string, string>;
  skipped: Set<string>;
}

export function viewLedger(entries: readonly LedgerEntry[]): LedgerView {
  const mappedTo = new Map<string, string>();
  const skipped = new Set<string>();
  for (const e of entries) {
    if (e.decision === 'map') mappedTo.set(e.sha256, e.key);
    else skipped.add(`${e.sha256}\u0000${e.key}`);
  }
  return { mappedTo, skipped };
}

// ---------------------------------------------------------------- candidates

export interface CandidateRow {
  key: string; keyName: string; rank: number; sha256: string; title: string; entryPath: string;
  demo: string; score: number; equipmentConflict: boolean;
}

const okVideos = (records: readonly ManifestRecord[]): ManifestRecord[] => {
  const seen = new Set<string>();
  return records.filter((r) => r.status === 'ok' && r.sha256 && !seen.has(r.sha256) && !!seen.add(r.sha256));
};

export function buildCandidates(
  records: readonly ManifestRecord[],
  index: readonly ExerciseIndexEntry[],
  ledger: LedgerView,
  opts: { perKey?: number; minScore?: number } = {}
): CandidateRow[] {
  const perKey = opts.perKey ?? DEFAULT_PER_KEY;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  if (!Number.isSafeInteger(perKey) || perKey < 1) throw new MappingError(`--per-key must be a whole number of at least 1, got ${perKey}`);
  if (!(minScore >= 0 && minScore <= 1)) throw new MappingError(`--min-score must be between 0 and 1, got ${minScore}`);

  // Already auto-matched videos and already mapped videos are finished: they are not offered again.
  const open = okVideos(records).filter((r) => r.match?.reviewStatus !== 'matched' && !ledger.mappedTo.has(r.sha256!));
  const prepared = prepareKeys(index);
  const out: CandidateRow[] = [];
  for (const key of prepared) {
    const rows = open
      .filter((r) => !ledger.skipped.has(`${r.sha256}\u0000${key.entry.key}`))
      .map((r) => {
        const tokens = normalizeVideoFilename(r.title).tokens;
        const set = new Set(tokens);
        return { r, score: round2(Math.max(0, ...key.forms.map((f) => jaccard(set, f)))), conflict: equipmentConflict(tokens, key) };
      })
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title) || a.r.entryName.localeCompare(b.r.entryName))
      .slice(0, perKey);
    rows.forEach((x, i) => out.push({
      key: key.entry.key, keyName: key.entry.name, rank: i + 1, sha256: x.r.sha256!, title: x.r.title, entryPath: x.r.entryName,
      demo: demoOf(x.r.entryName), score: x.score, equipmentConflict: x.conflict
    }));
  }
  return out;
}

export function candidatesCsv(rows: readonly CandidateRow[]): string {
  const lines = [CANDIDATE_HEADER.map((h) => `"${h}"`).join(',')];
  for (const r of rows) lines.push(csvRow([r.key, r.keyName, r.rank, r.sha256, r.title, r.entryPath, r.demo, r.score, r.equipmentConflict ? 'yes' : '', '', '']));
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- decisions

export interface MapDecision { sha256: string; key: string; decision: 'map' | 'skip'; sortOrder: number | null; equipmentConfirmed: boolean; entryPath: string }

const fail = (headline: string, problems: string[]): never => {
  const shown = problems.slice(0, 25).map((p) => `  - ${p}`);
  if (problems.length > 25) shown.push(`  - ...and ${problems.length - 25} more`);
  throw new MappingError(`${headline} (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${shown.join('\n')}`, problems);
};

/** Parses and validates an edited candidates CSV. Every problem is reported together; nothing is partially accepted. */
export function validateDecisionsCsv(
  csvText: string,
  index: readonly ExerciseIndexEntry[],
  records: readonly ManifestRecord[],
  ledger: LedgerView
): MapDecision[] {
  const table = parseCsv(csvText);
  if (table.length === 0) throw new MappingError('The CSV is empty.');
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const missing = ['key', 'sha256', 'decision'].filter((c) => col(c) === -1);
  if (missing.length) throw new MappingError(`The CSV is missing required column(s): ${missing.join(', ')}.`);
  if (new Set(header).size !== header.length) throw new MappingError('The CSV has a duplicated column name.');

  const keys = new Map(prepareKeys(index).map((k) => [k.entry.key, k]));
  const byHash = new Map(okVideos(records).map((r) => [r.sha256!, r]));
  const problems: string[] = [];
  const out: MapDecision[] = [];
  const seenPair = new Set<string>();
  const mapKeyOf = new Map<string, string>();

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (name: string) => (col(name) === -1 ? '' : (cells[col(name)] ?? '').trim());
    const raw = get('decision').toLowerCase();
    if (!raw) return; // undecided: not recorded, offered again next time
    const key = get('key');
    const sha = get('sha256');
    const at = `line ${line}`;
    if (!(DECISIONS as readonly string[]).includes(raw)) { problems.push(`${at}: decision "${raw}" is not one of ${DECISIONS.join(', ')} (leave it blank if undecided)`); return; }
    const decision = raw as Decision;
    const prepared = keys.get(key);
    if (!prepared) { problems.push(`${at}: "${key}" is not an exercise key in the app's exercise index`); return; }
    if (!SHA256_RE.test(sha)) { problems.push(`${at}: sha256 is not 64 lowercase hex characters`); return; }
    const rec = byHash.get(sha);
    if (!rec) { problems.push(`${at}: ${sha} is not an ok video in the manifest`); return; }
    const pair = `${sha}\u0000${key}`;
    if (seenPair.has(pair)) { problems.push(`${at}: ${sha} is listed twice for ${key}`); return; }
    seenPair.add(pair);

    if (decision === 'skip') { out.push({ sha256: sha, key, decision: 'skip', sortOrder: null, equipmentConfirmed: false, entryPath: rec.entryName }); return; }

    if (rec.match?.reviewStatus === 'matched') { problems.push(`${at}: "${rec.title}" is already auto-matched to ${rec.match.exerciseKey}; nothing to map`); return; }
    const earlier = mapKeyOf.get(sha);
    if (earlier && earlier !== key) { problems.push(`${at}: ${sha} is mapped to both ${earlier} and ${key}; a video has one exercise key`); return; }
    mapKeyOf.set(sha, key);
    const prior = ledger.mappedTo.get(sha);
    if (prior && prior !== key) { problems.push(`${at}: "${rec.title}" was already mapped to ${prior} in decisions.jsonl; earlier decisions are never overwritten`); return; }
    const conflict = equipmentConflict(normalizeVideoFilename(rec.title).tokens, prepared);
    if (conflict && decision === 'map') { problems.push(`${at}: "${rec.title}" has different equipment from ${prepared.entry.name}; use map_equipment_ok if that is intended, otherwise skip`); return; }

    const sortRaw = get('sort_order');
    let sortOrder: number | null = null;
    if (sortRaw) {
      if (!/^\d+$/.test(sortRaw) || Number(sortRaw) > MAX_SORT_ORDER) { problems.push(`${at}: sort_order "${sortRaw}" must be a whole number from 0 to ${MAX_SORT_ORDER}`); return; }
      sortOrder = Number(sortRaw);
    }
    out.push({ sha256: sha, key, decision: 'map', sortOrder, equipmentConfirmed: conflict, entryPath: rec.entryName });
  });

  if (problems.length) fail('The decisions CSV was not accepted; nothing was written', problems);

  // Blank sort_order: place after existing videos, in file order within each key.
  const seq = new Map<string, number>();
  return out.map((d) => {
    if (d.decision !== 'map' || d.sortOrder !== null) return d;
    const n = seq.get(d.key) ?? 0;
    seq.set(d.key, n + 1);
    return { ...d, sortOrder: Math.min(DEFAULT_SORT_BASE + 10 * n, MAX_SORT_ORDER) };
  });
}

// ---------------------------------------------------------------- SQL

const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The guarded SQL. All-or-nothing. It only changes rows that are still needs_review or unmatched; a row that is already
 * matched (automatically or by an earlier manual decision with a different key) or rejected stops the whole run.
 * Re-running the same file is harmless: rows already mapped manually to the same key are left as they are.
 * It never sets `published`, so mapping a video does not make it visible; publishing stays a separate step.
 */
export function renderMappingSql(decisions: readonly MapDecision[], label: string): string {
  const maps = decisions.filter((d) => d.decision === 'map');
  if (maps.length === 0) throw new MappingError('There are no "map" decisions to write SQL for.');
  for (const d of maps) {
    if (!SHA256_RE.test(d.sha256) || !KEY_RE.test(d.key) || d.sortOrder === null || !Number.isInteger(d.sortOrder)) throw new MappingError('Refusing to render SQL for an invalid decision.');
  }
  const payload = maps.map((d) => ({ sha: d.sha256, key: d.key, sort_order: d.sortOrder, tags: demoTags(d.entryPath).filter((t) => TAG_RE.test(t)) }));
  const json = JSON.stringify(payload, null, 1).replace(/\n\s*/g, ' ');
  return `-- Iron Log: MANUAL exercise-key mapping, ${label}. GENERATED by npm run video:map-sql. YOU run this by hand.
--
-- Where: Supabase Dashboard -> SQL Editor. Review it first. It is NOT a migration and is never applied automatically.
--
-- What it does, in ONE all-or-nothing step, for the ${maps.length} video(s) listed below:
--   sets exercise_key, review_status = 'matched', match_method = 'manual', match_confidence = 1, sort_order, and adds tags.
-- What it refuses (and then changes nothing): a hash that is unknown or not status = 'uploaded', and any row that is
--   already 'matched' (automatically, or manually with a different key) or 'rejected'. Earlier decisions are never overwritten.
-- What it never touches: published (mapping does not make a video visible; run publish_videos.sql for that), status, title.
-- Re-running is harmless: rows already mapped manually to the same key are left as they are.

do $$
declare
  d        jsonb := ${sqlLiteral(json)}::jsonb;
  total    int;
  blocked  int;
  clashing int;
  changed  int;
begin
  create temp table _map on commit drop as
    select * from jsonb_to_recordset(d) as x(sha text, key text, sort_order int, tags jsonb);
  select count(*) into total from _map;

  select count(*) into blocked
  from _map m left join public.exercise_videos v on v.content_sha256 = m.sha
  where v.id is null or v.status <> 'uploaded';
  if blocked > 0 then
    raise exception 'Nothing changed: % video(s) are unknown or not status=uploaded.', blocked;
  end if;

  select count(*) into clashing
  from _map m join public.exercise_videos v on v.content_sha256 = m.sha
  where not (
    v.review_status in ('needs_review', 'unmatched')
    or (v.review_status = 'matched' and v.match_method = 'manual' and v.exercise_key = m.key)
  );
  if clashing > 0 then
    raise exception 'Nothing changed: % video(s) already have a different review decision (matched, rejected or mapped to another key). Decisions are never overwritten.', clashing;
  end if;

  update public.exercise_videos v
  set exercise_key     = m.key,
      review_status    = 'matched',
      match_method     = 'manual',
      match_confidence = 1,
      sort_order       = m.sort_order,
      tags             = array(select distinct t from unnest(v.tags || array(select jsonb_array_elements_text(m.tags))) as t order by t)
  from _map m
  where v.content_sha256 = m.sha
    and v.review_status in ('needs_review', 'unmatched');
  get diagnostics changed = row_count;
  raise notice 'Mapped % video(s); % were already mapped to the same key; % listed.', changed, total - changed, total;
end
$$;

-- Check the result (run after the block above):
select exercise_key, count(*) as videos, count(*) filter (where published) as published
from public.exercise_videos where match_method = 'manual' and status = 'uploaded'
group by exercise_key order by exercise_key;
`;
}

// ---------------------------------------------------------------- files and CLI

const dirOf = (workDir: string) => path.join(workDir, 'mapping');
export const ledgerPath = (workDir: string) => path.join(dirOf(workDir), 'decisions.jsonl');
export const CANDIDATES_FILE_RE = /^candidates-(\d{2,})\.csv$/;

function loadManifest(workDir: string): ManifestRecord[] {
  const p = path.join(workDir, 'manifest.jsonl');
  if (!existsSync(p)) throw new MappingError(`Manifest not found: ${p}. Run video:inventory first.`);
  const { records, errors } = parseManifest(readFileSync(p, 'utf8'));
  if (errors.length) throw new MappingError(`manifest has ${errors.length} unreadable line(s) (first: line ${errors[0].line}: ${errors[0].message}); mapping cannot be planned from an incomplete manifest. Re-run the inventory.`);
  return records;
}

function loadLedger(workDir: string): LedgerEntry[] {
  const p = ledgerPath(workDir);
  return existsSync(p) ? parseLedger(readFileSync(p, 'utf8')) : [];
}

export interface CandidatesRunResult { path: string; rows: number; keysWithCandidates: number; keys: number }

export function runCandidates(opts: { workDir: string; perKey?: number; minScore?: number; index?: readonly ExerciseIndexEntry[] }): CandidatesRunResult {
  const records = loadManifest(opts.workDir);
  const index = opts.index ?? getExerciseIndex();
  const rows = buildCandidates(records, index, viewLedger(loadLedger(opts.workDir)), opts);
  if (rows.length === 0) throw new MappingError('No candidates left: every exercise key either has no similar video or all similar videos are already decided.');
  const dir = dirOf(opts.workDir);
  mkdirSync(dir, { recursive: true });
  const last = Math.max(0, ...readdirSync(dir).map((n) => Number(CANDIDATES_FILE_RE.exec(n)?.[1] ?? 0)));
  const file = path.join(dir, `candidates-${String(last + 1).padStart(2, '0')}.csv`);
  writeFileSync(file, '\uFEFF' + candidatesCsv(rows), { flag: 'wx' }); // BOM so spreadsheet programs read it as UTF-8; never overwrites
  return { path: file, rows: rows.length, keysWithCandidates: new Set(rows.map((r) => r.key)).size, keys: index.length };
}

export interface SqlRunResult { sqlPath: string | null; mapped: number; skipped: number; alreadyRecorded: number }

export function runMapSql(opts: { workDir: string; csvPath: string; index?: readonly ExerciseIndexEntry[]; now?: () => string }): SqlRunResult {
  if (!existsSync(opts.csvPath)) throw new MappingError(`CSV not found: ${opts.csvPath}`);
  const records = loadManifest(opts.workDir);
  const index = opts.index ?? getExerciseIndex();
  const entries = loadLedger(opts.workDir);
  const decisions = validateDecisionsCsv(readFileSync(opts.csvPath, 'utf8'), index, records, viewLedger(entries));
  if (decisions.length === 0) throw new MappingError('The CSV has no decisions: fill the decision column (map, map_equipment_ok or skip) and save it.');

  const recorded = new Set(entries.map((e) => `${e.sha256}\u0000${e.key}\u0000${e.decision}`));
  const fresh = decisions.filter((d) => !recorded.has(`${d.sha256}\u0000${d.key}\u0000${d.decision}`));
  const maps = decisions.filter((d) => d.decision === 'map');

  let sqlPath: string | null = null;
  if (maps.length) {
    sqlPath = opts.csvPath.replace(/\.csv$/i, '') + '.map.sql';
    const sql = renderMappingSql(maps, path.basename(opts.csvPath));
    writeFileSync(sqlPath, sql, { flag: 'wx' }); // never overwrites; written BEFORE the ledger so a failure records nothing
  }
  if (fresh.length) {
    const at = (opts.now ?? (() => new Date().toISOString()))();
    mkdirSync(dirOf(opts.workDir), { recursive: true });
    appendFileSync(ledgerPath(opts.workDir), fresh.map((d) => JSON.stringify({
      sha256: d.sha256, key: d.key, decision: d.decision,
      ...(d.decision === 'map' ? { sortOrder: d.sortOrder ?? undefined, equipmentConfirmed: d.equipmentConfirmed } : {}), at
    } satisfies LedgerEntry)).join('\n') + '\n');
  }
  return { sqlPath, mapped: maps.length, skipped: decisions.length - maps.length, alreadyRecorded: decisions.length - fresh.length };
}

const USAGE = [
  'Usage:',
  '  npm run video:map-candidates -- [--workdir .video-library] [--per-key 6] [--min-score 0.4]',
  '  npm run video:map-sql -- --csv .video-library/mapping/candidates-01.csv [--workdir .video-library]'
].join('\n');

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const workDir = optionValue(argv, 'workdir') ?? '.video-library';
  if (command === 'candidates') {
    const perKeyRaw = optionValue(argv, 'per-key');
    const minRaw = optionValue(argv, 'min-score');
    if (perKeyRaw !== undefined && !/^\d+$/.test(perKeyRaw)) throw new UsageError(`--per-key must be a whole number, got "${perKeyRaw}"`);
    if (minRaw !== undefined && !Number.isFinite(Number(minRaw))) throw new UsageError(`--min-score must be a number, got "${minRaw}"`);
    const r = runCandidates({ workDir, perKey: perKeyRaw === undefined ? undefined : Number(perKeyRaw), minScore: minRaw === undefined ? undefined : Number(minRaw) });
    console.log(`Wrote ${r.path}: ${r.rows} candidate row(s) across ${r.keysWithCandidates} of ${r.keys} exercise keys.`);
    console.log('Open it in a spreadsheet, fill the decision column (map, map_equipment_ok, skip; blank = decide later), save as CSV, then:');
    console.log(`  npm run video:map-sql -- --csv ${r.path} --workdir ${workDir}`);
    return;
  }
  if (command === 'sql') {
    const csvPath = optionValue(argv, 'csv');
    if (!csvPath) throw new UsageError('--csv <file> is required');
    const r = runMapSql({ workDir, csvPath });
    console.log(`Recorded decisions in ${ledgerPath(workDir)} (${r.alreadyRecorded} already recorded earlier).`);
    if (r.sqlPath) console.log(`Wrote ${r.sqlPath}: ${r.mapped} video(s) to map, ${r.skipped} skipped. Review it, then run it yourself in the Supabase SQL Editor AFTER those videos are uploaded. Nothing was sent to Supabase.`);
    else console.log(`${r.skipped} skip decision(s) recorded; there was nothing to map, so no SQL file was written.`);
    return;
  }
  throw new UsageError(`unknown command "${command ?? ''}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
    console.error(e instanceof Error ? e.message : e); process.exit(1);
  }
}
