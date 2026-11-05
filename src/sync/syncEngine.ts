import { hashOf } from './hash';
import { LocalAdapter, LocalSnapshot } from './localAdapter';
import { archiveConflict, loadMeta, saveMeta } from './syncMeta';
import {
  PREF_ACTIVE_PLAN_ID, PullCursor, RecordState, RemoteAdapter, RemoteRow, SYNC_KINDS, SyncError, SyncKind, SyncMeta, SyncResult
} from './types';

/**
 * Record-level two-way sync between the account-scoped localStorage working copy and the cloud tables.
 *
 * One cycle: reconcile local edits -> pull remote changes (merge per record) -> reconcile again -> push dirty
 * records. It never replaces a collection: every local write is one record, by id (LocalAdapter.applyRecord).
 *
 * Conflict rules (deterministic: every device reaches the same winner from the same two versions):
 *  - edit vs edit        : later client timestamp wins, ties broken by device id, then content hash. The LOSER is
 *                          kept: plans as a visible "(conflict copy)" plan, everything else in the conflict archive.
 *  - edit vs delete      : the later of the two wins; a discarded edit goes to the conflict archive.
 *  - identical content   : adopted, no conflict.
 *  - two in-progress workouts: the later-started one stays active; the other is saved to history as 'abandoned'.
 *  - active session whose id already finished locally: the finished session wins, the cloud active row is cleaned up.
 */

const PULL_LIMIT = 500;
const MAX_PAGES = 200;
const MAX_PUSH_ATTEMPTS = 3; // per record per cycle (each retry follows a conflict that was merged)
const MAX_RECORD_BYTES = 900_000; // server cap is 1 MiB (pg_column_size, compressed); stay well under
const PERSIST_EVERY = 25;
/** Rows commit slightly out of updated_at order; re-reading a short window makes the keyset cursor safe. Replays are no-ops (version check). */
const LOOKBACK_MS = 5000;

export interface EngineOptions {
  userId: string;
  storage: Storage;
  remote: RemoteAdapter;
  deviceId: string;
  now?: () => Date;
}

