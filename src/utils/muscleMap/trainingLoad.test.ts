import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoggedExercise, LoggedSet, SetType, WorkoutSession } from '../../types';
import { addDays } from './localDay';
import { MUSCLE_REGION_IDS } from './regions';
import {
  BASELINE_WEEKS,
  CURRENT_PERIOD_DAYS,
  HEAVIER_ABOVE_RATIO,
  LIGHTER_BELOW_RATIO,
  LOAD_DISCLAIMER,
  LOAD_STATUS_LABELS,
  MIN_USABLE_BASELINE_WEEKS,
  buildMuscleMapSummary,
  formatAverage,
  formatLoadSummary,
  type RegionTrainingSummary,
} from './trainingLoad';

/*
 * Reference clock: Sunday 25 Oct 2026, 15:00 LOCAL. Everything is built with local-time
 * constructors, so results do not depend on the timezone of the machine running the tests.
 *
 *   baseline weeks: w0 = Sep 20-26 (today-35..-29), w1 = Sep 27-Oct 3, w2 = Oct 4-10, w3 = Oct 11-17
 *   current window: Oct 18-24 (today-7..-1)         today: Oct 25 (partial, never in a window)
 */
const NOW = new Date(2026, 9, 25, 15, 0, 0);
const TODAY = '2026-10-25';
const day = (offset: number) => addDays(TODAY, offset);
/** Offset (from today) of a day inside baseline week w (0 = oldest), `inWeek` days after its start. */
const weekDay = (w: number, inWeek = 2) => -35 + 7 * w + inWeek;

let seq = 0;
const startOf = (dayKey: string, hour = 18, min = 0) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, hour, min, 0).toISOString();
};
const mkSet = (over: Partial<LoggedSet> = {}): LoggedSet => ({
  id: `s${++seq}`, setNumber: 1, type: 'working', weight: 50, reps: 10, completed: true, timestamp: '', ...over,
});
const mkEx = (name: string, muscleGroup: string, n: number, setOver: Partial<LoggedSet> = {}): LoggedExercise => ({
  id: `e${++seq}`, name, muscleGroup, equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
  sets: Array.from({ length: n }, () => mkSet(setOver)),
});
const mkSession = (dayKey: string, exercises: LoggedExercise[], over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: `sess${++seq}`, dayName: 'Test', date: dayKey, startTime: startOf(dayKey), status: 'completed', exercises, ...over,
});
/** n eligible Chest sets on the given offset from today. */
const chest = (offset: number, n: number, over: Partial<WorkoutSession> = {}) =>
  mkSession(day(offset), [mkEx('Barbell Bench Press', 'Chest', n)], over);
/**
 * A completed session far outside both windows whose only set is a warm-up. It proves the user was
 * tracking since that day (so all four baseline weeks are usable) without adding any counted sets.
 */
const anchor = (offset = -60) =>
  mkSession(day(offset), [mkEx('Barbell Bench Press', 'Chest', 1, { type: 'warmup' })]);
/** Put `perWeek[w]` chest sets in baseline week w. */
const baseline = (perWeek: number[]) =>
  perWeek.flatMap((n, w) => (n > 0 ? [chest(weekDay(w), n)] : []));

const run = (sessions: WorkoutSession[], opts?: Parameters<typeof buildMuscleMapSummary>[2]) =>
  buildMuscleMapSummary(sessions, NOW, opts);
const chestOf = (sessions: WorkoutSession[], opts?: Parameters<typeof buildMuscleMapSummary>[2]) => run(sessions, opts).regions.chest;

afterEach(() => {
  vi.useRealTimers();
});

describe('constants', () => {
  it('uses the specified band, windows and history requirement', () => {
    expect(LIGHTER_BELOW_RATIO).toBe(0.75);
    expect(HEAVIER_ABOVE_RATIO).toBe(1.25);
    expect(CURRENT_PERIOD_DAYS).toBe(7);
    expect(BASELINE_WEEKS).toBe(4);
    expect(MIN_USABLE_BASELINE_WEEKS).toBe(2);
  });
});

