import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggedExercise, LoggedSet, WorkoutSession } from '../../types';
import { LOAD_DISCLAIMER, LOAD_STATUS_LABELS, MUSCLE_REGION_IDS, addDays, type MuscleRegionId } from '../../utils/muscleMap';
import { MuscleMapSection } from './MuscleMapSection';
import { DETAIL_DISCLAIMER } from './muscleMapStyles';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Reference clock: Sunday 25 Oct 2026, 15:00 LOCAL (all dates built with local constructors -> timezone independent). */
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
const ex = (name: string, group: string, n: number, o: Partial<LoggedSet> = {}): LoggedExercise => ({
  id: `e${++seq}`, name, muscleGroup: group, equipment: 'barbell', repRange: '8-12', targetRir: 2, restSeconds: 90,
  sets: Array.from({ length: n }, () => mkSet(o)),
});
const sess = (k: string, exercises: LoggedExercise[], o: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: `sess${++seq}`, dayName: 'T', date: k, startTime: startOf(k), status: 'completed', exercises, ...o,
});
const anchor = () => sess(day(-60), [ex('Barbell Bench Press', 'Chest', 1, { type: 'warmup' })]);

/** Sufficient history. Chest 3 vs 4/wk (75% = typical), Shoulders 6 vs 4/wk (heavier), Calves 2 vs 4/wk (lighter), 5 unmapped sets. */
const rich = (extra: Partial<WorkoutSession> = {}): WorkoutSession[] => {
  const out = [anchor()];
  for (let w = 0; w < 4; w++) {
    out.push(sess(day(weekDay(w)), [ex('Barbell Bench Press', 'Chest', 4), ex('Cable Lateral Raise', 'Shoulders', 4), ex('Standing Calf Raise', 'Calves', 4)], extra));
  }
  out.push(
    sess(day(-2), [ex('Barbell Bench Press', 'Chest', 3), ex('Cable Lateral Raise', 'Shoulders', 6), ex('Standing Calf Raise', 'Calves', 2), ex('Burpees', 'General', 5)], extra)
  );
  return out;
};

let container: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};
const section = (sessions: WorkoutSession[], props: Partial<React.ComponentProps<typeof MuscleMapSection>> = {}) =>
  render(<MuscleMapSection sessions={sessions} now={NOW} {...props} />);

const svgRegion = (id: MuscleRegionId) => container.querySelector<SVGGElement>(`[data-region="${id}"]`);
const listBtn = (id: MuscleRegionId) => container.querySelector<HTMLButtonElement>(`[data-region-button="${id}"]`)!;
const viewBtn = (label: 'Front' | 'Back') =>
  [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Body view"] button')].find((b) => b.textContent === label)!;
const regionsDrawn = () => [...container.querySelectorAll<SVGGElement>('svg [data-region]')].map((g) => g.getAttribute('data-region') as MuscleRegionId);
const text = () => container.textContent ?? '';
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const key = async (el: Element, k: string) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  await act(async () => { el.dispatchEvent(ev); });
  return ev;
};

const fetchSpy = vi.fn();
const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
const beaconSpy = vi.fn(() => true);

beforeEach(() => {
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
});

describe('region list and accessible names', () => {
  it('lists all eight regions as native buttons showing their load category as text', async () => {
    await section(rich());
    for (const id of MUSCLE_REGION_IDS) {
      const b = listBtn(id);
      expect(b, id).toBeTruthy();
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('aria-pressed')).toBe('false');
    }
    expect(listBtn('chest').textContent).toContain('Chest');
    expect(listBtn('chest').textContent).toContain('Typical');
    expect(listBtn('shoulders').textContent).toContain('Heavier than usual');
    expect(listBtn('calves').textContent).toContain('Lighter than usual');
    expect(listBtn('quadriceps').textContent).toContain('No recent work');
    expect(listBtn('back').textContent).toContain('Back / Lats');
    expect(listBtn('hamstrings_glutes').textContent).toContain('Hamstrings / Glutes');
    expect(listBtn('core').textContent).toContain('Core / Lower Back');
  });

  it('front view draws the front regions as focusable buttons whose names include the category', async () => {
    await section(rich());
    expect(regionsDrawn().sort()).toEqual(['arms', 'calves', 'chest', 'core', 'quadriceps', 'shoulders']);
    const chest = svgRegion('chest')!;
    expect(chest.getAttribute('role')).toBe('button');
    expect(chest.getAttribute('tabindex')).toBe('0');
    expect(chest.getAttribute('aria-label')).toBe('Chest, Typical');
    expect(svgRegion('shoulders')!.getAttribute('aria-label')).toBe('Shoulders, Heavier than usual');
    expect(svgRegion('calves')!.getAttribute('aria-label')).toBe('Calves, Lighter than usual');
    expect(svgRegion('quadriceps')!.getAttribute('aria-label')).toBe('Quadriceps, No recent work');
    // Focus is drawn on the shapes (an SVG <g> outline would box the whole group): thicker stroke + glow.
    expect(chest.getAttribute('class')).toContain('focus-visible:[&_path]:[stroke-width:3px]');
    expect(chest.getAttribute('class')).toContain('focus-visible:[&_path]:[filter:');
  });

  it('the region list says which view a region lives on when it is not on the current figure', async () => {
    await section(rich());
    expect(listBtn('back').textContent).toContain('back view');
    expect(listBtn('hamstrings_glutes').textContent).toContain('back view');
    expect(listBtn('chest').textContent).not.toContain('view');
    await click(viewBtn('Back'));
    expect(listBtn('chest').textContent).toContain('front view');
    expect(listBtn('quadriceps').textContent).toContain('front view');
    expect(listBtn('back').textContent).not.toContain('view');
  });

  it('every one of the eight regions is reachable (figure in some view, plus the list)', async () => {
    await section(rich());
    const seen = new Set<string>(regionsDrawn());
    await click(viewBtn('Back'));
    regionsDrawn().forEach((r) => seen.add(r));
    expect([...seen].sort()).toEqual([...MUSCLE_REGION_IDS].sort());
  });
});