export interface SyncEngine {
  /** Single-flight: a call while a cycle is running returns that cycle's promise. */
  syncOnce(): Promise<SyncResult>;
  /** Detects local edits/deletes without touching the network; returns the number of records now pending. */
  reconcileLocal(): number;
  pendingCount(): number;
  getMeta(): SyncMeta;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validRemote(kind: SyncKind, row: RemoteRow): string | null {
  const d = row.data;
  if (!isObj(d)) return 'data is not an object';
  if (kind === 'prefs') return 'value' in d && (typeof d.value === 'string' || d.value === null) ? null : 'bad pref value';
  if (d.id !== row.id) return 'id mismatch';
  if (kind === 'plans') return Array.isArray(d.days) && typeof d.name === 'string' ? null : 'malformed plan';
  return Array.isArray(d.exercises) && typeof d.date === 'string' ? null : 'malformed session';
}

function isAfter(a: PullCursor, b: PullCursor): boolean {
  const ta = tsOf(a.ts);
  const tb = tsOf(b.ts);
  if (ta !== tb) return ta > tb;
  return a.kind !== b.kind ? a.kind > b.kind : a.id > b.id;
}

function tsOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function createSyncEngine(opts: EngineOptions): SyncEngine {
  const { userId, storage, remote, deviceId } = opts;
  const now = opts.now ?? (() => new Date());
  const local = new LocalAdapter(storage, userId);
  let inflight: Promise<SyncResult> | null = null;
  let meta = loadMeta(storage, userId);
  let mutations = 0;

  const persist = (force = false) => {
    if (!force && ++mutations % PERSIST_EVERY !== 0) return;
    if (!saveMeta(storage, userId, meta)) throw new SyncError('local', 'Sync bookkeeping could not be saved (storage full?).');
  };

  const freshState = (over: Partial<RecordState>): RecordState => ({
    baseVersion: 0, syncedHash: null, localHash: null, dirty: false, deleted: false, cua: now().toISOString(), ...over
  });

  const derivedCua = (kind: SyncKind, rec: unknown): string => {
    const r = rec as Record<string, unknown>;
    const candidate = kind === 'plans' ? r.updatedAt : kind === 'sessions' ? (r.endTime ?? r.startTime) : undefined;
    return typeof candidate === 'string' && tsOf(candidate) > 0 ? new Date(tsOf(candidate)).toISOString() : now().toISOString();
  };

  // ---------------------------------------------------------------- reconcile (local edits -> dirty flags)
  function reconcile(snap: LocalSnapshot): void {
    const nowIso = now().toISOString();
    for (const kind of SYNC_KINDS) {
      const recs = meta.records[kind];
      const localMap: Record<string, unknown> = { ...(snap[kind] as Record<string, unknown>) };
      if (kind === 'prefs') {
        const st = recs[PREF_ACTIVE_PLAN_ID];
        if (!localMap[PREF_ACTIVE_PLAN_ID] && st && !st.deleted) localMap[PREF_ACTIVE_PLAN_ID] = { value: null };
      }
      for (const [id, rec] of Object.entries(localMap)) {
        const h = hashOf(rec);
        let st = recs[id];
        if (JSON.stringify(rec).length > MAX_RECORD_BYTES) {
          st = recs[id] ?? (recs[id] = freshState({ localHash: h }));
          st.blocked = 'too_large';
          st.dirty = false;
          continue;
        }
        if (!st) {
          recs[id] = freshState({ localHash: h, dirty: true, cua: derivedCua(kind, rec) });
          continue;
        }
        if (st.blocked) delete st.blocked;
        if (st.localHash !== h) {
          st.localHash = h;
          st.cua = nowIso;
        }
        st.deleted = false;
        st.dirty = h !== st.syncedHash;
      }
      for (const [id, st] of Object.entries(recs)) {
        if (id in localMap || st.deleted) continue;
        if (st.baseVersion === 0 && st.syncedHash === null) {
          delete recs[id]; // never reached the server: nothing to tombstone
          continue;
        }
        st.deleted = true;
        st.dirty = true;
        st.localHash = null;
        st.cua = nowIso;
      }
    }
  }

  const pending = (): number => {
    let n = 0;
    for (const kind of SYNC_KINDS) for (const st of Object.values(meta.records[kind])) if (st.dirty && !st.blocked) n++;
    return n;
  };

  // ---------------------------------------------------------------- local application helpers
  function setSnap(snap: LocalSnapshot, kind: SyncKind, id: string, data: Record<string, unknown> | null): void {
    const m = snap[kind] as Record<string, unknown>;
    if (data === null || (kind === 'prefs' && data.value === null)) delete m[id];
    else m[id] = data;
  }

  /** Make the remote version the local one (or remove the local record) and mark it in sync. */
  function adoptRemote(kind: SyncKind, row: RemoteRow, snap: LocalSnapshot): void {
    const deleted = row.deleted_at !== null;
    const data = deleted ? null : row.data;
    const h = data === null ? null : hashOf(data);
    const cur = (snap[kind] as Record<string, unknown>)[row.id];
    const same = data !== null && cur !== undefined && hashOf(cur) === h;
    if (!same) {
      local.applyRecord(kind, row.id, data);
      setSnap(snap, kind, row.id, data);
    }
    meta.records[kind][row.id] = {
      baseVersion: row.version, syncedHash: h, localHash: h, dirty: false, deleted, cua: row.client_updated_at
    };
    persist();
  }

  /** Our version stays; we now know the server's version, so the next push is a clean follow-up. */
  function keepLocal(st: RecordState, row: RemoteRow): void {
    st.baseVersion = row.version;
    st.dirty = true;
  }

  /** `visibleCopy`: edit-vs-edit plan losers become a usable "(conflict copy)" plan; losers of a delete are only archived (a deleted plan must not reappear). */
  function preserveLoser(kind: SyncKind, id: string, loser: Record<string, unknown> | null, reason: string, snap: LocalSnapshot, visibleCopy = false): void {
    if (loser && kind === 'plans' && visibleCopy) {
      const copyId = `${id}~c${hashOf(loser).slice(0, 8)}`;
      if (!(copyId in snap.plans)) {
        const name = typeof loser.name === 'string' ? loser.name : 'Plan';
        const copy = { ...loser, id: copyId, name: `${name} (conflict copy)`, isActive: false, isStarter: false };
        local.applyRecord('plans', copyId, copy);
        snap.plans[copyId] = copy as never;
        meta.records.plans[copyId] = freshState({ localHash: hashOf(copy), dirty: true });
      }
      return;
    }
    archiveConflict(storage, userId, { at: now().toISOString(), kind, id, reason, data: loser });
  }

  /** Both sides changed since the last common version. Mutates meta/snap; leaves st.dirty true iff local must still be pushed. */
  function resolveConflict(kind: SyncKind, st: RecordState, row: RemoteRow, snap: LocalSnapshot, res: SyncResult): void {
    res.conflicts++;
    const localRec = (snap[kind] as Record<string, unknown>)[row.id] as Record<string, unknown> | undefined;
    const localDeleted = st.deleted;
    const remoteDeleted = row.deleted_at !== null;
    const ta = tsOf(st.cua);
    const tb = tsOf(row.client_updated_at);

    if (localDeleted && remoteDeleted) return adoptRemote(kind, row, snap);

    if (!localDeleted && !remoteDeleted) {
      if (hashOf(row.data) === st.localHash) return adoptRemote(kind, row, snap); // same content, just concurrent
      let localWins: boolean;
      if (ta !== tb) localWins = ta > tb;
      else if ((row.device_id ?? '') !== deviceId) localWins = deviceId > (row.device_id ?? '');
      else localWins = (st.localHash ?? '') > hashOf(row.data);
      if (localWins) {
        preserveLoser(kind, row.id, row.data, 'remote edit lost to a newer local edit', snap, true);
        return keepLocal(st, row);
      }
      preserveLoser(kind, row.id, localRec ?? null, 'local edit lost to a newer remote edit', snap, true);
      return adoptRemote(kind, row, snap);
    }

    if (!localDeleted && remoteDeleted) {
      if (ta > tb) return keepLocal(st, row); // edited after it was deleted elsewhere: keep it (resurrect)
      preserveLoser(kind, row.id, localRec ?? null, 'local edit lost to a newer delete', snap);
      return adoptRemote(kind, row, snap);
    }

    // local delete vs remote edit
    if (ta > tb) {
      preserveLoser(kind, row.id, row.data, 'remote edit lost to a newer local delete', snap);
      return keepLocal(st, row);
    }
    return adoptRemote(kind, row, snap);
  }

  // ---------------------------------------------------------------- pull
  function applyRemoteRow(row: RemoteRow, snap: LocalSnapshot, res: SyncResult): void {
    const kind = row.kind;
    const recs = meta.records[kind];
    const st = recs[row.id];
    const remoteDeleted = row.deleted_at !== null;
    if (!remoteDeleted) {
      const bad = validRemote(kind, row);
      if (bad) {
        res.rejected++; // never write a malformed remote record into the working copy
        return;
      }
    }
    if (st && row.version <= st.baseVersion) return; // our own echo or a stale row

    if (kind === 'active_sessions' && !remoteDeleted && handleActiveSessionArrival(row, snap)) {
      res.pulled++;
      return;
    }

    res.pulled++;
    if (!st || !st.dirty) {
      adoptRemote(kind, row, snap);
      return;
    }
    resolveConflict(kind, st, row, snap, res);
    persist();
  }

  /** Returns true when the row was fully handled here. */
  function handleActiveSessionArrival(row: RemoteRow, snap: LocalSnapshot): boolean {
    const finished = snap.sessions[row.id] as { status?: string } | undefined;
    if (finished && finished.status !== 'in_progress') {
      // That workout already ended on this device: completed wins; ask the cloud to drop the stale active row.
      meta.records.active_sessions[row.id] = freshState({ baseVersion: row.version, deleted: true, dirty: true });
      persist();
      return true;
    }
    const localId = Object.keys(snap.active_sessions)[0];
    if (!localId || localId === row.id) return false;

    const localActive = snap.active_sessions[localId] as unknown as Record<string, unknown>;
    const remoteStart = tsOf(row.data.startTime as string);
    const localStart = tsOf(localActive.startTime as string);
    const remoteWins = remoteStart > localStart || (remoteStart === localStart && row.id > localId);
    const abandon = (id: string, data: Record<string, unknown>) => {
      const a = { ...data, status: 'abandoned' };
      if (!(id in snap.sessions)) {
        local.applyRecord('sessions', id, a);
        snap.sessions[id] = a as never;
        meta.records.sessions[id] = freshState({ localHash: hashOf(a), dirty: true });
      }
    };
    if (remoteWins) {
      abandon(localId, localActive);
      local.applyRecord('active_sessions', localId, null);
      delete snap.active_sessions[localId];
      const old = meta.records.active_sessions[localId];
      meta.records.active_sessions[localId] = freshState({
        baseVersion: old?.baseVersion ?? 0, syncedHash: old?.syncedHash ?? null, deleted: true, dirty: (old?.baseVersion ?? 0) > 0
      });
      if ((old?.baseVersion ?? 0) === 0) delete meta.records.active_sessions[localId];
      adoptRemote('active_sessions', row, snap);
    } else {
      abandon(row.id, row.data);
      meta.records.active_sessions[row.id] = freshState({ baseVersion: row.version, deleted: true, dirty: true });
      persist();
    }
    return true;
  }

  async function pullAll(res: SyncResult): Promise<void> {
    let cursor: PullCursor | null = meta.cursor
      ? { ts: new Date(Math.max(0, tsOf(meta.cursor.ts) - LOOKBACK_MS)).toISOString(), kind: '', id: '' }
      : null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await remote.pull(cursor, PULL_LIMIT);
      if (rows.length) {
        const snap = local.readSnapshot();
        for (const row of rows) applyRemoteRow(row, snap, res);
        const last = rows[rows.length - 1];
        cursor = { ts: last.updated_at, kind: last.kind, id: last.id };
        if (!meta.cursor || isAfter(cursor, meta.cursor)) meta.cursor = cursor;
        persist(true); // the cursor only advances after the page is applied
      }
      if (rows.length < PULL_LIMIT) return;
    }
  }

