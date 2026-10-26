import {
  BodyMetricEntry,
  DailyNutritionLog,
  DailySleepLog,
  LoggedExercise,
  LoggedSet,
  UserProfile,
  WorkoutSession
} from '../types';
import { calculateEpley1RM, calculateVolumeLoad, kgToLbs } from './calculations';

export type TimeRangePreset = '7d' | '30d' | '90d' | '6m' | '1y' | 'all' | 'custom';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface MetricComparison<T = number> {
  current: T;
  previous?: T;
  absoluteChange?: number;
  percentChange?: number;
  hasBaseline: boolean;
  coverageCurrentDays: number;
  coveragePreviousDays: number;
}

export interface BodyWeightPoint {
  date: string;
  weightKg: number;
  weightDisplay: number;
  waistCm?: number;
  bodyFatPercentage?: number;
  bmi: number;
  notes?: string;
}

export interface WorkoutPerformancePoint {
  sessionId: string;
  date: string;
  dayName: string;
  totalVolume: number;
  completedSetsCount: number;
}

export interface ExerciseProgressPoint {
  date: string;
  sessionId: string;
  exerciseName: string;
  bestWeight: number;
  bestWeightDisplay: number;
  bestReps: number;
  estimated1RM: number;
  estimated1RMDisplay: number;
  workingSetsCount: number;
  totalVolume: number;
  setsSummary: string;
}

export interface NutritionDaySummary {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
  targetCalories?: number;
  targetProtein?: number;
  entriesCount: number;
}

export interface SleepDaySummary {
  date: string;
  hoursSlept: number;
  quality: number;
  restingHeartRate?: number;
  hrvMs?: number;
  notes?: string;
}

export interface TimelineOverviewSummary {
  range: DateRange;
  comparisonRange?: DateRange;
  totalDaysInRange: number;

  // Weight
  latestWeight?: { date: string; weightKg: number; weightDisplay: number };
  earliestWeight?: { date: string; weightKg: number; weightDisplay: number };
  weightComparison?: MetricComparison<number>;
  weightMeasurementsCount: number;

  // Workouts
  completedWorkoutsCount: number;
  completedWorkoutsComparison?: MetricComparison<number>;
  totalTonnageLifted: number;
  tonnageComparison?: MetricComparison<number>;
  workoutFrequencyPerWeek: number;

  // Nutrition
  nutritionLoggedDaysCount: number;
  avgDailyCalories?: number;
  avgDailyProtein?: number;
  caloriesComparison?: MetricComparison<number>;
  proteinComparison?: MetricComparison<number>;
  calorieTargetMetPercent?: number;

  // Recovery
  sleepLoggedNightsCount: number;
  avgSleepHours?: number;
  avgSleepQuality?: number;
}

/**
 * Normalizes a date to YYYY-MM-DD in local time
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates start and end dates for a chosen preset
 */
export function resolveDateRange(
  preset: TimeRangePreset,
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): DateRange {
  const todayStr = formatLocalDate(referenceDate);

  if (preset === 'custom' && customStart && customEnd) {
    // Prevent future dates from being treated as historical truth
    const safeEnd = customEnd > todayStr ? todayStr : customEnd;
    const safeStart = customStart > safeEnd ? safeEnd : customStart;
    return { startDate: safeStart, endDate: safeEnd };
  }

  if (preset === 'all') {
    return { startDate: '2000-01-01', endDate: todayStr };
  }

  const daysMap: Record<Exclude<TimeRangePreset, 'all' | 'custom'>, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '6m': 180,
    '1y': 365,
  };

  const days = daysMap[preset as keyof typeof daysMap] || 30;
  const start = new Date(referenceDate.getTime());
  start.setDate(start.getDate() - (days - 1));

  return {
    startDate: formatLocalDate(start),
    endDate: todayStr
  };
}

/**
 * Calculates the previous period of identical day length for comparison
 */
export function getPreviousComparisonRange(currentRange: DateRange): DateRange {
  const currentStart = new Date(currentRange.startDate + 'T00:00:00');
  const currentEnd = new Date(currentRange.endDate + 'T23:59:59');

  const diffMs = currentEnd.getTime() - currentStart.getTime();
  const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));

  const prevEnd = new Date(currentStart.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);

  return {
    startDate: formatLocalDate(prevStart),
    endDate: formatLocalDate(prevEnd)
  };
}

