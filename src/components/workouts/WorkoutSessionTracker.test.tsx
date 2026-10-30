import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../common/RestTimer', async (orig) => {
  const real = await orig<typeof import('../common/RestTimer')>();
  return { ...real, playTimerChime: () => {} };
});

import { WorkoutSessionTracker } from './WorkoutSessionTracker';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import type { LoggedSet, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = () => new Date().toISOString();
const set = (id: string, n: number, type: 'working' | 'warmup', weight: number, reps: number, completed: boolean): LoggedSet => ({
  id, setNumber: n, type, weight, reps, rir: 2, completed, timestamp: ts()
});

const makeSession = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 's1',
  dayName: 'Push A',
  date: '2026-10-29',
  startTime: new Date(Date.now() - 23 * 60000).toISOString(),
  status: 'in_progress',
  exercises: [
    {
      id: 'e1',
      name: 'Barbell Bench Press',
      muscleGroup: 'chest',
      equipment: 'barbell',
      repRange: '6-8',
      targetRir: 2,
      restSeconds: 120,
      notes: 'Pause on chest',
      sets: [
        set('a0', 1, 'warmup', 40, 10, true),
        set('a1', 2, 'working', 80, 8, true),
        set('a2', 3, 'working', 80, 8, true),
        set('a3', 4, 'working', 80, 0, false)
      ]
    },
    {
      id: 'e2',
      name: 'Rope Triceps Pushdown',
      muscleGroup: 'triceps',
      equipment: 'cable',
      repRange: '10-15',
      targetRir: 2,
      restSeconds: 60,
      sets: [set('b1', 1, 'working', 0, 0, false)]
    }
  ],
  ...over
});

