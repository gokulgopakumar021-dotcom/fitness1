import { DailyNutritionLog, UserProfile } from '../types';
import { DateRange } from './timelineEngine';

export interface MacroVariance {
  actual: number;
  target: number;
  delta: number;          // actual - target
  percentDelta: number;   // ((actual - target) / target) * 100, clamped or rounded to 1 decimal
  isWithinTenPercent: boolean;
  status: 'under' | 'within' | 'over';
  lowerBound: number;     // 0.90 * target
  upperBound: number;     // 1.10 * target
}

export interface DayNutritionConsistency {
  date: string;
  hasEntries: boolean;
  isLogged: boolean;
  calories: MacroVariance;
  protein: MacroVariance;
  carbs: MacroVariance;
  fat: MacroVariance;
  isCaloriesConsistent: boolean;
  isProteinConsistent: boolean;
  isCarbsConsistent: boolean;
  isFatConsistent: boolean;
  isFullyConsistent: boolean; // calories + protein + carbs + fat within 10%
  isCoreConsistent: boolean;  // calories + protein within 10%
  consistencyScore: number;   // 0 to 100 (percentage of the 4 metrics within 10%)
}

export interface NutritionConsistencySummary {
  range: DateRange;
  targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    hasValidTargets: boolean;
    source: 'wizard_profile' | 'daily_log_override' | 'unconfigured';
  };
  coverage: {
    totalDaysInRange: number;
    loggedDaysCount: number;
    unloggedDaysCount: number;
    coveragePercent: number;
  };
  adherence: {
    caloriesConsistentDays: number;
    caloriesConsistencyRate: number; // % of logged days within +-10%

    proteinConsistentDays: number;
    proteinConsistencyRate: number; // % of logged days within +-10%

    carbsConsistentDays: number;
    carbsConsistencyRate: number;   // % of logged days within +-10%

    fatConsistentDays: number;
    fatConsistencyRate: number;     // % of logged days within +-10%

    fullyConsistentDays: number;    // all 4 within +-10%
    fullConsistencyRate: number;    // % of logged days fully compliant

    coreConsistentDays: number;     // calories & protein both within +-10%
    coreConsistencyRate: number;    // % of logged days core compliant

    overallConsistencyRate: number; // composite average rate (0-100)
    
    currentStreakDays: number;
    longestStreakDays: number;
  };
  dailyRecords: DayNutritionConsistency[];
}

/**
 * Calculates variance and +-10% tolerance band for a single nutrient metric.
 * A metric is within tolerance if: 0.90 * target <= actual <= 1.10 * target.
 */
export function calculateMacroVariance(actual: number, target: number): MacroVariance {
  const safeTarget = Math.max(0, target);
  const safeActual = Math.max(0, actual);
  const lowerBound = Math.round(safeTarget * 0.90 * 10) / 10;
  const upperBound = Math.round(safeTarget * 1.10 * 10) / 10;

  if (safeTarget <= 0) {
    return {
      actual: safeActual,
      target: 0,
      delta: safeActual,
      percentDelta: 0,
      isWithinTenPercent: false,
      status: safeActual > 0 ? 'over' : 'within',
      lowerBound: 0,
      upperBound: 0
    };
  }

  const delta = safeActual - safeTarget;
  const percentDelta = Number(((delta / safeTarget) * 100).toFixed(1));
  const isWithin = safeActual >= safeTarget * 0.90 && safeActual <= safeTarget * 1.10;

  let status: 'under' | 'within' | 'over' = 'within';
  if (safeActual < safeTarget * 0.90) {
    status = 'under';
  } else if (safeActual > safeTarget * 1.10) {
    status = 'over';
  }

  return {
    actual: safeActual,
    target: safeTarget,
    delta: Math.round(delta * 10) / 10,
    percentDelta,
    isWithinTenPercent: isWithin,
    status,
    lowerBound,
    upperBound
  };
}

