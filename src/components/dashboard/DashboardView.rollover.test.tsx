import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyNutritionLog, DailySleepLog, UserProfile, WorkoutPlan } from '../../types';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { DashboardView } from './DashboardView';
import { nextLocalMidnight } from './useLocalDayRollover';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Local-midnight rollover of the Daily Health Scorecard, on the REAL DashboardView (real `db`, real jsdom localStorage).
 * Fakes Date, setTimeout and clearTimeout ONLY in this file. All dates use local-time constructors, so the file
 * passes under any host TZ; the DST block switches TZ to America/New_York itself and restores it.
 * `db.getSleepLogs` is called only by the scorecard source loader, so its call count is the "sources re-read" counter.
 */
const ONBOARDED: UserProfile = { ...DEFAULT_PROFILE, onboardingCompleted: true, dailyCalorieTarget: 2600, dailyProteinTarget: 165 };
const PLAN = { id: 'p1', name: 'Plan', days: [{ id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [] }] } as unknown as WorkoutPlan;

let seq = 0;
const sleepLog = (date: string, hoursSlept: number, extra: Partial<DailySleepLog> = {}): DailySleepLog =>
  ({ id: `sl${++seq}`, date, hoursSlept, quality: 80, ...extra }) as DailySleepLog;
const nutrition = (date: string, calories: number, protein: number, extra: Partial<DailyNutritionLog> = {}): DailyNutritionLog =>
  ({
    id: `n${++seq}`, date, waterMl: 0, targetCalories: 2600, targetProtein: 165, targetCarbs: 300, targetFat: 65,
    entries: [{ id: `f${++seq}`, name: 'Food', mealCategory: 'lunch', quantity: 1, servingUnit: 'g', calories, protein, carbs: 10, fat: 5 }],
    ...extra,
  }) as unknown as DailyNutritionLog;

const noop = () => {};
const Harness: React.FC<{ initialDemo?: boolean }> = ({ initialDemo = false }) => {
  const [isDemoMode, setIsDemoMode] = useState(initialDemo);
  const [, setTick] = useState(0);
  return (
    <BluetoothGadgetProvider profile={ONBOARDED}>
      <button type="button" data-testid="harness-rerender" onClick={() => setTick((t) => t + 1)}>re-render</button>
      <button type="button" data-testid="harness-demo-on" onClick={() => { db.setDemoModeActive(true); setIsDemoMode(true); }}>demo on</button>
      <button type="button" data-testid="harness-demo-off" onClick={() => { db.setDemoModeActive(false); setIsDemoMode(false); }}>demo off</button>
      <DashboardView profile={ONBOARDED} activeSession={null} onNavigate={noop} onResumeActiveSession={noop} isDemoMode={isDemoMode} onLoadDemoData={noop} />
    </BluetoothGadgetProvider>
  );
};

let container: HTMLDivElement;
let root: Root;
let sleepReads: ReturnType<typeof vi.spyOn>;
const fetchSpy = vi.fn();
const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
const beaconSpy = vi.fn(() => true);

const mount = async (props: { initialDemo?: boolean } = {}) => {
  await act(async () => { root.render(<Harness {...props} />); });
  sleepReads.mockClear(); // count only reads that happen after the mount
};
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const shownDay = () => container.querySelector('[data-testid="scorecard-date"] time')?.getAttribute('datetime');
const dateLabel = () => byTestId('scorecard-date')!.textContent ?? '';
const cardText = (id: string) => byTestId(`scorecard-card-${id}`)!.textContent ?? '';
const prevDay = () => container.querySelector<HTMLButtonElement>('button[aria-label="Previous day"]')!;
const nextDay = () => container.querySelector<HTMLButtonElement>('button[aria-label="Next day"]')!;
const snapshot = () => {
  const keys = Object.keys(localStorage).sort();
  return { keys, values: keys.map((k) => localStorage.getItem(k)) };
};
/** Moves the fake clock to `target`, firing every timer due on the way (like a device that stayed awake). */
const advanceTo = (target: Date) => act(async () => { vi.advanceTimersByTime(target.getTime() - Date.now()); });
/** Moves the clock WITHOUT firing timers (like a sleeping device or throttled background tab), then reports visibility. */
const jumpTo = (target: Date) => act(async () => { vi.setSystemTime(target); });
let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = (v: 'visible' | 'hidden') => act(async () => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
});

