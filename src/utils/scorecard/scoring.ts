import type { FoodEntry, WorkoutSession } from '../../types';
import { dayNumber, getSessionDay, isValidDayKey } from '../muscleMap/localDay';
import type {
  CategoryId,
  CategoryResult,
  CategoryStatus,
  Dataset,
  RawValue,
  ScorecardAction,
  ScorecardInput,
  ScorecardResult,
} from './types';

/*
 * Unified Daily Health Scorecard: pure scoring engine.
 *
 * - No clock, network, storage or randomness. The evaluation day and "today" are passed in.
 * - Never mutates its input.
 * - Missing data is never zero: a category without usable data is not scored and drops out of
 *   the eligible maximum. An actual measured 0 is a scored 0.
 */

export const SCORECARD_WEIGHTS: Readonly<Record<CategoryId, number>> = Object.freeze({
  workout: 20,
  nutrition: 25,
  hydration: 15,
  sleep: 25,
  recovery: 15,
});

export const CATEGORY_ORDER: readonly CategoryId[] = ['workout', 'nutrition', 'hydration', 'sleep', 'recovery'];

export const CATEGORY_LABELS: Readonly<Record<CategoryId, string>> = Object.freeze({
  workout: 'Workout',
  nutrition: 'Nutrition',
  hydration: 'Hydration',
  sleep: 'Sleep',
  recovery: 'Recovery',
});

/** Nutrition split (sums to the nutrition weight of 25). */
export const NUTRITION_CALORIE_POINTS = 13;
export const NUTRITION_PROTEIN_POINTS = 12;
/** Calories earn full points inside this band around the target, falling linearly to 0 at the outer limits. */
export const CALORIE_FULL_BAND = { low: 0.9, high: 1.1 } as const;
export const CALORIE_ZERO_AT = { low: 0.5, high: 1.5 } as const;

/** Default sleep-duration guideline. NOT a personalized target and never persisted. */
export const SLEEP_GUIDELINE = Object.freeze({
  minHours: 7,
  maxHours: 9,
  /** Over-guideline sleep falls to 0 points this many hours past the maximum. */
  zeroAfterMaxHours: 3,
  label: 'Default 7–9 h guideline (not personalized)',
});

/** Overall score is shown only when both thresholds are met. */
export const MIN_SCORED_CATEGORIES = 2;
export const MIN_ELIGIBLE_MAX = 40;

export const UTC_DATE_LIMITATION =
  'Nutrition and sleep logs are keyed by a UTC-derived date, so a log saved shortly after local midnight may be filed under the previous day.';

/* ───────────────────────── helpers ───────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function inDataset(record: unknown, dataset: Dataset): boolean {
  if (!isRecord(record)) return false;
  return dataset === 'demo' ? record.isDemo === true : record.isDemo !== true;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n === 1 ? one : many;
}

function base(id: CategoryId): CategoryResult {
  return {
    id,
    label: CATEGORY_LABELS[id],
    status: 'no_data',
    maxPoints: SCORECARD_WEIGHTS[id],
    eligibleMax: 0,
    points: null,
    partial: false,
    raw: {},
    target: {},
    progress: null,
    explanation: '',
    notes: [],
    action: null,
    ignoredRecords: 0,
  };
}

function finish(
  result: CategoryResult,
  status: CategoryStatus,
  explanation: string,
  extra: Partial<CategoryResult> = {}
): CategoryResult {
  return { ...result, ...extra, status, explanation };
}

function scored(result: CategoryResult, points: number, explanation: string, extra: Partial<CategoryResult> = {}): CategoryResult {
  const p = round2(clamp(points, 0, result.maxPoints));
  return { ...result, ...extra, status: 'scored', points: p, eligibleMax: result.maxPoints, explanation };
}

/* ───────────────────────── workout ───────────────────────── */

type CountedSession = { session: WorkoutSession; completedSets: number; abandoned: boolean };

function countCompletedWorkingSets(session: WorkoutSession): number | null {
  if (!Array.isArray(session.exercises)) return null;
  let count = 0;
  for (const ex of session.exercises) {
    if (!isRecord(ex) || !Array.isArray((ex as { sets?: unknown }).sets)) return null;
    for (const set of (ex as { sets: unknown[] }).sets) {
      if (!isRecord(set)) return null;
      // Mirrors WorkoutSessionTracker: a working set counts once it is checked off.
      if (set.completed === true && set.skipped !== true && set.type === 'working') count += 1;
    }
  }
  return count;
}

