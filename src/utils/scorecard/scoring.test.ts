import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyNutritionLog, DailySleepLog, WorkoutPlan, WorkoutSession } from '../../types';
import {
  CATEGORY_ORDER,
  SCORECARD_WEIGHTS,
  SLEEP_GUIDELINE,
  UTC_DATE_LIMITATION,
  evaluateDailyScorecard,
} from './scoring';
import type { ScorecardInput } from './types';

/* ───────────────────────── fixtures ───────────────────────── */

const TODAY = '2026-10-26';
const YESTERDAY = '2026-10-25';

const PROFILE = { onboardingCompleted: true, dailyCalorieTarget: 2600, dailyProteinTarget: 165 };

/** Plan day with 3 + 3 + 4 = 10 planned working sets. */
const PLAN = {
  id: 'p1',
  name: 'Plan',
  days: [
    {
      id: 'd1',
      dayName: 'Push',
      dayOrder: 1,
      exercises: [{ id: 'e1', workingSets: 3 }, { id: 'e2', workingSets: 3 }, { id: 'e3', workingSets: 4 }],
    },
  ],
} as unknown as WorkoutPlan;

type SetSpec = { type?: string; completed?: boolean; skipped?: boolean };

function sets(n: number, extra: SetSpec = {}): SetSpec[] {
  return Array.from({ length: n }, () => ({ type: 'working', completed: true, ...extra }));
}

function session(opts: {
  startTime: string;
  status?: string;
  sets?: SetSpec[];
  isDemo?: boolean;
  planId?: string | undefined;
  dayId?: string | undefined;
  date?: string;
  id?: string;
}): WorkoutSession {
  return {
    id: opts.id ?? `s-${opts.startTime}`,
    planId: 'planId' in opts ? opts.planId : 'p1',
    dayId: 'dayId' in opts ? opts.dayId : 'd1',
    dayName: 'Push',
    date: opts.date ?? opts.startTime.slice(0, 10),
    startTime: opts.startTime,
    status: (opts.status ?? 'completed') as WorkoutSession['status'],
    isDemo: opts.isDemo,
    exercises: [
      {
        id: 'lex1',
        name: 'Bench',
        muscleGroup: 'chest',
        equipment: 'barbell',
        repRange: '8-10',
        targetRir: 2,
        restSeconds: 90,
        sets: (opts.sets ?? []).map((s, i) => ({
          id: `set-${i}`,
          setNumber: i + 1,
          weight: 60,
          reps: 8,
          timestamp: opts.startTime,
          ...s,
        })),
      },
    ],
  } as unknown as WorkoutSession;
}

/** A session that started at local 10:00 on the given local day (month is 1-based). */
function localSession(day: number, sets_: SetSpec[], extra: Partial<Parameters<typeof session>[0]> = {}): WorkoutSession {
  return session({ startTime: new Date(2026, 9, day, 10, 0).toISOString(), sets: sets_, ...extra });
}

function food(calories: number, protein: number, extra: Record<string, unknown> = {}) {
  return { id: `f-${calories}-${protein}`, name: 'Food', mealCategory: 'lunch', quantity: 1, servingUnit: 'g', carbs: 10, fat: 5, calories, protein, ...extra };
}

function nutrition(date: string, entries: unknown[], extra: Partial<DailyNutritionLog> = {}): DailyNutritionLog {
  return { id: `n-${date}`, date, entries, waterMl: 0, targetCalories: 2600, targetProtein: 165, targetCarbs: 300, targetFat: 65, ...extra } as unknown as DailyNutritionLog;
}

function sleep(date: string, hoursSlept: unknown, extra: Record<string, unknown> = {}): DailySleepLog {
  return { id: `sl-${date}`, date, hoursSlept, quality: 80, ...extra } as unknown as DailySleepLog;
}

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    evaluationDate: YESTERDAY,
    today: TODAY,
    dataset: 'real',
    sessions: [],
    plans: [PLAN],
    nutritionLogs: [],
    sleepLogs: [],
    profile: PROFILE,
    ...overrides,
  };
}

function fullInput(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return input({
    sessions: [localSession(25, sets(10))],
    nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)])],
    sleepLogs: [sleep(YESTERDAY, 7.5)],
    ...overrides,
  });
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

function withTZ<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

/* ───────────────────────── tests ───────────────────────── */

