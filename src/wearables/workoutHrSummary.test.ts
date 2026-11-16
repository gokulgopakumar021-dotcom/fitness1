import { describe, expect, it } from 'vitest';
import { isWorkoutHrSummary, summarizeWorkoutHeartRate, type StoredHrSample } from './workoutHrSummary';

const T0 = Date.parse('2026-11-15T10:00:00Z');
const s = (secs: number, bpm: number, verified: boolean | null = true): StoredHrSample => ({ bpm, measuredAt: new Date(T0 + secs * 1000).toISOString(), verified });

describe('summarizeWorkoutHeartRate', () => {
  it('returns null when nothing is stored (never an invented summary)', () => {
    expect(summarizeWorkoutHeartRate([])).toBeNull();
  });

  it('computes min / avg / max / count from the stored samples only', () => {
    const r = summarizeWorkoutHeartRate([s(0, 100), s(5, 140), s(10, 120)])!;
    expect(r).toMatchObject({ sampleCount: 3, minBpm: 100, maxBpm: 140, avgBpm: 120, truncated: false });
    expect(r.firstAt).toBe('2026-11-15T10:00:00.000Z');
    expect(r.lastAt).toBe('2026-11-15T10:00:10.000Z');
  });

  it('sorts out-of-order (delayed) samples by time', () => {
    const r = summarizeWorkoutHeartRate([s(10, 120), s(0, 100), s(5, 140)])!;
    expect(r.series.map((p) => p.bpm)).toEqual([100, 140, 120]);
    expect(r.firstAt < r.lastAt).toBe(true);
  });

  it('drops implausible, non-finite and badly-timed rows instead of repairing them', () => {
    const r = summarizeWorkoutHeartRate([s(0, 19), s(1, 256), s(2, NaN), { bpm: 130, measuredAt: 'not a date', verified: true }, s(3, 130)])!;
    expect(r.sampleCount).toBe(1);
    expect(r.minBpm).toBe(130);
    expect(summarizeWorkoutHeartRate([s(0, 5), s(1, 300)])).toBeNull();
  });

  it('keeps boundary values 20 and 255', () => {
    const r = summarizeWorkoutHeartRate([s(0, 20), s(1, 255)])!;
    expect([r.minBpm, r.maxBpm]).toEqual([20, 255]);
  });

  it('labels the session match from the database flags: verified / unverified / mixed (null counts as not confirmed)', () => {
    expect(summarizeWorkoutHeartRate([s(0, 100, true), s(5, 101, true)])!.session).toBe('verified');
    expect(summarizeWorkoutHeartRate([s(0, 100, false), s(5, 101, null)])!.session).toBe('unverified');
    expect(summarizeWorkoutHeartRate([s(0, 100, true), s(5, 101, false)])!.session).toBe('mixed');
  });

  it('downsamples a long workout to at most the point cap, keeps true min/max from raw samples, and does not fill gaps', () => {
    const raw: StoredHrSample[] = [];
    for (let i = 0; i < 1000; i++) raw.push(s(i * 5, 120 + (i % 10)));
    raw[500] = s(500 * 5, 200); // a spike the averaged series may smooth, but max must still report it
    const r = summarizeWorkoutHeartRate(raw, false, 50)!;
    expect(r.series.length).toBeLessThanOrEqual(50);
    expect(r.sampleCount).toBe(1000);
    expect(r.maxBpm).toBe(200);
    expect(r.series.every((p) => p.bpm >= 20 && p.bpm <= 255)).toBe(true);

    // A big gap: the empty buckets in the middle produce no points (nothing is interpolated).
    const gap = [...Array.from({ length: 30 }, (_, i) => s(i, 120)), ...Array.from({ length: 30 }, (_, i) => s(10_000 + i, 130))];
    const g = summarizeWorkoutHeartRate(gap, false, 10)!;
    expect(g.series.length).toBeLessThan(10);
    expect(g.series.every((p) => p.bpm === 120 || p.bpm === 130)).toBe(true);
  });

  it('passes the truncated flag through', () => {
    expect(summarizeWorkoutHeartRate([s(0, 100)], true)!.truncated).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [s(10, 120), s(0, 100)];
    const copy = JSON.stringify(input);
    summarizeWorkoutHeartRate(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('isWorkoutHrSummary', () => {
  const good = summarizeWorkoutHeartRate([s(0, 100), s(5, 110)])!;
  it('accepts a real summary and rejects malformed shapes', () => {
    expect(isWorkoutHrSummary(good)).toBe(true);
    expect(isWorkoutHrSummary(null)).toBe(false);
    expect(isWorkoutHrSummary({ ...good, session: 'maybe' })).toBe(false);
    expect(isWorkoutHrSummary({ ...good, minBpm: '100' })).toBe(false);
    expect(isWorkoutHrSummary({ ...good, series: [{ t: 'x', bpm: 'y' }] })).toBe(false);
    expect(isWorkoutHrSummary({ ...good, truncated: undefined })).toBe(false);
  });
});
