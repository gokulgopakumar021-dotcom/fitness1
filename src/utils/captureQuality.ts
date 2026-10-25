/**
 * Capture-quality checks for Body Scan photos.
 *
 * WHAT THIS IS
 * Pure functions that turn numbers supplied by a future camera/capture layer
 * into pass / warning / fail feedback. No browser APIs, no React, no I/O.
 *
 * WHAT THIS IS NOT
 * - It performs NO image analysis. Brightness, sharpness and motion must be
 *   computed by the caller from real frames and passed in. If they are not
 *   supplied (or are invalid) the matching check is reported as
 *   `not_evaluated`; it is never guessed and never counted as a pass.
 * - Landmark checks are only as good as the pose model's own `visibility`
 *   scores. A passing result means "no problems found among the checks that
 *   could be run", not that the photo is suitable for any particular purpose.
 * - All default thresholds are heuristics chosen for sensible UX. They have
 *   NOT been calibrated against real devices or real users and should be tuned
 *   once the capture layer exists. Everything is overridable via
 *   `CaptureQualityConfig`.
 *
 * Coordinates: normalised 0..1 image space (see `LandmarkPoint`), y grows
 * downward. Fractions below are fractions of the frame width/height.
 */

import type { CaptureQualityReport, ScanView } from '../types/bodyScan';
import {
  type LandmarkList,
  type LandmarkRead,
  type PoseLandmarkName,
  POSE_LANDMARK_LABEL,
  isValidAspectRatio,
  readLandmark,
} from './poseLandmarks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityCheckId =
  | 'landmarks_visible'
  | 'in_frame'
  | 'centered'
  | 'body_height_fraction'
  | 'brightness'
  | 'sharpness'
  | 'stillness';

export type QualityCheckStatus = 'pass' | 'warning' | 'fail' | 'not_evaluated';
export type OverallQualityStatus = 'pass' | 'warning' | 'fail';

export interface QualityCheck {
  id: QualityCheckId;
  status: QualityCheckStatus;
  /** The number the decision was based on, when there is one. */
  value?: number;
  /** What was found. */
  message: string;
  /** What the user can do about it. Absent for pass / not_evaluated. */
  advice?: string;
}

export interface CaptureQualityAssessment {
  /** Worst status among the checks that WERE evaluated. */
  status: OverallQualityStatus;
  checks: QualityCheck[];
  /** De-duplicated advice for every warning/fail, failures first. */
  feedback: string[];
  notEvaluated: QualityCheckId[];
  /**
   * False when any check could not be evaluated (e.g. no sharpness value was
   * supplied). A `pass` with `complete: false` is a partial result.
   */
  complete: boolean;
}

export interface CaptureQualityInput {
  view: ScanView;
  /** Pose landmarks for this frame (MediaPipe 33-point ordering). */
  landmarks?: LandmarkList;
  /**
   * Mean luminance of the frame, 0 (black) .. 1 (white). Computed by the
   * caller; for example the mean of a downscaled greyscale copy divided by 255.
   */
  brightness?: number | null;
  /**
   * Sharpness score where HIGHER = SHARPER, computed by the caller. The default
   * thresholds assume variance of the Laplacian of an 8-bit greyscale frame
   * downscaled to roughly 640 px on its long side. Different metrics or sizes
   * need different thresholds (pass them in the config).
   */
  sharpness?: number | null;
  /**
   * Landmark movement over a short window, in fractions of image height; see
   * `measureLandmarkMotion`. 0 = perfectly still. Measures pose stability, not
   * camera shake in isolation.
   */
  motion?: number | null;
}

export interface CaptureQualityConfig {
  /** Landmark visibility below this = not usable (fail). */
  minLandmarkVisibility: number;
  /** Visibility from min up to this = usable but borderline (warning). */
  goodLandmarkVisibility: number;
  /** Landmarks closer than this to a frame edge count as cut off. */
  frameMargin: number;
  /** Horizontal offset of the body centre from the frame centre: warning above. */
  centerOffsetWarn: number;
  /** ...and fail above. */
  centerOffsetFail: number;
  /**
   * Vertical span from nose to the lowest visible ankle, as a fraction of frame
   * height. Note this span is roughly 85-90% of standing height (it excludes
   * the top of the head and the floor), so these bounds are on that landmark
   * span, not on full body height.
   */
  heightFractionHardMin: number; // below = fail (too far away)
  heightFractionMin: number; //     below = warning
  heightFractionMax: number; //     above = warning
  heightFractionHardMax: number; // above = fail (too close)
  brightnessFailLow: number;
  brightnessWarnLow: number;
  brightnessWarnHigh: number;
  brightnessFailHigh: number;
  sharpnessFailBelow: number;
  sharpnessWarnBelow: number;
  motionWarnAbove: number;
  motionFailAbove: number;
}

