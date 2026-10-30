import {
  MirrorPoint,
  POSE_LANDMARKS,
  BodyVisibilityStatus,
  CameraDistanceStatus,
} from '../../types/workoutMirror';

/**
 * Calculates the 2D angle (in degrees) at vertex B formed by segments BA and BC.
 * Returns a value in [0, 180].
 */
export function calculateAngle(
  a: MirrorPoint,
  b: MirrorPoint,
  c: MirrorPoint
): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

  if (mag1 === 0 || mag2 === 0) return 180;

  let cosTheta = dot / (mag1 * mag2);
  // Guard against precision floating point drift
  if (cosTheta > 1) cosTheta = 1;
  else if (cosTheta < -1) cosTheta = -1;

  const rad = Math.acos(cosTheta);
  return (rad * 180) / Math.PI;
}

/**
 * Calculates 3D angle when relative z depth is present.
 */
export function calculate3DAngle(
  a: MirrorPoint,
  b: MirrorPoint,
  c: MirrorPoint
): number {
  const az = a.z ?? 0;
  const bz = b.z ?? 0;
  const cz = c.z ?? 0;

  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = az - bz;

  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = cz - bz;

  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

  if (mag1 === 0 || mag2 === 0) return 180;

  let cosTheta = dot / (mag1 * mag2);
  if (cosTheta > 1) cosTheta = 1;
  else if (cosTheta < -1) cosTheta = -1;

  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Returns tilt in degrees of segment a -> b relative to the vertical plumb line.
 * 0° = perfectly vertical, 90° = horizontal.
 */
export function calculateVerticalAngle(a: MirrorPoint, b: MirrorPoint): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dy === 0) return 90;
  const rad = Math.atan2(dx, dy);
  return (rad * 180) / Math.PI;
}

/**
 * Returns tilt in degrees of segment a -> b relative to the horizontal line.
 * 0° = perfectly horizontal, 90° = vertical.
 */
export function calculateHorizontalAngle(a: MirrorPoint, b: MirrorPoint): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0) return 90;
  const rad = Math.atan2(dy, dx);
  return (rad * 180) / Math.PI;
}

/**
 * Euclidean distance in 2D normalised image coordinates.
 */
export function calculateDistance2D(a: MirrorPoint, b: MirrorPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Midpoint between two landmarks.
 */
export function calculateMidpoint(a: MirrorPoint, b: MirrorPoint): MirrorPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: a.z !== undefined && b.z !== undefined ? (a.z + b.z) / 2 : undefined,
    visibility:
      a.visibility !== undefined && b.visibility !== undefined
        ? Math.min(a.visibility, b.visibility)
        : undefined,
  };
}

/**
 * Exponential Moving Average filter for landmark coordinates.
 * Filters high-frequency camera sensor noise while maintaining immediate response to true movements.
 */
export class LandmarkSmoothingFilter {
  private smoothedLandmarks: MirrorPoint[] = [];
  private alpha: number;

  constructor(alpha: number = 0.65) {
    this.alpha = alpha;
  }

  filter(rawLandmarks: MirrorPoint[]): MirrorPoint[] {
    if (this.smoothedLandmarks.length !== rawLandmarks.length) {
      this.smoothedLandmarks = rawLandmarks.map((pt) => ({ ...pt }));
      return this.smoothedLandmarks;
    }

    const next: MirrorPoint[] = [];
    for (let i = 0; i < rawLandmarks.length; i++) {
      const raw = rawLandmarks[i];
      const prev = this.smoothedLandmarks[i];

      const x = this.alpha * raw.x + (1 - this.alpha) * prev.x;
      const y = this.alpha * raw.y + (1 - this.alpha) * prev.y;
      const z =
        raw.z !== undefined && prev.z !== undefined
          ? this.alpha * raw.z + (1 - this.alpha) * prev.z
          : raw.z;

      next.push({
        x,
        y,
        z,
        visibility: raw.visibility,
      });
    }

    this.smoothedLandmarks = next;
    return next;
  }

  reset(): void {
    this.smoothedLandmarks = [];
  }
}

/**
 * Evaluates camera distance and whether the user's full body or required segments are in frame.
 */
