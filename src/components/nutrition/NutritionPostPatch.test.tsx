import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionGoalWizard } from './NutritionGoalWizard';
import { NutritionView } from './NutritionView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import type { DailyNutritionLog, UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const baseProfile = (over: Partial<UserProfile> = {}): UserProfile => ({
  ...DEFAULT_PROFILE,
  sex: 'male',
  age: 30,
  heightCm: 180,
  currentWeightKg: 80,
  primaryGoal: 'maintenance',
  bodyFatPercentage: undefined,
  dailyCalorieTarget: 3000,
  dailyProteinTarget: 200,
  dailyCarbsTarget: 350,
  dailyFatTarget: 80,
  onboardingCompleted: true,
  ...over
});

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};
const buttonByText = (text: string): HTMLButtonElement => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b as HTMLButtonElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

const dayBefore = (key: string): string => {
  const d = new Date(key);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

const log = (date: string, over: Partial<DailyNutritionLog> = {}): DailyNutritionLog => ({
  id: `nutr-${date}`,
  date,
  entries: [],
  waterMl: 0,
  targetCalories: 2200,
  targetProtein: 150,
  targetCarbs: 250,
  targetFat: 60,
  ...over
});

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

/* ─────────────── B. wizard sex dropdown ─────────────── */

describe('NutritionGoalWizard: sex selection matches the stored value', () => {
  const renderWizard = async (profile: UserProfile) => {
    const onClose = vi.fn();
    const onTargetsUpdated = vi.fn();
    await render(<NutritionGoalWizard isOpen onClose={onClose} profile={profile} onTargetsUpdated={onTargetsUpdated} />);
    await click(buttonByText('Continue')); // step 2 holds the body inputs
    return { onClose, onTargetsUpdated };
  };
  const sexSelect = () => container.querySelector('select[aria-label="Biological Sex"]') as HTMLSelectElement;
  const chooseSex = async (value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(sexSelect(), value);
      sexSelect().dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('offers all four supported values', async () => {
    await renderWizard(baseProfile());
    const values = Array.from(sexSelect().options).map((o) => o.value);
    expect(values).toEqual(['male', 'female', 'other', 'unspecified']);
  });

  it.each(['male', 'female', 'other', 'unspecified'] as const)('a stored %s profile is displayed as that value', async (sex) => {
    await renderWizard(baseProfile({ sex }));
    expect(sexSelect().value).toBe(sex);
  });

  it.each(['male', 'female', 'other', 'unspecified'] as const)(
    'saving without touching the dropdown keeps the stored sex %s (no silent conversion)',
    async (sex) => {
      db.saveProfile(baseProfile({ sex }));
      const { onTargetsUpdated } = await renderWizard(baseProfile({ sex }));
      await click(buttonByText('Continue')); // step 3
      await click(buttonByText('Continue')); // step 4
      await click(buttonByText('Update Daily Targets in Database'));
      expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
      expect(onTargetsUpdated.mock.calls[0][0].sex).toBe(sex);
      expect(db.getProfile().sex).toBe(sex);
    }
  );

  it('an explicit change to unspecified is saved as unspecified', async () => {
    const { onTargetsUpdated } = await renderWizard(baseProfile({ sex: 'male' }));
    await chooseSex('unspecified');
    expect(sexSelect().value).toBe('unspecified');
    await click(buttonByText('Continue'));
    await click(buttonByText('Continue'));
    await click(buttonByText('Update Daily Targets in Database'));
    expect(onTargetsUpdated.mock.calls[0][0].sex).toBe('unspecified');
  });

  it.each([
    ['missing', undefined],
    ['unsupported', 'Male']
  ])('a %s stored value shows a "Select" placeholder, is not shown as Male, and blocks progress', async (_n, stored) => {
    db.saveProfile(baseProfile());
    const before = localStorage.getItem('ironlog_profile_v1');
    await renderWizard(baseProfile({ sex: stored as unknown as UserProfile['sex'] }));
    expect(sexSelect().value).toBe('');
    expect(sexSelect().selectedOptions[0].textContent).toMatch(/Select/);
    expect(container.textContent).toMatch(/Select a supported option\./);
    expect(buttonByText('Continue').disabled).toBe(true);
    expect(localStorage.getItem('ironlog_profile_v1')).toBe(before); // nothing was written or converted
  });

  it('the placeholder disappears once a supported value is chosen, and progress resumes', async () => {
    await renderWizard(baseProfile({ sex: undefined as unknown as UserProfile['sex'] }));
    await chooseSex('female');
    expect(Array.from(sexSelect().options).map((o) => o.value)).toEqual(['male', 'female', 'other', 'unspecified']);
    expect(buttonByText('Continue').disabled).toBe(false);
  });
});

/* ─────────────── A. NutritionView historical targets ─────────────── */

describe('NutritionView: targets shown for the viewed day', () => {
  const today = getCurrentDayKey();
  const yesterday = dayBefore(today);
  const caption = () => container.querySelector('[data-testid="target-source-caption"]') as HTMLElement | null;
  const goBackOneDay = async () => click(container.querySelector('button[title="Previous Day"]') as HTMLElement);

  it("today uses the live profile targets even when today's stored log has older numbers; no caption", async () => {
    db.saveNutritionLogForDate(log(today)); // stale 2200 snapshot
    await render(<NutritionView profile={baseProfile()} />);
    expect(container.textContent).toContain('/ 3000');
    expect(container.textContent).not.toContain('/ 2200');
    expect(caption()).toBeNull();
  });

  it("a past day with a stored log shows that day's saved targets, with a caption", async () => {
    db.saveNutritionLogForDate(log(yesterday));
    await render(<NutritionView profile={baseProfile()} />);
    await goBackOneDay();
    expect(container.textContent).toContain(yesterday);
    expect(container.textContent).toContain('/ 2200');
    expect(container.textContent).toContain('/ 150g');
    expect(container.textContent).toContain('/ 250g');
    expect(container.textContent).toContain('/ 60g');
    expect(container.textContent).not.toContain('/ 3000');
    expect(caption()?.getAttribute('data-target-source')).toBe('snapshot');
  });

  it('a past day with no stored log shows current targets as a fallback and does not claim they were historical', async () => {
    db.saveProfile(baseProfile());
    await render(<NutritionView profile={baseProfile()} />);
    await goBackOneDay();
    expect(container.textContent).toContain('/ 3000');
    expect(caption()?.getAttribute('data-target-source')).toBe('fallback');
    expect(caption()?.textContent).toMatch(/No targets were saved for this day/);
    expect(db.getNutritionLogs().some((l) => l.date === yesterday)).toBe(false); // viewing does not persist anything
  });

  it('a stored past log with an unusable snapshot also falls back with the caption', async () => {
    db.saveNutritionLogForDate(log(yesterday, { targetCalories: 0 }));
    await render(<NutritionView profile={baseProfile()} />);
    await goBackOneDay();
    expect(container.textContent).toContain('/ 3000');
    expect(caption()?.getAttribute('data-target-source')).toBe('fallback');
  });

  it('navigating back to today restores live targets and removes the caption', async () => {
    db.saveNutritionLogForDate(log(yesterday));
    await render(<NutritionView profile={baseProfile()} />);
    await goBackOneDay();
    expect(caption()).not.toBeNull();
    await click(container.querySelector('button[title="Next Day"]') as HTMLElement);
    expect(container.textContent).toContain('/ 3000');
    expect(caption()).toBeNull();
  });

  it("viewing a past day never modifies that day's stored log", async () => {
    db.saveNutritionLogForDate(log(yesterday, { entries: [{ id: 'e1', name: 'Rice', mealCategory: 'lunch', quantity: 1, servingUnit: 'cup', calories: 200, protein: 4, carbs: 44, fat: 0 }] }));
    const before = localStorage.getItem('ironlog_nutrition_logs_v1');
    await render(<NutritionView profile={baseProfile()} />);
    await goBackOneDay();
    expect(localStorage.getItem('ironlog_nutrition_logs_v1')).toBe(before);
  });
});
