import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggedExercise, LoggedSet, SetType, WorkoutPlan, WorkoutSession } from '../types';
import { calculateLocalRecoveryInsights, inferMuscleGroup } from './recoveryAnalytics';

/**
 * CHARACTERIZATION TESTS.
 *
 * These pin what recoveryAnalytics.ts does TODAY so that later work (the Muscle Map feature)
 * can prove it did not change it. They do not endorse the behaviour. Anything marked
 * "KNOWN DEFECT" is pinned as-is on purpose; if one of these fails after an unrelated change,
 * that change altered existing recovery / Coach Iron behaviour and needs a deliberate decision.
 */

// 2026-10-25 is a Sunday. The function reads the wall clock internally, so time is faked.
const SUNDAY = '2026-10-25T10:00:00.000Z';
const profile = { trainingDaysPerWeek: 4, dailyProteinTarget: 165 } as Parameters<typeof calculateLocalRecoveryInsights>[1];

const setsOf = (n: number, over: Partial<LoggedSet> = {}): LoggedSet[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, setNumber: i + 1, type: 'working' as SetType, weight: 100, reps: 10, completed: true, timestamp: '', ...over
  }));

const exercise = (name: string, muscleGroup: string, sets: LoggedSet[]): LoggedExercise => ({
  id: `e-${name}`, name, muscleGroup, equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90, sets
});

const session = (id: string, date: string, exercises: LoggedExercise[], over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, dayName: 'Day', date, startTime: '', status: 'completed', exercises, ...over
});

const bench = (n: number) => exercise('Barbell Bench Press', 'Chest', setsOf(n));

const run = (now: string, sessions: WorkoutSession[], plan: WorkoutPlan | null = null) => {
  vi.setSystemTime(new Date(now));
  return calculateLocalRecoveryInsights(sessions, profile, plan);
};
const group = (r: ReturnType<typeof run>, name: string) => r.muscleRecovery.find((m) => m.muscleGroup === name)!;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(SUNDAY)); });
afterEach(() => { vi.useRealTimers(); });

