import { useEffect, useRef, useState } from 'react';
import { localDayKey } from '../../utils/muscleMap/localDay';

/** The next local midnight after `from`, built from local calendar fields (never "from + 24 h"), so DST days are right. */
export function nextLocalMidnight(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
}

/**
 * Returns a `now` that only changes when the LOCAL calendar day changes, and calls `onRollover` once per change.
 *
 * - One timer, aimed at the next local midnight. Timers are throttled or delayed in background tabs and on sleeping
 *   devices, so the local day is also re-checked when the page becomes visible or is restored (`visibilitychange`, `pageshow`).
 * - Every trigger funnels through `check()`: if the local day is unchanged (timer fired early, or nothing moved) it only
 *   reschedules; it never assumes a timer firing means a new day.
 * - No polling, no storage, no network. The effect cleans up its timer and listeners on unmount.
 */
export function useLocalDayRollover(onRollover: () => void): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  const dayRef = useRef<string | null>(localDayKey(now));
  const callbackRef = useRef(onRollover);
  callbackRef.current = onRollover;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      const clock = new Date();
      timer = setTimeout(check, Math.max(1, nextLocalMidnight(clock).getTime() - clock.getTime()));
    };

    function check() {
      if (cancelled) return;
      const current = new Date();
      const key = localDayKey(current);
      if (key && key !== dayRef.current) {
        dayRef.current = key;
        setNow(current);
        callbackRef.current();
      }
      schedule();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', check);
    check(); // covers a day change between the first render and this effect, and schedules the single timer

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', check);
    };
  }, []);

  return now;
}
