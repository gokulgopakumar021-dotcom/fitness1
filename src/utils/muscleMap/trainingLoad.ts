import type { WorkoutSession } from '../../types';
import { MUSCLE_REGION_IDS, type MuscleRegionId } from './regions';
import { resolveRegion } from './resolveRegion';
import { dayKeyFromNumber, dayNumber, getSessionDay, localDayKey, type DayPrecision } from './localDay';

/**
 * Recent training load per muscle region (pure, deterministic, local only).
 *
 * This compares LOGGED WORKING-SET COUNTS. It does not measure physiological recovery, and nothing
 * here may be presented as such.
 *
 * Windows (all LOCAL calendar days; `today` is the local day of the `now` argument and is a partial
 * day, so it is never part of either window):
 *
 *     baseline (4 x 7 days)                      current (7 days)      today
 *   [today-35 .............. today-8] | [today-7 .......... today-1] | today
 *
 * The windows do not overlap. Each baseline week is a full 7-day span.
 *
 * Eligibility of a session: dataset matches (real vs demo), status 'completed', and a usable day.
 * Eligibility of a set: completed, not skipped, not a warm-up. 'working', 'drop' and 'failure' sets
 * each count once (the data model stores each as its own set, so nothing is double-counted).
 * Weight is never required: bodyweight sets recorded with weight 0 count.
 *
 * Insufficient history: days before the user's first completed session are NOT treated as zero-
 * training. A baseline week is "usable" only if the first completed session is on or before that
 * week's first day. A comparison needs MIN_USABLE_BASELINE_WEEKS usable weeks, i.e. the 7-day
 * current window plus 2 baseline weeks = about three weeks of tracked history. Weeks after the
 * first session with no logged work do count as zero-volume weeks (the comparison is of logged
 * volume only).
 */

// ---- Named constants -------------------------------------------------------------------------
export const DAYS_PER_WEEK = 7;
/** Length of the current window, in complete local days ending yesterday. */
export const CURRENT_PERIOD_DAYS = DAYS_PER_WEEK;
/** Number of 7-day weeks in the baseline window that sits directly before the current window. */
export const BASELINE_WEEKS = 4;
/** Fewest usable baseline weeks needed before any comparison is made (~3 weeks incl. current). */
export const MIN_USABLE_BASELINE_WEEKS = 2;
/** Below this share of the baseline average: "Lighter than usual" (exclusive). */
export const LIGHTER_BELOW_RATIO = 0.75;
/** Above this share of the baseline average: "Heavier than usual" (exclusive). 125% is Typical. */
export const HEAVIER_ABOVE_RATIO = 1.25;

// ---- Types -----------------------------------------------------------------------------------
export type LoadStatus =
  | 'insufficient_data'
  | 'no_recent_work'
  | 'no_baseline'
  | 'lighter'
  | 'typical'
  | 'heavier';

export const LOAD_STATUS_LABELS: Readonly<Record<LoadStatus, string>> = {
  insufficient_data: 'Insufficient data',
  no_recent_work: 'No recent work',
  no_baseline: 'No historical baseline',
  lighter: 'Lighter than usual',
  typical: 'Typical',
  heavier: 'Heavier than usual',
};

export type Dataset = 'real' | 'demo';

export interface BuildOptions {
  /** 'real' (default) uses sessions without isDemo; 'demo' uses only isDemo sessions. Never mixed. */
  dataset?: Dataset;
}

export interface RegionTrainingSummary {
  regionId: MuscleRegionId;
  status: LoadStatus;
  /** Eligible working sets in the current 7-day window. */
  currentPeriodSets: number;
  /** Distinct sessions that trained this region in the current window. */
  currentPeriodSessions: number;
  /** Average weekly sets over the usable baseline weeks; null when history is insufficient. */
  baselineWeeklyAverage: number | null;
  baselineWeeksUsed: number;
  /** currentPeriodSets / baselineWeeklyAverage; null when not computable (no division by zero). */
  ratio: number | null;
  /** Most recent local day with eligible work for this region (includes today); null if none. */
  lastTrainedDay: string | null;
  /** 'date-only' means that day came from the stored date and may be off by one. */
  lastTrainedDayPrecision: DayPrecision | null;
  /** Eligible sets logged today (a partial day, shown separately, not in either window). */
  setsToday: number;
  /** Distinct exercise names in the current window, most recent first. */
  recentExercises: string[];
}

export interface UnmappedSummary {
  /** Eligible sets in the current window whose exercise could not be mapped to a region. */
  currentPeriodSets: number;
  /** Same, for the 28-day baseline window. */
  baselinePeriodSets: number;
  /** Distinct unmapped exercise names seen in either window (sorted). */
  exerciseNames: string[];
}