function plannedWorkingSets(session: WorkoutSession, plans: ScorecardInput['plans']): number | null {
  if (!session.planId || !session.dayId || !Array.isArray(plans)) return null;
  const plan = plans.find((p) => isRecord(p) && p.id === session.planId);
  if (!plan || !Array.isArray(plan.days)) return null;
  const day = (plan.days as unknown[]).find((d): d is { id: unknown; exercises?: unknown } => isRecord(d) && d.id === session.dayId);
  if (!day || !Array.isArray(day.exercises)) return null;
  let total = 0;
  for (const ex of day.exercises) {
    if (!isRecord(ex) || !isFiniteNumber(ex.workingSets) || ex.workingSets < 0) return null;
    total += ex.workingSets;
  }
  return total;
}

function scoreWorkout(input: ScorecardInput): CategoryResult {
  const res = base('workout');
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];

  const counted: CountedSession[] = [];
  let inProgress = 0;
  let emptyAbandoned = 0;
  let invalid = 0;
  let noUsableDate = 0;
  let dateOnly = 0;

  for (const s of sessions) {
    if (!isRecord(s) || !inDataset(s, input.dataset)) continue;
    const session = s as unknown as WorkoutSession;
    const day = getSessionDay(session);
    if (!day) {
      noUsableDate += 1;
      continue;
    }
    if (day.day !== input.evaluationDate) continue;

    if (session.status === 'in_progress') {
      inProgress += 1;
      continue;
    }
    if (session.status !== 'completed' && session.status !== 'abandoned') {
      invalid += 1;
      continue;
    }
    const completedSets = countCompletedWorkingSets(session);
    if (completedSets === null) {
      invalid += 1;
      continue;
    }
    if (day.precision === 'date-only') dateOnly += 1;
    if (session.status === 'abandoned' && completedSets === 0) {
      emptyAbandoned += 1;
      continue;
    }
    counted.push({ session, completedSets, abandoned: session.status === 'abandoned' });
  }

  const notes: string[] = [];
  if (noUsableDate > 0)
    notes.push(`${noUsableDate} saved ${plural(noUsableDate, 'session has', 'sessions have')} no usable date and ${plural(noUsableDate, 'was', 'were')} ignored.`);
  if (dateOnly > 0) notes.push('Some sessions have only a date-only value, which may be a day off near midnight.');
  if (emptyAbandoned > 0) notes.push(`${emptyAbandoned} abandoned ${plural(emptyAbandoned, 'session')} with no completed sets ${plural(emptyAbandoned, 'was', 'were')} not counted.`);
  const ignoredRecords = invalid;

  if (counted.length === 0) {
    if (inProgress > 0) {
      return finish(res, 'in_progress', 'A workout is in progress. It will be scored once it is finished.', {
        notes,
        ignoredRecords,
        raw: { inProgressSessions: inProgress },
        action: { kind: 'resume_session', message: 'Resume your in-progress workout to keep logging sets.' },
      });
    }
    if (invalid > 0) {
      return finish(res, 'invalid_data', 'Workout records for this day could not be read, so no workout score is given.', {
        notes,
        ignoredRecords,
      });
    }
    return finish(
      res,
      'no_data',
      'No workout was logged. This is not scored as zero and does not assume a rest day.',
      { notes, ignoredRecords }
    );
  }

  let planned = 0;
  let unresolved = 0;
  for (const c of counted) {
    const p = plannedWorkingSets(c.session, input.plans);
    if (p === null) unresolved += 1;
    else planned += p;
  }
  const completed = counted.reduce((n, c) => n + c.completedSets, 0);
  const abandoned = counted.some((c) => c.abandoned);
  const raw: Record<string, RawValue> = {
    completedWorkingSets: completed,
    sessions: counted.length,
    abandonedSessions: counted.filter((c) => c.abandoned).length,
  };
  if (inProgress > 0) {
    raw.inProgressSessions = inProgress;
    notes.push('Another session is still in progress and is not included yet.');
  }
  if (invalid > 0) notes.push(`${invalid} unreadable ${plural(invalid, 'session was', 'sessions were')} ignored.`);

  if (unresolved > 0 || planned <= 0) {
    return finish(
      res,
      'insufficient_data',
      'Planned working sets could not be determined from the linked plan day, so completion cannot be scored.',
      { raw, notes, ignoredRecords }
    );
  }

  const ratio = completed / planned;
  const points = res.maxPoints * Math.min(1, ratio);
  const explanation =
    `${completed} of ${planned} planned working ${plural(planned, 'set')} completed ` +
    `(${Math.round(Math.min(1, ratio) * 100)}%). Warm-up and skipped sets are not counted.` +
    (abandoned ? ' Includes an abandoned session.' : '');
  return scored(res, points, explanation, {
    raw,
    target: { plannedWorkingSets: planned },
    progress: ratio,
    partial: abandoned || inProgress > 0,
    notes,
    ignoredRecords,
  });
}

