import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_PREFS, getLastFired, getReminderPrefs, markFired, saveReminderPrefs } from './reminderPrefs';
import { setStorageScope } from './storageScope';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(() => { localStorage.clear(); setStorageScope(A); });
afterEach(() => setStorageScope(null));

describe('reminderPrefs storage', () => {
  it('defaults to everything off', () => {
    expect(getReminderPrefs()).toEqual(DEFAULT_REMINDER_PREFS);
    expect(DEFAULT_REMINDER_PREFS.workout.enabled).toBe(false);
    expect(DEFAULT_REMINDER_PREFS.meals.enabled).toBe(false);
  });
  it('round-trips and is scoped per account', () => {
    saveReminderPrefs({ workout: { enabled: true, time: '06:15', days: [1, 3] }, meals: { enabled: false, time: '20:00' } });
    expect(getReminderPrefs().workout).toEqual({ enabled: true, time: '06:15', days: [1, 3] });
    setStorageScope(B);
    expect(getReminderPrefs()).toEqual(DEFAULT_REMINDER_PREFS);
  });
  it('survives corrupt storage', () => {
    saveReminderPrefs(DEFAULT_REMINDER_PREFS);
    markFired('workout', '2026-10-28');
    for (const k of Object.keys(localStorage)) localStorage.setItem(k, '{not json');
    expect(getReminderPrefs()).toEqual(DEFAULT_REMINDER_PREFS);
    expect(getLastFired()).toEqual({});
  });
  it('records last-fired per kind', () => {
    markFired('workout', '2026-10-28');
    markFired('meals', '2026-10-27');
    expect(getLastFired()).toEqual({ workout: '2026-10-28', meals: '2026-10-27' });
  });
});
