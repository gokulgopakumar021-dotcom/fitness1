import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DailySleepLog,
  LoggedExercise,
  PlannedExercise,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { DEFAULT_PROFILE } from '../../storage/db';
import { buildCoachingContext, pickTargetDayId } from './context';
import { generateAdaptiveReview } from './engine';
import { applyAcceptedReview, PlanStore } from './apply';
import { parseAiExplanation, validateCoachingContext, validateReviewForApply } from './validate';
import { requestAiExplanation } from './client';
import { AdaptiveReview } from './types';

const NOW = new Date('2026-10-25T10:00:00.000Z');
const profile: UserProfile = { ...DEFAULT_PROFILE, name: 'Private Name', currentWeightKg: 91.37, primaryGoal: 'muscle_gain', trainingExperience: 'intermediate' };

const ex = (id: string, name: string, over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  id, name, muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90, notes: 'my private note', ...over
});

const makePlan = (): WorkoutPlan => ({
  id: 'plan-1', name: 'Push Pull', trainingSplit: 'PP', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', isActive: true,
  days: [
    { id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [ex('e1', 'Barbell Bench Press'), ex('e2', 'Incline Dumbbell Press', { equipment: 'dumbbell' }), ex('e3', 'Cable Fly', { equipment: 'cable', workingSets: 3 })] },
    { id: 'd2', dayName: 'Pull', dayOrder: 2, exercises: [ex('e4', 'Barbell Row', { muscleGroup: 'Back' })] }
  ]
});

const dayAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

