import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../storage/db';
import type { DailyNutritionLog, FoodEntry, LoggedSet, WorkoutSession } from '../types';
import {
  completedOnly,
  completedThisWeek,
  formatWater,
  lastDoneByDay,
  latestSessions,
  recentWeightPrs,
  resolveActivePlan,
  sessionVolume,
  shiftDayKey,
  summarizeNutrition,
  todayWorkoutStatus,
  volumeTrend,
  weekStartKey
} from './homeSummary';

const set = (weight: number, reps: number, over: Partial<LoggedSet> = {}): LoggedSet => ({
  id: `s-${weight}-${reps}`,
  setNumber: 1,
  type: 'working',
  weight,
  reps,
  completed: true,
  timestamp: '2026-10-29T08:00:00.000Z',
  ...over
});

const session = (
  id: string,
  date: string,
  sets: LoggedSet[],
  over: Partial<WorkoutSession> = {}
): WorkoutSession => ({
  id,
  dayName: 'Push',
  date,
  startTime: `${date}T08:00:00.000Z`,
  status: 'completed',
  exercises: [
    {
      id: `e-${id}`,
      name: 'Bench Press',
      muscleGroup: 'chest',
      equipment: 'barbell',
      repRange: '5-8',
      targetRir: 2,
      restSeconds: 120,
      sets
    }
  ],
  ...over
});

