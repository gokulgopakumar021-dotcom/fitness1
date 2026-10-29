import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgressionView } from './ProgressionView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { LoggedExercise, WorkoutPlan, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile = { ...DEFAULT_PROFILE, preferredUnit: 'kg' as const };

const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const exercise = (name: string, weight: number, reps: number[]): LoggedExercise => ({
  id: `ex-${name}-${weight}`,
  name,
  muscleGroup: 'chest',
  equipment: 'barbell',
  repRange: '8-12',
  targetRir: 2,
  restSeconds: 90,
  sets: reps.map((r, i) => ({
    id: `set-${name}-${weight}-${i}`,
    setNumber: i + 1,
    type: 'working' as const,
    weight,
    reps: r,
    completed: true,
    timestamp: new Date().toISOString()
  }))
});

const session = (daysBack: number, ex: LoggedExercise): WorkoutSession => ({
  id: `s-${daysBack}`,
  dayName: 'Push',
  date: daysAgo(daysBack),
  startTime: new Date().toISOString(),
  status: 'completed',
  exercises: [ex]
});

const plan: WorkoutPlan = {
  id: 'plan-test',
  name: 'Test Plan',
  trainingSplit: 'Push',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isActive: true,
  days: [
    {
      id: 'day-1',
      dayName: 'Push',
      dayOrder: 1,
      exercises: ['Bench Press', 'Squat'].map((name, i) => ({
        id: `pe-${i}`,
        name,
        muscleGroup: 'chest',
        equipment: 'barbell' as const,
        workingSets: 3,
        repRange: '8-12',
        targetRir: 2,
        restSeconds: 90
      }))
    }
  ]
};

// 200d (outside 90d), 60d, 20d, 5d
const BENCH_HISTORY = [
  session(200, exercise('Bench Press', 60, [8, 8, 8])),
  session(60, exercise('Bench Press', 62.5, [8, 8, 7])),
  session(20, exercise('Bench Press', 65, [8, 8, 6])),
  session(5, exercise('Bench Press', 67.5, [8, 6, 6]))
];

const seed = (sessions: WorkoutSession[]) => {
  localStorage.clear();
  db.savePlans([plan]);
  db.setActivePlanId(plan.id);
  db.saveSessions(sessions);
};

const render = async () => {
  await act(async () => {
    root.render(<ProgressionView profile={profile} />);
  });
};

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('element to click not found');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(text));

const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};

const chartLabel = (title: string) =>
  Array.from(container.querySelectorAll('svg[role="img"]'))
    .map((s) => s.getAttribute('aria-label') || '')
    .find((l) => l.startsWith(title));

