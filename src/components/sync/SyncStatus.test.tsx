import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { setStorageScope } from '../../storage/storageScope';
import { archiveConflict } from '../../sync/syncMeta';
import { deviceStorage } from '../../sync/deviceStorage';
import type { SyncState } from '../../sync/syncController';
import { SyncStatusBadge } from './SyncStatusBadge';
import { SyncStatusCard } from './SyncStatusCard';

const U = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const retry = vi.fn();
let sync: { enabled: boolean; state: SyncState | null; retry: () => void };
vi.mock('../../sync/SyncProvider', () => ({ useSync: () => sync }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ status: 'authenticated', user: { id: U } }) }));

const state = (p: Partial<SyncState> = {}): SyncState => ({ status: 'synced', pending: 0, lastSyncAt: new Date().toISOString(), lastError: null, attempt: 0, dataVersion: 0, ...p });
let container: HTMLDivElement;
let root: Root;
const render = async (el: React.ReactElement) => { await act(async () => root.render(el)); };
const text = () => container.textContent ?? '';
const click = async (label: string) => {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent?.trim() === label || x.getAttribute('aria-label') === label);
  if (!b) throw new Error(`no button "${label}"`);
  await act(async () => { b.click(); });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  setStorageScope(U);
  retry.mockReset();
  sync = { enabled: true, state: state(), retry };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('SyncStatusBadge (header)', () => {
  it('renders nothing when cloud sync is off (local only)', async () => {
    sync = { enabled: false, state: null, retry };
    await render(<SyncStatusBadge />);
    expect(container.innerHTML).toBe('');
  });
  it('is a polite live region showing Synced after confirmation', async () => {
    await render(<SyncStatusBadge />);
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toMatch(/Synced/);
    expect(container.querySelector('[aria-label="Retry sync"]')).toBeNull();
  });
  it.each([
    ['syncing', { status: 'syncing' as const }, /Syncing/],
    ['pending', { status: 'pending' as const, pending: 2 }, /Pending changes/],
    ['offline', { status: 'offline' as const, pending: 1 }, /Offline/],
    ['error', { status: 'error' as const, lastError: 'boom' }, /Sync failed/]
  ])('shows %s', async (_n, patch, re) => {
    sync = { enabled: true, state: state(patch), retry };
    await render(<SyncStatusBadge />);
    expect(text()).toMatch(re);
  });
  it('does not claim Synced before the first confirmation', async () => {
    sync = { enabled: true, state: state({ status: 'pending', pending: 0, lastSyncAt: null }), retry };
    await render(<SyncStatusBadge />);
    expect(text()).not.toMatch(/Synced/);
  });
  it('offers a retry button only on failure and it calls retry', async () => {
    sync = { enabled: true, state: state({ status: 'error', lastError: 'x' }), retry };
    await render(<SyncStatusBadge />);
    await click('Retry sync');
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('SyncStatusCard (settings)', () => {
  it('shows "Local only" when sync is not enabled', async () => {
    sync = { enabled: false, state: null, retry };
    await render(<SyncStatusCard />);
    expect(text()).toMatch(/Local only/);
    expect(container.querySelector('button')).toBeNull();
  });
  it('shows status and last successful sync time', async () => {
    await render(<SyncStatusCard />);
    expect(text()).toMatch(/Synced/);
    expect(text()).toMatch(/just now/);
  });
  it('shows "Not yet" before any confirmed sync', async () => {
    sync = { enabled: true, state: state({ status: 'offline', lastSyncAt: null }), retry };
    await render(<SyncStatusCard />);
    expect(text()).toMatch(/Not yet/);
    expect(text()).toMatch(/Offline/);
  });
  it('failed state shows the error as an alert and Retry now works', async () => {
    sync = { enabled: true, state: state({ status: 'error', pending: 2, lastError: 'Server unavailable' }), retry };
    await render(<SyncStatusCard />);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Server unavailable/);
    await click('Retry now');
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('lists kept conflict versions (newest first) on demand, from this account only', async () => {
    archiveConflict(deviceStorage, U, { at: '2026-11-01T10:00:00.000Z', kind: 'plans', id: 'p1', reason: 'Older edit lost', data: { name: 'Push Day' } });
    archiveConflict(deviceStorage, U, { at: '2026-11-02T10:00:00.000Z', kind: 'sessions', id: 's1', reason: 'Tie kept local', data: { dayName: 'Leg Day' } });
    archiveConflict(deviceStorage, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { at: '2026-11-03T10:00:00.000Z', kind: 'plans', id: 'other', reason: 'x', data: { name: 'Other account' } });
    await render(<SyncStatusCard />);
    expect(text()).not.toMatch(/Push Day/);
    await click('View 2');
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/Leg Day/);
    expect(items[1]).toMatch(/Push Day/);
    expect(text()).not.toMatch(/Other account/);
  });
  it('hides the kept-versions row when there are no conflicts', async () => {
    await render(<SyncStatusCard />);
    expect(text()).not.toMatch(/Kept versions/);
  });
});
