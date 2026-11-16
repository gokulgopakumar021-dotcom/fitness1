import { apiFetch } from '../lib/apiFetch';
import { isWorkoutHrSummary, type WorkoutHrSummary } from './workoutHrSummary';

/**
 * Reads the account's stored heart rate for one workout (read-only). `none` is a normal answer: no wearable data was stored.
 * `unavailable` covers the database being unreachable and the proposed migration not being applied yet; the UI says so plainly
 * and never shows a number it did not receive.
 */
export type WorkoutHrResult =
  | { kind: 'ok'; summary: WorkoutHrSummary }
  | { kind: 'none' }
  | { kind: 'unauthenticated' | 'rate_limited' | 'unavailable' | 'failed' };

export async function fetchWorkoutHeartRate(sessionId: string, signal?: AbortSignal): Promise<WorkoutHrResult> {
  let res: Response;
  try {
    res = await apiFetch('/api/wearables/workout-heart-rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }), signal });
  } catch {
    return { kind: 'unavailable' };
  }
  if (res.status === 401) return { kind: 'unauthenticated' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 503) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed' };
  try {
    const j = (await res.json()) as { success?: boolean; summary?: unknown };
    if (j.success !== true) return { kind: 'failed' };
    if (j.summary === null) return { kind: 'none' };
    if (isWorkoutHrSummary(j.summary)) return { kind: 'ok', summary: j.summary };
  } catch { /* fall through */ }
  return { kind: 'failed' };
}