/* ───────────────────────── nutrition / hydration ───────────────────────── */

function findLog<T extends { date?: unknown }>(logs: readonly T[] | undefined, date: string, dataset: Dataset): { log: T | null; count: number } {
  if (!Array.isArray(logs)) return { log: null, count: 0 };
  const matches = logs.filter((l) => isRecord(l) && l.date === date && inDataset(l, dataset));
  // Same choice as the app's getNutritionLogForDate / getSleepLogForDate: the first match wins.
  return { log: matches[0] ?? null, count: matches.length };
}

function validEntry(e: unknown): e is FoodEntry {
  return isRecord(e) && isFiniteNumber(e.calories) && e.calories >= 0 && isFiniteNumber(e.protein) && e.protein >= 0;
}

function calorieFraction(ratio: number): number {
  const { low, high } = CALORIE_FULL_BAND;
  if (ratio >= low && ratio <= high) return 1;
  if (ratio < low) return clamp((ratio - CALORIE_ZERO_AT.low) / (low - CALORIE_ZERO_AT.low), 0, 1);
  return clamp((CALORIE_ZERO_AT.high - ratio) / (CALORIE_ZERO_AT.high - high), 0, 1);
}

function scoreNutrition(input: ScorecardInput, isToday: boolean): CategoryResult {
  const res = base('nutrition');
  const { log, count } = findLog(input.nutritionLogs, input.evaluationDate, input.dataset);
  const notes: string[] = [];
  if (count > 1) notes.push('More than one nutrition log exists for this day; the first one is used.');

  const entries = log && Array.isArray(log.entries) ? log.entries : [];
  if (!log || entries.length === 0) {
    return finish(
      res,
      'no_data',
      'No food was logged. An unlogged day is not treated as no food eaten, so nutrition is not scored.',
      { notes }
    );
  }

  const valid = entries.filter(validEntry);
  const ignored = entries.length - valid.length;
  if (valid.length === 0) {
    return finish(res, 'invalid_data', 'Logged food entries contain unusable values, so nutrition is not scored.', {
      notes,
      ignoredRecords: ignored,
    });
  }
  if (ignored > 0) notes.push(`${ignored} food ${plural(ignored, 'entry')} with invalid values ${plural(ignored, 'was', 'were')} ignored.`);

  const calories = valid.reduce((n, e) => n + e.calories, 0);
  const protein = valid.reduce((n, e) => n + e.protein, 0);
  const raw: Record<string, RawValue> = { calories: round1(calories), proteinG: round1(protein), loggedEntries: valid.length };
  for (const key of ['carbs', 'fat', 'fiber'] as const) {
    const sum = valid.reduce((n, e) => n + (isFiniteNumber(e[key]) && (e[key] as number) >= 0 ? (e[key] as number) : 0), 0);
    raw[key === 'carbs' ? 'carbsG' : key === 'fat' ? 'fatG' : 'fiberG'] = round1(sum);
  }

  const profile = input.profile;
  const calTarget = profile?.dailyCalorieTarget;
  const proTarget = profile?.dailyProteinTarget;
  const targetsValid =
    profile?.onboardingCompleted === true && isFiniteNumber(calTarget) && calTarget > 0 && isFiniteNumber(proTarget) && proTarget > 0;
  if (!targetsValid) {
    return finish(
      res,
      'insufficient_data',
      'No personal calorie and protein targets are set, so nutrition is not scored. Default values are never used.',
      { raw, notes, ignoredRecords: ignored }
    );
  }

  // A past day is scored against the targets saved with its own stored log when it has usable ones.
  // Today keeps using the live profile targets. A past day without a usable snapshot falls back to the
  // current profile targets and says so, because those may differ from what applied on that day.
  // The profile gate above is unchanged: without personal targets nothing is scored.
  let calUsed: number = calTarget;
  let proUsed: number = proTarget;
  if (!isToday) {
    const snapCal = (log as { targetCalories?: unknown }).targetCalories;
    const snapPro = (log as { targetProtein?: unknown }).targetProtein;
    if (isFiniteNumber(snapCal) && snapCal > 0 && isFiniteNumber(snapPro) && snapPro > 0) {
      calUsed = snapCal;
      proUsed = snapPro;
    } else {
      notes.push('No targets were saved with this day’s log, so your current targets were used. They may differ from what applied then.');
    }
  }

  const calRatio = calories / calUsed;
  const proRatio = protein / proUsed;
  const calPoints = NUTRITION_CALORIE_POINTS * calorieFraction(calRatio);
  const proPoints = NUTRITION_PROTEIN_POINTS * Math.min(1, proRatio);
  const partial = isToday;
  if (partial) notes.push(`Based on ${valid.length} logged ${plural(valid.length, 'entry', 'entries')} so far; today is not finished.`);

  const remaining: string[] = [];
  if (isToday) {
    if (calories < calUsed) remaining.push(`${Math.round(calUsed - calories)} kcal`);
    if (protein < proUsed) remaining.push(`${Math.round(proUsed - protein)} g protein`);
  }
  const action: ScorecardAction | null =
    remaining.length > 0 ? { kind: 'remaining_targets', message: `${remaining.join(' and ')} remaining to reach your daily targets.` } : null;

  return scored(
    res,
    calPoints + proPoints,
    `Calories earn full points within 90–110% of target; protein earns points up to 100% of target. ` +
      `Logged ${Math.round(calories)} of ${Math.round(calUsed)} kcal and ${Math.round(protein)} of ${Math.round(proUsed)} g protein.`,
    {
      raw,
      target: { calories: calUsed, proteinG: proUsed },
      progress: calRatio,
      partial,
      notes,
      ignoredRecords: ignored,
      action,
    }
  );
}

