import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView';
import { HomeWorkoutCard } from './HomeSections';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import { shiftDayKey } from '../../utils/homeSummary';
import type {
  DailyNutritionLog,
  LoggedSet,
  ProgressiveOverloadRecommendation,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile: UserProfile = {
  ...DEFAULT_PROFILE,
  name: 'Marcus Vance',
  currentWeightKg: 80,
  goalWeightKg: 78,
  preferredUnit: 'kg',
  trainingDaysPerWeek: 4,
  dailyCalorieTarget: 2400,
  dailyProteinTarget: 180,
  dailyCarbsTarget: 250,
  dailyFatTarget: 70
};

const today = getCurrentDayKey();

const set = (weight: number, reps: number, over: Partial<LoggedSet> = {}): LoggedSet => ({
  id: `s-${weight}-${reps}-${Math.random()}`,
  setNumber: 1,
  type: 'working',
  weight,
  reps,
  completed: true,
  timestamp: `${today}T08:00:00.000Z`,
  ...over
});

const makeSession = (
  id: string,
  date: string,
  sets: LoggedSet[],
  over: Partial<WorkoutSession> = {}
): WorkoutSession => ({
  id,
  dayName: 'Push Day',
  date,
  startTime: `${date}T08:00:00.000Z`,
  status: 'completed',
  exercises: [
    {
      id: `e-${id}`,
      name: 'Bench Press',
      muscleGroup: 'Chest',
      equipment: 'barbell',
      repRange: '5-8',
      targetRir: 2,
      restSeconds: 120,
      sets
    }
  ],
  ...over
});

const plan: WorkoutPlan = {
  id: 'plan-1',
  name: 'Upper / Lower Split',
  trainingSplit: 'Upper / Lower',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  isActive: true,
  days: [
    {
      id: 'day-upper',
      dayName: 'Upper A',
      dayOrder: 1,
      exercises: [
        { id: 'p1', name: 'Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '5-8', targetRir: 2, restSeconds: 120 },
        { id: 'p2', name: 'Row', muscleGroup: 'Back', equipment: 'barbell', workingSets: 3, repRange: '8-10', targetRir: 2, restSeconds: 90 }
      ]
    },
    { id: 'day-lower', dayName: 'Lower A', dayOrder: 2, exercises: [] }
  ]
};

const nutritionLog = (over: Partial<DailyNutritionLog> = {}): DailyNutritionLog => ({
  id: 'log-today',
  date: today,
  waterMl: 1000,
  targetCalories: 2400,
  targetProtein: 180,
  targetCarbs: 250,
  targetFat: 70,
  entries: [
    { id: 'f1', name: 'Rice', mealCategory: 'lunch', quantity: 1, servingUnit: 'cup', calories: 1200, protein: 90, carbs: 130, fat: 30 }
  ],
  ...over
});

const recommendation: ProgressiveOverloadRecommendation = {
  id: 'rec-1',
  exerciseName: 'Bench Press',
  equipment: 'barbell',
  ruleApplied: 'A_TOP_REPS_ACHIEVED',
  ruleTitle: 'Top reps',
  currentWeight: 60,
  currentRepsSummary: '8,8,8',
  recommendedWeight: 62.5,
  recommendedRepTarget: '5-8',
  explanation: 'Add weight',
  trainingPhase: 'hypertrophy',
  userAction: 'pending'
} as ProgressiveOverloadRecommendation;

interface Overrides {
  profile?: UserProfile;
  activeSession?: WorkoutSession | null;
  isDemoMode?: boolean;
  onNavigate?: (tab: string) => void;
  onResumeActiveSession?: () => void;
  onLoadDemoData?: () => void;
  onClearDemoData?: () => void;
}

const view = (o: Overrides = {}) => (
  <HomeView
    profile={o.profile ?? profile}
    activeSession={o.activeSession ?? null}
    onNavigate={(o.onNavigate ?? vi.fn()) as never}
    onResumeActiveSession={o.onResumeActiveSession ?? vi.fn()}
    isDemoMode={o.isDemoMode ?? false}
    onLoadDemoData={o.onLoadDemoData ?? vi.fn()}
    onClearDemoData={o.onClearDemoData ?? vi.fn()}
  />
);

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(text));

const text = () => container.textContent ?? '';

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
  vi.restoreAllMocks();
});

