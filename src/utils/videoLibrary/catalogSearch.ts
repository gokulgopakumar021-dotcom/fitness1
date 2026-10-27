import type { ExerciseVideo, VideoReviewStatus } from '../../types/video';
import { tokenize } from './normalize';

/**
 * In-memory catalog index with an inverted token index, used by the review tooling and tests to prove the
 * search/filter semantics scale to thousands of records. The app itself queries Postgres (see
 * videoCatalogService.ts) and never loads the whole catalog into the browser.
 */

export interface CatalogQuery {
  text?: string;
  exerciseKey?: string;
  equipment?: string;
  muscleGroup?: string;
  tag?: string;
  reviewStatus?: VideoReviewStatus;
  limit?: number;
  /** Opaque cursor returned by a previous page. */
  cursor?: string | null;
}

export interface CatalogPage {
  items: ExerciseVideo[];
  nextCursor: string | null;
}

export interface CatalogIndex {
  sorted: ExerciseVideo[];
  byKey: Map<string, number[]>;
  byToken: Map<string, number[]>;
}

const sortKey = (v: ExerciseVideo) => `${v.title.toLowerCase()}\u0000${v.id}`;

export function buildCatalogIndex(records: ExerciseVideo[]): CatalogIndex {
  const sorted = [...records].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const byKey = new Map<string, number[]>();
  const byToken = new Map<string, number[]>();
  sorted.forEach((v, i) => {
    if (v.exerciseKey) (byKey.get(v.exerciseKey) ?? byKey.set(v.exerciseKey, []).get(v.exerciseKey)!).push(i);
    for (const t of new Set(tokenize(`${v.title} ${v.originalFilename}`))) {
      (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(i);
    }
  });
  return { sorted, byKey, byToken };
}

function intersect(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return out;
}

/** Positions whose token equals `token`, or (for the last typed token) starts with it. */
function postingsFor(index: CatalogIndex, token: string, prefix: boolean): number[] {
  if (!prefix) return index.byToken.get(token) ?? [];
  const merged = new Set<number>();
  for (const [t, list] of index.byToken) if (t.startsWith(token)) for (const p of list) merged.add(p);
  return [...merged].sort((x, y) => x - y);
}

export function searchCatalog(index: CatalogIndex, q: CatalogQuery): CatalogPage {
  const limit = Math.min(Math.max(q.limit ?? 24, 1), 100);
  let candidates: number[] | null = null;
  const narrow = (list: number[]) => { candidates = candidates ? intersect(candidates, list) : list; };

  if (q.exerciseKey) narrow(index.byKey.get(q.exerciseKey) ?? []);
  const tokens = q.text ? tokenize(q.text) : [];
  tokens.forEach((t, i) => narrow(postingsFor(index, t, i === tokens.length - 1)));

  let positions: number[] = candidates ?? index.sorted.map((_, i) => i);
  const wantEquip = q.equipment?.toLowerCase();
  const wantMuscle = q.muscleGroup?.toLowerCase();
  const wantTag = q.tag?.toLowerCase();
  positions = positions.filter((p) => {
    const v = index.sorted[p];
    if (q.reviewStatus && v.reviewStatus !== q.reviewStatus) return false;
    if (wantEquip && !v.equipment.some((e) => e.toLowerCase() === wantEquip)) return false;
    if (wantMuscle && !v.muscleGroups.some((m) => m.toLowerCase() === wantMuscle)) return false;
    if (wantTag && !v.tags.some((t) => t.toLowerCase() === wantTag)) return false;
    return true;
  });

  // Keyset pagination over the sorted order: binary search for the first position after the cursor.
  let start = 0;
  if (q.cursor) {
    let lo = 0;
    let hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortKey(index.sorted[positions[mid]]) <= q.cursor) lo = mid + 1;
      else hi = mid;
    }
    start = lo;
  }
  const page = positions.slice(start, start + limit).map((p) => index.sorted[p]);
  const more = start + limit < positions.length;
  return { items: page, nextCursor: more && page.length ? sortKey(page[page.length - 1]) : null };
}