describe('weights', () => {
  it('sum to 100 and match the approved values', () => {
    expect(SCORECARD_WEIGHTS).toEqual({ workout: 20, nutrition: 25, hydration: 15, sleep: 25, recovery: 15 });
    expect(CATEGORY_ORDER.reduce((n, id) => n + SCORECARD_WEIGHTS[id], 0)).toBe(100);
  });
});

describe('all categories populated', () => {
  const r = evaluateDailyScorecard(fullInput({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)], { waterMl: 2000 })] }));

  it('scores workout, nutrition and sleep fully; hydration and recovery are informational', () => {
    expect(r.status).toBe('scored');
    expect(r.categories.workout.points).toBe(20);
    expect(r.categories.nutrition.points).toBe(25);
    expect(r.categories.sleep.points).toBe(25);
    expect(r.categories.hydration.status).toBe('informational');
    expect(r.categories.hydration.points).toBeNull();
    expect(r.categories.hydration.eligibleMax).toBe(0);
    expect(r.categories.hydration.raw.waterMl).toBe(2000);
    expect(r.categories.hydration.target.waterMl).toBeNull();
    expect(r.categories.recovery.status).toBe('informational');
    expect(r.categories.recovery.points).toBeNull();
    expect(r.categories.recovery.eligibleMax).toBe(0);
  });

  it('reports earned / eligible maximum, percent and coverage', () => {
    expect(r.earnedPoints).toBe(70);
    expect(r.eligibleMax).toBe(70);
    expect(r.percent).toBe(100);
    expect(r.fullMax).toBe(100);
    expect(r.scoredCount).toBe(3);
    expect(r.totalCategories).toBe(5);
    expect(r.scoredCategories).toEqual(['workout', 'nutrition', 'sleep']);
    expect(r.unscoredCategories).toEqual(['hydration', 'recovery']);
  });

  it('exposes raw values, targets, progress and an explanation per scored category', () => {
    const w = r.categories.workout;
    expect(w.raw.completedWorkingSets).toBe(10);
    expect(w.target.plannedWorkingSets).toBe(10);
    expect(w.progress).toBe(1);
    expect(w.explanation).toMatch(/10 of 10/);
    const n = r.categories.nutrition;
    expect(n.raw).toMatchObject({ calories: 2600, proteinG: 165, loggedEntries: 1 });
    expect(n.target).toEqual({ calories: 2600, proteinG: 165 });
    expect(n.explanation.length).toBeGreaterThan(0);
    const s = r.categories.sleep;
    expect(s.raw.hoursSlept).toBe(7.5);
    expect(s.target).toEqual({ minHours: 7, maxHours: 9 });
    expect(s.explanation).toMatch(/not a personalized target/);
  });

  it('is valid for a past day without marking nutrition partial', () => {
    expect(r.isToday).toBe(false);
    expect(r.categories.nutrition.partial).toBe(false);
  });
});

describe('missing data in one category', () => {
  it('missing workout: excluded, eligible max drops by 20', () => {
    const r = evaluateDailyScorecard(fullInput({ sessions: [] }));
    expect(r.categories.workout.status).toBe('no_data');
    expect(r.categories.workout.points).toBeNull();
    expect(r.eligibleMax).toBe(50);
    expect(r.earnedPoints).toBe(50);
    expect(r.status).toBe('scored');
  });

  it('missing nutrition: excluded, eligible max drops by 25', () => {
    const r = evaluateDailyScorecard(fullInput({ nutritionLogs: [] }));
    expect(r.categories.nutrition.status).toBe('no_data');
    expect(r.eligibleMax).toBe(45);
    expect(r.status).toBe('scored');
  });

  it('missing sleep: excluded, never zero sleep', () => {
    const r = evaluateDailyScorecard(fullInput({ sleepLogs: [] }));
    expect(r.categories.sleep.status).toBe('no_data');
    expect(r.categories.sleep.points).toBeNull();
    expect(r.categories.sleep.raw.hoursSlept).toBeUndefined();
    expect(r.eligibleMax).toBe(45);
    expect(r.percent).toBe(100);
  });

  it('missing hydration (no log, or waterMl 0) is no_data, not zero', () => {
    expect(evaluateDailyScorecard(fullInput({ nutritionLogs: [] })).categories.hydration.status).toBe('no_data');
    expect(evaluateDailyScorecard(fullInput()).categories.hydration.status).toBe('no_data');
  });
});

