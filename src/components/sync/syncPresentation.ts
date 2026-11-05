import type { SyncState } from '../../sync/syncController';

export type SyncTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type SyncView = 'synced' | 'syncing' | 'pending' | 'checking' | 'offline' | 'error';

export interface SyncPresentation {
  view: SyncView;
  tone: SyncTone;
  /** Short label for the badge. */
  label: string;
  /** One sentence for the Settings card and screen readers. */
  detail: string;
  /** A manual retry makes sense. */
  canRetry: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Maps controller state to what the user sees. "Synced" is shown ONLY when the controller reports a finished cycle
 * with nothing left to push AND a confirmed last-sync time exists; anything else is never presented as synced.
 */
export function describeSync(state: SyncState): SyncPresentation {
  switch (state.status) {
    case 'synced':
      if (!state.lastSyncAt) {
        return { view: 'checking', tone: 'neutral', label: 'Checking…', detail: 'Waiting for the server to confirm your data.', canRetry: false };
      }
      return { view: 'synced', tone: 'success', label: 'Synced', detail: 'All your workouts are saved to your account.', canRetry: false };
    case 'syncing':
      return { view: 'syncing', tone: 'info', label: 'Syncing…', detail: 'Saving and checking your workouts with your account.', canRetry: false };
    case 'offline':
      return {
        view: 'offline',
        tone: 'warning',
        label: 'Offline',
        detail: state.pending > 0
          ? `You are offline. ${plural(state.pending, 'change')} will sync when you are back online.`
          : 'You are offline. Changes will sync when you are back online.',
        canRetry: false
      };
    case 'error':
      return {
        view: 'error',
        tone: 'danger',
        label: 'Sync failed',
        detail: state.pending > 0
          ? `Synchronisation failed. ${plural(state.pending, 'change')} ${state.pending === 1 ? 'is' : 'are'} still saved on this device only.`
          : 'Synchronisation failed. Your data is still saved on this device.',
        canRetry: true
      };
    case 'pending':
    default:
      if (state.pending > 0) {
        return {
          view: 'pending',
          tone: 'warning',
          label: 'Pending changes',
          detail: `${plural(state.pending, 'change')} ${state.pending === 1 ? 'is' : 'are'} waiting to sync.`,
          canRetry: true
        };
      }
      // Controller starts in 'pending' with nothing counted before its first cycle: do not claim a result yet.
      return { view: 'checking', tone: 'neutral', label: 'Checking…', detail: 'Checking your account for changes.', canRetry: false };
  }
}

/** "just now", "5 min ago", "3 h ago", otherwise a local date. Never throws on bad input. */
export function formatLastSync(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
