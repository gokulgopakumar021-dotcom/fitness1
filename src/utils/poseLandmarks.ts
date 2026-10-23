import type { LandmarkPoint } from '../types/bodyScan';

/**
 * Landmark index convention for Body Scan utilities.
 *
 * `BodyScanRecord` stores `LandmarkPoint[]` "as produced by the pose model".
 * These utilities assume the MediaPipe Pose 33-landmark ordering, where the
 * array index identifies the body part. Only the subset needed by the 2D
 * metrics and capture-quality checks is listed here.
 *
 * "Left"/"right" are the model's anatomical labels (the person's own left and
 * right). In a mirrored selfie preview these appear swapped on screen, so
 * nothing in the utilities depends on which side of the image a label sits.
 *
 * Pure module: no browser APIs, no React.
 */
export const POSE_LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type PoseLandmarkName = keyof typeof POSE_LANDMARK;

export const POSE_LANDMARK_LABEL: Record<PoseLandmarkName, string> = {
  nose: 'Head (nose)',
  leftShoulder: 'Left shoulder',
  rightShoulder: 'Right shoulder',
  leftHip: 'Left hip',
  rightHip: 'Right hip',
  leftKnee: 'Left knee',
  rightKnee: 'Right knee',
  leftAnkle: 'Left ankle',
  rightAnkle: 'Right ankle',
};

/** Anything a caller might hand us; every utility tolerates all of these. */
export type LandmarkList = readonly (LandmarkPoint | null | undefined)[] | null | undefined;

export type LandmarkReadStatus =
  | 'ok' //                  finite x/y and visibility >= the minimum
  | 'low_visibility' //      finite x/y, visibility below the minimum
  | 'visibility_unknown' //  finite x/y, but visibility missing, non-finite or outside 0..1
  | 'non_finite' //          x or y is NaN/Infinity/not a number
  | 'missing'; //            no entry at this index

export interface LandmarkRead {
  status: LandmarkReadStatus;
  /** Present for ok, low_visibility and visibility_unknown (coordinates are finite). */
  point?: LandmarkPoint;
  /** Present only when the reported visibility is a valid number in 0..1. */
  visibility?: number;
}

/**
 * Reads one named landmark without ever throwing.
 *
 * A landmark with no usable `visibility` is NOT treated as visible: the pose
 * model always reports it, so its absence means we cannot vouch for the point.
 */
export function readLandmark(
  landmarks: LandmarkList,
  name: PoseLandmarkName,
  minVisibility: number
): LandmarkRead {
  if (!landmarks || !Array.isArray(landmarks)) return { status: 'missing' };
  const p = (landmarks as readonly unknown[])[POSE_LANDMARK[name]] as LandmarkPoint | null | undefined;
  if (p === null || p === undefined || typeof p !== 'object') return { status: 'missing' };
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    return { status: 'non_finite' };
  }
  const v = p.visibility;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    return { status: 'visibility_unknown', point: p };
  }
  if (v < minVisibility) return { status: 'low_visibility', point: p, visibility: v };
  return { status: 'ok', point: p, visibility: v };
}

/** Width / height of the image the landmarks were normalised against. */
export function isValidAspectRatio(aspectRatio: unknown): aspectRatio is number {
  return typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio >= 0.1 && aspectRatio <= 10;
}
