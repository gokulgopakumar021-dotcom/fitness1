import { describe, it, expect } from 'vitest';
import {
  filterSessionsByRange,
  compareSessions,
  weightPrHistory,
  formatDelta,
  totalWorkingReps,
  HistorySession
} from './progressionPresentation';

const mk = (date: string, topWeight: number, reps: number[], totalVolume = 0, estimated1RM = 0): HistorySession => ({
  sessionId: date,
  date,
  workingSets: reps.map((r, i) => ({
    id: `${date}-${i}`,
    setNumber: i + 1,
    type: 'working',
    weight: topWeight,
    reps: r,
    completed: true,
    timestamp: date
  })),
  warmupSets: [],
  totalVolume,
  topWeight,
  estimated1RM
});

const NOW = new Date('2026-10-29T12:00:00Z');

describe('filterSessionsByRange', () => {
  const sessions = [mk('2026-10-20', 60, [8]), mk('2026-09-15', 60, [8]), mk('2026-06-01', 60, [8])];
  it('all keeps everything', () => {
    expect(filterSessionsByRange(sessions, 'all', NOW)).toHaveLength(3);
  });
  it('30d keeps only the last 30 days', () => {
    expect(filterSessionsByRange(sessions, '30d', NOW).map((s) => s.date)).toEqual(['2026-10-20']);
  });
  it('90d keeps the last 90 days', () => {
    expect(filterSessionsByRange(sessions, '90d', NOW).map((s) => s.date)).toEqual(['2026-10-20', '2026-09-15']);
  });
  it('does not mutate its input', () => {
    const copy = [...sessions];
    filterSessionsByRange(sessions, '30d', NOW);
    expect(sessions).toEqual(copy);
  });
});

describe('compareSessions', () => {
  it('returns latest minus previous', () => {
    const prev = mk('2026-10-01', 60, [8, 8, 8], 1440, 76);
    const last = mk('2026-10-08', 62.5, [8, 8, 6], 1375, 79);
    const d = compareSessions(last, prev);
    expect(d.topWeight).toBe(2.5);
    expect(d.totalVolume).toBe(-65);
    expect(d.estimated1RM).toBe(3);
    expect(d.totalReps).toBe(-2);
  });
});

describe('weightPrHistory', () => {
  it('lists only sessions that strictly beat the running best', () => {
    const list = weightPrHistory([
      mk('2026-01-01', 60, [8]),
      mk('2026-01-08', 60, [9]),
      mk('2026-01-15', 62.5, [8]),
      mk('2026-01-22', 57.5, [10]),
      mk('2026-01-29', 65, [6])
    ]);
    expect(list).toEqual([
      { date: '2026-01-01', weight: 60, previousBest: 0 },
      { date: '2026-01-15', weight: 62.5, previousBest: 60 },
      { date: '2026-01-29', weight: 65, previousBest: 62.5 }
    ]);
  });
  it('is empty with no sessions or only zero-weight sessions', () => {
    expect(weightPrHistory([])).toEqual([]);
    expect(weightPrHistory([mk('2026-01-01', 0, [12])])).toEqual([]);
  });
});

describe('formatDelta / totalWorkingReps', () => {
  it('signs values and strips float noise', () => {
    expect(formatDelta(2.5)).toBe('+2.5');
    expect(formatDelta(-2.5)).toBe('−2.5');
    expect(formatDelta(0.1 + 0.2)).toBe('+0.3');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(0.0001)).toBe('0');
  });
  it('sums working-set reps', () => {
    expect(totalWorkingReps(mk('2026-01-01', 50, [8, 8, 7]))).toBe(23);
  });
});
