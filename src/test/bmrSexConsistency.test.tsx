import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '../storage/db';
import {
  calculateAdaptiveExpenditure,
  calculateDetailedTDEE,
  calculateMifflinStJeorBMR,
  calculateStaticTDEE,
  MIFFLIN_SEX_OFFSET,
  mifflinStJeorSexOffset,
  SUPPORTED_SEXES
} from '../utils/tdeeEngine';
import { NutritionGoalGauge } from '../components/nutrition/NutritionGoalGauge';
import type { UserProfile } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = (sex: unknown): UserProfile => ({
  ...DEFAULT_PROFILE,
  sex: sex as UserProfile['sex'],
  age: 30,
  heightCm: 180,
  currentWeightKg: 80,
  trainingDaysPerWeek: 4,
  primaryGoal: 'maintenance'
});

// 10*80 + 6.25*180 - 5*30 = 1775
const CORE = 1775;
const EXPECTED_BMR: Record<string, number> = {
  male: CORE + 5,
  female: CORE - 161,
  other: CORE - 78,
  unspecified: CORE - 78
};

describe('Mifflin-St Jeor sex offset: one definition', () => {
  it('has the published constants and a neutral midpoint', () => {
    expect(MIFFLIN_SEX_OFFSET).toEqual({ male: 5, female: -161, neutral: -78 });
    expect(MIFFLIN_SEX_OFFSET.neutral).toBe((MIFFLIN_SEX_OFFSET.male + MIFFLIN_SEX_OFFSET.female) / 2);
  });

  it.each([
    ['male', 5],
    ['female', -161],
    ['other', -78],
    ['unspecified', -78],
    [undefined, -78],
    ['', -78],
    ['Male', -78],
    [null, -78]
  ])('mifflinStJeorSexOffset(%j) = %i', (sex, offset) => {
    expect(mifflinStJeorSexOffset(sex)).toBe(offset);
  });
});

describe('static baseline BMR agrees with the wizard formula for every supported sex', () => {
  it.each([...SUPPORTED_SEXES])('%s: calculateMifflinStJeorBMR equals the expected value and the detailed formula', (sex) => {
    const legacy = calculateMifflinStJeorBMR(profile(sex));
    const detailed = calculateDetailedTDEE({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex,
      activityLevel: 'moderate'
    }).bmrMifflinStJeor;
    expect(legacy).toBe(EXPECTED_BMR[sex]);
    expect(legacy).toBe(detailed);
  });

  it('male and female results are unchanged from before this fix', () => {
    expect(calculateMifflinStJeorBMR(profile('male'))).toBe(1780);
    expect(calculateMifflinStJeorBMR(profile('female'))).toBe(1614);
  });

  it('other and unspecified are no longer treated as male', () => {
    expect(calculateMifflinStJeorBMR(profile('unspecified'))).toBe(1697);
    expect(calculateMifflinStJeorBMR(profile('unspecified'))).toBeLessThan(calculateMifflinStJeorBMR(profile('male')));
    expect(calculateMifflinStJeorBMR(profile('other'))).toBe(calculateMifflinStJeorBMR(profile('unspecified')));
  });

  it.each([undefined, '', 'Male', 'robot'])('a missing or unsupported stored sex (%j) uses the neutral estimate, not male', (sex) => {
    expect(calculateMifflinStJeorBMR(profile(sex))).toBe(1697);
  });

  it.each([...SUPPORTED_SEXES])('%s: static TDEE is the BMR times the training-frequency multiplier', (sex) => {
    // 4 training days -> 1.48
    expect(calculateStaticTDEE(profile(sex))).toBe(Math.round(EXPECTED_BMR[sex] * 1.48));
  });
});

describe('adaptive estimator fallback uses the same BMR', () => {
  it.each([...SUPPORTED_SEXES])('%s: staticBmr reported by calculateAdaptiveExpenditure matches', (sex) => {
    const est = calculateAdaptiveExpenditure([], [], profile(sex));
    expect(est.staticBmr).toBe(EXPECTED_BMR[sex]);
    expect(est.staticTdee).toBe(Math.round(EXPECTED_BMR[sex] * 1.48));
  });
});

describe('NutritionGoalGauge shows the same maintenance TDEE as the engine for every sex', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const tdeeShown = async (sex: unknown): Promise<string> => {
    await act(async () => {
      root.render(
        <NutritionGoalGauge
          currentCalories={1000}
          targetCalories={2500}
          currentProtein={50}
          targetProtein={160}
          currentCarbs={100}
          targetCarbs={300}
          currentFat={30}
          targetFat={70}
          profile={profile(sex)}
          onOpenWizard={vi.fn()}
        />
      );
    });
    const m = container.textContent!.match(/TDEE:\s*(\d+)\s*kcal/);
    if (!m) throw new Error('TDEE text not found');
    return m[1];
  };

  it.each([...SUPPORTED_SEXES])('%s: gauge TDEE equals calculateDetailedTDEE', async (sex) => {
    const expected = calculateDetailedTDEE({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex,
      activityLevel: 'moderate'
    }).dailyTdee;
    expect(await tdeeShown(sex)).toBe(String(expected));
  });

  it('a profile with no sex is shown the neutral estimate, identical to unspecified, and lower than male', async () => {
    const missing = Number(await tdeeShown(undefined));
    const unspecified = Number(await tdeeShown('unspecified'));
    const male = Number(await tdeeShown('male'));
    expect(missing).toBe(unspecified);
    expect(missing).toBeLessThan(male);
  });
});
