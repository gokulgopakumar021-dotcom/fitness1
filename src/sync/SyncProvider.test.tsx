import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { db } from '../storage/db';
import { setStorageScope } from '../storage/storageScope';
import { getActiveSync } from './syncRuntime';
import { SyncProvider, useSync, type SyncContextValue } from './SyncProvider';

const U = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const rpc = vi.fn();
let authValue: { status: string; user: { id: string } | null } = { status: 'authenticated', user: { id: U } };
let client: { rpc: typeof rpc } | null = { rpc };

vi.mock('../context/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => client }));

const pushed = () => rpc.mock.calls.filter((c) => c[0] === 'push_workout_record').map((c) => c[1]);
let ctx: SyncContextValue;
let container: HTMLDivElement;
let root: Root | null;
const render = (el: React.ReactElement) => { act(() => root!.render(el)); return { unmount: () => { act(() => root!.unmount()); root = null; } }; };
const Probe = () => { ctx = useSync(); return null; };
const sess = (id: string) => ({ id, dayName: 'D', date: '2026-11-01', startTime: '2026-11-01T08:00:00.000Z', endTime: '2026-11-01T09:00:00.000Z', status: 'completed', exercises: [] }) as never;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
  localStorage.clear();
  setStorageScope(U);
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'pull_workout_changes') return { data: [], error: null };
    return { data: [{ outcome: 'applied', kind: args.p_kind, id: args.p_id, data: args.p_data, client_updated_at: args.p_client_updated_at, version: 1, deleted_at: args.p_deleted ? '2026-11-05T10:00:00Z' : null, updated_at: '2026-11-05T10:00:00.000001Z', device_id: args.p_device_id }], error: null };
  });
  authValue = { status: 'authenticated', user: { id: U } };
  client = { rpc };
});
afterEach(() => { if (root) act(() => root!.unmount()); container.remove(); vi.useRealTimers(); });

const save = (l: unknown[]) => act(() => { db.saveSessions(l as never); });
const settle = async (ms = 2000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('SyncProvider wiring', () => {
  it('starts sync for the signed-in user: a local save reaches the cloud through the user\'s own client and status becomes synced', async () => {
    render(<SyncProvider><Probe /></SyncProvider>);
    await settle();
    expect(ctx.enabled).toBe(true);
    save([sess('s1')]);
    await settle(3000);
    expect(pushed()).toEqual([expect.objectContaining({ p_kind: 'sessions', p_id: 's1', p_deleted: false })]);
    expect(ctx.state?.status).toBe('synced');
    expect(ctx.state?.lastSyncAt).not.toBeNull();
  });

  it('a local delete is pushed as a tombstone', async () => {
    render(<SyncProvider><Probe /></SyncProvider>);
    save([sess('s1')]);
    await settle(3000);
    rpc.mockClear();
    save([]);
    await settle(3000);
    expect(pushed()).toEqual([expect.objectContaining({ p_id: 's1', p_deleted: true })]);
  });

  it('is disabled (local-only) when signed out or Supabase is not configured, and never calls the network', async () => {
    client = null;
    render(<SyncProvider><Probe /></SyncProvider>);
    await settle();
    expect(ctx.enabled).toBe(false);
    save([sess('s1')]);
    await settle(3000);
    expect(rpc).not.toHaveBeenCalled();
    expect(getActiveSync()).toBeNull();
  });

  it('stops syncing and releases the controller on unmount (sign-out / account switch)', async () => {
    const { unmount } = render(<SyncProvider><Probe /></SyncProvider>);
    await settle();
    expect(getActiveSync()).not.toBeNull();
    unmount();
    expect(getActiveSync()).toBeNull();
    rpc.mockClear();
    save([sess('s2')]);
    await settle(5000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows offline, keeps the change pending, and uploads it when the connection returns', async () => {
    let online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    render(<SyncProvider><Probe /></SyncProvider>);
    await settle();
    online = false;
    save([sess('s1')]);
    await settle(3000);
    expect(ctx.state?.status).toBe('offline');
    expect(ctx.state?.pending).toBe(1);
    expect(pushed()).toEqual([]);
    online = true;
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(500); });
    expect(pushed()).toHaveLength(1);
    expect(ctx.state?.status).toBe('synced');
  });
});
