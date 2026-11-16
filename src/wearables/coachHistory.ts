/**
 * BT-04C task 5 — the stored heart-rate summary Coach Iron may receive when (and only when) the account has granted
 * `historical_heart_rate` at the current consent version. Pure: no browser, no I/O. Built on the SERVER from the account's own stored
 * samples; the client never supplies history. Everything that reaches the prompt is a number or a date this module formats itself:
 * no device name, session id, provider text or other stored string can enter it.
 */
export const COACH_HISTORY_WINDOW_DAYS = 30;
/** Most recent workouts summarised. Few on purpose: a summary, not a data dump. */
export const COACH_HISTORY_MAX_SESSIONS = 5;
/** A workout with fewer stored readings than this is too thin to summarise, so it is left out. */
export const COACH_HISTORY_MIN_READINGS = 10;
/** A label spanning longer than this is not one workout (reused or bad label): it is left out, never guessed at. */
export const COACH_HISTORY_MAX_SESSION_MS = 6 * 60 * 60_000;

export interface HistorySample { sessionId: string; bpm: number; measuredAt: string }
export interface CoachHrSession { date: string; minutes: number; minBpm: number; avgBpm: number; maxBpm: number; readings: number }
export interface CoachHrHistory {
  windowDays: number;
  sessions: CoachHrSession[];
  /** True when the read hit its row cap: the oldest workout in the window is dropped (it may be incomplete) and the text says so. */
  partial: boolean;
}

const plausible = (n: number) => Number.isFinite(n) && n >= 20 && n <= 255;

export function buildCoachHrHistory(samples: readonly HistorySample[], now: Date, truncated: boolean): CoachHrHistory {
  const end = now.getTime();
  const start = end - COACH_HISTORY_WINDOW_DAYS * 86_400_000;
  const groups = new Map<string, { t: number[]; b: number[] }>();
  for (const s of samples) {
    const t = Date.parse(s.measuredAt);
    // Out-of-window, future-dated and implausible readings are skipped, never repaired.
    if (!Number.isFinite(t) || t < start || t > end || !plausible(s.bpm) || typeof s.sessionId !== 'string' || !s.sessionId) continue;
    const g = groups.get(s.sessionId) ?? { t: [], b: [] };
    g.t.push(t); g.b.push(s.bpm);
    groups.set(s.sessionId, g);
  }
  let sessions = [...groups.values()].map((g) => {
    const first = Math.min(...g.t); const last = Math.max(...g.t);
    return { first, last, g };
  }).sort((a, b) => b.last - a.last);
  // A capped read lists newest readings first, so the oldest workout is the one that may be cut off.
  if (truncated && sessions.length) sessions = sessions.slice(0, -1);
  const out: CoachHrSession[] = [];
  for (const { first, last, g } of sessions) {
    if (g.b.length < COACH_HISTORY_MIN_READINGS || last - first > COACH_HISTORY_MAX_SESSION_MS) continue;
    out.push({
      date: new Date(first).toISOString().slice(0, 10),
      minutes: Math.max(1, Math.round((last - first) / 60_000)),
      minBpm: Math.round(Math.min(...g.b)), maxBpm: Math.round(Math.max(...g.b)),
      avgBpm: Math.round(g.b.reduce((a, c) => a + c, 0) / g.b.length), readings: g.b.length
    });
    if (out.length === COACH_HISTORY_MAX_SESSIONS) break;
  }
  return { windowDays: COACH_HISTORY_WINDOW_DAYS, sessions: out, partial: truncated };
}

/** The prompt text. Digits, dates and fixed words only. */
export function formatCoachHrHistory(h: CoachHrHistory): string {
  const head = `- Stored heart-rate history (read-only data from the athlete's own wearable, last ${h.windowDays} days; informational, not a medical measurement, never a diagnosis):`;
  if (!h.sessions.length) return `${head} no usable workout heart rate is stored.`;
  const lines = h.sessions.map((s) => `  - ${s.date}: ${s.minutes} min, average ${s.avgBpm} bpm (lowest ${s.minBpm}, highest ${s.maxBpm}), ${s.readings} readings`);
  return [`${head} ${h.sessions.length} recent workout${h.sessions.length === 1 ? '' : 's'}, newest first.`, ...lines, ...(h.partial ? ['  - Older workouts in this window were not loaded.'] : [])].join('\n');
}
