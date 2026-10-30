import type { ReminderKind, ReminderPrefs } from '../storage/reminderPrefs';

/** A reminder may still fire this long after its time (covers throttled background tabs and laptop wake-ups). */
export const REMINDER_GRACE_MINUTES = 20;

export const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export interface ReminderContext {
  now: Date;
  lastFired: Partial<Record<ReminderKind, string>>;
  workoutDoneToday: boolean;
  mealsLoggedToday: boolean;
}

/** Pure: which reminders should fire right now. */
export function dueReminders(prefs: ReminderPrefs, ctx: ReminderContext): ReminderKind[] {
  const today = localDateKey(ctx.now);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const due: ReminderKind[] = [];

  const inWindow = (time: string) => {
    const t = minutesOf(time);
    return nowMin >= t && nowMin - t <= REMINDER_GRACE_MINUTES;
  };

  if (
    prefs.workout.enabled &&
    prefs.workout.days.includes(ctx.now.getDay()) &&
    inWindow(prefs.workout.time) &&
    ctx.lastFired.workout !== today &&
    !ctx.workoutDoneToday
  ) {
    due.push('workout');
  }
  if (prefs.meals.enabled && inWindow(prefs.meals.time) && ctx.lastFired.meals !== today && !ctx.mealsLoggedToday) {
    due.push('meals');
  }
  return due;
}
