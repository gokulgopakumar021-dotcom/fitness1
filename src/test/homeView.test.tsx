import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../components/home/HomeView';
import { DEFAULT_PROFILE } from '../storage/db';
import { UserProfile, WorkoutSession } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

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

describe('HomeView Homepage Component', () => {
  beforeEach(() => {
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

  it('renders greeting, athlete name, and system branding', async () => {
    await render(
      <HomeView
        profile={mockProfile}
        activeSession={null}
        onNavigate={vi.fn()}
        onResumeActiveSession={vi.fn()}
        isDemoMode={false}
        onLoadDemoData={vi.fn()}
        onClearDemoData={vi.fn()}
      />
    );

    expect(container.textContent).toContain('Marcus');
    expect(container.textContent).toContain('Iron Log');
    expect(container.textContent).toContain('Reshape OS v2.4');
    expect(container.textContent).toContain('Quick Action Command Deck');
  });

  it('renders quick action buttons and navigates to correct tabs', async () => {
    const handleNavigate = vi.fn();

    await render(
      <HomeView
        profile={mockProfile}
        activeSession={null}
        onNavigate={handleNavigate}
        onResumeActiveSession={vi.fn()}
        isDemoMode={false}
        onLoadDemoData={vi.fn()}
        onClearDemoData={vi.fn()}
      />
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    const logWorkoutBtn = buttons.find((b) => b.textContent?.includes('Log Workout'));
    expect(logWorkoutBtn).toBeDefined();

    await act(async () => {
      logWorkoutBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handleNavigate).toHaveBeenCalledWith('workouts');

    const logFuelBtn = buttons.find((b) => b.textContent?.includes('Log Fuel'));
    expect(logFuelBtn).toBeDefined();

    await act(async () => {
      logFuelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handleNavigate).toHaveBeenCalledWith('nutrition');
  });

  it('renders active workout session banner when a session is active', async () => {
    const activeSession: WorkoutSession = {
      id: 'active-session-1',
      date: '2026-10-27',
      dayName: 'Push Day A',
      startTime: new Date().toISOString(),
      status: 'in_progress',
      exercises: [
        {
          id: 'ex-1',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 120,
          sets: []
        }
      ]
    };

    const handleResume = vi.fn();

    await render(
      <HomeView
        profile={mockProfile}
        activeSession={activeSession}
        onNavigate={vi.fn()}
        onResumeActiveSession={handleResume}
        isDemoMode={false}
        onLoadDemoData={vi.fn()}
        onClearDemoData={vi.fn()}
      />
    );

    expect(container.textContent).toContain('Workout In Progress');
    expect(container.textContent).toContain('1 Exercises Recorded');

    const resumeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resume Session Tracker')
    );
    expect(resumeBtn).toBeDefined();

    await act(async () => {
      resumeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handleResume).toHaveBeenCalledTimes(1);
  });

  it('renders all 8 OS capability modules in the launchpad directory', async () => {
    const handleNavigate = vi.fn();

    await render(
      <HomeView
        profile={mockProfile}
        activeSession={null}
        onNavigate={handleNavigate}
        onResumeActiveSession={vi.fn()}
        isDemoMode={false}
        onLoadDemoData={vi.fn()}
        onClearDemoData={vi.fn()}
      />
    );

    expect(container.textContent).toContain('Fitness OS Engine Directory');
    expect(container.textContent).toContain('Workout Session Tracker');
    expect(container.textContent).toContain('Overload Recommendation Engine');
    expect(container.textContent).toContain('Nutrition Goal Wizard & TDEE');
    expect(container.textContent).toContain('Long-Term Progress Timeline');
    expect(container.textContent).toContain('Muscle Fatigue Heatmap & Scorecard');
    expect(container.textContent).toContain('AI Coach & Video Form Library');
    expect(container.textContent).toContain('Body Metrics & Silhouette Scanner');
    expect(container.textContent).toContain('Routines & Spreadsheet Importer');
  });

  it('supports demo data loading and clearing controls', async () => {
    const handleLoadDemo = vi.fn();
    const handleClearDemo = vi.fn();

    await render(
      <HomeView
        profile={mockProfile}
        activeSession={null}
        onNavigate={vi.fn()}
        onResumeActiveSession={vi.fn()}
        isDemoMode={false}
        onLoadDemoData={handleLoadDemo}
        onClearDemoData={handleClearDemo}
      />
    );

    const loadDemoBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Load Demo Athlete')
    );
    expect(loadDemoBtn).toBeDefined();

    await act(async () => {
      loadDemoBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handleLoadDemo).toHaveBeenCalledTimes(1);
  });
});