describe('characterization: inferMuscleGroup', () => {
  it('maps explicit labels used by starter plans and the add-exercise dropdown', () => {
    const cases: Array<[string, string]> = [
      ['Chest', 'Chest'],
      ['Back', 'Back / Lats'],
      ['Shoulders', 'Shoulders'],
      ['Arms', 'Arms (Biceps & Triceps)'],
      ['Biceps', 'Arms (Biceps & Triceps)'],
      ['Triceps', 'Arms (Biceps & Triceps)'],
      ['Quads', 'Quads'],
      ['Hamstrings', 'Hamstrings & Glutes'],
      ['Glutes', 'Hamstrings & Glutes'],
      ['Abs', 'Core & Lower Back'],
      ['Core', 'Core & Lower Back']
    ];
    for (const [label, expected] of cases) expect(inferMuscleGroup('anything', label)).toBe(expected);
  });

  it('passes an explicit "Calves" label through unchanged, which is not one of the 7 tracked groups', () => {
    expect(inferMuscleGroup('Standing Calf Raise', 'Calves')).toBe('Calves');
  });

  it('is case-insensitive and tolerant of surrounding whitespace for explicit labels', () => {
    expect(inferMuscleGroup('x', 'CHEST')).toBe('Chest');
    expect(inferMuscleGroup('x', '  chest  ')).toBe('Chest');
  });

  it('prefers a usable explicit label over the exercise name', () => {
    // Name alone would give Chest; the explicit label wins.
    expect(inferMuscleGroup('Dips (Chest / Triceps)', 'Arms')).toBe('Arms (Biceps & Triceps)');
    expect(inferMuscleGroup('Dips (Chest / Triceps)')).toBe('Chest');
  });

  it('ignores "General", empty and whitespace-only labels and falls back to the name', () => {
    for (const label of ['General', '', '   ', undefined]) {
      expect(inferMuscleGroup('Barbell Bench Press', label)).toBe('Chest');
    }
    expect(inferMuscleGroup('Lat Pulldown', 'General')).toBe('Back / Lats');
  });

  it('returns an unrecognised explicit label unchanged', () => {
    expect(inferMuscleGroup('x', 'Neck')).toBe('Neck');
    expect(inferMuscleGroup('x', 'calf')).toBe('calf');
  });

  it('maps common exercise names when no label is given', () => {
    const cases: Array<[string, string]> = [
      ['Barbell Bench Press', 'Chest'],
      ['BENCH PRESS', 'Chest'],
      ['  Barbell Bench Press  ', 'Chest'],
      ['Pec Deck', 'Chest'],
      ['Push-Up', 'Chest'],
      ['Dumbbell Fly', 'Chest'],
      ['Incline Cable Flye', 'Chest'],
      ['Incline Dumbbell Press', 'Chest'],
      ['Lat Pulldown', 'Back / Lats'],
      ['Seated Cable Row', 'Back / Lats'],
      ['Chest Supported Dumbbell Row', 'Back / Lats'],
      ['Weighted Pull-Up', 'Back / Lats'],
      ['Chin-Up', 'Back / Lats'],
      ['Barbell Shrug', 'Back / Lats'],
      ['Conventional Barbell Deadlift', 'Back / Lats'],
      ['Barbell Back Squat', 'Quads'],
      ['Hack Squat', 'Quads'],
      ['Walking Lunge', 'Quads'],
      ['Leg Press', 'Quads'],
      ['Leg Extension', 'Quads'],
      ['Bulgarian Split Squat', 'Quads'],
      ['Lying Leg Curl', 'Hamstrings & Glutes'],
      ['Leg Curl', 'Hamstrings & Glutes'],
      ['Hip Thrust', 'Hamstrings & Glutes'],
      ['Glute Bridge', 'Hamstrings & Glutes'],
      ['Standing Overhead Barbell Press', 'Shoulders'],
      ['Overhead Press', 'Shoulders'],
      ['Arnold Press', 'Shoulders'],
      ['Military Press', 'Shoulders'],
      ['Dumbbell Seated Shoulder Press', 'Shoulders'],
      ['Barbell Bicep Curl', 'Arms (Biceps & Triceps)'],
      ['Hammer Curl', 'Arms (Biceps & Triceps)'],
      ['Preacher Curl', 'Arms (Biceps & Triceps)'],
      ['Triceps Rope Pushdown', 'Arms (Biceps & Triceps)'],
      ['Tricep Pushdown', 'Arms (Biceps & Triceps)'],
      ['Skull Crusher', 'Arms (Biceps & Triceps)'],
      ['Plank', 'Core & Lower Back'],
      ['Crunch', 'Core & Lower Back'],
      ['Hanging Leg Raise', 'Core & Lower Back'],
      ['Hyperextension', 'Core & Lower Back']
    ];
    for (const [name, expected] of cases) expect(inferMuscleGroup(name)).toBe(expected);
  });

  it('KNOWN DEFECT (pinned): unrecognised names fall back to Chest', () => {
    for (const name of ['Treadmill', 'Farmer Carry', 'Face Pull', 'Reverse Fly', 'Back Extension', '']) {
      expect(inferMuscleGroup(name)).toBe('Chest');
    }
  });

  it('KNOWN DEFECT (pinned): calf raises with no label fall back to Chest', () => {
    expect(inferMuscleGroup('Standing Calf Raise')).toBe('Chest');
    expect(inferMuscleGroup('Seated Calf Raise')).toBe('Chest');
  });

  it('KNOWN DEFECT (pinned): broad substring rules misclassify some exercises by name', () => {
    expect(inferMuscleGroup('Cable Lateral Raise')).toBe('Back / Lats'); // "lat" inside "lateral"
    expect(inferMuscleGroup('Romanian Deadlift (RDL)')).toBe('Back / Lats'); // "deadlift" is checked before "romanian"
    expect(inferMuscleGroup('Overhead Tricep Extension')).toBe('Shoulders'); // "overhead"
    expect(inferMuscleGroup('Nordic Hamstring Curl')).toBe('Arms (Biceps & Triceps)'); // "curl"
    expect(inferMuscleGroup('Cable Crossover')).toBe('Core & Lower Back'); // "ab" inside "cable"
    expect(inferMuscleGroup('Hip Abduction Machine')).toBe('Core & Lower Back'); // "ab" inside "abduction"
  });

  it('KNOWN DEFECT (pinned): some explicit labels are matched by an earlier, broader rule', () => {
    expect(inferMuscleGroup('x', 'Lower Back')).toBe('Back / Lats'); // "back" is checked before "lower back"
    expect(inferMuscleGroup('x', 'Lateral Deltoid')).toBe('Back / Lats'); // "lat" is checked before "delt"
    expect(inferMuscleGroup('x', 'Abductors')).toBe('Core & Lower Back'); // "ab"
  });
});

