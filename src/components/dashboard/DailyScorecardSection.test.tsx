import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyNutritionLog, DailySleepLog, WorkoutPlan, WorkoutSession } from '../../types';
import { LOAD_DISCLAIMER } from '../../utils/muscleMap';
import { DailyScorecardSection, type DailyScorecardSectionProps } from './DailyScorecardSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Reference clock: Monday 26 Oct 2026, 15:00 LOCAL. All dates are built with local constructors. */
const NOW = new Date(2026, 9, 26, 15, 0, 0);
const TODAY = '2026-10-26';
const YESTERDAY = '2026-10-25';
const PROFILE = { onboardingCompleted: true, dailyCalorieTarget: 2600, dailyProteinTarget: 165 };

const PLAN = {
  id: 'p1',
  name: 'Plan',
  days: [{ id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [{ id: 'e1', workingSets: 3 }, { id: 'e2', workingSets: 3 }, { id: 'e3', workingSets: 4 }] }],
} as unknown as WorkoutPlan;

const sessionOn = (day: number, completedSets: number, extra: Record<string, unknown> = {}): WorkoutSession =>
  ({
    id: `s-${day}-${completedSets}-${String(extra.isDemo)}`,
    planId: 'p1',
    dayId: 'd1',
    dayName: 'Push',
    date: `2026-10-${day}`,
    startTime: new Date(2026, 9, day, 10, 0).toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'lex',
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        equipment: 'barbell',
        repRange: '8-10',
        targetRir: 2,
        restSeconds: 90,
        sets: Array.from({ length: completedSets }, (_, i) => ({ id: `set${i}`, setNumber: i + 1, type: 'working', weight: 60, reps: 8, completed: true, timestamp: '' })),
      },
    ],
    ...extra,
  }) as unknown as WorkoutSession;

const food = (calories: number, protein: number) => ({ id: `f${calories}`, name: 'Food', mealCategory: 'lunch', quantity: 1, servingUnit: 'g', calories, protein, carbs: 200, fat: 60, fiber: 25 });
const nutri = (date: string, entries: unknown[], extra: Record<string, unknown> = {}): DailyNutritionLog =>
  ({ id: `n-${date}-${String(extra.isDemo)}`, date, entries, waterMl: 0, targetCalories: 2600, targetProtein: 165, targetCarbs: 300, targetFat: 65, ...extra }) as unknown as DailyNutritionLog;
const slept = (date: string, hoursSlept: number, extra: Record<string, unknown> = {}): DailySleepLog =>
  ({ id: `sl-${date}-${String(extra.isDemo)}`, date, hoursSlept, quality: 80, restingHeartRate: 54, hrvMs: 68, ...extra }) as unknown as DailySleepLog;