export function evaluateBodyVisibility(
  landmarks: MirrorPoint[] | null | undefined,
  minConfidence: number = 0.5
): BodyVisibilityStatus {
  if (!landmarks || landmarks.length < 33) {
    return {
      isFullyVisible: false,
      isHeadVisible: false,
      isTorsoVisible: false,
      areHipsVisible: false,
      areKneesVisible: false,
      areFeetVisible: false,
      distanceStatus: 'not_detected',
      advice: 'No person detected. Step in front of the camera.',
      missingLandmarks: ['All body landmarks'],
      averageConfidence: 0,
    };
  }

  const isVisible = (idx: number) => {
    const pt = landmarks[idx];
    if (!pt) return false;
    const conf = pt.visibility ?? 1;
    // Also check coordinate bounds within screen
    const inBounds = pt.x >= 0.02 && pt.x <= 0.98 && pt.y >= 0.02 && pt.y <= 0.98;
    return conf >= minConfidence && inBounds;
  };

  const isHeadVisible =
    isVisible(POSE_LANDMARKS.NOSE) ||
    (isVisible(POSE_LANDMARKS.LEFT_EAR) && isVisible(POSE_LANDMARKS.RIGHT_EAR));

  const isTorsoVisible =
    (isVisible(POSE_LANDMARKS.LEFT_SHOULDER) || isVisible(POSE_LANDMARKS.RIGHT_SHOULDER)) &&
    (isVisible(POSE_LANDMARKS.LEFT_HIP) || isVisible(POSE_LANDMARKS.RIGHT_HIP));

  const areHipsVisible =
    isVisible(POSE_LANDMARKS.LEFT_HIP) || isVisible(POSE_LANDMARKS.RIGHT_HIP);

  const areKneesVisible =
    isVisible(POSE_LANDMARKS.LEFT_KNEE) || isVisible(POSE_LANDMARKS.RIGHT_KNEE);

  const areFeetVisible =
    isVisible(POSE_LANDMARKS.LEFT_ANKLE) ||
    isVisible(POSE_LANDMARKS.RIGHT_ANKLE) ||
    isVisible(POSE_LANDMARKS.LEFT_FOOT_INDEX) ||
    isVisible(POSE_LANDMARKS.RIGHT_FOOT_INDEX);

  const missingLandmarks: string[] = [];
  if (!isHeadVisible) missingLandmarks.push('Head');
  if (!isTorsoVisible) missingLandmarks.push('Upper Body');
  if (!areHipsVisible) missingLandmarks.push('Hips');
  if (!areKneesVisible) missingLandmarks.push('Knees');
  if (!areFeetVisible) missingLandmarks.push('Feet');

  // Compute bounding box height in frame to assess distance
  const validYs = landmarks
    .filter((pt) => (pt.visibility ?? 1) >= minConfidence)
    .map((pt) => pt.y);

  let distanceStatus: CameraDistanceStatus = 'optimal';
  let advice = 'Good framing. Ready to exercise!';

  if (validYs.length >= 8) {
    const minY = Math.min(...validYs);
    const maxY = Math.max(...validYs);
    const bodyHeightFraction = maxY - minY;

    if (bodyHeightFraction > 0.94 || !areFeetVisible || !isHeadVisible) {
      distanceStatus = 'too_close';
      advice = 'Step back slightly so your entire body from head to feet is visible.';
    } else if (bodyHeightFraction < 0.35) {
      distanceStatus = 'too_far';
      advice = 'Step a little closer to the camera for clearer tracking.';
    }
  } else {
    distanceStatus = 'not_detected';
    advice = 'Position yourself in front of the camera.';
  }

  const isFullyVisible =
    isHeadVisible && isTorsoVisible && areHipsVisible && areKneesVisible && areFeetVisible;

  // Average confidence across key landmarks
  const keyIndices = [
    POSE_LANDMARKS.NOSE,
    POSE_LANDMARKS.LEFT_SHOULDER,
    POSE_LANDMARKS.RIGHT_SHOULDER,
    POSE_LANDMARKS.LEFT_HIP,
    POSE_LANDMARKS.RIGHT_HIP,
    POSE_LANDMARKS.LEFT_KNEE,
    POSE_LANDMARKS.RIGHT_KNEE,
    POSE_LANDMARKS.LEFT_ANKLE,
    POSE_LANDMARKS.RIGHT_ANKLE,
  ];

  const totalConf = keyIndices.reduce<number>(
    (acc, idx) => acc + (landmarks[idx]?.visibility ?? 0.8),
    0
  );
  const averageConfidence = totalConf / keyIndices.length;

  return {
    isFullyVisible,
    isHeadVisible,
    isTorsoVisible,
    areHipsVisible,
    areKneesVisible,
    areFeetVisible,
    distanceStatus,
    advice,
    missingLandmarks,
    averageConfidence,
  };
}
