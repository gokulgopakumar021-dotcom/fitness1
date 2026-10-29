import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../components/home/HomeView';
import { DEFAULT_PROFILE } from '../storage/db';
import { UserProfile, WorkoutSession } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Smoke test for the Home tab through the public props only. Detailed behaviour (data accuracy, empty and
 * error states, every navigation target) is covered in src/components/home/HomeView.test.tsx.
 */

let container: HTMLDivElement;
let root: Root;

const mockProfile: UserProfile = {
  ...DEFAULT_PROFILE,
  name: 'Marcus Vance',
  currentWeightKg: 83.5,
  goalWeightKg: 80.0,
  preferredUnit: 'kg',
  dailyCalorieTarget: 2400,
  dailyProteinTarget: 180,
  trainingSplitName: 'Push / Pull / Legs',
  trainingPhase: 'hypertrophy'
};

const renderHome = async (overrides: Partial<React.ComponentProps<typeof HomeView>> = {}) => {
  const props = {
    profile: mockProfile,
    activeSession: null,
    onNavigate: vi.fn(),
    onResumeActiveSession: vi.fn(),
    isDemoMode: false,
    onLoadDemoData: vi.fn(),
    onClearDemoData: vi.fn(),
    ...overrides
  };
  await act(async () => {
    root.render(<HomeView {...props} />);
  });
  return props;
};

const buttonWith = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));

const click = async (el: Element | undefined) => {
  expect(el).toBeDefined();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('HomeView Homepage Component', () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a greeting with the athlete name and the main sections', async () => {
    await renderHome();
    expect(container.querySelector('h1')?.textContent).toContain('Marcus');
    for (const label of ['Nutrition today', 'Recent progress', 'Coach Iron', 'Body weight']) {
      expect(container.querySelector(`section[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it('starts a workout and opens nutrition from the main cards', async () => {
    const { onNavigate } = await renderHome();
    await click(buttonWith('Start workout'));
    expect(onNavigate).toHaveBeenCalledWith('workouts');
    await click(buttonWith('Log a meal'));
    expect(onNavigate).toHaveBeenCalledWith('nutrition');
  });

  it('puts an active session first and resumes it', async () => {
    const activeSession: WorkoutSession = {
      id: 'active-session-1',
      dayName: 'Chest & Triceps',
      date: '2026-10-27',
      startTime: new Date().toISOString(),
      status: 'in_progress',
      exercises: [
        {
          id: 'ex-1',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          repRange: '8-10',
          targetRir: 2,
          restSeconds: 120,
          sets: []
        }
      ]
    };
    const { onResumeActiveSession } = await renderHome({ activeSession });
    expect(container.textContent).toContain('Workout in progress');
    expect(container.textContent).toContain('Chest & Triceps');
    expect(buttonWith('Start workout')).toBeUndefined();
    await click(buttonWith('Resume workout'));
    expect(onResumeActiveSession).toHaveBeenCalledTimes(1);
  });

  it('still reaches the other screens (overview, coach, body, timeline, settings)', async () => {
    const { onNavigate } = await renderHome();
    await click(buttonWith('Open Coach Iron'));
    await click(buttonWith('Log weight'));
    await click(buttonWith('Timeline'));
    await click(buttonWith('Overview'));
    await click(buttonWith('Settings'));
    for (const tab of ['trainer', 'body', 'timeline', 'dashboard', 'settings']) {
      expect(onNavigate).toHaveBeenCalledWith(tab);
    }
  });

  it('supports demo data loading and clearing controls', async () => {
    const { onLoadDemoData } = await renderHome();
    await click(buttonWith('Load demo data'));
    expect(onLoadDemoData).toHaveBeenCalledTimes(1);
    const cleared = await renderHome({ isDemoMode: true });
    await click(buttonWith('Clear demo data'));
    expect(cleared.onClearDemoData).toHaveBeenCalledTimes(1);
  });
});
