import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile, WorkoutSession } from '../../types';
import { DEFAULT_PROFILE, db } from '../../storage/db';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { DashboardView } from './DashboardView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The "Volume prestige tier" card on the REAL DashboardView (real db, real jsdom localStorage).
 * Locks the tier thresholds (lower bound inclusive) and checks the tier colours are theme tokens.
 */
const PROFILE: UserProfile = { ...DEFAULT_PROFILE, onboardingCompleted: true, preferredUnit: 'kg' };

const sessionWithVolume = (volume: number): WorkoutSession =>
  ({
    id: 'big',
    dayName: 'Heavy day',
    date: '2026-10-01',
    startTime: '2026-10-01T10:00:00.000Z',
    endTime: '2026-10-01T11:00:00.000Z',
    status: 'completed',
    exercises: [
      {
        id: 'e1',
        name: 'Barbell Back Squat',
        muscleGroup: 'Quads',
        equipment: 'barbell',
        repRange: '1-1',
        targetRir: 0,
        restSeconds: 60,
        sets: [{ id: 's1', setNumber: 1, type: 'working', weight: volume, reps: 1, completed: true, timestamp: '2026-10-01T10:10:00.000Z' }],
      },
    ],
  }) as unknown as WorkoutSession;

let container: HTMLDivElement;
let root: Root;

const mountDashboard = async (volume: number | null) => {
  localStorage.clear();
  if (volume !== null) db.saveSessions([sessionWithVolume(volume)]);
  await act(async () => {
    root.render(
      <BluetoothGadgetProvider profile={PROFILE}>
        <DashboardView profile={PROFILE} activeSession={null} onNavigate={() => {}} onResumeActiveSession={() => {}} isDemoMode={false} onLoadDemoData={() => {}} />
      </BluetoothGadgetProvider>
    );
  });
};
const tierCard = () => container.querySelector('section[aria-label="Volume prestige tier"]') as HTMLElement;
const dotStyle = () => (tierCard().querySelector('span.rounded-full') as HTMLElement).getAttribute('style') ?? '';
const barStyle = () => (tierCard().querySelector('[role="progressbar"] > div') as HTMLElement).getAttribute('style') ?? '';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DashboardView volume prestige tier', () => {
  it.each([
    [null, 'Tier I · Bronze', 'var(--warning)'],
    [24999, 'Tier I · Bronze', 'var(--warning)'],
    [25000, 'Tier II · Copper', 'var(--chart-4)'],
    [100000, 'Tier III · Silver', 'var(--chart-5)'],
    [500000, 'Tier IV · Cyan', 'var(--chart-2)'],
    [1500000, 'Tier V · Platinum', 'var(--chart-3)'],
    [5000000, 'Reshape Titan', 'var(--chart-1)'],
  ] as const)('lifetime volume %s is %s and is drawn with %s', async (volume, label, colour) => {
    await mountDashboard(volume);
    expect(tierCard().textContent).toContain(label);
    expect(dotStyle()).toContain(colour);
    expect(barStyle()).toContain(colour);
  });

  it('shows progress to the next tier and the remaining volume', async () => {
    await mountDashboard(62500); // halfway between 25,000 and 100,000
    expect(tierCard().textContent).toContain('50% towards Tier III · Silver');
    expect(tierCard().textContent).toContain('37,500 kg remaining');
    expect(barStyle()).toContain('width: 50%');
  });

  it('shows full progress and no remaining volume at the top tier', async () => {
    await mountDashboard(6000000);
    expect(tierCard().textContent).toContain('100% towards maximum prestige');
    expect(tierCard().textContent).not.toContain('remaining');
  });

  it('uses no hard-coded colours in the tier card', async () => {
    await mountDashboard(30000);
    const html = tierCard().innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