function scoreHydration(input: ScorecardInput): CategoryResult {
  const res = base('hydration');
  const { log } = findLog(input.nutritionLogs, input.evaluationDate, input.dataset);
  const water = log ? (log as { waterMl?: unknown }).waterMl : undefined;
  const target: Record<string, RawValue> = { waterMl: null };

  if (log && water !== undefined && !(isFiniteNumber(water) && water >= 0)) {
    return finish(res, 'invalid_data', 'The logged water amount is not a valid value.', { target, ignoredRecords: 1 });
  }
  // The app stores 0 for "nothing logged", so 0 cannot be told apart from an unlogged day.
  if (!log || !isFiniteNumber(water) || water === 0) {
    return finish(res, 'no_data', 'No water intake was logged.', { target });
  }
  return finish(
    res,
    'informational',
    `${Math.round(water)} ml logged. No hydration target is set, so hydration is shown for information and not scored.`,
    { raw: { waterMl: water }, target }
  );
}

/* ───────────────────────── sleep ───────────────────────── */

function sleepFraction(hours: number): number {
  const { minHours, maxHours, zeroAfterMaxHours } = SLEEP_GUIDELINE;
  if (hours >= minHours && hours <= maxHours) return 1;
  if (hours < minHours) return clamp(hours / minHours, 0, 1);
  return clamp(1 - (hours - maxHours) / zeroAfterMaxHours, 0, 1);
}

function scoreSleep(input: ScorecardInput): CategoryResult {
  const res = base('sleep');
  const { log, count } = findLog(input.sleepLogs, input.evaluationDate, input.dataset);
  const notes: string[] = [];
  if (count > 1) notes.push('More than one sleep log exists for this day; the first one is used.');
  const target: Record<string, RawValue> = { minHours: SLEEP_GUIDELINE.minHours, maxHours: SLEEP_GUIDELINE.maxHours };

  if (!log) return finish(res, 'no_data', 'No sleep was logged. Missing sleep is not treated as zero sleep.', { target, notes });

  const hours = (log as { hoursSlept?: unknown }).hoursSlept;
  if (!isFiniteNumber(hours) || hours < 0 || hours > 24) {
    return finish(res, 'invalid_data', 'The logged sleep duration is not a valid value, so sleep is not scored.', {
      target,
      notes,
      ignoredRecords: 1,
    });
  }

  const raw: Record<string, RawValue> = { hoursSlept: hours };
  const optional: [string, unknown][] = [
    ['quality', (log as { quality?: unknown }).quality],
    ['restingHeartRate', (log as { restingHeartRate?: unknown }).restingHeartRate],
    ['hrvMs', (log as { hrvMs?: unknown }).hrvMs],
  ];
  for (const [k, v] of optional) if (isFiniteNumber(v) && v >= 0) raw[k] = v; // information only, never scored

  const { minHours, maxHours } = SLEEP_GUIDELINE;
  let action: ScorecardAction | null = null;
  if (hours < minHours)
    action = { kind: 'sleep_gap', message: `${round1(minHours - hours)} h below the ${minHours} h guideline minimum.` };
  else if (hours > maxHours)
    action = { kind: 'sleep_gap', message: `${round1(hours - maxHours)} h above the ${maxHours} h guideline maximum.` };

  return scored(
    res,
    res.maxPoints * sleepFraction(hours),
    `Points reflect logged sleep duration (${round1(hours)} h) against a default ${minHours}–${maxHours} h guideline, not a personalized target. ` +
      'Sleep quality, resting heart rate and HRV are shown for information only.',
    { raw, target, progress: hours / minHours, notes, action }
  );
}