let latest: WorkoutSession | null = null;
let initial: WorkoutSession | null = null;
const Harness: React.FC = () => {
  const [s, setS] = React.useState<WorkoutSession | null>(initial);
  latest = s;
  return (
    <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
      <WorkoutSessionTracker profile={DEFAULT_PROFILE} activeSession={s} onSessionUpdated={setS} onNavigateToPlans={() => {}} />
    </BluetoothGadgetProvider>
  );
};

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const mount = async (session: WorkoutSession | null) => {
  initial = session;
  if (session) db.saveActiveSession(session);
  await act(async () => root.render(<Harness />));
  await flush();
};
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const btn = (label: string) =>
  Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const type = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const dialog = () => container.querySelector('[role="dialog"]') as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('workout header', () => {
  it('shows the workout name, elapsed clock, exercise count and real set progress', async () => {
    await mount(makeSession());
    expect(text()).toContain('Push A');
    expect(byLabel('Elapsed workout time').textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(text()).toContain('2 exercises');
    expect(text()).toContain('3/5 sets'); // a0,a1,a2 completed of 5 real sets
    const bar = container.querySelector('[role="progressbar"][aria-label="Workout progress"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
  });

  it('hides the progress bar for an empty freestyle session and shows an empty state', async () => {
    await mount(makeSession({ exercises: [] }));
    expect(container.querySelector('[aria-label="Workout progress"]')).toBeNull();
    expect(text()).toContain('No exercises in this workout yet');
    expect(text()).toContain('0/0 sets');
  });

  it('shows the Finish action prominently and pause/resume toggles real session state', async () => {
    await mount(makeSession());
    expect(text()).toContain('Finish Session');
    await click(btn('Pause')[0]);
    expect(latest!.isPaused).toBe(true);
    expect(text()).toContain('Workout paused.');
    expect(db.getActiveSession()!.isPaused).toBe(true);
    await click(btn('Resume')[0]);
    expect(latest!.isPaused).toBe(false);
    expect(text()).not.toContain('Workout paused.');
  });

  it('resets the workout clock only after confirming, and keeps logged sets', async () => {
    await mount(makeSession());
    const before = new Date(latest!.startTime).getTime();
    await click(byLabel('Reset workout clock'));
    expect(dialog()?.textContent).toContain('Reset workout timer');
    expect(new Date(latest!.startTime).getTime()).toBe(before); // nothing changed yet
    await click(btn('Reset to 00:00')[0]);
    expect(new Date(latest!.startTime).getTime()).toBeGreaterThan(before);
    expect(latest!.exercises[0].sets).toHaveLength(4);
    expect(dialog()).toBeNull();
  });
});

describe('exercise cards', () => {
  it('shows real exercise data: name, muscle, equipment, target and notes', async () => {
    await mount(makeSession());
    expect(text()).toContain('Barbell Bench Press');
    expect(text()).toContain('chest');
    expect(text()).toContain('barbell');
    expect(text()).toContain('Target: 6-8 reps @ 2 RIR');
    expect(text()).toContain('Pause on chest');
    expect(text()).toContain('Rest: 120s');
  });

  it('shows the baseline message when there is no history and never invents previous values', async () => {
    await mount(makeSession());
    expect(text()).toContain('First logged session for this movement');
    expect(text()).not.toContain('Last session');
  });

  it('shows last-session data and per-set previous values from real history', async () => {
    db.addOrUpdateSession({
      id: 'past',
      dayName: 'Push A',
      date: '2026-10-22',
      startTime: ts(),
      endTime: ts(),
      status: 'completed',
      exercises: [
        {
          id: 'p1', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', repRange: '6-8', targetRir: 2, restSeconds: 120,
          sets: [set('h1', 1, 'working', 75, 8, true), set('h2', 2, 'working', 75, 7, true)]
        }
      ]
    });
    await mount(makeSession());
    expect(text()).toContain('Last session (2026-10-22)');
    expect(text()).toContain('75 kg');
    expect(text()).toContain('75 × 8'); // first working set position
    expect(text()).toContain('75 × 7');
    // "Use 75 kg" copies the weight to every set (existing behaviour)
    await click(btn('Use 75 kg')[0]);
    expect(latest!.exercises[0].sets.every((s) => s.weight === 75)).toBe(true);
  });

  it('marks a fully completed exercise', async () => {
    const s = makeSession();
    s.exercises[1].sets[0] = { ...s.exercises[1].sets[0], completed: true, weight: 20, reps: 12 };
    await mount(s);
    const cards = Array.from(container.querySelectorAll('article'));
    expect(cards[1].getAttribute('data-complete')).toBe('true');
    expect(cards[0].getAttribute('data-complete')).toBe('false');
  });
});

describe('set logging', () => {
  it('updates weight, reps and RIR, and persists them', async () => {
    await mount(makeSession());
    await type(byLabel('Set 4 weight (kg)') as HTMLInputElement, '82.5');
    await type(byLabel('Set 4 reps') as HTMLInputElement, '6');
    await type(byLabel('Set 4 reps in reserve') as HTMLSelectElement, '1');
    const s = latest!.exercises[0].sets[3];
    expect([s.weight, s.reps, s.rir]).toEqual([82.5, 6, 1]);
    const stored = db.getActiveSession()!.exercises[0].sets[3];
    expect([stored.weight, stored.reps, stored.rir]).toEqual([82.5, 6, 1]);
  });

  it('keeps the existing input contract: numeric inputs, 0.5 weight step, reps 0-100', async () => {
    await mount(makeSession());
    const w = byLabel('Set 4 weight (kg)') as HTMLInputElement;
    const r = byLabel('Set 4 reps') as HTMLInputElement;
    expect([w.type, w.step]).toEqual(['number', '0.5']);
    expect([r.type, r.min, r.max]).toEqual(['number', '0', '100']);
  });

  it('shows an inline validation message for out-of-range reps without changing stored parsing', async () => {
    await mount(makeSession());
    await type(byLabel('Set 4 reps') as HTMLInputElement, '150');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Max 100');
    expect(byLabel('Set 4 reps').getAttribute('aria-invalid')).toBe('true');
    expect(latest!.exercises[0].sets[3].reps).toBe(150); // storage behaviour unchanged
  });

  it('weight steppers change weight by 2.5 and never go below 0', async () => {
    await mount(makeSession());
    await click(byLabel('Set 4: increase weight by 2.5 kg'));
    expect(latest!.exercises[0].sets[3].weight).toBe(82.5);
    await click(byLabel('Set 1: decrease weight by 2.5 kg'));
    expect(latest!.exercises[0].sets[0].weight).toBe(37.5);
    await type(byLabel('Set 4 weight (kg)') as HTMLInputElement, '1');
    await click(byLabel('Set 4: decrease weight by 2.5 kg'));
    expect(latest!.exercises[0].sets[3].weight).toBe(0); // clamped, never negative
  });

  it('toggles a set between working and warm-up', async () => {
    await mount(makeSession());
    await click(byLabel('Set 2, working. Switch to warm-up set'));
    expect(latest!.exercises[0].sets[1].type).toBe('warmup');
    await click(byLabel('Set 2, warm-up. Switch to working set'));
    expect(latest!.exercises[0].sets[1].type).toBe('working');
  });

  it('adds working and warm-up sets, copying the previous set values, and removes a set', async () => {
    await mount(makeSession());
    await click(btn('Add Set')[0]);
    expect(latest!.exercises[0].sets).toHaveLength(5);
    expect(latest!.exercises[0].sets[4]).toMatchObject({ type: 'working', weight: 80, completed: false });
    await click(btn('Warmup Set')[0]);
    expect(latest!.exercises[0].sets[5].type).toBe('warmup');
    await click(byLabel('Delete set 6'));
    expect(latest!.exercises[0].sets).toHaveLength(5);
  });
});

describe('set completion and rest timer', () => {
  it('completing a set updates progress, shows the completed state and starts the rest timer with the exercise rest', async () => {
    await mount(makeSession());
    expect(container.querySelector('section[aria-label="Rest timer"]')).toBeNull();
    await click(byLabel('Complete set 4'));
    expect(latest!.exercises[0].sets[3].completed).toBe(true);
    expect(text()).toContain('4/5 sets');
    const row = byLabel('Set 4 weight (kg)').closest('li')!;
    expect(row.getAttribute('data-completed')).toBe('true');
    const timer = container.querySelector('[role="timer"][aria-label$="remaining"]')!;
    expect(timer.textContent).toBe('02:00'); // 120s rest for bench press
  });

  it('un-completing a set does not start a rest timer', async () => {
    await mount(makeSession());
    await click(byLabel('Set 2 complete. Mark incomplete'));
    expect(latest!.exercises[0].sets[1].completed).toBe(false);
    expect(container.querySelector('section[aria-label="Rest timer"]')).toBeNull();
  });

  it('opens the rest timer from the toolbar and can be closed', async () => {
    await mount(makeSession());
    await click(byLabel('Open rest timer'));
    expect(container.querySelector('section[aria-label="Rest timer"]')).not.toBeNull();
    await click(byLabel('Close Timer'));
    expect(container.querySelector('section[aria-label="Rest timer"]')).toBeNull();
  });
});

describe('removing exercises', () => {
  it('removes an exercise with no completed sets immediately', async () => {
    await mount(makeSession());
    await click(byLabel('Remove Rope Triceps Pushdown'));
    expect(latest!.exercises.map((e) => e.name)).toEqual(['Barbell Bench Press']);
    expect(dialog()).toBeNull();
  });

  it('asks first when the exercise has completed sets, and Keep leaves it untouched', async () => {
    await mount(makeSession());
    await click(byLabel('Remove Barbell Bench Press'));
    expect(dialog()?.textContent).toContain('Remove this exercise?');
    expect(dialog()?.textContent).toContain('3 completed set(s)');
    expect(latest!.exercises).toHaveLength(2);
    await click(btn('Keep Exercise')[0]);
    expect(dialog()).toBeNull();
    expect(latest!.exercises).toHaveLength(2);
  });

  it('removes it after confirmation', async () => {
    await mount(makeSession());
    await click(byLabel('Remove Barbell Bench Press'));
    await click(btn('Remove Exercise')[0]);
    expect(latest!.exercises.map((e) => e.name)).toEqual(['Rope Triceps Pushdown']);
  });
});

describe('add exercise', () => {
  const open = async () => click(btn('Add Exercise')[0]);

  it('opens a dialog and requires a movement name', async () => {
    await mount(makeSession());
    await open();
    expect(dialog()?.textContent).toContain('Add Movement to Workout');
    await click(btn('Insert Movement')[0]);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Enter a movement name.');
    expect(latest!.exercises).toHaveLength(2);
  });

  it('inserts the movement with the chosen muscle group, equipment and target reps', async () => {
    await mount(makeSession());
    await open();
    const d = dialog()!;
    const inputs = d.querySelectorAll('input');
    const selects = d.querySelectorAll('select');
    await type(inputs[0] as HTMLInputElement, 'Incline Dumbbell Curl');
    await type(selects[0] as HTMLSelectElement, 'Biceps');
    await type(selects[1] as HTMLSelectElement, 'dumbbell');
    await type(inputs[1] as HTMLInputElement, '10-12');
    await click(btn('Insert Movement')[0]);
    const added = latest!.exercises[2];
    expect(added).toMatchObject({ name: 'Incline Dumbbell Curl', muscleGroup: 'Biceps', equipment: 'dumbbell', repRange: '10-12' });
    expect(added.sets).toHaveLength(1);
    expect(dialog()).toBeNull();
  });

  it('keeps focus in the field while typing (modal does not steal focus on re-render)', async () => {
    await mount(makeSession());
    await open();
    const name = dialog()!.querySelector('input') as HTMLInputElement;
    await act(async () => name.focus());
    await type(name, 'Cable Fly');
    await type(name, 'Cable Fly 2');
    expect(document.activeElement).toBe(name);
  });
});

describe('finish and discard', () => {
  it('finish dialog summarises only what was actually logged', async () => {
    await mount(makeSession());
    await click(btn('Finish Session')[0]);
    const d = dialog()!;
    expect(d.textContent).toContain('Duration');
    expect(d.textContent).toMatch(/\d{2}:\d{2}/);
    expect(d.textContent).toContain('1/2'); // exercises with at least one completed set
    expect(d.textContent).toContain('3/5'); // completed / total sets
    expect(d.textContent).toContain('1,280'); // 2 completed working sets x 80 x 8 (warm-up excluded)
    expect(d.textContent).toContain('2 sets are still unchecked');
  });

  it('Back to Workout closes without saving anything', async () => {
    await mount(makeSession());
    await click(btn('Finish Session')[0]);
    await click(btn('Back to Workout')[0]);
    expect(dialog()).toBeNull();
    expect(latest).not.toBeNull();
    expect(db.getSessions().find((s) => s.id === 's1')).toBeUndefined();
    expect(db.getActiveSession()).not.toBeNull();
  });

  it('Confirm & Save stores a completed session with notes and clears the active session', async () => {
    await mount(makeSession());
    await click(btn('Finish Session')[0]);
    await type(dialog()!.querySelector('textarea')!, 'felt strong');
    await click(btn('Confirm & Save')[0]);
    const saved = db.getSessions().find((s) => s.id === 's1')!;
    expect(saved.status).toBe('completed');
    expect(saved.endTime).toBeTruthy();
    expect(saved.notes).toBe('felt strong');
    expect(latest).toBeNull();
    expect(db.getActiveSession()).toBeNull();
    expect(text()).toContain('Session Deck'); // back on the pre-workout screen
  });

  it('never discards silently: the first tap only opens a confirmation', async () => {
    await mount(makeSession());
    await click(byLabel('Discard workout'));
    expect(dialog()?.textContent).toContain('Discard in-progress workout?');
    expect(dialog()?.textContent).toContain('3 completed sets will be lost.');
    expect(latest).not.toBeNull();
    await click(btn('Keep Workout')[0]);
    expect(latest).not.toBeNull();
    expect(db.getActiveSession()).not.toBeNull();
  });

  it('discards only after explicit confirmation and does not save to history', async () => {
    await mount(makeSession());
    await click(byLabel('Discard workout'));
    await click(btn('Yes, Discard')[0]);
    expect(latest).toBeNull();
    expect(db.getActiveSession()).toBeNull();
    expect(db.getSessions().find((s) => s.id === 's1')).toBeUndefined();
  });

  it('closes dialogs with Escape', async () => {
    await mount(makeSession());
    await click(btn('Finish Session')[0]);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dialog()).toBeNull();
  });
});

describe('pre-workout screen', () => {
  it('lists the plan days, starts a session from the selected day, and keeps using stored data', async () => {
    await mount(null);
    expect(text()).toContain('Select Routine Day');
    expect(text()).toContain('Recent Completed Sessions (0)');
    expect(text()).toContain('No previous workout sessions recorded yet.');
    await click(btn('Start Workout Now')[0]);
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('in_progress');
    expect(db.getActiveSession()!.id).toBe(latest!.id);
  });

  it('starts an empty freestyle session', async () => {
    await mount(null);
    await click(btn('Start Empty Freestyle Session')[0]);
    expect(latest!.dayName).toContain('Freestyle');
    expect(latest!.exercises).toHaveLength(0);
  });

  it('shows recent completed sessions with their real volume', async () => {
    db.addOrUpdateSession({
      id: 'past', dayName: 'Legs', date: '2026-10-20', startTime: ts(), endTime: ts(), status: 'completed',
      exercises: [{ id: 'x', name: 'Squat', muscleGroup: 'quads', equipment: 'barbell', repRange: '5', targetRir: 2, restSeconds: 120, sets: [set('q1', 1, 'working', 100, 5, true)] }]
    });
    await mount(null);
    expect(text()).toContain('Recent Completed Sessions (1)');
    expect(text()).toContain('Legs');
    expect(text()).toContain('500'); // 100 x 5
  });

  it('opens the warm-up dialog from the pre-workout screen', async () => {
    await mount(null);
    await click(btn('5-Min Warm-up')[0]);
    expect(document.body.textContent).toMatch(/warm/i);
  });
});

describe('themes', () => {
  it.each(['dark', 'light'])('renders the live workout under the %s theme class without errors', async (theme) => {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
    await mount(makeSession());
    expect(container.querySelectorAll('article')).toHaveLength(2);
    expect(text()).toContain('Barbell Bench Press');
  });
});
