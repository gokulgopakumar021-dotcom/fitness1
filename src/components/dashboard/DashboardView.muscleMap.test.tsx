import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggedExercise, LoggedSet, WorkoutSession } from '../../types';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { LOAD_DISCLAIMER, addDays } from '../../utils/muscleMap';
import { DashboardView } from './DashboardView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Integration tests: the REAL DashboardView (real BluetoothGadgetProvider, real `db`, real jsdom
 * localStorage) with the map mounted by Stage 3. App.tsx itself is not rendered; `Harness` reproduces
 * the two calls App.handleLoadDemoData makes (db.loadDemoData + setIsDemoMode(true)).
 *
 * Only `Date` is faked (local clock: Sunday 25 Oct 2026, 15:00), so timers and promises behave normally.
 * All dates are built with local-time constructors, so the tests do not depend on the host timezone.
 */
const NOW = new Date(2026, 9, 25, 15, 0, 0);
const TODAY = '2026-10-25';
const day = (o: number) => addDays(TODAY, o);
const weekDay = (w: number, inWeek = 2) => -35 + 7 * w + inWeek;

let seq = 0;
const startOf = (k: string, h = 18) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, h).toISOString();
};
const mkSet = (o: Partial<LoggedSet> = {}): LoggedSet => ({ id: `s${++seq}`, setNumber: 1, type: 'working', weight: 40, reps: 10, completed: true, timestamp: '', ...o });
const ex = (name: string, group: string, n: number): LoggedExercise => ({
  id: `e${++seq}`, name, muscleGroup: group, equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
  sets: Array.from({ length: n }, () => mkSet()),
});
const sess = (k: string, exercises: LoggedExercise[], o: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: `sess${++seq}`, dayName: 'T', date: k, startTime: startOf(k), status: 'completed', exercises, ...o,
});
const anchor = () => sess(day(-60), [ex('Barbell Bench Press', 'Chest', 1)].map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, type: 'warmup' as const })) })));

/** Sufficient history: Chest 3 vs 4/wk (75% = Typical), Shoulders 6 vs 4/wk (Heavier), 5 unmapped sets. */
const richReal = (): WorkoutSession[] => {
  const out = [anchor()];
  for (let w = 0; w < 4; w++) out.push(sess(day(weekDay(w)), [ex('Barbell Bench Press', 'Chest', 4), ex('Cable Lateral Raise', 'Shoulders', 4)]));
  out.push(sess(day(-2), [ex('Barbell Bench Press', 'Chest', 3), ex('Cable Lateral Raise', 'Shoulders', 6), ex('Burpees', 'General', 5)]));
  return out;
};

const noop = () => {};
/** Mirrors App.tsx: owns isDemoMode and clicks through db.loadDemoData() exactly like handleLoadDemoData. */
const Harness: React.FC<{ initialDemo?: boolean }> = ({ initialDemo = false }) => {
  const [isDemoMode, setIsDemoMode] = useState(initialDemo);
  return (
    <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
      <DashboardView
        profile={DEFAULT_PROFILE}
        activeSession={null}
        onNavigate={noop}
        onResumeActiveSession={noop}
        isDemoMode={isDemoMode}
        onLoadDemoData={() => {
          db.loadDemoData();
          setIsDemoMode(true);
        }}
      />
    </BluetoothGadgetProvider>
  );
};

let container: HTMLDivElement;
let root: Root;
const fetchSpy = vi.fn();
const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
const beaconSpy = vi.fn(() => true);

