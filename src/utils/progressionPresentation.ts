import type { ExerciseHistorySummary } from './progressionEngine';

/**
 * Presentation helpers for the Progression screen.
 * Pure functions over the output of `extractExerciseHistory`. They never recompute
 * volume, 1RM or top weight: they only filter, compare and list values the engine already produced.
 */

export type HistorySession = ExerciseHistorySummary['sessions'][number];
export type TimeRange = '30d' | '90d' | 'all';

/** Same rule the screen always used: keep sessions whose age in days is within the range. */
export function filterSessionsByRange(
  sessions: HistorySession[],
  range: TimeRange,
  now: Date = new Date()
): HistorySession[] {
  return sessions.filter((s) => {
    if (range === 'all') return true;
    const diffDays = (now.getTime() - new Date(s.date).getTime()) / (1000 * 3600 * 24);
    if (range === '30d') return diffDays <= 30;
    if (range === '90d') return diffDays <= 90;
    return true;
  });
}

export function totalWorkingReps(session: HistorySession): number {
  return session.workingSets.reduce((acc, curr) => acc + curr.reps, 0);
}

export interface SessionComparison {
  topWeight: number;
  totalVolume: number;
  estimated1RM: number;
  totalReps: number;
}

/** latest minus previous, per metric. Positive = higher than last time. */
export function compareSessions(latest: HistorySession, previous: HistorySession): SessionComparison {
  return {
    topWeight: latest.topWeight - previous.topWeight,
    totalVolume: latest.totalVolume - previous.totalVolume,
    estimated1RM: latest.estimated1RM - previous.estimated1RM,
    totalReps: totalWorkingReps(latest) - totalWorkingReps(previous)
  };
}

export interface WeightPrEntry {
  date: string;
  weight: number;
  /** Heaviest top weight logged before this session (0 for the first logged session). */
  previousBest: number;
}

/**
 * Sessions where the top working weight strictly beat every earlier session.
 * Sessions are expected in chronological order (as `extractExerciseHistory` returns them).
 */
export function weightPrHistory(sessions: HistorySession[]): WeightPrEntry[] {
  const out: WeightPrEntry[] = [];
  let best = 0;
  for (const s of sessions) {
    if (s.topWeight > best) {
      out.push({ date: s.date, weight: s.topWeight, previousBest: best });
      best = s.topWeight;
    }
  }
  return out;
}

/** Rounds away float noise from subtractions such as 62.5 - 60 or 0.1 + 0.2. */
export function formatDelta(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString()}`;
}
