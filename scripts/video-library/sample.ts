import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { optionValue, UsageError } from './cli';
import { csvRow } from './csv';
import { catalogRow } from './ingest';

/**
 * Builds the agreed 25-video validation sample from an existing manifest. Read-only on the manifest, no ZIP, no
 * network. It writes <workdir>/sample.txt (one SHA-256 per line, for `video:ingest --sample-file`) and
 * <workdir>/sample-plan.csv. Selecting a video here is NOT approval to map or publish it.
 *
 * The selection is fixed, not heuristic: every matched video, every needs_review video, and seven unmatched
 * videos named by exact title. If the manifest disagrees with ANY expectation the run stops with a discrepancy
 * report and writes nothing. It never substitutes a different video.
 */

export const EXPECTED_SAMPLE = {
  matched: 10,
  needsReview: 8,
  unmatchedTitles: [
    'Barbell Reverse Wrist Curl (over-grip)',
    'Dumbbell Behind Back Wrist Curl',
    'Cable Standing Inner Curl',
    'Weighted Standing Curl (weights or lever)',
    'Band Standing Calf Raise',
    'Stretching - Wrist Circles',
    'Treadmill Running'
  ],
  total: 25,
  totalBytes: 13_635_796,
  bytesByStatus: { matched: 6_775_928, needs_review: 3_545_578, unmatched: 3_314_290 }
} as const;

export type SampleExpectation = typeof EXPECTED_SAMPLE;

/** Explicit archive paths permitted for titles duplicated across the girl/men folders. Never resolve by basename. */
export const UNMATCHED_PATH_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  'Barbell Reverse Wrist Curl (over-grip)': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Forearms/Barbell Reverse Wrist Curl (over-grip).mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/Forearms/Barbell Reverse Wrist Curl (over-grip).mp4'
  ],
  'Dumbbell Behind Back Wrist Curl': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Forearms/Dumbbell Behind Back Wrist Curl.mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/Forearms/Dumbbell Behind Back Wrist Curl.mp4'
  ],
  'Cable Standing Inner Curl': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Biceps/Cable Standing Inner Curl.mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/biceps/Cable Standing Inner Curl.mp4'
  ],
  'Band Standing Calf Raise': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Calves/Band Standing Calf Raise.mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/calves/Band Standing Calf Raise.mp4'
  ],
  'Stretching - Wrist Circles': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Forearms/Stretching - Wrist Circles.mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/Forearms/Stretching - Wrist Circles.mp4'
  ],
  'Treadmill Running': [
    'Exercise (whitout watermark)/exercise (whitout watermark)/girl/Cardio/Treadmill Running.mp4',
    'Exercise (whitout watermark)/exercise (whitout watermark)/men/cardio/Treadmill Running.mp4'
  ]
};

export class SampleDiscrepancyError extends Error {
  constructor(readonly discrepancies: string[], readonly facts: string[] = []) {
    super(
      `SAMPLE SELECTION STOPPED: the manifest differs from the agreed sample. Nothing was written and nothing was substituted.\n` +
      discrepancies.map((d) => `  - ${d}`).join('\n') +
      (facts.length ? `\nWhat the manifest actually contains:\n${facts.map((f) => `  * ${f}`).join('\n')}` : '')
    );
    this.name = 'SampleDiscrepancyError';
  }
}

export interface SampleSelection {
  /** Matched first, then needs_review (manifest order), then the seven unmatched in the agreed order. */
  records: ManifestRecord[];
  counts: { matched: number; needs_review: number; unmatched: number };
  bytesByStatus: { matched: number; needs_review: number; unmatched: number };
  totalBytes: number;
}

const reviewOf = (r: ManifestRecord) => r.match?.reviewStatus ?? 'unmatched';
const sum = (rs: ManifestRecord[]) => rs.reduce((n, r) => n + (r.sizeBytes ?? 0), 0);