export interface MuscleMapSummary {
  dataset: Dataset;
  /** Local day of `now`. */
  today: string;
  currentPeriod: { startDay: string; endDay: string };
  baselinePeriod: { startDay: string; endDay: string };
  history: {
    /** Day of the first eligible completed session; null when there is none. */
    firstTrackedDay: string | null;
    usableBaselineWeeks: number;
    requiredBaselineWeeks: number;
    sufficient: boolean;
  };
  regions: Record<MuscleRegionId, RegionTrainingSummary>;
  unmapped: UnmappedSummary;
  diagnostics: {
    sessionsUsed: number;
    excludedWrongDataset: number;
    excludedNotCompleted: number;
    excludedNoUsableDate: number;
    excludedFutureDated: number;
  };
}

// ---- Helpers ---------------------------------------------------------------------------------
function isEligibleSet(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const set = s as { completed?: unknown; skipped?: unknown; type?: unknown };
  return Boolean(set.completed) && !set.skipped && set.type !== 'warmup';
}

function classify(
  currentSets: number,
  baselineSum: number,
  weeks: number,
  sufficient: boolean
): { status: LoadStatus; average: number | null; ratio: number | null } {
  if (!sufficient || weeks <= 0) return { status: 'insufficient_data', average: null, ratio: null };
  const average = baselineSum / weeks;
  if (currentSets === 0) return { status: 'no_recent_work', average, ratio: baselineSum > 0 ? 0 : null };
  if (baselineSum === 0) return { status: 'no_baseline', average, ratio: null };
  // Single division of exact integers: current / (sum / weeks) === current * weeks / sum.
  const ratio = (currentSets * weeks) / baselineSum;
  if (ratio < LIGHTER_BELOW_RATIO) return { status: 'lighter', average, ratio };
  if (ratio > HEAVIER_ABOVE_RATIO) return { status: 'heavier', average, ratio };
  return { status: 'typical', average, ratio };
}

interface Accum {
  currentSets: number;
  sessionIds: Set<string>;
  weekSets: number[];
  lastN: number | null;
  lastPrecision: DayPrecision | null;
  setsToday: number;
  /** exercise name (lower-cased key) -> { name, sortKey } for the current window */
  exercises: Map<string, { name: string; sortKey: string }>;
}

const newAccum = (): Accum => ({
  currentSets: 0,
  sessionIds: new Set(),
  weekSets: Array.from({ length: BASELINE_WEEKS }, () => 0),
  lastN: null,
  lastPrecision: null,
  setsToday: 0,
  exercises: new Map(),
});

/**
 * Builds the per-region training summary. `now` is an explicit argument; the function never reads
 * the wall clock and never mutates its input.
 */