describe('windows', () => {
  it('current = the 7 complete local days before today; baseline = the 28 days before that; no overlap', () => {
    const s = run([]);
    expect(s.today).toBe(TODAY);
    expect(s.currentPeriod).toEqual({ startDay: '2026-10-18', endDay: '2026-10-24' });
    expect(s.baselinePeriod).toEqual({ startDay: '2026-09-20', endDay: '2026-10-17' });
    expect(addDays(s.baselinePeriod.endDay, 1)).toBe(s.currentPeriod.startDay);
  });

  it('current window boundaries: -7 and -1 are in; -8 and today are out', () => {
    const base = [anchor()];
    expect(chestOf([...base, chest(-7, 2)]).currentPeriodSets).toBe(2);
    expect(chestOf([...base, chest(-1, 3)]).currentPeriodSets).toBe(3);
    expect(chestOf([...base, chest(-8, 4)]).currentPeriodSets).toBe(0);
    const today = chestOf([...base, chest(0, 5)]);
    expect(today.currentPeriodSets).toBe(0); // today is a partial day, never in the window
    expect(today.setsToday).toBe(5); // but it is reported separately and counted for last-trained
    expect(today.lastTrainedDay).toBe(TODAY);
  });

  it('baseline boundaries: -35 and -8 are in (as weeks 0 and 3); -36 and -7 are not', () => {
    // 4 baseline weeks usable. Single session, so average = sets / 4.
    expect(chestOf([anchor(), chest(-35, 8)]).baselineWeeklyAverage).toBe(2); // week 0
    expect(chestOf([anchor(), chest(-8, 8)]).baselineWeeklyAverage).toBe(2); // week 3
    expect(chestOf([anchor(), chest(-36, 8)]).baselineWeeklyAverage).toBe(0); // before the window
    const atMinus7 = chestOf([anchor(), chest(-7, 8)]);
    expect(atMinus7.baselineWeeklyAverage).toBe(0); // -7 is current, not baseline
    expect(atMinus7.currentPeriodSets).toBe(8);
  });

  it('week boundaries inside the baseline: -29 and -28 fall in adjacent weeks of the same average', () => {
    // all four weeks usable -> average = total / 4 wherever the sets fall inside the window
    expect(chestOf([anchor(), chest(-29, 4), chest(-28, 4)]).baselineWeeklyAverage).toBe(2);
    expect(chestOf([anchor(), chest(-22, 4), chest(-21, 4)]).baselineWeeklyAverage).toBe(2);
    expect(chestOf([chest(-35, 4)]).baselineWeeksUsed).toBe(4);
  });
});

describe('history sufficiency', () => {
  it('empty history -> every region is Insufficient data, with no division by zero', () => {
    const s = run([]);
    expect(s.history).toEqual({ firstTrackedDay: null, usableBaselineWeeks: 0, requiredBaselineWeeks: 2, sufficient: false });
    for (const id of MUSCLE_REGION_IDS) {
      expect(s.regions[id]).toMatchObject({
        status: 'insufficient_data', currentPeriodSets: 0, baselineWeeklyAverage: null, ratio: null, lastTrainedDay: null, recentExercises: [],
      });
    }
  });

  it('non-array / null input behaves like empty history', () => {
    expect(run(null as never).history.sufficient).toBe(false);
    expect(run(undefined as never).regions.chest.status).toBe('insufficient_data');
  });

  it('exactly 21 tracked days (first session at today-21) is the minimum; 20 is not enough', () => {
    const enough = run([chest(-21, 5), chest(-3, 3)]);
    expect(enough.history).toMatchObject({ firstTrackedDay: day(-21), usableBaselineWeeks: 2, sufficient: true });
    expect(enough.regions.chest).toMatchObject({ baselineWeeksUsed: 2, baselineWeeklyAverage: 2.5, currentPeriodSets: 3, status: 'typical' });

    const notEnough = run([chest(-20, 5), chest(-3, 3)]);
    expect(notEnough.history).toMatchObject({ firstTrackedDay: day(-20), usableBaselineWeeks: 1, sufficient: false });
    expect(notEnough.regions.chest).toMatchObject({ status: 'insufficient_data', baselineWeeklyAverage: null, ratio: null, baselineWeeksUsed: 0 });
  });

  it('counts 3 and 4 usable weeks when the first session is at -28 and -35', () => {
    expect(run([chest(-28, 6)]).history.usableBaselineWeeks).toBe(3);
    expect(run([chest(-35, 6)]).history.usableBaselineWeeks).toBe(4);
    expect(run([chest(-60, 6)]).history.usableBaselineWeeks).toBe(4);
  });

  it('does not treat days before the first session as zero-training weeks', () => {
    // First session at -21: only weeks 2 and 3 are usable, so weeks 0-1 (no tracking) are NOT averaged in.
    const r = chestOf([chest(-21, 6), chest(-2, 3)]);
    expect(r.baselineWeeksUsed).toBe(2);
    expect(r.baselineWeeklyAverage).toBe(3); // 6 sets / 2 weeks, not 6 / 4
  });

  it('DOES count empty weeks after the first session as zero-volume weeks (logged volume only)', () => {
    const r = chestOf([chest(-35, 5), chest(-3, 5)]); // 5 sets in w0 only; w1-w3 empty but tracked
    expect(r.baselineWeeksUsed).toBe(4);
    expect(r.baselineWeeklyAverage).toBe(1.25);
    expect(r.status).toBe('heavier'); // 5 / 1.25 = 400%
  });

  it('incomplete history with a lot of data in a single week is still insufficient', () => {
    const r = chestOf([chest(-13, 30), chest(-2, 3)]);
    expect(r.status).toBe('insufficient_data');
  });

  it('only sessions in the chosen dataset, completed, and datable count as tracking evidence', () => {
    const early = (over: Partial<WorkoutSession>) => chest(-40, 5, over);
    expect(run([early({ isDemo: true })]).history.firstTrackedDay).toBeNull();
    expect(run([early({ status: 'abandoned' })]).history.firstTrackedDay).toBeNull();
    expect(run([early({ status: 'in_progress' })]).history.firstTrackedDay).toBeNull();
    expect(run([early({ startTime: '', date: '' })]).history.firstTrackedDay).toBeNull();
  });
});

