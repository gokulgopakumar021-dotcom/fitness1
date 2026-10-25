import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveReviewDeps, AdaptiveReviewModal } from './AdaptiveReviewModal';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { LoggedExercise, WorkoutPlan, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-10-25T10:00:00.000Z');
const dayAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

const plan = (): WorkoutPlan => ({
  id: 'p1', name: 'Plan', trainingSplit: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', isActive: true,
  days: [
    { id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [{ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90 }] },
    { id: 'd2', dayName: 'Pull', dayOrder: 2, exercises: [{ id: 'e2', name: 'Barbell Row', muscleGroup: 'Back', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90 }] }
  ]
});
const lg = (reps: number[]): LoggedExercise => ({
  id: 'l', name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
  sets: reps.map((r, i) => ({ id: `s${i}`, setNumber: i + 1, type: 'working' as const, weight: 80, reps: r, completed: true, timestamp: '' }))
});
const sess = (id: string, d: number, ex: LoggedExercise[]): WorkoutSession => ({ id, planId: 'p1', dayId: 'd2', dayName: 'Pull', date: dayAgo(d), startTime: '', status: 'completed', exercises: ex });
const decline = () => [sess('a', 12, [lg([12, 12, 12])]), sess('b', 8, [lg([10, 10, 9])]), sess('c', 4, [lg([8, 7, 6])])];

let container: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.body.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => { await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };

function makeDeps(opts: { plans?: WorkoutPlan[]; sessions?: WorkoutSession[]; failSave?: boolean; explain?: AdaptiveReviewDeps['explain'] } = {}) {
  const state = { plans: opts.plans ?? [plan()], writes: 0 };
  const deps: AdaptiveReviewDeps = {
    load: () => ({ plans: JSON.parse(JSON.stringify(state.plans)), activePlanId: 'p1', sessions: opts.sessions ?? [], sleepLogs: [] }),
    store: {
      getPlans: () => JSON.parse(JSON.stringify(state.plans)),
      savePlans: (p) => { state.writes++; if (!opts.failSave) state.plans = JSON.parse(JSON.stringify(p)); }
    },
    explain: opts.explain ?? (async () => ({ kind: 'unavailable', reason: 'not_configured' }))
  };
  return { deps, state };
}
const mount = async (deps: AdaptiveReviewDeps, activeSession: WorkoutSession | null = null) => {
  await act(async () => {
    root.render(<AdaptiveReviewModal open onClose={() => {}} profile={DEFAULT_PROFILE} activeSession={activeSession} deps={deps} />);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  document.body.style.overflow = '';
});

describe('AdaptiveReviewModal', () => {
  it('starts with an explicit review action and changes nothing by itself', async () => {
    const { deps, state } = makeDeps({ sessions: decline() });
    await mount(deps);
    expect(button(/Review my training/)).toBeTruthy();
    expect(button(/Apply/)).toBeUndefined();
    expect(state.writes).toBe(0);
  });

  it('explains what is missing when there is no plan', async () => {
    const { deps } = makeDeps({ plans: [] });
    await mount(deps);
    await click(button(/Review my training/));
    expect(text()).toMatch(/No active workout plan/);
    expect(button(/Apply/)).toBeUndefined();
  });

  it('asks for more history instead of fabricating a recommendation', async () => {
    const { deps } = makeDeps({ sessions: [sess('a', 3, [lg([10])])] });
    await mount(deps);
    await click(button(/Review my training/));
    expect(text()).toMatch(/Not enough training history/);
    expect(text()).toMatch(/at least 2 logged workouts/);
  });

  it('shows the proposal, before/after, evidence and labels rule-based output honestly', async () => {
    const { deps } = makeDeps({ sessions: decline() });
    await mount(deps);
    await click(button(/Review my training/));
    expect(text()).toMatch(/Rule-based review/);
    expect(text()).not.toMatch(/AI-explained/);
    expect(text()).toMatch(/Barbell Bench Press/);
    expect(text()).toMatch(/3 sets/);
    expect(text()).toMatch(/2 sets/);
    expect(text()).toMatch(/Supporting data/);
    expect(text()).toMatch(/AI explanations are not set up/);
    expect(button(/Apply 1 change/)).toBeTruthy();
  });

  it('shows AI wording only when the explanation is returned, with the AI label', async () => {
    const explain: AdaptiveReviewDeps['explain'] = async (_c, review) => ({
      kind: 'ai',
      explanation: { summary: 'A small trim should help.', byAdjustmentId: { [review.adjustments[0].id]: 'Fewer sets while performance dips.' } }
    });
    const { deps } = makeDeps({ sessions: decline(), explain });
    await mount(deps);
    await click(button(/Review my training/));
    expect(text()).toMatch(/AI-explained/);
    expect(text()).toMatch(/Fewer sets while performance dips/);
  });

  it('applies on accept, confirms persisted changes, and ignores a second click', async () => {
    const { deps, state } = makeDeps({ sessions: decline() });
    await mount(deps);
    await click(button(/Review my training/));
    const apply = button(/Apply 1 change/)!;
    await act(async () => {
      apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(state.writes).toBe(1);
    expect(state.plans[0].days[0].exercises[0].workingSets).toBe(2);
    expect(text()).toMatch(/Saved to your plan/);
    expect(text()).toMatch(/Barbell Bench Press: 3 → 2 sets/);
    expect(button(/Apply/)).toBeUndefined();
  });

  it('dismiss leaves the plan untouched', async () => {
    const { deps, state } = makeDeps({ sessions: decline() });
    await mount(deps);
    await click(button(/Review my training/));
    await click(button(/Dismiss/));
    expect(text()).toMatch(/plan was not changed/);
    expect(state.writes).toBe(0);
    expect(state.plans[0].days[0].exercises[0].workingSets).toBe(3);
  });

  it('lets the athlete deselect a change; nothing selected cannot be applied', async () => {
    const { deps, state } = makeDeps({ sessions: decline() });
    await mount(deps);
    await click(button(/Review my training/));
    const box = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.labels?.length).toBeGreaterThan(0); // accessible name
    await click(box);
    const apply = button(/Apply 0 changes/)!;
    expect(apply.disabled).toBe(true);
    expect(state.writes).toBe(0);
  });

  it('shows an error and keeps the plan when saving fails', async () => {
    const { deps, state } = makeDeps({ sessions: decline(), failSave: true });
    await mount(deps);
    await click(button(/Review my training/));
    await click(button(/Apply 1 change/));
    expect(document.body.querySelector('[role="alert"]')?.textContent).toMatch(/could not be saved/);
    expect(state.plans[0].days[0].exercises[0].workingSets).toBe(3);
    expect(text()).not.toMatch(/Saved to your plan/);
  });

  it('reconsider re-runs against current data', async () => {
    const { deps, state } = makeDeps({ sessions: decline() });
    await mount(deps);
    await click(button(/Review my training/));
    state.plans[0].days[0].exercises[0].workingSets = 2; // plan edited elsewhere
    state.plans[0].days[0].exercises[0].restSeconds = 90;
    await click(button(/Reconsider/));
    expect(text()).toMatch(/Follow your plan|Not enough/);
    expect(button(/Apply/)).toBeUndefined();
  });
});

describe('integration with the real storage layer', () => {
  beforeEach(() => localStorage.clear());

  it('changes only the plan; sessions and the in-progress session stay byte-identical', async () => {
    db.savePlans([plan()]);
    db.setActivePlanId('p1');
    const sessions = decline();
    db.saveSessions(sessions);
    const active: WorkoutSession = { ...sess('live', 0, [lg([5])]), status: 'in_progress' };
    db.saveActiveSession(active);
    const before = { sessions: localStorage.getItem('ironlog_sessions_v1'), active: localStorage.getItem('ironlog_active_session_v1') };

    const deps: AdaptiveReviewDeps = {
      load: () => ({ plans: db.getPlans(), activePlanId: db.getActivePlanId(), sessions: db.getSessions(), sleepLogs: db.getSleepLogs() }),
      store: db,
      explain: async () => ({ kind: 'unavailable', reason: 'not_configured' })
    };
    await mount(deps, active);
    await click(button(/Review my training/));
    expect(text()).toMatch(/in-progress session is not modified/);
    await click(button(/Apply 1 change/));

    expect(db.getPlans()[0].days[0].exercises[0].workingSets).toBe(2);
    expect(localStorage.getItem('ironlog_sessions_v1')).toBe(before.sessions);
    expect(localStorage.getItem('ironlog_active_session_v1')).toBe(before.active);
  });
});
