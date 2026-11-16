import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutHeartRate } from './WorkoutHeartRate';
import type { WorkoutHrResult } from '../../wearables/workoutHrClient';
import type { WorkoutHrSummary } from '../../wearables/workoutHrSummary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = (over: Partial<WorkoutHrSummary> = {}): WorkoutHrSummary => ({
  sampleCount: 180, minBpm: 95, avgBpm: 128, maxBpm: 171, firstAt: '2026-11-15T10:00:00.000Z', lastAt: '2026-11-15T10:45:00.000Z',
  session: 'verified', truncated: false,
  series: [{ t: '2026-11-15T10:00:00.000Z', bpm: 95 }, { t: '2026-11-15T10:20:00.000Z', bpm: 140 }, { t: '2026-11-15T10:45:00.000Z', bpm: 120 }],
  ...over
});

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await flush(); };
const mount = async (fetcher: (id: string, s?: AbortSignal) => Promise<WorkoutHrResult>, id = 'sess-1') => {
  await act(async () => root.render(<WorkoutHeartRate sessionId={id} fetcher={fetcher} />));
};

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('WorkoutHeartRate (workout history)', () => {
  it('makes no request until the person opens it', async () => {
    const f = vi.fn(async () => ({ kind: 'ok', summary: summary() }) as WorkoutHrResult);
    await mount(f);
    expect(f).not.toHaveBeenCalled();
    expect(button('Heart rate')!.getAttribute('aria-expanded')).toBe('false');
    expect(text()).not.toContain('bpm');
  });

  it('opens, requests exactly this session, and shows min / avg / max / readings and the chart', async () => {
    const f = vi.fn(async (_id: string, _s?: AbortSignal) => ({ kind: 'ok', summary: summary() }) as WorkoutHrResult);
    await mount(f, 'sess-42');
    await click(button('Heart rate'));
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('sess-42');
    const t = text();
    for (const n of ['95', '128', '171', '180']) expect(t).toContain(n);
    expect(t).toContain('Min'); expect(t).toContain('Avg'); expect(t).toContain('Max'); expect(t).toContain('Readings');
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('95 to 140');
    expect(button('Hide heart rate')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('labels the session match honestly and never claims more than the database confirmed', async () => {
    for (const [session, label] of [['verified', 'Matched to this workout'], ['mixed', 'Partly matched'], ['unverified', 'Not confirmed']] as const) {
      await mount(async () => ({ kind: 'ok', summary: summary({ session }) }), `s-${session}`);
      await click(button('Heart rate'));
      expect(text()).toContain(label);
      await act(async () => root.render(<div />));
    }
    // An unverified label must not look like a success badge.
    await mount(async () => ({ kind: 'ok', summary: summary({ session: 'unverified' }) }), 's-u2');
    await click(button('Heart rate'));
    expect(text()).toContain('could not confirm the match');
    expect(text()).not.toContain('Matched to this workout');
  });

  it('does not present estimates as measurements: no calories, no zones, no medical claim', async () => {
    await mount(async () => ({ kind: 'ok', summary: summary() }));
    await click(button('Heart rate'));
    expect(text()).not.toMatch(/kcal|calorie|zone/i);
    expect(text()).toContain('Not a medical measurement');
    expect(text()).toContain('averaged for display');
  });

  it('warns when more readings exist than were loaded', async () => {
    await mount(async () => ({ kind: 'ok', summary: summary({ truncated: true }) }));
    await click(button('Heart rate'));
    expect(text()).toContain('more readings than were loaded');
  });

  it('says plainly when nothing was stored (and offers no retry)', async () => {
    await mount(async () => ({ kind: 'none' }));
    await click(button('Heart rate'));
    expect(text()).toContain('No wearable heart rate was stored for this workout.');
    expect(button('Retry')).toBeUndefined();
  });

  it('shows a clear unavailable message with Retry, and retry loads the data without inventing any in between', async () => {
    const f = vi.fn<(id: string) => Promise<WorkoutHrResult>>()
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValueOnce({ kind: 'ok', summary: summary({ maxBpm: 166 }) });
    await mount(f);
    await click(button('Heart rate'));
    expect(text()).toContain('temporarily unavailable');
    expect(text()).not.toMatch(/\bbpm\b/);
    await click(button('Retry'));
    expect(f).toHaveBeenCalledTimes(2);
    expect(text()).toContain('166');
    expect(button('Retry')).toBeUndefined();
  });

  it.each([['unauthenticated', 'Sign in again'], ['rate_limited', 'Too many requests'], ['failed', 'could not be loaded']] as const)('handles %s', async (kind, msg) => {
    await mount(async () => ({ kind }) as WorkoutHrResult);
    await click(button('Heart rate'));
    expect(text()).toContain(msg);
  });

  it('keeps a successful read when closed and reopened (no refetch), but refetches after a failure', async () => {
    const ok = vi.fn(async () => ({ kind: 'ok', summary: summary() }) as WorkoutHrResult);
    await mount(ok);
    await click(button('Heart rate')); await click(button('Hide heart rate')); await click(button('Heart rate'));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(text()).toContain('171');

    await act(async () => root.render(<div />));
    const bad = vi.fn(async () => ({ kind: 'failed' }) as WorkoutHrResult);
    await mount(bad, 's-2');
    await click(button('Heart rate')); await click(button('Hide heart rate')); await click(button('Heart rate'));
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it('ignores a late answer after the panel was closed (aborted request)', async () => {
    let resolve!: (r: WorkoutHrResult) => void;
    let signal: AbortSignal | undefined;
    const f = vi.fn((_id: string, s?: AbortSignal) => { signal = s; return new Promise<WorkoutHrResult>((r) => { resolve = r; }); });
    await mount(f);
    await click(button('Heart rate'));
    expect(text()).toContain('Loading heart rate');
    await click(button('Hide heart rate'));
    expect(signal!.aborted).toBe(true);
    await act(async () => resolve({ kind: 'ok', summary: summary() }));
    expect(text()).not.toContain('171');
  });
});
