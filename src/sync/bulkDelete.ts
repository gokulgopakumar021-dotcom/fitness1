import { getActiveSync } from './syncRuntime';

export interface PreDeleteSync {
  /** Cloud sync is running for this account on this device. */
  cloudEnabled: boolean;
  /** A full sync cycle finished just now, so this device knows every cloud record that exists. */
  cloudChecked: boolean;
}

/**
 * Call BEFORE a bulk local delete (Reset All Data, Delete Workout History).
 *
 * The engine turns a local deletion into a cloud tombstone only for records this device knows about. Pulling first
 * makes that set complete, so records created on another device are tombstoned too instead of coming back. It is
 * best-effort and bounded: offline or failing, the delete still proceeds and stays queued (never blocked, never lost).
 */
export async function syncBeforeBulkDelete(timeoutMs = 8000): Promise<PreDeleteSync> {
  const sync = getActiveSync();
  if (!sync) return { cloudEnabled: false, cloudChecked: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sync.retryNow(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } catch {
    /* handled below through the controller state */
  } finally {
    if (timer) clearTimeout(timer);
  }
  const s = sync.getState();
  return { cloudEnabled: true, cloudChecked: s.lastError === null && s.status !== 'offline' && s.status !== 'error' && s.status !== 'syncing' };
}
