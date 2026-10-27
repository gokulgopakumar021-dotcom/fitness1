import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionGoalWizard } from './NutritionGoalWizard';
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
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const numberInputs = () => Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];

const goToStep = async (n: 2 | 3 | 4) => {
  for (let s = 1; s < n; s++) await click(buttonByText('Continue'));
};
const saveButton = () => buttonByText('Update Daily Targets in Database');

const pastLog = (date: string): DailyNutritionLog => ({
  id: `nutr-${date}`,
  date,
  entries: [
    {
      id: 'e1',
      name: 'Rice',
      mealCategory: 'lunch',
      quantity: 1,
      servingUnit: 'cup',
      calories: 200,
      protein: 4,
      carbs: 44,
      fat: 0
    }
  ],
  waterMl: 500,
  targetCalories: 2600,
  targetProtein: 165,
  targetCarbs: 300,
  targetFat: 65
});

const renderWizard = async (
  props: Partial<React.ComponentProps<typeof NutritionGoalWizard>> & { profile?: UserProfile } = {}
) => {
  const onClose = vi.fn();
  const onTargetsUpdated = vi.fn();
  await render(
    <NutritionGoalWizard
      isOpen
      onClose={onClose}
      profile={props.profile ?? baseProfile()}
      currentLog={props.currentLog}
      onTargetsUpdated={onTargetsUpdated}
    />
  );
  return { onClose, onTargetsUpdated };
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

describe('NutritionGoalWizard: validation before saving', () => {
  it('blocks progress and shows inline errors for empty weight, and persists nothing', async () => {
    const { onClose, onTargetsUpdated } = await renderWizard();
    await goToStep(2);
    await setInput(numberInputs()[0], '');
    expect(container.textContent).toMatch(/Enter a weight between/);
    expect(buttonByText('Continue').disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onTargetsUpdated).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ['0', /weight/i],
    ['-5', /weight/i],
    ['abc', /weight/i]
  ])('weight %s is rejected, never saved as zero', async (value, msg) => {
    await renderWizard();
    await goToStep(2);
    await setInput(numberInputs()[0], value);
    expect(container.textContent).toMatch(msg);
    expect(buttonByText('Continue').disabled).toBe(true);
    expect(db.getProfile().currentWeightKg).toBe(DEFAULT_PROFILE.currentWeightKg);
    expect(db.getBodyMetrics()).toHaveLength(0);
  });

  it('shows errors for empty height and out-of-range age (no silent defaults)', async () => {
    await renderWizard();
    await goToStep(2);
    await setInput(numberInputs()[1], '');
    expect(container.textContent).toMatch(/Enter a height between/);
    await setInput(numberInputs()[1], '180');
    await setInput(numberInputs()[2], '12');
    expect(container.textContent).toMatch(/whole-number age/);
    expect(buttonByText('Continue').disabled).toBe(true);
  });

  it('rejects out-of-range body fat with a message, but a blank body fat is allowed', async () => {
    await renderWizard();
    await goToStep(2);
    const bf = numberInputs()[3];
    await setInput(bf, '75');
    expect(container.textContent).toMatch(/Body fat must be between/);
    expect(buttonByText('Continue').disabled).toBe(true);
    await setInput(bf, '');
    expect(container.textContent).not.toMatch(/Body fat must be between/);
    expect(buttonByText('Continue').disabled).toBe(false);
    expect(container.textContent).toMatch(/Mifflin-St Jeor/);
  });

  it('cannot reach the save step through the step tabs while inputs are invalid', async () => {
    await renderWizard();
    await goToStep(2);
    await setInput(numberInputs()[0], '0');
    await click(buttonByText('Macros & Save'));
    // stays on step 2 with the inline error; the save step is never shown
    expect(container.textContent).toContain('2. Weight, Activity & Body Fat %');
    expect(container.textContent).toMatch(/Enter a weight between/);
    expect(container.textContent).not.toContain('Update Daily Targets in Database');
  });
});

describe('NutritionGoalWizard: save flow', () => {
  it('saves once, notifies the parent once, closes, and ignores a second click (duplicate submit)', async () => {
    const { onClose, onTargetsUpdated } = await renderWizard();
    await goToStep(4);
    const btn = saveButton();
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const [updatedProfile] = onTargetsUpdated.mock.calls[0];
    expect(db.getProfile().dailyCalorieTarget).toBe(updatedProfile.dailyCalorieTarget);
    expect(db.getBodyMetrics()).toHaveLength(1);
    expect(db.getNutritionLogs().filter((l) => l.date === getCurrentDayKey())).toHaveLength(1);
  });

  it('does not use a success timeout: parent is notified synchronously after the writes', async () => {
    vi.useFakeTimers();
    try {
      const { onTargetsUpdated, onClose } = await renderWizard();
      await goToStep(4);
      await click(saveButton());
      expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on a storage failure: shows an error, stays open, does not report success or touch the parent, and retry works', async () => {
    const { onClose, onTargetsUpdated } = await renderWizard();
    await goToStep(4);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await click(saveButton());

    expect(container.textContent).toMatch(/could not be saved/i);
    expect(container.textContent).not.toContain('Targets Saved!');
    expect(onClose).not.toHaveBeenCalled();
    expect(onTargetsUpdated).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false); // retry allowed

    spy.mockRestore();
    await click(saveButton());
    expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(db.getBodyMetrics()).toHaveLength(1);
  });

  it('on a partial failure (log write): reports it, keeps the wizard open, and syncs the parent with what was actually persisted', async () => {
    const { onClose, onTargetsUpdated } = await renderWizard();
    await goToStep(4);
    const realSet = Storage.prototype.setItem;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (/nutrition/i.test(k)) throw new Error('QuotaExceededError');
      return realSet.call(this, k, v);
    });
    await click(saveButton());
    expect(container.textContent).toMatch(/profile targets were saved, but today's diary targets and today's body measurement were not/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(onTargetsUpdated).toHaveBeenCalledTimes(1); // profile did persist; parent mirrors storage
    expect(onTargetsUpdated.mock.calls[0][1]).toBeUndefined(); // no log was written
    expect(db.getBodyMetrics()).toHaveLength(0);
  });

  it('closing without saving writes nothing', async () => {
    const { onClose, onTargetsUpdated } = await renderWizard();
    await goToStep(2);
    await setInput(numberInputs()[0], '95');
    await click(container.querySelector('button[title="Close Wizard"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTargetsUpdated).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('a blank body-fat field does not erase the stored profile body fat or metric body fat', async () => {
    const profile = baseProfile({ bodyFatPercentage: 18 });
    db.addOrUpdateBodyMetric({
      id: 'bm-1',
      date: getCurrentDayKey(),
      weightKg: 81,
      bmi: 25,
      waistCm: 83,
      notes: 'my note',
      bodyFatPercentage: 18
    });
    const { onTargetsUpdated } = await renderWizard({ profile });
    await goToStep(2);
    await setInput(numberInputs()[3], '');
    await click(buttonByText('Continue'));
    await click(buttonByText('Continue'));
    await click(saveButton());
    expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
    expect(db.getProfile().bodyFatPercentage).toBe(18);
    expect(db.getBodyMetrics()).toHaveLength(1);
    expect(db.getBodyMetrics()[0]).toMatchObject({
      id: 'bm-1',
      bodyFatPercentage: 18,
      waistCm: 83,
      notes: 'my note',
      weightKg: 80
    });
  });
});

describe('NutritionGoalWizard: past diary dates', () => {
  it('tells the user which log is not changed and leaves the viewed historical log untouched', async () => {
    const past = pastLog('2020-01-01');
    db.saveNutritionLogForDate(past);
    const before = JSON.stringify(db.getNutritionLogForDate('2020-01-01'));
    const { onTargetsUpdated, onClose } = await renderWizard({ currentLog: past });
    await goToStep(4);
    expect(container.textContent).toContain("today's (" + getCurrentDayKey() + ') diary targets');
    expect(container.textContent).toContain('The diary for 2020-01-01, which you are viewing, will not be changed.');
    await click(saveButton());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.getNutritionLogForDate('2020-01-01'))).toBe(before);
    expect(db.getNutritionLogForDate(getCurrentDayKey()).targetCalories).toBe(db.getProfile().dailyCalorieTarget);
    // the viewed (past) log is not handed back for the view to adopt
    expect(onTargetsUpdated.mock.calls[0][1]).toBeUndefined();
  });

  it('viewing today returns today\'s updated log with food entries preserved', async () => {
    const todayLog = { ...pastLog(getCurrentDayKey()) };
    db.saveNutritionLogForDate(todayLog);
    const { onTargetsUpdated } = await renderWizard({ currentLog: todayLog });
    await goToStep(4);
    await click(saveButton());
    const returned = onTargetsUpdated.mock.calls[0][1] as DailyNutritionLog;
    expect(returned.date).toBe(getCurrentDayKey());
    expect(returned.entries).toHaveLength(1);
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries).toHaveLength(1);
  });
});

describe('NutritionGoalWizard: constrained plans', () => {
  it('discloses the floor, requires explicit confirmation, then saves the actual (floored) target', async () => {
    const profile = baseProfile({
      primaryGoal: 'fat_loss',
      sex: 'female',
      age: 60,
      heightCm: 150,
      currentWeightKg: 40
    });
    const { onTargetsUpdated } = await renderWizard({ profile });
    await goToStep(2);
    await click(buttonByText('Sedentary'));
    await click(buttonByText('Continue'));
    expect(container.textContent).toContain('Calorie floor applied');
    await click(buttonByText('Continue'));

    expect(container.textContent).toContain('Calorie floor applied');
    expect(saveButton().disabled).toBe(true); // not confirmed yet
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await click(checkbox);
    expect(saveButton().disabled).toBe(false);
    await click(saveButton());

    expect(onTargetsUpdated).toHaveBeenCalledTimes(1);
    expect(db.getProfile().dailyCalorieTarget).toBe(1200);
  });
});
