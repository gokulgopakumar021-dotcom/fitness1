import type { DailyNutritionLog, UserProfile, WorkoutPlan, WorkoutSession } from '../types';
import { calculateHydrationGoal, calculateVolumeLoad } from './calculations';
import { extractExerciseHistory } from './progressionEngine';
import { weightPrHistory } from './progressionPresentation';

/**
 * Presentation helpers for the Home screen.
 * They only filter, group and sum values the app already stores or calculates (volume load, the progression
 * engine's exercise history, the hydration goal). Day keys follow the app-wide convention (YYYY-MM-DD, UTC,
 * see getCurrentDayKey), so Home agrees with the Workout and Nutrition screens about what "today" is.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const keyToUtcMs = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const utcMsToKey = (ms: number): string => new Date(ms).toISOString().split('T')[0];

/** Day key `days` before `todayKey` (negative = after). */
export function shiftDayKey(todayKey: string, days: number): string {
  return utcMsToKey(keyToUtcMs(todayKey) - days * DAY_MS);
}

/** Monday of the week containing `todayKey` (same Monday-start rule the old Home screen used). */
export function weekStartKey(todayKey: string): string {
  const dow = new Date(keyToUtcMs(todayKey)).getUTCDay(); // 0 = Sunday
  return shiftDayKey(todayKey, dow === 0 ? 6 : dow - 1);
}

const byNewest = (a: WorkoutSession, b: WorkoutSession) =>
  b.date.localeCompare(a.date) || (b.startTime || '').localeCompare(a.startTime || '');

export const completedOnly = (sessions: WorkoutSession[]): WorkoutSession[] =>
  sessions.filter((s) => s.status === 'completed');

/** Completed sessions dated on or after the Monday of this week, and up to today. */
export function completedThisWeek(completed: WorkoutSession[], todayKey: string): WorkoutSession[] {
  const start = weekStartKey(todayKey);
  return completed.filter((s) => s.date >= start && s.date <= todayKey);
}

/** Newest-first completed sessions, capped at `limit`. */
export function latestSessions(completed: WorkoutSession[], limit: number): WorkoutSession[] {
  return [...completed].sort(byNewest).slice(0, limit);
}

/** Working-set volume of one session, using the same calculation as Reports and Progression. */
export function sessionVolume(session: WorkoutSession): number {
  return Math.round(calculateVolumeLoad(session.exercises.flatMap((e) => e.sets), true));
}

export function completedSetCount(session: WorkoutSession): number {
  return session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.completed && !s.skipped).length, 0);
}

export interface VolumePoint {
  label: string;
  value: number;
  date: string;
}

/** Volume per session for the latest `limit` sessions, oldest first, skipping sessions with no volume. */
export function volumeTrend(completed: WorkoutSession[], limit = 6): VolumePoint[] {
  return latestSessions(completed, limit)
    .map((s) => ({ date: s.date, value: sessionVolume(s) }))
    .filter((p) => p.value > 0)
    .reverse()
    .map((p) => ({ ...p, label: p.date.slice(5) }));
}

export type TodayWorkoutStatus = 'in_progress' | 'completed' | 'none';

/** An active session wins, then a completed session dated today, otherwise nothing logged today. */
export function todayWorkoutStatus(
  activeSession: WorkoutSession | null,
  completed: WorkoutSession[],
  todayKey: string
): TodayWorkoutStatus {
  if (activeSession) return 'in_progress';
  return completed.some((s) => s.date === todayKey) ? 'completed' : 'none';
}

/** Most recent completed date per plan day, for the routine card ("Last done"). */
export function lastDoneByDay(completed: WorkoutSession[], planId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of completed) {
    if (s.planId !== planId || !s.dayId) continue;
    if (!out[s.dayId] || s.date > out[s.dayId]) out[s.dayId] = s.date;
  }
  return out;
}

export const resolveActivePlan = (plans: WorkoutPlan[], activePlanId: string | null): WorkoutPlan | null => {
  if (activePlanId) {
    const found = plans.find((p) => p.id === activePlanId);
    if (found) return found;
  }
  return plans.find((p) => p.isActive) || plans[0] || null;
};

export interface RecentPr {
  exerciseName: string;
  weight: number;
  previousBest: number;
  date: string;
}

/**
 * Exercises whose top working weight beat every earlier session within the last `windowDays`.
 * Built from the progression engine's history + weightPrHistory. A first-ever log is not a PR
 * (previousBest 0), so it is left out rather than celebrated.
 */
export function recentWeightPrs(
  completed: WorkoutSession[],
  todayKey: string,
  windowDays = 30,
  limit = 3
): RecentPr[] {
  const cutoff = shiftDayKey(todayKey, windowDays);
  const names = new Set<string>();
  for (const s of completed) {
    if (s.date < cutoff) continue;
    for (const ex of s.exercises) names.add(ex.name);
  }
  const prs: RecentPr[] = [];
  names.forEach((name) => {
    const history = extractExerciseHistory(completed, name);
    if (!history) return;
    for (const pr of weightPrHistory(history.sessions)) {
      if (pr.previousBest > 0 && pr.date >= cutoff) {
        prs.push({ exerciseName: name, weight: pr.weight, previousBest: pr.previousBest, date: pr.date });
      }
    }
  });
  return prs.sort((a, b) => b.date.localeCompare(a.date) || b.weight - a.weight).slice(0, limit);
}

export interface NutritionSummary {
  hasEntries: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** null = the profile has no usable target; the UI says so instead of inventing one. */
  targets: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
  waterMl: number;
  waterGoalMl: number | null;
}

const positive = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;

/** Totals from today's log plus the live profile targets (the same source the Nutrition screen uses for today). */
export function summarizeNutrition(log: DailyNutritionLog | null, profile: UserProfile): NutritionSummary {
  const entries = log?.entries ?? [];
  const sum = (pick: (e: (typeof entries)[number]) => number | undefined) =>
    entries.reduce((acc, e) => acc + (Number(pick(e)) || 0), 0);
  const weight = positive(profile.currentWeightKg);
  return {
    hasEntries: entries.length > 0,
    calories: Math.round(sum((e) => e.calories)),
    protein: Math.round(sum((e) => e.protein)),
    carbs: Math.round(sum((e) => e.carbs)),
    fat: Math.round(sum((e) => e.fat)),
    targets: {
      calories: positive(profile.dailyCalorieTarget),
      protein: positive(profile.dailyProteinTarget),
      carbs: positive(profile.dailyCarbsTarget),
      fat: positive(profile.dailyFatTarget)
    },
    waterMl: Math.max(0, Number(log?.waterMl) || 0),
    // Same goal the Nutrition screen's water logger shows; no goal when there is no body weight to base it on.
    waterGoalMl: weight ? calculateHydrationGoal(weight, profile.trainingDaysPerWeek || 4).dailyGoalMl : null
  };
}

const ML_PER_FL_OZ = 29.5735296;

/** Water amount in the user's unit system: fl oz for lbs users, litres otherwise. */
export function formatWater(ml: number, preferredUnit: 'kg' | 'lbs'): string {
  if (preferredUnit === 'lbs') return `${Math.round(ml / ML_PER_FL_OZ)} fl oz`;
  return `${Number((ml / 1000).toFixed(2))} L`;
}
