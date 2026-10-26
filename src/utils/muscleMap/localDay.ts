import type { WorkoutSession } from '../../types';

/**
 * Local calendar-day helpers for the muscle map.
 *
 * A "day key" is a 'YYYY-MM-DD' string naming a LOCAL calendar day. Arithmetic is done on whole
 * calendar days (via UTC day numbers), so it is not affected by DST or by the host timezone.
 *
 * Why not just use `session.date`: it is written with toISOString().split('T')[0] (a UTC date) and
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, so it can be a day off for users far from UTC.
 * `startTime` is a full ISO instant, so converting it with local getters gives the user's own day.
 */

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects e.g. 2026-02-31). */
export function isValidDayKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY_KEY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Whole days since 1970-01-01 for a valid day key. */
export function dayNumber(key: string): number {
  const m = DAY_KEY_RE.exec(key);
  if (!m || !isValidDayKey(key)) throw new RangeError(`Invalid day key: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function dayKeyFromNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return dayKeyFromNumber(dayNumber(key) + days);
}

/** The LOCAL calendar day of an instant, or null for an invalid Date. */
export function localDayKey(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type DayPrecision = 'start-time' | 'date-only';

export interface SessionDay {
  /** Local calendar day, 'YYYY-MM-DD'. */
  day: string;
  /**
   * 'start-time': derived from the session's start instant (local day).
   * 'date-only': fell back to the stored date-only value, which may be off by a day.
   */
  precision: DayPrecision;
}

/**
 * Establishes the calendar day of a session. Prefers `startTime` (local day); falls back to the
 * date-only `date`. Returns null when neither is usable. Never fabricates a time of day.
 */
export function getSessionDay(session: Pick<WorkoutSession, 'startTime' | 'date'>): SessionDay | null {
  const start = session?.startTime;
  // A date-only string in startTime would be parsed as UTC midnight; treat it as date-only instead.
  if (typeof start === 'string' && start.length > 0 && !DAY_KEY_RE.test(start)) {
    const key = localDayKey(new Date(start));
    if (key) return { day: key, precision: 'start-time' };
  }
  if (isValidDayKey(session?.date)) return { day: session.date, precision: 'date-only' };
  if (typeof start === 'string' && isValidDayKey(start)) return { day: start, precision: 'date-only' };
  return null;
}