describe('day keys', () => {
  it('shifts by whole days across month boundaries', () => {
    expect(shiftDayKey('2026-03-01', 1)).toBe('2026-02-28');
    expect(shiftDayKey('2026-10-29', -2)).toBe('2026-10-31');
  });

  it('finds the Monday of the week, treating Sunday as the end of the week', () => {
    expect(weekStartKey('2026-10-29')).toBe('2026-10-26'); // Thursday
    expect(weekStartKey('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(weekStartKey('2026-11-01')).toBe('2026-10-26'); // Sunday
  });
});

describe('session helpers', () => {
  const sessions = [
    session('a', '2026-10-20', [set(60, 8)]),
    session('b', '2026-10-27', [set(62.5, 8)]),
    session('c', '2026-10-28', [set(60, 8)], { status: 'abandoned' }),
    session('d', '2026-10-29', [set(65, 6)])
  ];
  const completed = completedOnly(sessions);

  it('keeps completed sessions only', () => {
    expect(completed.map((s) => s.id)).toEqual(['a', 'b', 'd']);
  });

  it('counts this week, not older sessions or abandoned ones', () => {
    expect(completedThisWeek(completed, '2026-10-29').map((s) => s.id)).toEqual(['b', 'd']);
    expect(completedThisWeek(completed, '2026-10-22')).toHaveLength(1);
  });

  it('returns newest first and respects the limit', () => {
    expect(latestSessions(completed, 2).map((s) => s.id)).toEqual(['d', 'b']);
  });

  it('sums working-set volume, ignoring warm-ups and incomplete or skipped sets', () => {
    const s = session('v', '2026-10-29', [
      set(100, 5),
      set(100, 5, { completed: false }),
      set(100, 5, { skipped: true }),
      set(40, 10, { type: 'warmup' })
    ]);
    expect(sessionVolume(s)).toBe(500);
  });

  it('builds a chronological volume trend and drops sessions with no volume', () => {
    const empty = session('z', '2026-10-30', [set(50, 5, { completed: false })]);
    const trend = volumeTrend([...completed, empty], 6);
    expect(trend.map((p) => p.date)).toEqual(['2026-10-20', '2026-10-27', '2026-10-29']);
    expect(trend[0].value).toBe(480);
  });

  it('reports today status: active wins, then a completed session today, otherwise none', () => {
    expect(todayWorkoutStatus(sessions[0], completed, '2026-10-29')).toBe('in_progress');
    expect(todayWorkoutStatus(null, completed, '2026-10-29')).toBe('completed');
    expect(todayWorkoutStatus(null, completed, '2026-10-30')).toBe('none');
  });

  it('finds the last completed date per plan day', () => {
    const withDays = [
      session('1', '2026-10-01', [set(60, 8)], { planId: 'p', dayId: 'd1' }),
      session('2', '2026-10-10', [set(60, 8)], { planId: 'p', dayId: 'd1' }),
      session('3', '2026-10-12', [set(60, 8)], { planId: 'other', dayId: 'd1' }),
      session('4', '2026-10-08', [set(60, 8)], { planId: 'p', dayId: 'd2' })
    ];
    expect(lastDoneByDay(withDays, 'p')).toEqual({ d1: '2026-10-10', d2: '2026-10-08' });
  });

  it('resolves the active plan by id, then flag, then first plan, else null', () => {
    const plan = (id: string, isActive = false) =>
      ({ id, name: id, trainingSplit: '', createdAt: '', updatedAt: '', isActive, days: [] }) as never;
    const plans = [plan('a'), plan('b', true)];
    expect(resolveActivePlan(plans, 'a')?.id).toBe('a');
    expect(resolveActivePlan(plans, 'missing')?.id).toBe('b');
    expect(resolveActivePlan([plan('x')], null)?.id).toBe('x');
    expect(resolveActivePlan([], null)).toBeNull();
  });
});

describe('recentWeightPrs', () => {
  const today = '2026-10-29';

  it('lists a PR set inside the window and ignores the first-ever log', () => {
    const completed = [
      session('1', '2026-10-01', [set(60, 8)]),
      session('2', '2026-10-15', [set(62.5, 8)]),
      session('3', '2026-10-22', [set(62.5, 6)]) // equal weight: not a PR
    ];
    expect(recentWeightPrs(completed, today)).toEqual([
      { exerciseName: 'Bench Press', weight: 62.5, previousBest: 60, date: '2026-10-15' }
    ]);
  });

  it('ignores PRs older than the window', () => {
    const completed = [
      session('1', '2026-07-01', [set(60, 8)]),
      session('2', '2026-08-01', [set(65, 8)])
    ];
    expect(recentWeightPrs(completed, today)).toEqual([]);
  });

  it('returns nothing when there is no history', () => {
    expect(recentWeightPrs([], today)).toEqual([]);
  });
});

describe('summarizeNutrition', () => {
  const entry = (calories: number, protein: number, carbs = 0, fat = 0): FoodEntry =>
    ({ id: `f${calories}`, name: 'x', mealCategory: 'lunch', quantity: 1, servingUnit: 'g', calories, protein, carbs, fat }) as FoodEntry;
  const log = (entries: FoodEntry[], waterMl = 0): DailyNutritionLog => ({
    id: 'l',
    date: '2026-10-29',
    entries,
    waterMl,
    targetCalories: 0,
    targetProtein: 0,
    targetCarbs: 0,
    targetFat: 0
  });
  const profile = {
    ...DEFAULT_PROFILE,
    dailyCalorieTarget: 2400,
    dailyProteinTarget: 180,
    dailyCarbsTarget: 250,
    dailyFatTarget: 70,
    currentWeightKg: 80
  };

  it('totals today and passes profile targets through', () => {
    const s = summarizeNutrition(log([entry(500, 40, 50, 10), entry(700, 50, 80, 20)], 750), profile);
    expect(s).toMatchObject({ hasEntries: true, calories: 1200, protein: 90, carbs: 130, fat: 30, waterMl: 750 });
    expect(s.targets).toEqual({ calories: 2400, protein: 180, carbs: 250, fat: 70 });
    expect(s.waterGoalMl).toBeGreaterThan(0);
  });

  it('reports no entries for an empty or missing log, without inventing values', () => {
    expect(summarizeNutrition(log([]), profile).hasEntries).toBe(false);
    expect(summarizeNutrition(null, profile)).toMatchObject({ hasEntries: false, calories: 0, waterMl: 0 });
  });

  it('returns null targets and goal when the profile has none, instead of defaults', () => {
    const bare = { ...profile, dailyCalorieTarget: 0, dailyProteinTarget: 0, dailyCarbsTarget: 0, dailyFatTarget: 0, currentWeightKg: 0 };
    const s = summarizeNutrition(log([entry(100, 5)]), bare);
    expect(s.targets).toEqual({ calories: null, protein: null, carbs: null, fat: null });
    expect(s.waterGoalMl).toBeNull();
  });
});

describe('formatWater', () => {
  it('uses litres for kg users and fl oz for lbs users', () => {
    expect(formatWater(1500, 'kg')).toBe('1.5 L');
    expect(formatWater(0, 'kg')).toBe('0 L');
    expect(formatWater(10000, 'kg')).toBe('10 L');
    expect(formatWater(2957, 'lbs')).toBe('100 fl oz');
  });
});
