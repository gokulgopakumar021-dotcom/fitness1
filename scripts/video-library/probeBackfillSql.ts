import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { optionValue, UsageError } from './cli';
import { readProbeSidecar, type ProbeRecord } from './probe';
import { mediaFromProbeRecord } from './probeMedia';

/**
 * Generates a SQL file that fills duration_seconds / width / height on catalog rows that were ingested before ingest
 * wrote them. It only READS <workdir>/probe.jsonl and writes a file: it never connects to Supabase. You review the
 * file and run it yourself in the SQL Editor.
 *
 * Safety: the UPDATE touches only those three columns, only where the column is still NULL (a value already there is
 * kept), and only rows whose content_sha256 is listed. It never touches review_status, exercise_key, status or
 * published, so manual review decisions and visibility are unaffected. Re-running it is harmless.
 */

const SHA = /^[0-9a-f]{64}$/;

export interface BackfillResult { sql: string; rows: number; skipped: number }

export function buildBackfillSql(records: readonly ProbeRecord[]): BackfillResult {
  const latest = new Map<string, ProbeRecord>(); // later lines win, like the probe's own merge
  for (const r of records) if (typeof r.sha256 === 'string') latest.set(r.sha256, r);
  const values: string[] = [];
  let skipped = 0;
  for (const [sha, rec] of latest) {
    const m = mediaFromProbeRecord(rec);
    if (!SHA.test(sha) || (m.duration_seconds === null && m.width === null && m.height === null)) { skipped++; continue; }
    const dur = m.duration_seconds === null ? 'null::numeric' : m.duration_seconds.toFixed(2);
    values.push(`    ('${sha}', ${dur}, ${m.width ?? 'null::integer'}, ${m.height ?? 'null::integer'})`);
  }
  const header = [
    '-- Backfill duration_seconds / width / height from probe.jsonl. Generated: review, then run in the SQL Editor.',
    '-- Fills only columns that are still NULL. Does not touch review_status, exercise_key, status or published.',
    `-- ${values.length} row(s); ${skipped} probe record(s) skipped (no usable media values).`
  ];
  if (!values.length) return { sql: `${header.join('\n')}\n-- Nothing to update.\n`, rows: 0, skipped };
  const sql = `${header.join('\n')}
update public.exercise_videos v
set duration_seconds = coalesce(v.duration_seconds, p.duration_seconds),
    width            = coalesce(v.width, p.width),
    height           = coalesce(v.height, p.height)
from (values
${values.join(',\n')}
) as p(content_sha256, duration_seconds, width, height)
where v.content_sha256 = p.content_sha256
  and (v.duration_seconds is null or v.width is null or v.height is null);
`;
  return { sql, rows: values.length, skipped };
}

const USAGE = 'Usage: npm run video:backfill-media -- [--workdir .video-library] [--out <file.sql>]';

function main() {
  const workDir = optionValue(process.argv.slice(2), 'workdir') ?? '.video-library';
  const out = optionValue(process.argv.slice(2), 'out') ?? path.join(workDir, 'backfill_media.sql');
  const { records, skipped } = readProbeSidecar(path.join(workDir, 'probe.jsonl'));
  if (skipped) console.log(`probe.jsonl: ${skipped} unreadable line(s) ignored`);
  const res = buildBackfillSql(records);
  writeFileSync(out, res.sql);
  console.log(`Wrote ${out}: ${res.rows} row(s), ${res.skipped} skipped. Nothing was sent to Supabase; review the file and run it yourself.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
    console.error(e instanceof Error ? e.message : e); process.exit(1);
  }
}
