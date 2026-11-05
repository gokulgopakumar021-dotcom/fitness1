import { hashOf } from '../sync/hash';
import { isPristineStarter } from '../sync/localAdapter';

/**
 * Record-level merge used by "Restore from backup" and "Import legacy data".
 *
 * Rules (deterministic, never deletes):
 *  - an incoming record with an unknown id is ADDED;
 *  - a local record that is absent from the incoming data is KEPT (absence never means deletion);
 *  - the same id with identical content changes nothing;
 *  - the same id with different content: the record with the later timestamp wins, a tie keeps the LOCAL one;
 *    the loser is returned so the caller can archive it (nothing is silently destroyed);
 *  - a pristine starter plan has no user data in it, so any different incoming version of it wins without a conflict.
 */
export type MergeKind = 'plans' | 'sessions' | 'other';

export interface MergeStats {
  added: number;
  replaced: number;
  keptLocal: number;
  identical: number;
  /** Incoming entries that were not usable records (no id, demo data). Never written. */
  skipped: number;
}

export interface MergeLoser {
  id: string;
  data: Record<string, unknown>;
  reason: string;
}

export interface MergeResult<T> {
  merged: T[];
  stats: MergeStats;
  losers: MergeLoser[];
  /** Ids that were added or replaced (what the caller must now find in storage). */
  changedIds: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 128;

const ts = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** When the user last changed the record, as far as its own content says (0 = unknown, never beats a known time). */
export function recordTime(kind: MergeKind, rec: Record<string, unknown>): number {
  if (kind === 'plans') return ts(rec.updatedAt);
  if (kind === 'sessions') return Math.max(ts(rec.endTime), ts(rec.startTime), ts(rec.date));
  return Math.max(ts(rec.updatedAt), ts(rec.createdAt));
}

export interface MergeOptions {
  kind: MergeKind;
  /** Local time knowledge beyond the record itself (e.g. sync bookkeeping). Optional. */
  localTime?: (rec: Record<string, unknown>) => number;
}

export function mergeById<T extends { id: string }>(local: readonly T[], incoming: readonly unknown[], opts: MergeOptions): MergeResult<T> {
  const stats: MergeStats = { added: 0, replaced: 0, keptLocal: 0, identical: 0, skipped: 0 };
  const losers: MergeLoser[] = [];
  const changedIds: string[] = [];
  const merged: T[] = [...local];
  const index = new Map<string, number>();
  merged.forEach((r, i) => index.set(r.id, i));

  for (const raw of incoming) {
    if (!isObj(raw) || !validId(raw.id) || raw.isDemo === true) {
      stats.skipped++;
      continue;
    }
    const id = raw.id;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, merged.length);
      merged.push(raw as unknown as T);
      stats.added++;
      changedIds.push(id);
      continue;
    }
    const cur = merged[at] as unknown as Record<string, unknown>;
    if (hashOf(cur) === hashOf(raw)) {
      stats.identical++;
      continue;
    }
    if (opts.kind === 'plans' && isPristineStarter(cur)) {
      merged[at] = raw as unknown as T;
      stats.replaced++;
      changedIds.push(id);
      continue;
    }
    const lt = Math.max(recordTime(opts.kind, cur), opts.localTime?.(cur) ?? 0);
    const it = recordTime(opts.kind, raw);
    if (it > lt) {
      losers.push({ id, data: cur, reason: 'local version lost to a newer record from the import' });
      merged[at] = raw as unknown as T;
      stats.replaced++;
      changedIds.push(id);
    } else {
      losers.push({ id, data: raw, reason: 'imported version lost to a newer or equal local record' });
      stats.keptLocal++;
    }
  }
  return { merged, stats, losers, changedIds };
}

export const emptyStats = (): MergeStats => ({ added: 0, replaced: 0, keptLocal: 0, identical: 0, skipped: 0 });