describe('front / back switching', () => {
  it('exposes the pressed state and swaps the figure', async () => {
    await section(rich());
    expect(viewBtn('Front').getAttribute('aria-pressed')).toBe('true');
    expect(viewBtn('Back').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('svg[aria-label^="Front body view"]')).toBeTruthy();

    await click(viewBtn('Back'));
    expect(viewBtn('Back').getAttribute('aria-pressed')).toBe('true');
    expect(viewBtn('Front').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('svg[aria-label^="Back body view"]')).toBeTruthy();
    expect(regionsDrawn().sort()).toEqual(['arms', 'back', 'calves', 'core', 'hamstrings_glutes', 'shoulders']);
    expect(svgRegion('chest')).toBeNull();
  });

  it('keeps the same region identifiable across views (shoulders, arms, core, calves keep their id and status)', async () => {
    await section(rich());
    const front = svgRegion('shoulders')!.getAttribute('aria-label');
    await click(viewBtn('Back'));
    expect(svgRegion('shoulders')!.getAttribute('aria-label')).toBe(front);
    expect(svgRegion('calves')).toBeTruthy();
  });

  it('calves are selectable in both views', async () => {
    await section(rich());
    await click(svgRegion('calves')!);
    expect(svgRegion('calves')!.getAttribute('aria-pressed')).toBe('true');
    await click(viewBtn('Back'));
    expect(svgRegion('calves')!.getAttribute('aria-pressed')).toBe('true'); // selection persists
    await click(listBtn('chest')); // select something else, then calves again from the back view
    await click(viewBtn('Back'));
    await click(svgRegion('calves')!);
    expect(svgRegion('calves')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="muscle-detail-panel"] h3')!.textContent).toBe('Calves');
  });
});