describe('multiple categories missing', () => {
  it('one scored category is Insufficient data, with category states still visible', () => {
    const r = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 8)] }));
    expect(r.status).toBe('insufficient_data');
    expect(r.percent).toBeNull();
    expect(r.scoredCount).toBe(1);
    expect(r.categories.sleep.status).toBe('scored');
    expect(r.categories.workout.status).toBe('no_data');
    expect(r.categories.nutrition.status).toBe('no_data');
  });

  it('nothing at all is Insufficient data with zero earned and zero eligible', () => {
    const r = evaluateDailyScorecard(input());
    expect(r.status).toBe('insufficient_data');
    expect(r.earnedPoints).toBe(0);
    expect(r.eligibleMax).toBe(0);
    expect(r.percent).toBeNull();
  });

  it('two scored categories meeting the 40-point minimum is scored', () => {
    const r = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 8)], sessions: [localSession(25, sets(10))] }));
    expect(r.status).toBe('scored');
    expect(r.eligibleMax).toBe(45);
  });
});

describe('zero values versus missing values', () => {
  it('0 hours of sleep is a scored 0; no log is not scored', () => {
    const zero = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 0)] })).categories.sleep;
    expect(zero.status).toBe('scored');
    expect(zero.points).toBe(0);
    expect(zero.eligibleMax).toBe(25);
    const none = evaluateDailyScorecard(input()).categories.sleep;
    expect(none.status).toBe('no_data');
    expect(none.points).toBeNull();
  });

  it('a finished session with no completed sets is a scored 0', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(10, { completed: false }))] })).categories.workout;
    expect(w.status).toBe('scored');
    expect(w.points).toBe(0);
    expect(w.eligibleMax).toBe(20);
  });

  it('a logged 0 kcal / 0 g entry is a scored 0, an empty log is not scored', () => {
    const zero = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [food(0, 0)])] })).categories.nutrition;
    expect(zero.status).toBe('scored');
    expect(zero.points).toBe(0);
    const empty = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [])] })).categories.nutrition;
    expect(empty.status).toBe('no_data');
  });

  it('waterMl 0 is no_data, a positive amount is informational', () => {
    const pos = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [], { waterMl: 750 })] })).categories.hydration;
    expect(pos.status).toBe('informational');
    expect(pos.raw.waterMl).toBe(750);
  });
});

describe('planned rest days / no workout', () => {
  it('no session is no_data: not penalised and not assumed to be a rest day', () => {
    const r = evaluateDailyScorecard(fullInput({ sessions: [] }));
    const w = r.categories.workout;
    expect(w.status).toBe('no_data');
    expect(w.eligibleMax).toBe(0);
    expect(w.explanation).toMatch(/does not assume a rest day/);
    expect(r.percent).toBe(100);
  });
});

