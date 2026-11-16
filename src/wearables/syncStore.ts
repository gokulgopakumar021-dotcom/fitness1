import { useSyncExternalStore } from 'react';
import { INITIAL_SYNC_STATUS, type SyncStatus } from './syncStatus';

/** Tiny shared holder so the dashboard can show what the (single) sync controller is doing. Reset on unmount/account change. */
let current: SyncStatus = INITIAL_SYNC_STATUS;
const listeners = new Set<() => void>();
export const publishSyncStatus = (s: SyncStatus) => { current = s; listeners.forEach((l) => l()); };
export const resetSyncStatus = () => publishSyncStatus(INITIAL_SYNC_STATUS);
export const useSyncStatus = (): SyncStatus => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => INITIAL_SYNC_STATUS);
