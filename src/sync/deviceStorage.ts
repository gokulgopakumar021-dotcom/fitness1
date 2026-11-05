/**
 * The ONE place that hands raw browser storage to the sync layer (engine, bookkeeping, conflict archive).
 *
 * The sync code receives a `Storage` so it can be tested with an in-memory one. Every key it passes is already
 * fully account-scoped (`syncMeta.scopedKeyFor`, pinned to `storageScope.scopedKey` by a test); the only unscoped
 * key it touches is the device id, which is device-level by design. `clear()` is deliberately unsupported because
 * it ignores the account scope (the IL-03 guard bans it).
 */
export const deviceStorage: Storage = {
  get length() {
    return localStorage.length;
  },
  key: (index: number) => localStorage.key(index),
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
  clear: () => {
    throw new Error('clear() is not supported: it would ignore the per-account storage scope.');
  }
};
