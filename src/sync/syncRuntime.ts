import type { SyncController } from './syncController';

/** Holds the controller of the signed-in account so non-React code (reset, bulk delete) can reach it. */
let active: SyncController | null = null;

export const setActiveSync = (c: SyncController | null): void => { active = c; };
export const getActiveSync = (): SyncController | null => active;
