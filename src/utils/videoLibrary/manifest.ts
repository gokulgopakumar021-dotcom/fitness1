import type { InventoryStatus, ManifestRecord, MatchResult, ProbeStatus } from '../../types/video';

/** Parsing and validation of manifest.jsonl lines. Hand-written (no schema library is installed). */

const INVENTORY_STATUSES: readonly InventoryStatus[] = [
  'ok', 'duplicate', 'invalid_mp4', 'unsafe_path', 'suspicious_ratio', 'symlink', 'size_mismatch', 'too_large', 'read_error', 'skipped_non_mp4'
];
const PROBE_STATUSES: readonly ProbeStatus[] = ['ok', 'failed', 'unavailable', 'skipped'];
const REVIEW = ['matched', 'needs_review', 'unmatched', 'rejected'];
const METHODS = ['exact_key', 'exact_name', 'exact_alias', 'fuzzy', 'manual', 'none'];
const SHA256_RE = /^[0-9a-f]{64}$/;

export class ManifestError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nullableNum = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

function validateMatch(m: unknown): MatchResult | null {
  if (m === null) return null;
  if (!isObj(m)) throw new ManifestError('match must be an object or null');
  if (!METHODS.includes(m.method as string)) throw new ManifestError('match.method invalid');
  if (!REVIEW.includes(m.reviewStatus as string)) throw new ManifestError('match.reviewStatus invalid');
  if (typeof m.confidence !== 'number' || m.confidence < 0 || m.confidence > 1) throw new ManifestError('match.confidence out of range');
  if (m.exerciseKey !== null && typeof m.exerciseKey !== 'string') throw new ManifestError('match.exerciseKey invalid');
  if (m.reviewStatus === 'matched' && !m.exerciseKey) throw new ManifestError('a matched video must have an exerciseKey');
  if (!Array.isArray(m.candidates)) throw new ManifestError('match.candidates must be an array');
  return m as unknown as MatchResult;
}

export function validateManifestRecord(value: unknown): ManifestRecord {
  if (!isObj(value)) throw new ManifestError('record must be an object');
  const r = value;
  if (!Number.isInteger(r.entryIndex) || (r.entryIndex as number) < 0) throw new ManifestError('entryIndex invalid');
  if (typeof r.entryName !== 'string' || !r.entryName) throw new ManifestError('entryName invalid');
  if (typeof r.originalFilename !== 'string' || !r.originalFilename || r.originalFilename.length > 255) throw new ManifestError('originalFilename invalid');
  if (!Number.isInteger(r.crc32)) throw new ManifestError('crc32 invalid');
  if (!Number.isInteger(r.declaredSize) || (r.declaredSize as number) < 0) throw new ManifestError('declaredSize invalid');
  if (!INVENTORY_STATUSES.includes(r.status as InventoryStatus)) throw new ManifestError(`status invalid: ${String(r.status)}`);
  if (!PROBE_STATUSES.includes(r.probe as ProbeStatus)) throw new ManifestError('probe invalid');
  if (typeof r.title !== 'string' || !r.title || r.title.length > 200) throw new ManifestError('title invalid');
  for (const f of ['durationSeconds', 'width', 'height'] as const) {
    if (!nullableNum(r[f])) throw new ManifestError(`${f} invalid`);
  }
  if (r.sizeBytes !== null && !(Number.isInteger(r.sizeBytes) && (r.sizeBytes as number) >= 0)) throw new ManifestError('sizeBytes invalid');
  if (r.sha256 !== null && !(typeof r.sha256 === 'string' && SHA256_RE.test(r.sha256))) throw new ManifestError('sha256 invalid');
  // Anything that proceeds to upload must carry a hash and a size.
  if ((r.status === 'ok') && (r.sha256 === null || r.sizeBytes === null || (r.sizeBytes as number) <= 0)) {
    throw new ManifestError('an ok record needs sha256 and a positive sizeBytes');
  }
  if (r.status === 'duplicate' && typeof r.duplicateOf !== 'string') throw new ManifestError('a duplicate needs duplicateOf');
  validateMatch(r.match);
  return r as unknown as ManifestRecord;
}

export interface ManifestParseResult {
  records: ManifestRecord[];
  errors: Array<{ line: number; message: string }>;
}

/** Parses JSONL. Bad lines are reported and skipped, never thrown, so one corrupt line cannot lose the rest. */
export function parseManifest(text: string): ManifestParseResult {
  const records: ManifestRecord[] = [];
  const errors: ManifestParseResult['errors'] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      records.push(validateManifestRecord(JSON.parse(line)));
    } catch (e) {
      errors.push({ line: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return { records, errors };
}

/** Storage object key: content-addressed, so re-ingesting the same file can never create a second object. */
export function storageKeyFor(sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new ManifestError('sha256 invalid');
  return `videos/${sha256.slice(0, 2)}/${sha256}.mp4`;
}