/**
 * Calculates honest metric comparison. Never divides by zero or invents baseline.
 */
export function computeComparison(
  currentVal: number,
  previousVal: number | undefined,
  currentDays: number,
  previousDays: number
): MetricComparison<number> {
  if (previousVal === undefined || isNaN(previousVal) || previousDays === 0) {
    return {
      current: currentVal,
      hasBaseline: false,
      coverageCurrentDays: currentDays,
      coveragePreviousDays: previousDays
    };
  }

  const absChange = Number((currentVal - previousVal).toFixed(2));
  let pctChange: number | undefined = undefined;

  // Only calculate percentage change if previousVal !== 0 and is valid
  if (previousVal !== 0 && Math.abs(previousVal) > 0.0001) {
    pctChange = Number((((currentVal - previousVal) / Math.abs(previousVal)) * 100).toFixed(1));
  }

  return {
    current: currentVal,
    previous: previousVal,
    absoluteChange: absChange,
    percentChange: pctChange,
    hasBaseline: true,
    coverageCurrentDays: currentDays,
    coveragePreviousDays: previousDays
  };
}

/**
 * Filters body metrics by date range and formats for unit display
 */
export function getFilteredBodyMetrics(
  metrics: BodyMetricEntry[],
  range: DateRange,
  unit: 'kg' | 'lbs' = 'kg'
): BodyWeightPoint[] {
  return metrics
    .filter((m) => {
      if (!m.date) return false;
      return m.date >= range.startDate && m.date <= range.endDate;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      const weightDisplay = unit === 'lbs' ? kgToLbs(m.weightKg) : m.weightKg;
      return {
        date: m.date,
        weightKg: m.weightKg,
        weightDisplay: Number(weightDisplay.toFixed(1)),
        waistCm: m.waistCm,
        bodyFatPercentage: m.bodyFatPercentage,
        bmi: m.bmi,
        notes: m.notes
      };
    });
}

/**
 * Filters completed workouts in the date range.
 * Rule: Excludes in-progress or abandoned sessions!
 */
