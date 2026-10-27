import type { InventoryStatus, ManifestRecord, VideoReviewStatus } from '../../src/types/video';
import { validateManifestRecord } from '../../src/utils/videoLibrary/manifest';

/** Deterministic lowercase 64-hex hash for fixture number n. */
export const sha = (n: number): string => n.toString(16).padStart(64, '0');

export interface FixtureOptions {
  n: number;
  title: string;
  review?: VideoReviewStatus;
  size?: number;
  status?: InventoryStatus;
  path?: string;
  /** Overrides the hash (e.g. so a duplicate record shares the kept record's hash). */
  sha?: string | null;
  duplicateOf?: string;
}

/** A schema-valid manifest record. Throws if the fixture itself would be rejected by the real validator. */
export function makeRecord(o: FixtureOptions): ManifestRecord {
  const review = o.review ?? 'unmatched';
  const status = o.status ?? 'ok';
  const match: ManifestRecord['match'] = status !== 'ok' && status !== 'duplicate' ? null
    : review === 'matched'
      ? { exerciseKey: 'barbell-bench-press', suggestedKey: null, method: 'exact_name', confidence: 0.98, reviewStatus: 'matched', reason: 'ok', candidates: [{ key: 'barbell-bench-press', score: 0.98 }] }
      : review === 'needs_review'
        ? { exerciseKey: null, suggestedKey: 'cable-lateral-raise', method: 'fuzzy', confidence: 0.9, reviewStatus: 'needs_review', reason: 'fuzzy_only', candidates: [{ key: 'cable-lateral-raise', score: 0.9 }] }
        : { exerciseKey: null, suggestedKey: null, method: 'none', confidence: 0, reviewStatus: 'unmatched', reason: 'no_match', candidates: [] };
  const file = `${o.title}.mp4`;
  return validateManifestRecord({
    entryIndex: o.n,
    entryName: o.path ?? `Library/${file}`,
    originalFilename: file,
    crc32: o.n + 1,
    declaredSize: o.size ?? 1000,
    status,
    ...(status === 'duplicate' ? { duplicateOf: o.duplicateOf ?? 'Library/first.mp4' } : {}),
    sha256: o.sha === undefined ? sha(o.n) : o.sha,
    sizeBytes: o.size ?? 1000,
    probe: 'skipped',
    durationSeconds: null,
    width: null,
    height: null,
    title: o.title,
    match
  });
}

export const toJsonl = (records: ManifestRecord[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** Small RFC-4180 reader for the quoted CSVs the scripts write. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Manifest shaped like the agreed sample: 10 matched (6,775,928 B), 8 needs_review (3,545,578 B) and the 7 agreed
 * unmatched titles (3,314,290 B), plus entries the selection must ignore (other unmatched videos, a duplicate
 * record, a non-ok record).
 */
export const AGREED_UNMATCHED_TITLES = [
  'Barbell Reverse Wrist Curl (over-grip)',
  'Dumbbell Behind Back Wrist Curl',
  'Cable Standing Inner Curl',
  'Weighted Standing Curl (weights or lever)',
  'Band Standing Calf Raise',
  'Stretching - Wrist Circles',
  'Treadmill Running'
];

export function agreedManifest(): ManifestRecord[] {
  const out: ManifestRecord[] = [];
  let n = 0;
  for (let i = 0; i < 10; i++) out.push(makeRecord({ n: ++n, title: `Matched Video ${i + 1}`, review: 'matched', size: i === 9 ? 677_600 : 677_592 }));
  // Distractors that come BEFORE the agreed unmatched titles in manifest order.
  out.push(makeRecord({ n: ++n, title: 'Some Other Unmatched Video', review: 'unmatched', size: 111 }));
  for (let i = 0; i < 8; i++) out.push(makeRecord({ n: ++n, title: `Review Video ${i + 1}`, review: 'needs_review', size: i === 7 ? 443_199 : 443_197 }));
  // Deliberately in a different order than the agreed list: selection must follow the agreed order.
  for (const t of [...AGREED_UNMATCHED_TITLES].reverse()) out.push(makeRecord({ n: ++n, title: t, review: 'unmatched', size: 473_470 }));
  out.push(makeRecord({ n: ++n, title: 'Matched Video 1', review: 'matched', status: 'duplicate', sha: sha(1), size: 677_592, path: 'Other/Matched Video 1 copy.mp4' }));
  out.push(makeRecord({ n: ++n, title: 'Broken', status: 'invalid_mp4', size: 20 }));
  return out;
}
