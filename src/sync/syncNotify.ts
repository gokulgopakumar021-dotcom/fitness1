/**
 * Tiny change-notification channel between the storage layer (db.ts) and the sync layer.
 * It has no imports, so db.ts can call it without creating a dependency cycle. The sync engine's own writes go
 * through LocalAdapter, never through db, so they never notify (no feedback loop).
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalWorkoutChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function notifyLocalWorkoutChange(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a failing listener must never break a local save */
    }
  }
}
