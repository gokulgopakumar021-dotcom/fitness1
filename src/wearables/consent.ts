/**
 * Separate, explicit, revocable consent for letting an external AI provider see wearable/health data.
 * Off by default. This module is the single gate; the server must ALSO enforce it before any prompt includes health fields.
 */
import { scopedKey } from '../storage/storageScope';

export const WEARABLE_AI_CONSENT_KEY = 'ironlog_wearable_ai_consent_v1';
/** Bump when categories or purpose change; stored consent for an older version no longer counts. */
export const WEARABLE_AI_CONSENT_VERSION = 1;

export const WEARABLE_AI_CATEGORIES = ['live_heart_rate', 'sleep_and_recovery_metrics', 'activity_metrics'] as const;
export type WearableAiCategory = (typeof WEARABLE_AI_CATEGORIES)[number];

export interface WearableAiConsent { version: number; categories: WearableAiCategory[]; grantedAt: string }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Consent is per ACCOUNT on a shared device: the key is always passed through scopedKey (see localStorageScopeGuard.test.ts).
const accountStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(scopedKey(k)),
  setItem: (k, v) => localStorage.setItem(scopedKey(k), v),
  removeItem: (k) => localStorage.removeItem(scopedKey(k)),
};
// Every caller wraps access in try/catch, so a missing localStorage (SSR, privacy mode) degrades to "no consent".
const store = (s?: StorageLike): StorageLike => s ?? accountStorage;

export function readWearableAiConsent(storage?: StorageLike): WearableAiConsent | null {
  try {
    const raw = store(storage)?.getItem(WEARABLE_AI_CONSENT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<WearableAiConsent>;
    if (p.version !== WEARABLE_AI_CONSENT_VERSION || !Array.isArray(p.categories) || typeof p.grantedAt !== 'string') return null;
    const categories = p.categories.filter((c): c is WearableAiCategory => (WEARABLE_AI_CATEGORIES as readonly string[]).includes(c));
    return categories.length ? { version: p.version, categories, grantedAt: p.grantedAt } : null;
  } catch { return null; }
}

export function grantWearableAiConsent(categories: WearableAiCategory[], storage?: StorageLike, now: () => Date = () => new Date()): WearableAiConsent | null {
  const valid = categories.filter((c) => (WEARABLE_AI_CATEGORIES as readonly string[]).includes(c));
  if (!valid.length) return null;
  const c: WearableAiConsent = { version: WEARABLE_AI_CONSENT_VERSION, categories: [...new Set(valid)], grantedAt: now().toISOString() };
  try { store(storage)?.setItem(WEARABLE_AI_CONSENT_KEY, JSON.stringify(c)); } catch { return null; }
  return c;
}

export function revokeWearableAiConsent(storage?: StorageLike): void {
  try { store(storage)?.removeItem(WEARABLE_AI_CONSENT_KEY); } catch { /* nothing stored */ }
}

export const hasWearableAiConsent = (cat: WearableAiCategory, storage?: StorageLike) =>
  !!readWearableAiConsent(storage)?.categories.includes(cat);