describe('workout formula and incomplete workouts', () => {
  it('scores partial completion proportionally', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(5))] })).categories.workout;
    expect(w.points).toBe(10);
    expect(w.progress).toBe(0.5);
  });

  it('does not count warm-up, skipped, drop or failure sets (same as the tracker)', () => {
    const mixed = [
      ...sets(4),
      ...sets(3, { type: 'warmup' }),
      ...sets(2, { skipped: true }),
      ...sets(2, { type: 'drop' }),
      ...sets(1, { type: 'failure' }),
      ...sets(2, { completed: false }),
    ];
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, mixed)] })).categories.workout;
    expect(w.raw.completedWorkingSets).toBe(4);
    expect(w.points).toBe(8);
  });

  it('caps over-completion at full points', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(14))] })).categories.workout;
    expect(w.points).toBe(20);
    expect(w.progress).toBeCloseTo(1.4);
  });

  it('an in-progress session alone is in_progress with a resume action, not scored', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(5), { status: 'in_progress' })] })).categories.workout;
    expect(w.status).toBe('in_progress');
    expect(w.points).toBeNull();
    expect(w.eligibleMax).toBe(0);
    expect(w.action?.kind).toBe('resume_session');
  });

  it('a completed session alongside an in-progress one is scored and flagged partial', () => {
    const r = evaluateDailyScorecard(
      input({ sessions: [localSession(25, sets(10)), localSession(25, sets(2), { status: 'in_progress', id: 'x' })] })
    );
    expect(r.categories.workout.status).toBe('scored');
    expect(r.categories.workout.partial).toBe(true);
    expect(r.categories.workout.raw.completedWorkingSets).toBe(10);
  });

  it('an abandoned session with completed sets is scored and labelled partial', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(4), { status: 'abandoned' })] })).categories.workout;
    expect(w.status).toBe('scored');
    expect(w.partial).toBe(true);
    expect(w.points).toBe(8);
    expect(w.explanation).toMatch(/abandoned/);
  });

  it('an abandoned session with no completed sets is not counted', () => {
    const w = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(3, { completed: false }), { status: 'abandoned' })] })).categories.workout;
    expect(w.status).toBe('no_data');
  });

  it('sums multiple sessions on the same day, capped at 1', () => {
    const w = evaluateDailyScorecard(
      input({ sessions: [localSession(25, sets(6), { id: 'a' }), localSession(25, sets(6), { id: 'b' })] })
    ).categories.workout;
    expect(w.raw.completedWorkingSets).toBe(12);
    expect(w.target.plannedWorkingSets).toBe(20);
    expect(w.points).toBe(12);
  });

  it('unresolvable plan day is insufficient_data, never a guessed target', () => {
    for (const s of [
      localSession(25, sets(5), { planId: 'missing' }),
      localSession(25, sets(5), { dayId: 'missing' }),
      localSession(25, sets(5), { planId: undefined, dayId: undefined }),
    ]) {
      const w = evaluateDailyScorecard(input({ sessions: [s] })).categories.workout;
      expect(w.status).toBe('insufficient_data');
      expect(w.points).toBeNull();
    }
  });

  it('a plan day with zero planned sets is insufficient_data', () => {
    const empty = { ...PLAN, days: [{ id: 'd1', dayName: 'x', dayOrder: 1, exercises: [] }] } as unknown as WorkoutPlan;
    const w = evaluateDailyScorecard(input({ plans: [empty], sessions: [localSession(25, sets(5))] })).categories.workout;
    expect(w.status).toBe('insufficient_data');
  });

  it('malformed sessions are invalid_data, not scored', () => {
    const bad = { ...localSession(25, sets(5)), exercises: 'oops' } as unknown as WorkoutSession;
    const w = evaluateDailyScorecard(input({ sessions: [bad] })).categories.workout;
    expect(w.status).toBe('invalid_data');
    expect(w.ignoredRecords).toBe(1);
  });
});

describe('nutrition formula', () => {
  const cat = (entries: unknown[], overrides: Partial<ScorecardInput> = {}) =>
    evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, entries)], ...overrides })).categories.nutrition;

  it('full calorie points within 90–110% of target', () => {
    expect(cat([food(2340, 165)]).points).toBe(25);
    expect(cat([food(2860, 165)]).points).toBe(25);
  });

  it('falls linearly to 0 at 50% and 150%', () => {
    expect(cat([food(1300, 165)]).points).toBe(12);
    expect(cat([food(1820, 165)]).points).toBeCloseTo(12 + 6.5, 2);
    expect(cat([food(3900, 165)]).points).toBe(12);
    expect(cat([food(3380, 165)]).points).toBeCloseTo(12 + 6.5, 2);
    expect(cat([food(500, 165)]).points).toBe(12);
  });

  it('protein scales to 100% of target and is capped', () => {
    expect(cat([food(2600, 82.5)]).points).toBeCloseTo(13 + 6, 2);
    expect(cat([food(2600, 300)]).points).toBe(25);
  });

  it('sums multiple entries; carbs, fat and fibre are information only', () => {
    const n = cat([food(1300, 80, { carbs: 100, fat: 20, fiber: 5 }), food(1300, 85, { carbs: 120, fat: 30, fiber: 7 })]);
    expect(n.points).toBe(25);
    expect(n.raw).toMatchObject({ calories: 2600, proteinG: 165, carbsG: 220, fatG: 50, fiberG: 12, loggedEntries: 2 });
  });

  it('partial logging today is flagged and gives a remaining-targets action', () => {
    const r = evaluateDailyScorecard(
      input({ evaluationDate: TODAY, nutritionLogs: [nutrition(TODAY, [food(1000, 60)])] })
    );
    const n = r.categories.nutrition;
    expect(n.status).toBe('scored');
    expect(n.partial).toBe(true);
    expect(n.notes.join(' ')).toMatch(/1 logged entry so far/);
    expect(n.action).toEqual({ kind: 'remaining_targets', message: '1600 kcal and 105 g protein remaining to reach your daily targets.' });
  });

  it('gives no remaining-targets action for a past day or once targets are met', () => {
    expect(cat([food(1000, 60)]).action).toBeNull();
    const met = evaluateDailyScorecard(input({ evaluationDate: TODAY, nutritionLogs: [nutrition(TODAY, [food(2700, 170)])] }));
    expect(met.categories.nutrition.action).toBeNull();
  });

  it('uses the first log when duplicates exist and says so', () => {
    const r = evaluateDailyScorecard(
      input({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)]), { ...nutrition(YESTERDAY, [food(100, 1)]), id: 'dup' }] })
    );
    expect(r.categories.nutrition.raw.calories).toBe(2600);
    expect(r.categories.nutrition.notes.join(' ')).toMatch(/More than one nutrition log/);
  });
});

