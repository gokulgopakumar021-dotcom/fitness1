import type { UserProfile } from '../types';

export type ProfileField =
  | 'name'
  | 'age'
  | 'heightCm'
  | 'currentWeightKg'
  | 'goalWeightKg'
  | 'trainingDaysPerWeek'
  | 'dailyCalorieTarget'
  | 'dailyProteinTarget'
  | 'dailyCarbsTarget'
  | 'dailyFatTarget'
  | 'minBarbellIncrement'
  | 'minDumbbellIncrement'
  | 'minMachineIncrement';

export type ProfileErrors = Partial<Record<ProfileField, string>>;

/** True when any profile field differs. Missing and undefined optional fields count as equal. */
export function isProfileDirty(next: UserProfile, saved: UserProfile): boolean {
  const keys = new Set([...Object.keys(next), ...Object.keys(saved)]) as Set<keyof UserProfile>;
  for (const k of keys) {
    if (next[k] !== saved[k]) return true;
  }
  return false;
}

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

/**
 * Validates only the fields the person actually changed, so a profile that already holds an older or unusual value
 * can still be saved untouched. Height is validated separately (utils/heightUnits) because its rules depend on units.
 */
export function validateProfileEdits(next: UserProfile, saved: UserProfile): ProfileErrors {
  const e: ProfileErrors = {};
  const changed = (k: keyof UserProfile) => next[k] !== saved[k];

  if (changed('name')) {
    const n = next.name.trim();
    if (!n) e.name = 'Enter a name.';
    else if (n.length > 40) e.name = 'Use 40 characters or fewer.';
  }
  if (changed('age') && !(Number.isInteger(next.age) && inRange(next.age, 10, 100))) {
    e.age = 'Enter an age between 10 and 100.';
  }
  if (changed('currentWeightKg') && !inRange(next.currentWeightKg, 20, 500)) {
    e.currentWeightKg = 'Enter a weight between 20 and 500 kg.';
  }
  if (changed('goalWeightKg') && !inRange(next.goalWeightKg, 20, 500)) {
    e.goalWeightKg = 'Enter a weight between 20 and 500 kg.';
  }
  if (changed('trainingDaysPerWeek') && !(Number.isInteger(next.trainingDaysPerWeek) && inRange(next.trainingDaysPerWeek, 1, 7))) {
    e.trainingDaysPerWeek = 'Enter 1 to 7 days.';
  }
  if (changed('dailyCalorieTarget') && !inRange(next.dailyCalorieTarget, 0, 10000)) {
    e.dailyCalorieTarget = 'Enter 0 to 10,000 kcal.';
  }
  (
    [
      ['dailyProteinTarget', 'Protein'],
      ['dailyCarbsTarget', 'Carbs'],
      ['dailyFatTarget', 'Fat']
    ] as const
  ).forEach(([k, label]) => {
    if (changed(k) && !inRange(next[k], 0, 1500)) e[k] = `${label}: enter 0 to 1,500 g.`;
  });
  (['minBarbellIncrement', 'minDumbbellIncrement', 'minMachineIncrement'] as const).forEach((k) => {
    if (changed(k) && !(next[k] > 0 && next[k] <= 100)) e[k] = 'Enter a value above 0 and up to 100.';
  });
  return e;
}
