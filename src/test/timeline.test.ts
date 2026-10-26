import { describe, it, expect } from 'vitest';
import {
  formatLocalDate,
  resolveDateRange,
  getPreviousComparisonRange,
  computeComparison,
  getFilteredBodyMetrics,
  getFilteredCompletedWorkouts,
  getExerciseProgressionHistory,
  getRecordedExerciseNames,
  getFilteredNutritionDays,
  getFilteredSleepLogs,
  buildTimelineOverview
} from '../utils/timelineEngine';
import {
  BodyMetricEntry,
  DailyNutritionLog,
  DailySleepLog,
  UserProfile,
  WorkoutSession
} from '../types';

describe('Long-Term Progress Timeline Engine', () => {
  const baseProfile: UserProfile = {
    name: 'Athlete John',
    age: 28,
    sex: 'male',
    heightCm: 180,
    currentWeightKg: 80,
    goalWeightKg: 84,
    primaryGoal: 'muscle_gain',
    trainingExperience: 'intermediate',
    trainingDaysPerWeek: 4,
    preferredUnit: 'kg',
    dailyCalorieTarget: 2800,
    dailyProteinTarget: 170,
    dailyCarbsTarget: 320,
    dailyFatTarget: 70,
    trainingSplitName: 'Push / Pull / Legs',
    trainingPhase: 'hypertrophy',
    defaultTargetRir: 2,
    minBarbellIncrement: 2.5,
    minDumbbellIncrement: 2.0,
    minMachineIncrement: 2.5,
    excludeWarmupFromVolume: true,
    onboardingCompleted: true
  };

  describe('Date Range Resolution & Boundaries', () => {
    const fixedRef = new Date('2026-10-26T12:00:00Z');

    it('resolves 7-day range correctly ending at reference date', () => {
      const range = resolveDateRange('7d', undefined, undefined, fixedRef);
      expect(range.endDate).toBe('2026-10-26');
      expect(range.startDate).toBe('2026-10-20');
    });

    it('resolves 30-day range correctly ending at reference date', () => {
      const range = resolveDateRange('30d', undefined, undefined, fixedRef);
      expect(range.endDate).toBe('2026-10-26');
      expect(range.startDate).toBe('2026-09-27');
    });

    it('clamps custom date range to prevent future dates from being recorded history', () => {
      const range = resolveDateRange('custom', '2026-10-01', '2026-11-15', fixedRef);
      expect(range.endDate).toBe('2026-10-26'); // clamped to today
      expect(range.startDate).toBe('2026-10-01');
    });

    it('resolves previous comparison period of identical day length', () => {
      const current = { startDate: '2026-10-01', endDate: '2026-10-10' }; // 10 days
      const prev = getPreviousComparisonRange(current);
      expect(prev.endDate).toBe('2026-09-30');
      expect(prev.startDate).toBe('2026-09-21'); // 10 days earlier
    });
  });

  describe('Comparison Calculations & Edge Cases', () => {
    it('calculates absolute and percentage change when valid baseline exists', () => {
      const comp = computeComparison(100, 80, 30, 30);
      expect(comp.hasBaseline).toBe(true);
      expect(comp.absoluteChange).toBe(20);
      expect(comp.percentChange).toBe(25); // +25%
    });

    it('handles zero baseline gracefully without dividing by zero', () => {
      const comp = computeComparison(10, 0, 30, 30);
      expect(comp.hasBaseline).toBe(true);
      expect(comp.absoluteChange).toBe(10);
      expect(comp.percentChange).toBeUndefined(); // undefined rather than Infinity or NaN
    });

    it('flags missing baseline when previous data is undefined or days are zero', () => {
      const comp = computeComparison(82.5, undefined, 10, 0);
      expect(comp.hasBaseline).toBe(false);
      expect(comp.absoluteChange).toBeUndefined();
      expect(comp.percentChange).toBeUndefined();
    });
  });

  describe('Body Weight & Measurement History', () => {
    const metrics: BodyMetricEntry[] = [
      { id: '1', date: '2026-09-01', weightKg: 78.0, waistCm: 82, bmi: 24.1 },
      { id: '2', date: '2026-10-01', weightKg: 79.5, waistCm: 81.5, bmi: 24.5 },
      { id: '3', date: '2026-10-15', weightKg: 80.2, bmi: 24.75 } // no waist recorded
    ];

    it('filters metrics by date range accurately', () => {
      const filtered = getFilteredBodyMetrics(metrics, { startDate: '2026-10-01', endDate: '2026-10-31' }, 'kg');
      expect(filtered.length).toBe(2);
      expect(filtered[0].date).toBe('2026-10-01');
      expect(filtered[1].date).toBe('2026-10-15');
      // Preserves missing waist as undefined rather than 0
      expect(filtered[1].waistCm).toBeUndefined();
    });

    it('converts weights to pounds for lbs profile preference without mutating stored kg', () => {
      const filtered = getFilteredBodyMetrics(metrics, { startDate: '2026-10-01', endDate: '2026-10-31' }, 'lbs');
      expect(filtered[0].weightKg).toBe(79.5);
      // 79.5 * 2.20462 = ~175.3 lbs
      expect(filtered[0].weightDisplay).toBe(175.3);
    });

    it('handles single observation honestly without inventing trend', () => {
      const single = [metrics[0]];
      const summary = buildTimelineOverview(
        { startDate: '2026-08-01', endDate: '2026-09-15' },
        single,
        [],
        [],
        [],
        baseProfile,
        false
      );
      expect(summary.weightMeasurementsCount).toBe(1);
      expect(summary.latestWeight?.weightKg).toBe(78.0);
      // No baseline for comparison
      expect(summary.weightComparison?.hasBaseline).toBe(false);
    });
  });

  describe('Workout Session & Exercise Progression Rules', () => {
    const sessions: WorkoutSession[] = [
      {
        id: 's-completed-1',
        dayName: 'Push Day',
        date: '2026-10-05',
        startTime: '2026-10-05T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'e1',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: '1', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
              { id: '2', setNumber: 2, type: 'working', weight: 80, reps: 8, completed: true, timestamp: '' },
              { id: '3', setNumber: 3, type: 'working', weight: 80, reps: 7, completed: true, timestamp: '' },
              { id: '4', setNumber: 4, type: 'working', weight: 80, reps: 6, completed: false, skipped: true, timestamp: '' }
            ]
          }
        ]
      },
      {
        id: 's-in-progress',
        dayName: 'Pull Day',
        date: '2026-10-08',
        startTime: '2026-10-08T10:00:00Z',
        status: 'in_progress', // NOT COMPLETED
        exercises: [
          {
            id: 'e2',
            name: 'Barbell Row',
            muscleGroup: 'Back',
            equipment: 'barbell',
            repRange: '8',
            targetRir: 2,
            restSeconds: 120,
            sets: [{ id: '5', setNumber: 1, type: 'working', weight: 70, reps: 8, completed: true, timestamp: '' }]
          }
        ]
      },
      {
        id: 's-abandoned',
        dayName: 'Leg Day',
        date: '2026-10-10',
        startTime: '2026-10-10T10:00:00Z',
        status: 'abandoned', // ABANDONED
        exercises: []
      },
      {
        id: 's-completed-2',
        dayName: 'Push Day 2',
        date: '2026-10-12',
        startTime: '2026-10-12T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'e3',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: '6', setNumber: 1, type: 'working', weight: 82.5, reps: 8, completed: true, timestamp: '' },
              { id: '7', setNumber: 2, type: 'working', weight: 82.5, reps: 8, completed: true, timestamp: '' }
            ]
          }
        ]
      }
    ];

    it('counts ONLY completed sessions, strictly excluding in_progress and abandoned', () => {
      const completed = getFilteredCompletedWorkouts(sessions, { startDate: '2026-10-01', endDate: '2026-10-20' });
      expect(completed.length).toBe(2);
      expect(completed.map((s) => s.id)).toEqual(['s-completed-1', 's-completed-2']);
    });

    it('extracts exercise progression, excluding warmup and skipped sets', () => {
      const history = getExerciseProgressionHistory(
        sessions,
        'Barbell Bench Press',
        { startDate: '2026-10-01', endDate: '2026-10-20' },
        'kg'
      );
      expect(history.length).toBe(2);

      // Session 1: sets 2 & 3 (80kg x 8, 80kg x 7). Excludes warmup (40kg) and skipped (set 4)
      expect(history[0].bestWeight).toBe(80);
      expect(history[0].bestReps).toBe(8);
      expect(history[0].workingSetsCount).toBe(2);
      expect(history[0].totalVolume).toBe(80 * 8 + 80 * 7); // 1200 kg

      // Session 2: 82.5kg x 8
      expect(history[1].bestWeight).toBe(82.5);
      expect(history[1].workingSetsCount).toBe(2);
      // Epley: 82.5 * (1 + 8/30) = 82.5 * 1.2666 = 104.5 kg
      expect(history[1].estimated1RM).toBe(104.5);
    });

    it('lists all recorded exercise names accurately', () => {
      const names = getRecordedExerciseNames(sessions);
      // Only Barbell Bench Press from completed sessions
      expect(names).toContain('Barbell Bench Press');
      expect(names).not.toContain('Barbell Row'); // from in-progress session
    });
  });

  describe('Nutrition Aggregation & Truthful Averages', () => {
    const nutritionLogs: DailyNutritionLog[] = [
      {
        id: 'n1',
        date: '2026-10-01',
        waterMl: 2000,
        targetCalories: 2800,
        targetProtein: 170,
        targetCarbs: 320,
        targetFat: 70,
        entries: [
          { id: 'e1', name: 'Eggs', mealCategory: 'breakfast', quantity: 3, servingUnit: 'large', calories: 210, protein: 18, carbs: 1.5, fat: 15 },
          { id: 'e2', name: 'Oats', mealCategory: 'breakfast', quantity: 1, servingUnit: 'cup', calories: 300, protein: 10, carbs: 54, fat: 5 }
        ] // Total cals: 510, protein: 28
      },
      {
        id: 'n2',
        date: '2026-10-02',
        waterMl: 2500,
        targetCalories: 2800,
        targetProtein: 170,
        targetCarbs: 320,
        targetFat: 70,
        entries: [
          { id: 'e3', name: 'Steak & Rice', mealCategory: 'dinner', quantity: 1, servingUnit: 'plate', calories: 800, protein: 50, carbs: 70, fat: 25 }
        ]
      },
      {
        id: 'n-empty',
        date: '2026-10-03',
        waterMl: 1000,
        targetCalories: 2800,
        targetProtein: 170,
        targetCarbs: 320,
        targetFat: 70,
        entries: [] // Empty log day, no food entered
      }
    ];

    it('filters out empty days and calculates averages ONLY across days with recorded food', () => {
      const days = getFilteredNutritionDays(nutritionLogs, { startDate: '2026-10-01', endDate: '2026-10-05' });
      // Only n1 and n2 have food entries
      expect(days.length).toBe(2);
      expect(days[0].calories).toBe(510);
      expect(days[1].calories).toBe(800);

      const overview = buildTimelineOverview(
        { startDate: '2026-10-01', endDate: '2026-10-05' },
        [],
        [],
        nutritionLogs,
        [],
        baseProfile,
        false
      );

      expect(overview.nutritionLoggedDaysCount).toBe(2);
      // Average should be (510 + 800) / 2 = 655 kcal, NOT dividing by 5 days (which would be 262 kcal)
      expect(overview.avgDailyCalories).toBe(655);
    });
  });

  describe('Sleep & Recovery History', () => {
    const sleepLogs: DailySleepLog[] = [
      { id: 'sl1', date: '2026-10-01', hoursSlept: 7.5, quality: 85, restingHeartRate: 52 },
      { id: 'sl2', date: '2026-10-02', hoursSlept: 8.0, quality: 90, restingHeartRate: 50 }
    ];

    it('computes sleep averages over recorded nights', () => {
      const overview = buildTimelineOverview(
        { startDate: '2026-10-01', endDate: '2026-10-05' },
        [],
        [],
        [],
        sleepLogs,
        baseProfile,
        false
      );

      expect(overview.sleepLoggedNightsCount).toBe(2);
      expect(overview.avgSleepHours).toBe(7.8);
      expect(overview.avgSleepQuality).toBe(88);
    });
  });

  describe('Empty Datasets & Zero States', () => {
    it('returns truthful empty summary when no records exist without throwing', () => {
      const overview = buildTimelineOverview(
        { startDate: '2026-10-01', endDate: '2026-10-30' },
        [],
        [],
        [],
        [],
        baseProfile,
        true
      );

      expect(overview.weightMeasurementsCount).toBe(0);
      expect(overview.completedWorkoutsCount).toBe(0);
      expect(overview.totalTonnageLifted).toBe(0);
      expect(overview.nutritionLoggedDaysCount).toBe(0);
      expect(overview.avgDailyCalories).toBeUndefined();
      expect(overview.sleepLoggedNightsCount).toBe(0);
    });
  });
});
