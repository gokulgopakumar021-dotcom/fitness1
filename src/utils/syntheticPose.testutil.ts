import type { LandmarkPoint } from '../types/bodyScan';
import { POSE_LANDMARK, type PoseLandmarkName } from './poseLandmarks';

/**
 * Deterministic SYNTHETIC landmarks for unit tests only.
 * These are hand-placed numbers, not output from a camera or a pose model.
 */
type Overrides = Partial<Record<PoseLandmarkName, Partial<LandmarkPoint>>>;

const FRONT_BASE: Record<PoseLandmarkName, LandmarkPoint> = {
  nose: { x: 0.5, y: 0.1 },
  leftShoulder: { x: 0.6, y: 0.25 },
  rightShoulder: { x: 0.4, y: 0.25 },
  leftHip: { x: 0.57, y: 0.55 },
  rightHip: { x: 0.43, y: 0.55 },
  leftKnee: { x: 0.57, y: 0.75 },
  rightKnee: { x: 0.43, y: 0.75 },
  leftAnkle: { x: 0.57, y: 0.9 },
  rightAnkle: { x: 0.43, y: 0.9 },
};

function build(base: Record<PoseLandmarkName, LandmarkPoint>, overrides: Overrides, visibility: number): LandmarkPoint[] {
  // 33 entries (MediaPipe Pose layout); unused indices are harmless filler.
  const list: LandmarkPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility }));
  (Object.keys(base) as PoseLandmarkName[]).forEach((name) => {
    list[POSE_LANDMARK[name]] = { ...base[name], visibility, ...(overrides[name] ?? {}) };
  });
  return list;
}

/**
 * Front pose, aspect-ratio-independent geometry (all values in a unit square):
 * shoulder width 0.20, hip width 0.14, torso 0.30, nose-to-ankle 0.80, no tilt.
 */
export function makeFrontPose(overrides: Overrides = {}, visibility = 0.99): LandmarkPoint[] {
  return build(FRONT_BASE, overrides, visibility);
}

/** Side pose: left chain clearly visible, right chain low visibility (0.2). Torso 0.30, nose-to-ankle 0.80, no lean. */
export function makeSidePose(overrides: Overrides = {}, visibility = 0.99): LandmarkPoint[] {
  const base: Record<PoseLandmarkName, LandmarkPoint> = {
    nose: { x: 0.5, y: 0.1 },
    leftShoulder: { x: 0.5, y: 0.25 },
    rightShoulder: { x: 0.5, y: 0.25 },
    leftHip: { x: 0.5, y: 0.55 },
    rightHip: { x: 0.5, y: 0.55 },
    leftKnee: { x: 0.5, y: 0.75 },
    rightKnee: { x: 0.5, y: 0.75 },
    leftAnkle: { x: 0.5, y: 0.9 },
    rightAnkle: { x: 0.5, y: 0.9 },
  };
  const list = build(base, overrides, visibility);
  (['rightShoulder', 'rightHip', 'rightKnee', 'rightAnkle'] as PoseLandmarkName[]).forEach((n) => {
    if (!overrides[n] || overrides[n]?.visibility === undefined) list[POSE_LANDMARK[n]] = { ...list[POSE_LANDMARK[n]], visibility: 0.2 };
  });
  return list;
}
