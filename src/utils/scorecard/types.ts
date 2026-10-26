import type { DailyNutritionLog, DailySleepLog, UserProfile, WorkoutPlan, WorkoutSession } from '../../types';

/** Which records are read: real user data, or demo data. Same convention as the Muscle Map. */
export type Dataset = 'real' | 'demo';

export type CategoryId = 'workout' | 'nutrition' | 'hydration' | 'sleep' | 'recovery';

/**
 * Data state of a category. "Missing / invalid / incomplete / valid" map as follows:
 * - scored            valid data, points awarded (an actual 0 is a scored 0). `partial: true` marks
 *                     valid-but-incomplete data (e.g. an abandoned session, a day still in progress).
 * - no_data           missing: nothing was logged. Never equal to zero performance.
 * - insufficient_data data exists but cannot be scored (e.g. no personal target, unresolvable plan).
 * - invalid_data      records exist but none are usable (non-finite, negative, out of range, malformed).
 * - in_progress       a workout is still being logged; not scored yet.
 * - informational     shown for context only; never earns or costs points in this version.
 */
export type CategoryStatus =
  | 'scored'
  | 'no_data'
  | 'insufficient_data'
  | 'invalid_data'
  | 'in_progress'
  | 'informational';

export type RawValue = number | string | boolean | null;

export interface ScorecardAction {
  kind: 'resume_session' | 'remaining_targets' | 'sleep_gap';
  message: string;
}

export interface CategoryResult {
  id: CategoryId;
  label: string;
  status: CategoryStatus;
  /** The category's configured weight (e.g. 20 for workout). */
  maxPoints: number;
  /** Points this category contributes to the eligible maximum: `maxPoints` if scored, else 0. */
  eligibleMax: number;
  /** Points awarded. null unless status === 'scored'. */
  points: number | null;
  /** True when the data is valid but known to be incomplete (abandoned session, day not finished). */
  partial: boolean;
  /** Measured values the category used or displays. */
  raw: Record<string, RawValue>;
  /** Targets / guideline values the category compared against. */
  target: Record<string, RawValue>;
  /** Primary measured value divided by its target (uncapped), or null when not computable. */
  progress: number | null;
  explanation: string;
  notes: string[];
  action: ScorecardAction | null;
  /** Records for the selected day/dataset that were skipped because they were unusable. */
  ignoredRecords: number;
}

export type ScorecardStatus = 'scored' | 'insufficient_data' | 'invalid_input';

export interface ScorecardResult {
  /** Selected local calendar day, 'YYYY-MM-DD'. */
  evaluationDate: string;
  /** The caller's local "today", 'YYYY-MM-DD'. */
  today: string;
  isToday: boolean;
  dataset: Dataset;
  status: ScorecardStatus;
  /** Sum of points over scored categories. */
  earnedPoints: number;
  /** Sum of maxPoints over scored categories. */
  eligibleMax: number;
  /** earnedPoints / eligibleMax * 100 (1 decimal). null unless status === 'scored'. */
  percent: number | null;
  /** Sum of all configured weights (100). */
  fullMax: number;
  scoredCount: number;
  totalCategories: number;
  scoredCategories: CategoryId[];
  /** Categories that did not contribute points (any non-scored status). */
  unscoredCategories: CategoryId[];
  categories: Record<CategoryId, CategoryResult>;
  /** Problems with the call itself (bad dates). Empty when the input is well formed. */
  issues: string[];
  /** Known data limitations that apply to this evaluation. */
  limitations: string[];
}

/** The subset of the user profile the scorecard reads. */
export type ScorecardProfile = Pick<
  UserProfile,
  'onboardingCompleted' | 'dailyCalorieTarget' | 'dailyProteinTarget'
>;

export interface ScorecardInput {
  /** Selected local calendar day, 'YYYY-MM-DD'. */
  evaluationDate: string;
  /** The caller's local "today", 'YYYY-MM-DD'. Passed explicitly; the engine never reads the clock. */
  today: string;
  dataset: Dataset;
  sessions: readonly WorkoutSession[];
  plans: readonly WorkoutPlan[];
  nutritionLogs: readonly DailyNutritionLog[];
  sleepLogs: readonly DailySleepLog[];
  profile: Partial<ScorecardProfile> | null | undefined;
}
