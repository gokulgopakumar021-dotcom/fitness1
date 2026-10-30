import { scopedKey } from './storageScope';

/**
 * Reminder preferences. Reminders are delivered as browser notifications by hooks/useReminders while Iron Log
 * is open (tab or installed app). There is no push server / service worker, so nothing fires when the app is closed.
 */
export const REMINDER_PREFS_KEY = 'ironlog_reminder_prefs_v1';
export const REMINDER_LAST_KEY = 'ironlog_reminder_last_v1';

export type ReminderKind = 'workout' | 'meals';

export interface ReminderPrefs {
  workout: { enabled: boolean; time: string; days: number[] }; // days: 0=Sun … 6=Sat
  meals: { enabled: boolean; time: string };
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  workout: { enabled: false, time: '17:30', days: [1, 2, 3, 4, 5] },
  meals: { enabled: false, time: '20:00' }
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v);

export function sanitizeReminderPrefs(raw: unknown): ReminderPrefs {
  const d = DEFAULT_REMINDER_PREFS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const days = Array.isArray(r.workout?.days)
    ? Array.from(new Set<number>(r.workout.days.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6))).sort()
    : d.workout.days;
  return {
    workout: {
      enabled: r.workout?.enabled === true,
      time: isValidTime(r.workout?.time) ? r.workout.time : d.workout.time,
      days
    },
    meals: {
      enabled: r.meals?.enabled === true,
      time: isValidTime(r.meals?.time) ? r.meals.time : d.meals.time
    }
  };
}

export function getReminderPrefs(): ReminderPrefs {
  try {
    const raw = localStorage.getItem(scopedKey(REMINDER_PREFS_KEY));
    return sanitizeReminderPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeReminderPrefs(null);
  }
}

export function saveReminderPrefs(prefs: ReminderPrefs): boolean {
  try {
    localStorage.setItem(scopedKey(REMINDER_PREFS_KEY), JSON.stringify(sanitizeReminderPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

/** Date key (YYYY-MM-DD, local) of the last day each reminder fired, so it fires at most once per day. */
export function getLastFired(): Partial<Record<ReminderKind, string>> {
  try {
    const raw = localStorage.getItem(scopedKey(REMINDER_LAST_KEY));
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function markFired(kind: ReminderKind, dateKey: string): void {
  try {
    localStorage.setItem(scopedKey(REMINDER_LAST_KEY), JSON.stringify({ ...getLastFired(), [kind]: dateKey }));
  } catch {
    /* ignore */
  }
}
