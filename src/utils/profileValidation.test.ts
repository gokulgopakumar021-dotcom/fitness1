import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../storage/db';
import { isProfileDirty, validateProfileEdits } from './profileValidation';

const base = { ...DEFAULT_PROFILE };

describe('isProfileDirty', () => {
  it('is false for an identical copy and true for any changed field', () => {
    expect(isProfileDirty({ ...base }, base)).toBe(false);
    expect(isProfileDirty({ ...base, age: base.age + 1 }, base)).toBe(true);
  });
  it('treats an absent optional field and undefined as equal', () => {
    expect(isProfileDirty({ ...base, heightUnit: undefined }, base)).toBe(false);
    expect(isProfileDirty({ ...base, heightUnit: 'ft_in' }, base)).toBe(true);
  });
});

describe('validateProfileEdits', () => {
  it('reports nothing for an untouched profile, even with unusual stored values', () => {
    const odd = { ...base, age: 7, currentWeightKg: 0, dailyCalorieTarget: 99999 };
    expect(validateProfileEdits({ ...odd }, odd)).toEqual({});
  });

  it('validates only the fields that changed', () => {
    const odd = { ...base, age: 7 };
    const errs = validateProfileEdits({ ...odd, goalWeightKg: 5 }, odd);
    expect(Object.keys(errs)).toEqual(['goalWeightKg']);
  });

  it('checks name, age and weights', () => {
    expect(validateProfileEdits({ ...base, name: '   ' }, { ...base, name: 'Alex' }).name).toBeDefined();
    expect(validateProfileEdits({ ...base, name: 'x'.repeat(41) }, base).name).toBeDefined();
    expect(validateProfileEdits({ ...base, name: 'Alex' }, base).name).toBeUndefined();
    expect(validateProfileEdits({ ...base, age: 9 }, base).age).toBeDefined();
    expect(validateProfileEdits({ ...base, age: 101 }, base).age).toBeDefined();
    expect(validateProfileEdits({ ...base, age: 30 }, base).age).toBeUndefined();
    expect(validateProfileEdits({ ...base, currentWeightKg: 19 }, base).currentWeightKg).toBeDefined();
    expect(validateProfileEdits({ ...base, currentWeightKg: 501 }, base).currentWeightKg).toBeDefined();
    expect(validateProfileEdits({ ...base, goalWeightKg: 80 }, base).goalWeightKg).toBeUndefined();
  });

  it('checks training days, calorie and macro targets, and increments', () => {
    expect(validateProfileEdits({ ...base, trainingDaysPerWeek: 8 }, base).trainingDaysPerWeek).toBeDefined();
    expect(validateProfileEdits({ ...base, trainingDaysPerWeek: 5 }, base).trainingDaysPerWeek).toBeUndefined();
    expect(validateProfileEdits({ ...base, dailyCalorieTarget: 10001 }, base).dailyCalorieTarget).toBeDefined();
    expect(validateProfileEdits({ ...base, dailyCalorieTarget: 0 }, base).dailyCalorieTarget).toBeUndefined();
    expect(validateProfileEdits({ ...base, dailyProteinTarget: -1 }, base).dailyProteinTarget).toBeDefined();
    expect(validateProfileEdits({ ...base, dailyFatTarget: 1501 }, base).dailyFatTarget).toBeDefined();
    expect(validateProfileEdits({ ...base, minBarbellIncrement: 0 }, base).minBarbellIncrement).toBeDefined();
    expect(validateProfileEdits({ ...base, minMachineIncrement: 1.25 }, base).minMachineIncrement).toBeUndefined();
  });
});
