import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiFetch', () => api);

import { WorkoutSessionTracker } from './WorkoutSessionTracker';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import type { WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const past = (id: string, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, dayName: `Day ${id}`, date: '2026-11-10', startTime: '2026-11-10T10:00:00.000Z', endTime: '2026-11-10T11:00:00.000Z', status: 'completed', exercises: [], ...over
});

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const hrButtons = () => Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === 'Heart rate');
const mount = async () => {
  await act(async () => root.render(
    <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
      <WorkoutSessionTracker profile={DEFAULT_PROFILE} activeSession={null} onSessionUpdated={() => {}} onNavigateToPlans={() => {}} />
    </BluetoothGadgetProvider>
  ));
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  api.apiFetch.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('workout history: stored heart rate (BT-04C task 3)', () => {
  it('offers Heart rate on each real completed session, not on demo sessions, and makes no request until opened', async () => {
    db.addOrUpdateSession(past('real-1'));
    db.addOrUpdateSession(past('real-2'));
    db.addOrUpdateSession(past('demo-1', { isDemo: true }));
    await mount();
    expect(text()).toContain('Day real-1');
    expect(hrButtons()).toHaveLength(2);
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('loads only the opened session, from the read endpoint, and leaves the existing session statistics unchanged', async () => {
    db.addOrUpdateSession(past('real-1'));
    api.apiFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, sessionId: 'real-1', summary: {
      sampleCount: 3, minBpm: 100, avgBpm: 120, maxBpm: 140, firstAt: '2026-11-10T10:00:00.000Z', lastAt: '2026-11-10T10:10:00.000Z', session: 'unverified', truncated: false,
      series: [{ t: '2026-11-10T10:00:00.000Z', bpm: 100 }, { t: '2026-11-10T10:10:00.000Z', bpm: 140 }] } }), { status: 200 }));
    await mount();
    const before = text();
    await act(async () => hrButtons()[0].click());
    await flush();
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = api.apiFetch.mock.calls[0];
    expect(String(url)).toBe('/api/wearables/workout-heart-rate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ sessionId: 'real-1' }); // the session id only, nothing else
    expect(text()).toContain('Not confirmed');
    expect(text()).toContain('140');
    // The original row content (name, date, movements, sets, volume) is still there, untouched.
    expect(text().startsWith(before.slice(0, 40))).toBe(true);
    expect(text()).toContain('Day real-1');
    expect(text()).toContain('0 movements');
    expect(JSON.stringify(db.getSessions().find((s) => s.id === 'real-1'))).toBe(JSON.stringify(past('real-1')));
  });

  it('shows "unavailable" (and no numbers) when the server cannot answer, e.g. before the migration is applied', async () => {
    db.addOrUpdateSession(past('real-1'));
    api.apiFetch.mockResolvedValue(new Response('{}', { status: 503 }));
    await mount();
    await act(async () => hrButtons()[0].click());
    await flush();
    expect(text()).toContain('temporarily unavailable');
  });
});
