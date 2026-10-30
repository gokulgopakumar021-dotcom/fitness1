import { WorkoutMirrorSession, WorkoutMirrorExerciseId } from '../../types/workoutMirror';

const STORAGE_KEY = 'ironlog_mirror_sessions_v1';

export function getMirrorSessions(): WorkoutMirrorSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMirrorSession(session: WorkoutMirrorSession): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getMirrorSessions();
    const updated = [session, ...existing.filter((s) => s.id !== session.id)].slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // quota exceeded or private mode
  }
}

export function getMirrorSessionsForExercise(
  exerciseId: WorkoutMirrorExerciseId
): WorkoutMirrorSession[] {
  return getMirrorSessions().filter((s) => s.exerciseId === exerciseId);
}

export interface FormInsight {
  exerciseId: WorkoutMirrorExerciseId;
  exerciseName: string;
  sessionCount: number;
  averageConsistency: number;
  totalReps: number;
  topCorrection?: string;
  lastSessionDate: string;
}

export function getFormInsights(): FormInsight[] {
  const sessions = getMirrorSessions();
  const byExercise = new Map<WorkoutMirrorExerciseId, WorkoutMirrorSession[]>();

  for (const s of sessions) {
    const list = byExercise.get(s.exerciseId) ?? [];
    list.push(s);
    byExercise.set(s.exerciseId, list);
  }

  const results: FormInsight[] = [];

  for (const [exerciseId, list] of byExercise.entries()) {
    const totalScore = list.reduce((acc, s) => acc + s.overallConsistencyScore, 0);
    const avgScore = Math.round(totalScore / list.length);

    let totalReps = 0;
    const correctionCounts: Record<string, number> = {};

    for (const s of list) {
      for (const set of s.sets) {
        totalReps += set.userAdjustedReps || set.detectedReps;
        for (const [msg, count] of Object.entries(set.observationsSummary || {})) {
          correctionCounts[msg] = (correctionCounts[msg] ?? 0) + count;
        }
      }
    }

    let topCorrection: string | undefined;
    let highestCount = 0;
    for (const [msg, count] of Object.entries(correctionCounts)) {
      if (count > highestCount) {
        highestCount = count;
        topCorrection = msg;
      }
    }

    results.push({
      exerciseId,
      exerciseName: list[0].exerciseName,
      sessionCount: list.length,
      averageConsistency: avgScore,
      totalReps,
      topCorrection,
      lastSessionDate: list[0].startedAt,
    });
  }

  return results;
}
