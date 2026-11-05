import { ConflictArchiveEntry, SYNC_KINDS, SyncMeta, SyncKind } from './types';

/**
 * Sync bookkeeping lives in localStorage, namespaced by account exactly like the workout data
 * (`<base>::u:<user id>`, see storage/storageScope.ts). It is deliberately in the SAME store as the data it
 * describes: if the data is wiped, the bookkeeping goes with it, so a wiped device re-downloads instead of
 * mistaking "everything is missing" for "the user deleted everything".
 */
export const META_BASE_KEY = 'ironlog_sync_meta_v1';
export const CONFLICTS_BASE_KEY = 'ironlog_sync_conflicts_v1';
/** Not user data and not account-specific: identifies this browser profile in conflict tie-breaks. */
export const DEVICE_ID_KEY = 'ironlog_sync_device_id_v1';
export const MAX_ARCHIVED_CONFLICTS = 50;

/** Same format as storageScope.scopedKey, computed for an explicit user (a test pins the two together). */
export function scopedKeyFor(baseKey: string, userId: string): string {
  return `${baseKey}::u:${userId.toLowerCase()}`;
}

export function emptyMeta(): SyncMeta {
  return {
    v: 1,
    cursor: null,
    lastSyncAt: null,
    lastAttemptAt: null,
    records: { plans: {}, sessions: {}, active_sessions: {}, prefs: {} }
  };
}

export function loadMeta(storage: Storage, userId: string): SyncMeta {
  try {
    const raw = storage.getItem(scopedKeyFor(META_BASE_KEY, userId));
    if (!raw) return emptyMeta();
    const p = JSON.parse(raw) as Partial<SyncMeta>;
    if (!p || p.v !== 1 || typeof p.records !== 'object' || p.records === null) return emptyMeta();
    const meta = emptyMeta();
    meta.cursor = p.cursor && typeof p.cursor.ts === 'string' ? p.cursor : null;
    meta.lastSyncAt = typeof p.lastSyncAt === 'string' ? p.lastSyncAt : null;
    meta.lastAttemptAt = typeof p.lastAttemptAt === 'string' ? p.lastAttemptAt : null;
    for (const kind of SYNC_KINDS) {
      const recs = (p.records as Record<string, unknown>)[kind];
      if (recs && typeof recs === 'object') meta.records[kind] = recs as SyncMeta['records'][SyncKind];
    }
    return meta;
  } catch {
    // Unreadable bookkeeping is safe to discard: a first-sync style merge rebuilds it without losing records.
    return emptyMeta();
  }
}

/** Returns false if the write failed (quota); the caller treats that as a sync failure, not a success. */
export function saveMeta(storage: Storage, userId: string, meta: SyncMeta): boolean {
  try {
    storage.setItem(scopedKeyFor(META_BASE_KEY, userId), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export function getDeviceId(storage: Storage, random: () => string = defaultRandomId): string {
  try {
    const existing = storage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length <= 64) return existing;
    const id = `d-${random()}`.slice(0, 64);
    storage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `d-volatile-${random()}`.slice(0, 64);
  }
}

function defaultRandomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function loadConflicts(storage: Storage, userId: string): ConflictArchiveEntry[] {
  try {
    const raw = storage.getItem(scopedKeyFor(CONFLICTS_BASE_KEY, userId));
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** Keeps the newest MAX_ARCHIVED_CONFLICTS entries. */
export function archiveConflict(storage: Storage, userId: string, entry: ConflictArchiveEntry): void {
  try {
    const list = loadConflicts(storage, userId);
    list.push(entry);
    storage.setItem(scopedKeyFor(CONFLICTS_BASE_KEY, userId), JSON.stringify(list.slice(-MAX_ARCHIVED_CONFLICTS)));
  } catch {
    /* archive is best-effort; the winning record is already safe */
  }
}