export const DEFAULT_CAPTURE_QUALITY_CONFIG: CaptureQualityConfig = {
  minLandmarkVisibility: 0.5,
  goodLandmarkVisibility: 0.7,
  frameMargin: 0.01,
  centerOffsetWarn: 0.1,
  centerOffsetFail: 0.25,
  heightFractionHardMin: 0.45,
  heightFractionMin: 0.6,
  heightFractionMax: 0.92,
  heightFractionHardMax: 0.98,
  brightnessFailLow: 0.12,
  brightnessWarnLow: 0.25,
  brightnessWarnHigh: 0.85,
  brightnessFailHigh: 0.95,
  sharpnessFailBelow: 40,
  sharpnessWarnBelow: 100,
  motionWarnAbove: 0.01,
  motionFailAbove: 0.025,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Merges overrides onto the defaults and validates the result.
 * Throws RangeError for non-finite values or inconsistent ordering: config is
 * developer-supplied, and silently "fixing" it would hide a bug.
 */
export function resolveCaptureQualityConfig(
  overrides?: Partial<CaptureQualityConfig>
): CaptureQualityConfig {
  const cfg: CaptureQualityConfig = { ...DEFAULT_CAPTURE_QUALITY_CONFIG };
  if (overrides) {
    for (const key of Object.keys(overrides) as (keyof CaptureQualityConfig)[]) {
      const v = overrides[key];
      if (v !== undefined) cfg[key] = v;
    }
  }
  for (const key of Object.keys(cfg) as (keyof CaptureQualityConfig)[]) {
    if (typeof cfg[key] !== 'number' || !Number.isFinite(cfg[key])) {
      throw new RangeError(`captureQuality config "${key}" must be a finite number`);
    }
  }
  const ordered = (label: string, ...values: number[]) => {
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > values[i]) throw new RangeError(`captureQuality config inconsistent: ${label}`);
    }
  };
  ordered('0 <= minLandmarkVisibility <= goodLandmarkVisibility <= 1', 0, cfg.minLandmarkVisibility, cfg.goodLandmarkVisibility, 1);
  ordered('0 <= frameMargin <= 0.25', 0, cfg.frameMargin, 0.25);
  ordered('0 <= centerOffsetWarn <= centerOffsetFail <= 0.5', 0, cfg.centerOffsetWarn, cfg.centerOffsetFail, 0.5);
  ordered(
    '0 < heightFractionHardMin <= heightFractionMin <= heightFractionMax <= heightFractionHardMax <= 1',
    0,
    cfg.heightFractionHardMin,
    cfg.heightFractionMin,
    cfg.heightFractionMax,
    cfg.heightFractionHardMax,
    1
  );
  if (cfg.heightFractionHardMin <= 0) throw new RangeError('captureQuality config inconsistent: heightFractionHardMin must be > 0');
  ordered(
    '0 <= brightnessFailLow <= brightnessWarnLow <= brightnessWarnHigh <= brightnessFailHigh <= 1',
    0,
    cfg.brightnessFailLow,
    cfg.brightnessWarnLow,
    cfg.brightnessWarnHigh,
    cfg.brightnessFailHigh,
    1
  );
  ordered('0 <= sharpnessFailBelow <= sharpnessWarnBelow', 0, cfg.sharpnessFailBelow, cfg.sharpnessWarnBelow);
  ordered('0 <= motionWarnAbove <= motionFailAbove', 0, cfg.motionWarnAbove, cfg.motionFailAbove);
  return cfg;
}

// ---------------------------------------------------------------------------
// Landmark selection
// ---------------------------------------------------------------------------

const FRONT_REQUIRED: readonly PoseLandmarkName[] = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];
const SIDE_CHAINS: Record<'left' | 'right', readonly PoseLandmarkName[]> = {
  left: ['nose', 'leftShoulder', 'leftHip', 'leftKnee', 'leftAnkle'],
  right: ['nose', 'rightShoulder', 'rightHip', 'rightKnee', 'rightAnkle'],
};

export interface NamedRead {
  name: PoseLandmarkName;
  read: LandmarkRead;
}

function readAll(landmarks: LandmarkList, names: readonly PoseLandmarkName[], minVis: number): NamedRead[] {
  return names.map((name) => ({ name, read: readLandmark(landmarks, name, minVis) }));
}