describe('characterization: calculateLocalRecoveryInsights, empty history', () => {
  it('returns exactly 7 tracked groups, each reported as 100% "fresh" with no hours-since', () => {
    const r = run(SUNDAY, []);
    expect(r.muscleRecovery.map((m) => m.muscleGroup)).toEqual([
      'Chest', 'Back / Lats', 'Quads', 'Hamstrings & Glutes', 'Shoulders', 'Arms (Biceps & Triceps)', 'Core & Lower Back'
    ]);
    for (const m of r.muscleRecovery) {
      expect(m).toEqual({
        muscleGroup: m.muscleGroup,
        recoveryPercentage: 100,
        status: 'fresh',
        hoursSinceLastTrained: undefined,
        totalSetsLast7Days: 0,
        recoveryTrend: 'stable',
        recoveryHoursRemaining: 0,
        exercisesTrained: []
      });
    }
  });

  it('reports baseline systemic values and a rest day on a Sunday', () => {
    const r = run(SUNDAY, []);
    expect(r.systemicFatigueScore).toBe(20);
    expect(r.systemicFatigueLevel).toBe('Low');
    expect(r.overallReadiness).toBe(86);
    expect(r.headline).toBe('Muscle Recovery In Progress — Strategic Rest Day Recommended');
    expect(r.optimalRestDays.recommendedRestDays).toEqual(['Wednesday', 'Saturday', 'Sunday']);
    expect(r.optimalRestDays.isRestRecommendedToday).toBe(true);
    expect(r.optimalRestDays.todayAdvice).toBe(
      'Optimal Rest Day (Sunday) — Prioritize sleep, light active recovery walking, and 165g protein to consolidate muscle tissue adaptations.'
    );
    expect(r.suggestedNextWorkout).toBeUndefined();
    expect(r.recoveryTips).toHaveLength(3);
    expect(r.lastCalculated).toBe(SUNDAY);
  });

  it('reports "ready" advice on a non-rest weekday with no history', () => {
    const r = run('2026-10-26T10:00:00.000Z', []); // Monday
    expect(r.optimalRestDays.isRestRecommendedToday).toBe(false);
    expect(r.optimalRestDays.todayAdvice).toBe(
      'Readiness is 86% (Low fatigue) — Fully primed for a high-intensity session with progressive overload.'
    );
    expect(r.headline).toBe('Systemic Readiness at 86% — Primed for Performance');
  });

  it('is deterministic for identical input and clock', () => {
    const s = [session('a', '2026-10-24', [bench(4)])];
    expect(run(SUNDAY, s)).toEqual(run(SUNDAY, s));
  });
});

