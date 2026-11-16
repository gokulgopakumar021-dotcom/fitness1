/**
 * BT-04C task 3: summarises heart-rate samples that were STORED for one workout session.
 *
 * Read-only and derived. It never writes, never changes existing workout statistics, never estimates calories or zones, and never
 * invents or interpolates a measurement: min / average / max come only from stored samples. The chart series is a bucket average
 * of those samples (for a small sparkline) and is labelled as such by the UI; min / max are taken from the raw samples, not the series.
 */

/** A stored sample as the server hands it to the summariser. `verified` mirrors wearable_samples.workout_session_verified. */
export interface StoredHrSample { bpm: number; measuredAt: string; verified: boolean | null }

/**
 * verified:   every stored sample was confirmed by the database as inside a cloud-synced session of this account.
 * unverified: none were (the session was not cloud-synced when the sample arrived, or its window could not be determined).
 * mixed:      some of each.
 */
export type SessionConfirmation = 'verified' | 'unverified' | 'mixed';

export interface WorkoutHrPoint { t: string; bpm: number }
export interface WorkoutHrSummary {
  sampleCount: number;
  minBpm: number;
  avgBpm: number;
  maxBpm: number;
  firstAt: string;
  lastAt: string;
  session: SessionConfirmation;
  /** More samples exist than were read. Min / avg / max then describe only the samples that were read. */
  truncated: boolean;
  series: WorkoutHrPoint[];
}

export const MAX_SERIES_POINTS = 96;
/** Same plausible range the ingest path and the table CHECK enforce (src/wearables/types.ts METRICS.heart_rate). */
const MIN_BPM = 20;
const MAX_BPM = 255;

const usable = (s: StoredHrSample) => Number.isFinite(s.bpm) && s.bpm >= MIN_BPM && s.bpm <= MAX_BPM && Number.isFinite(Date.parse(s.measuredAt));

/** Returns null when there is nothing usable: "no stored heart rate" is a normal answer, not an error. */
export function summarizeWorkoutHeartRate(samples: readonly StoredHrSample[], truncated = false, maxPoints = MAX_SERIES_POINTS): WorkoutHrSummary | null {
  const rows = samples.filter(usable).map((s) => ({ ...s, ms: Date.parse(s.measuredAt) })).sort((a, b) => a.ms - b.ms);
  if (rows.length === 0) return null;

  let min = Infinity; let max = -Infinity; let sum = 0; let verified = 0;
  for (const r of rows) {
    if (r.bpm < min) min = r.bpm;
    if (r.bpm > max) max = r.bpm;
    sum += r.bpm;
    if (r.verified === true) verified++;
  }

  const first = rows[0].ms; const last = rows[rows.length - 1].ms;
  const cap = Math.max(2, Math.floor(maxPoints));
  let series: WorkoutHrPoint[];
  if (rows.length <= cap) {
    series = rows.map((r) => ({ t: new Date(r.ms).toISOString(), bpm: r.bpm }));
  } else {
    // Equal time buckets across the recorded span; an empty bucket (a gap in the data) is skipped, never filled.
    const span = Math.max(1, last - first);
    const acc = new Map<number, { s: number; n: number; t: number }>();
    for (const r of rows) {
      const i = Math.min(cap - 1, Math.floor(((r.ms - first) / span) * cap));
      const b = acc.get(i) ?? { s: 0, n: 0, t: 0 };
      b.s += r.bpm; b.n += 1; b.t += r.ms;
      acc.set(i, b);
    }
    series = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({ t: new Date(Math.round(b.t / b.n)).toISOString(), bpm: Math.round(b.s / b.n) }));
  }

  return {
    sampleCount: rows.length,
    minBpm: min,
    avgBpm: Math.round(sum / rows.length),
    maxBpm: max,
    firstAt: new Date(first).toISOString(),
    lastAt: new Date(last).toISOString(),
    session: verified === rows.length ? 'verified' : verified === 0 ? 'unverified' : 'mixed',
    truncated,
    series
  };
}

/** Runtime shape check for the client (a response is data, not trusted). */
export function isWorkoutHrSummary(v: unknown): v is WorkoutHrSummary {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const num = (k: string) => typeof s[k] === 'number' && Number.isFinite(s[k] as number);
  return num('sampleCount') && num('minBpm') && num('avgBpm') && num('maxBpm')
    && typeof s.firstAt === 'string' && typeof s.lastAt === 'string'
    && (s.session === 'verified' || s.session === 'unverified' || s.session === 'mixed')
    && typeof s.truncated === 'boolean'
    && Array.isArray(s.series)
    && s.series.every((p) => !!p && typeof (p as WorkoutHrPoint).t === 'string' && typeof (p as WorkoutHrPoint).bpm === 'number' && Number.isFinite((p as WorkoutHrPoint).bpm));
}