/**
 * Front view needs every required landmark. A side view only ever shows one
 * side of the body clearly, so it needs ONE complete side chain; the better of
 * the two is used (fewest unusable landmarks, then highest minimum visibility).
 *
 * Exported (behaviour unchanged) so pose-detection acceptance can count the
 * same required landmarks these checks use instead of re-implementing the choice.
 */
export function selectRequiredReads(landmarks: LandmarkList, view: ScanView, minVis: number): NamedRead[] {
  if (view !== 'side') return readAll(landmarks, FRONT_REQUIRED, minVis);
  const left = readAll(landmarks, SIDE_CHAINS.left, minVis);
  const right = readAll(landmarks, SIDE_CHAINS.right, minVis);
  const score = (reads: NamedRead[]) => ({
    bad: reads.filter((r) => r.read.status !== 'ok').length,
    minVis: Math.min(...reads.map((r) => r.read.visibility ?? 0)),
  });
  const l = score(left);
  const r = score(right);
  if (r.bad < l.bad || (r.bad === l.bad && r.minVis > l.minVis)) return right;
  return left;
}

const labels = (names: readonly PoseLandmarkName[]) => names.map((n) => POSE_LANDMARK_LABEL[n]).join(', ');

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkLandmarksVisible(reads: NamedRead[], hasList: boolean, cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'landmarks_visible';
  if (!hasList) {
    return {
      id,
      status: 'fail',
      message: 'No body landmarks were detected.',
      advice: 'Stand fully in view of the camera, in good light, and try again.',
    };
  }
  const bad = reads.filter((r) => r.read.status !== 'ok');
  if (bad.length > 0) {
    return {
      id,
      status: 'fail',
      message: `Not clearly visible: ${labels(bad.map((b) => b.name))}.`,
      advice: 'Make sure your whole body, head to feet, is in view, wear fitted clothing, and avoid anything blocking the camera.',
    };
  }
  const visibilities = reads.map((r) => r.read.visibility as number);
  const minV = Math.min(...visibilities);
  const borderline = reads.filter((r) => (r.read.visibility as number) < cfg.goodLandmarkVisibility);
  if (borderline.length > 0) {
    return {
      id,
      status: 'warning',
      value: minV,
      message: `Detected with borderline confidence: ${labels(borderline.map((b) => b.name))}.`,
      advice: 'Improve the lighting and stand against a plain background that contrasts with your clothing.',
    };
  }
  return { id, status: 'pass', value: minV, message: 'All required body landmarks are clearly visible.' };
}

function checkInFrame(reads: NamedRead[], cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'in_frame';
  const located = reads.filter((r) => r.read.point !== undefined);
  if (located.length === 0) {
    return { id, status: 'not_evaluated', message: 'Frame position could not be checked: no landmark coordinates available.' };
  }
  const out: PoseLandmarkName[] = [];
  const edges = new Set<'top' | 'bottom' | 'left' | 'right'>();
  const m = cfg.frameMargin;
  for (const { name, read } of located) {
    const { x, y } = read.point!;
    const touched: ('top' | 'bottom' | 'left' | 'right')[] = [];
    if (y < m) touched.push('top');
    if (y > 1 - m) touched.push('bottom');
    if (x < m) touched.push('left');
    if (x > 1 - m) touched.push('right');
    touched.forEach((e) => edges.add(e));
    if (touched.length > 0) out.push(name);
  }
  if (out.length === 0) return { id, status: 'pass', message: 'Your whole body is inside the frame.' };
  const advice: string[] = [];
  if (edges.has('bottom')) advice.push('step back or lower the camera so your feet are fully in frame');
  if (edges.has('top')) advice.push('step back or tilt the camera down so your head is fully in frame');
  if (edges.has('left') || edges.has('right')) advice.push('move toward the centre of the frame');
  return {
    id,
    status: 'fail',
    message: `Cut off at the edge of the frame: ${labels(out)}.`,
    advice: `Please ${advice.join(' and ')}.`,
  };
}

function checkCentered(reads: NamedRead[], cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'centered';
  const pts = reads.filter((r) => r.read.status === 'ok').map((r) => r.read.point!);
  if (pts.length < 2) {
    return { id, status: 'not_evaluated', message: 'Centring could not be checked: fewer than two reliable landmarks.' };
  }
  const xs = pts.map((p) => p.x);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  const offset = Math.abs(centre - 0.5);
  if (offset > cfg.centerOffsetFail) {
    return { id, status: 'fail', value: offset, message: 'You are well off-centre in the frame.', advice: 'Move toward the centre of the frame.' };
  }
  if (offset > cfg.centerOffsetWarn) {
    return { id, status: 'warning', value: offset, message: 'You are slightly off-centre in the frame.', advice: 'Move a little toward the centre of the frame.' };
  }
  return { id, status: 'pass', value: offset, message: 'You are centred in the frame.' };
}