describe('characterization: per-muscle time-based recovery formula', () => {
  // hoursSince = (now - Date('YYYY-MM-DD') parsed as UTC midnight) in whole hours, minimum 1.
  // window = 48h, or 60h when sets in last 7 days > 6, or 72h when > 12.
  // percentage = round(min(1, hoursSince / window) * 100).
  // status: >= 85 fresh, >= 45 recovering, else fatigued.
  const chest = (now: string, date: string, sets: number) => group(run(now, [session('a', date, [bench(sets)])]), 'Chest');

  it('treats a session dated today as only hours old, using UTC midnight as its time', () => {
    expect(chest(SUNDAY, '2026-10-25', 4)).toMatchObject({
      recoveryPercentage: 21, status: 'fatigued', hoursSinceLastTrained: 10, recoveryHoursRemaining: 38,
      totalSetsLast7Days: 4, recoveryTrend: 'needs_rest', lastTrainedDate: '2026-10-25'
    });
  });

  it('reports a 1-day-old session as recovering and a 2-day-old session as fresh (48h window)', () => {
    expect(chest(SUNDAY, '2026-10-24', 4)).toMatchObject({
      recoveryPercentage: 71, status: 'recovering', hoursSinceLastTrained: 34, recoveryHoursRemaining: 14, recoveryTrend: 'improving'
    });
    expect(chest(SUNDAY, '2026-10-23', 4)).toMatchObject({
      recoveryPercentage: 100, status: 'fresh', hoursSinceLastTrained: 58, recoveryHoursRemaining: 0, recoveryTrend: 'stable'
    });
  });

  it('flips from "recovering" to "fresh" exactly at 85% (40h vs 41h on a 48h window)', () => {
    expect(chest('2026-10-25T16:00:00.000Z', '2026-10-24', 4)).toMatchObject({ hoursSinceLastTrained: 40, recoveryPercentage: 83, status: 'recovering' });
    expect(chest('2026-10-25T17:00:00.000Z', '2026-10-24', 4)).toMatchObject({ hoursSinceLastTrained: 41, recoveryPercentage: 85, status: 'fresh' });
  });

  it('flips from "fatigued" to "recovering" exactly at 45% (27h vs 26h on a 60h window; 22h vs 21h on a 48h window)', () => {
    expect(chest('2026-10-25T02:00:00.000Z', '2026-10-24', 7)).toMatchObject({ hoursSinceLastTrained: 26, recoveryPercentage: 43, status: 'fatigued' });
    expect(chest('2026-10-25T03:00:00.000Z', '2026-10-24', 7)).toMatchObject({ hoursSinceLastTrained: 27, recoveryPercentage: 45, status: 'recovering' });
    expect(chest('2026-10-24T21:00:00.000Z', '2026-10-24', 4)).toMatchObject({ hoursSinceLastTrained: 21, recoveryPercentage: 44, status: 'fatigued' });
    expect(chest('2026-10-24T22:00:00.000Z', '2026-10-24', 4)).toMatchObject({ hoursSinceLastTrained: 22, recoveryPercentage: 46, status: 'recovering' });
  });

  it('lengthens the window with recent volume: >6 sets uses 60h, >12 sets uses 72h', () => {
    expect(chest(SUNDAY, '2026-10-24', 6).recoveryPercentage).toBe(71); // 34/48
    expect(chest(SUNDAY, '2026-10-24', 7).recoveryPercentage).toBe(57); // 34/60
    expect(chest(SUNDAY, '2026-10-24', 12).recoveryPercentage).toBe(57); // 34/60
    expect(chest(SUNDAY, '2026-10-24', 13).recoveryPercentage).toBe(47); // 34/72
    expect(chest(SUNDAY, '2026-10-25', 13)).toMatchObject({ recoveryPercentage: 14, recoveryHoursRemaining: 62 });
  });

  it('calls a muscle "fresh" 100% with no hours-since when it has never been trained', () => {
    const r = run(SUNDAY, [session('a', '2026-10-24', [bench(4)])]);
    expect(group(r, 'Quads')).toMatchObject({ recoveryPercentage: 100, status: 'fresh', hoursSinceLastTrained: undefined, totalSetsLast7Days: 0 });
  });

  it('KNOWN LIMITATION (pinned): the 7-day cutoff is compared with the current clock time, so a session dated exactly 7 days ago is excluded', () => {
    const r = run(SUNDAY, [session('a', '2026-10-18', [bench(3)]), session('b', '2026-10-19', [bench(2)])]);
    expect(group(r, 'Chest').totalSetsLast7Days).toBe(2);
    expect(group(r, 'Chest').hoursSinceLastTrained).toBe(154);
    expect(r.optimalRestDays.rationale).toContain('1 sessions completed over the last 7 days');
  });

  it('keeps reporting an old session as 100% fresh with its full age in hours', () => {
    const c = chest(SUNDAY, '2026-08-01', 4);
    expect(c).toMatchObject({ recoveryPercentage: 100, status: 'fresh', hoursSinceLastTrained: 2050, totalSetsLast7Days: 0, lastTrainedDate: '2026-08-01' });
  });
});

