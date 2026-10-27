import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_PROFILE } from '../storage/db';
import {
  commitNutritionTargets,
  NutritionTargetStore
} from '../storage/nutritionTargetCommit';
import {
  calculateWizardMacroPlan,
  CALORIE_FLOOR_KCAL,
  computeNutritionPlan,
  DeficitOrSurplusPace,
  INPUT_BOUNDS,
  MACRO_RECONCILE_TOLERANCE_KCAL,
  NutritionGoal,
  parseNumericInput,
  validateWizardInputs,
  WizardInputs
} from '../utils/tdeeEngine';
import type { BodyMetricEntry, DailyNutritionLog, FoodEntry, UserProfile } from '../types';

const TODAY = '2026-10-27';
const PAST = '2026-10-20';

const validInputs = (over: Partial<WizardInputs> = {}): WizardInputs => ({
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  proteinRatioGramsPerKg: 2.0,
  fatPercentOfCalories: 25,
  goal: 'maintain',
  pace: 'moderate',
  ...over
});

beforeEach(() => {
  localStorage.clear();
});

describe('P1: wizard input validation (engine layer)', () => {
  it('parseNumericInput never turns empty or malformed text into 0', () => {
    expect(parseNumericInput('')).toBeNaN();
    expect(parseNumericInput('   ')).toBeNaN();
    expect(parseNumericInput('abc')).toBeNaN();
    expect(parseNumericInput('12abc')).toBeNaN();
    expect(parseNumericInput('Infinity')).toBeNaN();
    expect(parseNumericInput('-Infinity')).toBeNaN();
    expect(parseNumericInput('78.5')).toBe(78.5);
    expect(parseNumericInput(' 180 ')).toBe(180);
    expect(parseNumericInput('0')).toBe(0); // zero stays zero, and is then rejected by validation
  });

  it('accepts a fully valid input set', () => {
    expect(validateWizardInputs(validInputs())).toEqual({ valid: true, errors: {} });
    expect(computeNutritionPlan(validInputs()).ok).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -70],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity]
  ])('rejects %s weight', (_l, v) => {
    const r = computeNutritionPlan(validInputs({ weightKg: v }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.weight).toBeTruthy();
  });

  it.each([
    ['zero', 0],
    ['negative', -178],
    ['NaN', NaN],
    ['Infinity', Infinity]
  ])('rejects %s height', (_l, v) => {
    const r = computeNutritionPlan(validInputs({ heightCm: v }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.height).toBeTruthy();
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 25.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['below minimum', INPUT_BOUNDS.age.min - 1],
    ['above maximum', INPUT_BOUNDS.age.max + 1]
  ])('rejects %s age', (_l, v) => {
    const r = computeNutritionPlan(validInputs({ age: v }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.age).toBeTruthy();
  });

  it('enforces boundaries: just inside is valid, just outside is invalid', () => {
    const b = INPUT_BOUNDS;
    const ok = (o: Partial<WizardInputs>) => validateWizardInputs(validInputs(o)).valid;
    expect(ok({ weightKg: b.weightKg.min })).toBe(true);
    expect(ok({ weightKg: b.weightKg.max })).toBe(true);
    expect(ok({ weightKg: b.weightKg.min - 0.1 })).toBe(false);
    expect(ok({ weightKg: b.weightKg.max + 0.1 })).toBe(false);
    expect(ok({ heightCm: b.heightCm.min })).toBe(true);
    expect(ok({ heightCm: b.heightCm.max })).toBe(true);
    expect(ok({ heightCm: b.heightCm.min - 1 })).toBe(false);
    expect(ok({ heightCm: b.heightCm.max + 1 })).toBe(false);
    expect(ok({ age: b.age.min })).toBe(true);
    expect(ok({ age: b.age.max })).toBe(true);
    expect(ok({ proteinRatioGramsPerKg: b.proteinGramsPerKg.min })).toBe(true);
    expect(ok({ proteinRatioGramsPerKg: b.proteinGramsPerKg.max })).toBe(true);
    expect(ok({ proteinRatioGramsPerKg: b.proteinGramsPerKg.min - 0.1 })).toBe(false);
    expect(ok({ proteinRatioGramsPerKg: b.proteinGramsPerKg.max + 0.1 })).toBe(false);
    expect(ok({ proteinRatioGramsPerKg: 0 })).toBe(false);
    expect(ok({ fatPercentOfCalories: b.fatPercentOfCalories.min })).toBe(true);
    expect(ok({ fatPercentOfCalories: b.fatPercentOfCalories.max })).toBe(true);
    expect(ok({ fatPercentOfCalories: b.fatPercentOfCalories.min - 1 })).toBe(false);
    expect(ok({ fatPercentOfCalories: b.fatPercentOfCalories.max + 1 })).toBe(false);
  });

  it('treats omitted body fat as valid (Mifflin-St Jeor fallback) but rejects invalid body fat', () => {
    const none = computeNutritionPlan(validInputs({ bodyFatPercentage: undefined }));
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.tdee.formulaUsed).toBe('mifflin_st_jeor');

    const withBf = computeNutritionPlan(validInputs({ bodyFatPercentage: 20 }));
    expect(withBf.ok).toBe(true);
    if (withBf.ok) expect(withBf.tdee.formulaUsed).toBe('katch_mcardle');

    const b = INPUT_BOUNDS.bodyFatPercentage;
    for (const bad of [0, -1, b.min - 0.1, b.max + 0.1, 100, NaN, Infinity]) {
      const r = computeNutritionPlan(validInputs({ bodyFatPercentage: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.bodyFat).toBeTruthy();
    }
    expect(validateWizardInputs(validInputs({ bodyFatPercentage: b.min })).valid).toBe(true);
    expect(validateWizardInputs(validInputs({ bodyFatPercentage: b.max })).valid).toBe(true);
  });

  it('rejects unknown activity level and unsupported sex instead of defaulting', () => {
    const a = computeNutritionPlan(validInputs({ activityLevel: 'bogus' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.activityLevel).toBeTruthy();
    const s = computeNutritionPlan(validInputs({ sex: 'robot' }));
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.errors.sex).toBeTruthy();
  });

  it('rejects a non-finite custom calorie adjustment', () => {
    const r = computeNutritionPlan(validInputs({ customCalorieAdjustment: NaN }));
    expect(r.ok).toBe(false);
  });

  it('calculateWizardMacroPlan itself throws on invalid or non-finite input', () => {
    const base = { dailyTdee: 2500, weightKg: 80, goal: 'cut' as const, pace: 'moderate' as const };
    expect(() => calculateWizardMacroPlan({ ...base, dailyTdee: NaN })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, dailyTdee: 0 })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, dailyTdee: -100 })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, weightKg: 0 })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, weightKg: NaN })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, proteinRatioGramsPerKg: 0 })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, fatPercentOfCalories: 99 })).toThrow(RangeError);
    expect(() => calculateWizardMacroPlan({ ...base, customCalorieAdjustment: Infinity })).toThrow(RangeError);
  });
});