/**
 * Computes nutrition consistency analysis for a specific date range,
 * calculating the adherence against targets established by the Nutrition Goal Wizard.
 */
export function calculateNutritionConsistency(
  logs: DailyNutritionLog[],
  profile: UserProfile,
  range: DateRange
): NutritionConsistencySummary {
  // Extract profile targets set by Nutrition Goal Wizard
  const defaultTargetCalories = profile.dailyCalorieTarget || 0;
  const defaultTargetProtein = profile.dailyProteinTarget || 0;
  const defaultTargetCarbs = profile.dailyCarbsTarget || 0;
  const defaultTargetFat = profile.dailyFatTarget || 0;

  const hasValidTargets = defaultTargetCalories > 0 && defaultTargetProtein > 0;

  // Filter logs within range
  const logsInRange = logs.filter((log) => {
    if (!log.date) return false;
    return log.date >= range.startDate && log.date <= range.endDate;
  });

  // Index logs by date for fast lookup
  const logMap = new Map<string, DailyNutritionLog>();
  logsInRange.forEach((l) => logMap.set(l.date, l));

  // Determine all days in range chronologically
  const dayList: string[] = [];
  const start = new Date(range.startDate + 'T00:00:00');
  const end = new Date(range.endDate + 'T00:00:00');
  const current = new Date(start);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dayList.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }

  const dailyRecords: DayNutritionConsistency[] = [];
  let loggedDaysCount = 0;

  let caloriesConsistentDays = 0;
  let proteinConsistentDays = 0;
  let carbsConsistentDays = 0;
  let fatConsistentDays = 0;
  let fullyConsistentDays = 0;
  let coreConsistentDays = 0;

  dayList.forEach((dateStr) => {
    const log = logMap.get(dateStr);
    const entries = log?.entries || [];

    const totalCals = entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0);
    const totalProtein = entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0);
    const totalCarbs = entries.reduce((sum, e) => sum + (Number(e.carbs) || 0), 0);
    const totalFat = entries.reduce((sum, e) => sum + (Number(e.fat) || 0), 0);

    const isLogged = entries.length > 0 || totalCals > 0;

    // Resolve target: daily log target if valid, else profile target from wizard
    const dayTargetCalories = (log?.targetCalories && log.targetCalories > 0)
      ? log.targetCalories
      : defaultTargetCalories;
    const dayTargetProtein = (log?.targetProtein && log.targetProtein > 0)
      ? log.targetProtein
      : defaultTargetProtein;
    const dayTargetCarbs = (log?.targetCarbs && log.targetCarbs > 0)
      ? log.targetCarbs
      : defaultTargetCarbs;
    const dayTargetFat = (log?.targetFat && log.targetFat > 0)
      ? log.targetFat
      : defaultTargetFat;

    const calVariance = calculateMacroVariance(Math.round(totalCals), dayTargetCalories);
    const protVariance = calculateMacroVariance(Number(totalProtein.toFixed(1)), dayTargetProtein);
    const carbVariance = calculateMacroVariance(Number(totalCarbs.toFixed(1)), dayTargetCarbs);
    const fatVariance = calculateMacroVariance(Number(totalFat.toFixed(1)), dayTargetFat);

    let withinCount = 0;
    if (calVariance.isWithinTenPercent) withinCount++;
    if (protVariance.isWithinTenPercent) withinCount++;
    if (carbVariance.isWithinTenPercent) withinCount++;
    if (fatVariance.isWithinTenPercent) withinCount++;

    const isCaloriesConsistent = isLogged && calVariance.isWithinTenPercent;
    const isProteinConsistent = isLogged && protVariance.isWithinTenPercent;
    const isCarbsConsistent = isLogged && carbVariance.isWithinTenPercent;
    const isFatConsistent = isLogged && fatVariance.isWithinTenPercent;

    const isFullyConsistent = isLogged && withinCount === 4;
    const isCoreConsistent = isLogged && calVariance.isWithinTenPercent && protVariance.isWithinTenPercent;
    const consistencyScore = isLogged ? Math.round((withinCount / 4) * 100) : 0;

    if (isLogged) {
      loggedDaysCount++;
      if (calVariance.isWithinTenPercent) caloriesConsistentDays++;
      if (protVariance.isWithinTenPercent) proteinConsistentDays++;
      if (carbVariance.isWithinTenPercent) carbsConsistentDays++;
      if (fatVariance.isWithinTenPercent) fatConsistentDays++;
      if (isFullyConsistent) fullyConsistentDays++;
      if (isCoreConsistent) coreConsistentDays++;
    }

    dailyRecords.push({
      date: dateStr,
      hasEntries: entries.length > 0,
      isLogged,
      calories: calVariance,
      protein: protVariance,
      carbs: carbVariance,
      fat: fatVariance,
      isCaloriesConsistent,
      isProteinConsistent,
      isCarbsConsistent,
      isFatConsistent,
      isFullyConsistent,
      isCoreConsistent,
      consistencyScore
    });
  });

  // Calculate streaks over logged days chronologically (based on core calorie consistency)
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;

  for (let i = 0; i < dailyRecords.length; i++) {
    const record = dailyRecords[i];
    if (record.isLogged && record.isCaloriesConsistent) {
      runningStreak++;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else if (record.isLogged) {
      // Logged but missed target
      runningStreak = 0;
    }
    // Note: unlogged days don't necessarily reset the streak if looking strictly at logged days,
    // but in timeline consistency, missing a day pauses or resets streak. If we look backwards from today:
  }

  // Calculate current streak backwards from latest day
  for (let i = dailyRecords.length - 1; i >= 0; i--) {
    const record = dailyRecords[i];
    if (record.isLogged && record.isCaloriesConsistent) {
      currentStreak++;
    } else if (record.isLogged) {
      break;
    }
  }

  const totalDaysInRange = dayList.length;
  const unloggedDaysCount = Math.max(0, totalDaysInRange - loggedDaysCount);
  const coveragePercent = totalDaysInRange > 0 ? Number(((loggedDaysCount / totalDaysInRange) * 100).toFixed(1)) : 0;

  const toRate = (count: number) => (loggedDaysCount > 0 ? Number(((count / loggedDaysCount) * 100).toFixed(1)) : 0);

  const calRate = toRate(caloriesConsistentDays);
  const protRate = toRate(proteinConsistentDays);
  const carbRate = toRate(carbsConsistentDays);
  const fatRate = toRate(fatConsistentDays);
  const fullRate = toRate(fullyConsistentDays);
  const coreRate = toRate(coreConsistentDays);

  const overallAvg = Number(((calRate + protRate + carbRate + fatRate) / 4).toFixed(1));

  return {
    range,
    targets: {
      calories: defaultTargetCalories,
      protein: defaultTargetProtein,
      carbs: defaultTargetCarbs,
      fat: defaultTargetFat,
      hasValidTargets,
      source: hasValidTargets ? 'wizard_profile' : 'unconfigured'
    },
    coverage: {
      totalDaysInRange,
      loggedDaysCount,
      unloggedDaysCount,
      coveragePercent
    },
    adherence: {
      caloriesConsistentDays,
      caloriesConsistencyRate: calRate,
      proteinConsistentDays,
      proteinConsistencyRate: protRate,
      carbsConsistentDays,
      carbsConsistencyRate: carbRate,
      fatConsistentDays,
      fatConsistencyRate: fatRate,
      fullyConsistentDays,
      fullConsistencyRate: fullRate,
      coreConsistentDays,
      coreConsistencyRate: coreRate,
      overallConsistencyRate: overallAvg,
      currentStreakDays: currentStreak,
      longestStreakDays: longestStreak
    },
    dailyRecords
  };
}