function checkBodyHeightFraction(reads: NamedRead[], cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'body_height_fraction';
  const nose = reads.find((r) => r.name === 'nose' && r.read.status === 'ok');
  const ankles = reads.filter((r) => /Ankle$/.test(r.name) && r.read.status === 'ok');
  if (!nose || ankles.length === 0) {
    return { id, status: 'not_evaluated', message: 'Body size in frame could not be checked: head or ankle landmark not reliable.' };
  }
  const fraction = Math.max(...ankles.map((a) => a.read.point!.y)) - nose.read.point!.y;
  if (fraction <= 0) {
    return {
      id,
      status: 'fail',
      value: fraction,
      message: 'Head and feet positions are inconsistent (head is not above the feet).',
      advice: 'Hold the phone upright and stand facing the camera with your whole body in view.',
    };
  }
  if (fraction < cfg.heightFractionHardMin) {
    return { id, status: 'fail', value: fraction, message: 'You are too far from the camera.', advice: 'Move closer so your body fills more of the frame.' };
  }
  if (fraction < cfg.heightFractionMin) {
    return { id, status: 'warning', value: fraction, message: 'You appear a bit small in the frame.', advice: 'Move a little closer to the camera.' };
  }
  if (fraction > cfg.heightFractionHardMax) {
    return { id, status: 'fail', value: fraction, message: 'You are too close to the camera.', advice: 'Step back so your whole body fits with some space around it.' };
  }
  if (fraction > cfg.heightFractionMax) {
    return { id, status: 'warning', value: fraction, message: 'You fill almost the whole frame.', advice: 'Step back a little to leave some margin.' };
  }
  return { id, status: 'pass', value: fraction, message: 'Body size in the frame looks right.' };
}

function suppliedNumber(raw: number | null | undefined, validRange: (n: number) => boolean) {
  if (raw === undefined || raw === null) return { state: 'missing' as const };
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !validRange(raw)) return { state: 'invalid' as const };
  return { state: 'ok' as const, value: raw };
}

function notEvaluated(id: QualityCheckId, noun: string, state: 'missing' | 'invalid'): QualityCheck {
  return {
    id,
    status: 'not_evaluated',
    message: state === 'missing' ? `${noun} was not supplied, so it was not checked.` : `${noun} value was invalid, so it was not checked.`,
  };
}

function checkBrightness(raw: number | null | undefined, cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'brightness';
  const s = suppliedNumber(raw, (n) => n >= 0 && n <= 1);
  if (s.state !== 'ok') return notEvaluated(id, 'Brightness', s.state);
  const v = s.value;
  if (v < cfg.brightnessFailLow) return { id, status: 'fail', value: v, message: 'The image is far too dark.', advice: 'Move to a brighter room or turn on more lights.' };
  if (v < cfg.brightnessWarnLow) return { id, status: 'warning', value: v, message: 'The image is a bit dark.', advice: 'Add more light, ideally facing you rather than behind you.' };
  if (v > cfg.brightnessFailHigh) return { id, status: 'fail', value: v, message: 'The image is far too bright or washed out.', advice: 'Avoid direct sunlight or a strong light pointing at the camera.' };
  if (v > cfg.brightnessWarnHigh) return { id, status: 'warning', value: v, message: 'The image is very bright.', advice: 'Reduce glare or strong light behind or beside you.' };
  return { id, status: 'pass', value: v, message: 'Brightness is within a reasonable range.' };
}

function checkSharpness(raw: number | null | undefined, cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'sharpness';
  const s = suppliedNumber(raw, (n) => n >= 0);
  if (s.state !== 'ok') return notEvaluated(id, 'Sharpness', s.state);
  const v = s.value;
  if (v < cfg.sharpnessFailBelow) return { id, status: 'fail', value: v, message: 'The image is very blurry.', advice: 'Hold the phone steady or prop it up, and wipe the camera lens.' };
  if (v < cfg.sharpnessWarnBelow) return { id, status: 'warning', value: v, message: 'The image is slightly blurry.', advice: 'Keep still and steady the phone or use a stand.' };
  return { id, status: 'pass', value: v, message: 'The image looks sharp enough.' };
}

