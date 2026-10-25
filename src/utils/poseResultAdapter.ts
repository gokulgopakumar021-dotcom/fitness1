import type { LandmarkPoint } from '../types/bodyScan';

/**
 * Boundary between MediaPipe's native Pose Landmarker result and the app's own
 * landmark representation (`LandmarkPoint[]`, MediaPipe 33-point ordering).
 *
 * Pure module: no MediaPipe import, no browser APIs, no React. The input is
 * typed `unknown` on purpose: it comes from a WASM runtime, so nothing about its
 * shape is trusted. Anything unexpected is reported as `malformed` instead of
 * being passed on.
 *
 * What is kept per landmark: normalised x / y, z (relative depth, NOT metric),
 * and `visibility`. Coordinates are NOT clamped: a joint outside the frame can
 * legitimately be reported below 0 or above 1, and the quality checks rely on
 * that to notice cut-off limbs. MediaPipe's separate `presence` score and the
 * world-space landmarks are not part of the app's `LandmarkPoint` contract and
 * are dropped.
 *
 * The output is a fresh copy of plain objects, so it stays valid after the
 * native result is closed.
 */

/** MediaPipe Pose reports 33 landmarks per detected pose. */
export const POSE_LANDMARK_COUNT = 33;

export type PoseAdaptFailure = 'no_pose' | 'malformed';

export type PoseAdaptResult =
  | { ok: true; landmarks: LandmarkPoint[] }
  | { ok: false; reason: PoseAdaptFailure };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Converts a native Pose Landmarker result into app landmarks.
 *
 * - `no_pose`: the model ran and found nobody (empty pose list or empty pose).
 * - `malformed`: the result is not shaped like a Pose Landmarker result, does
 *   not contain exactly 33 landmarks, or a landmark has missing / non-finite
 *   coordinates. Nothing partial is returned in that case.
 *
 * The runtime is configured for one pose, so only the first pose is read.
 */
export function adaptPoseLandmarkerResult(result: unknown): PoseAdaptResult {
  if (result === null || typeof result !== 'object') return { ok: false, reason: 'malformed' };
  const poses = (result as { landmarks?: unknown }).landmarks;
  if (!Array.isArray(poses)) return { ok: false, reason: 'malformed' };
  if (poses.length === 0) return { ok: false, reason: 'no_pose' };

  const first: unknown = poses[0];
  if (!Array.isArray(first)) return { ok: false, reason: 'malformed' };
  if (first.length === 0) return { ok: false, reason: 'no_pose' };
  if (first.length !== POSE_LANDMARK_COUNT) return { ok: false, reason: 'malformed' };

  const landmarks: LandmarkPoint[] = [];
  for (const entry of first as unknown[]) {
    if (entry === null || typeof entry !== 'object') return { ok: false, reason: 'malformed' };
    const { x, y, z, visibility } = entry as Record<string, unknown>;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false, reason: 'malformed' };
    const point: LandmarkPoint = { x, y };
    if (isFiniteNumber(z)) point.z = z;
    // A missing or non-numeric visibility is left out (not invented): the landmark reader then reports it as unknown.
    if (isFiniteNumber(visibility)) point.visibility = visibility;
    landmarks.push(point);
  }
  return { ok: true, landmarks };
}
