import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggedExercise, PlannedExercise, UserProfile, WorkoutPlan, WorkoutSession } from '../../types';
import { DEFAULT_PROFILE } from '../../storage/db';
import { buildCoachingContext } from './context';
import { generateAdaptiveReview } from './engine';

/**
 * CHARACTERIZATION TESTS (Muscle Map prerequisite).
 *
 * Coach Iron reads the existing local recovery analytics (recoveryAnalytics.ts) through
 * buildCoachingContext(...).recovery, and its rules engine reacts to that output. These tests pin
 * that dependency using the REAL recovery calculation (nothing is mocked except the clock), so any
 * later change to recovery output or muscle inference that would alter Coach Iron fails here.
 * The existing adaptiveCoach.test.ts is intentionally left untouched.
 */

const SUNDAY = '2026-10-25T10:00:00.000Z';
const MONDAY = '2026-10-26T10:00:00.000Z';
const profile: UserProfile = { ...DEFAULT_PROFILE, name: 'Test Athlete' };

const plannedEx = (id: string, name: string, over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  id, name, muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90, ...over
});

const plan: WorkoutPlan = {
  id: 'plan-1', name: 'Push Pull', trainingSplit: 'PP', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', isActive: true,
  days: [
    { id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [plannedEx('e1', 'Barbell Bench Press'), plannedEx('e2', 'Incline Dumbbell Press', { equipment: 'dumbbell' }), plannedEx('e3', 'Cable Fly', { equipment: 'cable' })] },
    { id: 'd2', dayName: 'Pull', dayOrder: 2, exercises: [plannedEx('e4', 'Barbell Row', { muscleGroup: 'Back' })] }
  ]
};

const daysBefore = (now: string, n: number) => new Date(new Date(now).getTime() - n * 86400000).toISOString().slice(0, 10);

// Logged under muscleGroup 'Chest' on purpose (same convention as adaptiveCoach.test.ts), so a recent
// session makes Chest the muscle that the existing model calls "fatigued" for the Push day.
const rowAsChest = (): LoggedExercise => ({
  id: 'l-row', name: 'Barbell Row', muscleGroup: 'Chest', equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
  sets: [{ id: 's0', setNumber: 1, type: 'working', weight: 60, reps: 10, completed: true, timestamp: '' }]
});
const session = (id: string, date: string, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, planId: 'plan-1', dayId: 'd2', dayName: 'd2', date, startTime: '', status: 'completed', exercises: [rowAsChest()], ...over
});

const build = (now: string, sessions: WorkoutSession[]) => {
  vi.setSystemTime(new Date(now));
  return buildCoachingContext({ profile, plans: [plan], activePlanId: 'plan-1', sessions, activeSession: null, sleepLogs: [], now: new Date(now) });
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(SUNDAY)); });
afterEach(() => { vi.useRealTimers(); });

describe('characterization: Coach Iron context.recovery (from existing recovery analytics)', () => {
  it('is unavailable, with no fatigued muscles, when there is no completed history', () => {
    expect(build(SUNDAY, []).recovery).toEqual({
      available: false, overallReadiness: null, fatigueLevel: null, restRecommendedToday: false, fatiguedMuscleGroups: []
    });
  });

  it('is unavailable when the only completed session is outside the 42-day lookback', () => {
    const ctx = build(SUNDAY, [session('old', daysBefore(SUNDAY, 50))]);
    expect(ctx.dataQuality.completedSessions).toBe(0);
    expect(ctx.recovery.available).toBe(false);
  });

  it('projects the existing model: today\'s Chest work is "fatigued" and Sunday is a fixed rest day', () => {
    expect(build(SUNDAY, [session('a', daysBefore(SUNDAY, 0))]).recovery).toEqual({
      available: true, overallReadiness: 86, fatigueLevel: 'Low', restRecommendedToday: true, fatiguedMuscleGroups: ['Chest']
    });
  });

  it('reports the same fatigued group but no rest recommendation on a non-rest day', () => {
    expect(build(MONDAY, [session('a', '2026-10-26')]).recovery).toEqual({
      available: true, overallReadiness: 86, fatigueLevel: 'Low', restRecommendedToday: false, fatiguedMuscleGroups: ['Chest']
    });
  });

  it('does not list a muscle as fatigued after one day (it is "recovering" at that point)', () => {
    expect(build(SUNDAY, [session('a', daysBefore(SUNDAY, 1))]).recovery.fatiguedMuscleGroups).toEqual([]);
  });

  it('lists a muscle as fatigued only below 45% recovery (26h vs 27h after a 7-set session)', () => {
    const sevenSets = (): LoggedExercise => ({ ...rowAsChest(), sets: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, setNumber: i + 1, type: 'working' as const, weight: 60, reps: 10, completed: true, timestamp: '' })) });
    const at = (iso: string) => build(iso, [session('a', '2026-10-24', { exercises: [sevenSets()] })]).recovery.fatiguedMuscleGroups;
    expect(at('2026-10-25T02:00:00.000Z')).toEqual(['Chest']);
    expect(at('2026-10-25T03:00:00.000Z')).toEqual([]);
  });

  it('KNOWN BEHAVIOUR (pinned): demo history makes recovery "available" and sets usesDemoData', () => {
    const ctx = build(SUNDAY, [session('demo', daysBefore(SUNDAY, 1), { isDemo: true })]);
    expect(ctx.recovery.available).toBe(true);
    expect(ctx.dataQuality.usesDemoData).toBe(true);
  });
});

describe('characterization: Coach Iron rules react to the real recovery output', () => {
  // Two earlier Pull-day sessions give the engine enough history for status "ok".
  const history = (now: string) => [session('a', daysBefore(now, 3)), session('b', daysBefore(now, 0), { date: now.slice(0, 10) })];

  it('recommends a lighter session when the rest-day signal and a fatigued Push-day muscle coincide (Sunday)', () => {
    const review = generateAdaptiveReview(build(SUNDAY, history(SUNDAY)));
    expect(review.status).toBe('ok');
    expect(review.verdict).toBe('lighter_session');
    expect(review.adjustments.map((a) => [a.kind, a.exerciseId, a.from, a.to])).toEqual([
      ['reduce_sets', 'e3', 3, 2],
      ['reduce_sets', 'e2', 3, 2]
    ]);
    expect(review.evidence.map((e) => e.detail)).toEqual([
      'Systemic fatigue is Low (readiness 86%); the recovery model recommends rest today.',
      'Still fatigued from recent training: Chest.'
    ]);
  });

  it('keeps the plan on a non-rest day because only one recovery signal remains (Monday)', () => {
    const review = generateAdaptiveReview(build(MONDAY, history(MONDAY)));
    expect(review.status).toBe('ok');
    expect(review.verdict).toBe('follow_plan');
    expect(review.adjustments).toHaveLength(0);
    expect(review.caveats).toContain('One recovery signal alone is not enough to change your session, so the plan stays as written.');
  });
});
