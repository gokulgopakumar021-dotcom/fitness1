import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_PROFILE } from '../storage/db';
import { commitNutritionTargets } from '../storage/nutritionTargetCommit';
import {
  hasUsableTargetSnapshot,
  resolveDiaryTargets,
  targetSourceCaption,
  DIARY_DEFAULT_TARGETS
} from '../utils/nutritionTargets';
import { calculateDetailedTDEE, SUPPORTED_SEXES, validateWizardInputs } from '../utils/tdeeEngine';
import { evaluateDailyScorecard } from '../utils/scorecard/scoring';
import type { BodyMetricEntry, DailyNutritionLog, UserProfile } from '../types';

const TODAY = '2026-10-27';
const PAST = '2026-10-20';
const LOGS_KEY = 'ironlog_nutrition_logs_v1';
const METRICS_KEY = 'ironlog_body_metrics_v1';

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  ...DEFAULT_PROFILE,
  dailyCalorieTarget: 3000,
  dailyProteinTarget: 200,
  dailyCarbsTarget: 350,
  dailyFatTarget: 80,
  ...over
});

const log = (date: string, over: Partial<DailyNutritionLog> = {}): DailyNutritionLog => ({
  id: `nutr-${date}`,
  date,
  entries: [],
  waterMl: 0,
  targetCalories: 2200,
  targetProtein: 150,
  targetCarbs: 250,
  targetFat: 60,
  ...over
});

const food = (id: string, calories = 500, protein = 30) => ({
  id,
  name: id,
  mealCategory: 'lunch' as const,
  quantity: 1,
  servingUnit: 'g' as const,
  calories,
  protein,
  carbs: 50,
  fat: 10
});

beforeEach(() => {
  localStorage.clear();
});

/* ─────────────── A. historical target resolution ─────────────── */

describe('resolveDiaryTargets', () => {
  const p = profile();

  it("today keeps using the live profile targets even if today's log holds a different snapshot", () => {
    const r = resolveDiaryTargets({ date: TODAY, today: TODAY, profile: p, log: log(TODAY), logIsStored: true });
    expect(r).toEqual({ calories: 3000, protein: 200, carbs: 350, fat: 80, source: 'current' });
    expect(targetSourceCaption(r.source)).toBeNull();
  });

  it('a future day uses the live profile targets', () => {
    const r = resolveDiaryTargets({ date: '2026-10-30', today: TODAY, profile: p, log: log('2026-10-30'), logIsStored: true });
    expect(r.source).toBe('current');
    expect(r.calories).toBe(3000);
  });

  it('a past day with a stored, complete snapshot shows that snapshot', () => {
    const r = resolveDiaryTargets({ date: PAST, today: TODAY, profile: p, log: log(PAST), logIsStored: true });
    expect(r).toEqual({ calories: 2200, protein: 150, carbs: 250, fat: 60, source: 'snapshot' });
  });

  it('a past day whose log is NOT stored is a fallback, even though the fabricated log carries numbers', () => {
    const r = resolveDiaryTargets({ date: PAST, today: TODAY, profile: p, log: log(PAST, { targetCalories: 3000 }), logIsStored: false });
    expect(r.source).toBe('fallback');
    expect(r.calories).toBe(3000);
  });

  it.each([
    ['zero calories', { targetCalories: 0 }],
    ['missing protein', { targetProtein: undefined as unknown as number }],
    ['NaN carbs', { targetCarbs: NaN }],
    ['negative fat', { targetFat: -5 }]
  ])('a stored past log with an unusable snapshot (%s) falls back and is not partially mixed', (_n, over) => {
    const r = resolveDiaryTargets({ date: PAST, today: TODAY, profile: p, log: log(PAST, over), logIsStored: true });
    expect(r).toEqual({ calories: 3000, protein: 200, carbs: 350, fat: 80, source: 'fallback' });
  });

  it('ignores a log whose date does not match the date being shown (mid-navigation render)', () => {
    const r = resolveDiaryTargets({ date: PAST, today: TODAY, profile: p, log: log('2026-10-19'), logIsStored: true });
    expect(r.source).toBe('fallback');
  });

  it('keeps the diary default targets when the profile has none', () => {
    const empty = profile({ dailyCalorieTarget: 0, dailyProteinTarget: 0, dailyCarbsTarget: 0, dailyFatTarget: 0 });
    const r = resolveDiaryTargets({ date: TODAY, today: TODAY, profile: empty, logIsStored: false });
    expect(r).toMatchObject({ calories: DIARY_DEFAULT_TARGETS.calories, protein: DIARY_DEFAULT_TARGETS.protein, carbs: 300, fat: 70 });
  });

  it('the fallback caption does not present current targets as historical', () => {
    const caption = targetSourceCaption('fallback')!;
    expect(caption).toMatch(/No targets were saved for this day/);
    expect(caption).toMatch(/current targets/);
    expect(caption).toMatch(/may differ/);
    expect(targetSourceCaption('snapshot')).toMatch(/saved with this day/);
  });

  it('hasUsableTargetSnapshot requires all four positive finite numbers', () => {
    expect(hasUsableTargetSnapshot(log(PAST))).toBe(true);
    expect(hasUsableTargetSnapshot(null)).toBe(false);
    expect(hasUsableTargetSnapshot(log(PAST, { targetFat: 0 }))).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const l = Object.freeze(log(PAST));
    const pr = Object.freeze(profile());
    expect(() => resolveDiaryTargets({ date: PAST, today: TODAY, profile: pr, log: l, logIsStored: true })).not.toThrow();
  });
});