describe('statuses', () => {
  it('No recent work: sufficient history but nothing in the current window', () => {
    const r = chestOf([anchor(), ...baseline([4, 4, 4, 4])]);
    expect(r).toMatchObject({ status: 'no_recent_work', currentPeriodSets: 0, baselineWeeklyAverage: 4, ratio: 0 });
    expect(LOAD_STATUS_LABELS[r.status]).toBe('No recent work');
  });

  it('Insufficient data (not "No recent work") when history is too short to interpret an absence', () => {
    const r = chestOf([chest(-10, 5)]);
    expect(r.currentPeriodSets).toBe(0);
    expect(r.status).toBe('insufficient_data');
  });

  it('zero baseline with recent work -> No historical baseline (no division, no category)', () => {
    const r = chestOf([anchor(), chest(-2, 3)]);
    expect(r).toMatchObject({ status: 'no_baseline', baselineWeeklyAverage: 0, ratio: null, currentPeriodSets: 3 });
    expect(Number.isFinite(r.baselineWeeklyAverage as number)).toBe(true);
  });

  it('zero baseline and zero current -> No recent work with a null ratio', () => {
    const r = run([anchor()]).regions.chest;
    expect(r).toMatchObject({ status: 'no_recent_work', baselineWeeklyAverage: 0, ratio: null, currentPeriodSets: 0 });
  });

  describe('thresholds with a baseline average of 8 sets/week (6 = exactly 75%, 10 = exactly 125%)', () => {
    const hist = () => [anchor(), ...baseline([8, 8, 8, 8])];
    const at = (current: number) => chestOf([...hist(), chest(-2, current)]);

    it('exactly 75% is Typical', () => {
      const r = at(6);
      expect(r.ratio).toBe(0.75);
      expect(r.status).toBe('typical');
    });
    it('just below 75% is Lighter than usual', () => {
      const r = at(5);
      expect(r.ratio).toBe(0.625);
      expect(r.status).toBe('lighter');
    });
    it('exactly 125% is Typical', () => {
      const r = at(10);
      expect(r.ratio).toBe(1.25);
      expect(r.status).toBe('typical');
    });
    it('just above 125% is Heavier than usual', () => {
      const r = at(11);
      expect(r.ratio).toBe(1.375);
      expect(r.status).toBe('heavier');
    });
    it('100% is Typical', () => {
      expect(at(8).status).toBe('typical');
    });
  });

  describe('thresholds with a baseline average of 4 sets/week (3 = 75%, 5 = 125%)', () => {
    const hist = () => [anchor(), ...baseline([4, 4, 4, 4])];
    const at = (n: number) => chestOf([...hist(), chest(-3, n)]).status;
    it.each([[1, 'lighter'], [2, 'lighter'], [3, 'typical'], [4, 'typical'], [5, 'typical'], [6, 'heavier'], [20, 'heavier']] as const)(
      '%i sets -> %s', (n, expected) => expect(at(n)).toBe(expected)
    );
  });

  describe('fractional baseline average (22 sets over 4 weeks = 5.5/week)', () => {
    const hist = () => [anchor(), ...baseline([6, 5, 6, 5])];
    const at = (n: number) => chestOf([...hist(), chest(-3, n)]);
    it('uses the exact average, not a rounded one', () => {
      const r = at(7);
      expect(r.baselineWeeklyAverage).toBe(5.5);
      expect(r.ratio).toBeCloseTo(7 / 5.5, 10);
    });
    it.each([[4, 'lighter'], [5, 'typical'], [6, 'typical'], [7, 'heavier']] as const)('%i sets -> %s', (n, expected) =>
      expect(at(n).status).toBe(expected)
    );
  });

  describe('three usable weeks (first session at -28), so averages are not whole numbers of weeks', () => {
    const hist = (perWeek: [number, number, number]) => [chest(-28, perWeek[0]), chest(-21, perWeek[1]), chest(-14, perWeek[2])];
    it('sum 12 over 3 weeks = 4/week: 3 sets is exactly 75%, 5 is exactly 125%', () => {
      const at = (n: number) => chestOf([...hist([4, 4, 4]), chest(-2, n)]);
      expect(at(5).baselineWeeksUsed).toBe(3);
      expect(at(5).baselineWeeklyAverage).toBe(4);
      expect(at(3).status).toBe('typical');
      expect(at(2).status).toBe('lighter');
      expect(at(5).status).toBe('typical');
      expect(at(6).status).toBe('heavier');
    });
    it('sum 10 over 3 weeks = 3.33/week: compares against the exact value', () => {
      const at = (n: number) => chestOf([...hist([4, 3, 3]), chest(-2, n)]);
      expect(at(1).baselineWeeklyAverage).toBeCloseTo(10 / 3, 10);
      expect(at(2).status).toBe('lighter'); // 2 / 3.33 = 60%
      expect(at(3).status).toBe('typical'); // 90%
      expect(at(4).status).toBe('typical'); // 120%
      expect(at(5).status).toBe('heavier'); // 150%
    });
  });
});