describe('P1: calorie and macro reconciliation', () => {
  const goals: NutritionGoal[] = ['cut', 'maintain', 'bulk'];
  const paces: DeficitOrSurplusPace[] = ['conservative', 'moderate', 'aggressive'];

  it.each(goals.flatMap((g) => paces.map((p) => [g, p] as const)))(
    'unconstrained %s/%s reconciles with 4/4/9 and consistent budgets',
    (goal, pace) => {
      const plan = calculateWizardMacroPlan({ dailyTdee: 2700, weightKg: 78, goal, pace });
      expect(plan.macroCalories).toBe(plan.proteinGrams * 4 + plan.carbsGrams * 4 + plan.fatGrams * 9);
      expect(plan.macroCalorieMismatch).toBe(plan.macroCalories - plan.targetCalories);
      expect(Math.abs(plan.macroCalorieMismatch)).toBeLessThanOrEqual(MACRO_RECONCILE_TOLERANCE_KCAL);
      expect(plan.macrosReconciled).toBe(true);
      expect(plan.calorieFloorApplied).toBe(false);
      expect(plan.constrained).toBe(false);
      expect(plan.warnings).toEqual([]);
      expect(plan.actualCalorieDelta).toBe(plan.requestedCalorieDelta);
      expect(plan.weeklyDeficitOrSurplus).toBe(plan.actualCalorieDelta * 7);
      expect(plan.weeklyTargetCalories).toBe(plan.targetCalories * 7);
      if (goal === 'cut') expect(plan.targetCalories).toBeLessThan(plan.dailyTdee);
      if (goal === 'bulk') expect(plan.targetCalories).toBeGreaterThan(plan.dailyTdee);
      if (goal === 'maintain') expect(plan.targetCalories).toBe(plan.dailyTdee);
    }
  );

  it('requested deltas are -300/-500/-750 for cut, +250/+400/+600 for bulk, 0 for maintain', () => {
    const d = (goal: NutritionGoal, pace: DeficitOrSurplusPace) =>
      calculateWizardMacroPlan({ dailyTdee: 2700, weightKg: 78, goal, pace }).requestedCalorieDelta;
    expect([d('cut', 'conservative'), d('cut', 'moderate'), d('cut', 'aggressive')]).toEqual([-300, -500, -750]);
    expect([d('bulk', 'conservative'), d('bulk', 'moderate'), d('bulk', 'aggressive')]).toEqual([250, 400, 600]);
    expect([d('maintain', 'conservative'), d('maintain', 'moderate'), d('maintain', 'aggressive')]).toEqual([0, 0, 0]);
  });

  it('low-TDEE aggressive cut: floor applied, actual deficit reported, requested pace not claimed', () => {
    const plan = calculateWizardMacroPlan({ dailyTdee: 1400, weightKg: 50, goal: 'cut', pace: 'aggressive' });
    expect(plan.targetCalories).toBe(CALORIE_FLOOR_KCAL);
    expect(plan.calorieFloorApplied).toBe(true);
    expect(plan.requestedCalorieDelta).toBe(-750);
    expect(plan.actualCalorieDelta).toBe(-200);
    expect(plan.weeklyDeficitOrSurplus).toBe(-1400);
    expect(plan.constrained).toBe(true);
    expect(plan.warnings.join(' ')).toContain('Calorie floor applied');
    expect(plan.warnings.join(' ')).toContain('not the requested -750');
    expect(plan.rationale).toContain('not the requested -750');
    expect(plan.rationale).not.toMatch(/Targeting a 750 kcal/);
  });

  it('floor above maintenance on a cut is flagged as not a deficit', () => {
    const plan = calculateWizardMacroPlan({ dailyTdee: 1100, weightKg: 40, goal: 'cut', pace: 'moderate' });
    expect(plan.targetCalories).toBe(CALORIE_FLOOR_KCAL);
    expect(plan.actualCalorieDelta).toBe(100);
    expect(plan.constrained).toBe(true);
    expect(plan.warnings.join(' ')).toContain('not a calorie deficit');
  });

  it('high protein + calorie floor: macros do not reconcile, mismatch is disclosed, values stay finite and non-negative', () => {
    const plan = calculateWizardMacroPlan({
      dailyTdee: 1600,
      weightKg: 120,
      goal: 'cut',
      pace: 'aggressive',
      proteinRatioGramsPerKg: 2.8
    });
    expect(plan.targetCalories).toBe(1200);
    expect(plan.proteinGrams).toBe(336);
    expect(plan.macroCalories).toBe(plan.proteinGrams * 4 + plan.carbsGrams * 4 + plan.fatGrams * 9);
    expect(plan.macroCalorieMismatch).toBeGreaterThan(MACRO_RECONCILE_TOLERANCE_KCAL);
    expect(plan.macrosReconciled).toBe(false);
    expect(plan.constrained).toBe(true);
    expect(plan.warnings.some((w) => w.startsWith('Macros do not reconcile'))).toBe(true);
    for (const n of [plan.proteinGrams, plan.carbsGrams, plan.fatGrams, plan.targetCalories]) {
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('carbohydrate minimum and fat floor are applied and never negative', () => {
    const plan = calculateWizardMacroPlan({
      dailyTdee: 1500,
      weightKg: 110,
      goal: 'cut',
      pace: 'aggressive',
      proteinRatioGramsPerKg: 2.4
    });
    expect(plan.carbsGrams).toBeGreaterThanOrEqual(50);
    expect(plan.fatGrams).toBeGreaterThanOrEqual(Math.max(40, Math.round(110 * 0.6)));
    expect(plan.macrosReconciled).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/minimum/);
  });

  it('is deterministic and does not apply an adjustment twice when goal or pace is switched', () => {
    const run = (goal: NutritionGoal, pace: DeficitOrSurplusPace) =>
      calculateWizardMacroPlan({ dailyTdee: 2700, weightKg: 78, goal, pace });
    const first = run('cut', 'moderate');
    run('bulk', 'aggressive');
    run('maintain', 'conservative');
    const again = run('cut', 'moderate');
    expect(again).toEqual(first);
    expect(first.targetCalories).toBe(2700 - 500);
  });

  it('computeNutritionPlan end to end: weekly budget matches the final target', () => {
    const r = computeNutritionPlan(validInputs({ goal: 'cut', pace: 'moderate' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.weeklyTargetCalories - r.tdee.weeklyTdee).toBe(r.plan.weeklyDeficitOrSurplus);
      expect(r.plan.dailyTdee).toBe(r.tdee.dailyTdee);
    }
  });
});

describe('P1: body-metric upsert preserves fields', () => {
  const base: BodyMetricEntry = {
    id: 'bm-original',
    date: TODAY,
    weightKg: 80,
    waistCm: 82,
    bodyFatPercentage: 18,
    bmi: 24.7,
    notes: 'Morning fasting'
  };

  it('merges weight and body fat while keeping id, waist and notes', () => {
    expect(db.addOrUpdateBodyMetric(base)).toBe(true);
    const update: BodyMetricEntry = { id: 'metric_999', date: TODAY, weightKg: 79.2, bodyFatPercentage: 17, bmi: 24.4 };
    expect(db.addOrUpdateBodyMetric(update)).toBe(true);
    const stored = db.getBodyMetrics();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'bm-original',
      weightKg: 79.2,
      bodyFatPercentage: 17,
      bmi: 24.4,
      waistCm: 82,
      notes: 'Morning fasting'
    });
  });

  it('does not overwrite a stored value with undefined (blank optional input)', () => {
    db.addOrUpdateBodyMetric(base);
    db.addOrUpdateBodyMetric({
      id: 'x',
      date: TODAY,
      weightKg: 79,
      bodyFatPercentage: undefined,
      waistCm: undefined,
      notes: undefined,
      bmi: 24.4
    });
    const [m] = db.getBodyMetrics();
    expect(m.bodyFatPercentage).toBe(18);
    expect(m.waistCm).toBe(82);
    expect(m.notes).toBe('Morning fasting');
    expect(m.weightKg).toBe(79);
  });

  it('never creates a second same-day record and keeps other dates untouched', () => {
    db.addOrUpdateBodyMetric({ ...base, id: 'older', date: PAST, weightKg: 81 });
    db.addOrUpdateBodyMetric(base);
    db.addOrUpdateBodyMetric({ ...base, id: 'again', weightKg: 79.9 });
    db.addOrUpdateBodyMetric({ ...base, id: 'again2', weightKg: 79.8 });
    const stored = db.getBodyMetrics();
    expect(stored.filter((m) => m.date === TODAY)).toHaveLength(1);
    expect(stored).toHaveLength(2);
    expect(stored.find((m) => m.date === PAST)).toMatchObject({ id: 'older', weightKg: 81 });
  });

  it('does not mutate the entry passed in', () => {
    db.addOrUpdateBodyMetric(base);
    const incoming = Object.freeze({ id: 'frozen', date: TODAY, weightKg: 79, bmi: 24.4 }) as BodyMetricEntry;
    expect(() => db.addOrUpdateBodyMetric(incoming)).not.toThrow();
    expect(incoming.id).toBe('frozen');
  });

  it('keeps the demo marker when both records are demo', () => {
    db.addOrUpdateBodyMetric({ ...base, id: 'dm', isDemo: true });
    db.addOrUpdateBodyMetric({ id: 'dm2', date: TODAY, weightKg: 78, bmi: 24, isDemo: true });
    const [m] = db.getBodyMetrics();
    expect(m).toMatchObject({ id: 'dm', isDemo: true, weightKg: 78, waistCm: 82 });
  });

  it('a real entry replaces a same-day demo record without inheriting its fabricated fields', () => {
    db.addOrUpdateBodyMetric({ ...base, id: 'dm', isDemo: true });
    db.addOrUpdateBodyMetric({ id: 'real', date: TODAY, weightKg: 77, bmi: 23.8 });
    const stored = db.getBodyMetrics();
    expect(stored).toHaveLength(1);
    expect(stored[0].isDemo).toBeUndefined();
    expect(stored[0].waistCm).toBeUndefined();
    expect(stored[0].notes).toBeUndefined();
    expect(stored[0].weightKg).toBe(77);
  });

  it('a demo entry never overwrites a real same-day record', () => {
    db.addOrUpdateBodyMetric({ ...base, id: 'real' });
    db.addOrUpdateBodyMetric({ id: 'dm', date: TODAY, weightKg: 50, bmi: 15, isDemo: true });
    const stored = db.getBodyMetrics();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'real', weightKg: 80 });
    expect(stored[0].isDemo).toBeUndefined();
  });

  it('there is no per-field clearing API; removing a measurement is done with deleteBodyMetric', () => {
    db.addOrUpdateBodyMetric(base);
    db.deleteBodyMetric('bm-original');
    expect(db.getBodyMetrics()).toHaveLength(0);
  });

  it('reports failure when storage rejects the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(db.addOrUpdateBodyMetric(base)).toBe(false);
  });
});

