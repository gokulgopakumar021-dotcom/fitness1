import { WEARABLE_CONSENT_CATEGORIES, isWearableConsentCategory, type WearableConsentCategory } from './consentPolicy';

/**
 * BT-04C task 4 — the read-only audit trail of consent changes (table wearable_consent_events, written only by the
 * set_my_wearable_consent() function). Pure: no browser, no I/O; the server and the UI both import it.
 * The trail can be read, never edited or deleted from the app.
 */
export type ConsentAction = 'granted' | 'revoked';

export interface ConsentEvent {
  category: WearableConsentCategory;
  action: ConsentAction;
  /** The consent version in force when the change was recorded. */
  version: number;
  /** ISO timestamp set by the database. */
  at: string;
}

/** The most events one read returns (newest first). The server asks for one more to learn whether there are older ones. */
export const CONSENT_HISTORY_LIMIT = 100;

/** Short names for the history list (the consent switches use longer, explanatory titles). */
export const CONSENT_CATEGORY_LABELS: Record<WearableConsentCategory, string> = {
  live_heart_rate: 'Live heart rate with Coach Iron',
  historical_heart_rate: 'Heart-rate history with Coach Iron',
  workout_health_sync: 'Saving workout heart rate',
  sleep_and_recovery_metrics: 'Recovery metrics',
  activity_metrics: 'Activity metrics'
};

export function isConsentEvent(v: unknown): v is ConsentEvent {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return isWearableConsentCategory(e.category)
    && (e.action === 'granted' || e.action === 'revoked')
    && typeof e.version === 'number' && Number.isInteger(e.version) && e.version >= 1
    && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at));
}

/**
 * Turns database rows into events. A row that is not the expected shape (unknown category, bad time, ...) is skipped, never
 * repaired or guessed. The result is newest first and never longer than CONSENT_HISTORY_LIMIT; `truncated` says older events exist.
 */
export function toConsentEvents(rows: unknown, limit: number = CONSENT_HISTORY_LIMIT): { events: ConsentEvent[]; truncated: boolean } {
  if (!Array.isArray(rows)) return { events: [], truncated: false };
  const events: ConsentEvent[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    const candidate = { category: row.category, action: row.action, version: row.consent_version, at: row.created_at };
    if (isConsentEvent(candidate)) events.push(candidate);
  }
  return { events: events.slice(0, limit), truncated: rows.length > limit };
}

/** The category ids this module knows, for tests that must stay in step with consentPolicy. */
export const CONSENT_HISTORY_CATEGORIES = WEARABLE_CONSENT_CATEGORIES;