describe('what counts as a set', () => {
  const countFor = (exercises: LoggedExercise[], over: Partial<WorkoutSession> = {}) =>
    chestOf([anchor(), mkSession(day(-2), exercises, over)]).currentPeriodSets;

  it('counts completed working, drop and failure sets once each', () => {
    const ex = mkEx('Barbell Bench Press', 'Chest', 0);
    ex.sets = (['working', 'drop', 'failure'] as SetType[]).map((type) => mkSet({ type }));
    expect(countFor([ex])).toBe(3);
  });
  it('excludes warm-up sets', () => {
    expect(countFor([mkEx('Barbell Bench Press', 'Chest', 3, { type: 'warmup' })])).toBe(0);
  });
  it('excludes incomplete sets', () => {
    expect(countFor([mkEx('Barbell Bench Press', 'Chest', 3, { completed: false })])).toBe(0);
  });
  it('excludes skipped sets even when marked completed (matches calculateVolumeLoad)', () => {
    expect(countFor([mkEx('Barbell Bench Press', 'Chest', 3, { skipped: true, completed: true })])).toBe(0);
  });
  it('counts bodyweight sets recorded with zero weight', () => {
    expect(countFor([mkEx('Weighted Pull-Up / Bodyweight Pull-Up', 'Back', 4, { weight: 0 })])).toBe(0); // back, not chest
    const r = run([anchor(), mkSession(day(-2), [mkEx('Push-Up', 'Chest', 4, { weight: 0, reps: 15 })])]).regions.chest;
    expect(r.currentPeriodSets).toBe(4);
  });
  it('mixes eligible and ineligible sets in one exercise correctly', () => {
    const ex = mkEx('Barbell Bench Press', 'Chest', 0);
    ex.sets = [mkSet({ type: 'warmup' }), mkSet(), mkSet({ completed: false }), mkSet({ skipped: true }), mkSet({ type: 'drop' })];
    expect(countFor([ex])).toBe(2);
  });
  it('ignores sessions that are abandoned or in progress', () => {
    expect(countFor([mkEx('Barbell Bench Press', 'Chest', 3)], { status: 'abandoned' })).toBe(0);
    expect(countFor([mkEx('Barbell Bench Press', 'Chest', 3)], { status: 'in_progress' })).toBe(0);
  });
  it('survives malformed stored data without throwing', () => {
    const broken = [
      null,
      42,
      { id: 'x', status: 'completed', startTime: startOf(day(-2)), date: day(-2), exercises: undefined },
      { id: 'y', status: 'completed', startTime: startOf(day(-2)), date: day(-2), exercises: [null, { name: 5, sets: 'no' }, { name: 'Barbell Bench Press', muscleGroup: 'Chest', sets: [null, undefined, mkSet()] }] },
    ] as unknown as WorkoutSession[];
    expect(chestOf([anchor(), ...broken]).currentPeriodSets).toBe(1);
  });
});

