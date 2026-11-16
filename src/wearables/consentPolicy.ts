/**
 * BT-04B — the single, pure definition of wearable consent categories and of what a consent permits.
 * No browser, no I/O: the server imports this too. The server record (Supabase) is the authority; the browser may cache it.
 */
export const WEARABLE_CONSENT_VERSION = 1;

export const WEARABLE_CONSENT_CATEGORIES = [
  'live_heart_rate',            // live bpm from a real device may be sent to the AI coach
  'historical_heart_rate',      // stored heart-rate history may be sent to the AI coach
  'workout_health_sync',        // wearable measurements may be stored in the account (never implies AI sharing)
  'sleep_and_recovery_metrics', // other wearable metrics: resting HR, HRV, sleep, SpO2, respiratory rate
  'activity_metrics',           // other wearable metrics: steps, energy, distance
] as const;
export type WearableConsentCategory = (typeof WEARABLE_CONSENT_CATEGORIES)[number];

export interface ConsentRecord { version: number; categories: readonly string[] }

const KNOWN = new Set<string>(WEARABLE_CONSENT_CATEGORIES);

/**
 * Categories a stored record actually authorises. No record, or a record written under another consent version
 * (stale), authorises nothing. Unknown category strings are ignored, never trusted.
 */
export function activeCategories(rec: ConsentRecord | null | undefined, currentVersion: number = WEARABLE_CONSENT_VERSION): ReadonlySet<WearableConsentCategory> {
  if (!rec || rec.version !== currentVersion || !Array.isArray(rec.categories)) return new Set();
  return new Set(rec.categories.filter((c): c is WearableConsentCategory => KNOWN.has(c)));
}

export const isWearableConsentCategory = (v: unknown): v is WearableConsentCategory => typeof v === 'string' && KNOWN.has(v);

/** Which consent category lets a metric be SHARED with the AI coach. Live HR is separate from history. */
export function aiCategoryForMetric(metric: string, kind: 'live' | 'history'): WearableConsentCategory | null {
  if (metric === 'heart_rate') return kind === 'live' ? 'live_heart_rate' : 'historical_heart_rate';
  if (metric === 'resting_heart_rate') return kind === 'history' ? 'historical_heart_rate' : null;
  if (['hrv_rmssd', 'hrv_sdnn', 'sleep_duration', 'blood_oxygen', 'respiratory_rate'].includes(metric)) return 'sleep_and_recovery_metrics';
  if (['steps', 'active_energy', 'total_energy', 'distance', 'workout_duration'].includes(metric)) return 'activity_metrics';
  return null;
}

/**
 * A device name is attacker-controllable text (anyone can rename a BLE device) that would land in a prompt.
 * Keep only a short run of letters, digits and a few separators; everything else, including anything that could form
 * markup, a code fence or a new instruction line, is dropped. Returns undefined when nothing usable is left.
 */
export function sanitizeDeviceName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const cleaned = v.normalize('NFKC').replace(/[^\p{L}\p{N} ._()\-+]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 32).trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : undefined;
}

export interface AuthorisedTrainerBluetooth { isConnected: boolean; deviceName?: string; bpm?: number }

/**
 * The ONLY wearable data the AI trainer prompt may contain. Whatever the client sent is reduced to {isConnected, deviceName, bpm},
 * and only when (a) the account has live_heart_rate consent at the current version, (b) the client did not flag it simulated,
 * and (c) bpm is a plausible integer. Without consent nothing is returned, not even the device name.
 * Limit: the server cannot prove a reading came from real hardware; consent and plausibility are what it can enforce.
 */
export function authoriseTrainerBluetooth(raw: unknown, allowed: ReadonlySet<WearableConsentCategory>): AuthorisedTrainerBluetooth {
  const none: AuthorisedTrainerBluetooth = { isConnected: false };
  if (!allowed.has('live_heart_rate') || !raw || typeof raw !== 'object' || Array.isArray(raw)) return none;
  const r = raw as Record<string, unknown>;
  if (r.isConnected !== true || r.isSimulated === true || r.origin === 'simulated') return none;
  const out: AuthorisedTrainerBluetooth = { isConnected: true };
  const name = sanitizeDeviceName(r.deviceName);
  if (name) out.deviceName = name;
  const bpm = typeof r.bpm === 'number' ? r.bpm : NaN;
  if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 255) out.bpm = Math.round(bpm);
  return out;
}
