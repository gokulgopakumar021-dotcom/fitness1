import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { optionValue, UsageError } from './cli';
import { csvRow } from './csv';

/**
 * Duplicate-review sidecar. Groups the manifest's `duplicate` entries by SHA-256 and writes
 * <workdir>/duplicates.csv for a human to resolve. It reads only the manifest, never touches the database, and
 * never picks a canonical title: where the names differ, `proposed_canonical_title` and `review_decision` are left
 * blank. (The database has no column for duplicate paths, so this stays a sidecar file.)
 */

export interface DuplicateGroup {
  sha256: string;
  /** Path of the entry that was kept (the first video with these bytes); null if the manifest lost it. */
  keptPath: string | null;
  keptTitle: string | null;
  duplicatePaths: string[];
  /** Same order as duplicatePaths. */
  duplicateTitles: string[];
  /** Titles differ after trimming, collapsing whitespace and ignoring case. */
  titlesDiffer: boolean;
  /** Filled only when every title is byte-for-byte identical; always blank when titles differ. */
  proposedCanonicalTitle: string;
}

export interface DuplicateReport { groups: DuplicateGroup[]; warnings: string[] }

const canon = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

export function groupDuplicates(records: ManifestRecord[]): DuplicateReport {
  const warnings: string[] = [];
  const kept = new Map<string, ManifestRecord>();
  for (const r of records) if (r.status === 'ok' && r.sha256 && !kept.has(r.sha256)) kept.set(r.sha256, r);

  const dupsBySha = new Map<string, ManifestRecord[]>();
  for (const r of records) {
    if (r.status !== 'duplicate') continue;
    if (!r.sha256) { warnings.push(`duplicate entry "${r.entryName}" has no sha256 and was left out`); continue; }
    dupsBySha.set(r.sha256, [...(dupsBySha.get(r.sha256) ?? []), r]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [sha256, dups] of dupsBySha) {
    const k = kept.get(sha256) ?? null;
    if (!k) warnings.push(`${sha256}: no kept (ok) entry in the manifest for ${dups.length} duplicate(s); kept_path left blank`);
    const titles = [...(k ? [k.title] : []), ...dups.map((d) => d.title)];
    const titlesDiffer = new Set(titles.map(canon)).size > 1;
    const identical = new Set(titles).size === 1;
    groups.push({
      sha256,
      keptPath: k?.entryName ?? null,
      keptTitle: k?.title ?? null,
      duplicatePaths: dups.map((d) => d.entryName),
      duplicateTitles: dups.map((d) => d.title),
      titlesDiffer,
      proposedCanonicalTitle: !titlesDiffer && identical ? titles[0] : ''
    });
  }
  // Conflicts first (they need a human), then a stable, order-independent sort. Row order implies no preferred title.
  groups.sort((a, b) =>
    Number(b.titlesDiffer) - Number(a.titlesDiffer) ||
    (a.keptPath ?? '').localeCompare(b.keptPath ?? '') ||
    a.sha256.localeCompare(b.sha256));
  return { groups, warnings };
}

export const DUPLICATES_HEADER = [
  'sha256', 'kept_path', 'duplicate_paths', 'kept_title', 'duplicate_titles', 'titles_differ', 'proposed_canonical_title', 'review_decision'
];

/** Multi-value cells are joined with " | " (duplicate_titles is in the same order as duplicate_paths). */
export function duplicatesCsv(groups: DuplicateGroup[]): string {
  const lines = [DUPLICATES_HEADER.join(',')];
  for (const g of groups) {
    lines.push(csvRow([
      g.sha256, g.keptPath ?? '', g.duplicatePaths.join(' | '), g.keptTitle ?? '', g.duplicateTitles.join(' | '),
      g.titlesDiffer ? 'yes' : 'no', g.proposedCanonicalTitle, ''
    ]));
  }
  return lines.join('\n') + '\n';
}

export interface DuplicatesRunResult extends DuplicateReport { csvPath: string; conflicting: number }

export function runDuplicates(opts: { workDir: string }): DuplicatesRunResult {
  const manifestPath = path.join(opts.workDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}. Run video:inventory first.`);
  const { records, errors } = parseManifest(readFileSync(manifestPath, 'utf8'));
  const report = groupDuplicates(records);
  if (errors.length) report.warnings.push(`manifest has ${errors.length} unreadable line(s); the report may be incomplete`);
  mkdirSync(opts.workDir, { recursive: true });
  const csvPath = path.join(opts.workDir, 'duplicates.csv');
  writeFileSync(csvPath, duplicatesCsv(report.groups));
  return { ...report, csvPath, conflicting: report.groups.filter((g) => g.titlesDiffer).length };
}

function main() {
  let workDir: string;
  try { workDir = optionValue(process.argv.slice(2), 'workdir') ?? '.video-library'; }
  catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\nUsage: npm run video:duplicates -- [--workdir .video-library]`); process.exit(2); }
    throw e;
  }
  const r = runDuplicates({ workDir });
  console.log(`${r.groups.length} duplicate group(s); ${r.conflicting} with differing titles (these need a human decision).`);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  console.log(`Wrote ${r.csvPath}\nNo canonical title was chosen. Fill proposed_canonical_title and review_decision yourself.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
