import { getExerciseIndex } from './exerciseIndex';
import { prepareIndex, resolveExerciseKey, type PreparedIndex } from '../utils/videoLibrary/matcher';

/**
 * Resolves an in-workout exercise name to the catalog exercise key used by public.exercise_videos.
 *
 * This reuses the Stage 2 runtime lookup unchanged: an exact key, name or alias match against the derived
 * exercise index, with equipment-conflict and tie protection. A fuzzy, ambiguous or unknown name returns null,
 * so a custom or look-alike exercise never shows another exercise's video. It deliberately does NOT use
 * getBiomechanicsForExercise(), which falls back to the squat for unknown names.
 */
let prepared: PreparedIndex | null = null;

export function resolveVideoExerciseKey(exerciseName: string): string | null {
  if (!exerciseName || !exerciseName.trim()) return null;
  prepared ??= prepareIndex(getExerciseIndex());
  return resolveExerciseKey(exerciseName, prepared);
}