function checkStillness(raw: number | null | undefined, cfg: CaptureQualityConfig): QualityCheck {
  const id: QualityCheckId = 'stillness';
  const s = suppliedNumber(raw, (n) => n >= 0);
  if (s.state !== 'ok') return notEvaluated(id, 'Motion', s.state);
  const v = s.value;
  if (v > cfg.motionFailAbove) return { id, status: 'fail', value: v, message: 'You are moving too much.', advice: 'Stand still for a moment before capturing.' };
  if (v > cfg.motionWarnAbove) return { id, status: 'warning', value: v, message: 'There is some movement.', advice: 'Try to hold still for a second or two.' };
  return { id, status: 'pass', value: v, message: 'You are holding still.' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Runs every check and combines them. Never throws for bad *input*; see `resolveCaptureQualityConfig` for config errors. */
export function assessCaptureQuality(
  input: CaptureQualityInput,
  configOverrides?: Partial<CaptureQualityConfig>
): CaptureQualityAssessment {
  const cfg = resolveCaptureQualityConfig(configOverrides);
  const view: ScanView = input?.view === 'side' ? 'side' : 'front';
  const landmarks = input?.landmarks;
  const hasList = Array.isArray(landmarks) && landmarks.length > 0;
  const reads = selectRequiredReads(landmarks, view, cfg.minLandmarkVisibility);

  const checks: QualityCheck[] = [
    checkLandmarksVisible(reads, hasList, cfg),
    checkInFrame(reads, cfg),
    checkCentered(reads, cfg),
    checkBodyHeightFraction(reads, cfg),
    checkBrightness(input?.brightness, cfg),
    checkSharpness(input?.sharpness, cfg),
    checkStillness(input?.motion, cfg),
  ];

  const status: OverallQualityStatus = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warning')
      ? 'warning'
      : 'pass';

  const feedback: string[] = [];
  for (const wanted of ['fail', 'warning'] as const) {
    for (const c of checks) {
      if (c.status === wanted && c.advice && !feedback.includes(c.advice)) feedback.push(c.advice);
    }
  }
  const notEvaluatedIds = checks.filter((c) => c.status === 'not_evaluated').map((c) => c.id);

  return { status, checks, feedback, notEvaluated: notEvaluatedIds, complete: notEvaluatedIds.length === 0 };
}

/**
 * Adapter to the stored `CaptureQualityReport` type (good / fair / poor).
 * `issues` lists what was found for warnings and failures (failures first).
 * Checks that could not be evaluated are NOT issues; keep the full
 * `CaptureQualityAssessment` if the UI needs to show them.
 */
export function toCaptureQualityReport(assessment: CaptureQualityAssessment): CaptureQualityReport {
  const issues: string[] = [];
  for (const wanted of ['fail', 'warning'] as const) {
    for (const c of assessment.checks) if (c.status === wanted) issues.push(c.message);
  }
  const level = assessment.status === 'pass' ? 'good' : assessment.status === 'warning' ? 'fair' : 'poor';
  return { level, issues };
}

const MOTION_LANDMARKS: readonly PoseLandmarkName[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

/**
 * Derives a stillness number from landmarks of several recent frames
 * (oldest to newest; the caller decides the window, e.g. the last second).
 *
 * Result = mean over landmarks of the RMS distance of that landmark from its
 * own average position across the frames, in fractions of image HEIGHT
 * (x is scaled by `aspectRatio` = width / height so distances are isotropic).
 *
 * Returns null when it cannot be computed (fewer than two frames, invalid
 * aspect ratio, or no landmark with finite coordinates in at least two frames).
 * This measures pose-estimate stability, which includes model jitter.
 */
export function measureLandmarkMotion(
  frames: readonly LandmarkList[],
  aspectRatio: number,
  names: readonly PoseLandmarkName[] = MOTION_LANDMARKS
): number | null {
  if (!Array.isArray(frames) || frames.length < 2 || !isValidAspectRatio(aspectRatio)) return null;
  const spreads: number[] = [];
  for (const name of names) {
    const pts: { x: number; y: number }[] = [];
    for (const frame of frames) {
      const r = readLandmark(frame, name, 0);
      if (r.point) pts.push({ x: r.point.x * aspectRatio, y: r.point.y });
    }
    if (pts.length < 2) continue;
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const meanSq = pts.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / pts.length;
    spreads.push(Math.sqrt(meanSq));
  }
  if (spreads.length === 0) return null;
  return spreads.reduce((s, v) => s + v, 0) / spreads.length;
}
