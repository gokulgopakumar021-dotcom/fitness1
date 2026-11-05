import type { WorkoutPlan, WorkoutSession } from '../types';
import { isPristineStarter } from '../sync/localAdapter';
import { db } from './db';
import { scopedKey } from './storageScope';

/**
 * Legacy data = workout records stored under the old UNSCOPED keys, from before accounts existed. A signed-in
 * account never reads them on its own (storageScope.ts). The only way in is the explicit "claim" below, which the
 * user starts knowingly from a prompt that shows what would be imported.
 *
 * This module only ever READS the unscoped keys (the scope guard allows exactly that and a test pins it).
 * The legacy records are never modified or deleted here, so they stay available if anything goes wrong.
 */
const LEGACY_PLANS_KEY = 'ironlog_plans_v1';
const LEGACY_SESSIONS_KEY = 'ironlog_sessions_v1';
const CLAIM_BASE_KEY = 'ironlog_legacy_claim_v1';

export interface LegacyData {
  plans: WorkoutPlan[];
  sessions: WorkoutSession[];
  /** A legacy key exists but cannot be parsed: it is reported, left untouched and never imported. */
  unreadable: boolean;
}

const hasId = (v: unknown): v is { id: string } =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string' && (v as { id: string }).id.length >= 1 && (v as { id: string }).id.length <= 128;

function readLegacyList(legacyKey: string): { list: unknown[]; unreadable: boolean } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(legacyKey);
  } catch {
    return { list: [], unreadable: true };
  }
  if (raw === null) return { list: [], unreadable: false };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { list: parsed, unreadable: false } : { list: [], unreadable: true };
  } catch {
    return { list: [], unreadable: true };
  }
}

/** Real user records only: untouched starter plans and demo sessions are not "data" worth claiming. */
export function readLegacyWorkoutData(): LegacyData {
  const p = readLegacyList(LEGACY_PLANS_KEY);
  const s = readLegacyList(LEGACY_SESSIONS_KEY);
  return {
    plans: p.list.filter((x) => hasId(x) && !isPristineStarter(x)) as unknown as WorkoutPlan[],
    sessions: s.list.filter((x) => hasId(x) && (x as { isDemo?: boolean }).isDemo !== true) as unknown as WorkoutSession[],
    unreadable: p.unreadable || s.unreadable
  };
}

export type ClaimState = { status: 'dismissed' | 'claimed'; at: string; plans?: number; sessions?: number };

export function getClaimState(): ClaimState | null {
  try {
    const raw = localStorage.getItem(scopedKey(CLAIM_BASE_KEY));
    if (!raw) return null;
    const p = JSON.parse(raw) as ClaimState;
    return p && (p.status === 'dismissed' || p.status === 'claimed') ? p : null;
  } catch {
    return null;
  }
}

function setClaimState(state: ClaimState): void {
  try {
    localStorage.setItem(scopedKey(CLAIM_BASE_KEY), JSON.stringify(state));
  } catch {
    /* the prompt may simply be shown again; no data is affected */
  }
}

/** The user chose "Not now". Remembered for this account on this device; the Settings entry stays available. */
export function dismissLegacyPrompt(): void {
  setClaimState({ status: 'dismissed', at: new Date().toISOString() });
}

/** Whether the automatic prompt should appear: legacy records exist and the user has not decided yet. */
export function shouldPromptLegacyClaim(): { plans: number; sessions: number } | null {
  if (getClaimState()) return null;
  const d = readLegacyWorkoutData();
  return d.plans.length + d.sessions.length > 0 ? { plans: d.plans.length, sessions: d.sessions.length } : null;
}

export interface ClaimResult {
  ok: boolean;
  message: string;
  plans?: { found: number; added: number; replaced: number; keptLocal: number; identical: number };
  sessions?: { found: number; added: number; replaced: number; keptLocal: number; identical: number };
}

/**
 * Merges the legacy records into the signed-in account by stable id (same rules as a backup restore), verifies that
 * every legacy record is now present, and only then records the claim. The legacy keys are never touched.
 * If anything cannot be verified the account's previous records are restored and the legacy data stays where it is.
 */
export function claimLegacyData(): ClaimResult {
  const legacy = readLegacyWorkoutData();
  if (legacy.unreadable) {
    return { ok: false, message: 'The older data on this device could not be read, so nothing was imported. It has not been changed.' };
  }
  if (legacy.plans.length + legacy.sessions.length === 0) {
    return { ok: false, message: 'There is no older data to import.' };
  }
  const prevPlans = db.getPlans();
  const prevSessions = db.getSessions();

  const plans = db.mergeWorkoutRecords('plans', legacy.plans);
  if (!plans) return { ok: false, message: 'The plans could not be saved to your account on this device. Nothing was imported.' };
  const sessions = db.mergeWorkoutRecords('sessions', legacy.sessions);
  if (!sessions) {
    db.savePlans(prevPlans); // undo the plans so the import is all-or-nothing
    return { ok: false, message: 'The workouts could not be saved to your account on this device. Nothing was imported.' };
  }

  // Verify: every legacy record must now exist in this account (either its own version or the newer one that won).
  const havePlans = new Set(db.getPlans().map((p) => p.id));
  const haveSessions = new Set(db.getSessions().map((s) => s.id));
  const complete = legacy.plans.every((p) => havePlans.has(p.id)) && legacy.sessions.every((s) => haveSessions.has(s.id));
  if (!complete) {
    db.savePlans(prevPlans);
    db.saveSessions(prevSessions);
    return { ok: false, message: 'The import could not be verified, so it was undone. Your older data has not been changed.' };
  }

  setClaimState({ status: 'claimed', at: new Date().toISOString(), plans: legacy.plans.length, sessions: legacy.sessions.length });
  const pick = (r: { stats: { added: number; replaced: number; keptLocal: number; identical: number } }, found: number) => ({ found, ...r.stats });
  return {
    ok: true,
    message: `Imported ${legacy.plans.length} plan${legacy.plans.length === 1 ? '' : 's'} and ${legacy.sessions.length} workout${legacy.sessions.length === 1 ? '' : 's'} into your account. Your older data on this device was left untouched.`,
    plans: pick(plans, legacy.plans.length),
    sessions: pick(sessions, legacy.sessions.length)
  };
}
