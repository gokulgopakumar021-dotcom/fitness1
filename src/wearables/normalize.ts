import { METRICS, type MetricType, type NormalizedSample, type RawSampleInput, type QualityStatus } from './types';

export type NormalizeResult =
  | { ok: true; sample: NormalizedSample }
  | { ok: false; errors: string[] };

const ORIGINS = new Set(['live', 'synchronized', 'manual', 'simulated']);
const METHODS = new Set(['direct_ble', 'cloud_api', 'aggregator', 'native_health_store', 'manual_import']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function parseIso(s: unknown): number | null {
  if (typeof s !== 'string' || !ISO.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Validates and canonicalises one sample. Rejects (never clamps, never zero-fills) anything invalid. */
export function normalizeSample(input: RawSampleInput, now: () => Date = () => new Date()): NormalizeResult {
  const errors: string[] = [];
  if (!input.deviceId || typeof input.deviceId !== 'string') errors.push('deviceId required');
  if (!input.provider) errors.push('provider required');
  if (!input.manufacturer) errors.push('manufacturer required');
  if (!METHODS.has(input.ingestionMethod)) errors.push('invalid ingestionMethod');
  if (!ORIGINS.has(input.origin)) errors.push('invalid origin');

  const spec = (METRICS as Record<string, (typeof METRICS)[MetricType]>)[input.metric];
  if (!spec) errors.push(`unknown metric: ${String(input.metric)}`);

  // Missing stays missing: null/undefined/''/NaN/non-number are rejected, and 0 is only accepted where it is in range.
  const v = input.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) errors.push('value must be a finite number');
  if (spec) {
    if (input.unit !== spec.unit) errors.push(`invalid unit "${input.unit}" for ${input.metric}; expected ${spec.unit}`);
    if (typeof v === 'number' && Number.isFinite(v) && (v < spec.min || v > spec.max)) errors.push(`${input.metric} out of plausible range`);
  }

  const startMs = parseIso(input.measuredAt);
  if (startMs === null) errors.push('measuredAt must be ISO-8601 with timezone offset or Z');
  let endMs: number | null = null;
  if (input.measuredEndAt != null) {
    endMs = parseIso(input.measuredEndAt);
    if (endMs === null) errors.push('measuredEndAt invalid');
    else if (startMs !== null && endMs < startMs) errors.push('measuredEndAt before measuredAt');
  }
  const nowMs = now().getTime();
  if (startMs !== null && startMs > nowMs + 5 * 60_000) errors.push('measuredAt is in the future');

  const tz = input.tzOffsetMin ?? null;
  if (tz !== null && (!Number.isInteger(tz) || tz < -840 || tz > 840)) errors.push('tzOffsetMin invalid');

  if (errors.length || !spec || startMs === null) return { ok: false, errors };

  const measuredAt = new Date(startMs).toISOString();
  const measuredEndAt = endMs === null ? null : new Date(endMs).toISOString();
  const quality: QualityStatus = input.quality ?? (input.origin === 'manual' ? 'user_entered' : 'unverified');
  const sourceRecordId = input.sourceRecordId?.trim() ? input.sourceRecordId.trim() : null;

  return {
    ok: true,
    sample: {
      deviceId: input.deviceId, provider: input.provider, manufacturer: input.manufacturer, model: input.model ?? null,
      ingestionMethod: input.ingestionMethod, origin: input.origin, metric: input.metric as MetricType, value: v as number,
      unit: spec.unit, measuredAt, measuredEndAt, tzOffsetMin: tz, sourceRecordId, quality,
      importedAt: input.importedAt ?? now().toISOString(),
      dedupeKey: dedupeKey({ provider: input.provider, deviceId: input.deviceId, metric: input.metric, sourceRecordId, measuredAt, measuredEndAt }),
    },
  };
}

/** Stable identity: provider record id when present, otherwise the (metric, window) on the device. */
export function dedupeKey(p: { provider: string; deviceId: string; metric: string; sourceRecordId: string | null; measuredAt: string; measuredEndAt: string | null }): string {
  const tail = p.sourceRecordId ? `id:${p.sourceRecordId}` : `t:${p.measuredAt}/${p.measuredEndAt ?? ''}`;
  return `${p.provider}|${p.deviceId}|${p.metric}|${tail}`;
}

/** Simulated data is never persistable and never AI-shareable, whatever else it claims. */
export function isPersistable(s: Pick<NormalizedSample, 'origin'>): boolean {
  return s.origin !== 'simulated';
}

export interface MergeResult {
  store: Map<string, NormalizedSample>;
  inserted: number;
  updated: number;
  duplicates: number;
  rejectedSimulated: number;
}

/**
 * Idempotent, order-independent merge: same key + same value = duplicate (no-op); same key + different value =
 * provider revision (newer importedAt wins, tie keeps existing); retries and out-of-order batches converge.
 */
export function mergeIncoming(existing: Map<string, NormalizedSample>, incoming: NormalizedSample[]): MergeResult {
  const store = new Map(existing);
  let inserted = 0, updated = 0, duplicates = 0, rejectedSimulated = 0;
  for (const s of incoming) {
    if (!isPersistable(s)) { rejectedSimulated++; continue; }
    const cur = store.get(s.dedupeKey);
    if (!cur) { store.set(s.dedupeKey, s); inserted++; continue; }
    if (cur.value === s.value && cur.unit === s.unit) { duplicates++; continue; }
    if (Date.parse(s.importedAt) > Date.parse(cur.importedAt)) { store.set(s.dedupeKey, s); updated++; } else duplicates++;
  }
  return { store, inserted, updated, duplicates, rejectedSimulated };
}

/** Local calendar date of a sample. Falls back to UTC and says so, instead of guessing a timezone. */
export function localDate(s: Pick<NormalizedSample, 'measuredAt' | 'tzOffsetMin'>): { date: string; basis: 'local_offset' | 'utc' } {
  const off = s.tzOffsetMin;
  const t = Date.parse(s.measuredAt) + (off ?? 0) * 60_000;
  return { date: new Date(t).toISOString().slice(0, 10), basis: off === null ? 'utc' : 'local_offset' };
}

export interface DailyTotal { date: string; metric: MetricType; value: number; source: string; alternates: { source: string; value: number }[]; dateBasis: 'local_offset' | 'utc' }

/**
 * Daily total for a cumulative metric WITHOUT double-counting: values are summed within one source only, and the
 * highest-priority source wins; other sources are returned as alternates for transparency, never added.
 * `priority` lists sources (provider|deviceId or provider) best-first; unlisted sources rank last, then by larger coverage.
 */
export function resolveDailyTotal(samples: NormalizedSample[], metric: MetricType, date: string, priority: string[]): DailyTotal | null {
  if (!METRICS[metric].cumulative) throw new Error(`${metric} is not cumulative`);
  const bySource = new Map<string, { sum: number; basis: 'local_offset' | 'utc' }>();
  for (const s of samples) {
    if (s.metric !== metric || !isPersistable(s)) continue;
    const ld = localDate(s);
    if (ld.date !== date) continue;
    const key = `${s.provider}|${s.deviceId}`;
    const cur = bySource.get(key) ?? { sum: 0, basis: ld.basis };
    cur.sum += s.value;
    if (ld.basis === 'utc') cur.basis = 'utc';
    bySource.set(key, cur);
  }
  if (bySource.size === 0) return null; // absent stays absent, not 0
  const rank = (k: string) => { const i = priority.findIndex((p) => p === k || k.startsWith(`${p}|`)); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  const ordered = [...bySource.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].sum - a[1].sum || a[0].localeCompare(b[0]));
  const [winKey, win] = ordered[0];
  return { date, metric, value: win.sum, source: winKey, dateBasis: win.basis, alternates: ordered.slice(1).map(([source, o]) => ({ source, value: o.sum })) };
}