describe('ProgressionView (single exercise)', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('shows headline metrics from real history, independent of the date range', async () => {
    seed(BENCH_HISTORY);
    await render();
    const text = container.textContent || '';
    expect(text).toContain('Bench Press');
    const metrics = container.querySelector('section[aria-label="Headline metrics"]')!.textContent!;
    expect(metrics).toContain('67.5'); // all-time PR and last session top weight
    expect(metrics).toContain('Reps: 8, 6, 6');
    // peak volume = best session: 62.5*8+62.5*8+62.5*7=1437.5 vs 65*(8+8+6)=1430 vs 67.5*20=1350 vs 60*24=1440
    expect(metrics).toContain('1,440');
  });

  it('date-range control changes the plotted data', async () => {
    seed(BENCH_HISTORY);
    await render();
    expect(chartLabel('Weight load progression')).toContain('3 points'); // default 90d
    await click(buttonByText('30 days'));
    expect(chartLabel('Weight load progression')).toContain('2 points');
    await click(buttonByText('All time'));
    expect(chartLabel('Weight load progression')).toContain('4 points');
    expect(chartLabel('Weight load progression')).toContain('latest 67.5');
    // headline PR does not depend on range
    await click(buttonByText('30 days'));
    expect(container.querySelector('section[aria-label="Headline metrics"]')!.textContent).toContain('67.5');
  });

  it('compares the last session with the previous one, with direction in text', async () => {
    seed(BENCH_HISTORY);
    await render();
    const cmp = container.querySelector('section[aria-label="Last session compared with previous"]')!.textContent!;
    expect(cmp).toContain('+2.5 kg'); // 67.5 vs 65
    expect(cmp).toContain('up vs previous session');
    expect(cmp).toContain('−2 reps'); // 20 reps vs 22
    expect(cmp).toContain('down vs previous session');
  });

  it('lists weight records without duplicating equal or lower sessions', async () => {
    seed(BENCH_HISTORY);
    await render();
    const prs = container.querySelector('section[aria-label="Weight record history"]')!.textContent!;
    expect(prs).toContain('67.5 kg');
    expect(prs).toContain('+2.5 kg over previous best');
    expect(prs).toContain('First logged session');
  });

  it('shows a useful empty state for an exercise with no logged history', async () => {
    seed(BENCH_HISTORY);
    await render();
    const exerciseSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'Squat')
    )!;
    await setValue(exerciseSelect, 'Squat');
    expect(container.textContent).toContain('No completed sets logged for Squat');
    expect(container.querySelector('section[aria-label="Headline metrics"]')).toBeNull();
    expect(container.querySelectorAll('svg[role="img"]').length).toBe(0);
  });

  it('handles a single logged session without inventing a comparison or trend', async () => {
    seed([BENCH_HISTORY[3]]);
    await render();
    expect(container.textContent).toContain('Log this exercise in one more workout');
    expect(container.textContent).toContain('Only one session in this range');
    expect(chartLabel('Weight load progression')).toContain('1 point,');
  });

  it('offers to widen the range when history exists only outside it', async () => {
    seed([BENCH_HISTORY[0]]);
    await render();
    expect(container.textContent).toContain('No sessions in the last 90 days');
    expect(container.querySelectorAll('svg[role="img"]').length).toBe(0);
    await click(buttonByText('Show all time'));
    expect(chartLabel('Weight load progression')).toContain('1 point,');
  });

  it('charts use theme tokens and each line chart has its own gradient id', async () => {
    seed(BENCH_HISTORY);
    await render();
    const html = container.innerHTML;
    expect(html.toLowerCase()).not.toContain('#ceff00');
    expect(html.toLowerCase()).not.toContain('#00e5ff');
    expect(html).toContain('var(--chart-1)');
    expect(html).toContain('var(--chart-2)');
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('modify-target dialog saves the chosen weight to stored recommendations', async () => {
    seed(BENCH_HISTORY);
    await render();
    await click(buttonByText('Modify target'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Modify prescribed load');
    const weight = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    await setValue(weight, '70');
    await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Save target')));
    const saved = db.getRecommendations();
    expect(saved[0].userAction).toBe('modified');
    expect(saved[0].chosenWeight).toBe(70);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('accept and reject persist the decision', async () => {
    seed(BENCH_HISTORY);
    await render();
    await click(buttonByText('Accept prescription'));
    expect(db.getRecommendations()[0].userAction).toBe('accepted');
    await click(buttonByText('Reject load'));
    expect(db.getRecommendations()[0].userAction).toBe('rejected');
  });
});

describe('ProgressionView (plan matrix)', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('lists every plan exercise with status, next prescription and last change', async () => {
    seed(BENCH_HISTORY);
    await render();
    await click(buttonByText('Plan matrix'));
    const rows = Array.from(container.querySelectorAll('[role="row"]')).filter((r) => r.querySelector('[role="cell"]'));
    expect(rows.length).toBe(2);
    const bench = rows.find((r) => r.textContent!.includes('Bench Press'))!;
    expect(bench.textContent).toContain('Last change');
    expect(bench.textContent).toContain('+2.5 kg');
    const squat = rows.find((r) => r.textContent!.includes('Squat'))!;
    expect(squat.textContent).toContain('Baseline needed'); // no history: status is text, not colour alone
    expect(squat.textContent).not.toContain('Last change');
  });

  it('Analyze switches to the single-exercise view for that exercise', async () => {
    seed(BENCH_HISTORY);
    await render();
    await click(buttonByText('Plan matrix'));
    await click(container.querySelector('button[aria-label="Analyze Squat"]'));
    expect(container.textContent).toContain('No completed sets logged for Squat');
  });
});