describe('db.getNutritionLogForDate fabricates unsaved logs with CURRENT targets (why "stored" matters)', () => {
  it('a day with no stored log is stamped with today\'s profile targets and is not persisted', () => {
    db.saveProfile(profile());
    const fabricated = db.getNutritionLogForDate(PAST);
    expect(fabricated.targetCalories).toBe(3000);
    expect(db.getNutritionLogs().some((l) => l.date === PAST)).toBe(false);
  });
});

/* ─────────────── A. scorecard on past days ─────────────── */

describe('scorecard: past-day nutrition targets', () => {
  const PROFILE = { onboardingCompleted: true, dailyCalorieTarget: 3000, dailyProteinTarget: 200 };
  const evalNutrition = (date: string, l: DailyNutritionLog) =>
    evaluateDailyScorecard({
      evaluationDate: date,
      today: TODAY,
      dataset: 'real',
      sessions: [],
      plans: [],
      nutritionLogs: [l],
      sleepLogs: [],
      profile: PROFILE
    }).categories.nutrition;

  it("scores a past day against that day's saved snapshot, not the current profile", () => {
    const n = evalNutrition(PAST, log(PAST, { entries: [food('a', 2200, 150)] }));
    expect(n.target).toEqual({ calories: 2200, proteinG: 150 });
    expect(n.points).toBe(25); // 100% of the saved target. Against the current 3000/200 it would score lower.
    expect(n.notes ?? []).toEqual([]);
  });

  it('today keeps using the live profile targets', () => {
    const n = evalNutrition(TODAY, log(TODAY, { entries: [food('a', 1500, 100)] }));
    expect(n.target).toEqual({ calories: 3000, proteinG: 200 });
    expect(n.partial).toBe(true);
  });

  it('a past day without a usable snapshot falls back to the profile and says so', () => {
    const n = evalNutrition(PAST, log(PAST, { entries: [food('a', 3000, 200)], targetCalories: 0, targetProtein: 0 }));
    expect(n.target).toEqual({ calories: 3000, proteinG: 200 });
    expect(n.notes?.join(' ')).toMatch(/No targets were saved with this day’s log.*current targets/);
  });

  it('the profile gate is unchanged: no personal targets means a past day is still not scored', () => {
    const r = evaluateDailyScorecard({
      evaluationDate: PAST,
      today: TODAY,
      dataset: 'real',
      sessions: [],
      plans: [],
      nutritionLogs: [log(PAST, { entries: [food('a', 2200, 150)] })],
      sleepLogs: [],
      profile: { onboardingCompleted: false, dailyCalorieTarget: 3000, dailyProteinTarget: 200 }
    });
    expect(r.categories.nutrition.status).toBe('insufficient_data');
  });
});

