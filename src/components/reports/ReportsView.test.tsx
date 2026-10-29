import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsView } from './ReportsView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { UserProfile, WorkoutSession, DailyNutritionLog, BodyMetricEntry } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mockProfile: UserProfile = {
  ...DEFAULT_PROFILE,
  name: 'Marcus Vance',
  currentWeightKg: 82.0,
  goalWeightKg: 78.0,
  preferredUnit: 'kg',
  dailyCalorieTarget: 2400,
  dailyProteinTarget: 180,
  trainingSplitName: 'Upper / Lower',
  trainingPhase: 'hypertrophy',
  trainingDaysPerWeek: 4
};

const renderReports = async (profile: UserProfile = mockProfile) => {
  await act(async () => {
    root.render(<ReportsView profile={profile} />);
  });
};

describe('ReportsView Component', () => {
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

  it('renders page header and time period filter', async () => {
    await renderReports();

    expect(container.textContent).toContain('Training & Body Reports');
    expect(container.textContent).toContain('Performance Analytics · Longitudinal');
    expect(container.textContent).toContain('7 Days');
    expect(container.textContent).toContain('30 Days');
    expect(container.textContent).toContain('90 Days');
    expect(container.textContent).toContain('All Time');
  });

  it('renders metric cards with default zero/empty indicators when no data', async () => {
    await renderReports();

    expect(container.textContent).toContain('Sessions Completed');
    expect(container.textContent).toContain('Total Volume Load');
    expect(container.textContent).toContain('Daily Calories (Avg)');
    expect(container.textContent).toContain('Daily Protein (Avg)');
    expect(container.textContent).toContain('No training or metric data recorded yet');
  });

  it('renders empty personal records board when no completed workouts exist', async () => {
    await renderReports();

    expect(container.textContent).toContain('Personal Records (PR) Board');
    expect(container.textContent).toContain('No personal records recorded');
  });

  it('switches time filter period on click', async () => {
    await renderReports();

    const buttons = Array.from(container.querySelectorAll('button'));
    const sevenDayBtn = buttons.find((b) => b.textContent?.trim() === '7 Days');
    expect(sevenDayBtn).toBeDefined();

    await act(async () => {
      sevenDayBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Check that button became active (has aria-pressed="true")
    expect(sevenDayBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('displays recorded sessions, personal records, and volume correctly from storage', async () => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const mockSession: WorkoutSession = {
      id: 's-1',
      date: today,
      dayName: 'Upper Day',
      startTime: new Date(now.getTime() - 3600000).toISOString(),
      endTime: now.toISOString(),
      status: 'completed',
      exercises: [
        {
          id: 'ex-1',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 120,
          sets: [
            {
              id: 'set-1',
              setNumber: 1,
              type: 'working',
              weight: 100,
              reps: 8,
              completed: true,
              rpe: 8,
              timestamp: now.toISOString()
            }
          ]
        }
      ]
    };

    db.saveSessions([mockSession]);

    await renderReports();

    expect(container.textContent).toContain('Barbell Bench Press');
    expect(container.textContent).toContain('100');
    expect(container.textContent).toContain('TOP LOAD');
    expect(container.textContent).toContain('EST. 1RM');
  });
});