describe('demo vs real data', () => {
  const real = chest(-2, 3);
  const demo = chest(-3, 7, { isDemo: true });
  const old = chest(-40, 1, { isDemo: true });

  it("'real' (the default) ignores demo sessions entirely", () => {
    const s = run([anchor(), real, demo]);
    expect(s.regions.chest.currentPeriodSets).toBe(3);
    expect(s.diagnostics.excludedWrongDataset).toBe(1);
    expect(s.dataset).toBe('real');
  });
  it("'demo' uses only demo sessions", () => {
    const s = run([anchor(), real, demo, old], { dataset: 'demo' });
    expect(s.dataset).toBe('demo');
    expect(s.regions.chest.currentPeriodSets).toBe(7);
    expect(s.history.firstTrackedDay).toBe(day(-40));
  });
  it('never mixes: demo volume does not leak into the real baseline or history', () => {
    const s = run([demo, old]);
    expect(s.history.firstTrackedDay).toBeNull();
    expect(s.regions.chest.status).toBe('insufficient_data');
  });
});

describe('dates', () => {
  it('uses the startTime LOCAL day even when the stored date-only value is stale or UTC-shifted', () => {
    const s = mkSession(day(-2), [mkEx('Barbell Bench Press', 'Chest', 2)], { date: day(-20), startTime: startOf(day(-2), 23, 30) });
    const r = chestOf([anchor(), s]);
    expect(r.currentPeriodSets).toBe(2);
    expect(r.lastTrainedDay).toBe(day(-2));
    expect(r.lastTrainedDayPrecision).toBe('start-time');
  });
  it('a session at 00:30 local on the first current day is in; 23:30 the day before is out', () => {
    expect(chestOf([anchor(), mkSession(day(-7), [mkEx('Barbell Bench Press', 'Chest', 2)], { startTime: startOf(day(-7), 0, 30) })]).currentPeriodSets).toBe(2);
    expect(chestOf([anchor(), mkSession(day(-8), [mkEx('Barbell Bench Press', 'Chest', 2)], { startTime: startOf(day(-8), 23, 30) })]).currentPeriodSets).toBe(0);
  });
  it('falls back to the date-only value when startTime is unusable, and flags it', () => {
    const s = mkSession(day(-3), [mkEx('Barbell Bench Press', 'Chest', 2)], { startTime: 'not a time', date: day(-3) });
    const r = chestOf([anchor(), s]);
    expect(r.currentPeriodSets).toBe(2);
    expect(r.lastTrainedDay).toBe(day(-3));
    expect(r.lastTrainedDayPrecision).toBe('date-only');
  });
  it('excludes sessions with no usable date and reports them', () => {
    const s = run([anchor(), mkSession(day(-2), [mkEx('Barbell Bench Press', 'Chest', 2)], { startTime: '', date: 'garbage' })]);
    expect(s.regions.chest.currentPeriodSets).toBe(0);
    expect(s.diagnostics.excludedNoUsableDate).toBe(1);
  });
  it('excludes future-dated sessions (clock skew) from every figure', () => {
    const s = run([anchor(), chest(+3, 9)]);
    expect(s.regions.chest.currentPeriodSets).toBe(0);
    expect(s.regions.chest.lastTrainedDay).toBeNull();
    expect(s.diagnostics.excludedFutureDated).toBe(1);
  });
  it('lastTrainedDay is the latest eligible day for the region, even outside both windows', () => {
    const r = chestOf([anchor(-60), chest(-45, 2), chest(-50, 2)]);
    expect(r.lastTrainedDay).toBe(day(-45));
    expect(r.currentPeriodSets).toBe(0);
  });
  it('never exposes hours-since or a time of day', () => {
    const r = chestOf([anchor(), chest(-2, 2)]) as unknown as Record<string, unknown>;
    expect(Object.keys(r).filter((k) => /hour|time(?!s)/i.test(k))).toEqual([]);
  });
});