describe('Home: header and overview', () => {
  it('greets the athlete by first name with one h1 and no legacy branding', async () => {
    await render(view());
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toMatch(/^Good (morning|afternoon|evening), Marcus$/);
    expect(text()).not.toContain('Reshape OS');
    expect(text()).not.toContain('Readiness');
  });

  it('says plainly that nothing is logged for a new athlete, without fabricated numbers', async () => {
    await render(view());
    expect(text()).toContain('No workout logged today');
    expect(text()).toContain('No workouts logged yet');
    expect(text()).toContain('No meals logged yet today');
    expect(text()).toContain('No weigh-ins yet');
    expect(text()).not.toContain('sessions this week'); // weekly badge only once sessions exist
  });

  it('shows a workout logged today and the weekly session count from real sessions', async () => {
    db.saveSessions([makeSession('s1', today, [set(60, 8)])]);
    await render(view());
    expect(text()).toContain('Workout logged today');
    expect(text()).toContain('1 / 4 sessions this week');
  });
});

describe('Home: primary workout card', () => {
  it('prioritises resuming an active session and calls the existing resume handler', async () => {
    const onResume = vi.fn();
    const active = makeSession('live', today, [set(60, 8), set(60, 8, { completed: false })], { status: 'in_progress' });
    await render(view({ activeSession: active, onResumeActiveSession: onResume }));
    expect(text()).toContain('Workout in progress');
    expect(text()).toContain('Push Day');
    expect(text()).toContain('1 exercise · 1 set logged');
    expect(buttonByText('Start workout')).toBeUndefined();
    await click(buttonByText('Resume workout'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows the active routine, its days and when each was last done, and starts via Workouts', async () => {
    const onNavigate = vi.fn();
    const lastUpper = shiftDayKey(today, 3);
    db.savePlans([plan]);
    db.setActivePlanId('plan-1');
    db.saveSessions([makeSession('s1', lastUpper, [set(60, 8)], { planId: 'plan-1', dayId: 'day-upper' })]);
    await render(view({ onNavigate }));
    expect(text()).toContain('Upper / Lower Split');
    expect(text()).toContain('Upper A');
    expect(text()).toContain('2 exercises');
    expect(text()).toContain('Last done');
    expect(text()).toContain('Not done yet'); // Lower A
    await click(buttonByText('Start workout'));
    expect(onNavigate).toHaveBeenCalledWith('workouts');
    await click(buttonByText('Manage routines'));
    expect(onNavigate).toHaveBeenCalledWith('plans');
  });

  it('offers routine selection instead of a fake workout when there is no routine', async () => {
    const onNavigate = vi.fn();
    await render(
      <HomeWorkoutCard
        activeSession={null}
        activePlan={null}
        completed={[]}
        todayStatus="none"
        onNavigate={onNavigate}
        onResumeActiveSession={vi.fn()}
      />
    );
    expect(text()).toContain('No routine selected');
    await click(buttonByText('Choose a routine'));
    expect(onNavigate).toHaveBeenCalledWith('plans');
  });
});

describe('Home: nutrition summary', () => {
  it('shows real calories, remaining, macros and water against the existing goal', async () => {
    const onNavigate = vi.fn();
    db.saveNutritionLogForDate(nutritionLog());
    await render(view({ onNavigate }));
    expect(text()).toContain('1,200');
    expect(text()).toContain('/ 2,400 kcal');
    expect(text()).toContain('1,200 kcal left');
    expect(text()).toContain('Protein');
    expect(text()).toContain('Carbs');
    expect(text()).toContain('Fat');
    expect(text()).toContain('1 L /'); // water so far / goal
    expect(container.querySelector('[role="progressbar"][aria-label^="Calories today"]')).toBeTruthy();
    await click(buttonByText('Open'));
    expect(onNavigate).toHaveBeenCalledWith('nutrition');
  });

  it('says "over" in words, not just colour, when the goal is exceeded', async () => {
    db.saveNutritionLogForDate(
      nutritionLog({ entries: [{ id: 'f', name: 'Feast', mealCategory: 'dinner', quantity: 1, servingUnit: 'x', calories: 2900, protein: 100, carbs: 300, fat: 100 }] })
    );
    await render(view());
    expect(text()).toContain('500 kcal over');
  });

  it('does not invent a calorie goal when the profile has none', async () => {
    db.saveNutritionLogForDate(nutritionLog());
    const onNavigate = vi.fn();
    await render(view({ onNavigate, profile: { ...profile, dailyCalorieTarget: 0, dailyProteinTarget: 0, dailyCarbsTarget: 0, dailyFatTarget: 0 } }));
    expect(text()).toContain('No calorie goal set');
    expect(text()).not.toContain('2,600');
    expect(text()).not.toContain('kcal left');
    await click(buttonByText('Set targets'));
    expect(onNavigate).toHaveBeenCalledWith('nutrition');
  });

  it('shows an empty state with a Log a meal action when nothing is logged', async () => {
    const onNavigate = vi.fn();
    await render(view({ onNavigate }));
    await click(buttonByText('Log a meal'));
    expect(onNavigate).toHaveBeenCalledWith('nutrition');
  });

  it('shows water in fl oz for lbs users', async () => {
    db.saveNutritionLogForDate(nutritionLog({ waterMl: 2957 }));
    await render(view({ profile: { ...profile, preferredUnit: 'lbs' } }));
    expect(text()).toContain('100 fl oz');
  });
});

describe('Home: progress and recent activity', () => {
  it('shows consistency, volume, latest sessions and new records from real history', async () => {
    const onNavigate = vi.fn();
    db.saveSessions([
      makeSession('a', shiftDayKey(today, 20), [set(60, 8)]),
      makeSession('b', shiftDayKey(today, 10), [set(62.5, 8)]),
      makeSession('c', shiftDayKey(today, 5), [set(62.5, 6)])
    ]);
    await render(view({ onNavigate }));
    expect(text()).toContain('3 sessions logged in total');
    expect(text()).toContain('Latest sessions');
    expect(text()).toContain('Volume per session');
    expect(text()).toContain('New records · last 30 days');
    expect(text()).toContain('62.5 kg');
    expect(text()).toContain('+2.5 kg');
    await click(buttonByText('Progression'));
    expect(onNavigate).toHaveBeenCalledWith('progression');
    await click(buttonByText('Timeline'));
    expect(onNavigate).toHaveBeenCalledWith('timeline');
  });

  it('omits the records list and trend chart when there is not enough history', async () => {
    db.saveSessions([makeSession('a', shiftDayKey(today, 2), [set(60, 8)])]);
    await render(view());
    expect(text()).toContain('Latest sessions');
    expect(text()).not.toContain('New records');
    expect(text()).not.toContain('Volume per session');
  });

  it('ignores abandoned and in-progress sessions', async () => {
    db.saveSessions([
      makeSession('x', today, [set(60, 8)], { status: 'abandoned' }),
      makeSession('y', today, [set(60, 8)], { status: 'in_progress' })
    ]);
    await render(view());
    expect(text()).toContain('No workouts logged yet');
  });
});

describe('Home: Coach Iron, body and navigation', () => {
  it('lists saved overload recommendations, routes to Progression and Coach Iron, and makes no network call', async () => {
    const onNavigate = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    db.saveRecommendations([recommendation, { ...recommendation, id: 'rec-2', userAction: 'accepted' } as ProgressiveOverloadRecommendation]);
    await render(view({ onNavigate }));
    expect(text()).toContain('1 overload recommendation ready to review');
    expect(text()).toContain('+2.5 kg');
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Bench Press')));
    expect(onNavigate).toHaveBeenCalledWith('progression');
    await click(buttonByText('Open Coach Iron'));
    expect(onNavigate).toHaveBeenCalledWith('trainer');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the Coach Iron entry point when there are no recommendations', async () => {
    const onNavigate = vi.fn();
    await render(view({ onNavigate }));
    await click(buttonByText('Open Coach Iron'));
    expect(onNavigate).toHaveBeenCalledWith('trainer');
  });

  it('shows the latest weigh-in (converted for lbs) and links to Body', async () => {
    const onNavigate = vi.fn();
    db.addOrUpdateBodyMetric({ id: 'm1', date: shiftDayKey(today, 9), weightKg: 81, bmi: 25 });
    db.addOrUpdateBodyMetric({ id: 'm2', date: shiftDayKey(today, 1), weightKg: 80, bmi: 24.7 });
    await render(view({ onNavigate, profile: { ...profile, preferredUnit: 'lbs' } }));
    expect(text()).toContain('176.4 lbs');
    expect(text()).not.toContain('178.6 lbs');
    await click(buttonByText('Open body metrics'));
    expect(onNavigate).toHaveBeenCalledWith('body');
  });

  it('reaches every secondary screen from the More list', async () => {
    const onNavigate = vi.fn();
    await render(view({ onNavigate }));
    const targets: [string, string][] = [
      ['Overview', 'dashboard'],
      ['Routines', 'plans'],
      ['Reports', 'reports'],
      ['Exercise videos', 'videos'],
      ['Settings', 'settings']
    ];
    for (const [label, tab] of targets) {
      const nav = container.querySelector('nav[aria-label="Other screens"]');
      const btn = Array.from(nav!.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
      await click(btn);
      expect(onNavigate).toHaveBeenCalledWith(tab);
    }
  });
});

describe('Home: demo data, errors and refresh', () => {
  it('offers Load demo data when inactive and Clear demo data when active', async () => {
    const onLoad = vi.fn();
    const onClear = vi.fn();
    await render(view({ onLoadDemoData: onLoad, onClearDemoData: onClear }));
    await click(buttonByText('Load demo data'));
    expect(onLoad).toHaveBeenCalledTimes(1);
    await render(view({ isDemoMode: true, onLoadDemoData: onLoad, onClearDemoData: onClear }));
    expect(text()).toContain('Demo data');
    await click(buttonByText('Clear demo data'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('re-reads stored data when demo mode flips while Home stays mounted', async () => {
    await render(view());
    expect(text()).toContain('No workouts logged yet');
    db.saveSessions([makeSession('demo', shiftDayKey(today, 1), [set(60, 8)])]);
    await render(view({ isDemoMode: true }));
    expect(text()).toContain('1 session logged in total');
  });

  it('shows a retryable error state when stored data cannot be read', async () => {
    vi.spyOn(db, 'getSessions').mockImplementationOnce(() => {
      throw new Error('corrupt');
    });
    await render(view());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load your data");
    await click(buttonByText('Try again'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('Nutrition today');
  });
});

describe('Home: layout and theming', () => {
  it('uses one-column cards that become a 3-column grid on large screens, with no fixed widths', async () => {
    await render(view());
    const grid = container.querySelector('.lg\\:grid-cols-3');
    expect(grid).toBeTruthy();
    expect(grid!.className).toContain('grid-cols-1');
    expect(container.firstElementChild?.className).toContain('max-w-6xl');
    expect(container.innerHTML).not.toMatch(/style="[^"]*width:\s*\d+px/);
  });

  it('exposes labelled sections and named progress bars', async () => {
    db.saveNutritionLogForDate(nutritionLog());
    await render(view());
    for (const label of ['Nutrition today', 'Recent progress', 'Coach Iron', 'Body weight']) {
      expect(container.querySelector(`section[aria-label="${label}"]`)).toBeTruthy();
    }
    container.querySelectorAll('[role="progressbar"]').forEach((bar) => {
      expect(bar.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('contains no hard-coded colours in the Home source (tokens only, so both themes work)', () => {
    for (const file of ['HomeView.tsx', 'HomeSections.tsx']) {
      const src = readFileSync(resolve(process.cwd(), 'src/components/home', file), 'utf8');
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, file).not.toMatch(/\b(rgb|hsl)a?\(/);
    }
  });
});