const at = (d: number, h: number, min: number) => new Date(2026, 9, d, h, min, 0); // October 2026, local time

beforeEach(() => {
  localStorage.clear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(26, 23, 59));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchSpy.mockReset();
  xhrOpen.mockClear();
  beaconSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true, writable: true });
  sleepReads = vi.spyOn(db, 'getSleepLogs');
  db.savePlans([PLAN]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  localStorage.clear();
});

describe('nextLocalMidnight', () => {
  it('is built from local calendar fields', () => {
    const n = nextLocalMidnight(at(26, 23, 59));
    expect([n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds(), n.getMilliseconds()]).toEqual([2026, 9, 27, 0, 0, 0, 0]);
  });
});

describe('rollover with no interaction', () => {
  it('moves "Today" to the new day, makes the old day "Yesterday", and shows the new day\'s logs', async () => {
    db.saveSleepLogs([sleepLog('2026-10-26', 6), sleepLog('2026-10-27', 8)]);
    await mount();
    expect(shownDay()).toBe('2026-10-26');
    expect(dateLabel()).toContain('Today');
    expect(cardText('sleep')).toContain('6 h');

    await advanceTo(at(27, 0, 1));
    expect(shownDay()).toBe('2026-10-27');
    expect(dateLabel()).toContain('Today');
    expect(cardText('sleep')).toContain('8 h');

    await click(prevDay());
    expect(shownDay()).toBe('2026-10-26');
    expect(dateLabel()).toContain('Yesterday');
    expect(cardText('sleep')).toContain('6 h');
  });

  it('does nothing before midnight', async () => {
    await mount();
    await advanceTo(at(26, 23, 59));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(shownDay()).toBe('2026-10-26');
    expect(sleepReads).not.toHaveBeenCalled();
  });
});

describe('sources are re-read on rollover', () => {
  it('shows a log written after mount for the new day, and re-reads exactly once per rollover', async () => {
    await mount();
    expect(cardText('sleep')).not.toContain('7.5 h');
    db.saveSleepLogs([sleepLog('2026-10-27', 7.5)]); // written after mount, for the next day
    await click(byTestId('harness-rerender')!);
    expect(sleepReads).not.toHaveBeenCalled(); // a re-render alone never re-reads

    await advanceTo(at(27, 0, 1));
    expect(sleepReads).toHaveBeenCalledTimes(1);
    expect(cardText('sleep')).toContain('7.5 h');

    await click(byTestId('harness-rerender')!);
    await act(async () => { vi.advanceTimersByTime(60 * 60_000); });
    expect(sleepReads).toHaveBeenCalledTimes(1);

    await advanceTo(at(28, 0, 1));
    expect(sleepReads).toHaveBeenCalledTimes(2);
  });
});

describe('a day the person navigated to', () => {
  it('stays selected across midnight, keeps its own data, and Next updates correctly', async () => {
    db.saveSleepLogs([sleepLog('2026-10-25', 6), sleepLog('2026-10-26', 7), sleepLog('2026-10-27', 8)]);
    await mount();
    await click(prevDay());
    expect(shownDay()).toBe('2026-10-25');
    expect(nextDay().disabled).toBe(false);

    await advanceTo(at(27, 0, 1));
    expect(shownDay()).toBe('2026-10-25');
    expect(cardText('sleep')).toContain('6 h');
    expect(nextDay().disabled).toBe(false);

    await click(nextDay());
    expect(shownDay()).toBe('2026-10-26');
    expect(dateLabel()).toContain('Yesterday');
    expect(nextDay().disabled).toBe(false);
    await click(nextDay());
    expect(shownDay()).toBe('2026-10-27');
    expect(dateLabel()).toContain('Today');
    expect(nextDay().disabled).toBe(true);
  });
});

