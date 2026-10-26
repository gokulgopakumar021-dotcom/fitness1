import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyNutritionLog, DailySleepLog, UserProfile, WorkoutPlan, WorkoutSession } from '../../types';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { DashboardView } from './DashboardView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Integration tests for the Daily Health Scorecard on the REAL DashboardView (real BluetoothGadgetProvider,
 * real `db`, real jsdom localStorage). App.tsx is not rendered; `Harness` reproduces what App does for the
 * dashboard: it owns `isDemoMode`, and "Load demo data" calls db.loadDemoData() then setIsDemoMode(true).
 *
 * Only `Date` is faked. Every date is built with local-time constructors, so the tests do not depend on the
 * host timezone. Local clock: Monday 26 Oct 2026, 15:00.
 */
const NOW = new Date(2026, 9, 26, 15, 0, 0);
const TODAY = '2026-10-26';
const YESTERDAY = '2026-10-25';

const ONBOARDED: UserProfile = { ...DEFAULT_PROFILE, onboardingCompleted: true, dailyCalorieTarget: 2600, dailyProteinTarget: 165 };

/** One plan day with 3 + 3 + 4 = 10 planned working sets. */
const PLAN = {
  id: 'p1',
  name: 'Plan',
  days: [{ id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [
    { id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-10', targetRir: 2, restSeconds: 90 },
    { id: 'e2', name: 'Incline Dumbbell Press', muscleGroup: 'Chest', equipment: 'dumbbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90 },
    { id: 'e3', name: 'Cable Lateral Raise', muscleGroup: 'Shoulders', equipment: 'cable', workingSets: 4, repRange: '12-15', targetRir: 1, restSeconds: 60 },
  ] }],
} as unknown as WorkoutPlan;

type SetSpec = { type?: string; completed?: boolean };
const sets = (n: number, extra: SetSpec = {}): SetSpec[] => Array.from({ length: n }, () => ({ type: 'working', completed: true, ...extra }));

let seq = 0;
/** A session that started at local 10:00 on the given local day-of-month in October 2026. */
const session = (dayOfMonth: number, s: SetSpec[], extra: Partial<WorkoutSession> = {}): WorkoutSession =>
  ({
    id: `sess${++seq}`,
    planId: 'p1',
    dayId: 'd1',
    dayName: 'Push',
    date: `2026-10-${String(dayOfMonth).padStart(2, '0')}`,
    startTime: new Date(2026, 9, dayOfMonth, 10, 0).toISOString(),
    status: 'completed',
    exercises: [
      {
        id: `lex${++seq}`, name: 'Bench', muscleGroup: 'Chest', equipment: 'barbell', repRange: '8-10', targetRir: 2, restSeconds: 90,
        sets: s.map((x, i) => ({ id: `set${++seq}`, setNumber: i + 1, weight: 60, reps: 8, timestamp: '', ...x })),
      },
    ],
    ...extra,
  }) as unknown as WorkoutSession;

const nutrition = (date: string, calories: number, protein: number, extra: Partial<DailyNutritionLog> = {}): DailyNutritionLog =>
  ({
    id: `n${++seq}`, date, waterMl: 0, targetCalories: 2600, targetProtein: 165, targetCarbs: 300, targetFat: 65,
    entries: [{ id: `f${++seq}`, name: 'Food', mealCategory: 'lunch', quantity: 1, servingUnit: 'g', calories, protein, carbs: 10, fat: 5 }],
    ...extra,
  }) as unknown as DailyNutritionLog;

const sleepLog = (date: string, hoursSlept: number, extra: Partial<DailySleepLog> = {}): DailySleepLog =>
  ({ id: `sl${++seq}`, date, hoursSlept, quality: 80, ...extra }) as DailySleepLog;

const noop = () => {};
/** Mirrors App.tsx for the dashboard. The re-render button stands in for any parent re-render. */
const Harness: React.FC<{ initialDemo?: boolean; profile?: UserProfile }> = ({ initialDemo = false, profile = ONBOARDED }) => {
  const [isDemoMode, setIsDemoMode] = useState(initialDemo);
  const [, setTick] = useState(0);
  return (
    <BluetoothGadgetProvider profile={profile}>
      <button type="button" data-testid="harness-rerender" onClick={() => setTick((t) => t + 1)}>re-render</button>
      <DashboardView
        profile={profile}
        activeSession={null}
        onNavigate={noop}
        onResumeActiveSession={noop}
        isDemoMode={isDemoMode}
        onLoadDemoData={() => {
          db.loadDemoData();
          setIsDemoMode(true);
        }}
      />
      <button type="button" data-testid="harness-clear-demo" onClick={() => { db.clearDemoData(); setIsDemoMode(false); }}>clear demo</button>
    </BluetoothGadgetProvider>
  );
};

let container: HTMLDivElement;
let root: Root;
const fetchSpy = vi.fn();
const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
const beaconSpy = vi.fn(() => true);

const mount = async (props: { initialDemo?: boolean; profile?: UserProfile } = {}) => {
  await act(async () => {
    root.render(<Harness {...props} />);
  });
};
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const section = () => byTestId('daily-scorecard-section');
const card = (id: string) => byTestId(`scorecard-card-${id}`)!;
const cardText = (id: string) => card(id).textContent ?? '';
const shownDay = () => container.querySelector('[data-testid="scorecard-date"] time')?.getAttribute('datetime');
const dateLabel = () => byTestId('scorecard-date')!.textContent ?? '';
const prevDay = () => container.querySelector<HTMLButtonElement>('button[aria-label="Previous day"]')!;
const nextDay = () => container.querySelector<HTMLButtonElement>('button[aria-label="Next day"]')!;
const buttonByText = (t: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);
const rerender = () => click(byTestId('harness-rerender')!);
const calendarCard = () => [...container.querySelectorAll('h2')].find((h) => h.textContent?.includes('Gym Consistency Streak'))?.closest('.reshape-card') ?? null;
const aiPanelCard = () => [...container.querySelectorAll('h2')].find((h) => h.textContent?.includes('Muscle Recovery'))?.closest('.reshape-card') ?? null;
const snapshot = () => {
  const keys = Object.keys(localStorage).sort();
  return { keys, values: keys.map((k) => localStorage.getItem(k)) };
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchSpy.mockReset();
  xhrOpen.mockClear();
  beaconSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true, writable: true });
  db.savePlans([PLAN]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('placement', () => {
  it('renders exactly one scorecard, directly above the consistency calendar, with the rest of the order unchanged', async () => {
    await mount();
    expect(container.querySelectorAll('[data-testid="daily-scorecard-section"]')).toHaveLength(1);
    const sc = section()!;
    const cal = calendarCard();
    expect(cal, 'consistency calendar (found via its <h2> and .reshape-card)').toBeTruthy();
    expect(sc.nextElementSibling).toBe(cal);
    expect(sc.parentElement).toBe(cal!.parentElement);
    // Everything after the calendar keeps its order: AI recovery panel, muscle map, checklist.
    const ai = aiPanelCard();
    expect(cal!.nextElementSibling).toBe(ai);
    expect(ai!.nextElementSibling?.getAttribute('data-testid')).toBe('muscle-map-section');
    expect(ai!.nextElementSibling!.nextElementSibling?.getAttribute('aria-label')).toBe('Calibration checklist');
    // And it sits below the key-metrics tiles that precede the calendar.
    const metrics = container.querySelector('section[aria-label="Key metrics"]')!;
    expect(metrics.compareDocumentPosition(sc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('empty database', () => {
  it('shows Insufficient data and all five category cards without crashing', async () => {
    await mount();
    expect(byTestId('scorecard-insufficient')!.textContent).toBe('Insufficient data');
    expect(byTestId('scorecard-overview')!.textContent).toContain('Nothing is logged for this day yet.');
    expect(container.querySelectorAll('[data-testid^="scorecard-card-"]')).toHaveLength(5);
    expect(byTestId('scorecard-score')).toBeNull();
    expect(dateLabel()).toContain('Today');
  });

  it('does not use fallback defaults as nutrition targets when onboarding is incomplete', async () => {
    db.saveNutritionLogs([nutrition(TODAY, 2600, 165)]);
    await mount({ profile: DEFAULT_PROFILE }); // carries 2600 / 165 but onboardingCompleted: false
    expect(card('nutrition').getAttribute('data-status')).toBe('insufficient_data');
  });
});

describe('real data', () => {
  it('produces the score the approved rules give, from the real sessions, plans, nutrition and sleep', async () => {
    db.saveSessions([session(26, sets(5))]); // 5 of 10 planned working sets -> 10 of 20
    db.saveNutritionLogs([nutrition(TODAY, 2600, 82.5)]); // calories in the full band (13) + half the protein (6) -> 19 of 25
    db.saveSleepLogs([sleepLog(TODAY, 8)]); // inside 7-9 h -> 25 of 25
    await mount();
    expect(card('workout').getAttribute('data-status')).toBe('scored');
    expect(byTestId('scorecard-points-workout')!.textContent).toContain('10');
    expect(byTestId('scorecard-points-nutrition')!.textContent).toContain('19');
    expect(byTestId('scorecard-points-sleep')!.textContent).toContain('25');
    expect(byTestId('scorecard-score')!.textContent).toContain('54');
    expect(byTestId('scorecard-score')!.textContent).toContain('70 pts');
    expect(byTestId('scorecard-coverage')!.textContent).toContain('77.1%');
    expect(byTestId('scorecard-coverage')!.textContent).toContain('3 of 5 categories scored');
    expect(card('hydration').getAttribute('data-status')).not.toBe('scored');
    expect(card('recovery').getAttribute('data-status')).toBe('informational');
    expect(section()!.textContent).not.toContain('Demo data');
  });

  it('leaves a day with no logged workout out of the score instead of penalising it', async () => {
    db.saveNutritionLogs([nutrition(TODAY, 2600, 165)]);
    db.saveSleepLogs([sleepLog(TODAY, 8)]);
    await mount();
    expect(card('workout').getAttribute('data-status')).toBe('no_data');
    expect(byTestId('scorecard-score')!.textContent).toContain('50 pts'); // 25 + 25 earned of an eligible 50
    expect(byTestId('scorecard-coverage')!.textContent).toContain('2 of 5 categories scored');
  });
});

describe('demo versus real', () => {
  it('real mode ignores demo records on the same date, demo mode ignores real records on the same date', async () => {
    db.saveSessions([session(26, sets(5)), session(26, sets(10), { isDemo: true })]);
    db.saveNutritionLogs([nutrition(TODAY, 2600, 82.5), nutrition(TODAY, 1800, 140, { isDemo: true })]);
    db.saveSleepLogs([sleepLog(TODAY, 8), sleepLog(TODAY, 6, { isDemo: true })]);

    await mount();
    expect(cardText('nutrition')).toContain('2,600 of 2,600 kcal');
    expect(cardText('nutrition')).not.toContain('1,800');
    expect(cardText('sleep')).toContain('8 h');
    expect(cardText('workout')).toContain('5'); // 5 completed working sets, not the demo 10
    expect(cardText('workout')).not.toContain('More than one');
    expect(section()!.textContent).not.toContain('Demo data');
    await act(async () => root.unmount());
    root = createRoot(container);

    db.setDemoModeActive(true);
    await mount({ initialDemo: true });
    expect(section()!.textContent).toContain('Demo data');
    expect(cardText('nutrition')).toContain('1,800 of 2,600 kcal');
    expect(cardText('nutrition')).not.toContain('2,600 of 2,600 kcal');
    expect(cardText('sleep')).toContain('6 h');
    expect(byTestId('scorecard-points-workout')!.textContent).toContain('20'); // the demo session completed all 10 planned sets
  });

  it('after "Load demo data" is clicked from the dashboard the scorecard switches to demo records without a remount', async () => {
    vi.setSystemTime(new Date(2026, 9, 12, 15, 0, 0)); // the demo seed has a sleep log on 2026-10-12
    db.saveSleepLogs([sleepLog('2026-10-12', 5)]); // a real log on the same date
    await mount();
    expect(cardText('sleep')).toContain('5 h');
    expect(section()!.textContent).not.toContain('Demo data');

    const load = buttonByText('Load demo data');
    expect(load, 'the demo prompt is shown when there are no completed sessions').toBeTruthy();
    await click(load!);

    expect(section()!.textContent).toContain('Demo data');
    expect(cardText('sleep')).toContain('7.8 h');
    expect(cardText('sleep')).not.toContain('5 h');
  });

  it('clearing demo data from the dashboard switches the scorecard back to real records', async () => {
    vi.setSystemTime(new Date(2026, 9, 12, 15, 0, 0));
    db.saveSleepLogs([sleepLog('2026-10-12', 5)]);
    await mount();
    await click(buttonByText('Load demo data')!);
    expect(cardText('sleep')).toContain('7.8 h');

    await click(byTestId('harness-clear-demo')!);
    expect(section()!.textContent).not.toContain('Demo data');
    expect(cardText('sleep')).toContain('5 h');
    expect(cardText('sleep')).not.toContain('7.8');
  });
});

describe('session statuses the existing dashboard filters out', () => {
  it('shows in-progress and abandoned sessions to the scorecard while recentSessions (calendar, AI panel, Muscle Map) still excludes them', async () => {
    db.saveSessions([
      session(26, sets(3), { status: 'in_progress' }),
      session(25, sets(4), { status: 'abandoned' }),
    ]);
    await mount();

    // Existing behaviour, untouched: nothing is "completed".
    expect(aiPanelCard()!.textContent).toContain('analyzing 0 logged sessions');
    expect(byTestId('history-banner')!.textContent).toContain('No completed workouts logged yet.');

    // Scorecard, today: the in-progress session is recognised and not scored.
    expect(card('workout').getAttribute('data-status')).toBe('in_progress');
    expect(cardText('workout')).toContain('Sessions in progress');
    expect(byTestId('scorecard-action-workout')!.textContent).toMatch(/resume/i);

    // Scorecard, yesterday: the abandoned session with 4 completed working sets is scored as partial (4 of 10 -> 8 pts).
    await click(prevDay());
    expect(card('workout').getAttribute('data-status')).toBe('scored');
    expect(card('workout').textContent).toContain('partial');
    expect(byTestId('scorecard-points-workout')!.textContent).toContain('8');
  });
});

describe('date navigation inside the dashboard', () => {
  it('moves between days, never past today, and returns to today', async () => {
    db.saveSleepLogs([sleepLog(TODAY, 8), sleepLog(YESTERDAY, 6)]);
    await mount();
    expect(shownDay()).toBe(TODAY);
    expect(nextDay().disabled).toBe(true);
    expect(cardText('sleep')).toContain('8 h');

    await click(prevDay());
    expect(shownDay()).toBe(YESTERDAY);
    expect(dateLabel()).toContain('Yesterday');
    expect(nextDay().disabled).toBe(false);
    expect(cardText('sleep')).toContain('6 h');

    await click(prevDay());
    expect(shownDay()).toBe('2026-10-24');
    expect(card('sleep').getAttribute('data-status')).toBe('no_data');

    await click(buttonByText('Back to today')!);
    expect(shownDay()).toBe(TODAY);
    expect(cardText('sleep')).toContain('8 h');
    expect(nextDay().disabled).toBe(true);
  });

  it('navigating dates does not touch the rest of the dashboard', async () => {
    await mount();
    const before = aiPanelCard()!.textContent;
    await click(prevDay());
    await click(prevDay());
    expect(aiPanelCard()!.textContent).toBe(before);
    expect(container.querySelectorAll('[data-testid="muscle-map-section"]')).toHaveLength(1);
  });
});

describe('local midnight rollover (re-render driven: there is no timer)', () => {
  it('when the dashboard re-renders after midnight, "today" is the new local day and yesterday is the old one', async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 0));
    db.saveSleepLogs([sleepLog('2026-10-26', 8), sleepLog('2026-10-27', 6)]);
    await mount();
    expect(shownDay()).toBe('2026-10-26');
    expect(cardText('sleep')).toContain('8 h');

    vi.setSystemTime(new Date(2026, 9, 27, 0, 1, 0));
    await rerender();
    expect(shownDay()).toBe('2026-10-27');
    expect(dateLabel()).toContain('Today');
    expect(cardText('sleep')).toContain('6 h');
    await click(prevDay());
    expect(shownDay()).toBe('2026-10-26');
    expect(dateLabel()).toContain('Yesterday');
    expect(cardText('sleep')).toContain('8 h');
  });

  it('a day the person navigated to stays put across midnight and keeps showing its own data', async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 0));
    db.saveSleepLogs([sleepLog('2026-10-25', 6)]);
    await mount();
    await click(prevDay());
    expect(shownDay()).toBe('2026-10-25');

    vi.setSystemTime(new Date(2026, 9, 27, 0, 1, 0));
    await rerender();
    expect(shownDay()).toBe('2026-10-25');
    expect(cardText('sleep')).toContain('6 h');
    expect(nextDay().disabled).toBe(false); // the new today is now two days ahead
  });
});

describe('local only', () => {
  it('writes no localStorage key or value and makes no network call while the scorecard is used', async () => {
    db.saveProfile(ONBOARDED);
    db.saveSessions([session(26, sets(5)), session(25, sets(2), { status: 'abandoned' })]);
    db.saveNutritionLogs([nutrition(TODAY, 2600, 165)]);
    db.saveSleepLogs([sleepLog(TODAY, 8)]);
    const before = snapshot();

    await mount();
    expect(snapshot()).toEqual(before); // mounting the dashboard (scorecard included) wrote nothing

    await click(prevDay());
    await click(prevDay());
    await click(buttonByText('Back to today')!);
    await rerender();
    expect(snapshot()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });
});

describe('malformed stored data', () => {
  const rendersCleanly = () => {
    expect(section()).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="scorecard-card-"]')).toHaveLength(5);
  };

  it('unparseable JSON in sessions, nutrition and sleep storage falls back to an empty scorecard', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('ironlog_sessions_v1', '{not json');
    localStorage.setItem('ironlog_nutrition_logs_v1', '[[[');
    localStorage.setItem('ironlog_sleep_logs_v1', 'oops');
    await mount();
    rendersCleanly();
    expect(byTestId('scorecard-insufficient')).toBeTruthy();
    expect(error).toHaveBeenCalled(); // db.ts logged and recovered; nothing was thrown
  });

  it('JSON of the wrong shape (not arrays) is treated as empty', async () => {
    localStorage.setItem('ironlog_sessions_v1', '{"a":1}');
    localStorage.setItem('ironlog_sleep_logs_v1', '"text"');
    await mount();
    rendersCleanly();
    expect(byTestId('scorecard-insufficient')).toBeTruthy();
  });

  it('records with unusable fields are ignored or flagged, never scored and never fatal', async () => {
    localStorage.setItem(
      'ironlog_nutrition_logs_v1',
      JSON.stringify([
        { id: 'bad1', date: TODAY, entries: [], waterMl: 0 },
        { id: 'bad2', date: TODAY, entries: [{ calories: 'x', protein: -5 }] },
        { id: 'bad3' },
      ])
    );
    localStorage.setItem('ironlog_sleep_logs_v1', JSON.stringify([{ id: 'sl-bad', date: TODAY, hoursSlept: 'eight' }, { id: 'sl-bad2', date: TODAY, hoursSlept: 99 }]));
    localStorage.setItem('ironlog_sessions_v1', JSON.stringify([{ id: 'x', status: 'in_progress', exercises: 'oops', date: TODAY, startTime: new Date(2026, 9, 26, 10).toISOString() }]));
    await mount();
    rendersCleanly();
    expect(card('sleep').getAttribute('data-status')).not.toBe('scored');
    expect(card('nutrition').getAttribute('data-status')).not.toBe('scored');
    expect(byTestId('scorecard-score')).toBeNull();
  });

  it('a corrupt plans entry does not break a session that references it', async () => {
    localStorage.setItem('ironlog_plans_v1', JSON.stringify([{ id: 'p1', days: 'nope' }]));
    db.saveSessions([session(26, sets(5))]);
    await mount();
    rendersCleanly();
    expect(card('workout').getAttribute('data-status')).toBe('insufficient_data'); // planned sets unavailable, not zero
  });
});