export function buildSample(records: ManifestRecord[], expected: SampleExpectation = EXPECTED_SAMPLE): SampleSelection {
  const ok = records.filter((r) => r.status === 'ok' && r.sha256);
  const matched = ok.filter((r) => reviewOf(r) === 'matched');
  const needsReview = ok.filter((r) => reviewOf(r) === 'needs_review');
  const unmatchedAll = ok.filter((r) => reviewOf(r) === 'unmatched');
  const facts = [
    `${ok.length} ok video(s): ${matched.length} matched, ${needsReview.length} needs_review, ${unmatchedAll.length} unmatched, ${ok.length - matched.length - needsReview.length - unmatchedAll.length} other`
  ];

  const d: string[] = [];
  if (matched.length !== expected.matched) d.push(`expected ${expected.matched} matched video(s), the manifest has ${matched.length}`);
  if (needsReview.length !== expected.needsReview) d.push(`expected ${expected.needsReview} needs_review video(s), the manifest has ${needsReview.length}`);

  const unmatched: ManifestRecord[] = [];
  const ambiguousGroups: Array<{ title: string; candidates: ManifestRecord[] }> = [];
  for (const title of expected.unmatchedTitles) {
    const withTitle = records.filter((r) => r.title === title);
    const okWithTitle = withTitle.filter((r) => r.status === 'ok' && r.sha256);
    if (okWithTitle.length === 0) {
      d.push(withTitle.length === 0
        ? `title not found (exact match required): "${title}"`
        : `"${title}" exists only as non-ok manifest entries (${[...new Set(withTitle.map((r) => r.status))].join(', ')})`);
      continue;
    }
    const candidates = UNMATCHED_PATH_CANDIDATES[title];
    if (okWithTitle.length > 1) {
      const permitted = candidates ? okWithTitle.filter((r) => candidates.includes(r.entryName.replace(/\\/g, '/'))) : [];
      if (permitted.length !== okWithTitle.length || permitted.length !== candidates?.length) {
        d.push(`"${title}" is ambiguous and does not exactly match the explicitly permitted archive paths (${okWithTitle.map((r) => r.entryName).join('; ')})`);
      } else {
        ambiguousGroups.push({ title, candidates: permitted });
      }
      continue;
    }
    const r = okWithTitle[0];
    if (reviewOf(r) !== 'unmatched') d.push(`"${title}" is ${reviewOf(r)} in the manifest, expected unmatched`);
    else if (r.match?.exerciseKey) d.push(`"${title}" unexpectedly carries exercise key ${r.match.exerciseKey}`);
    else unmatched.push(r);
  }

  // When duplicate basenames are known, choose only if the agreed per-status byte total uniquely identifies
  // one combination. This uses explicit archive paths plus the pre-agreed invariant, never folder-name heuristics.
  if (d.length === 0 && ambiguousGroups.length) {
    const combinations: ManifestRecord[][] = [];
    const enumerate = (index: number, chosen: ManifestRecord[]) => {
      if (index === ambiguousGroups.length) { combinations.push([...chosen]); return; }
      for (const candidate of ambiguousGroups[index].candidates) enumerate(index + 1, [...chosen, candidate]);
    };
    enumerate(0, []);
    const valid = combinations.filter((choice) => {
      const all = [...unmatched, ...choice];
      return all.length === expected.unmatchedTitles.length &&
        new Set(all.map((r) => r.sha256)).size === all.length &&
        all.every((r) => reviewOf(r) === 'unmatched' && !r.match?.exerciseKey) &&
        sum(all) === expected.bytesByStatus.unmatched;
    });
    if (valid.length !== 1) {
      d.push(valid.length === 0
        ? `the explicit girl/men path candidates have no unique combination matching the agreed unmatched byte total ${expected.bytesByStatus.unmatched}`
        : `the explicit girl/men path candidates have ${valid.length} combinations matching the agreed unmatched byte total; refusing to choose arbitrarily`);
    } else {
      unmatched.push(...valid[0]);
      // Preserve the agreed title ordering regardless of which path was selected.
      const unmatchedOrder = new Map<string, number>(expected.unmatchedTitles.map((title, index) => [title, index]));
      unmatched.sort((a, b) => (unmatchedOrder.get(a.title) ?? Number.MAX_SAFE_INTEGER) - (unmatchedOrder.get(b.title) ?? Number.MAX_SAFE_INTEGER));
    }
  }

  const selection = [...matched, ...needsReview, ...unmatched];
  const bytesByStatus = { matched: sum(matched), needs_review: sum(needsReview), unmatched: sum(unmatched) };
  const totalBytes = bytesByStatus.matched + bytesByStatus.needs_review + bytesByStatus.unmatched;

  // Totals are only meaningful once every piece has been found, otherwise they would just repeat the problems above.
  if (d.length === 0) {
    const distinct = new Set(selection.map((r) => r.sha256)).size;
    if (distinct !== expected.total || selection.length !== expected.total) d.push(`expected ${expected.total} distinct SHA-256 values, found ${distinct} across ${selection.length} selected entries`);
    for (const k of ['matched', 'needs_review', 'unmatched'] as const) {
      if (bytesByStatus[k] !== expected.bytesByStatus[k]) d.push(`${k} bytes: expected ${expected.bytesByStatus[k]}, found ${bytesByStatus[k]}`);
    }
    if (totalBytes !== expected.totalBytes) d.push(`total bytes: expected ${expected.totalBytes}, found ${totalBytes}`);
  }
  if (d.length) throw new SampleDiscrepancyError(d, facts);

  return {
    records: selection,
    counts: { matched: matched.length, needs_review: needsReview.length, unmatched: unmatched.length },
    bytesByStatus,
    totalBytes
  };
}

