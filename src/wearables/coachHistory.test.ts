import { describe, expect, it } from 'vitest';
import { buildCoachHrHistory, COACH_HISTORY_MAX_SESSIONS, COACH_HISTORY_MAX_SESSION_MS, COACH_HISTORY_MIN_READINGS, formatCoachHrHistory, type HistorySample } from './coachHistory';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const DAY = 86_400_000;
const w = (sessionId: string, startAgoMs: number, n: number, bpm: number | ((i: number) => number), stepMs = 30_000): HistorySample[] =>
  Array.from({ length: n }, (_, i) => ({ sessionId, bpm: typeof bpm === 'function' ? bpm(i) : bpm, measuredAt: new Date(NOW.getTime() - startAgoMs + i * stepMs).toISOString() }));

describe('buildCoachHrHistory', () => {
  it('summarises each workout: date, minutes, min/avg/max, readings; newest first', () => {
    const h = buildCoachHrHistory([...w('a', 3 * DAY, 30, (i) => 100 + i), ...w('b', 1 * DAY, 20, 140)], NOW, false);
    expect(h.sessions).toHaveLength(2);
    expect(h.sessions[0]).toEqual({ date: '2026-11-15', minutes: 10, minBpm: 140, avgBpm: 140, maxBpm: 140, readings: 20 });
    expect(h.sessions[1]).toMatchObject({ date: '2026-11-13', minBpm: 100, maxBpm: 129, avgBpm: 115, readings: 30 });
    expect(h.partial).toBe(false);
  });
  it('skips readings outside the 30-day window, in the future, or implausible; never repairs them', () => {
    const bad: HistorySample[] = [
      ...w('old', 40 * DAY, 20, 120), ...w('fut', -2 * DAY, 20, 120),
      ...w('x', DAY, 12, 300), ...w('y', DAY, 12, 5), ...w('z', DAY, 12, Number.NaN)
    ];
    expect(buildCoachHrHistory(bad, NOW, false).sessions).toEqual([]);
  });
  it('drops thin workouts and labels that span more than one workout', () => {
    expect(buildCoachHrHistory(w('thin', DAY, COACH_HISTORY_MIN_READINGS - 1, 130), NOW, false).sessions).toEqual([]);
    expect(buildCoachHrHistory(w('ok', DAY, COACH_HISTORY_MIN_READINGS, 130), NOW, false).sessions).toHaveLength(1);
    const long = w('long', 3 * DAY, 12, 130, COACH_HISTORY_MAX_SESSION_MS / 6);
    expect(buildCoachHrHistory(long, NOW, false).sessions).toEqual([]);
  });
  it('keeps only the most recent few workouts', () => {
    const many = Array.from({ length: 9 }, (_, i) => w(`s${i}`, (i + 1) * DAY, 15, 120)).flat();
    const h = buildCoachHrHistory(many, NOW, false);
    expect(h.sessions).toHaveLength(COACH_HISTORY_MAX_SESSIONS);
    expect(h.sessions[0].date).toBe('2026-11-15');
  });
  it('a capped read drops the oldest workout (possibly incomplete) and flags the result partial', () => {
    const h = buildCoachHrHistory([...w('a', 3 * DAY, 15, 120), ...w('b', 1 * DAY, 15, 130)], NOW, true);
    expect(h.sessions.map((s) => s.avgBpm)).toEqual([130]);
    expect(h.partial).toBe(true);
  });
  it('ignores samples without a usable session id', () => {
    const s = w('a', DAY, 15, 120).map((x) => ({ ...x, sessionId: '' }));
    expect(buildCoachHrHistory(s, NOW, false).sessions).toEqual([]);
  });
  it('returns an empty summary for no samples', () => {
    expect(buildCoachHrHistory([], NOW, false)).toEqual({ windowDays: 30, sessions: [], partial: false });
  });
});

describe('formatCoachHrHistory', () => {
  it('is digits, dates and fixed words only, and labels itself informational and read-only', () => {
    const text = formatCoachHrHistory(buildCoachHrHistory(w('a', DAY, 15, 125), NOW, false));
    expect(text).toMatch(/read-only data.*informational, not a medical measurement, never a diagnosis/);
    expect(text).toMatch(/- 2026-11-15: 7 min, average 125 bpm \(lowest 125, highest 125\), 15 readings/);
    expect(text).not.toMatch(/['"`<>{}\[\]]{2,}/);
  });
  it('says plainly when nothing usable is stored, and when older workouts were not loaded', () => {
    expect(formatCoachHrHistory({ windowDays: 30, sessions: [], partial: false })).toMatch(/no usable workout heart rate is stored/);
    const sessions = buildCoachHrHistory(w('a', DAY, 15, 125), NOW, false).sessions;
    expect(formatCoachHrHistory({ windowDays: 30, sessions, partial: true })).toMatch(/Older workouts in this window were not loaded/);
  });
  it('uses the singular for one workout', () => {
    expect(formatCoachHrHistory(buildCoachHrHistory(w('a', DAY, 15, 125), NOW, false))).toMatch(/1 recent workout, newest first/);
  });
});
