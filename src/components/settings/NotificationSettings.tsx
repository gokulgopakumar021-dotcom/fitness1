import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button, Card, Input, SectionHeading } from '../ui';
import {
  getReminderPrefs,
  isValidTime,
  ReminderPrefs,
  saveReminderPrefs
} from '../../storage/reminderPrefs';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Permission = NotificationPermission | 'unsupported';

const readPermission = (): Permission =>
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';

export const NotificationSettings: React.FC = () => {
  const [prefs, setPrefs] = useState<ReminderPrefs>(() => getReminderPrefs());
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = (next: ReminderPrefs) => {
    setPrefs(next);
    setSaveError(saveReminderPrefs(next) ? null : 'Could not save reminder settings on this device.');
  };

  const requestPermission = async (): Promise<Permission> => {
    if (permission === 'unsupported') return permission;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return readPermission();
    }
  };

  /** Turning a reminder on asks for browser permission first; it stays off if the person declines. */
  const toggle = async (kind: 'workout' | 'meals', enabled: boolean) => {
    if (enabled && permission !== 'granted') {
      const result = await requestPermission();
      if (result !== 'granted') return;
    }
    update({ ...prefs, [kind]: { ...prefs[kind], enabled } });
  };

  const toggleDay = (day: number) => {
    const days = prefs.workout.days.includes(day)
      ? prefs.workout.days.filter((d) => d !== day)
      : [...prefs.workout.days, day].sort();
    update({ ...prefs, workout: { ...prefs.workout, days } });
  };

  const blocked = permission === 'denied' || permission === 'unsupported';

  return (
    <Card as="section" aria-labelledby="notifications-heading" className="space-y-4">
      <SectionHeading
        level={3}
        title="Notifications"
        description="Reminders appear as browser notifications while Iron Log is open. Nothing is sent when the app is closed."
      />
      <span id="notifications-heading" className="sr-only">
        Notifications
      </span>

      {permission === 'unsupported' && (
        <p className="text-xs text-zinc-400">This browser does not support notifications, so reminders are unavailable.</p>
      )}
      {permission === 'denied' && (
        <p className="text-xs text-warning" role="status">
          Notifications are blocked for this site. Allow them in your browser's site settings to use reminders.
        </p>
      )}
      {permission === 'default' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-zinc-400">Allow notifications to turn reminders on.</p>
          <Button type="button" variant="secondary" size="sm" icon={<Bell className="h-4 w-4" aria-hidden />} onClick={requestPermission}>
            Allow notifications
          </Button>
        </div>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <label className="flex items-start justify-between gap-3 min-h-11">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">Workout reminder</span>
            <span className="block text-label text-zinc-500">Skipped on days you've already completed a workout.</span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={prefs.workout.enabled}
            disabled={permission === 'unsupported' || (blocked && !prefs.workout.enabled)}
            onChange={(e) => toggle('workout', e.target.checked)}
            aria-label="Workout reminder"
          />
        </label>
        {prefs.workout.enabled && (
          <div className="space-y-3 pl-0 sm:pl-1">
            <Input
              type="time"
              label="Remind me at"
              value={prefs.workout.time}
              onChange={(e) => isValidTime(e.target.value) && update({ ...prefs, workout: { ...prefs.workout, time: e.target.value } })}
              wrapperClassName="max-w-[10rem]"
            />
            <div>
              <div className="text-xs font-medium text-zinc-300 mb-1.5">On these days</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminder days">
                {DAY_LABELS.map((label, day) => {
                  const on = prefs.workout.days.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(day)}
                      className={`h-10 min-w-11 px-3 rounded-control text-xs font-medium border transition-colors ${
                        on ? 'bg-accent text-accent-ink border-accent' : 'bg-surface-2 text-zinc-300 border-line-strong hover:bg-surface-3'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {prefs.workout.days.length === 0 && (
                <p className="text-label text-warning mt-1.5">No days selected, so this reminder will never fire.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <label className="flex items-start justify-between gap-3 min-h-11">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">Meal logging reminder</span>
            <span className="block text-label text-zinc-500">Only if you haven't logged any food that day.</span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={prefs.meals.enabled}
            disabled={permission === 'unsupported' || (blocked && !prefs.meals.enabled)}
            onChange={(e) => toggle('meals', e.target.checked)}
            aria-label="Meal logging reminder"
          />
        </label>
        {prefs.meals.enabled && (
          <Input
            type="time"
            label="Remind me at"
            value={prefs.meals.time}
            onChange={(e) => isValidTime(e.target.value) && update({ ...prefs, meals: { ...prefs.meals, time: e.target.value } })}
            wrapperClassName="max-w-[10rem]"
          />
        )}
      </div>

      <p className="text-label text-zinc-500 border-t border-line pt-3">
        Hydration alerts are configured separately under Nutrition → Water.
      </p>
      {saveError && (
        <p role="alert" className="text-label text-danger">
          {saveError}
        </p>
      )}
    </Card>
  );
};