/* ───────────────────────── recovery ───────────────────────── */

function scoreRecovery(): CategoryResult {
  return finish(
    base('recovery'),
    'informational',
    'Recovery is not scored. Training-load context from the Muscle Map is shown for information and is not a physiological recovery measure.'
  );
}

/* ───────────────────────── overall ───────────────────────── */

function emptyCategories(reason: string): Record<CategoryId, CategoryResult> {
  const out = {} as Record<CategoryId, CategoryResult>;
  for (const id of CATEGORY_ORDER) out[id] = finish(base(id), 'no_data', reason);
  return out;
}

export function evaluateDailyScorecard(input: ScorecardInput): ScorecardResult {
  const fullMax = CATEGORY_ORDER.reduce((n, id) => n + SCORECARD_WEIGHTS[id], 0);
  const issues: string[] = [];
  if (!isValidDayKey(input?.evaluationDate)) issues.push('evaluationDate must be a valid YYYY-MM-DD day.');
  if (!isValidDayKey(input?.today)) issues.push('today must be a valid YYYY-MM-DD day.');
  if (issues.length === 0 && dayNumber(input.evaluationDate) > dayNumber(input.today))
    issues.push('evaluationDate cannot be in the future.');
  if (input?.dataset !== 'real' && input?.dataset !== 'demo') issues.push("dataset must be 'real' or 'demo'.");

  if (issues.length > 0) {
    return {
      evaluationDate: String(input?.evaluationDate ?? ''),
      today: String(input?.today ?? ''),
      isToday: false,
      dataset: input?.dataset === 'demo' ? 'demo' : 'real',
      status: 'invalid_input',
      earnedPoints: 0,
      eligibleMax: 0,
      percent: null,
      fullMax,
      scoredCount: 0,
      totalCategories: CATEGORY_ORDER.length,
      scoredCategories: [],
      unscoredCategories: [...CATEGORY_ORDER],
      categories: emptyCategories('Not evaluated because the requested date is not valid.'),
      issues,
      limitations: [],
    };
  }

  const isToday = input.evaluationDate === input.today;
  const categories: Record<CategoryId, CategoryResult> = {
    workout: scoreWorkout(input),
    nutrition: scoreNutrition(input, isToday),
    hydration: scoreHydration(input),
    sleep: scoreSleep(input),
    recovery: scoreRecovery(),
  };

  const scoredCategories = CATEGORY_ORDER.filter((id) => categories[id].status === 'scored');
  const unscoredCategories = CATEGORY_ORDER.filter((id) => categories[id].status !== 'scored');
  const earnedPoints = round2(scoredCategories.reduce((n, id) => n + (categories[id].points ?? 0), 0));
  const eligibleMax = scoredCategories.reduce((n, id) => n + categories[id].eligibleMax, 0);
  const sufficient = scoredCategories.length >= MIN_SCORED_CATEGORIES && eligibleMax >= MIN_ELIGIBLE_MAX;

  const limitations: string[] = [];
  const logBased: CategoryId[] = ['nutrition', 'sleep'];
  if (logBased.some((id) => categories[id].status !== 'no_data')) limitations.push(UTC_DATE_LIMITATION);

  return {
    evaluationDate: input.evaluationDate,
    today: input.today,
    isToday,
    dataset: input.dataset,
    status: sufficient ? 'scored' : 'insufficient_data',
    earnedPoints,
    eligibleMax,
    percent: sufficient ? round1((earnedPoints / eligibleMax) * 100) : null,
    fullMax,
    scoredCount: scoredCategories.length,
    totalCategories: CATEGORY_ORDER.length,
    scoredCategories,
    unscoredCategories,
    categories,
    issues,
    limitations,
  };
}
