import { getStorageScope, scopedKey, SIGNED_OUT_SCOPE } from '../storage/storageScope';

/**
 * On-device outbox for REAL heart-rate readings that have not been confirmed by the server yet, so a reload or crash during a
 * workout does not lose them. This is a retry buffer, not a health record: the server stays the only place readings are stored.
 *
 *  - The key is always scopedKey(...): per account on this browser profile. Nothing is ever written without an account scope
 *    (never to the legacy unscoped name, never while signed out).
 *  - The adapter is bound to the scope that existed when it was created. If the active account changes, every operation becomes
 *    a no-op, so a late write from a previous account's controller can never land in another account's key.
 *  - Stored data is untrusted on read: it is re-validated (shape, scope, canonical timestamps, plausible bpm, age, size).
 *  - Timestamps are stored exactly as first generated, so a retry reuses them and the server's idempotency absorbs repeats.
 *  - Entries older than OUTBOX_MAX_AGE_MS are dropped. The total is capped.
 * Client-side separation on a shared browser profile is not access control (see storageScope.ts).
 */

export const OUTBOX_BASE_KEY = 'ironlog_wearable_hr_outbox';
export const OUTBOX_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const OUTBOX_MAX_PER_SESSION = 1000;
export const OUTBOX_MAX_TOTAL = 2000;
const MAX_SESSIONS = 20;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface PendingReading { value: number; measuredAt: string }
export interface OutboxDevice { key: string; name: string }
export interface OutboxContents { device: OutboxDevice; buffers: Map<string, PendingReading[]> }

export interface OutboxStore {
  /** Returns validated contents for the bound account, or null (nothing stored, wrong scope, corrupt). */
  load(nowMs: number): OutboxContents | null;
  save(device: OutboxDevice, buffers: Map<string, PendingReading[]>): void;
  clear(): void;
}

interface Persisted {
  v: 1;
  scope: string;
  savedAt: string;
  device: OutboxDevice;
  buffers: Record<string, PendingReading[]>;
}

const cleanText = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t.length > 0 && t.length <= max ? t : null;
};

/** Pure. Validates and normalises stored text; returns null when it cannot be trusted at all. */
export function parseOutbox(raw: string | null, scope: string, nowMs: number): OutboxContents | null {
  if (!raw || raw.length > 1_500_000) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const p = j as Record<string, unknown>;
  if (p.v !== 1 || p.scope !== scope) return null;
  const dev = p.device as Record<string, unknown> | undefined;
  const key = cleanText(dev?.key, 128);
  const name = cleanText(dev?.name, 80);
  if (!key || !name) return null;
  if (!p.buffers || typeof p.buffers !== 'object' || Array.isArray(p.buffers)) return null;

  const out = new Map<string, PendingReading[]>();
  let total = 0;
  for (const [sessionId, list] of Object.entries(p.buffers as Record<string, unknown>)) {
    if (out.size >= MAX_SESSIONS) break;
    const sid = cleanText(sessionId, 128);
    if (!sid || sid !== sessionId || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const kept: PendingReading[] = [];
    for (const it of list.slice(0, OUTBOX_MAX_PER_SESSION * 2)) {
      if (!it || typeof it !== 'object') continue;
      const { value, measuredAt } = it as Record<string, unknown>;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 20 || value > 255) continue;
      if (typeof measuredAt !== 'string') continue;
      const t = Date.parse(measuredAt);
      // Only canonical ISO strings: the server dedupes on the exact timestamp, so a retry must send what was first generated.
      if (!Number.isFinite(t) || new Date(t).toISOString() !== measuredAt) continue;
      if (nowMs - t > OUTBOX_MAX_AGE_MS || t - nowMs > FUTURE_SKEW_MS) continue;
      if (seen.has(measuredAt)) continue;
      seen.add(measuredAt);
      kept.push({ value, measuredAt });
    }
    kept.sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
    if (kept.length > OUTBOX_MAX_PER_SESSION) kept.splice(0, kept.length - OUTBOX_MAX_PER_SESSION);
    if (kept.length === 0) continue;
    out.set(sid, kept);
    total += kept.length;
  }
  if (out.size === 0) return null;
  if (total > OUTBOX_MAX_TOTAL) trimToTotal(out, OUTBOX_MAX_TOTAL);
  return { device: { key, name }, buffers: out };
}

/** Drops the oldest readings across all sessions until at most `max` remain. */
export function trimToTotal(buffers: Map<string, PendingReading[]>, max: number): void {
  let total = 0;
  for (const b of buffers.values()) total += b.length;
  while (total > max) {
    let oldestSid: string | null = null;
    let oldestAt = '';
    for (const [sid, b] of buffers) {
      if (b.length && (oldestSid === null || b[0].measuredAt < oldestAt)) { oldestSid = sid; oldestAt = b[0].measuredAt; }
    }
    if (oldestSid === null) break;
    buffers.get(oldestSid)!.shift();
    total--;
  }
  for (const [sid, b] of [...buffers]) if (b.length === 0) buffers.delete(sid);
}

const isRealScope = (s: string | null): s is string => !!s && s !== SIGNED_OUT_SCOPE;

/**
 * Creates an outbox bound to the CURRENT account scope, or null when nobody is signed in (nothing may be persisted then).
 */
export function createScopedOutbox(): OutboxStore | null {
  const bound = getStorageScope();
  if (!isRealScope(bound)) return null;
  const active = () => getStorageScope() === bound;
  return {
    load(nowMs) {
      if (!active()) return null;
      try { return parseOutbox(localStorage.getItem(scopedKey(OUTBOX_BASE_KEY)), bound, nowMs); } catch { return null; }
    },
    save(device, buffers) {
      if (!active()) return;
      try {
        const copy = new Map([...buffers].map(([k, v]) => [k, v.slice()] as [string, PendingReading[]]));
        trimToTotal(copy, OUTBOX_MAX_TOTAL);
        if (copy.size === 0) { localStorage.removeItem(scopedKey(OUTBOX_BASE_KEY)); return; }
        const body: Persisted = { v: 1, scope: bound, savedAt: new Date().toISOString(), device, buffers: Object.fromEntries(copy) };
        localStorage.setItem(scopedKey(OUTBOX_BASE_KEY), JSON.stringify(body));
      } catch { /* storage full or unavailable: the in-memory buffer still works */ }
    },
    clear() {
      if (!active()) return;
      try { localStorage.removeItem(scopedKey(OUTBOX_BASE_KEY)); } catch { /* ignore */ }
    }
  };
}

/**
 * Removes the outbox of the account that is active RIGHT NOW. Called by AuthGate just before the scope changes (sign-out or
 * account switch). A no-op when no real account scope is active, so a reload never wipes the signed-in user's unsent readings.
 */
export function clearWearableOutbox(): void {
  if (!isRealScope(getStorageScope())) return;
  try { localStorage.removeItem(scopedKey(OUTBOX_BASE_KEY)); } catch { /* ignore */ }
}
