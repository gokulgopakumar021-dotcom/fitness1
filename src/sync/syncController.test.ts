import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, createSyncController } from './syncController';
import type { SyncEngine } from './syncEngine';
import { classifyRpcError } from './remoteAdapter';
import type { SyncResult } from './types';

const ok = (over: Partial<SyncResult> = {}): SyncResult => ({ ok: true, pushed: 1, pulled: 0, conflicts: 0, rejected: 0, pending: 0, ...over });
const fail = (kind: 'transient' | 'auth' | 'permanent' | 'local', pending = 1): SyncResult =>
  ({ ok: false, pushed: 0, pulled: 0, conflicts: 0, rejected: 0, pending, error: { kind, message: `${kind} failure` } });

function fakeEngine(results: SyncResult[], pendingNow = 0) {
  const meta = { lastSyncAt: null as string | null };
  const calls = { sync: 0 };
  const engine = {
    syncOnce: vi.fn(async () => {
      calls.sync++;
      const r = results.shift() ?? ok();
      if (r.ok && r.pending === 0) meta.lastSyncAt = '2026-11-05T10:00:00.000Z';
      return r;
    }),
    reconcileLocal: vi.fn(() => pendingNow),
    pendingCount: vi.fn(() => pendingNow),
    getMeta: () => ({ lastSyncAt: meta.lastSyncAt })
  } as unknown as SyncEngine;
  return { engine, calls };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('sync controller status', () => {
  it("reports 'synced' (with the last sync time) only after a cycle that left nothing pending", async () => {
    const { engine } = fakeEngine([ok()]);
    const c = createSyncController({ engine, isOnline: () => true });
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.status));
    await c.retryNow();
    expect(seen).toEqual(['syncing', 'synced']);
    expect(c.getState()).toMatchObject({ status: 'synced', pending: 0, lastSyncAt: '2026-11-05T10:00:00.000Z', lastError: null });
  });

  it('never shows synced while changes are still pending after a cycle', async () => {
    const { engine } = fakeEngine([ok({ pending: 2 })]);
    const c = createSyncController({ engine, isOnline: () => true });
    await c.retryNow();
    expect(c.getState().status).toBe('pending');
    expect(c.getState().pending).toBe(2);
  });

  it("is 'offline' without touching the network when the browser is offline", async () => {
    const { engine, calls } = fakeEngine([ok()], 3);
    const c = createSyncController({ engine, isOnline: () => false });
    await c.retryNow();
    expect(calls.sync).toBe(0);
    expect(c.getState()).toMatchObject({ status: 'offline', pending: 3 });
  });

  it('requestSync marks pending immediately and syncs once after the debounce, however many edits arrive', async () => {
    const { engine, calls } = fakeEngine([ok()], 2);
    const c = createSyncController({ engine, isOnline: () => true, debounceMs: 1000 });
    c.requestSync(); c.requestSync(); c.requestSync();
    expect(c.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls.sync).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls.sync).toBe(1);
  });
});

describe('retry and backoff', () => {
  it('retries transient failures with growing delays and recovers', async () => {
    const { engine, calls } = fakeEngine([fail('transient'), fail('transient'), ok()]);
    const c = createSyncController({ engine, isOnline: () => true, baseBackoffMs: 1000, random: () => 1 });
    await c.retryNow();
    expect(c.getState()).toMatchObject({ status: 'pending', attempt: 1, lastError: 'transient failure' });
    await vi.advanceTimersByTimeAsync(1000);      // 1st retry after 1s
    expect(calls.sync).toBe(2);
    expect(c.getState().attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(1999);      // 2nd retry needs 2s
    expect(calls.sync).toBe(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls.sync).toBe(3);
    expect(c.getState()).toMatchObject({ status: 'synced', attempt: 0 });
  });

  it('stops after maxAttempts and waits for a manual retry, which works', async () => {
    const { engine, calls } = fakeEngine([fail('transient'), fail('transient'), fail('transient'), ok()]);
    const c = createSyncController({ engine, isOnline: () => true, maxAttempts: 3, baseBackoffMs: 10, random: () => 1 });
    await c.retryNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.sync).toBe(3);
    expect(c.getState().status).toBe('error');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.sync).toBe(3); // no further automatic requests
    await c.retryNow();
    expect(c.getState().status).toBe('synced');
  });

  it.each(['auth', 'permanent', 'local'] as const)('%s errors are not retried automatically', async (kind) => {
    const { engine, calls } = fakeEngine([fail(kind)]);
    const c = createSyncController({ engine, isOnline: () => true });
    await c.retryNow();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.sync).toBe(1);
    expect(c.getState()).toMatchObject({ status: 'error', lastError: `${kind} failure` });
  });

  it('backoff is exponential, capped and jittered', () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, 1000, 60_000, () => 1))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(20, 1000, 60_000, () => 1)).toBe(60_000);
    expect(backoffDelay(2, 1000, 60_000, () => 0)).toBe(2000);
  });
});

describe('error classification', () => {
  it.each([
    [{ code: '28000' }, undefined, 'auth'],
    [{ code: 'PGRST301' }, 401, 'auth'],
    [{ code: '42501' }, 403, 'auth'],
    [{ code: '22023', message: 'invalid kind' }, 400, 'permanent'],
    [{ code: '23514' }, 400, 'permanent'],
    [{ message: 'TypeError: Failed to fetch' }, undefined, 'transient'],
    [{ code: '57014' }, 503, 'transient'],
    [{}, 429, 'transient']
  ] as const)('%j (status %s) -> %s', (error, status, kind) => {
    expect(classifyRpcError(error as { code?: string; message?: string }, status as number | undefined).kind).toBe(kind);
  });
});
