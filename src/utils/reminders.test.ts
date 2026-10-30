import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_PREFS, ReminderPrefs, sanitizeReminderPrefs } from '../storage/reminderPrefs';
import { dueReminders, localDateKey, REMINDER_GRACE_MINUTES } from './reminders';

// Wed 2026-10-28 (getDay() === 3)
const at = (h: number, m: number) => new Date(2026, 9, 28, h, m, 0);
const on: ReminderPrefs = {
  workout: { enabled: true, time: '17:30', days: [1, 2, 3, 4, 5] },
  meals: { enabled: true, time: '20:00' }
};
const base = { lastFired: {}, workoutDoneToday: false, mealsLoggedToday: false };

describe('dueReminders', () => {
  it('fires at the set time, not before', () => {
    expect(dueReminders(on, { ...base, now: at(17, 29) })).toEqual([]);
    expect(dueReminders(on, { ...base, now: at(17, 30) })).toEqual(['workout']);
  });

  it('still fires inside the grace window and not after it', () => {
    expect(dueReminders(on, { ...base, now: at(17, 30 + REMINDER_GRACE_MINUTES) })).toEqual(['workout']);
    expect(dueReminders(on, { ...base, now: at(17, 31 + REMINDER_GRACE_MINUTES) })).toEqual([]);
  });

  it('fires at most once per day', () => {
    const lastFired = { workout: localDateKey(at(17, 30)) };
    expect(dueReminders(on, { ...base, lastFired, now: at(17, 40) })).toEqual([]);
    expect(dueReminders(on, { ...base, lastFired: { workout: '2026-10-27' }, now: at(17, 40) })).toEqual(['workout']);
  });

  it('respects selected days', () => {
    const noWed: ReminderPrefs = { ...on, workout: { ...on.workout, days: [1, 2, 4, 5] } };
    expect(dueReminders(noWed, { ...base, now: at(17, 30) })).toEqual([]);
  });

  it('skips the workout reminder if a workout is done, and the meal reminder if food is logged', () => {
    expect(dueReminders(on, { ...base, workoutDoneToday: true, now: at(17, 30) })).toEqual([]);
    expect(dueReminders(on, { ...base, mealsLoggedToday: true, now: at(20, 0) })).toEqual([]);
    expect(dueReminders(on, { ...base, now: at(20, 0) })).toEqual(['meals']);
  });

  it('fires nothing when disabled', () => {
    expect(dueReminders(DEFAULT_REMINDER_PREFS, { ...base, now: at(17, 30) })).toEqual([]);
  });
});

describe('sanitizeReminderPrefs', () => {
  it('falls back to defaults for junk and strips invalid values', () => {
    expect(sanitizeReminderPrefs(null)).toEqual(DEFAULT_REMINDER_PREFS);
    const s = sanitizeReminderPrefs({ workout: { enabled: 'yes', time: '25:99', days: [1, 1, 9, -1, 'x', 3] }, meals: { enabled: true, time: '07:05' } });
    expect(s.workout).toEqual({ enabled: false, time: '17:30', days: [1, 3] });
    expect(s.meals).toEqual({ enabled: true, time: '07:05' });
  });
});
