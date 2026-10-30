import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DreamPhysiqueModal } from './DreamPhysiqueModal';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile: UserProfile = { ...DEFAULT_PROFILE, name: 'Test', currentWeightKg: 82, preferredUnit: 'kg' };

const physique = {
  archetype: 'v_taper',
  title: 'Athletic V-Taper',
  imageUrl: 'https://example.com/physique.jpg',
  description: 'Broad shoulders and a narrow waist.',
  targetBodyFat: 10,
  muscleEmphasis: ['Shoulders & Upper Chest'],
  gender: 'male',
  isAiGenerated: true,
};

const blueprint = {
  gapAnalysis: {
    currentStatsSummary: '82kg at 18% body fat',
    targetStatsSummary: '80kg at 10% body fat',
    bodyCompositionVerdict: 'Lean bulk then cut',
    estTimelineWeeks: '32 weeks',
    keyFocusAreas: ['Add shoulder width', 'Tighten waist'],
  },
  nutritionPlan: {
    calorieTarget: 2800,
    strategy: 'Controlled surplus',
    macros: { proteinGrams: 190, proteinPerKg: '2.3 g/kg', carbsGrams: 320, fatsGrams: 80, hydrationLiters: 3.5 },
    nutrientTiming: ['Protein every 4 hours'],
    sampleMealPlan: [{ meal: 'Breakfast', foods: 'Oats and eggs', calories: 650, protein: 40 }],
    recommendedSupplements: ['Creatine monohydrate'],
  },
  workoutPlan: {
    planName: 'Dream V-Taper Split',
    trainingSplit: 'Push / Pull / Legs',
    description: 'Shoulder and lat emphasis.',
    days: [
      {
        dayName: 'Push Day',
        exercises: [
          { name: 'Overhead Press', muscleGroup: 'Shoulders', equipment: 'barbell', workingSets: 4, repRange: '6-8', targetRir: 1, restSeconds: 120, notes: 'Brace hard' },
        ],
      },
      { dayName: 'Rest Day', exercises: [] },
    ],
  },
  coachMessage: 'Consistency beats intensity.',
};

