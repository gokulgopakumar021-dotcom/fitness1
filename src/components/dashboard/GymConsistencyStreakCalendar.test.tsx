import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GymConsistencyStreakCalendar } from './GymConsistencyStreakCalendar';
import { DEFAULT_PROFILE } from '../../storage/db';
import type { UserProfile, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile: UserProfile = { ...DEFAULT_PROFILE, trainingDaysPerWeek: 3, preferredUnit: 'kg' };

/** A completed 45 minute session worth 1,000 of volume on the given day (UTC noon, so the date is stable in any timezone). */
const session = (date: string, id = date): WorkoutSession =>
  ({
    id,
    dayName: 'Day 1 — Push',
    date,
    startTime: `${date}T12:00:00.000Z`,
    endTime: `${date}T12:45:00.000Z`,
    status: 'completed',
    exercises: [{ sets: [{ id: `s-${id}`, setNumber: 1, type: 'working', weight: 100, reps: 10, completed: true, timestamp: '' }] }],
  }) as unknown as WorkoutSession;

const mountCalendar = async (sessions: WorkoutSession[], props: Partial<React.ComponentProps<typeof GymConsistencyStreakCalendar>> = {}) => {
  await act(async () => {
    root.render(<GymConsistencyStreakCalendar sessions={sessions} profile={profile} {...props} />);
  });
};
const text = () => container.textContent ?? '';
const byText = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const dayCell = (n: number) =>
  Array.from(container.querySelectorAll('button')).find((b) => new RegExp(`^${n}(?!\\d)`).test(b.textContent ?? '')) as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T12:00:00.000Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const THREE_IN_A_ROW = [session('2026-10-30'), session('2026-10-29'), session('2026-10-28')];
const WITH_GAP = [session('2026-10-30'), session('2026-10-29'), session('2026-10-20')];

describe('GymConsistencyStreakCalendar', () => {
  it('computes the current streak, longest record and total sessions', async () => {
    await mountCalendar(WITH_GAP);
    expect(text()).toContain('Trained Today');
    const hero = container.querySelector('.font-nrc.text-3xl.text-white') as HTMLElement;
    expect(hero.textContent).toBe('2');
    expect(text()).toContain('DAYS');
    const longest = container.querySelector('.text-3xl.text-warning') as HTMLElement;
    expect(longest.textContent).toBe('2');
    const total = container.querySelector('.text-3xl.text-chart-2') as HTMLElement;
    expect(total.textContent).toBe('3');
  });

  it('shows the empty state for a new user', async () => {
    await mountCalendar([]);
    expect(text()).toContain('Log workout to start');
    expect(text()).toContain('0 / 14 Days Active');
  });

  it('keeps an active streak alive until the end of the next day', async () => {
    await mountCalendar([session('2026-10-29'), session('2026-10-28')]);
    expect(text()).toContain('Streak Active · Train Today');
  });

  it('keeps the ring numbers: consistency %, minutes and volume', async () => {
    await mountCalendar(WITH_GAP);
    // 3 trained days of a target of round(3 days x 31/7 weeks) = 13 -> 23%, 3 x 45 min, 3 x 1,000 volume
    expect(text()).toContain('23%');
    expect(text()).toContain('135m');
    expect(text()).toContain('3k');

    const progress = Array.from(container.querySelectorAll('svg circle[stroke-dasharray]')) as SVGCircleElement[];
    expect(progress).toHaveLength(3);
    const offset = (c: SVGCircleElement) => Number(c.getAttribute('stroke-dashoffset'));
    expect(offset(progress[0])).toBeCloseTo(515 - (515 * 23) / 100, 5);
    expect(offset(progress[1])).toBeCloseTo(402 - (402 * 15) / 100, 5);
    expect(offset(progress[2])).toBeCloseTo(289 - (289 * 6) / 100, 5);
  });

  it('draws the rings with theme variables and names the chart', async () => {
    await mountCalendar(WITH_GAP);
    const svg = container.querySelector('svg[viewBox="0 0 200 200"]') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Monthly activity rings: consistency 23%, training time 135 minutes, volume 3k');
    const circles = Array.from(svg.querySelectorAll('circle'));
    const strokes = circles.map((c) => c.getAttribute('stroke'));
    expect(strokes.filter((s) => s === 'var(--chart-grid)')).toHaveLength(3); // tracks
    expect(strokes).toContain('var(--chart-1)');
    expect(strokes).toContain('var(--chart-2)');
    expect(strokes).toContain('var(--danger)');
    // legend uses the same tokens as the rings
    expect(container.querySelector('span.bg-accent.rounded-full')).toBeTruthy();
    expect(container.querySelector('span.bg-chart-2.rounded-full')).toBeTruthy();
    expect(container.querySelector('span.bg-danger.rounded-full')).toBeTruthy();
  });

  it('opens the day details for a trained day, and closes them', async () => {
    await mountCalendar(WITH_GAP);
    await click(dayCell(29));
    expect(text()).toContain('Workout Logged on 2026-10-29');
    expect(text()).toContain('Volume: 1,000 kg');
    await click(byText('Close'));
    expect(text()).not.toContain('Workout Logged on');
  });

  it('does not open details for an untrained day', async () => {
    await mountCalendar(WITH_GAP);
    await click(dayCell(15));
    expect(text()).not.toContain('Workout Logged on');
  });

  it('navigates between months and back to the current month', async () => {
    await mountCalendar(WITH_GAP);
    expect(text()).toContain('October 2026');
    await click(container.querySelector('button[title="Previous Month"]') as HTMLElement);
    expect(text()).toContain('September 2026');
    await click(container.querySelector('button[title="Next Month"]') as HTMLElement);
    await click(container.querySelector('button[title="Next Month"]') as HTMLElement);
    expect(text()).toContain('November 2026');
    await click(byText('Current'));
    expect(text()).toContain('October 2026');
  });

  it('unlocks the milestone badges from the longest streak', async () => {
    await mountCalendar(WITH_GAP);
    expect(text()).toContain('0 / 4 Unlocked');
    await mountCalendar(THREE_IN_A_ROW);
    expect(text()).toContain('1 / 4 Unlocked');
    expect(container.querySelector('.border-warning\\/40')).toBeTruthy();
  });

  it('shows Train Now only when a handler is given, and calls it', async () => {
    await mountCalendar(WITH_GAP);
    expect(byText('Train Now')).toBeUndefined();
    const onNavigateToWorkouts = vi.fn();
    await mountCalendar(WITH_GAP, { onNavigateToWorkouts });
    await click(byText('Train Now'));
    expect(onNavigateToWorkouts).toHaveBeenCalledTimes(1);
  });

  it('uses theme tokens only: no hex, rgb(a) or palette colours anywhere', async () => {
    await mountCalendar(THREE_IN_A_ROW);
    await click(dayCell(29));
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
    expect(html).not.toMatch(/(lime|amber|sky|emerald|rose|fuchsia)-\d{3}/);
    expect(html).not.toMatch(/\b(bg|text|border|fill|stroke)-black\b/);
    expect(html).not.toMatch(/white\/\d+/);
  });
});
