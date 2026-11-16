import { describe, expect, it } from 'vitest';
import { WEARABLE_CONSENT_CATEGORIES } from './consentPolicy';
import { CONSENT_CATEGORY_LABELS, CONSENT_HISTORY_LIMIT, isConsentEvent, toConsentEvents } from './consentHistory';

const row = (over: Record<string, unknown> = {}) => ({ category: 'live_heart_rate', action: 'granted', consent_version: 1, created_at: '2026-11-16T10:00:00.000Z', ...over });

describe('consent history model', () => {
  it('has a label for every consent category (stays in step with consentPolicy)', () => {
    expect(Object.keys(CONSENT_CATEGORY_LABELS).sort()).toEqual([...WEARABLE_CONSENT_CATEGORIES].sort());
    for (const l of Object.values(CONSENT_CATEGORY_LABELS)) expect(l.length).toBeGreaterThan(3);
  });
  it('maps database rows to events', () => {
    expect(toConsentEvents([row()])).toEqual({ events: [{ category: 'live_heart_rate', action: 'granted', version: 1, at: '2026-11-16T10:00:00.000Z' }], truncated: false });
  });
  it('skips rows that are not the expected shape instead of repairing them', () => {
    const bad = [row({ category: 'dna' }), row({ action: 'deleted' }), row({ consent_version: 0 }), row({ consent_version: 1.5 }), row({ consent_version: '1' }), row({ created_at: 'nope' }), row({ created_at: null }), null, 'x', 7, []];
    const { events } = toConsentEvents([...bad, row({ category: 'workout_health_sync', action: 'revoked' })]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ category: 'workout_health_sync', action: 'revoked' });
  });
  it('returns nothing for a non-array', () => {
    for (const v of [null, undefined, {}, 'x', 5]) expect(toConsentEvents(v)).toEqual({ events: [], truncated: false });
  });
  it('caps at the limit and reports that older events exist', () => {
    const rows = Array.from({ length: CONSENT_HISTORY_LIMIT + 1 }, () => row());
    const r = toConsentEvents(rows);
    expect(r.events).toHaveLength(CONSENT_HISTORY_LIMIT);
    expect(r.truncated).toBe(true);
    expect(toConsentEvents(rows.slice(0, CONSENT_HISTORY_LIMIT)).truncated).toBe(false);
  });
  it('does not carry extra database fields (ids, user ids) into an event', () => {
    const { events } = toConsentEvents([row({ id: 99, user_id: 'user-a' })]);
    expect(Object.keys(events[0]).sort()).toEqual(['action', 'at', 'category', 'version']);
    expect(isConsentEvent({ ...events[0] })).toBe(true);
  });
});