describe('regions, exercises and unmapped work', () => {
  it('attributes sets by the new resolver, not the old fallback (calf raises are not Chest)', () => {
    const s = run([
      anchor(),
      mkSession(day(-2), [
        mkEx('Standing Calf Raise', 'General', 4),
        mkEx('Cable Lateral Raise', 'General', 3),
        mkEx('Romanian Deadlift (RDL)', 'General', 2),
      ]),
    ]);
    expect(s.regions.calves.currentPeriodSets).toBe(4);
    expect(s.regions.shoulders.currentPeriodSets).toBe(3);
    expect(s.regions.hamstrings_glutes.currentPeriodSets).toBe(2);
    expect(s.regions.chest.currentPeriodSets).toBe(0);
    expect(s.regions.back.currentPeriodSets).toBe(0);
  });

  it('counts unmapped work separately and attributes it to no region', () => {
    const s = run([
      anchor(),
      mkSession(day(-2), [mkEx('Burpees', 'General', 5), mkEx('Conventional Barbell Deadlift', '', 3), mkEx('Barbell Bench Press', 'Chest', 2)]),
      mkSession(day(-12), [mkEx('Burpees', 'General', 4)]),
    ]);
    expect(s.unmapped).toEqual({ currentPeriodSets: 8, baselinePeriodSets: 4, exerciseNames: ['Burpees', 'Conventional Barbell Deadlift'] });
    const attributed = MUSCLE_REGION_IDS.reduce((n, id) => n + s.regions[id].currentPeriodSets, 0);
    expect(attributed).toBe(2);
  });

  it('does not count unmapped sets that fall outside both windows', () => {
    const s = run([anchor(), mkSession(day(-50), [mkEx('Burpees', 'General', 5)])]);
    expect(s.unmapped).toEqual({ currentPeriodSets: 0, baselinePeriodSets: 0, exerciseNames: [] });
  });

  it('lists recent exercises distinct (case-insensitive), most recent first, with session counts', () => {
    const s = run([
      anchor(),
      mkSession(day(-5), [mkEx('Barbell Bench Press', 'Chest', 3)]),
      mkSession(day(-2), [mkEx('Incline Dumbbell Press', 'Chest', 3)]),
      mkSession(day(-3), [mkEx('barbell bench press', 'Chest', 3)]),
      mkSession(day(-12), [mkEx('Cable Fly', 'Chest', 3)]), // baseline, not "recent"
    ]);
    expect(s.regions.chest.recentExercises).toEqual(['Incline Dumbbell Press', 'barbell bench press']);
    expect(s.regions.chest.currentPeriodSessions).toBe(3);
    expect(s.regions.chest.currentPeriodSets).toBe(9);
  });

  it('counts a session once per region even if the region appears in several exercises', () => {
    const s = run([anchor(), mkSession(day(-2), [mkEx('Barbell Bench Press', 'Chest', 2), mkEx('Incline Dumbbell Press', 'Chest', 2)])]);
    expect(s.regions.chest).toMatchObject({ currentPeriodSets: 4, currentPeriodSessions: 1 });
  });

  it('always returns all eight regions with the same shape', () => {
    const s = run([]);
    expect(Object.keys(s.regions).sort()).toEqual([...MUSCLE_REGION_IDS].sort());
    for (const id of MUSCLE_REGION_IDS) expect(s.regions[id].regionId).toBe(id);
  });
});

