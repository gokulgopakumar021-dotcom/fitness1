import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../common/RestTimer', async (orig) => {
  const real = await orig<typeof import('../common/RestTimer')>();
  return { ...real, playTimerChime: () => {} };
});

import { WorkoutSessionTracker } from '../workouts/WorkoutSessionTracker';
import { NutritionView } from '../nutrition/NutritionView';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import { BILLING_REFUSAL_EVENT, BILLING_REQUIRED_MESSAGE } from '../../lib/billingGate';
import type { LoggedSet, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Free features must keep working when the server's entitlement gate answers 402 on the two AI routes that sit inside free screens:
 *   /api/exercise-coach  (AI Coach button inside the basic workout tracker)
 *   /api/ai-food-parser  (AI Parser tab inside basic nutrition tracking)
 * The refusal must stay inside the AI panel; set logging, finishing a workout and manual food entry must be unaffected.
 */
const refusal = () => new Response(JSON.stringify({ success: false, code: 'subscription_required', error: BILLING_REQUIRED_MESSAGE, entitlement: { state: 'none' } }), { status: 402, headers: { 'Content-Type': 'application/json' } });

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const events: unknown[] = [];
const onEvent = (e: Event) => events.push((e as CustomEvent).detail);

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await flush(); };
const page = () => document.body.textContent ?? '';
const buttonWithText = (text: string) => Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text));
const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const fieldByLabel = (text: string) => {
  const label = Array.from(document.body.querySelectorAll('label')).find((l) => (l.textContent ?? '').includes(text));
  expect(label, `label ${text}`).toBeTruthy();
  return (label!.htmlFor ? document.getElementById(label!.htmlFor) : label!.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement;
};
const closeDialog = async () => {
  const dlg = document.body.querySelector('[role="dialog"]');
  const close = dlg && Array.from(dlg.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') ?? '') || /^(cancel|close)$/i.test((b.textContent ?? '').trim()));
  await click(close);
};

beforeEach(() => {
  localStorage.clear();
  events.length = 0;
  window.addEventListener(BILLING_REFUSAL_EVENT, onEvent);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn(async () => refusal());
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  window.removeEventListener(BILLING_REFUSAL_EVENT, onEvent);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------------------------------------------ workout tracker
const ts = () => new Date().toISOString();
const set = (id: string, n: number, weight: number, reps: number, completed: boolean): LoggedSet => ({ id, setNumber: n, type: 'working', weight, reps, rir: 2, completed, timestamp: ts() });
const session = (): WorkoutSession => ({
  id: 's1', dayName: 'Push A', date: '2026-10-29', startTime: new Date(Date.now() - 60000).toISOString(), status: 'in_progress',
  exercises: [{ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', repRange: '6-8', targetRir: 2, restSeconds: 120, sets: [set('a1', 1, 80, 8, true), set('a2', 2, 80, 8, false)] }]
});

describe('free workout tracking when /api/exercise-coach returns 402', () => {
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

  it('the AI Coach shows the subscription message and raises the app-wide prompt, while logging sets and the rest timer still work', async () => {
    db.saveActiveSession(session());
    await act(async () => root.render(<Harness />));
    await flush();

    await click(buttonWithText('AI Coach'));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/exercise-coach'))).toBe(true);
    expect(page()).toContain('Coaching unavailable');
    expect(page()).toContain(BILLING_REQUIRED_MESSAGE);
    expect(events).toEqual([{ kind: 'subscription_required', state: 'none' }]);

    await closeDialog();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    // Basic tracking is intact: edit a weight, complete the set, the timer starts, and the data is saved locally.
    await click(byLabel('Complete set 2'));
    expect(latest!.exercises[0].sets[1].completed).toBe(true);
    expect(page()).toContain('2/2 sets');
    expect(document.body.querySelector('[role="timer"]')).toBeTruthy();
    expect(db.getActiveSession()!.exercises[0].sets[1].completed).toBe(true);
    expect(buttonWithText('Finish Session')).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------------ nutrition
describe('free nutrition tracking when /api/ai-food-parser returns 402', () => {
  it('the AI Parser shows the subscription message, while manual (custom) food entry still logs locally', async () => {
    const profile = { ...DEFAULT_PROFILE, sex: 'male' as const, age: 30, heightCm: 180, currentWeightKg: 80, dailyCalorieTarget: 2500, dailyProteinTarget: 150, dailyCarbsTarget: 300, dailyFatTarget: 70, onboardingCompleted: true };
    await act(async () => root.render(<NutritionView profile={profile} />));
    await flush();

    // 1) Try the AI parser: refused, message shown inside the modal only.
    await click(document.body.querySelector('[aria-label^="Add food to "]'));
    await click(buttonWithText('AI Parser'));
    await setValue(fieldByLabel('Describe your meal') as HTMLTextAreaElement, '2 eggs and toast');
    await click(buttonWithText('Extract Macros'));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/ai-food-parser'))).toBe(true);
    expect(page()).toContain(BILLING_REQUIRED_MESSAGE);
    expect(events).toEqual([{ kind: 'subscription_required', state: 'none' }]);
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(0); // nothing was logged from a refused AI reply
    await closeDialog();

    // 2) Manual entry is unaffected.
    await click(document.body.querySelector('[aria-label^="Add custom food to "]'));
    await setValue(fieldByLabel('Food or dish name') as HTMLInputElement, 'Homemade curry');
    await setValue(fieldByLabel('Calories (kcal)') as HTMLInputElement, '420');
    await click(buttonWithText('Save & Log Entry'));
    const entries = db.getNutritionLogForDate(getCurrentDayKey()).entries;
    expect(entries.map((e) => [e.name, e.calories])).toEqual([['Homemade curry', 420]]);
    expect(page()).toContain('Homemade curry');
  });
});
