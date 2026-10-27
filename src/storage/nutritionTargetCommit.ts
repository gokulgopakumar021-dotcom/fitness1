import type { BodyMetricEntry, DailyNutritionLog, UserProfile } from '../types';

/**
 * The app's current-day key convention: UTC date (YYYY-MM-DD) from toISOString().
 * Same expression NutritionView, DashboardView and the wizard already use. Intentionally unchanged.
 */
export const getCurrentDayKey = (): string => new Date().toISOString().split('T')[0];

/** Subset of the db API the commit needs. Write methods must return true only on real success. */
export interface NutritionTargetStore {
  saveProfile(profile: UserProfile): boolean;
  getNutritionLogForDate(dateStr: string): DailyNutritionLog;
  saveNutritionLogForDate(log: DailyNutritionLog): boolean;
  addOrUpdateBodyMetric(entry: BodyMetricEntry): boolean;
}

export interface NutritionTargetCommitInput {
  /** Fully built profile to persist. */
  profile: UserProfile;
  /** The diary log currently shown in NutritionView (may be a past date). Only used if it is today's. */
  viewedLog?: DailyNutritionLog;
  targets: { calories: number; protein: number; carbs: number; fat: number };
  /** Metric to upsert for today's date. Omit optional fields the user did not provide. */
  metric: BodyMetricEntry;
  /** Override for tests; defaults to getCurrentDayKey(). */
  dayKey?: string;
}

export type NutritionCommitStage = 'profile' | 'todayLog' | 'bodyMetric';

export interface NutritionTargetCommitResult {
  ok: boolean;
  persisted: { profile: boolean; todayLog: boolean; bodyMetric: boolean };
  failedStage?: NutritionCommitStage;
  /** Non-sensitive, user-facing message when ok is false. */
  message?: string;
  profile: UserProfile;
  /** Today's log with the new targets (set once it was written successfully). */
  todayLog?: DailyNutritionLog;
  /** True when the diary being viewed is a different date; that log is never written. */
  viewingPastDate: boolean;
}

const FAILURE_MESSAGES: Record<NutritionCommitStage, string> = {
  profile:
    'Your targets could not be saved, and nothing was changed. Check that your device has free storage and try again.',
  todayLog:
    "Your profile targets were saved, but today's diary targets could not be saved. Try again to finish.",
  bodyMetric:
    "Your targets were saved, but today's body measurement could not be saved. Try again to finish."
};

function attempt(write: () => boolean): boolean {
  try {
    return write() === true;
  } catch {
    return false;
  }
}

/**
 * Persists wizard results in order: profile, today's log, today's body metric.
 *
 * localStorage has no multi-key transaction, so this is NOT atomic. Each write is checked; the first
 * failure stops the sequence and the result says exactly what was and was not persisted. No rollback
 * or deletion is attempted, and every step is idempotent so a retry is safe. Only the log whose date
 * equals the current-day key is written; a historical log is never touched.
 */
export function commitNutritionTargets(
  store: NutritionTargetStore,
  input: NutritionTargetCommitInput
): NutritionTargetCommitResult {
  const dayKey = input.dayKey ?? getCurrentDayKey();
  const viewingPastDate = !!input.viewedLog && input.viewedLog.date !== dayKey;
  const persisted = { profile: false, todayLog: false, bodyMetric: false };
  const result: NutritionTargetCommitResult = {
    ok: false,
    persisted,
    profile: input.profile,
    viewingPastDate
  };
  const fail = (stage: NutritionCommitStage): NutritionTargetCommitResult => ({
    ...result,
    failedStage: stage,
    message: FAILURE_MESSAGES[stage]
  });

  // 1. Profile
  if (!attempt(() => store.saveProfile(input.profile))) return fail('profile');
  persisted.profile = true;

  // 2. Today's log only (food entries and every other field preserved via spread)
  let base: DailyNutritionLog | undefined;
  try {
    base =
      input.viewedLog && input.viewedLog.date === dayKey
        ? input.viewedLog
        : store.getNutritionLogForDate(dayKey);
  } catch {
    base = undefined;
  }
  if (!base || base.date !== dayKey) return fail('todayLog');
  const todayLog: DailyNutritionLog = {
    ...base,
    targetCalories: input.targets.calories,
    targetProtein: input.targets.protein,
    targetCarbs: input.targets.carbs,
    targetFat: input.targets.fat
  };
  if (!attempt(() => store.saveNutritionLogForDate(todayLog))) return fail('todayLog');
  persisted.todayLog = true;
  result.todayLog = todayLog;

  // 3. Body metric
  if (!attempt(() => store.addOrUpdateBodyMetric(input.metric))) return fail('bodyMetric');
  persisted.bodyMetric = true;

  return { ...result, ok: true };
}