  // ---------------------------------------------------------------- push
  async function pushDirty(res: SyncResult): Promise<void> {
    for (const kind of SYNC_KINDS) {
      for (const id of Object.keys(meta.records[kind])) {
        for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
          const st = meta.records[kind][id];
          if (!st || !st.dirty || st.blocked) break;
          const snap = local.readSnapshot();
          let rec = st.deleted ? null : ((snap[kind] as Record<string, unknown>)[id] as Record<string, unknown> | undefined);
          if (kind === 'prefs' && !st.deleted && rec === undefined) rec = { value: null }; // an unset preference is a value, not a missing record
          if (!st.deleted && rec === undefined) {
            reconcile(snap); // changed since the last reconcile (e.g. deleted mid-cycle)
            continue;
          }
          const data = rec ?? {};
          const pushedHash = rec ? hashOf(rec) : null;
          const out = await remote.push({
            kind, id, data, clientUpdatedAt: st.cua, baseVersion: st.baseVersion, deleted: st.deleted, deviceId
          });
          if (out.outcome === 'applied') {
            st.baseVersion = out.row.version;
            st.syncedHash = pushedHash;
            st.dirty = false;
            st.localHash = st.deleted ? null : st.localHash;
            res.pushed++;
            persist();
            break;
          }
          resolveConflict(kind, st, out.row, snap, res);
          persist();
          if (!meta.records[kind][id]?.dirty) break; // remote won; nothing left to push
        }
      }
    }
  }

  // ---------------------------------------------------------------- public API
  async function runCycle(): Promise<SyncResult> {
    const res: SyncResult = { ok: false, pushed: 0, pulled: 0, conflicts: 0, rejected: 0, pending: 0 };
    meta = loadMeta(storage, userId);
    meta.lastAttemptAt = now().toISOString();
    try {
      reconcile(local.readSnapshot());
      persist(true);
      await pullAll(res);
      reconcile(local.readSnapshot());
      await pushDirty(res);
      res.pending = pending();
      res.ok = true;
      if (res.pending === 0) meta.lastSyncAt = now().toISOString();
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError('transient', (e as Error)?.message || 'Sync failed.');
      res.error = { kind: err.kind, message: err.message };
      res.pending = pending();
    } finally {
      try {
        persist(true);
      } catch (e) {
        if (!res.error) {
          res.ok = false;
          res.error = { kind: 'local', message: (e as Error).message };
        }
      }
    }
    return res;
  }

  return {
    syncOnce() {
      if (!inflight) inflight = runCycle().finally(() => { inflight = null; });
      return inflight;
    },
    reconcileLocal() {
      if (!inflight) meta = loadMeta(storage, userId); // never swap the bookkeeping out from under a running cycle
      reconcile(local.readSnapshot());
      persist(true);
      return pending();
    },
    pendingCount: () => { if (!inflight) meta = loadMeta(storage, userId); return pending(); },
    getMeta: () => meta
  };
}
