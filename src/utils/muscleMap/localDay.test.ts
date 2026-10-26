import { describe, expect, it } from 'vitest';
import { addDays, dayKeyFromNumber, dayNumber, getSessionDay, isValidDayKey, localDayKey } from './localDay';

// All Date objects below are built with LOCAL-time constructors so these tests do not depend on the
// timezone of the machine running them.
const localIso = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe('day keys', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDayKey('2026-10-25')).toBe(true);
    expect(isValidDayKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '26-10-25', '2026-10-25T10:00:00Z', '', null, undefined, 20261025])
      expect(isValidDayKey(bad)).toBe(false);
  });

  it('does calendar arithmetic across month, year, leap-day and DST boundaries', () => {
    expect(addDays('2026-10-25', -35)).toBe('2026-09-20');
    expect(addDays('2026-10-25', -7)).toBe('2026-10-18');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US DST start
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31'); // US DST end
    expect(dayKeyFromNumber(dayNumber('2026-10-25'))).toBe('2026-10-25');
    expect(dayNumber('2026-10-26') - dayNumber('2026-10-25')).toBe(1);
  });

  it('rejects invalid keys in dayNumber', () => {
    expect(() => dayNumber('2026-02-30')).toThrow(RangeError);
    expect(() => dayNumber('nope')).toThrow(RangeError);
  });

  it('names the LOCAL calendar day of an instant', () => {
    expect(localDayKey(new Date(2026, 9, 25, 0, 5))).toBe('2026-10-25');
    expect(localDayKey(new Date(2026, 9, 25, 23, 55))).toBe('2026-10-25');
    expect(localDayKey(new Date('not a date'))).toBeNull();
  });
});

describe('getSessionDay', () => {
  it('prefers startTime (local day) over the stored date-only value', () => {
    const r = getSessionDay({ startTime: localIso(2026, 10, 20, 23, 30), date: '2026-10-21' });
    expect(r).toEqual({ day: '2026-10-20', precision: 'start-time' });
    const early = getSessionDay({ startTime: localIso(2026, 10, 20, 0, 30), date: '2026-10-19' });
    expect(early).toEqual({ day: '2026-10-20', precision: 'start-time' });
  });

  it('falls back to the date-only value and says so', () => {
    expect(getSessionDay({ startTime: '', date: '2026-10-20' })).toEqual({ day: '2026-10-20', precision: 'date-only' });
    expect(getSessionDay({ startTime: 'garbage', date: '2026-10-20' })).toEqual({ day: '2026-10-20', precision: 'date-only' });
  });

  it('treats a date-only startTime as date-only (it would otherwise parse as UTC midnight)', () => {
    expect(getSessionDay({ startTime: '2026-10-20', date: '' })).toEqual({ day: '2026-10-20', precision: 'date-only' });
  });

  it('returns null when nothing usable exists, and never invents a day', () => {
    expect(getSessionDay({ startTime: '', date: '' })).toBeNull();
    expect(getSessionDay({ startTime: 'x', date: '2026-02-31' })).toBeNull();
    expect(getSessionDay(undefined as never)).toBeNull();
  });
});