export function buildMuscleMapSummary(
  sessions: readonly WorkoutSession[],
  now: Date,
  options: BuildOptions = {}
): MuscleMapSummary {
  const dataset: Dataset = options.dataset ?? 'real';
  const today = localDayKey(now);
  if (!today) throw new RangeError('buildMuscleMapSummary: `now` must be a valid Date');
  const todayN = dayNumber(today);

  const currentStartN = todayN - CURRENT_PERIOD_DAYS;
  const currentEndN = todayN - 1;
  const baselineStartN = currentStartN - BASELINE_WEEKS * DAYS_PER_WEEK;
  const baselineEndN = currentStartN - 1;

  const diagnostics = {
    sessionsUsed: 0,
    excludedWrongDataset: 0,
    excludedNotCompleted: 0,
    excludedNoUsableDate: 0,
    excludedFutureDated: 0,
  };

  // 1. Select eligible sessions.
  interface Eligible {
    session: WorkoutSession;
    dayN: number;
    precision: DayPrecision;
    index: number;
  }
  const eligible: Eligible[] = [];
  (Array.isArray(sessions) ? sessions : []).forEach((session, index) => {
    if (!session || typeof session !== 'object') return;
    const isDemo = session.isDemo === true;
    if ((dataset === 'demo') !== isDemo) {
      diagnostics.excludedWrongDataset += 1;
      return;
    }
    if (session.status !== 'completed') {
      diagnostics.excludedNotCompleted += 1;
      return;
    }
    const sd = getSessionDay(session);
    if (!sd) {
      diagnostics.excludedNoUsableDate += 1;
      return;
    }
    const dayN = dayNumber(sd.day);
    if (dayN > todayN) {
      diagnostics.excludedFutureDated += 1;
      return;
    }
    eligible.push({ session, dayN, precision: sd.precision, index });
  });
  diagnostics.sessionsUsed = eligible.length;

  // Deterministic order: newest day first, then startTime, then original position.
  eligible.sort(
    (a, b) =>
      b.dayN - a.dayN ||
      String(b.session.startTime ?? '').localeCompare(String(a.session.startTime ?? '')) ||
      a.index - b.index
  );

  const firstTrackedN = eligible.length ? Math.min(...eligible.map((e) => e.dayN)) : null;

  // 2. Accumulate eligible sets.
  const acc = Object.fromEntries(MUSCLE_REGION_IDS.map((id) => [id, newAccum()])) as Record<MuscleRegionId, Accum>;
  const unmappedNames = new Map<string, string>();
  const unmapped = { currentPeriodSets: 0, baselinePeriodSets: 0 };

  eligible.forEach(({ session, dayN, precision }, order) => {
    const exercises = Array.isArray(session.exercises) ? session.exercises : [];
    for (const ex of exercises) {
      if (!ex || typeof ex !== 'object') continue;
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      const n = sets.filter(isEligibleSet).length;
      if (n === 0) continue;

      const name = typeof ex.name === 'string' ? ex.name.trim() : '';
      const inCurrent = dayN >= currentStartN && dayN <= currentEndN;
      const inBaseline = dayN >= baselineStartN && dayN <= baselineEndN;
      const resolution = resolveRegion(ex.name, ex.muscleGroup);

      if (resolution.regionId === null) {
        if (inCurrent) unmapped.currentPeriodSets += n;
        if (inBaseline) unmapped.baselinePeriodSets += n;
        if ((inCurrent || inBaseline) && name) unmappedNames.set(name.toLowerCase(), name);
        continue;
      }

      const a = acc[resolution.regionId];
      if (a.lastN === null || dayN > a.lastN) {
        a.lastN = dayN;
        a.lastPrecision = precision;
      } else if (dayN === a.lastN && precision === 'start-time') {
        a.lastPrecision = 'start-time';
      }
      if (dayN === todayN) a.setsToday += n;
      if (inCurrent) {
        a.currentSets += n;
        a.sessionIds.add(String(session.id ?? `#${order}`));
        if (name && !a.exercises.has(name.toLowerCase())) {
          a.exercises.set(name.toLowerCase(), { name, sortKey: String(order).padStart(6, '0') });
        }
      }
      if (inBaseline) {
        const week = Math.floor((dayN - baselineStartN) / DAYS_PER_WEEK);
        a.weekSets[week] += n;
      }
    }
  });

  // 3. History sufficiency: which baseline weeks are usable?
  const usableWeek = (w: number): boolean =>
    firstTrackedN !== null && firstTrackedN <= baselineStartN + w * DAYS_PER_WEEK;
  const usableWeekIdx = Array.from({ length: BASELINE_WEEKS }, (_, w) => w).filter(usableWeek);
  const usableBaselineWeeks = usableWeekIdx.length;
  const sufficient = usableBaselineWeeks >= MIN_USABLE_BASELINE_WEEKS;

  // 4. Per-region summaries.
  const regions = Object.fromEntries(
    MUSCLE_REGION_IDS.map((id) => {
      const a = acc[id];
      const baselineSum = usableWeekIdx.reduce((sum, w) => sum + a.weekSets[w], 0);
      const { status, average, ratio } = classify(a.currentSets, baselineSum, usableBaselineWeeks, sufficient);
      const summary: RegionTrainingSummary = {
        regionId: id,
        status,
        currentPeriodSets: a.currentSets,
        currentPeriodSessions: a.sessionIds.size,
        baselineWeeklyAverage: average,
        baselineWeeksUsed: sufficient ? usableBaselineWeeks : 0,
        ratio,
        lastTrainedDay: a.lastN === null ? null : dayKeyFromNumber(a.lastN),
        lastTrainedDayPrecision: a.lastPrecision,
        setsToday: a.setsToday,
        recentExercises: [...a.exercises.values()].sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((e) => e.name),
      };
      return [id, summary];
    })
  ) as Record<MuscleRegionId, RegionTrainingSummary>;

  return {
    dataset,
    today,
    currentPeriod: { startDay: dayKeyFromNumber(currentStartN), endDay: dayKeyFromNumber(currentEndN) },
    baselinePeriod: { startDay: dayKeyFromNumber(baselineStartN), endDay: dayKeyFromNumber(baselineEndN) },
    history: {
      firstTrackedDay: firstTrackedN === null ? null : dayKeyFromNumber(firstTrackedN),
      usableBaselineWeeks,
      requiredBaselineWeeks: MIN_USABLE_BASELINE_WEEKS,
      sufficient,
    },
    regions,
    unmapped: {
      ...unmapped,
      exerciseNames: [...unmappedNames.values()].sort((a, b) => a.localeCompare(b)),
    },
    diagnostics,
  };
}

// ---- Presentation helpers (text only; no UI) ---------------------------------------------------
const formatCount = (n: number): string => `${n} working ${n === 1 ? 'set' : 'sets'}`;

/** Average shown with at most one decimal, e.g. 5.5 or 4 (not 4.0). */
export function formatAverage(avg: number): string {
  return String(Number(avg.toFixed(1)));
}

/** e.g. "7 working sets in the last 7 days · usual weekly average: 5.5 sets". Uses real values. */
export function formatLoadSummary(r: RegionTrainingSummary): string {
  const current = `${formatCount(r.currentPeriodSets)} in the last ${CURRENT_PERIOD_DAYS} days`;
  if (r.baselineWeeklyAverage === null) return current;
  const avg = r.baselineWeeklyAverage;
  return `${current} · usual weekly average: ${formatAverage(avg)} ${Number(avg.toFixed(1)) === 1 ? 'set' : 'sets'}`;
}

export const LOAD_DISCLAIMER =
  'Training load compares your logged workout volume. It does not measure muscle recovery or diagnose injury.';
