/**
 * Cross-device sync: shared types.
 *
 * Model (see supabase/migrations/20261105071106_workout_cloud_sync.sql): localStorage stays the working copy and
 * the cloud holds one row per record, keyed by (user_id, id). A record is synced as an opaque JSON `data` blob plus
 * server-controlled `version`, a tombstone (`deleted_at`) and the client's own `client_updated_at`.
 */

export type SyncKind = 'plans' | 'sessions' | 'active_sessions' | 'prefs';

/** Order in which dirty records are pushed (deterministic; plans first so sessions can reference them). */
export const SYNC_KINDS: readonly SyncKind[] = ['plans', 'sessions', 'prefs', 'active_sessions'] as const;

/** The only `prefs` row today: the active plan id. */
export const PREF_ACTIVE_PLAN_ID = 'active_plan_id';

export interface RemoteRow {
  kind: SyncKind;
  id: string;
  data: Record<string, unknown>;
  client_updated_at: string;
  version: number;
  deleted_at: string | null;
  /** Server timestamp kept as the raw string so microsecond precision survives the keyset cursor. */
  updated_at: string;
  device_id: string | null;
}

export interface PullCursor { ts: string; kind: string; id: string }

export interface PushArgs {
  kind: SyncKind;
  id: string;
  data: Record<string, unknown>;
  clientUpdatedAt: string;
  baseVersion: number;
  deleted: boolean;
  deviceId: string;
}

export type PushResult = { outcome: 'applied' | 'conflict'; row: RemoteRow };

/** Everything the engine needs from the cloud. The Supabase implementation is remoteAdapter.ts. */
export interface RemoteAdapter {
  pull(after: PullCursor | null, limit: number): Promise<RemoteRow[]>;
  push(args: PushArgs): Promise<PushResult>;
}

export type SyncErrorKind =
  | 'transient' // network down, 429, 5xx: retry with backoff
  | 'auth' // not signed in / session expired: do not retry until the session changes
  | 'permanent' // the server rejected the request itself: retrying the same call cannot help
  | 'local'; // local data unreadable: sync refuses to run rather than risk propagating damage

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
  }
}

/** Per-record bookkeeping, persisted in syncMeta. */
export interface RecordState {
  /** Server version this device last saw for the record (0 = never seen on the server). */
  baseVersion: number;
  /** Hash of the content the server holds as of baseVersion (null for a tombstone / unknown). */
  syncedHash: string | null;
  /** Hash of the local content last observed by reconcile (null when the record is deleted locally). */
  localHash: string | null;
  /** Local state differs from the server and still has to be pushed. */
  dirty: boolean;
  /** The record is deleted (tombstone pending or confirmed). */
  deleted: boolean;
  /** When the user last changed this record on THIS device (ISO). Used for deterministic conflict resolution. */
  cua: string;
  /** Set when the record cannot be synced (e.g. too large); it is skipped, never dropped. */
  blocked?: string;
  /**
   * A push for this never-acknowledged record has been sent. The server may hold it even though this device never
   * saw the reply, so a later local delete must still be sent as a tombstone (never silently forgotten).
   */
  attempted?: true;
}

export interface SyncMeta {
  v: 1;
  cursor: PullCursor | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  records: Record<SyncKind, Record<string, RecordState>>;
}

export interface ConflictArchiveEntry {
  at: string;
  kind: SyncKind;
  id: string;
  reason: string;
  /** The version that LOST the conflict, kept so nothing is silently destroyed. */
  data: Record<string, unknown> | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
  pending: number;
  error?: { kind: SyncErrorKind; message: string };
}