function logged(name: string, weight: number, reps: number[], opts: { rir?: number; completed?: boolean; equipment?: LoggedExercise['equipment'] } = {}): LoggedExercise {
  return {
    id: `l-${name}`, name, muscleGroup: 'Chest', equipment: opts.equipment ?? 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
    sets: reps.map((r, i) => ({ id: `s${i}`, setNumber: i + 1, type: 'working' as const, weight, reps: r, rir: opts.rir, completed: opts.completed ?? true, timestamp: '' }))
  };
}
function session(id: string, daysAgo: number, dayId: string, exercises: LoggedExercise[]): WorkoutSession {
  return { id, planId: 'plan-1', dayId, dayName: dayId, date: dayAgo(daysAgo), startTime: '', status: 'completed', exercises };
}
const build = (over: Partial<Parameters<typeof buildCoachingContext>[0]> = {}) =>
  buildCoachingContext({ profile, plans: [makePlan()], activePlanId: 'plan-1', sessions: [], activeSession: null, sleepLogs: [], now: NOW, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('buildCoachingContext', () => {
  it('uses only real stored data and excludes personal fields and notes', () => {
    const ctx = build({ sessions: [session('a', 5, 'd2', [logged('Barbell Bench Press', 80, [10, 9, 8])])] });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('Private Name');
    expect(json).not.toContain('my private note');
    expect(json).not.toContain('91.37');
    expect(ctx.exerciseHistory['Barbell Bench Press'].sessions[0]).toMatchObject({ topWeight: 80, completedSets: 3 });
    expect(ctx.exerciseHistory['Cable Fly']).toBeUndefined(); // never invented
  });

  it('picks the day after the last completed session, wrapping around', () => {
    const plan = makePlan();
    expect(pickTargetDayId(plan, [])).toBe('d1');
    expect(pickTargetDayId(plan, [session('a', 2, 'd1', [])])).toBe('d2');
    expect(pickTargetDayId(plan, [session('a', 2, 'd2', [])])).toBe('d1');
  });

  it('handles no plan and missing sleep gracefully', () => {
    const ctx = build({ plans: [], activePlanId: null });
    expect(ctx.plan).toBeNull();
    expect(ctx.sleep).toEqual({ nightsLogged: 0, avgHours: null, reliable: false });
    expect(ctx.recovery.available).toBe(false);
  });

  it('ignores demo sleep logs and old sessions', () => {
    const logs: DailySleepLog[] = [{ id: 's', date: dayAgo(1), hoursSlept: 4, quality: 50, isDemo: true }];
    const ctx = build({ sleepLogs: logs, sessions: [session('old', 90, 'd1', [logged('Barbell Bench Press', 80, [10])])] });
    expect(ctx.sleep.nightsLogged).toBe(0);
    expect(ctx.dataQuality.completedSessions).toBe(0);
  });

  it('reuses the existing progression engine output', () => {
    const sessions = [
      session('a', 9, 'd2', [logged('Barbell Bench Press', 80, [12, 12, 12])]),
      session('b', 4, 'd2', [logged('Barbell Bench Press', 80, [12, 12, 12])])
    ];
    const ctx = build({ sessions });
    expect(ctx.progression['Barbell Bench Press']).toBeDefined();
    expect(ctx.progression['Barbell Bench Press'].currentWeight).toBe(80);
  });
});

describe('generateAdaptiveReview', () => {
  it('asks for a plan when none exists', () => {
    const r = generateAdaptiveReview(build({ plans: [], activePlanId: null }));
    expect(r.status).toBe('no_plan');
    expect(r.adjustments).toHaveLength(0);
    expect(r.missingInfo.length).toBeGreaterThan(0);
  });

  it('reports insufficient data instead of inventing a recommendation', () => {
    const r = generateAdaptiveReview(build({ sessions: [session('a', 3, 'd1', [logged('Barbell Bench Press', 80, [10])])] }));
    expect(r.status).toBe('insufficient_data');
    expect(r.adjustments).toHaveLength(0);
  });

  it('treats very old history as insufficient', () => {
    const ctx = build();
    ctx.dataQuality = { ...ctx.dataQuality, completedSessions: 4, daysSinceLastSession: 40 };
    expect(generateAdaptiveReview(ctx).status).toBe('insufficient_data');
  });

  it('trims one set after a multi-session decline, citing evidence', () => {
    const sessions = [
      session('a', 12, 'd2', [logged('Barbell Bench Press', 80, [12, 12, 12])]),
      session('b', 8, 'd2', [logged('Barbell Bench Press', 80, [10, 10, 9])]),
      session('c', 4, 'd2', [logged('Barbell Bench Press', 80, [8, 7, 6])])
    ];
    const r = generateAdaptiveReview(build({ sessions }));
    const adj = r.adjustments.find((a) => a.exerciseId === 'e1');
    expect(adj).toMatchObject({ kind: 'reduce_sets', from: 3, to: 2 });
    expect(adj!.evidenceIds.length).toBeGreaterThan(0);
    expect(r.evidence.find((e) => e.id === adj!.evidenceIds[0])!.detail).toMatch(/→/);
    expect(r.notes.some((n) => /Hold 80 kg/.test(n.text))).toBe(true);
  });

  it('does not reduce training for one poor night of sleep', () => {
    const sessions = [session('a', 6, 'd2', [logged('Barbell Row', 60, [10])]), session('b', 3, 'd2', [logged('Barbell Row', 60, [10])])];
    const sleepLogs: DailySleepLog[] = [{ id: 'x', date: dayAgo(0), hoursSlept: 3.5, quality: 30 }];
    const r = generateAdaptiveReview(build({ sessions, sleepLogs }));
    expect(r.adjustments).toHaveLength(0);
    expect(r.verdict).toBe('follow_plan');
  });

  it('suggests a lighter session only with multiple independent signals', () => {
    const sessions = [session('a', 3, 'd2', [logged('Barbell Row', 60, [10])]), session('b', 1, 'd2', [logged('Barbell Row', 60, [10])])];
    const sleepLogs: DailySleepLog[] = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, date: dayAgo(n), hoursSlept: 5, quality: 40 }));
    const ctx = build({ sessions, sleepLogs });
    ctx.recovery = { ...ctx.recovery, available: true, restRecommendedToday: true, fatigueLevel: 'High', overallReadiness: 40 };
    const r = generateAdaptiveReview(ctx);
    expect(r.verdict).toBe('lighter_session');
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.adjustments.length).toBeLessThanOrEqual(2);
    expect(r.adjustments.every((a) => a.kind === 'reduce_sets' && a.to >= 2)).toBe(true);
    expect(r.adjustments[0].exerciseId).not.toBe('e1'); // main lift left alone
  });

  it('adds rest only after repeated near-failure sets with short rest', () => {
    const sessions = [
      session('a', 6, 'd2', [logged('Barbell Bench Press', 80, [10, 9, 8], { rir: 0 })]),
      session('b', 3, 'd2', [logged('Barbell Bench Press', 80, [10, 9, 8], { rir: 0 })])
    ];
    const r = generateAdaptiveReview(build({ sessions }));
    expect(r.adjustments.find((a) => a.kind === 'increase_rest')).toMatchObject({ exerciseId: 'e1', from: 90, to: 120 });
  });

  it('substitutes from exercises the athlete already has, only with logged equipment', () => {
    const plan = makePlan();
    plan.days[1].exercises.push(ex('e5', 'Dumbbell Bench Press', { equipment: 'dumbbell' }));
    const sessions = [
      session('a', 9, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' }), logged('Dumbbell Bench Press', 30, [10], { equipment: 'dumbbell' })]),
      session('b', 6, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' })]),
      session('c', 3, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' })])
    ];
    const r = generateAdaptiveReview(build({ plans: [plan], sessions }));
    const sub = r.adjustments.find((a) => a.kind === 'substitute_exercise');
    expect(sub).toMatchObject({ exerciseId: 'e3', to: 'Dumbbell Bench Press' });
  });

  it('is deterministic for the same context', () => {
    const sessions = [session('a', 6, 'd2', [logged('Barbell Row', 60, [10])]), session('b', 3, 'd2', [logged('Barbell Row', 60, [10])])];
    const ctx = build({ sessions });
    expect(generateAdaptiveReview(ctx)).toEqual(generateAdaptiveReview(ctx));
  });

  it('warns that an active session will not be modified', () => {
    const sessions = [session('a', 6, 'd2', [logged('Barbell Row', 60, [10])]), session('b', 3, 'd2', [logged('Barbell Row', 60, [10])])];
    const active: WorkoutSession = { ...session('act', 0, 'd1', []), status: 'in_progress' };
    const r = generateAdaptiveReview(build({ sessions, activeSession: active }));
    expect(r.caveats.join(' ')).toMatch(/in progress/i);
  });
});

function declineSetup() {
  const sessions = [
    session('a', 12, 'd2', [logged('Barbell Bench Press', 80, [12, 12, 12])]),
    session('b', 8, 'd2', [logged('Barbell Bench Press', 80, [10, 10, 9])]),
    session('c', 4, 'd2', [logged('Barbell Bench Press', 80, [8, 7, 6])])
  ];
  const plan = makePlan();
  const review = generateAdaptiveReview(build({ plans: [plan], sessions }));
  return { plan, review, sessions };
}

function memoryStore(plans: WorkoutPlan[], failWrites = false): PlanStore & { plans: WorkoutPlan[]; writes: number } {
  const s = {
    plans: JSON.parse(JSON.stringify(plans)) as WorkoutPlan[],
    writes: 0,
    getPlans() { return JSON.parse(JSON.stringify(this.plans)); },
    savePlans(p: WorkoutPlan[]) { this.writes++; if (!failWrites) this.plans = JSON.parse(JSON.stringify(p)); }
  };
  return s;
}

describe('applyAcceptedReview', () => {
  it('applies only selected changes and preserves everything else', () => {
    const { plan, review } = declineSetup();
    const other: WorkoutPlan = { ...makePlan(), id: 'plan-2', name: 'Other' };
    const store = memoryStore([plan, other]);
    const before = JSON.parse(JSON.stringify(store.plans));
    const res = applyAcceptedReview(review, review.adjustments.map((a) => a.id), store, () => NOW);
    expect(res.ok).toBe(true);
    const after = store.plans.find((p) => p.id === 'plan-1')!;
    expect(after.days[0].exercises[0].workingSets).toBe(2);
    expect(after.days[0].exercises[0].notes).toBe('my private note');
    expect(after.days[0].exercises[1]).toEqual(before[0].days[0].exercises[1]);
    expect(after.days[1]).toEqual(before[0].days[1]);
    expect(store.plans.find((p) => p.id === 'plan-2')).toEqual(before[1]);
    expect(after.updatedAt).not.toBe(before[0].updatedAt);
  });

  it('does nothing for an unselected adjustment', () => {
    const { plan, review } = declineSetup();
    const store = memoryStore([plan]);
    const res = applyAcceptedReview(review, [], store, () => NOW);
    expect(res).toMatchObject({ ok: false, reason: 'nothing_selected' });
    expect(store.writes).toBe(0);
  });

  it('blocks duplicate submissions without changing the plan again', () => {
    const { plan, review } = declineSetup();
    const store = memoryStore([plan]);
    const ids = review.adjustments.map((a) => a.id);
    expect(applyAcceptedReview(review, ids, store, () => NOW).ok).toBe(true);
    const writes = store.writes;
    const second = applyAcceptedReview(review, ids, store, () => NOW);
    expect(second).toMatchObject({ ok: false, reason: 'already_applied' });
    expect(store.writes).toBe(writes);
    expect(store.plans[0].days[0].exercises[0].workingSets).toBe(2); // not 1
  });

  it('rejects a stale review when the plan changed after it was made', () => {
    const { plan, review } = declineSetup();
    const edited = { ...plan, updatedAt: '2026-10-24T00:00:00.000Z' };
    edited.days[0].exercises[0].workingSets = 5;
    const store = memoryStore([edited]);
    const res = applyAcceptedReview(review, review.adjustments.map((a) => a.id), store, () => NOW);
    expect(res).toMatchObject({ ok: false, reason: 'stale' });
    expect(store.plans[0].days[0].exercises[0].workingSets).toBe(5);
  });

  it('reports a failed save and leaves the plan unchanged', () => {
    const { plan, review } = declineSetup();
    const store = memoryStore([plan], true);
    const res = applyAcceptedReview(review, review.adjustments.map((a) => a.id), store, () => NOW);
    expect(res).toMatchObject({ ok: false, reason: 'save_failed' });
    expect(store.plans[0].days[0].exercises[0].workingSets).toBe(3);
  });

  it('applies a substitution while keeping the slot and clearing stale form notes', () => {
    const plan = makePlan();
    plan.days[1].exercises.push(ex('e5', 'Dumbbell Bench Press', { equipment: 'dumbbell' }));
    const sessions = [
      session('a', 9, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' }), logged('Dumbbell Bench Press', 30, [10], { equipment: 'dumbbell' })]),
      session('b', 6, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' })]),
      session('c', 3, 'd2', [logged('Cable Fly', 20, [10], { completed: false, equipment: 'cable' })])
    ];
    const review = generateAdaptiveReview(build({ plans: [plan], sessions }));
    const store = memoryStore([plan]);
    const id = review.adjustments.find((a) => a.kind === 'substitute_exercise')!.id;
    expect(applyAcceptedReview(review, [id], store, () => NOW).ok).toBe(true);
    const swapped = store.plans[0].days[0].exercises[2];
    expect(swapped).toMatchObject({ id: 'e3', name: 'Dumbbell Bench Press', equipment: 'dumbbell', workingSets: 3, restSeconds: 90 });
    expect(swapped.notes).toBeUndefined();
  });
});

describe('validateReviewForApply safety constraints', () => {
  const tampered = (mut: (r: AdaptiveReview) => void) => {
    const { plan, review } = declineSetup();
    const copy: AdaptiveReview = JSON.parse(JSON.stringify(review));
    mut(copy);
    return validateReviewForApply(copy, plan, copy.adjustments.map((a) => a.id));
  };
  it('rejects cutting more than one set or going below the floor', () => {
    expect(tampered((r) => { (r.adjustments[0] as any).to = 1; }).ok).toBe(false);
  });
  it('rejects rest above the cap', () => {
    const { plan } = declineSetup();
    const r: AdaptiveReview = { ...declineSetup().review, adjustments: [{ id: 'e1:restSeconds', kind: 'increase_rest', exerciseId: 'e1', exerciseName: 'x', from: 90, to: 400, reason: '', evidenceIds: [] }] };
    expect(validateReviewForApply(r, plan, ['e1:restSeconds']).ok).toBe(false);
  });
  it('rejects substitutes for a different muscle group', () => {
    const { plan } = declineSetup();
    const r: AdaptiveReview = { ...declineSetup().review, adjustments: [{ id: 'e1:substitute', kind: 'substitute_exercise', exerciseId: 'e1', exerciseName: 'Barbell Bench Press', from: 'Barbell Bench Press', to: 'Barbell Squat', substitute: { name: 'Barbell Squat', muscleGroup: 'Quads', equipment: 'barbell' }, reason: '', evidenceIds: [] }] };
    expect(validateReviewForApply(r, plan, ['e1:substitute']).ok).toBe(false);
  });
  it('rejects adjustments for exercises that are not in the reviewed day', () => {
    expect(tampered((r) => { (r.adjustments[0] as any).exerciseId = 'nope'; }).ok).toBe(false);
  });
});

describe('AI boundary', () => {
  const review = () => declineSetup().review;

  it('accepts clean wording tied to known adjustment ids', () => {
    const r = review();
    const id = r.adjustments[0].id;
    const out = parseAiExplanation({ summary: 'One small trim to help recovery.', explanations: [{ id, text: 'Dropping to 2 sets lets you recover.' }, { id: 'ghost', text: 'ignored' }] }, r);
    expect(out?.byAdjustmentId).toEqual({ [id]: 'Dropping to 2 sets lets you recover.' });
  });

  it('rejects text that invents numbers', () => {
    const r = review();
    const id = r.adjustments[0].id;
    expect(parseAiExplanation({ summary: 'You should add 15 kg next week.', explanations: [{ id, text: 'Your bench is 140 kg.' }] }, r)).toBeNull();
  });

  it('returns null for malformed output', () => {
    const r = review();
    for (const bad of [null, 'text', 42, [], { summary: 5, explanations: 'x' }, { explanations: [{ id: 3 }] }]) {
      expect(parseAiExplanation(bad, r)).toBeNull();
    }
  });

  it('validates the request context at the boundary', () => {
    expect(validateCoachingContext(build()).ok).toBe(true);
    expect(validateCoachingContext(null).ok).toBe(false);
    expect(validateCoachingContext({ generatedAt: 'x' }).ok).toBe(false);
    expect(validateCoachingContext({ ...build(), knownExercises: 'no' }).ok).toBe(false);
  });

  const jsonRes = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
  it('maps service failures to explicit unavailable outcomes', async () => {
    const r = review();
    const ctx = build();
    expect(await requestAiExplanation(ctx, r, (async () => { throw new Error('boom'); }) as any)).toEqual({ kind: 'unavailable', reason: 'network' });
    expect(await requestAiExplanation(ctx, r, (async () => jsonRes({ success: false }, false)) as any)).toMatchObject({ kind: 'unavailable', reason: 'service_error' });
    expect(await requestAiExplanation(ctx, r, (async () => jsonRes({ success: true, aiAvailable: false, reason: 'not_configured' })) as any)).toEqual({ kind: 'unavailable', reason: 'not_configured' });
    expect(await requestAiExplanation(ctx, r, (async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })) as any)).toMatchObject({ kind: 'unavailable', reason: 'service_error' });
  });

  it('ignores AI wording written for a different review', async () => {
    const r = review();
    const res = await requestAiExplanation(build(), r, (async () => jsonRes({ success: true, aiAvailable: true, fingerprint: 'other', explanation: { summary: 's', byAdjustmentId: {} } })) as any);
    expect(res).toMatchObject({ kind: 'unavailable' });
  });
});