const GENERATE = '/api/ai-generate-physique';
const ANALYZE = '/api/ai-physique-analysis';
const ok = (body: unknown) => ({ json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

const mountModal = async (props: Partial<React.ComponentProps<typeof DreamPhysiqueModal>> = {}) => {
  await act(async () => {
    root.render(<DreamPhysiqueModal isOpen onClose={() => {}} profile={profile} {...props} />);
  });
};
const text = () => document.body.textContent ?? '';
const byText = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};
const typeInto = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const bodyOf = (url: string) => {
  const call = fetchMock.mock.calls.find((c) => c[0] === url) as [string, RequestInit];
  return JSON.parse(call[1].body as string);
};
/** Walk the wizard to the blueprint screen. */
const generate = async (props: Partial<React.ComponentProps<typeof DreamPhysiqueModal>> = {}) => {
  await mountModal(props);
  await click(byText('Generate Photo & Coach Analysis'));
};

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async (url: string) => (url === GENERATE ? ok({ success: true, physique }) : ok({ success: true, blueprint })));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DreamPhysiqueModal (on ui/Modal)', () => {
  it('renders nothing while closed', async () => {
    await mountModal({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is an accessible modal dialog named by its heading', async () => {
    await mountModal();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('Dream Physique Architect');
    expect(text()).toContain('Design Your Target Dream Physique');
    expect(byText('Adjust Vision')).toBeUndefined(); // only after a physique exists
  });

  it('sends the chosen archetype, gender, body fat, muscles and custom details', async () => {
    await mountModal();
    await click(byText('Sculpted Athletic Fitness'));
    expect(byText('Sculpted Athletic Fitness').getAttribute('aria-pressed')).toBe('true');
    expect(byText('Athletic Aesthetic V-Taper').getAttribute('aria-pressed')).toBe('false');

    const slider = document.getElementById('dream-body-fat') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('10% body fat');
    await typeInto(slider, '14');
    expect(text()).toContain('14% Body Fat');

    await click(byText('Glutes & Posterior Chain')); // select
    await click(byText('V-Taper Lats')); // deselect
    expect(byText('Glutes & Posterior Chain').getAttribute('aria-pressed')).toBe('true');
    expect(byText('V-Taper Lats').getAttribute('aria-pressed')).toBe('false');

    const custom = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === 'Custom Physique Details (Optional)') as HTMLLabelElement;
    await typeInto(document.getElementById(custom.htmlFor) as HTMLInputElement, 'Broad clavicles');

    await click(byText('Generate Photo & Coach Analysis'));
    expect(bodyOf(GENERATE)).toEqual({
      archetype: 'female_athletic_toned',
      gender: 'female',
      targetBodyFat: 14,
      customPrompt: 'Broad clavicles',
      muscleEmphasis: ['Shoulders & Upper Chest', 'Defined Core', 'Glutes & Posterior Chain'],
    });
  });

  it('shows a busy submit button while generating, then the photo and the analysis request', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await mountModal();
    await click(byText('Generate Photo & Coach Analysis'));
    const busy = byText('Visualizing Dream Physique with AI...');
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');

    await act(async () => release(ok({ success: true, physique })));
    expect((document.querySelector('img') as HTMLImageElement).alt).toBe('Athletic V-Taper');
    expect(text()).toContain('10% Target Body Fat');
    expect(byText('Adjust Vision')).toBeTruthy();
    expect(bodyOf(ANALYZE)).toEqual({ dreamPhysique: physique, currentProfile: profile });
    expect(text()).toContain('Verdict: Lean bulk then cut');
    expect(text()).toContain('Add shoulder width');
  });

  it('disables the 1-click actions and shows a loading state while the analysis is running', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockImplementation((url: string) => (url === GENERATE ? Promise.resolve(ok({ success: true, physique })) : new Promise((r) => (release = r))));
    await generate();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Coach Iron is calculating');
    expect(byText('Activate Target Diet in App').disabled).toBe(true);
    expect(byText('Save Workout Plan to Plans').disabled).toBe(true);

    await act(async () => release(ok({ success: true, blueprint })));
    expect(byText('Activate Target Diet in App').disabled).toBe(false);
    expect(byText('Save Workout Plan to Plans').disabled).toBe(false);
  });

  it('activates the target diet: saves the profile, notifies the parent and shows a toast that fades', async () => {
    const onProfileUpdated = vi.fn();
    await generate({ onProfileUpdated });
    vi.useFakeTimers();
    await click(byText('Activate Target Diet in App'));

    const stored = db.getProfile();
    expect(stored).toMatchObject({ dailyCalorieTarget: 2800, dailyProteinTarget: 190, dailyCarbsTarget: 320, dailyFatTarget: 80, primaryGoal: 'muscle_gain' });
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ dailyCalorieTarget: 2800, primaryGoal: 'muscle_gain' }));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Diet target activated! Calories: 2800 kcal, Protein: 190g');

    await act(async () => {
      vi.advanceTimersByTime(3600);
    });
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('saves the workout plan, activates it and notifies the parent', async () => {
    const onPlanCreated = vi.fn();
    await generate({ onPlanCreated });
    await click(byText('Save Workout Plan to Plans'));

    const saved = db.getPlans()[0];
    expect(saved.name).toBe('Dream V-Taper Split');
    expect(saved.isActive).toBe(true);
    expect(db.getActivePlanId()).toBe(saved.id);
    expect(saved.days.map((d) => d.dayName)).toEqual(['Push Day', 'Rest Day']);
    expect(saved.days[0].exercises[0]).toMatchObject({ name: 'Overhead Press', workingSets: 4, repRange: '6-8', targetRir: 1, restSeconds: 120 });
    expect(onPlanCreated).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }));
    expect(text()).toContain('saved & activated in your Workout library!');
  });

  it('switches between the overview, diet and workout panels', async () => {
    await generate();
    expect(text()).toContain('Consistency beats intensity.');
    expect(byText('Coach Iron Prescription').getAttribute('aria-pressed')).toBe('true');

    await click(byText('Daily Diet & Macros'));
    expect(text()).toContain('Protein every 4 hours');
    expect(text()).toContain('Oats and eggs');
    expect(text()).toContain('Creatine monohydrate');
    expect(text()).toContain('320g');
    expect(text()).not.toContain('Consistency beats intensity.');

    await click(byText('Custom Workout Routine'));
    expect(text()).toContain('Overhead Press');
    expect(text()).toContain('Brace hard');
    expect(text()).toContain('Rest, hydration, and central nervous system recovery.');
  });

  it('Adjust Vision returns to the configuration with the earlier choices kept', async () => {
    await mountModal();
    await click(byText('Classic Aesthetic Bodybuilder'));
    await click(byText('Generate Photo & Coach Analysis'));
    await click(byText('Adjust Vision'));
    expect(text()).toContain('Design Your Target Dream Physique');
    expect(byText('Classic Aesthetic Bodybuilder').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports a failed generation with a toast and stays on the configuration step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    await generate();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Failed to visualize physique. Please retry.');
    expect(text()).toContain('Design Your Target Dream Physique');
  });

  it('closes from the X and Escape', async () => {
    const onClose = vi.fn();
    await mountModal({ onClose });
    await click(document.querySelector('button[aria-label="Close"]') as HTMLElement);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('uses theme tokens only: no hard-coded palette colours, black scrims or hex values', async () => {
    await mountModal();
    const check = () => {
      const html = (document.querySelector('[role="dialog"]') as HTMLElement).innerHTML;
      expect(html).not.toMatch(/(lime|amber|sky|emerald|rose|fuchsia)-\d{3}/);
      expect(html).not.toMatch(/\b(bg|from|to|via)-black/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    };
    check();
    await click(byText('Generate Photo & Coach Analysis'));
    check();
    await click(byText('Daily Diet & Macros'));
    check();
    await click(byText('Custom Workout Routine'));
    check();
  });
});