const food = (id: string, calories: number): FoodEntry => ({
  id,
  name: `Food ${id}`,
  mealCategory: 'lunch',
  quantity: 1,
  servingUnit: 'serving',
  calories,
  protein: 20,
  carbs: 30,
  fat: 10
});
const log = (date: string, over: Partial<DailyNutritionLog> = {}): DailyNutritionLog => ({
  id: `nutr-${date}`,
  date,
  entries: [food(`f-${date}`, 650)],
  waterMl: 1500,
  targetCalories: 2600,
  targetProtein: 165,
  targetCarbs: 300,
  targetFat: 65,
  ...over
});
const baseProfile = (): UserProfile => ({ ...DEFAULT_PROFILE, name: 'T', sex: 'male' });
const metric = (over: Partial<BodyMetricEntry> = {}): BodyMetricEntry => ({
  id: 'metric_1',
  date: TODAY,
  weightKg: 80,
  bmi: 24.7,
  ...over
});
const targets = { calories: 2400, protein: 176, carbs: 260, fat: 62 };

describe('P1: saving targets never rewrites a historical log', () => {
  it('viewing a past date: past log is byte-for-byte unchanged, profile and today are updated', () => {
    const past = log(PAST);
    const today = log(TODAY, { waterMl: 900 });
    db.saveNutritionLogForDate(past);
    db.saveNutritionLogForDate(today);
    const pastBefore = JSON.stringify(db.getNutritionLogForDate(PAST));

    const profile = { ...baseProfile(), dailyCalorieTarget: 2400 };
    const res = commitNutritionTargets(db, { profile, viewedLog: past, targets, metric: metric(), dayKey: TODAY });

    expect(res.ok).toBe(true);
    expect(res.viewingPastDate).toBe(true);
    expect(JSON.stringify(db.getNutritionLogForDate(PAST))).toBe(pastBefore);
    expect(db.getNutritionLogForDate(PAST).targetCalories).toBe(2600);
    expect(db.getProfile().dailyCalorieTarget).toBe(2400);
    const t = db.getNutritionLogForDate(TODAY);
    expect(t.targetCalories).toBe(2400);
    expect(t.targetProtein).toBe(176);
    expect(t.entries).toHaveLength(1); // food preserved
    expect(t.waterMl).toBe(900); // unrelated field preserved
    expect(db.getNutritionLogs()).toHaveLength(2);
  });

  it('viewing today: only targets change; entries and other fields survive', () => {
    const today = log(TODAY, { entries: [food('a', 400), food('b', 500)] });
    db.saveNutritionLogForDate(today);
    const res = commitNutritionTargets(db, {
      profile: baseProfile(),
      viewedLog: today,
      targets,
      metric: metric(),
      dayKey: TODAY
    });
    expect(res.ok).toBe(true);
    expect(res.viewingPastDate).toBe(false);
    const stored = db.getNutritionLogForDate(TODAY);
    expect(stored.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(stored.waterMl).toBe(1500);
    expect(stored).toMatchObject({ targetCalories: 2400, targetProtein: 176, targetCarbs: 260, targetFat: 62 });
  });

  it('with no log passed, today is created or updated from storage and a past log is still untouched', () => {
    db.saveNutritionLogForDate(log(PAST));
    const res = commitNutritionTargets(db, { profile: baseProfile(), targets, metric: metric(), dayKey: TODAY });
    expect(res.ok).toBe(true);
    expect(db.getNutritionLogForDate(PAST).targetCalories).toBe(2600);
    expect(db.getNutritionLogForDate(TODAY).targetCalories).toBe(2400);
  });

  it('repeated saves do not duplicate logs or body metrics', () => {
    const today = log(TODAY);
    db.saveNutritionLogForDate(today);
    for (let n = 0; n < 3; n++) {
      commitNutritionTargets(db, {
        profile: baseProfile(),
        viewedLog: today,
        targets,
        metric: metric({ id: `metric_${n}` }),
        dayKey: TODAY
      });
    }
    expect(db.getNutritionLogs().filter((l) => l.date === TODAY)).toHaveLength(1);
    expect(db.getBodyMetrics().filter((m) => m.date === TODAY)).toHaveLength(1);
    expect(db.getBodyMetrics()[0].id).toBe('metric_0');
  });

  it('keeps stored waist and notes when the wizard metric omits them', () => {
    db.addOrUpdateBodyMetric({ id: 'bm-1', date: TODAY, weightKg: 81, bmi: 25, waistCm: 83, notes: 'mine', bodyFatPercentage: 19 });
    commitNutritionTargets(db, {
      profile: baseProfile(),
      targets,
      metric: metric({ weightKg: 80 }), // no body fat, waist or notes supplied
      dayKey: TODAY
    });
    expect(db.getBodyMetrics()[0]).toMatchObject({ id: 'bm-1', weightKg: 80, waistCm: 83, notes: 'mine', bodyFatPercentage: 19 });
  });
});

describe('P1: persistence failures are reported honestly', () => {
  const makeStore = (over: Partial<NutritionTargetStore> = {}) => {
    const calls: string[] = [];
    const store: NutritionTargetStore = {
      saveProfile: vi.fn(() => (calls.push('profile'), true)),
      getNutritionLogForDate: vi.fn((d: string) => log(d)),
      saveNutritionLogForDate: vi.fn(() => (calls.push('log'), true)),
      addOrUpdateBodyMetric: vi.fn(() => (calls.push('metric'), true)),
      ...over
    };
    return { store, calls };
  };
  const input = () => ({ profile: baseProfile(), targets, metric: metric(), dayKey: TODAY });

  it('all writes succeed -> ok, all stages persisted', () => {
    const { store, calls } = makeStore();
    const res = commitNutritionTargets(store, input());
    expect(res.ok).toBe(true);
    expect(res.persisted).toEqual({ profile: true, todayLog: true, bodyMetric: true });
    expect(calls).toEqual(['profile', 'log', 'metric']);
  });

  it('profile write fails -> stops immediately, nothing else attempted, nothing persisted', () => {
    const { store } = makeStore({ saveProfile: vi.fn(() => false) });
    const res = commitNutritionTargets(store, input());
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('profile');
    expect(res.persisted).toEqual({ profile: false, todayLog: false, bodyMetric: false });
    expect(store.saveNutritionLogForDate).not.toHaveBeenCalled();
    expect(store.addOrUpdateBodyMetric).not.toHaveBeenCalled();
    expect(res.message).toMatch(/nothing was changed/i);
  });

  it('nutrition-log write fails -> partial: profile persisted, metric not attempted, message says so', () => {
    const { store } = makeStore({ saveNutritionLogForDate: vi.fn(() => false) });
    const res = commitNutritionTargets(store, input());
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('todayLog');
    expect(res.persisted).toEqual({ profile: true, todayLog: false, bodyMetric: false });
    expect(res.todayLog).toBeUndefined();
    expect(store.addOrUpdateBodyMetric).not.toHaveBeenCalled();
    expect(res.message).toMatch(/profile targets were saved/i);
  });

  it('body-metric write fails -> partial: profile and log persisted', () => {
    const { store } = makeStore({ addOrUpdateBodyMetric: vi.fn(() => false) });
    const res = commitNutritionTargets(store, input());
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('bodyMetric');
    expect(res.persisted).toEqual({ profile: true, todayLog: true, bodyMetric: false });
    expect(res.todayLog?.targetCalories).toBe(2400);
  });

  it('a throwing store method is treated as failure, not success', () => {
    const { store } = makeStore({
      saveProfile: vi.fn(() => {
        throw new Error('boom');
      })
    });
    const res = commitNutritionTargets(store, input());
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('profile');
  });

  it('a method returning a non-true value (legacy void) is not trusted as success', () => {
    const { store } = makeStore({ saveProfile: vi.fn(() => undefined as unknown as boolean) });
    expect(commitNutritionTargets(store, input()).ok).toBe(false);
  });

  it('failure messages are non-sensitive (no profile values, no raw error text)', () => {
    const { store } = makeStore({
      saveNutritionLogForDate: vi.fn(() => {
        throw new Error('QuotaExceededError: secret 12345');
      })
    });
    const res = commitNutritionTargets(store, input());
    expect(res.message).not.toMatch(/12345|Quota|secret|2400|80/);
  });

  it('retry after a failure succeeds and leaves one record per date (idempotent)', () => {
    let failMetric = true;
    const { store } = makeStore({
      addOrUpdateBodyMetric: vi.fn(() => !failMetric)
    });
    const first = commitNutritionTargets(store, input());
    expect(first.ok).toBe(false);
    failMetric = false;
    const second = commitNutritionTargets(store, input());
    expect(second.ok).toBe(true);
  });

  it('real storage: quota failure on the nutrition log leaves a partial state that is reported, then a retry completes it', () => {
    const profile = { ...baseProfile(), dailyCalorieTarget: 2400 };
    const realSet = Storage.prototype.setItem;
    let failLogs = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (failLogs && /nutrition/i.test(key)) throw new Error('QuotaExceededError');
      return realSet.call(this, key, value);
    });

    const first = commitNutritionTargets(db, { profile, targets, metric: metric(), dayKey: TODAY });
    expect(first.ok).toBe(false);
    expect(first.failedStage).toBe('todayLog');
    expect(first.persisted.profile).toBe(true);
    expect(db.getProfile().dailyCalorieTarget).toBe(2400);
    expect(db.getBodyMetrics()).toHaveLength(0);

    failLogs = false;
    const second = commitNutritionTargets(db, { profile, targets, metric: metric(), dayKey: TODAY });
    expect(second.ok).toBe(true);
    expect(db.getNutritionLogForDate(TODAY).targetCalories).toBe(2400);
    expect(db.getBodyMetrics()).toHaveLength(1);
  });

  it('db write methods return false when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(db.saveProfile(baseProfile())).toBe(false);
    expect(db.saveNutritionLogForDate(log(TODAY))).toBe(false);
    expect(db.saveBodyMetrics([])).toBe(false);
  });
});