describe('early timer, visibility and page restore', () => {
  it('a timer that fires before midnight changes nothing and reschedules', async () => {
    const st = vi.spyOn(globalThis, 'setTimeout');
    await mount();
    const rolloverCalls = () => st.mock.calls.filter(([, ms]) => typeof ms === 'number' && ms <= 24 * 3_600_000 && ms >= 1);
    const first = st.mock.calls.find(([, ms]) => ms === 60_000)!; // 23:59 -> 00:00
    expect(first).toBeTruthy();
    const timersBefore = vi.getTimerCount();
    const callsBefore = rolloverCalls().length;
    await act(async () => { (first[0] as () => void)(); }); // fired early: the clock still reads 23:59
    expect(shownDay()).toBe('2026-10-26');
    expect(sleepReads).not.toHaveBeenCalled();
    expect(rolloverCalls().length).toBe(callsBefore + 1); // rescheduled
    expect(vi.getTimerCount()).toBe(timersBefore); // the old timer was replaced, not stacked
    await advanceTo(at(27, 0, 1));
    expect(shownDay()).toBe('2026-10-27');
    expect(sleepReads).toHaveBeenCalledTimes(1);
  });

  it('visibilitychange to visible after the clock crossed midnight rolls over (the timer never fired)', async () => {
    db.saveSleepLogs([sleepLog('2026-10-27', 8)]);
    await mount();
    const timers = vi.getTimerCount();
    await jumpTo(at(27, 6, 30));
    expect(shownDay()).toBe('2026-10-26'); // stale until the page is looked at again
    await setVisibility('hidden');
    expect(shownDay()).toBe('2026-10-26'); // hiding does not check
    await setVisibility('visible');
    expect(shownDay()).toBe('2026-10-27');
    expect(cardText('sleep')).toContain('8 h');
    expect(sleepReads).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(timers); // rescheduled, not stacked
    await setVisibility('visible');
    expect(sleepReads).toHaveBeenCalledTimes(1); // same day: no further re-read
  });

  it('an unrelated re-render after the clock moved never switches the day without re-reading the sources', async () => {
    db.saveSleepLogs([sleepLog('2026-10-27', 8)]); // exists in storage but was not loaded at mount time
    await mount();
    await jumpTo(at(27, 0, 30)); // no timer, no event: nothing has noticed the new day yet
    await click(byTestId('harness-rerender')!);
    expect(shownDay()).toBe('2026-10-26'); // label and data move together, only at the rollover
    expect(sleepReads).not.toHaveBeenCalled();
    await setVisibility('visible');
    expect(shownDay()).toBe('2026-10-27');
    expect(cardText('sleep')).toContain('8 h');
  });

  it('pageshow after the clock crossed midnight rolls over', async () => {
    await mount();
    await jumpTo(at(27, 7, 0));
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    expect(shownDay()).toBe('2026-10-27');
    expect(sleepReads).toHaveBeenCalledTimes(1);
  });

  it('a skipped day (device asleep for two midnights) rolls over once, to the current day', async () => {
    await mount();
    await jumpTo(at(29, 9, 0));
    await setVisibility('visible');
    expect(shownDay()).toBe('2026-10-29');
    expect(sleepReads).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup and a single timer', () => {
  it('after unmount no timers or listeners remain and nothing reacts', async () => {
    const addDoc = vi.spyOn(document, 'addEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const addWin = vi.spyOn(window, 'addEventListener');
    const removeWin = vi.spyOn(window, 'removeEventListener');
    await mount();
    const added = (spy: typeof addDoc, type: string) => spy.mock.calls.filter(([t]) => t === type).length;
    expect(added(addDoc, 'visibilitychange')).toBeGreaterThanOrEqual(1);
    expect(added(addWin, 'pageshow')).toBeGreaterThanOrEqual(1);

    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(added(removeDoc, 'visibilitychange')).toBe(added(addDoc, 'visibilitychange'));
    expect(added(removeWin, 'pageshow')).toBe(added(addWin, 'pageshow'));

    sleepReads.mockClear();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await jumpTo(at(28, 1, 0));
    await setVisibility('visible');
    await act(async () => { window.dispatchEvent(new Event('pageshow')); vi.advanceTimersByTime(48 * 3_600_000); });
    expect(sleepReads).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    root = createRoot(container); // so afterEach can unmount a live root
  });

  it('exactly one rollover timer is pending after several rollovers and demo toggles', async () => {
    await mount();
    const baseline = vi.getTimerCount();
    expect(baseline).toBeGreaterThanOrEqual(1);
    await advanceTo(at(27, 0, 1));
    await click(byTestId('harness-demo-on')!);
    await advanceTo(at(28, 0, 1));
    await click(byTestId('harness-demo-off')!);
    await click(byTestId('harness-rerender')!);
    await advanceTo(at(29, 0, 1));
    await setVisibility('visible');
    expect(vi.getTimerCount()).toBe(baseline);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});

describe('demo mode', () => {
  it('keeps using only demo records after a rollover', async () => {
    db.setDemoModeActive(true);
    db.saveSleepLogs([
      sleepLog('2026-10-27', 6, { isDemo: false }), // a real log for the new day
      sleepLog('2026-10-27', 8.5, { isDemo: true }),
    ]);
    await mount({ initialDemo: true });
    await advanceTo(at(27, 0, 1));
    expect(shownDay()).toBe('2026-10-27');
    expect(byTestId('daily-scorecard-section')!.textContent).toContain('Demo data');
    expect(cardText('sleep')).toContain('8.5 h');
    expect(cardText('sleep')).not.toContain('6 h');
  });
});

describe('no network and no storage writes', () => {
  it('rollover, visibility and page restore touch no network and write no storage', async () => {
    db.saveNutritionLogs([nutrition('2026-10-27', 2600, 165)]);
    await mount();
    const before = snapshot();
    await advanceTo(at(27, 0, 1));
    await jumpTo(at(28, 3, 0));
    await setVisibility('visible');
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    expect(shownDay()).toBe('2026-10-28');
    expect(snapshot()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });
});

describe('daylight saving time (America/New_York)', () => {
  let previousTZ: string | undefined;
  beforeEach(() => {
    previousTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  });

  it('spring forward (23-hour day, 8 Mar 2026) rolls over exactly once at each local midnight', async () => {
    vi.setSystemTime(new Date(2026, 2, 7, 23, 59, 0));
    await mount();
    expect(shownDay()).toBe('2026-03-07');
    await advanceTo(new Date(2026, 2, 8, 0, 1, 0));
    expect(shownDay()).toBe('2026-03-08');
    expect(sleepReads).toHaveBeenCalledTimes(1);

    // The 23-hour day: a timer set "now + 24 h" would fire at 01:00 on 9 March, an hour late.
    await advanceTo(new Date(2026, 2, 8, 23, 30, 0));
    expect(shownDay()).toBe('2026-03-08');
    expect(sleepReads).toHaveBeenCalledTimes(1);
    await advanceTo(new Date(2026, 2, 9, 0, 0, 30));
    expect(shownDay()).toBe('2026-03-09');
    expect(sleepReads).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(30 * 3_600_000); });
    expect(shownDay()).toBe('2026-03-10');
    expect(sleepReads).toHaveBeenCalledTimes(3);
  });

  it('fall back (25-hour day, 1 Nov 2026) rolls over exactly once at each local midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 0));
    await mount();
    await advanceTo(new Date(2026, 10, 1, 0, 1, 0));
    expect(shownDay()).toBe('2026-11-01');
    expect(sleepReads).toHaveBeenCalledTimes(1);

    // The 25-hour day: a timer set "now + 24 h" would fire at 23:00 on 1 November, an hour early.
    await advanceTo(new Date(2026, 10, 1, 23, 30, 0));
    expect(shownDay()).toBe('2026-11-01');
    expect(sleepReads).toHaveBeenCalledTimes(1);
    await advanceTo(new Date(2026, 10, 2, 0, 0, 30));
    expect(shownDay()).toBe('2026-11-02');
    expect(sleepReads).toHaveBeenCalledTimes(2);
  });
});
