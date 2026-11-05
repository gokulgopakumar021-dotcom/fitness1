import { describe, expect, it } from 'vitest';
import type { SyncState } from '../../sync/syncController';
import { describeSync, formatLastSync } from './syncPresentation';

const base: SyncState = { status: 'pending', pending: 0, lastSyncAt: null, lastError: null, attempt: 0, dataVersion: 0 };
const st = (p: Partial<SyncState>): SyncState => ({ ...base, ...p });

describe('describeSync', () => {
  it('maps every controller status to one of the five required states', () => {
    expect(describeSync(st({ status: 'synced', lastSyncAt: '2026-11-05T10:00:00Z' })).label).toBe('Synced');
    expect(describeSync(st({ status: 'syncing' })).label).toBe('Syncing…');
    expect(describeSync(st({ status: 'pending', pending: 2 })).label).toBe('Pending changes');
    expect(describeSync(st({ status: 'offline' })).label).toBe('Offline');
    expect(describeSync(st({ status: 'error', lastError: 'x' })).label).toBe('Sync failed');
  });
  it('never says Synced without a server-confirmed sync time', () => {
    expect(describeSync(st({ status: 'synced', lastSyncAt: null })).view).not.toBe('synced');
  });
  it('the initial pending state with nothing counted is not shown as pending changes or synced', () => {
    const p = describeSync(st({ status: 'pending', pending: 0 }));
    expect(p.view).toBe('checking');
    expect(p.label).not.toMatch(/synced|pending/i);
  });
  it('offers retry only for failed or pending-with-changes states', () => {
    expect(describeSync(st({ status: 'error' })).canRetry).toBe(true);
    expect(describeSync(st({ status: 'pending', pending: 1 })).canRetry).toBe(true);
    expect(describeSync(st({ status: 'synced', lastSyncAt: '2026-11-05T10:00:00Z' })).canRetry).toBe(false);
    expect(describeSync(st({ status: 'offline' })).canRetry).toBe(false);
    expect(describeSync(st({ status: 'syncing' })).canRetry).toBe(false);
  });
  it('mentions the pending count with correct plurals', () => {
    expect(describeSync(st({ status: 'offline', pending: 1 })).detail).toMatch(/1 change will/);
    expect(describeSync(st({ status: 'offline', pending: 3 })).detail).toMatch(/3 changes will/);
    expect(describeSync(st({ status: 'error', pending: 1 })).detail).toMatch(/1 change is/);
  });
});

describe('formatLastSync', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  it('is null for missing or invalid input', () => {
    expect(formatLastSync(null, now)).toBeNull();
    expect(formatLastSync('garbage', now)).toBeNull();
  });
  it('formats relative times', () => {
    expect(formatLastSync('2026-11-05T11:59:40Z', now)).toBe('just now');
    expect(formatLastSync('2026-11-05T11:55:00Z', now)).toBe('5 min ago');
    expect(formatLastSync('2026-11-05T09:00:00Z', now)).toBe('3 h ago');
    expect(formatLastSync('2026-10-01T09:00:00Z', now)).toMatch(/2026/);
  });
});