/* ─────────────── B. sex values ─────────────── */

describe('sex: every supported value is accepted and the formula used is explicit', () => {
  const base = { weightKg: 80, heightCm: 180, age: 30, activityLevel: 'moderate' as const };
  const core = 10 * 80 + 6.25 * 180 - 5 * 30; // 1775

  it('the supported set is exactly male, female, other, unspecified', () => {
    expect([...SUPPORTED_SEXES]).toEqual(['male', 'female', 'other', 'unspecified']);
  });

  it.each([
    ['male', core + 5],
    ['female', core - 161],
    ['other', core - 78],
    ['unspecified', core - 78]
  ] as const)('calculateDetailedTDEE(%s) uses Mifflin-St Jeor offset giving BMR %i', (sex, bmr) => {
    expect(calculateDetailedTDEE({ ...base, sex }).bmrMifflinStJeor).toBe(bmr);
  });

  it('other and unspecified use the same neutral midpoint, distinct from male and female', () => {
    const v = (sex: 'male' | 'female' | 'other' | 'unspecified') => calculateDetailedTDEE({ ...base, sex }).bmr;
    expect(v('other')).toBe(v('unspecified'));
    expect(v('other')).toBeLessThan(v('male'));
    expect(v('other')).toBeGreaterThan(v('female'));
  });

  it.each(['male', 'female', 'other', 'unspecified'])('validation accepts %s', (sex) => {
    const r = validateWizardInputs({
      ...base,
      sex,
      proteinRatioGramsPerKg: 2,
      fatPercentOfCalories: 25,
      goal: 'maintain',
      pace: 'moderate'
    });
    expect(r.valid).toBe(true);
    expect(r.errors.sex).toBeUndefined();
  });

  it.each(['', 'Male', 'robot'])('validation rejects unsupported sex %j instead of defaulting', (sex) => {
    const r = validateWizardInputs({
      ...base,
      sex,
      proteinRatioGramsPerKg: 2,
      fatPercentOfCalories: 25,
      goal: 'maintain',
      pace: 'moderate'
    });
    expect(r.valid).toBe(false);
    expect(r.errors.sex).toBeTruthy();
  });
});

/* ─────────────── C. partial persistence ─────────────── */

