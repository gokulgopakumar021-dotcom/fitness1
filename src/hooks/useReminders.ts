import { useEffect } from 'react';
import { db } from '../storage/db';
import { getLastFired, getReminderPrefs, markFired, ReminderKind } from '../storage/reminderPrefs';
import { dueReminders, localDateKey } from '../utils/reminders';

const TICK_MS = 30_000;

const MESSAGES: Record<ReminderKind, { title: string; body: string }> = {
  workout: { title: 'Time to train', body: 'Your workout reminder from IronLog AI.' },
  meals: { title: 'Log your meals', body: "You haven't logged any food today." }
};

/** Checks every 30 s (and when the tab becomes visible) and shows a browser notification when one is due. */
export function useReminders(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const check = () => {
      if (Notification.permission !== 'granted') return;
      const prefs = getReminderPrefs();
      if (!prefs.workout.enabled && !prefs.meals.enabled) return;
      const now = new Date();
      const today = localDateKey(now);
      const due = dueReminders(prefs, {
        now,
        lastFired: getLastFired(),
        workoutDoneToday: db.getSessions().some((s) => s.date === today && s.status === 'completed'),
        mealsLoggedToday: db.getNutritionLogs().some((l) => l.date === today && l.entries.length > 0)
      });
      for (const kind of due) {
        try {
          new Notification(MESSAGES[kind].title, { body: MESSAGES[kind].body, tag: `ironlog-${kind}` });
          markFired(kind, today);
        } catch {
          /* notification could not be shown; try again next tick within the grace window */
        }
      }
    };

    check();
    const id = window.setInterval(check, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
