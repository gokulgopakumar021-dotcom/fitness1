import type { WorkoutPlan, WorkoutSession } from '../types';
import { STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN } from '../data/starterPlans';
import { hashOf } from './hash';
import { scopedKeyFor } from './syncMeta';
import { PREF_ACTIVE_PLAN_ID, SyncError, SyncKind } from './types';

/**
 * Raw, account-scoped access to the four workout localStorage keys.
 *
 * Why not use `db`: db.getPlans() seeds starter plans (and writes them) when nothing is stored, which a sync
 * pass must never trigger, and db.save*() would re-notify the sync layer. This adapter reads and writes the very
 * same keys and formats, one record at a time, so existing data and the existing JSON backup format are untouched.
 */
export const LOCAL_KEYS = {
  plans: 'ironlog_plans_v1',
  activePlanId: 'ironlog_active_plan_id_v1',
  sessions: 'ironlog_sessions_v1',
  activeSession: 'ironlog_active_session_v1'
} as const;

export interface LocalSnapshot {
  plans: Record<string, WorkoutPlan>;
  sessions: Record<string, WorkoutSession>;
  active_sessions: Record<string, WorkoutSession>;
  prefs: Record<string, { value: string | null }>;
}

const STARTER_HASHES = new Map<string, string>(
  [STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN].map((p) => [p.id, hashOf(p)])
);

/** True for a plan that is still exactly the seeded starter (never edited by the user). */
export function isPristineStarter(plan: unknown): boolean {
  const p = plan as WorkoutPlan | null;
  return !!p && p.isStarter === true && STARTER_HASHES.get(p.id) === hashOf(p);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasId = (v: unknown): v is { id: string } => isObj(v) && typeof v.id === 'string' && v.id.length >= 1 && v.id.length <= 128;

export class LocalAdapter {
  constructor(private readonly storage: Storage, private readonly userId: string) {}

  private key(base: string): string {
    return scopedKeyFor(base, this.userId);
  }

  /** Reads an array key. null = absent. Throws a 'local' SyncError if present but unreadable (never guess). */
  private readArray(base: string): unknown[] | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key(base));
    } catch {
      throw new SyncError('local', 'Local storage could not be read.');
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed;
    } catch {
      throw new SyncError('local', 'Local workout data is unreadable; sync paused to protect it.');
    }
  }

  private writeJson(base: string, value: unknown): void {
    try {
      this.storage.setItem(this.key(base), JSON.stringify(value));
    } catch {
      throw new SyncError('local', 'Local storage is full or unavailable.');
    }
  }

  /** Throws SyncError('local') when any of the workout keys is unreadable. Excludes demo sessions and pristine starters. */
  readSnapshot(): LocalSnapshot {
    const snap: LocalSnapshot = { plans: {}, sessions: {}, active_sessions: {}, prefs: {} };

    for (const p of this.readArray(LOCAL_KEYS.plans) ?? []) {
      if (hasId(p) && !isPristineStarter(p)) snap.plans[p.id] = p as unknown as WorkoutPlan;
    }
    for (const s of this.readArray(LOCAL_KEYS.sessions) ?? []) {
      if (hasId(s) && (s as { isDemo?: boolean }).isDemo !== true) snap.sessions[s.id] = s as unknown as WorkoutSession;
    }

    let rawActive: string | null;
    try {
      rawActive = this.storage.getItem(this.key(LOCAL_KEYS.activeSession));
    } catch {
      throw new SyncError('local', 'Local storage could not be read.');
    }
    if (rawActive !== null) {
      try {
        const a = JSON.parse(rawActive);
        if (hasId(a) && (a as { isDemo?: boolean }).isDemo !== true) snap.active_sessions[a.id] = a as unknown as WorkoutSession;
      } catch {
        throw new SyncError('local', 'Local active workout is unreadable; sync paused to protect it.');
      }
    }

    try {
      const pref = this.storage.getItem(this.key(LOCAL_KEYS.activePlanId));
      if (pref !== null) snap.prefs[PREF_ACTIVE_PLAN_ID] = { value: pref };
    } catch {
      throw new SyncError('local', 'Local storage could not be read.');
    }
    return snap;
  }

  /** Raw (unfiltered) plan list, for callers that must see pristine starters too. */
  rawPlans(): WorkoutPlan[] {
    return (this.readArray(LOCAL_KEYS.plans) ?? []).filter(hasId) as unknown as WorkoutPlan[];
  }
  rawSessions(): WorkoutSession[] {
    return (this.readArray(LOCAL_KEYS.sessions) ?? []).filter(hasId) as unknown as WorkoutSession[];
  }

  /** Insert or replace ONE record by id, or remove it (data = null). Every other stored entry is preserved as-is. */
  applyRecord(kind: SyncKind, id: string, data: Record<string, unknown> | null): void {
    if (kind === 'plans' || kind === 'sessions') {
      const base = kind === 'plans' ? LOCAL_KEYS.plans : LOCAL_KEYS.sessions;
      const list = this.readArray(base) ?? [];
      const idx = list.findIndex((x) => hasId(x) && x.id === id);
      if (data === null) {
        if (idx < 0) return;
        list.splice(idx, 1);
      } else if (idx >= 0) {
        list[idx] = data;
      } else {
        list.push(data);
      }
      this.writeJson(base, list);
      return;
    }
    if (kind === 'active_sessions') {
      if (data === null) {
        // Only clear if the stored active session is this one; never clobber a different in-progress workout.
        const cur = this.snapshotActiveId();
        if (cur === id) this.removeKey(LOCAL_KEYS.activeSession);
      } else {
        this.writeJson(LOCAL_KEYS.activeSession, data);
      }
      return;
    }
    // prefs
    if (id !== PREF_ACTIVE_PLAN_ID) return;
    const value = data && typeof data.value === 'string' ? data.value : null;
    if (value === null) this.removeKey(LOCAL_KEYS.activePlanId);
    else {
      try {
        this.storage.setItem(this.key(LOCAL_KEYS.activePlanId), value);
      } catch {
        throw new SyncError('local', 'Local storage is full or unavailable.');
      }
    }
  }

  private snapshotActiveId(): string | null {
    try {
      const raw = this.storage.getItem(this.key(LOCAL_KEYS.activeSession));
      if (!raw) return null;
      const a = JSON.parse(raw);
      return hasId(a) ? a.id : null;
    } catch {
      return null;
    }
  }

  private removeKey(base: string): void {
    try {
      this.storage.removeItem(this.key(base));
    } catch {
      throw new SyncError('local', 'Local storage could not be written.');
    }
  }
}
