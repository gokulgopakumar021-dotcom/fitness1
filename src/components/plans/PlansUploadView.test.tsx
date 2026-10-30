import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlansUploadView } from './PlansUploadView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import type { WorkoutPlan } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const makePlan = (id: string, name: string, over: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
  id,
  name,
  trainingSplit: 'Push / Pull',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isActive: false,
  days: [
    {
      id: `${id}-d1`,
      dayName: 'Day 1 Push',
      dayOrder: 1,
      exercises: [
        { id: `${id}-e1`, name: 'Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 4, repRange: '6-8', targetRir: 1, restSeconds: 150, notes: 'Pause on chest' },
        { id: `${id}-e2`, name: 'Lateral Raise', muscleGroup: 'Shoulders', equipment: 'dumbbell', workingSets: 3, repRange: '12-15', targetRir: 2, restSeconds: 60 }
      ]
    }
  ],
  ...over
});

const renderView = async (props: Partial<React.ComponentProps<typeof PlansUploadView>> = {}) => {
  await act(async () => {
    root.render(<PlansUploadView profile={DEFAULT_PROFILE} onPlanActivated={() => {}} {...props} />);
  });
};

const buttonByText = (text: string): HTMLButtonElement => {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(text));
  if (!el) throw new Error(`No button containing "${text}"`);
  return el as HTMLButtonElement;
};
const buttonByLabel = (label: string): HTMLButtonElement => {
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`No button labelled "${label}"`);
  return el as HTMLButtonElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

beforeEach(() => {
  localStorage.clear();
  db.savePlans([makePlan('p1', 'Alpha Plan'), makePlan('p2', 'Beta Plan')]);
  db.setActivePlanId('p1');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PlansUploadView', () => {
  it('lists stored plans with real counts and marks the active one', async () => {
    await renderView();
    const text = container.textContent ?? '';
    expect(text).toContain('Alpha Plan');
    expect(text).toContain('Beta Plan');
    expect(text).toContain('1 training day · 2 exercises · 7 sets');
    expect(text).toContain('Active');
    // only the non-active plan offers "Set active"
    expect(Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Set active')).toHaveLength(1);
  });

  it('activates a plan, persists it and notifies the parent', async () => {
    const onPlanActivated = vi.fn();
    await renderView({ onPlanActivated });
    await click(buttonByText('Set active'));
    expect(db.getActivePlanId()).toBe('p2');
    expect(onPlanActivated).toHaveBeenCalledWith('p2');
    expect(db.getPlans().find((p) => p.id === 'p2')?.isActive).toBe(true);
    expect(db.getPlans().find((p) => p.id === 'p1')?.isActive).toBe(false);
  });

  it('duplicates a plan as an inactive, non-starter copy', async () => {
    await renderView();
    await click(buttonByLabel('Duplicate Alpha Plan'));
    const plans = db.getPlans();
    expect(plans).toHaveLength(3);
    const copy = plans.find((p) => p.name === 'Alpha Plan (Copy)');
    expect(copy).toBeTruthy();
    expect(copy?.isActive).toBe(false);
    expect(copy?.days[0].exercises).toHaveLength(2);
  });

  it('asks for confirmation before deleting and does nothing on cancel', async () => {
    await renderView();
    await click(buttonByLabel('Delete Beta Plan'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Beta Plan');
    expect(db.getPlans()).toHaveLength(2);
    await click(buttonByText('Cancel'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(db.getPlans()).toHaveLength(2);
  });

  it('deletes after confirmation and clears the active plan when it was the one deleted', async () => {
    await renderView();
    await click(buttonByLabel('Delete Alpha Plan'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('active plan');
    await click(buttonByText('Delete plan'));
    expect(db.getPlans().map((p) => p.id)).toEqual(['p2']);
    expect(db.getActivePlanId()).toBeNull();
  });

  it('shows plan details with ordered exercises and stored targets, and goes back', async () => {
    await renderView();
    await click(buttonByText('View'));
    const text = container.textContent ?? '';
    expect(text).toContain('Day 1 Push');
    expect(text).toContain('Bench Press');
    expect(text).toContain('4 × 6-8');
    expect(text).toContain('Rest 2 min 30 s');
    expect(text).toContain('RIR 1');
    expect(text).toContain('Pause on chest');
    expect(text).toContain('Chest, Shoulders');
    await click(buttonByText('All plans'));
    expect(container.textContent).toContain('Your plans');
  });

  it('only offers Overload rules when the parent supports it, and passes the plan id', async () => {
    await renderView();
    expect(container.textContent).not.toContain('Overload rules');
    await act(async () => root.unmount());
    root = createRoot(container);
    const onNavigateToProgression = vi.fn();
    await renderView({ onNavigateToProgression });
    await click(buttonByText('Overload rules'));
    expect(onNavigateToProgression).toHaveBeenCalledWith('p1');
  });

  it('shows an empty state when every plan is deleted', async () => {
    await renderView();
    for (const name of ['Alpha Plan', 'Beta Plan']) {
      await click(buttonByLabel(`Delete ${name}`));
      await click(buttonByText('Delete plan'));
    }
    expect(container.textContent).toContain('No workout plans yet');
  });

  it('saves a manually built plan with the edited fields', async () => {
    await renderView();
    await click(buttonByText('Build plan'));
    const nameInput = Array.from(container.querySelectorAll('input')).find((i) => i.value === 'My Custom Routine') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(nameInput, 'Mine');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText('Add training day'));
    await click(buttonByText('Save routine to library'));
    const saved = db.getPlans().find((p) => p.name === 'Mine');
    expect(saved).toBeTruthy();
    expect(saved?.days).toHaveLength(2);
    expect(saved?.days[0].exercises[0].name).toBe('Barbell Bench Press');
    expect(saved?.isActive).toBe(false);
  });
});
