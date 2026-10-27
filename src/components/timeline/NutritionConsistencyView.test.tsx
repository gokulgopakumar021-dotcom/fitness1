import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionConsistencyView } from './NutritionConsistencyView';
import { DailyNutritionLog, UserProfile } from '../../types';
import { DateRange } from '../../utils/timelineEngine';
import { DEFAULT_PROFILE } from '../../storage/db';

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
  name: 'Alex Rivera',
  age: 29,
  sex: 'male',
  heightCm: 178,
  currentWeightKg: 82,
  goalWeightKg: 79,
  primaryGoal: 'fat_loss',
  trainingExperience: 'intermediate',
  trainingDaysPerWeek: 4,
  preferredUnit: 'kg',
  dailyCalorieTarget: 2200,
  dailyProteinTarget: 175,
  dailyCarbsTarget: 220,
  dailyFatTarget: 65
};

const dateRange: DateRange = {
  startDate: '2026-03-01',
  endDate: '2026-03-05'
};

const mockLogs: DailyNutritionLog[] = [
  {
    id: 'log-1',
    date: '2026-03-01',
    targetCalories: 2200,
    targetProtein: 175,
    targetCarbs: 220,
    targetFat: 65,
    waterMl: 2500,
    entries: [
      {
        id: 'e1',
        name: 'Meal 1',
        mealCategory: 'lunch',
        quantity: 1,
        servingUnit: 'portion',
        calories: 2200, // exact 0%
        protein: 175,
        carbs: 220,
        fat: 65
      }
    ]
  },
  {
    id: 'log-2',
    date: '2026-03-02',
    targetCalories: 2200,
    targetProtein: 175,
    targetCarbs: 220,
    targetFat: 65,
    waterMl: 2200,
    entries: [
      {
        id: 'e2',
        name: 'Meal 2',
        mealCategory: 'dinner',
        quantity: 1,
        servingUnit: 'portion',
        calories: 2800, // +27.3% (Out of band)
        protein: 170,   // -2.9% (Within band)
        carbs: 210,     // -4.5% (Within band)
        fat: 105        // +61.5% (Out of band)
      }
    ]
  }
];

describe('NutritionConsistencyView Component', () => {
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

  it('renders benchmark targets and +-10% tolerance bands', async () => {
    await render(
      <NutritionConsistencyView
        logs={mockLogs}
        profile={mockProfile}
        dateRange={dateRange}
      />
    );

    expect(container.textContent).toContain('Nutrition Target Consistency');
    expect(container.textContent).toContain('±10% Tolerance Band');
    expect(container.textContent).toContain('Band: 1980 – 2420 kcal');
    expect(container.textContent).toContain('Band: 158 – 193 g');
  });

  it('renders calculated adherence rates accurately', async () => {
    await render(
      <NutritionConsistencyView
        logs={mockLogs}
        profile={mockProfile}
        dateRange={dateRange}
      />
    );

    // 1 of 2 days met calorie target (50%)
    expect(container.textContent).toContain('(1/2 days)');
    // 2 of 2 days met protein target (100%)
    expect(container.textContent).toContain('(2/2 days)');
  });

  it('allows filtering between compliant and out-of-band days', async () => {
    await render(
      <NutritionConsistencyView
        logs={mockLogs}
        profile={mockProfile}
        dateRange={dateRange}
      />
    );

    // Initial shows all 2 logged days
    expect(container.textContent).toContain('2026-03-01');
    expect(container.textContent).toContain('2026-03-02');

    // Click "Within ±10%" filter
    const buttons = Array.from(container.querySelectorAll('button'));
    const compliantButton = buttons.find((b) => b.textContent?.includes('Within ±10%'));
    expect(compliantButton).toBeDefined();

    await act(async () => {
      compliantButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('2026-03-01');
    expect(container.textContent).not.toContain('2026-03-02');

    // Click "Out of Band" filter
    const outOfBandButton = buttons.find((b) => b.textContent?.includes('Out of Band'));
    expect(outOfBandButton).toBeDefined();

    await act(async () => {
      outOfBandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('2026-03-01');
    expect(container.textContent).toContain('2026-03-02');
  });

  it('shows empty state when no days were logged in window', async () => {
    await render(
      <NutritionConsistencyView
        logs={[]}
        profile={mockProfile}
        dateRange={dateRange}
      />
    );

    expect(container.textContent).toContain('No food logs recorded in this period.');
  });

  it('triggers onOpenWizard when Adjust Wizard Targets is clicked', async () => {
    const handleOpenWizard = vi.fn();
    await render(
      <NutritionConsistencyView
        logs={mockLogs}
        profile={mockProfile}
        dateRange={dateRange}
        onOpenWizard={handleOpenWizard}
      />
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    const wizardButton = buttons.find((b) => b.textContent?.includes('Adjust Wizard Targets'));
    expect(wizardButton).toBeDefined();

    await act(async () => {
      wizardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(handleOpenWizard).toHaveBeenCalledTimes(1);
  });
});