describe('commit: re-reads today from storage so retries never overwrite newer entries', () => {
  const targets = { calories: 2400, protein: 180, carbs: 260, fat: 70 };
  const metric = (over: Partial<BodyMetricEntry> = {}): BodyMetricEntry => ({
    id: `metric_${Math.random()}`,
    date: TODAY,
    weightKg: 80,
    bmi: 24.7,
    ...over
  });

  it("a stale viewedLog does not clobber entries saved after the view loaded today's log", () => {
    db.saveProfile(profile());
    const staleView = log(TODAY, { entries: [food('breakfast')] });
    db.saveNutritionLogForDate(staleView);
    // Something else (another tab, another surface) adds an entry after the view loaded its copy.
    db.saveNutritionLogForDate({ ...staleView, entries: [food('breakfast'), food('lunch')], waterMl: 750 });

    const r = commitNutritionTargets(db, { profile: profile(), viewedLog: staleView, targets, metric: metric(), dayKey: TODAY });
    expect(r.ok).toBe(true);
    const saved = db.getNutritionLogForDate(TODAY);
    expect(saved.entries.map((e) => e.id)).toEqual(['breakfast', 'lunch']);
    expect(saved.waterMl).toBe(750);
    expect(saved.targetCalories).toBe(2400);
  });

  it('a metric-stage failure, then new food, then a retry: nothing is lost, duplicated or reverted', () => {
    db.saveProfile(profile());
    db.saveNutritionLogForDate(log(TODAY, { entries: [food('a')] }));
    const realSet = Storage.prototype.setItem;
    let failMetrics = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (failMetrics && k === METRICS_KEY) throw new Error('QuotaExceededError');
      return realSet.call(this, k, v);
    });

    const first = commitNutritionTargets(db, { profile: profile({ dailyCalorieTarget: 2400 }), targets, metric: metric(), dayKey: TODAY });
    expect(first.ok).toBe(false);
    expect(first.failedStage).toBe('bodyMetric');
    expect(first.persisted).toEqual({ profile: true, todayLog: true, bodyMetric: false });
    expect(first.message).toMatch(/targets were saved, but today's body measurement could not be saved/i);

    // The user logs more food while the wizard is still open.
    db.saveNutritionLogForDate({ ...db.getNutritionLogForDate(TODAY), entries: [food('a'), food('b')] });

    failMetrics = false;
    const second = commitNutritionTargets(db, { profile: profile({ dailyCalorieTarget: 2400 }), targets, metric: metric(), dayKey: TODAY });
    expect(second.ok).toBe(true);
    expect(db.getNutritionLogs().filter((l) => l.date === TODAY)).toHaveLength(1);
    expect(db.getNutritionLogForDate(TODAY).entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(db.getBodyMetrics().filter((m) => m.date === TODAY)).toHaveLength(1);
  });

  it('a log-stage failure says that the body measurement was not saved either', () => {
    const store = {
      saveProfile: () => true,
      getNutritionLogForDate: (d: string) => log(d),
      saveNutritionLogForDate: () => false,
      addOrUpdateBodyMetric: vi.fn(() => true)
    };
    const r = commitNutritionTargets(store, { profile: profile(), targets, metric: metric(), dayKey: TODAY });
    expect(r.failedStage).toBe('todayLog');
    expect(r.message).toMatch(/diary targets and today's body measurement were not/i);
    expect(store.addOrUpdateBodyMetric).not.toHaveBeenCalled();
    expect(r.persisted).toEqual({ profile: true, todayLog: false, bodyMetric: false });
  });
});

describe('db: refuses to overwrite unreadable stored data (recoverability)', () => {
  it('saveNutritionLogForDate returns false and leaves corrupt nutrition logs byte-for-byte intact', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const corrupt = '[{"date":"2026-10-01","entries":[{"id":"x"';
    localStorage.setItem(LOGS_KEY, corrupt);
    expect(db.saveNutritionLogForDate(log(TODAY))).toBe(false);
    expect(localStorage.getItem(LOGS_KEY)).toBe(corrupt);
  });

  it('saveNutritionLogForDate refuses a stored value that is valid JSON but not an array', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(LOGS_KEY, '{"oops":true}');
    expect(db.saveNutritionLogForDate(log(TODAY))).toBe(false);
    expect(localStorage.getItem(LOGS_KEY)).toBe('{"oops":true}');
  });

  it('addOrUpdateBodyMetric returns false and leaves corrupt metrics intact', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(METRICS_KEY, '[{"id":"m1","date":');
    expect(db.addOrUpdateBodyMetric({ id: 'n', date: TODAY, weightKg: 80, bmi: 24 })).toBe(false);
    expect(localStorage.getItem(METRICS_KEY)).toBe('[{"id":"m1","date":');
  });

  it('empty storage and valid arrays still write normally', () => {
    expect(db.saveNutritionLogForDate(log(TODAY))).toBe(true);
    expect(db.saveNutritionLogForDate(log(PAST))).toBe(true);
    expect(db.getNutritionLogs()).toHaveLength(2);
    expect(db.addOrUpdateBodyMetric({ id: 'n', date: TODAY, weightKg: 80, bmi: 24 })).toBe(true);
  });

  it('a corrupt log key makes the commit fail at the log stage with the profile reported as saved', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(LOGS_KEY, 'not json');
    const r = commitNutritionTargets(db, {
      profile: profile(),
      targets: { calories: 2400, protein: 180, carbs: 260, fat: 70 },
      metric: { id: 'm', date: TODAY, weightKg: 80, bmi: 24.7 },
      dayKey: TODAY
    });
    expect(r.ok).toBe(false);
    expect(r.failedStage).toBe('todayLog');
    expect(r.persisted).toEqual({ profile: true, todayLog: false, bodyMetric: false });
    expect(localStorage.getItem(LOGS_KEY)).toBe('not json');
  });
});