const mount = async (initialDemo = false) => {
  await act(async () => {
    root.render(<Harness initialDemo={initialDemo} />);
  });
};
const unmount = async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
};
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const mapSection = () => container.querySelector<HTMLElement>('[data-testid="muscle-map-section"]');
const regionBtn = (id: string) => container.querySelector<HTMLButtonElement>(`[data-region-button="${id}"]`)!;
const figureRegion = (id: string) => container.querySelector<SVGGElement>(`svg [data-region="${id}"]`);
const bannerText = () => container.querySelector('[data-testid="history-banner"]')?.textContent ?? null;
const panelText = () => container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent!;
const buttonByText = (t: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);
const aiPanelCard = () => {
  const h2 = [...container.querySelectorAll('h2')].find((h) => h.textContent?.includes('Muscle Recovery'));
  return h2?.closest('.reshape-card') ?? null;
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('placement', () => {
  it('renders the map section directly after the AI Recovery Insights panel and before the checklist', async () => {
    await mount();
    const ai = aiPanelCard();
    const map = mapSection();
    expect(ai, 'AI Recovery Insights panel (found via its <h2> and .reshape-card)').toBeTruthy();
    expect(map).toBeTruthy();
    expect(ai!.nextElementSibling).toBe(map);
    expect(map!.parentElement).toBe(ai!.parentElement); // same container, so "directly below" is literal
    const next = map!.nextElementSibling;
    expect(next?.getAttribute('aria-label')).toBe('Calibration checklist'); // order after the insertion is unchanged
    expect(ai!.previousElementSibling).not.toBe(map);
  });

  it('mounts exactly one map and leaves the AI panel in place', async () => {
    await mount();
    expect(container.querySelectorAll('[data-testid="muscle-map-section"]')).toHaveLength(1);
    expect(aiPanelCard()!.textContent).toContain('analyzing 0 logged sessions');
  });
});

describe('states on the dashboard', () => {
  it('empty history: shows the empty banner, every region Insufficient data, and the disclaimer', async () => {
    await mount();
    expect(bannerText()).toContain('No completed workouts logged yet.');
    for (const g of container.querySelectorAll('svg [data-region]')) expect(g.getAttribute('data-status')).toBe('insufficient_data');
    expect(mapSection()!.textContent).toContain(LOAD_DISCLAIMER);
    expect(mapSection()!.textContent).toContain('Training load reflects your logged workouts. It does not measure muscle recovery or diagnose injury.');
  });

  it('historical sessions from local storage: real numbers, completed only, demo ignored when not in demo mode', async () => {
    db.saveSessions([
      ...richReal(),
      sess(day(-1), [ex('Barbell Bench Press', 'Chest', 40)], { status: 'in_progress' }),
      sess(day(-1), [ex('Barbell Bench Press', 'Chest', 40)], { status: 'abandoned' }),
      sess(day(-1), [ex('Barbell Bench Press', 'Chest', 40)], { isDemo: true }),
    ]);
    await mount();
    expect(bannerText()).toBeNull();
    expect(figureRegion('chest')!.getAttribute('aria-label')).toBe('Chest, Typical');
    expect(figureRegion('shoulders')!.getAttribute('aria-label')).toBe('Shoulders, Heavier than usual');
    await click(regionBtn('chest'));
    expect(panelText()).toContain('3 working sets in the last 7 days · usual weekly average: 4 sets');
    expect(container.querySelector('[data-testid="unmapped-block"]')!.textContent).toContain('Burpees');
    expect(mapSection()!.textContent).not.toContain('Demo data');
  });

  it('sessions restored from a backup file (db.importBackupJSON), including a date-only one, are handled', async () => {
    const imported = [...richReal().slice(0, 5), sess(day(-3), [ex('Barbell Bench Press', 'Chest', 4)], { startTime: '' })];
    const result = db.importBackupJSON(JSON.stringify({ sessions: imported }));
    expect(result.success).toBe(true);
    await mount();
    expect(bannerText()).toBeNull();
    await click(regionBtn('chest'));
    expect(panelText()).toContain('4 working sets in the last 7 days');
    expect(panelText()).toContain('Date is approximate.');
  });
});

describe('updates', () => {
  it('after "Load demo data" is clicked FROM the dashboard, the map switches to demo data without a remount', async () => {
    await mount();
    expect(bannerText()).toContain('No completed workouts logged yet.');
    expect(aiPanelCard()!.textContent).toContain('analyzing 0 logged sessions');

    const load = buttonByText('Load demo data');
    expect(load, 'the demo prompt is shown with an empty history').toBeTruthy();
    await click(load!);

    expect(mapSection()!.textContent).toContain('Demo data');
    expect(bannerText()).toBeNull(); // not "No demo workouts to show yet."
    expect(mapSection()!.textContent).not.toContain('No demo workouts to show yet.');
    // Demo sessions (Sep 24, Oct 1, Oct 8) are all before the current window at the fixed clock -> History is sufficient, no recent work.
    expect(figureRegion('chest')!.getAttribute('data-status')).toBe('no_recent_work');
    expect(figureRegion('shoulders')!.getAttribute('data-status')).toBe('no_recent_work');
    await click(regionBtn('chest'));
    expect(panelText()).toContain('Last trained');
    // The same refreshed sessions also reach the existing AI panel (it only recomputes local insights from them).
    expect(aiPanelCard()!.textContent).toContain('analyzing 3 logged sessions');
  });

  it('starting in demo mode with demo data already stored shows it immediately', async () => {
    db.loadDemoData();
    await mount(true);
    expect(mapSection()!.textContent).toContain('Demo data');
    expect(figureRegion('chest')!.getAttribute('data-status')).toBe('no_recent_work');
  });

  it('remounting the dashboard picks up workouts logged in the meantime', async () => {
    db.saveSessions([anchor()]);
    await mount();
    await click(regionBtn('chest'));
    expect(panelText()).toContain('No training recorded for Chest');
    await unmount();

    db.addOrUpdateSession(sess(day(-1), [ex('Barbell Bench Press', 'Chest', 2)]));
    await mount();
    await click(regionBtn('chest'));
    expect(panelText()).toContain('2 working sets in the last 7 days');
  });
});

describe('local only', () => {
  it('the map makes no network request and writes no storage key while used', async () => {
    db.saveSessions(richReal());
    await mount();
    const keysBefore = Object.keys(localStorage).sort();
    const valuesBefore = keysBefore.map((k) => localStorage.getItem(k));
    const fetchesBefore = fetchSpy.mock.calls.length;

    await click(regionBtn('chest'));
    await click(figureRegion('shoulders')!);
    await click([...container.querySelectorAll<HTMLButtonElement>('[aria-label="Body view"] button')].find((b) => b.textContent === 'Back')!);
    await click(regionBtn('hamstrings_glutes'));

    expect(fetchSpy.mock.calls.length).toBe(fetchesBefore);
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).sort()).toEqual(keysBefore);
    expect(keysBefore.map((k) => localStorage.getItem(k))).toEqual(valuesBefore);
  });

  it('rendering the dashboard does not call the AI endpoint (it only runs on an explicit click in the AI panel)', async () => {
    db.saveSessions(richReal());
    await mount();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
  });
});
