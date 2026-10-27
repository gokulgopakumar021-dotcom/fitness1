import { readFileSync, statSync } from 'node:fs';
import type { ManifestRecord } from '../../src/types/video';

/**
 * Sample files: a plain-text list of SHA-256 values (one per line; blank lines and lines starting with '#' are
 * ignored) naming exactly which inventoried videos an ingest run may touch. Everything is validated against the
 * manifest BEFORE anything else happens, and every problem is reported together so one run shows all of them.
 */

export class SampleFileError extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
    this.name = 'SampleFileError';
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
export const MAX_SAMPLE_FILE_BYTES = 1024 * 1024;
const MAX_LISTED_PROBLEMS = 20;

export interface SampleEntry { sha256: string; line: number }

function fail(headline: string, problems: string[]): never {
  const shown = problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => `  - ${p}`);
  if (problems.length > MAX_LISTED_PROBLEMS) shown.push(`  - ...and ${problems.length - MAX_LISTED_PROBLEMS} more`);
  throw new SampleFileError(`${headline} (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${shown.join('\n')}`, problems);
}

/** Syntax only: lowercase 64-hex per line. Reports every malformed line. */
export function parseSampleText(text: string): SampleEntry[] {
  const entries: SampleEntry[] = [];
  const problems: string[] = [];
  text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    if (SHA256_RE.test(t)) entries.push({ sha256: t, line: i + 1 });
    else problems.push(`line ${i + 1}: ${JSON.stringify(t.slice(0, 80))} is not a 64-character lowercase hex SHA-256`);
  });
  if (problems.length) fail('Invalid sample file: malformed SHA-256 value(s)', problems);
  if (entries.length === 0) throw new SampleFileError('Invalid sample file: it contains no SHA-256 values');
  return entries;
}

/**
 * Semantics against the manifest: every hash must exist, appear once in the file, and belong to an `ok` record.
 * Returns the manifest records in sample-file order. A hash that only has `duplicate`/`invalid_mp4`/... records is
 * rejected as non-ok; a hash that also has duplicate records is fine because the `ok` record is the one used.
 */
export function validateSampleHashes(entries: SampleEntry[], records: ManifestRecord[]): ManifestRecord[] {
  const ok = new Map<string, ManifestRecord>();
  const notOk = new Map<string, ManifestRecord[]>();
  for (const r of records) {
    if (!r.sha256) continue;
    if (r.status === 'ok') { if (!ok.has(r.sha256)) ok.set(r.sha256, r); }
    else notOk.set(r.sha256, [...(notOk.get(r.sha256) ?? []), r]);
  }

  const problems: string[] = [];
  const firstLine = new Map<string, number>();
  const out: ManifestRecord[] = [];
  for (const e of entries) {
    const seenAt = firstLine.get(e.sha256);
    if (seenAt !== undefined) { problems.push(`line ${e.line}: ${e.sha256} is listed twice (first on line ${seenAt})`); continue; }
    firstLine.set(e.sha256, e.line);
    const rec = ok.get(e.sha256);
    if (rec) { out.push(rec); continue; }
    const others = notOk.get(e.sha256);
    if (others) {
      const statuses = [...new Set(others.map((o) => o.status))].join(', ');
      problems.push(`line ${e.line}: ${e.sha256} is not an ok manifest entry (status: ${statuses}; file: ${others[0].originalFilename})`);
    } else {
      problems.push(`line ${e.line}: ${e.sha256} is not in the manifest`);
    }
  }
  if (problems.length) fail('Sample file does not match the manifest', problems);
  return out;
}

/** Parse + validate text. This is the single entry point the tests and the ingest CLI use. */
export function validateSampleText(text: string, records: ManifestRecord[]): ManifestRecord[] {
  return validateSampleHashes(parseSampleText(text), records);
}

/** Reads the file defensively (missing, directory, huge, binary) and validates it. */
export function loadSampleFile(filePath: string, records: ManifestRecord[]): ManifestRecord[] {
  let st;
  try { st = statSync(filePath); }
  catch (e) { throw new SampleFileError(`Sample file not found or unreadable: ${filePath} (${(e as NodeJS.ErrnoException).code ?? 'error'})`); }
  if (!st.isFile()) throw new SampleFileError(`Sample file is not a regular file: ${filePath}`);
  if (st.size > MAX_SAMPLE_FILE_BYTES) throw new SampleFileError(`Sample file is too large (${st.size} bytes; limit ${MAX_SAMPLE_FILE_BYTES}): ${filePath}`);
  let text: string;
  try { text = readFileSync(filePath, 'utf8'); }
  catch (e) { throw new SampleFileError(`Sample file could not be read: ${filePath} (${(e as NodeJS.ErrnoException).code ?? 'error'})`); }
  if (text.includes('\u0000')) throw new SampleFileError(`Sample file does not look like text: ${filePath}`);
  return validateSampleText(text, records);
}
