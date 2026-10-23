import { LoggedSet } from '../types';

/**
 * Calculates Body Mass Index (BMI).
 * Formula: weight (kg) / (height (m) ^ 2)
 * Note: BMI is a general population screening measure, not a direct measurement
 * of muscle mass or body composition.
 */
export function calculateBMI(weightKg: number, heightCm: number): number {
  if (!weightKg || !heightCm || heightCm <= 0) return 0;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Number(bmi.toFixed(2));
}

/**
 * Categorizes BMI strictly as a demographic screening guideline.
 */
export function getBMICategory(bmi: number): {
  category: string;
  color: string;
  disclaimer: string;
} {
  if (bmi <= 0) return { category: 'Uncalculated', color: 'text-zinc-500', disclaimer: 'Enter height and weight' };
  if (bmi < 18.5) {
    return {
      category: 'Underweight',
      color: 'text-amber-400',
      disclaimer: 'General screening category. May reflect low total mass or high caloric expenditure.'
    };
  }
  if (bmi < 25) {
    return {
      category: 'Normal range',
      color: 'text-lime-400',
      disclaimer: 'Standard demographic screening range.'
    };
  }
  if (bmi < 30) {
    return {
      category: 'Overweight',
      color: 'text-amber-400',
      disclaimer: 'Note: For strength athletes with high muscle mass, BMI frequently categorizes healthy muscular builds as overweight.'
    };
  }
  return {
    category: 'Obesity classification',
    color: 'text-rose-400',
    disclaimer: 'Screening index only. Does not distinguish visceral adiposity from muscular skeletal mass.'
  };
}

/**
 * Calculates Estimated One-Repetition Maximum (1RM) using the scientific Epley formula:
 * 1RM = weight * (1 + reps / 30)
 * Only valid for reps <= 12 and weight > 0.
 */
export function calculateEpley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  // Epley formula
  const e1rm = weight * (1 + reps / 30);
  return Number(e1rm.toFixed(1));
}

/**
 * Calculates total volume load for an array of logged sets.
 * Volume load = sum of (weight * reps) across completed working sets.
 */
export function calculateVolumeLoad(sets: LoggedSet[], excludeWarmup: boolean = true): number {
  return sets.reduce((total, s) => {
    if (!s.completed || s.skipped) return total;
    if (excludeWarmup && s.type === 'warmup') return total;
    const load = (Number(s.weight) || 0) * (Number(s.reps) || 0);
    return total + load;
  }, 0);
}

/**
 * Converts kilograms to pounds.
 */
export function kgToLbs(kg: number): number {
  return Number((kg * 2.20462).toFixed(1));
}

/**
 * Converts pounds to kilograms.
 */
export function lbsToKg(lbs: number): number {
  return Number((lbs / 2.20462).toFixed(1));
}

/**
 * Formats weight with chosen unit.
 */
export function formatWeight(weightInKg: number, unit: 'kg' | 'lbs'): string {
  if (unit === 'lbs') {
    return `${kgToLbs(weightInKg)} lbs`;
  }
  return `${weightInKg.toFixed(1)} kg`;
}

/**
 * Calculates a 7-day rolling average for body weight from a sorted array of entries.
 */
export function calculateWeeklyAverageWeight(
  entries: { date: string; weightKg: number }[],
  targetDateStr?: string
): number | null {
  if (!entries || entries.length === 0) return null;
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const windowEntries = entries.filter((e) => {
    const d = new Date(e.date);
    return d >= sevenDaysAgo && d <= targetDate;
  });

  if (windowEntries.length === 0) {
    // If no entries in 7d window, average the last 3-7 entries
    const recent = entries.slice(-7);
    const sum = recent.reduce((acc, curr) => acc + curr.weightKg, 0);
    return Number((sum / recent.length).toFixed(2));
  }

  const sum = windowEntries.reduce((acc, curr) => acc + curr.weightKg, 0);
  return Number((sum / windowEntries.length).toFixed(2));
}

/**
 * Parses rep range string into min and max rep numbers.
 * Examples: "8-12" -> { min: 8, max: 12 }, "5" -> { min: 5, max: 5 }, "10-15" -> { min: 10, max: 15 }
 */
export function parseRepRange(repRangeStr: string): { min: number; max: number } {
  if (!repRangeStr) return { min: 8, max: 12 };
  const clean = repRangeStr.trim().replace(/\s+/g, '');
  const parts = clean.split('-');
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10);
    const max = parseInt(parts[1], 10);
    if (!isNaN(min) && !isNaN(max) && min <= max) {
      return { min, max };
    }
  }
  const single = parseInt(clean, 10);
  if (!isNaN(single)) {
    return { min: single, max: single };
  }
  return { min: 8, max: 12 };
}
