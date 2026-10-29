import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionView } from './NutritionView';
import { NutritionGoalGauge } from './NutritionGoalGauge';
import { MacroBar, percentOf } from './MacroBar';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import type { DailyNutritionLog, FoodEntry, UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  ...DEFAULT_PROFILE,
  sex: 'male',
  age: 30,
  heightCm: 180,
  currentWeightKg: 80,
  primaryGoal: 'maintenance',
  bodyFatPercentage: undefined,
  dailyCalorieTarget: 2000,
  dailyProteinTarget: 150,
  dailyCarbsTarget: 200,
  dailyFatTarget: 60,
  onboardingCompleted: true,
  ...over
});

const entry = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'e1',
  name: 'Chicken breast',
  mealCategory: 'lunch',
  quantity: 2,
  servingUnit: '100g',
  calories: 330,
  protein: 62,
  carbs: 0,
  fat: 7,
  isEstimate: false,
  timeLogged: '12:00',
  ...over
});

const seedToday = (entries: FoodEntry[]) => {
  const today = getCurrentDayKey();
  const log: DailyNutritionLog = {
    id: `nutr-${today}`,
    date: today,
    entries,
    waterMl: 0,
    targetCalories: 2000,
    targetProtein: 150,
    targetCarbs: 200,
    targetFat: 60
  };
  db.saveNutritionLogForDate(log);
};

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const buttonByText = (text: string): HTMLButtonElement => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b as HTMLButtonElement;
};

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Nutrition summary uses real diary data, once', () => {
  it('shows logged totals against the profile targets with a single "left" line', async () => {
    seedToday([entry(), entry({ id: 'e2', name: 'Rice', mealCategory: 'dinner', calories: 200, protein: 4, carbs: 45, fat: 0 })]);
    await render(<NutritionView profile={profile()} />);

    const summary = container.querySelector('[data-testid="nutrition-summary"]') as HTMLElement;
    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain('530');
    expect(summary.textContent).toContain('/ 2000');
    expect(summary.textContent).toContain('66g'); // 62 + 4 protein
    expect(summary.textContent).toContain('/ 150g');
    expect(container.textContent).toContain('1470 kcal left'); // 2000 - 530
    // the remaining-calorie figure is stated exactly once on the whole screen
    expect(container.textContent!.match(/kcal left/g)).toHaveLength(1);
  });

  it('groups entries under their meal and shows the meal subtotal', async () => {
    seedToday([entry()]);
    await render(<NutritionView profile={profile()} />);
    const lunch = container.querySelector('article[aria-label="Lunch"]') as HTMLElement;
    expect(lunch.textContent).toContain('Chicken breast');
    expect(lunch.textContent).toContain('330 kcal · 62g protein');
    const breakfast = container.querySelector('article[aria-label="Breakfast"]') as HTMLElement;
    expect(breakfast.textContent).toContain('No foods logged in Breakfast yet');
  });
});

describe('Nutrition gauge edge cases', () => {
  const renderGauge = (over: Partial<React.ComponentProps<typeof NutritionGoalGauge>> = {}) =>
    render(
      <NutritionGoalGauge
        currentCalories={0}
        targetCalories={2000}
        currentProtein={0}
        targetProtein={150}
        currentCarbs={0}
        targetCarbs={200}
        currentFat={0}
        targetFat={60}
        profile={profile()}
        onOpenWizard={vi.fn()}
        {...over}
      />
    );

  it('handles an empty day without NaN or a status badge', async () => {
    await renderGauge();
    expect(container.textContent).toContain('2000 kcal left');
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(container.textContent).not.toContain('On target');
  });

  it('handles a missing calorie target without NaN, Infinity or a fake percentage', async () => {
    await renderGauge({ currentCalories: 500, targetCalories: 0, targetProtein: 0, targetCarbs: 0, targetFat: 0 });
    expect(container.textContent).toContain('No calorie target set');
    expect(container.textContent).toContain('No target set');
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(container.textContent).not.toContain('% of target');
  });

  it('reports exceeded goals as "over" for calories and macros', async () => {
    await renderGauge({ currentCalories: 2600, currentProtein: 180 });
    expect(container.textContent).toContain('600 kcal over');
    expect(container.textContent).toContain('30g over');
    expect(container.textContent).toContain('130% of target');
  });

  it('labels the calorie dial and macro bars for assistive tech', async () => {
    await renderGauge({ currentCalories: 1000 });
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('50% of calorie target logged');
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Gauge view"]')).not.toBeNull();
  });

  it('percentOf never returns NaN/Infinity', () => {
    expect(percentOf(10, 0)).toBe(0);
    expect(percentOf(NaN, 100)).toBe(0);
    expect(percentOf(150, 100)).toBe(150);
  });

  it('MacroBar fills use design-system chart tokens, not hex colours', async () => {
    await render(<MacroBar macro="carbs" current={50} target={100} />);
    const html = container.innerHTML;
    expect(html).toContain('var(--chart-2)');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('Removing a food entry', () => {
  it('asks for confirmation and only deletes when confirmed', async () => {
    seedToday([entry()]);
    await render(<NutritionView profile={profile()} />);

    await click(container.querySelector('button[aria-label="Remove Chicken breast"]')!);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(1);

    await click(buttonByText('Keep'));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(1);

    await click(container.querySelector('button[aria-label="Remove Chicken breast"]')!);
    await click(buttonByText('Remove'));
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(0);
    expect(container.textContent).not.toContain('Chicken breast');
  });
});

describe('Diary tools', () => {
  it('tells the user when there is nothing to copy from the previous day', async () => {
    await render(<NutritionView profile={profile()} />);
    await click(buttonByText('Copy previous day'));
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/nothing to copy/i);
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(0);
  });

  it('offers a way back to today when viewing another day', async () => {
    await render(<NutritionView profile={profile()} />);
    expect(container.textContent).toContain('Today');
    await click(container.querySelector('button[title="Previous Day"]')!);
    expect(container.textContent).toContain('Yesterday');
    await click(buttonByText('Jump to today'));
    expect(container.textContent).toContain(getCurrentDayKey());
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Jump to today')).toBe(false);
  });
});

describe('Add-food and custom-food dialogs', () => {
  it('opens an accessible add-food dialog scoped to the chosen meal and logs a food', async () => {
    await render(<NutritionView profile={profile()} />);
    await click(container.querySelector('button[aria-label="Add food to Breakfast"]')!);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Add food to Breakfast');

    const firstFood = dialog.querySelector('ul[aria-label="Food results"] button') as HTMLButtonElement;
    expect(firstFood).not.toBeNull();
    await click(firstFood);
    expect(firstFood.getAttribute('aria-pressed')).toBe('true');
    await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Log Food Entry')!);

    const logged = db.getNutritionLogForDate(getCurrentDayKey()).entries;
    expect(logged).toHaveLength(1);
    expect(logged[0].mealCategory).toBe('breakfast');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('custom food: Save is disabled until a name is entered, and every field is labelled', async () => {
    await render(<NutritionView profile={profile()} />);
    await click(container.querySelector('button[aria-label="Add custom food to Dinner"]')!);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const save = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Save & Log Entry')) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    dialog.querySelectorAll('input').forEach((input) => {
      expect(dialog.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    });
  });
});
