import type { DailyNutritionLog, UserProfile } from '../types';

/**
 * Where the displayed targets came from:
 * - 'current':  today (or a future day): the live profile targets. Unchanged behavior.
 * - 'snapshot': a past day whose STORED log carries its own saved targets.
 * - 'fallback': a past day with no stored log, or a stored log without a usable snapshot.
 *               The current profile targets are shown for reference only; they are NOT
 *               the historical target and the UI must not present them as such.
 */
export type TargetSource = 'current' | 'snapshot' | 'fallback';

export interface ResolvedTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: TargetSource;
}

/** Display defaults used by the diary when the profile has no target. Same values NutritionView always used. */
export const DIARY_DEFAULT_TARGETS = { calories: 2600, protein: 165, carbs: 300, fat: 70 } as const;

const isPositiveFinite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** A snapshot is usable only when all four saved targets are positive finite numbers. */
export function hasUsableTargetSnapshot(log: DailyNutritionLog | null | undefined): log is DailyNutritionLog {
  return (
    !!log &&
    isPositiveFinite(log.targetCalories) &&
    isPositiveFinite(log.targetProtein) &&
    isPositiveFinite(log.targetCarbs) &&
    isPositiveFinite(log.targetFat)
  );
}

export interface ResolveTargetsInput {
  /** The diary day being displayed, YYYY-MM-DD. */
  date: string;
  /** The app's current-day key (UTC convention, see getCurrentDayKey). */
  today: string;
  profile: Pick<UserProfile, 'dailyCalorieTarget' | 'dailyProteinTarget' | 'dailyCarbsTarget' | 'dailyFatTarget'>;
  /** The log shown for `date`. Ignored unless its date matches `date`. */
  log?: DailyNutritionLog | null;
  /**
   * True only when `log` was read from storage. db.getNutritionLogForDate fabricates an unsaved log
   * stamped with the CURRENT profile targets for days that have none; such a log is not a snapshot.
   */
  logIsStored: boolean;
}

/**
 * Chooses the targets to display for a diary day.
 * Dates are compared as YYYY-MM-DD strings, which sort chronologically.
 */
export function resolveDiaryTargets(input: ResolveTargetsInput): ResolvedTargets {
  const { date, today, profile, log, logIsStored } = input;
  const current = {
    calories: profile.dailyCalorieTarget || DIARY_DEFAULT_TARGETS.calories,
    protein: profile.dailyProteinTarget || DIARY_DEFAULT_TARGETS.protein,
    carbs: profile.dailyCarbsTarget || DIARY_DEFAULT_TARGETS.carbs,
    fat: profile.dailyFatTarget || DIARY_DEFAULT_TARGETS.fat
  };

  if (date >= today) return { ...current, source: 'current' };

  if (logIsStored && log && log.date === date && hasUsableTargetSnapshot(log)) {
    return {
      calories: log.targetCalories,
      protein: log.targetProtein,
      carbs: log.targetCarbs,
      fat: log.targetFat,
      source: 'snapshot'
    };
  }
  return { ...current, source: 'fallback' };
}

/** User-facing caption for a resolved source, or null when no caption is needed. */
export function targetSourceCaption(source: TargetSource): string | null {
  switch (source) {
    case 'snapshot':
      return 'Targets shown are the ones saved with this day’s log.';
    case 'fallback':
      return 'No targets were saved for this day, so your current targets are shown for reference. They may differ from what applied then.';
    default:
      return null;
  }
}