describe('selection', () => {
  it('click selects a region: pressed state, persistent highlight, and a detail panel with real numbers', async () => {
    await section(rich());
    expect(text()).toContain('Select a muscle region');
    await click(svgRegion('chest')!);
    expect(svgRegion('chest')!.getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('chest')!.getAttribute('data-selected')).toBe('true');
    expect(listBtn('chest').getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('shoulders')!.getAttribute('aria-pressed')).toBe('false');
    const panel = container.querySelector('[data-testid="muscle-detail-panel"]')!;
    expect(panel.querySelector('h3')!.textContent).toBe('Chest');
    expect(panel.textContent).toContain('Typical');
    expect(panel.textContent).toContain('3 working sets in the last 7 days · usual weekly average: 4 sets');
    expect(panel.textContent).toContain('Barbell Bench Press');
    expect(panel.textContent).toMatch(/Sessions in last 7 days/);
  });

  it('Enter and Space select a focused region; other keys do not; Space does not scroll the page', async () => {
    await section(rich());
    const shoulders = svgRegion('shoulders')!;
    const other = await key(shoulders, 'a');
    expect(other.defaultPrevented).toBe(false);
    expect(shoulders.getAttribute('aria-pressed')).toBe('false');

    await key(shoulders, 'Enter');
    expect(shoulders.getAttribute('aria-pressed')).toBe('true');

    const arms = svgRegion('arms')!;
    const ev = await key(arms, ' ');
    expect(ev.defaultPrevented).toBe(true);
    expect(arms.getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('shoulders')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('choosing a region that is not on the current view switches to a view that shows it', async () => {
    await section(rich());
    await click(listBtn('back'));
    expect(viewBtn('Back').getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('back')!.getAttribute('aria-pressed')).toBe('true');
    await click(listBtn('quadriceps'));
    expect(viewBtn('Front').getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('quadriceps')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('tells the user where a selected-but-hidden region is and offers a way back', async () => {
    await section(rich());
    await click(svgRegion('chest')!);
    await click(viewBtn('Back'));
    expect(text()).toContain('Chest is on the front view.');
    const show = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show front view')!;
    await click(show);
    expect(viewBtn('Front').getAttribute('aria-pressed')).toBe('true');
    expect(svgRegion('chest')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('states: empty, insufficient, sufficient, no-record, unmapped', () => {
  it('no history: every region is Insufficient data, drawn neutral (hatched, dashed) and never green', async () => {
    await section([]);
    expect(container.querySelector('[data-testid="history-banner"]')!.textContent).toContain('No completed workouts logged yet.');
    for (const id of regionsDrawn()) {
      const g = svgRegion(id)!;
      expect(g.getAttribute('data-status')).toBe('insufficient_data');
      expect(g.getAttribute('aria-label')).toContain('Insufficient data');
      const paths = [...g.querySelectorAll('path[data-part]')];
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p.getAttribute('fill')).toBe('var(--bg-surface-3)');
        expect(p.getAttribute('stroke-dasharray')).toBe('3 2');
      }
      expect(g.querySelectorAll('path[fill^="url(#muscle-hatch"]').length).toBeGreaterThan(0);
    }
    expect(container.innerHTML).not.toMatch(/var\(--(success|danger)\)/);
  });

  it('short history: says how much is needed, still labels everything Insufficient data', async () => {
    await section([sess(day(-10), [ex('Barbell Bench Press', 'Chest', 4)]), sess(day(-3), [ex('Barbell Bench Press', 'Chest', 4)])]);
    const banner = container.querySelector('[data-testid="history-banner"]')!.textContent!;
    expect(banner).toContain('10 days ago');
    expect(banner).toContain('3 weeks');
    expect(svgRegion('chest')!.getAttribute('data-status')).toBe('insufficient_data');
    await click(svgRegion('chest')!);
    const panel = container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent!;
    expect(panel).toContain('Insufficient data');
    expect(panel).toContain('4 working sets in the last 7 days'); // facts are still shown, without a made-up baseline
    expect(panel).not.toContain('usual weekly average');
  });

  it('sufficient history shows no banner', async () => {
    await section(rich());
    expect(container.querySelector('[data-testid="history-banner"]')).toBeNull();
  });

  it('a region with no recorded training gets a clear empty state', async () => {
    await section(rich());
    await click(listBtn('quadriceps'));
    const panel = container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent!;
    expect(panel).toContain('No training recorded for Quadriceps yet.');
    expect(panel).toContain('No recent work');
  });

  it('a region trained only before the current window still shows when it was last trained', async () => {
    const s = [anchor(), sess(day(-20), [ex('Barbell Back Squat', 'Quads', 5)])];
    await section(s);
    await click(listBtn('quadriceps'));
    const panel = container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent!;
    expect(panel).toContain('Last trained');
    expect(panel).toContain('20 days ago');
    expect(panel).toContain('None in the last 7 days.');
  });

  it('shows "Date is approximate." when the day came from the stored date only', async () => {
    const s = [anchor(), sess(day(-3), [ex('Barbell Bench Press', 'Chest', 3)], { startTime: '' })];
    await section(s);
    await click(listBtn('chest'));
    expect(text()).toContain('Date is approximate.');
    await section([anchor(), sess(day(-3), [ex('Barbell Bench Press', 'Chest', 3)])]);
    expect(text()).not.toContain('Date is approximate.');
  });

  it('shows work logged today separately from the 7-day count', async () => {
    await section([anchor(), sess(day(0), [ex('Barbell Bench Press', 'Chest', 4)])]);
    await click(listBtn('chest'));
    const panel = container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent!;
    expect(panel).toContain('Logged today');
    expect(panel).toContain('4 sets');
    expect(panel).toContain('today is not part of the 7-day comparison');
    expect(panel).toContain('0 working sets in the last 7 days');
  });

  it('shows unmapped work separately, without attributing it to a region, even with nothing selected', async () => {
    await section(rich());
    const block = container.querySelector('[data-testid="unmapped-block"]')!;
    expect(block.textContent).toContain('Not assigned to a muscle region');
    expect(block.textContent).toContain('5 sets in the last 7 days');
    expect(block.textContent).toContain('Burpees');
    expect(block.textContent).toContain('not counted for any region');
    await click(listBtn('chest'));
    expect(container.querySelector('[data-testid="unmapped-block"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('3 working sets'); // chest unaffected
  });

  it('shows no unmapped block when everything mapped', async () => {
    await section([anchor(), sess(day(-2), [ex('Barbell Bench Press', 'Chest', 3)])]);
    expect(container.querySelector('[data-testid="unmapped-block"]')).toBeNull();
  });
});

describe('disclaimer, demo data, clock', () => {
  const states: [string, () => Promise<void>][] = [
    ['no history', () => section([])],
    ['short history', () => section([sess(day(-3), [ex('Barbell Bench Press', 'Chest', 3)])])],
    ['sufficient, nothing selected', () => section(rich())],
    ['sufficient, region selected', async () => { await section(rich()); await click(svgRegion('chest')!); }],
    ['region with no record selected', async () => { await section(rich()); await click(listBtn('quadriceps')); }],
    ['demo mode', () => section(rich({ isDemo: true }), { isDemoMode: true })],
  ];
  it.each(states)('states that this compares logged volume and is not a recovery measure: %s', async (_name, setup) => {
    await setup();
    expect(text()).toContain(LOAD_DISCLAIMER);
    expect(text()).toContain(DETAIL_DISCLAIMER);
    expect(DETAIL_DISCLAIMER).toBe('Training load reflects your logged workouts. It does not measure muscle recovery or diagnose injury.');
  });

  it('never uses misleading physiological wording in anything it renders, in any state', async () => {
    const forbidden = /recovered|fatigue|fresh|healed|supercompensat|micro-?trauma|contraindicat|injury risk|risk of injury|readiness/i;
    for (const [, setup] of states) {
      await setup();
      expect(text()).not.toMatch(forbidden);
      expect(container.innerHTML).not.toMatch(forbidden);
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it('demo mode uses only demo sessions and says so; real mode ignores demo sessions', async () => {
    const realChest = [anchor(), sess(day(-2), [ex('Barbell Bench Press', 'Chest', 3)])];
    const demoShoulders = [
      sess(day(-60), [ex('Cable Lateral Raise', 'Shoulders', 1, { type: 'warmup' })], { isDemo: true }),
      sess(day(-2), [ex('Cable Lateral Raise', 'Shoulders', 7)], { isDemo: true }),
    ];
    await section([...realChest, ...demoShoulders], { isDemoMode: true });
    expect(text()).toContain('Demo data');
    await click(listBtn('shoulders'));
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('7 working sets');
    await click(listBtn('chest'));
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('No training recorded for Chest');

    await section([...realChest, ...demoShoulders], { isDemoMode: false });
    expect(text()).not.toContain('Demo data');
    await click(listBtn('shoulders'));
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('No training recorded for Shoulders');
  });

  it('uses the injected clock: moving `now` forward turns recent work into baseline', async () => {
    const s = [anchor(), sess(day(-2), [ex('Barbell Bench Press', 'Chest', 4)])];
    await section(s);
    await click(listBtn('chest'));
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('4 working sets in the last 7 days');
    await section(s, { now: new Date(2026, 10, 3, 9) });
    expect(container.querySelector('[data-testid="muscle-detail-panel"]')!.textContent).toContain('0 working sets in the last 7 days');
  });

  it('updates when the sessions it is given change', async () => {
    await section([anchor()]);
    await click(listBtn('chest'));
    expect(text()).toContain('No training recorded for Chest');
    await section([anchor(), sess(day(-1), [ex('Barbell Bench Press', 'Chest', 2)])]);
    expect(text()).toContain('2 working sets in the last 7 days');
  });

  it('two instances do not share svg pattern ids', async () => {
    await render(
      <>
        <MuscleMapSection sessions={[]} now={NOW} />
        <MuscleMapSection sessions={[]} now={NOW} />
      </>
    );
    const ids = [...container.querySelectorAll('pattern')].map((p) => p.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('local only', () => {
  it('makes no network request while rendering and interacting', async () => {
    await section(rich());
    await click(svgRegion('chest')!);
    await key(svgRegion('arms')!, 'Enter');
    await click(viewBtn('Back'));
    await click(listBtn('back'));
    await key(svgRegion('calves')!, ' ');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it('source files contain no network, storage, AI-panel or recovery-analytics dependencies', () => {
    const files = ['MuscleMap.tsx', 'MuscleDetailPanel.tsx', 'MuscleMapSection.tsx', 'muscleMapGeometry.ts', 'muscleMapStyles.ts'];
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|new Image\(/);
      expect(src, f).not.toMatch(/muscleRecovery|AiRecoveryInsights|ai-recovery|recoveryAnalytics|adaptiveCoach|bodyScan|bodyscan|storage\/db|from ['"]\.\.\/\.\.\/storage/i);
      expect(src, f).not.toMatch(/recovered|fatigue|fresh|healed|supercompensat|micro-?trauma|contraindicat/i);
    }
  });
});
