import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  client: null as any,
  rows: (): any => Promise.resolve({ data: [], error: null }),
  fromCalls: 0
}));

vi.mock('../../lib/supabase', async (orig) => {
  const real = await orig<typeof import('../../lib/supabase')>();
  return { ...real, getSupabase: () => h.client };
});
vi.mock('../../context/AuthContext', async (orig) => {
  const real = await orig<typeof import('../../context/AuthContext')>();
  return { ...real, useAuth: () => ({ status: 'authenticated' }) };
});
vi.mock('../common/RestTimer', async (orig) => {
  const real = await orig<typeof import('../common/RestTimer')>();
  return { ...real, playTimerChime: () => {} };
});

import { WorkoutSessionTracker } from './WorkoutSessionTracker';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { DEFAULT_PROFILE } from '../../storage/db';
import type { WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (): WorkoutSession => ({
  id: 's1',
  dayName: 'Legs',
  date: '2026-10-27',
  startTime: new Date().toISOString(),
  status: 'in_progress',
  exercises: [
    {
      id: 'e1',
      name: 'Barbell Back Squat',
      muscleGroup: 'quads',
      equipment: 'barbell',
      repRange: '5',
      targetRir: 2,
      restSeconds: 120,
      sets: [{ id: 'set1', setNumber: 1, type: 'working', weight: 0, reps: 0, completed: false, timestamp: new Date().toISOString() }]
    },
    {
      id: 'e2',
      name: 'Totally Custom Move',
      muscleGroup: 'core',
      equipment: 'bodyweight',
      repRange: '10',
      targetRir: 2,
      restSeconds: 60,
      sets: [{ id: 'set2', setNumber: 1, type: 'working', weight: 0, reps: 0, completed: false, timestamp: new Date().toISOString() }]
    }
  ]
});

let latest: WorkoutSession | null = null;
const Harness: React.FC = () => {
  const [s, setS] = React.useState<WorkoutSession | null>(session());
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
const buttons = (label: string) => Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent ?? '').includes(label));
const click = async (el: Element | undefined) => {
  expect(el).toBeDefined();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const setWeight = async (value: string) => {
  const input = container.querySelector('input[type="number"][step="0.5"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  h.fromCalls = 0;
  h.rows = () => Promise.resolve({ data: [], error: null });
  const builder: any = { select: () => builder, eq: () => builder, order: () => builder, limit: () => h.rows() };
  h.client = {
    from: () => {
      h.fromCalls++;
      return builder;
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }
  };
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('WorkoutSessionTracker video integration', () => {
  it('renders a Watch video control beside Biomechanics for every exercise', async () => {
    await act(async () => root.render(<Harness />));
    expect(buttons('Watch video')).toHaveLength(2);
    expect(buttons('Biomechanics')).toHaveLength(2);
    expect(h.fromCalls).toBe(0); // no catalog requests until a control is used
  });

  it('opens the modal with the video section expanded and shows an approved video', async () => {
    h.rows = () =>
      Promise.resolve({
        data: [{ id: 'v1', content_sha256: 'a'.repeat(64), original_filename: 'sq.mp4', title: 'Squat Demo', exercise_key: 'barbell-squat', storage_key: 'videos/aa/a.mp4', size_bytes: 1, duration_seconds: 10, width: 1, height: 1, equipment: [], muscle_groups: [], tags: [], match_method: 'exact_name', match_confidence: 1, review_status: 'matched', status: 'uploaded', sort_order: 0 }],
        error: null
      });
    await act(async () => root.render(<Harness />));
    await click(buttons('Watch video')[0]);
    expect(text()).toContain('Squat Demo');
    expect(h.fromCalls).toBe(1);
  });

  it('shows the empty state for an exercise with no catalog mapping, without querying', async () => {
    await act(async () => root.render(<Harness />));
    await click(buttons('Watch video')[1]);
    expect(text()).toContain('No approved video for this exercise yet');
    expect(h.fromCalls).toBe(0);
  });

  it('keeps logging sets normally while the video service is failing', async () => {
    h.rows = () => Promise.reject(new Error('service down'));
    await act(async () => root.render(<Harness />));
    await click(buttons('Watch video')[0]);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click(buttons('Close Form Guide')[0]);

    await setWeight('100');
    expect(latest!.exercises[0].sets[0].weight).toBe(100);
  });

  it('keeps logging when the Supabase client is missing entirely', async () => {
    h.client = null;
    await act(async () => root.render(<Harness />));
    await click(buttons('Watch video')[0]);
    expect(text()).toContain('unavailable');
    await click(buttons('Close Form Guide')[0]);
    await setWeight('60');
    expect(latest!.exercises[0].sets[0].weight).toBe(60);
  });

  it('does not lose workout progress when the video modal is closed', async () => {
    await act(async () => root.render(<Harness />));
    await setWeight('87.5');
    await click(buttons('Watch video')[0]);
    await click(buttons('Close Form Guide')[0]);
    expect(latest!.exercises[0].sets[0].weight).toBe(87.5);
    expect(latest!.status).toBe('in_progress');
    const input = container.querySelector('input[type="number"][step="0.5"]') as HTMLInputElement;
    expect(input.value).toBe('87.5');
  });

  it('keeps the Biomechanics button behaviour: modal opens with the video section collapsed and no request', async () => {
    await act(async () => root.render(<Harness />));
    await click(buttons('Biomechanics')[0]);
    expect(text()).toContain('Close Form Guide');
    expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    expect(h.fromCalls).toBe(0);
  });
});