describe('missing or invalid nutrition targets', () => {
  const run = (profile: ScorecardInput['profile']) =>
    evaluateDailyScorecard(input({ profile, nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)])] })).categories.nutrition;

  it('requires completed onboarding', () => {
    const n = run({ ...PROFILE, onboardingCompleted: false });
    expect(n.status).toBe('insufficient_data');
    expect(n.points).toBeNull();
    expect(n.eligibleMax).toBe(0);
    expect(n.raw.calories).toBe(2600);
  });

  it('rejects missing profile and invalid targets', () => {
    for (const p of [
      null,
      undefined,
      {},
      { ...PROFILE, dailyCalorieTarget: 0 },
      { ...PROFILE, dailyCalorieTarget: -2000 },
      { ...PROFILE, dailyCalorieTarget: Number.NaN },
      { ...PROFILE, dailyProteinTarget: Number.POSITIVE_INFINITY },
      { ...PROFILE, dailyProteinTarget: 0 },
      { ...PROFILE, dailyProteinTarget: undefined },
      { ...PROFILE, dailyCalorieTarget: '2600' as unknown as number },
    ]) {
      expect(run(p as ScorecardInput['profile']).status).toBe('insufficient_data');
    }
  });

  it("never falls back to the log's stored target fields", () => {
    const n = run(null);
    expect(n.status).toBe('insufficient_data');
    expect(n.target).toEqual({});
  });
});

describe('invalid, negative and non-finite measurements', () => {
  it('ignores invalid food entries and counts them', () => {
    const n = evaluateDailyScorecard(
      input({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165), food(Number.NaN, 10), food(-50, 5), food(100, Number.POSITIVE_INFINITY), null])] })
    ).categories.nutrition;
    expect(n.status).toBe('scored');
    expect(n.raw.loggedEntries).toBe(1);
    expect(n.ignoredRecords).toBe(4);
    expect(n.points).toBe(25);
  });

  it('all entries invalid is invalid_data, not zero', () => {
    const n = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [food(Number.NaN, 1), food(-1, 1)])] })).categories.nutrition;
    expect(n.status).toBe('invalid_data');
    expect(n.points).toBeNull();
  });

  it('rejects invalid sleep durations', () => {
    for (const h of [Number.NaN, -1, 25, Number.POSITIVE_INFINITY, '7.5', null, undefined]) {
      const s = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, h)] })).categories.sleep;
      expect(s.status).toBe('invalid_data');
      expect(s.points).toBeNull();
      expect(s.eligibleMax).toBe(0);
    }
  });

  it('rejects invalid water amounts', () => {
    for (const w of [-100, Number.NaN, Number.POSITIVE_INFINITY, '500']) {
      const h = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [], { waterMl: w as number })] })).categories.hydration;
      expect(h.status).toBe('invalid_data');
    }
  });

  it('non-array collections and null records do not throw', () => {
    const r = evaluateDailyScorecard({
      ...input(),
      sessions: null as unknown as WorkoutSession[],
      plans: undefined as unknown as WorkoutPlan[],
      nutritionLogs: [null, 5] as unknown as DailyNutritionLog[],
      sleepLogs: 'x' as unknown as DailySleepLog[],
    });
    expect(r.status).toBe('insufficient_data');
  });
});