describe('characterization: which sets and sessions are counted', () => {
  it('counts only completed, non-warmup sets; incomplete sets and warm-ups add nothing', () => {
    const ex = exercise('Barbell Bench Press', 'Chest', [
      ...setsOf(1, { type: 'warmup' }),
      ...setsOf(1, { completed: false }),
      ...setsOf(3)
    ]);
    expect(group(run(SUNDAY, [session('a', '2026-10-24', [ex])]), 'Chest').totalSetsLast7Days).toBe(3);
  });

  it('KNOWN DEFECT (pinned): the "skipped" flag is ignored when a set is also marked completed', () => {
    const ex = exercise('Barbell Bench Press', 'Chest', setsOf(1, { skipped: true }));
    expect(group(run(SUNDAY, [session('a', '2026-10-24', [ex])]), 'Chest').totalSetsLast7Days).toBe(1);
  });

  it('counts drop and failure sets, and bodyweight sets with zero weight, as sets', () => {
    const ex = exercise('Pull-Up', 'Back', [
      ...setsOf(1, { type: 'drop', weight: 0, reps: 8 }),
      ...setsOf(1, { type: 'failure', weight: 0, reps: 5 }),
      ...setsOf(1, { type: 'working', weight: 0, reps: 5 })
    ]);
    expect(group(run(SUNDAY, [session('a', '2026-10-24', [ex])]), 'Back / Lats')).toMatchObject({ totalSetsLast7Days: 3, recoveryPercentage: 71 });
  });

  it('ignores in-progress and abandoned sessions', () => {
    const r = run(SUNDAY, [
      session('a', '2026-10-24', [bench(4)], { status: 'in_progress' }),
      session('b', '2026-10-24', [bench(4)], { status: 'abandoned' })
    ]);
    expect(group(r, 'Chest')).toMatchObject({ recoveryPercentage: 100, totalSetsLast7Days: 0, exercisesTrained: [] });
  });

  it('KNOWN DEFECT (pinned): demo sessions are counted like real ones', () => {
    const r = run(SUNDAY, [session('a', '2026-10-24', [bench(4)], { isDemo: true })]);
    expect(group(r, 'Chest')).toMatchObject({ recoveryPercentage: 71, totalSetsLast7Days: 4 });
  });

  it('KNOWN DEFECT (pinned): exercisesTrained lists names from all completed history, not just the last 7 days', () => {
    const r = run(SUNDAY, [session('old', '2026-08-01', [bench(4)])]);
    expect(group(r, 'Chest').exercisesTrained).toEqual(['Barbell Bench Press']);
    expect(group(r, 'Chest').totalSetsLast7Days).toBe(0);
  });

  it('KNOWN DEFECT (pinned): an exercise with no usable label or name is credited to Chest', () => {
    const r = run(SUNDAY, [session('a', '2026-10-24', [exercise('Face Pull', '', setsOf(3))])]);
    expect(group(r, 'Chest')).toMatchObject({ totalSetsLast7Days: 3, exercisesTrained: ['Face Pull'], recoveryPercentage: 71 });
  });

  it('KNOWN DEFECT (pinned): Calves is not tracked, so calf work appears in no group', () => {
    const r = run(SUNDAY, [session('a', '2026-10-24', [exercise('Standing Calf Raise', 'Calves', setsOf(3))])]);
    expect(r.muscleRecovery.some((m) => m.muscleGroup === 'Calves')).toBe(false);
    expect(r.muscleRecovery.every((m) => m.totalSetsLast7Days === 0)).toBe(true);
  });

  it('merges glutes with hamstrings and biceps with triceps into single groups', () => {
    const r = run(SUNDAY, [
      session('a', '2026-10-24', [
        exercise('Hip Thrust', 'Glutes', setsOf(3)),
        exercise('Lying Leg Curl', 'Hamstrings', setsOf(3)),
        exercise('Barbell Bicep Curl', 'Biceps', setsOf(3)),
        exercise('Triceps Rope Pushdown', 'Triceps', setsOf(3))
      ])
    ]);
    expect(group(r, 'Hamstrings & Glutes')).toMatchObject({ totalSetsLast7Days: 6, exercisesTrained: ['Hip Thrust', 'Lying Leg Curl'] });
    expect(group(r, 'Arms (Biceps & Triceps)')).toMatchObject({ totalSetsLast7Days: 6, exercisesTrained: ['Barbell Bicep Curl', 'Triceps Rope Pushdown'] });
  });

  it('tolerates sessions with missing exercises or sets arrays', () => {
    const broken = [
      { id: 'x', status: 'completed', date: '2026-10-24', exercises: undefined },
      { id: 'y', status: 'completed', date: '2026-10-24', exercises: [{ name: 'Barbell Bench Press', muscleGroup: 'Chest', sets: undefined }] }
    ] as unknown as WorkoutSession[];
    const r = run(SUNDAY, broken);
    // No completed sets means the "never trained" early return, which drops the exercise name.
    expect(group(r, 'Chest')).toEqual({
      muscleGroup: 'Chest', recoveryPercentage: 100, status: 'fresh', hoursSinceLastTrained: undefined,
      totalSetsLast7Days: 0, recoveryTrend: 'stable', recoveryHoursRemaining: 0, exercisesTrained: []
    });
  });

  it('does not list an exercise that has no completed working sets', () => {
    const ex = exercise('Barbell Bench Press', 'Chest', [...setsOf(1, { type: 'warmup' }), ...setsOf(1, { completed: false })]);
    expect(group(run(SUNDAY, [session('a', '2026-10-24', [ex])]), 'Chest')).toMatchObject({ recoveryPercentage: 100, exercisesTrained: [] });
  });
});

