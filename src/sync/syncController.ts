import type { SyncEngine } from './syncEngine';
import type { SyncResult } from './types';

/**
 * Drives the engine and exposes the status the UI shows (Stage 4 renders it; nothing here touches React).
 *
 * "synced" is reported ONLY after a full cycle finished with nothing left to push, i.e. after the server confirmed
 * the writes. Network failures retry with exponential backoff and jitter up to maxAttempts, then stop at 'error'
 * until the user retries; auth / server-rejected / local-data errors do not auto-retry at all.
 */
export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  attempt: number;
  /** Increments whenever a cycle changed local records (downloads / conflict resolutions) so views can re-read storage. */
  dataVersion: number;
}

type TimerId = ReturnType<typeof setTimeout>;
type Listener = (state: SyncState) => void;

export interface ControllerOptions {
  engine: SyncEngine;
  isOnline?: () => boolean;
  debounceMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Background refresh while the app is visible (picks up changes made on another device). */
  pollMs?: number;
  random?: () => number;
}

export function backoffDelay(attempt: number, base: number, max: number, random: () => number): number {
  return Math.round(Math.min(max, base * 2 ** attempt) * (0.5 + random() * 0.5));
}

export interface SyncController {
  getState(): SyncState;
  subscribe(listener: Listener): () => void;
  /** Call after local changes: detects them immediately (status -> pending) and syncs after a short debounce. */
  requestSync(): void;
  /** Manual retry: resets the attempt counter and syncs now. */
  retryNow(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createSyncController(opts: ControllerOptions): SyncController {
  const { engine } = opts;
  const isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const debounceMs = opts.debounceMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseBackoff = opts.baseBackoffMs ?? 2000;
  const maxBackoff = opts.maxBackoffMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 5 * 60_000;
  const random = opts.random ?? Math.random;

  let state: SyncState = { status: 'pending', pending: 0, lastSyncAt: engine.getMeta().lastSyncAt, lastError: null, attempt: 0, dataVersion: 0 };
  const listeners = new Set<Listener>();
  let timer: TimerId | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let started = false;
  let cleanup: Array<() => void> = [];

  const set = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = (ms: number) => { clearTimer(); timer = setTimeout(() => { timer = null; void run(); }, ms); };

  async function run(): Promise<void> {
    if (running) return;
    if (!isOnline()) { set({ status: 'offline', pending: engine.pendingCount() }); return; }
    running = true;
    clearTimer();
    set({ status: 'syncing', lastError: null });
    let res: SyncResult;
    try {
      res = await engine.syncOnce();
    } finally {
      running = false;
    }
    const lastSyncAt = engine.getMeta().lastSyncAt;
    // Even a failed cycle may have applied pages of remote changes before it stopped.
    if (res.pulled > 0 || res.conflicts > 0) state = { ...state, dataVersion: state.dataVersion + 1 };
    if (res.ok && res.pending === 0) {
      set({ status: 'synced', pending: 0, lastSyncAt, lastError: null, attempt: 0 });
      return;
    }
    if (res.error && res.error.kind !== 'transient') {
      set({ status: 'error', pending: res.pending, lastSyncAt, lastError: res.error.message });
      return;
    }
    // transient failure, or records still pending (e.g. blocked): retry with backoff, bounded
    const attempt = state.attempt + 1;
    if (!isOnline()) {
      set({ status: 'offline', pending: res.pending, lastSyncAt, attempt: 0 });
      return;
    }
    if (attempt >= maxAttempts) {
      set({ status: 'error', pending: res.pending, lastSyncAt, attempt, lastError: res.error?.message ?? 'Some changes could not be synced.' });
      return;
    }
    set({ status: 'pending', pending: res.pending, lastSyncAt, attempt, lastError: res.error?.message ?? null });
    schedule(backoffDelay(attempt - 1, baseBackoff, maxBackoff, random));
  }

  return {
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    requestSync() {
      const pending = engine.reconcileLocal();
      if (!isOnline()) { set({ status: 'offline', pending }); return; }
      if (!running) set({ status: pending > 0 ? 'pending' : state.status, pending });
      schedule(debounceMs);
    },
    async retryNow() {
      state = { ...state, attempt: 0 }; // silent: the UI only needs the status transitions that follow
      clearTimer();
      await run();
    },
    start() {
      if (started) return;
      started = true;
      const w = typeof window !== 'undefined' ? window : undefined;
      if (w) {
        const onOnline = () => { state = { ...state, attempt: 0 }; schedule(0); };
        const onOffline = () => { clearTimer(); set({ status: 'offline', pending: engine.pendingCount() }); };
        const onVisible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') schedule(0); };
        w.addEventListener('online', onOnline);
        w.addEventListener('offline', onOffline);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        cleanup = [
          () => w.removeEventListener('online', onOnline),
          () => w.removeEventListener('offline', onOffline),
          () => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible); }
        ];
        poll = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') schedule(0);
        }, pollMs);
      }
      schedule(0); // first sync on sign-in
    },
    stop() {
      started = false;
      clearTimer();
      if (poll) { clearInterval(poll); poll = null; }
      cleanup.forEach((f) => f());
      cleanup = [];
    }
  };
}