describe('sleep formula', () => {
  const pts = (h: number) => evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, h)] })).categories.sleep.points;

  it('full points from 7 to 9 hours inclusive', () => {
    expect(pts(7)).toBe(25);
    expect(pts(8)).toBe(25);
    expect(pts(9)).toBe(25);
  });

  it('scales below 7 hours and falls past 9 hours', () => {
    expect(pts(6)).toBeCloseTo(21.43, 2);
    expect(pts(3.5)).toBe(12.5);
    expect(pts(10.5)).toBe(12.5);
    expect(pts(12)).toBe(0);
    expect(pts(16)).toBe(0);
  });

  it('labels the 7–9 h guideline as a default, not a personal target', () => {
    expect(SLEEP_GUIDELINE.label).toMatch(/not personalized/);
  });

  it('shows the gap to the guideline and keeps quality, HR and HRV informational', () => {
    const low = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 6.5, { restingHeartRate: 54, hrvMs: 68 })] })).categories.sleep;
    expect(low.action).toEqual({ kind: 'sleep_gap', message: '0.5 h below the 7 h guideline minimum.' });
    expect(low.raw).toMatchObject({ hoursSlept: 6.5, quality: 80, restingHeartRate: 54, hrvMs: 68 });
    const high = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 10)] })).categories.sleep;
    expect(high.action?.message).toBe('1 h above the 9 h guideline maximum.');
    const ok = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 8)] })).categories.sleep;
    expect(ok.action).toBeNull();
  });

  it('quality, HR and HRV do not change the score', () => {
    const a = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 6, { quality: 10 })] })).categories.sleep.points;
    const b = evaluateDailyScorecard(input({ sleepLogs: [sleep(YESTERDAY, 6, { quality: 100, hrvMs: 120 })] })).categories.sleep.points;
    expect(a).toBe(b);
  });
});

describe('recovery', () => {
  it('is always informational with no points, whatever the data', () => {
    for (const r of [evaluateDailyScorecard(input()), evaluateDailyScorecard(fullInput())]) {
      const rec = r.categories.recovery;
      expect(rec.status).toBe('informational');
      expect(rec.points).toBeNull();
      expect(rec.eligibleMax).toBe(0);
      expect(rec.explanation).toMatch(/not a physiological recovery measure/);
    }
  });
});

describe('dataset separation', () => {
  const sessions = [localSession(25, sets(10)), localSession(25, sets(2), { isDemo: true, id: 'demo' })];
  const nutritionLogs = [nutrition(YESTERDAY, [food(2600, 165)]), { ...nutrition(YESTERDAY, [food(1000, 50)]), id: 'demo-n', isDemo: true }];
  const sleepLogs = [sleep(YESTERDAY, 8), { ...sleep(YESTERDAY, 5), id: 'demo-s', isDemo: true }];

  it('real dataset ignores demo records on the same date', () => {
    const r = evaluateDailyScorecard(input({ dataset: 'real', sessions, nutritionLogs, sleepLogs }));
    expect(r.categories.workout.raw.completedWorkingSets).toBe(10);
    expect(r.categories.nutrition.raw.calories).toBe(2600);
    expect(r.categories.sleep.raw.hoursSlept).toBe(8);
  });

  it('demo dataset ignores real records on the same date', () => {
    const r = evaluateDailyScorecard(input({ dataset: 'demo', sessions, nutritionLogs, sleepLogs }));
    expect(r.categories.workout.raw.completedWorkingSets).toBe(2);
    expect(r.categories.nutrition.raw.calories).toBe(1000);
    expect(r.categories.sleep.raw.hoursSlept).toBe(5);
  });

  it('demo mode with only real records shows no data', () => {
    const r = evaluateDailyScorecard(fullInput({ dataset: 'demo' }));
    expect(r.status).toBe('insufficient_data');
    expect(r.scoredCount).toBe(0);
  });
});