describe('characterization: systemic fatigue and rest-day rules', () => {
  const TUESDAY = '2026-10-27T10:00:00.000Z';
  const day = (id: string, date: string, sets = 4) => session(id, date, [exercise('Barbell Bench Press', 'Chest', setsOf(sets))]);
  const sys = (sessions: WorkoutSession[]) => {
    const r = run(TUESDAY, sessions);
    return { score: r.systemicFatigueScore, level: r.systemicFatigueLevel, readiness: r.overallReadiness, rest: r.optimalRestDays.isRestRecommendedToday };
  };

  it('counts consecutive training days only if one of them is today', () => {
    expect(sys([day('a', '2026-10-27')])).toEqual({ score: 20, level: 'Low', readiness: 86, rest: false });
    expect(sys([day('a', '2026-10-27'), day('b', '2026-10-26')])).toEqual({ score: 40, level: 'Optimal', readiness: 72, rest: false });
    expect(sys([day('a', '2026-10-27'), day('b', '2026-10-26'), day('c', '2026-10-25')])).toEqual({ score: 55, level: 'Optimal', readiness: 62, rest: true });
    expect(sys([day('b', '2026-10-26')])).toEqual({ score: 20, level: 'Low', readiness: 86, rest: false }); // yesterday alone is not a streak
  });

  it('adds 10 points when 7-day volume (weight x reps) exceeds 15,000', () => {
    expect(sys([day('a', '2026-10-27', 8), day('b', '2026-10-26', 8)])).toMatchObject({ score: 50, readiness: 65 }); // 40 + 10
  });

  it('adds frequency points when sessions in 7 days reach the target days per week', () => {
    const four = [day('a', '2026-10-26'), day('b', '2026-10-24'), day('c', '2026-10-22'), day('d', '2026-10-21')];
    expect(sys(four)).toMatchObject({ score: 55, readiness: 62, rest: false }); // 20 + 25 (+10 volume)
  });

  it('caps at 100 / "High" and recommends rest', () => {
    const heavy = [day('a', '2026-10-27', 20), day('b', '2026-10-26', 20), day('c', '2026-10-25', 20), day('d', '2026-10-24', 20)];
    expect(sys(heavy)).toEqual({ score: 100, level: 'High', readiness: 30, rest: true });
  });

  it('recommends rest on the fixed rest days of a 4-day split regardless of history', () => {
    const wed = run('2026-10-28T10:00:00.000Z', []);
    expect(wed.optimalRestDays.isRestRecommendedToday).toBe(true);
    expect(wed.optimalRestDays.todayAdvice).toContain('Optimal Rest Day (Wednesday)');
  });
});

describe('characterization: suggestedNextWorkout', () => {
  const plan = {
    id: 'p', name: 'P', days: [
      { id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [{ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'Chest' }] },
      { id: 'd2', dayName: 'Legs', dayOrder: 2, exercises: [{ id: 'e2', name: 'Barbell Back Squat', muscleGroup: 'Quads' }] }
    ]
  } as unknown as WorkoutPlan;

  it('picks the plan day whose muscles have the highest recovery percentage', () => {
    const r = run(SUNDAY, [session('a', '2026-10-25', [bench(4)])], plan);
    expect(r.suggestedNextWorkout).toEqual({ splitDay: 'Legs', reasoning: 'Targeted muscles (Quads) average 100% recovery readiness.' });
  });

  it('keeps the first day on a tie', () => {
    expect(run(SUNDAY, [], plan).suggestedNextWorkout).toEqual({
      splitDay: 'Push', reasoning: 'Targeted muscles (Chest) average 100% recovery readiness.'
    });
  });

  it('returns no suggestion without an active plan or without plan days', () => {
    expect(run(SUNDAY, [], null).suggestedNextWorkout).toBeUndefined();
    expect(run(SUNDAY, [], { ...plan, days: [] } as WorkoutPlan).suggestedNextWorkout).toBeUndefined();
  });
});