describe('determinism and purity', () => {
  const fixture = () => [
    anchor(),
    ...baseline([5, 6, 7, 8]),
    chest(-2, 6),
    mkSession(day(-4), [mkEx('Standing Calf Raise', 'Calves', 3), mkEx('Burpees', 'General', 2)]),
  ];

  it('returns identical results for identical input, regardless of input order', () => {
    const a = fixture();
    const first = run(a);
    expect(run(a)).toEqual(first);
    expect(run([...a].reverse())).toEqual(first);
  });

  it('does not mutate its input', () => {
    const a = fixture();
    const snapshot = JSON.stringify(a);
    run(a);
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('depends only on the `now` argument, never on the wall clock', () => {
    const a = fixture();
    const expected = run(a);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2031, 0, 1));
    expect(run(a)).toEqual(expected);
    vi.setSystemTime(new Date(2001, 5, 5));
    expect(run(a)).toEqual(expected);
  });

  it('moves the windows when `now` moves', () => {
    const a = [anchor(), chest(-2, 4)];
    expect(buildMuscleMapSummary(a, NOW).regions.chest.currentPeriodSets).toBe(4);
    const later = new Date(2026, 10, 3, 9, 0); // 9 days later: the session is now baseline, not current
    expect(buildMuscleMapSummary(a, later).regions.chest.currentPeriodSets).toBe(0);
  });

  it('rejects an invalid `now` instead of guessing', () => {
    expect(() => buildMuscleMapSummary([], new Date('nope'))).toThrow(RangeError);
  });
});

describe('text helpers and wording', () => {
  const summary = (over: Partial<RegionTrainingSummary>): RegionTrainingSummary => ({
    regionId: 'chest', status: 'typical', currentPeriodSets: 7, currentPeriodSessions: 2, baselineWeeklyAverage: 5.5, baselineWeeksUsed: 4,
    ratio: 7 / 5.5, lastTrainedDay: day(-2), lastTrainedDayPrecision: 'start-time', setsToday: 0, recentExercises: [], ...over,
  });

  it('formats the summary line from real values', () => {
    expect(formatLoadSummary(summary({}))).toBe('7 working sets in the last 7 days · usual weekly average: 5.5 sets');
    expect(formatLoadSummary(summary({ currentPeriodSets: 1, baselineWeeklyAverage: 1 }))).toBe('1 working set in the last 7 days · usual weekly average: 1 set');
    expect(formatLoadSummary(summary({ currentPeriodSets: 0, baselineWeeklyAverage: 4 }))).toBe('0 working sets in the last 7 days · usual weekly average: 4 sets');
    expect(formatLoadSummary(summary({ baselineWeeklyAverage: null }))).toBe('7 working sets in the last 7 days');
  });

  it('zero baseline never prints "usual weekly average: 0 sets"; it still shows the real counts', () => {
    expect(formatLoadSummary(summary({ status: 'no_baseline', currentPeriodSets: 3, baselineWeeklyAverage: 0, baselineWeeksUsed: 4 }))).toBe(
      '3 working sets in the last 7 days · none logged in the previous 4 weeks'
    );
    expect(formatLoadSummary(summary({ status: 'no_baseline', currentPeriodSets: 1, baselineWeeklyAverage: 0, baselineWeeksUsed: 1 }))).toBe(
      '1 working set in the last 7 days · none logged in the previous week'
    );
    expect(formatLoadSummary(summary({ currentPeriodSets: 0, baselineWeeklyAverage: 0, baselineWeeksUsed: 3 }))).toBe(
      '0 working sets in the last 7 days · none logged in the previous 3 weeks'
    );
  });

  it('formats averages to at most one decimal', () => {
    expect(formatAverage(4)).toBe('4');
    expect(formatAverage(5.5)).toBe('5.5');
    expect(formatAverage(2.3333)).toBe('2.3');
    expect(formatAverage(0)).toBe('0');
  });

  it('uses the specified labels and avoids physiological-recovery wording', () => {
    expect(LOAD_STATUS_LABELS).toEqual({
      insufficient_data: 'Insufficient data',
      no_recent_work: 'No recent work',
      no_baseline: 'No historical baseline',
      lighter: 'Lighter than usual',
      typical: 'Typical',
      heavier: 'Heavier than usual',
    });
    const forbidden = /recovered|fatigue|fresh|heal|injur|damage|risk|sore|rest day/i;
    for (const label of Object.values(LOAD_STATUS_LABELS)) expect(label).not.toMatch(forbidden);
  });

  it('carries the required disclaimer verbatim', () => {
    expect(LOAD_DISCLAIMER).toBe('Training load compares your logged workout volume. It does not measure muscle recovery or diagnose injury.');
  });
});