describe('overall score', () => {
  it('computes earned / eligible max and a one-decimal percentage', () => {
    // workout 5/10 = 10 of 20, sleep 6 h = 21.43 of 25 -> 31.43 / 45
    const r = evaluateDailyScorecard(input({ sessions: [localSession(25, sets(5))], sleepLogs: [sleep(YESTERDAY, 6)] }));
    expect(r.earnedPoints).toBeCloseTo(31.43, 2);
    expect(r.eligibleMax).toBe(45);
    expect(r.percent).toBe(69.8);
  });

  it('excludes unscored categories from both numerator and denominator', () => {
    const r = evaluateDailyScorecard(
      fullInput({ profile: { ...PROFILE, onboardingCompleted: false } })
    );
    expect(r.categories.nutrition.status).toBe('insufficient_data');
    expect(r.eligibleMax).toBe(45);
    expect(r.earnedPoints).toBe(45);
  });

  it('keeps every category status visible when the overall result is insufficient', () => {
    const r = evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)], { waterMl: 500 })], profile: null }));
    expect(r.status).toBe('insufficient_data');
    expect(Object.keys(r.categories)).toEqual([...CATEGORY_ORDER]);
    expect(r.categories.nutrition.status).toBe('insufficient_data');
    expect(r.categories.hydration.status).toBe('informational');
  });

  it('adds the UTC-date limitation only when nutrition or sleep data is involved', () => {
    expect(evaluateDailyScorecard(input()).limitations).toEqual([]);
    expect(evaluateDailyScorecard(fullInput()).limitations).toEqual([UTC_DATE_LIMITATION]);
  });
});

describe('date validation', () => {
  it('flags future, malformed and impossible dates without throwing', () => {
    for (const evaluationDate of ['2026-10-27', '2026-02-31', '26-10-25', '', 'x']) {
      const r = evaluateDailyScorecard(fullInput({ evaluationDate }));
      expect(r.status).toBe('invalid_input');
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.percent).toBeNull();
      expect(r.scoredCount).toBe(0);
      expect(r.categories.workout.status).toBe('no_data');
    }
  });

  it('flags a bad today value and bad dataset', () => {
    expect(evaluateDailyScorecard(fullInput({ today: 'nope' })).status).toBe('invalid_input');
    expect(evaluateDailyScorecard(fullInput({ dataset: 'other' as 'real' })).status).toBe('invalid_input');
  });

  it('accepts today itself', () => {
    const r = evaluateDailyScorecard(input({ evaluationDate: TODAY }));
    expect(r.status).toBe('insufficient_data');
    expect(r.isToday).toBe(true);
  });
});