const base = (over: Partial<DailyScorecardSectionProps> = {}): DailyScorecardSectionProps => ({
  sessions: [],
  plans: [PLAN],
  nutritionLogs: [],
  sleepLogs: [],
  profile: PROFILE,
  now: NOW,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const fetchSpy = vi.fn();
const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');

const mount = async (props: DailyScorecardSectionProps) => {
  await act(async () => {
    root.render(<DailyScorecardSection {...props} />);
  });
};
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const card = (id: string) => byTestId(`scorecard-card-${id}`);
const buttonByLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const shownDate = () => container.querySelector('[data-testid="scorecard-date"] time')!.getAttribute('datetime');

const FULL_TODAY = () =>
  base({
    sessions: [sessionOn(26, 10)],
    nutritionLogs: [nutri(TODAY, [food(2600, 165)], { waterMl: 750 })],
    sleepLogs: [slept(TODAY, 7.5)],
  });

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchSpy.mockReset();
  xhrOpen.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('structure and accessibility', () => {
  it('renders one labelled section with an h2 and five h3 category cards in order', async () => {
    await mount(base());
    const section = byTestId('daily-scorecard-section');
    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('aria-label')).toBe('Daily health scorecard');
    expect(container.querySelector('h2')?.textContent).toBe('Daily health scorecard');
    expect([...container.querySelectorAll('article h3')].map((h) => h.textContent)).toEqual(['Workout', 'Nutrition', 'Hydration', 'Sleep', 'Recovery']);
    for (const article of container.querySelectorAll('article')) {
      const labelId = article.getAttribute('aria-labelledby')!;
      expect(container.querySelector(`#${CSS.escape(labelId)}`)).toBeTruthy();
    }
  });

  it('has named, keyboard-reachable day controls and a labelled group', async () => {
    await mount(base());
    expect(container.querySelector('[role="group"][aria-label="Choose day"]')).toBeTruthy();
    for (const label of ['Previous day', 'Next day']) {
      const b = buttonByLabel(label);
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
    }
    expect(byTestId('scorecard-date').getAttribute('aria-live')).toBe('polite');
  });

  it('shows every status as visible text, not colour alone', async () => {
    await mount(FULL_TODAY());
    expect(card('workout').textContent).toContain('Scored');
    expect(card('hydration').textContent).toContain('Information only');
    expect(card('recovery').textContent).toContain('Information only');
    await mount(base());
    expect(card('workout').textContent).toContain('No data');
  });

  it('gives progress bars accessible names', async () => {
    await mount(FULL_TODAY());
    const bars = [...container.querySelectorAll('[role="progressbar"]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) expect(b.getAttribute('aria-label')).toBeTruthy();
  });

  it('uses no fixed pixel widths that could overflow narrow screens', async () => {
    await mount(FULL_TODAY());
    const html = byTestId('daily-scorecard-section').outerHTML;
    expect(html).not.toMatch(/style="[^"]*width:\s*\d{3,}px/);
    expect(container.querySelector('.grid')?.className).toContain('grid-cols-1');
  });
});

describe('overview', () => {
  it('shows earned / eligible maximum, percentage and coverage', async () => {
    await mount(FULL_TODAY());
    expect(byTestId('scorecard-score').textContent).toBe('70 / 70 pts');
    expect(byTestId('scorecard-coverage').textContent).toBe('100% of eligible points · 3 of 5 categories scored');
    expect(byTestId('scorecard-completeness').textContent).toContain('Scored:Workout, Nutrition, Sleep');
    expect(byTestId('scorecard-completeness').textContent).toContain('Hydration (information only), Recovery (information only)');
  });

  it('leaves missing categories out of the eligible maximum instead of scoring zero', async () => {
    await mount(base({ sleepLogs: [slept(TODAY, 8)], sessions: [sessionOn(26, 10)] }));
    expect(byTestId('scorecard-score').textContent).toBe('45 / 45 pts');
    expect(byTestId('scorecard-completeness').textContent).toContain('Nutrition (no data)');
  });

  it('shows Insufficient data with every category still visible when nothing is logged', async () => {
    await mount(base());
    expect(byTestId('scorecard-insufficient').textContent).toBe('Insufficient data');
    expect(byTestId('scorecard-overview').textContent).toContain('Nothing is logged for this day yet.');
    expect(container.querySelector('[data-testid="scorecard-score"]')).toBeNull();
    expect(container.querySelectorAll('article')).toHaveLength(5);
  });

  it('shows Insufficient data with a reason when only one category is scored', async () => {
    await mount(base({ sleepLogs: [slept(TODAY, 8)] }));
    expect(byTestId('scorecard-insufficient')).toBeTruthy();
    expect(byTestId('scorecard-overview').textContent).toContain('at least 2 scored categories worth 40 or more points');
    expect(card('sleep').getAttribute('data-status')).toBe('scored');
  });

  it('explains what the score represents and never shows a score without data', async () => {
    await mount(base());
    expect(byTestId('scorecard-overview').textContent).toContain('never counted as zero');
    expect(byTestId('scorecard-overview').textContent).not.toMatch(/\d+ \/ \d+ pts/);
  });
});

describe('category cards', () => {
  it('workout: points, measured value, target and progress', async () => {
    await mount(base({ sessions: [sessionOn(26, 5)] }));
    const w = card('workout').textContent!;
    expect(byTestId('scorecard-points-workout').textContent).toBe('10 of 20 pts');
    expect(w).toContain('Working sets completed5');
    expect(w).toContain('Planned working sets10');
    expect(w).toContain('50% of planned sets');
  });

  it('nutrition: measured value against personal targets, progress bars, information-only macros', async () => {
    await mount(base({ nutritionLogs: [nutri(TODAY, [food(2600, 165)])] }));
    const n = card('nutrition').textContent!;
    expect(n).toContain('2,600 of 2,600 kcal');
    expect(n).toContain('165 of 165 g');
    expect(n).toContain('Carbs / fat / fiber (information only)');
    expect(n).toContain('200 g / 60 g / 25 g');
    expect(card('nutrition').querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  });

  it('nutrition without personal targets is Insufficient data and shows no target', async () => {
    await mount(base({ profile: { ...PROFILE, onboardingCompleted: false }, nutritionLogs: [nutri(TODAY, [food(2600, 165)])] }));
    const c = card('nutrition');
    expect(c.getAttribute('data-status')).toBe('insufficient_data');
    expect(c.textContent).toContain('Insufficient data');
    expect(c.textContent).toContain('Not scored');
    expect(c.textContent).not.toContain('2,600 of');
    expect(c.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  it('hydration: shows logged water with "No target set" and is never scored', async () => {
    await mount(FULL_TODAY());
    const h = card('hydration').textContent!;
    expect(h).toContain('750 ml');
    expect(h).toContain('No target set');
    expect(h).toContain('Not scored');
    expect(card('hydration').querySelector('[data-testid="scorecard-action-hydration"]')).toBeNull();
  });

  it('hydration with nothing logged says No data', async () => {
    await mount(base());
    expect(card('hydration').getAttribute('data-status')).toBe('no_data');
    expect(card('hydration').textContent).not.toContain('No target set');
  });

  it('sleep: duration against the labelled default guideline, extras marked information only', async () => {
    await mount(base({ sleepLogs: [slept(TODAY, 7.5)] }));
    const s = card('sleep').textContent!;
    expect(s).toContain('Sleep logged7.5 h');
    expect(s).toContain('7–9 h (not personalized)');
    expect(s).toContain('Self-rated quality (information only)');
    expect(s).toContain('Resting heart rate (information only)');
    expect(s).toContain('HRV (information only)');
    expect(s).toContain('not a personalized target');
  });

  it('recovery: informational, shows the Muscle Map disclaimer, makes no readiness or diagnostic claim', async () => {
    await mount(base({ sessions: [sessionOn(26, 5)] }));
    const r = card('recovery');
    expect(r.getAttribute('data-status')).toBe('informational');
    expect(r.textContent).toContain('Not scored');
    expect(r.textContent).toContain(LOAD_DISCLAIMER);
    expect(r.textContent).not.toMatch(/readiness|fatigue|injury risk|overtrain/i);
    expect(byTestId('scorecard-recovery-load').textContent).toContain('Not enough logged history yet');
  });

  it('recovery with no workouts says so plainly', async () => {
    await mount(base());
    expect(byTestId('scorecard-recovery-load').textContent).toContain('No completed workouts logged yet.');
  });
});

describe('actions are grounded in logged data', () => {
  it('nutrition today: remaining calories and protein vs the personal target', async () => {
    await mount(base({ nutritionLogs: [nutri(TODAY, [food(1000, 60)])] }));
    expect(byTestId('scorecard-action-nutrition').textContent).toBe('Next: 1600 kcal and 105 g protein remaining to reach your daily targets.');
    expect(card('nutrition').textContent).toContain('so far; today is not finished');
    expect(card('nutrition').textContent).toContain('Scored · partial');
  });

  it('no remaining-targets action when targets are missing or the day is past', async () => {
    await mount(base({ profile: null, nutritionLogs: [nutri(TODAY, [food(1000, 60)])] }));
    expect(container.querySelector('[data-testid="scorecard-action-nutrition"]')).toBeNull();
    await mount(base({ nutritionLogs: [nutri(YESTERDAY, [food(1000, 60)])] }));
    await click(buttonByLabel('Previous day'));
    expect(container.querySelector('[data-testid="scorecard-action-nutrition"]')).toBeNull();
  });

  it('sleep: shows the gap to the guideline only when there is one', async () => {
    await mount(base({ sleepLogs: [slept(TODAY, 6)] }));
    expect(byTestId('scorecard-action-sleep').textContent).toBe('Next: 1 h below the 7 h guideline minimum.');
    await mount(base({ sleepLogs: [slept(TODAY, 8)] }));
    expect(container.querySelector('[data-testid="scorecard-action-sleep"]')).toBeNull();
  });

  it('workout: offers to resume only when a session is in progress', async () => {
    await mount(base({ sessions: [sessionOn(26, 3, { status: 'in_progress' })] }));
    expect(card('workout').getAttribute('data-status')).toBe('in_progress');
    expect(byTestId('scorecard-action-workout').textContent).toContain('Resume your in-progress workout');
    await mount(base({ sessions: [sessionOn(26, 10)] }));
    expect(container.querySelector('[data-testid="scorecard-action-workout"]')).toBeNull();
  });

  it('no workout logged: no action and no assumption about a rest day', async () => {
    await mount(base());
    const w = card('workout').textContent!;
    expect(w).toContain('does not assume a rest day');
    expect(container.querySelector('[data-testid="scorecard-action-workout"]')).toBeNull();
  });
});

describe('date navigation', () => {
  it('starts on Today with Next disabled', async () => {
    await mount(base());
    expect(shownDate()).toBe(TODAY);
    expect(byTestId('scorecard-date').textContent).toContain('Today');
    expect(buttonByLabel('Next day').disabled).toBe(true);
    expect(buttonByText('Back to today')).toBeUndefined();
  });

  it('moves back day by day and forward again, never past today', async () => {
    await mount(base());
    await click(buttonByLabel('Previous day'));
    expect(shownDate()).toBe(YESTERDAY);
    expect(byTestId('scorecard-date').textContent).toContain('Yesterday');
    expect(buttonByLabel('Next day').disabled).toBe(false);
    await click(buttonByLabel('Previous day'));
    await click(buttonByLabel('Previous day'));
    expect(shownDate()).toBe('2026-10-23');
    expect(byTestId('scorecard-date').textContent).not.toContain('Yesterday');
    await click(buttonByLabel('Next day'));
    await click(buttonByLabel('Next day'));
    await click(buttonByLabel('Next day'));
    expect(shownDate()).toBe(TODAY);
    expect(buttonByLabel('Next day').disabled).toBe(true);
    await click(buttonByLabel('Next day'));
    expect(shownDate()).toBe(TODAY);
  });

  it('Back to today returns from an earlier day', async () => {
    await mount(base());
    await click(buttonByLabel('Previous day'));
    await click(buttonByLabel('Previous day'));
    await click(buttonByText('Back to today')!);
    expect(shownDate()).toBe(TODAY);
    expect(buttonByText('Back to today')).toBeUndefined();
  });

  it('evaluates each selected date consistently: records are attributed to their own day', async () => {
    await mount(
      base({
        sessions: [sessionOn(26, 10), sessionOn(25, 5)],
        nutritionLogs: [nutri(TODAY, [food(2600, 165)]), nutri(YESTERDAY, [food(1300, 82.5)])],
        sleepLogs: [slept(TODAY, 8), slept(YESTERDAY, 6)],
      })
    );
    expect(byTestId('scorecard-score').textContent).toBe('70 / 70 pts');
    await click(buttonByLabel('Previous day'));
    expect(shownDate()).toBe(YESTERDAY);
    expect(card('workout').textContent).toContain('Working sets completed5');
    expect(card('nutrition').textContent).toContain('1,300 of 2,600 kcal');
    expect(card('sleep').textContent).toContain('Sleep logged6 h');
    await click(buttonByLabel('Next day'));
    expect(card('nutrition').textContent).toContain('2,600 of 2,600 kcal');
    expect(card('sleep').textContent).toContain('Sleep logged8 h');
  });

  it('an earlier day with no data does not inherit today’s records', async () => {
    await mount(FULL_TODAY());
    await click(buttonByLabel('Previous day'));
    expect(byTestId('scorecard-insufficient')).toBeTruthy();
    expect(card('workout').getAttribute('data-status')).toBe('no_data');
  });

  it('follows the clock across local midnight when no day was picked', async () => {
    await mount(base());
    expect(shownDate()).toBe(TODAY);
    await mount(base({ now: new Date(2026, 9, 27, 0, 5) }));
    expect(shownDate()).toBe('2026-10-27');
    expect(byTestId('scorecard-date').textContent).toContain('Today');
  });

  it('never shows a future day, even if the clock moves backwards after selecting a later day', async () => {
    await mount(base({ now: new Date(2026, 9, 28, 9, 0) }));
    await click(buttonByLabel('Previous day'));
    expect(shownDate()).toBe('2026-10-27');
    await mount(base({ now: new Date(2026, 9, 26, 9, 0) }));
    expect(shownDate()).toBe(TODAY);
  });
});

describe('demo versus real data', () => {
  const sessions = [sessionOn(26, 10), sessionOn(26, 2, { isDemo: true })];
  const nutritionLogs = [nutri(TODAY, [food(2600, 165)]), nutri(TODAY, [food(1000, 50)], { isDemo: true })];
  const sleepLogs = [slept(TODAY, 8), slept(TODAY, 5, { isDemo: true })];

  it('real mode uses only real records and shows no demo badge', async () => {
    await mount(base({ sessions, nutritionLogs, sleepLogs }));
    expect(card('workout').textContent).toContain('Working sets completed10');
    expect(card('nutrition').textContent).toContain('2,600 of 2,600 kcal');
    expect(card('sleep').textContent).toContain('Sleep logged8 h');
    expect(container.textContent).not.toContain('Demo data');
  });

  it('demo mode uses only demo records and says so', async () => {
    await mount(base({ sessions, nutritionLogs, sleepLogs, isDemoMode: true }));
    expect(card('workout').textContent).toContain('Working sets completed2');
    expect(card('nutrition').textContent).toContain('1,000 of 2,600 kcal');
    expect(card('sleep').textContent).toContain('Sleep logged5 h');
    expect(container.textContent).toContain('Demo data');
  });

  it('demo mode with only real records shows no data, never the real values', async () => {
    await mount({ ...FULL_TODAY(), isDemoMode: true });
    expect(byTestId('scorecard-insufficient')).toBeTruthy();
    expect(container.textContent).not.toContain('2,600 of');
  });
});

describe('limitations, loading and safety', () => {
  it('discloses the UTC-derived date limitation when logs are involved', async () => {
    await mount(FULL_TODAY());
    expect(byTestId('scorecard-limitation').textContent).toContain('UTC-derived date');
    await mount(base());
    expect(container.querySelector('[data-testid="scorecard-limitation"]')).toBeNull();
  });

  it('loading state is busy, shows no score and keeps a heading', async () => {
    await mount({ ...FULL_TODAY(), loading: true });
    const section = byTestId('daily-scorecard-section');
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('h2')?.textContent).toBe('Daily health scorecard');
    expect(container.querySelector('[data-testid="scorecard-score"]')).toBeNull();
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });

  it('an invalid clock shows a message instead of crashing', async () => {
    await mount(base({ now: new Date(Number.NaN) }));
    expect(container.textContent).toContain('today’s date could not be determined');
  });

  it('does not mutate frozen props', async () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        Object.values(o as Record<string, unknown>).forEach(deepFreeze);
      }
      return o;
    };
    await mount(deepFreeze(FULL_TODAY()));
    expect(byTestId('scorecard-score')).toBeTruthy();
  });

  it('makes no network calls and writes nothing to storage, including during navigation', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    await mount(FULL_TODAY());
    await click(buttonByLabel('Previous day'));
    await click(buttonByLabel('Next day'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