export function getFilteredCompletedWorkouts(
  sessions: WorkoutSession[],
  range: DateRange
): WorkoutSession[] {
  return sessions
    .filter((s) => {
      if (s.status !== 'completed' || !s.date) return false;
      return s.date >= range.startDate && s.date <= range.endDate;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Extracts exercise-specific progression points across completed sessions.
 * Rule: Excludes warmup sets and skipped/uncompleted sets!
 */
export function getExerciseProgressionHistory(
  sessions: WorkoutSession[],
  exerciseName: string,
  range: DateRange,
  unit: 'kg' | 'lbs' = 'kg'
): ExerciseProgressPoint[] {
  const normTarget = exerciseName.trim().toLowerCase();
  const completed = getFilteredCompletedWorkouts(sessions, range);
  const points: ExerciseProgressPoint[] = [];

  for (const session of completed) {
    for (const ex of session.exercises || []) {
      if (ex.name && ex.name.trim().toLowerCase() === normTarget) {
        // Filter working sets
        const validSets = (ex.sets || []).filter(
          (s) => s.completed && !s.skipped && s.type !== 'warmup' && (Number(s.reps) || 0) > 0 && (Number(s.weight) || 0) > 0
        );

        if (validSets.length > 0) {
          let bestWeight = 0;
          let bestReps = 0;
          let best1RM = 0;

          for (const s of validSets) {
            const w = Number(s.weight) || 0;
            const r = Number(s.reps) || 0;
            if (w > bestWeight) {
              bestWeight = w;
              bestReps = r;
            }
            const e1rm = calculateEpley1RM(w, r);
            if (e1rm > best1RM) {
              best1RM = e1rm;
            }
          }

          const vol = calculateVolumeLoad(validSets, true);
          const setsSummary = validSets.map((s) => `${s.weight}×${s.reps}`).join(', ');

          const bestWeightDisplay = unit === 'lbs' ? kgToLbs(bestWeight) : bestWeight;
          const best1RMDisplay = unit === 'lbs' ? kgToLbs(best1RM) : best1RM;

          points.push({
            date: session.date,
            sessionId: session.id,
            exerciseName: ex.name,
            bestWeight,
            bestWeightDisplay: Number(bestWeightDisplay.toFixed(1)),
            bestReps,
            estimated1RM: best1RM,
            estimated1RMDisplay: Number(best1RMDisplay.toFixed(1)),
            workingSetsCount: validSets.length,
            totalVolume: vol,
            setsSummary
          });
        }
      }
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Finds all unique exercise names recorded in completed sessions
 */
export function getRecordedExerciseNames(sessions: WorkoutSession[]): string[] {
  const set = new Set<string>();
  for (const s of sessions) {
    if (s.status === 'completed') {
      for (const ex of s.exercises || []) {
        if (ex.name && ex.name.trim().length > 0) {
          set.add(ex.name.trim());
        }
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Filters nutrition logs and computes daily sums.
 * Rule: Distinguishes logged days from unlogged days!
 */
export function getFilteredNutritionDays(
  logs: DailyNutritionLog[],
  range: DateRange
): NutritionDaySummary[] {
  return logs
    .filter((l) => {
      if (!l.date) return false;
      return l.date >= range.startDate && l.date <= range.endDate;
    })
    .map((l) => {
      const entries = l.entries || [];
      const calories = entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0);
      const protein = entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0);
      const carbs = entries.reduce((sum, e) => sum + (Number(e.carbs) || 0), 0);
      const fat = entries.reduce((sum, e) => sum + (Number(e.fat) || 0), 0);

      return {
        date: l.date,
        calories: Math.round(calories),
        protein: Number(protein.toFixed(1)),
        carbs: Number(carbs.toFixed(1)),
        fat: Number(fat.toFixed(1)),
        waterMl: l.waterMl || 0,
        targetCalories: l.targetCalories > 0 ? l.targetCalories : undefined,
        targetProtein: l.targetProtein > 0 ? l.targetProtein : undefined,
        entriesCount: entries.length
      };
    })
    // Filter to days that actually contain recorded food intake
    .filter((d) => d.entriesCount > 0 || d.calories > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Filters sleep logs in range
 */
export function getFilteredSleepLogs(
  sleepLogs: DailySleepLog[],
  range: DateRange
): SleepDaySummary[] {
  return sleepLogs
    .filter((s) => {
      if (!s.date) return false;
      return s.date >= range.startDate && s.date <= range.endDate;
    })
    .map((s) => ({
      date: s.date,
      hoursSlept: Number(s.hoursSlept) || 0,
      quality: Number(s.quality) || 0,
      restingHeartRate: s.restingHeartRate,
      hrvMs: s.hrvMs,
      notes: s.notes
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Builds the comprehensive timeline overview summary across all modules
 */
export function buildTimelineOverview(
  range: DateRange,
  metrics: BodyMetricEntry[],
  sessions: WorkoutSession[],
  nutritionLogs: DailyNutritionLog[],
  sleepLogs: DailySleepLog[],
  profile: UserProfile,
  includeComparison: boolean = true
): TimelineOverviewSummary {
  const unit = profile.preferredUnit || 'kg';
  const comparisonRange = includeComparison ? getPreviousComparisonRange(range) : undefined;

  // Day count in current range
  const startMs = new Date(range.startDate + 'T00:00:00').getTime();
  const endMs = new Date(range.endDate + 'T23:59:59').getTime();
  const totalDaysInRange = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));

  // 1. Body Weight
  const currentMetrics = getFilteredBodyMetrics(metrics, range, unit);
  const prevMetrics = comparisonRange ? getFilteredBodyMetrics(metrics, comparisonRange, unit) : [];

  let latestWeight: { date: string; weightKg: number; weightDisplay: number } | undefined;
  let earliestWeight: { date: string; weightKg: number; weightDisplay: number } | undefined;
  let weightComparison: MetricComparison<number> | undefined;

  if (currentMetrics.length > 0) {
    earliestWeight = currentMetrics[0];
    latestWeight = currentMetrics[currentMetrics.length - 1];

    if (prevMetrics.length > 0) {
      const prevLatest = prevMetrics[prevMetrics.length - 1];
      weightComparison = computeComparison(
        latestWeight.weightDisplay,
        prevLatest.weightDisplay,
        currentMetrics.length,
        prevMetrics.length
      );
    } else if (currentMetrics.length > 1) {
      // Compare latest to earliest in current window
      weightComparison = computeComparison(
        latestWeight.weightDisplay,
        earliestWeight.weightDisplay,
        currentMetrics.length,
        0
      );
    } else {
      weightComparison = computeComparison(
        latestWeight.weightDisplay,
        undefined,
        1,
        0
      );
    }
  }

  // 2. Workouts & Consistency
  const currentWorkouts = getFilteredCompletedWorkouts(sessions, range);
  const prevWorkouts = comparisonRange ? getFilteredCompletedWorkouts(sessions, comparisonRange) : [];

  const completedCount = currentWorkouts.length;
  const prevCompletedCount = prevWorkouts.length;

  const currentTonnage = currentWorkouts.reduce((sum, s) => {
    return sum + (s.exercises || []).reduce((eSum, ex) => eSum + calculateVolumeLoad(ex.sets || [], true), 0);
  }, 0);

  const prevTonnage = prevWorkouts.reduce((sum, s) => {
    return sum + (s.exercises || []).reduce((eSum, ex) => eSum + calculateVolumeLoad(ex.sets || [], true), 0);
  }, 0);

  const completedWorkoutsComparison = comparisonRange
    ? computeComparison(completedCount, prevCompletedCount, totalDaysInRange, totalDaysInRange)
    : undefined;

  const tonnageComparison = comparisonRange
    ? computeComparison(
        unit === 'lbs' ? Math.round(kgToLbs(currentTonnage)) : Math.round(currentTonnage),
        prevCompletedCount > 0
          ? (unit === 'lbs' ? Math.round(kgToLbs(prevTonnage)) : Math.round(prevTonnage))
          : undefined,
        completedCount,
        prevCompletedCount
      )
    : undefined;

  const weeksInRange = Math.max(1, totalDaysInRange / 7);
  const workoutFrequencyPerWeek = Number((completedCount / weeksInRange).toFixed(1));

  // 3. Nutrition
  const currentNutrition = getFilteredNutritionDays(nutritionLogs, range);
  const prevNutrition = comparisonRange ? getFilteredNutritionDays(nutritionLogs, comparisonRange) : [];

  let avgDailyCalories: number | undefined;
  let avgDailyProtein: number | undefined;
  let caloriesComparison: MetricComparison<number> | undefined;
  let proteinComparison: MetricComparison<number> | undefined;

  if (currentNutrition.length > 0) {
    const totalCals = currentNutrition.reduce((sum, d) => sum + d.calories, 0);
    const totalProt = currentNutrition.reduce((sum, d) => sum + d.protein, 0);
    avgDailyCalories = Math.round(totalCals / currentNutrition.length);
    avgDailyProtein = Math.round(totalProt / currentNutrition.length);

    if (prevNutrition.length > 0) {
      const prevTotalCals = prevNutrition.reduce((sum, d) => sum + d.calories, 0);
      const prevTotalProt = prevNutrition.reduce((sum, d) => sum + d.protein, 0);
      const prevAvgCals = Math.round(prevTotalCals / prevNutrition.length);
      const prevAvgProt = Math.round(prevTotalProt / prevNutrition.length);

      caloriesComparison = computeComparison(avgDailyCalories, prevAvgCals, currentNutrition.length, prevNutrition.length);
      proteinComparison = computeComparison(avgDailyProtein, prevAvgProt, currentNutrition.length, prevNutrition.length);
    }
  }

  // 4. Recovery
  const currentSleep = getFilteredSleepLogs(sleepLogs, range);
  let avgSleepHours: number | undefined;
  let avgSleepQuality: number | undefined;

  if (currentSleep.length > 0) {
    const totalH = currentSleep.reduce((sum, s) => sum + s.hoursSlept, 0);
    const totalQ = currentSleep.reduce((sum, s) => sum + s.quality, 0);
    avgSleepHours = Number((totalH / currentSleep.length).toFixed(1));
    avgSleepQuality = Math.round(totalQ / currentSleep.length);
  }

  return {
    range,
    comparisonRange,
    totalDaysInRange,
    latestWeight,
    earliestWeight,
    weightComparison,
    weightMeasurementsCount: currentMetrics.length,
    completedWorkoutsCount: completedCount,
    completedWorkoutsComparison,
    totalTonnageLifted: unit === 'lbs' ? Math.round(kgToLbs(currentTonnage)) : Math.round(currentTonnage),
    tonnageComparison,
    workoutFrequencyPerWeek,
    nutritionLoggedDaysCount: currentNutrition.length,
    avgDailyCalories,
    avgDailyProtein,
    caloriesComparison,
    proteinComparison,
    sleepLoggedNightsCount: currentSleep.length,
    avgSleepHours,
    avgSleepQuality
  };
}