describe('timezone and local-day boundaries', () => {
  const planSession = (startTime: string, date: string, id: string) =>
    session({ startTime, date, id, sets: sets(1) });
  const done = (tz: string, evaluationDate: string, today: string, sessions: WorkoutSession[]) =>
    withTZ(tz, () => evaluateDailyScorecard(input({ evaluationDate, today, sessions })).categories.workout);

  it('Asia/Dubai (UTC+4): a session at 01:00 local belongs to the local day, not its UTC date', () => {
    // 21:00Z on the 25th is 01:00 on the 26th in Dubai; the stored UTC-derived date says the 25th.
    const s = [planSession('2026-10-25T21:00:00.000Z', '2026-10-25', 'dxb')];
    expect(withTZ('Asia/Dubai', () => new Date('2026-10-25T21:00:00Z').getDate())).toBe(26);
    expect(done('Asia/Dubai', '2026-10-26', '2026-10-26', s).status).toBe('scored');
    expect(done('Asia/Dubai', '2026-10-25', '2026-10-26', s).status).toBe('no_data');
  });

  it('Asia/Kolkata (UTC+5:30): midnight boundary at 18:30Z', () => {
    const s = [
      planSession('2026-10-26T18:29:00.000Z', '2026-10-26', 'a'), // 23:59 on 26th
      planSession('2026-10-26T18:30:00.000Z', '2026-10-26', 'b'), // 00:00 on 27th
      planSession('2026-10-25T19:00:00.000Z', '2026-10-25', 'c'), // 00:30 on 26th
    ];
    expect(done('Asia/Kolkata', '2026-10-26', '2026-10-27', s).raw.completedWorkingSets).toBe(2);
    expect(done('Asia/Kolkata', '2026-10-27', '2026-10-27', s).raw.completedWorkingSets).toBe(1);
  });

  it('America/New_York fall-back (25-hour day): both 01:30 sessions fall on 1 Nov', () => {
    const s = [
      planSession('2026-11-01T03:59:00.000Z', '2026-11-01', 'oct31'), // 23:59 EDT, 31 Oct
      planSession('2026-11-01T04:00:00.000Z', '2026-11-01', 'a'), // 00:00 EDT, 1 Nov
      planSession('2026-11-01T05:30:00.000Z', '2026-11-01', 'b'), // 01:30 EDT
      planSession('2026-11-01T06:30:00.000Z', '2026-11-01', 'c'), // 01:30 EST (repeated hour)
      planSession('2026-11-02T04:59:00.000Z', '2026-11-02', 'd'), // 23:59 EST, 1 Nov
      planSession('2026-11-02T05:00:00.000Z', '2026-11-02', 'nov2'), // 00:00 EST, 2 Nov
    ];
    expect(done('America/New_York', '2026-11-01', '2026-11-02', s).raw.completedWorkingSets).toBe(4);
    expect(done('America/New_York', '2026-10-31', '2026-11-02', s).raw.completedWorkingSets).toBe(1);
    expect(done('America/New_York', '2026-11-02', '2026-11-02', s).raw.completedWorkingSets).toBe(1);
  });

  it('America/New_York spring-forward (23-hour day) boundaries', () => {
    const s = [
      planSession('2026-03-08T04:59:00.000Z', '2026-03-08', 'mar7'), // 23:59 EST, 7 Mar
      planSession('2026-03-08T05:00:00.000Z', '2026-03-08', 'a'), // 00:00 EST, 8 Mar
      planSession('2026-03-09T03:59:00.000Z', '2026-03-09', 'b'), // 23:59 EDT, 8 Mar
      planSession('2026-03-09T04:00:00.000Z', '2026-03-09', 'mar9'), // 00:00 EDT, 9 Mar
    ];
    expect(done('America/New_York', '2026-03-08', '2026-03-09', s).raw.completedWorkingSets).toBe(2);
    expect(done('America/New_York', '2026-03-07', '2026-03-09', s).raw.completedWorkingSets).toBe(1);
    expect(done('America/New_York', '2026-03-09', '2026-03-09', s).raw.completedWorkingSets).toBe(1);
  });

  it('a date-only session (no usable start time) falls back to its stored date and says so', () => {
    const s = [{ ...session({ startTime: '2026-10-25', date: '2026-10-25', sets: sets(10) }) }];
    const w = evaluateDailyScorecard(input({ sessions: s })).categories.workout;
    expect(w.status).toBe('scored');
    expect(w.notes.join(' ')).toMatch(/date-only/);
  });

  it('nutrition and sleep logs are matched on their stored date string, in any timezone', () => {
    for (const tz of ['Asia/Dubai', 'Asia/Kolkata', 'America/New_York', 'UTC']) {
      const r = withTZ(tz, () =>
        evaluateDailyScorecard(input({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)])], sleepLogs: [sleep(YESTERDAY, 8)] }))
      );
      expect(r.categories.nutrition.status).toBe('scored');
      expect(r.categories.sleep.status).toBe('scored');
      const other = withTZ(tz, () =>
        evaluateDailyScorecard(input({ evaluationDate: TODAY, nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)])] }))
      );
      expect(other.categories.nutrition.status).toBe('no_data');
    }
  });
});

describe('purity and determinism', () => {
  it('repeated evaluations of the same input are identical', () => {
    const i = fullInput();
    const a = evaluateDailyScorecard(i);
    const b = evaluateDailyScorecard(i);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not read the system clock', () => {
    const i = fullInput();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const a = evaluateDailyScorecard(i);
    vi.setSystemTime(new Date('2030-06-15T12:00:00Z'));
    const b = evaluateDailyScorecard(i);
    expect(b).toEqual(a);
  });

  it('does not mutate or depend on identity of its input (deep-frozen input works)', () => {
    const i = deepFreeze(fullInput({ nutritionLogs: [nutrition(YESTERDAY, [food(2600, 165)], { waterMl: 500 })] }));
    const before = JSON.stringify(i);
    expect(() => evaluateDailyScorecard(i)).not.toThrow();
    expect(JSON.stringify(i)).toBe(before);
  });

  it('is independent of record order for unrelated days', () => {
    const a = fullInput();
    const b = {
      ...a,
      sessions: [localSession(20, sets(3), { id: 'old' }), ...a.sessions],
      sleepLogs: [sleep('2026-10-20', 4), ...a.sleepLogs],
    };
    const ra = evaluateDailyScorecard(a);
    const rb = evaluateDailyScorecard(b);
    expect(rb.earnedPoints).toBe(ra.earnedPoints);
    expect(rb.eligibleMax).toBe(ra.eligibleMax);
  });

  it('makes no network calls', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    evaluateDailyScorecard(fullInput());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not touch storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    evaluateDailyScorecard(fullInput());
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});