export const SAMPLE_PLAN_HEADER = [
  'order', 'sha256', 'review_status', 'original_filename', 'entry_path', 'title', 'size_bytes',
  'exercise_key', 'suggested_exercise_key', 'match_method', 'match_confidence', 'reason', 'visible_to_users_once_uploaded'
];

export function samplePlanCsv(records: ManifestRecord[]): string {
  const lines = [SAMPLE_PLAN_HEADER.join(',')];
  records.forEach((r, i) => {
    const row = catalogRow(r);
    lines.push(csvRow([
      i + 1, r.sha256, row.review_status, r.originalFilename, r.entryName, r.title, r.sizeBytes,
      row.exercise_key ?? '', row.suggested_exercise_key ?? '', row.match_method, row.match_confidence, r.match?.reason ?? '',
      row.review_status === 'matched' ? 'yes' : 'no'
    ]));
  });
  return lines.join('\n') + '\n';
}

export interface SampleRunOptions { workDir: string; log?: (m: string) => void }
export interface SampleRunResult extends SampleSelection { samplePath: string; planPath: string }

/** Reads the manifest, verifies the selection, and only then writes the two files. */
export function runSample(opts: SampleRunOptions): SampleRunResult {
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}. Run video:inventory first.`);
  const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (errors.length) {
    throw new SampleDiscrepancyError([`manifest has ${errors.length} unreadable line(s) (first: line ${errors[0].line}: ${errors[0].message}); a sample cannot be verified against an incomplete manifest`]);
  }
  const selection = buildSample(records);
  mkdirSync(opts.workDir, { recursive: true });
  const samplePath = path.join(opts.workDir, 'sample.txt');
  const planPath = path.join(opts.workDir, 'sample-plan.csv');
  writeFileSync(samplePath, selection.records.map((r) => r.sha256).join('\n') + '\n');
  writeFileSync(planPath, samplePlanCsv(selection.records));
  return { ...selection, samplePath, planPath };
}

function main() {
  let workDir: string;
  try { workDir = optionValue(process.argv.slice(2), 'workdir') ?? '.video-library'; }
  catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\nUsage: npm run video:sample -- [--workdir .video-library]`); process.exit(2); }
    throw e;
  }
  const r = runSample({ workDir });
  console.log(`Sample verified: ${r.records.length} distinct videos, ${r.totalBytes} bytes.`);
  console.log(`  matched ${r.counts.matched} (${r.bytesByStatus.matched} bytes), needs_review ${r.counts.needs_review} (${r.bytesByStatus.needs_review}), unmatched ${r.counts.unmatched} (${r.bytesByStatus.unmatched})`);
  console.log(`Wrote ${r.samplePath}\nWrote ${r.planPath}`);
  console.log('This is a selection for validation only. It maps nothing and approves nothing. Next: npm run video:ingest -- --zip <zip> --workdir ' + workDir + ' --sample-file ' + r.samplePath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
