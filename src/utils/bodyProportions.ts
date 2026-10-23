/**
 * Defensible 2D landmark metrics for Body Scan.
 *
 * Pure functions over pose landmarks (normalised 0..1 image space, y down).
 * No browser APIs, no React, no I/O.
 *
 * WHAT THESE ARE
 * Geometry between detected joint positions in ONE 2D photo: tilt angles and
 * ratios of landmark-to-landmark distances. Angles and distances are computed
 * in an aspect-corrected space (x multiplied by width/height), because
 * normalised x and y are different physical units on any non-square image.
 *
 * WHAT THESE ARE NOT
 * - Not body measurements. Landmarks are joint-centre estimates, not the body
 *   outline: "shoulder width" is the distance between the two shoulder joints,
 *   not the width across the shoulders or arms, and "hip width" is between hip
 *   joints, not the widest point of the hips.
 * - Not 3D. Perspective, lens distortion, camera tilt, and the person turning
 *   or leaning toward/away from the camera all change 2D distances. Nothing
 *   here can detect these.
 * - Not medical or clinical. No body-fat %, muscle mass, weight or
 *   circumference (waist, chest, arm, thigh...) is, or can be, derived from
 *   these inputs, and this module deliberately has no function for them.
 * - Confidence is derived ONLY from the pose model's own landmark visibility
 *   scores (and capped further where noted). It says how clearly the landmarks
 *   were detected, not how accurate the number is in real life.
 *
 * Normalised ratios/angles (units 'ratio', 'deg') are kept distinct from the
 * one approximate-centimetre value, which requires a user-supplied height and
 * an explicit assumption (see `calculateApproxTorsoLengthCm`).
 */

import type { MeasurementConfidence, ScanMeasurement, ScanView } from '../types/bodyScan';
import {
  type LandmarkList,
  type PoseLandmarkName,
  POSE_LANDMARK_LABEL,
  isValidAspectRatio,
  readLandmark,
} from './poseLandmarks';

// ---------------------------------------------------------------------------
// Public types and constants
// ---------------------------------------------------------------------------

export type BodyMetricKey =
  | 'shoulder_tilt'
  | 'hip_tilt'
  | 'shoulder_hip_width_ratio'
  | 'torso_to_body_height_ratio'
  | 'torso_lean'
  | 'approx_torso_length_cm';

export type UnavailableReason =
  | 'invalid_options' //         bad aspect ratio or minVisibility
  | 'landmark_not_usable' //     missing, non-finite, low-confidence or outside the frame
  | 'degenerate_geometry' //     zero/near-zero lengths, or not an upright pose
  | 'not_applicable_to_view' //  e.g. shoulder tilt from a side-on photo
  | 'height_not_provided'
  | 'invalid_height';

export interface MetricUnavailable {
  key: BodyMetricKey;
  reason: UnavailableReason;
  /** Plain-language explanation suitable for showing next to the empty value. */
  detail: string;
}

export type MetricResult =
  | { status: 'ok'; measurement: ScanMeasurement }
  | ({ status: 'unavailable' } & MetricUnavailable);

export interface BodyMetricOptions {
  view: ScanView;
  /** Width / height of the image the landmarks were normalised against (e.g. 0.75 for a 3:4 portrait). Required. */
  aspectRatio: number;
  /** Landmarks with visibility below this are not used. Default 0.5. */
  minVisibility?: number;
  /** User-entered standing height in cm. Only used by `approx_torso_length_cm`. */
  heightCm?: number | null;
}

export interface BodyMetricsReport {
  view: ScanView;
  /** One entry per metric applicable to the view, available or not. */
  results: MetricResult[];
  /** Only the metrics that could be calculated; ready for `BodyScanRecord.measurements`. */
  measurements: ScanMeasurement[];
  unavailable: MetricUnavailable[];
}

/** Default minimum landmark visibility. */
export const DEFAULT_MIN_VISIBILITY = 0.5;

/**
 * Minimum length, as a fraction of image height, that a landmark-to-landmark
 * distance (or horizontal separation) must have to be used. Guards against
 * division by ~zero and against landmarks that collapsed onto each other.
 */
export const MIN_LANDMARK_SEPARATION = 0.03;

/**
 * ASSUMPTION (approximate, population-average rule of thumb): the vertical span
 * from the nose landmark to the ankle-joint landmark is about 87% of standing
 * height. It varies between individuals and body shapes, and with pose. Used
 * only for `approx_torso_length_cm`.
 */
export const NOSE_TO_ANKLE_FRACTION_OF_HEIGHT = 0.87;

export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

/** Shoulder/hip width ratios outside this range are reported with low confidence. */
const PLAUSIBLE_WIDTH_RATIO: readonly [number, number] = [0.5, 2.5];

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<MeasurementConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Maps the LOWEST landmark visibility used by a metric to a confidence level.
 * Heuristic, not validated against real-world accuracy.
 */
export function confidenceFromVisibility(minVisibility: number): MeasurementConfidence {
  if (!Number.isFinite(minVisibility)) return 'low';
  if (minVisibility >= 0.85) return 'high';
  if (minVisibility >= 0.65) return 'medium';
  return 'low';
}

function capConfidence(c: MeasurementConfidence, cap: MeasurementConfidence): MeasurementConfidence {
  return CONFIDENCE_RANK[c] <= CONFIDENCE_RANK[cap] ? c : cap;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}
type Usable = { ok: true; pt: Pt; vis: number } | { ok: false; detail: string };
type Resolved<T> = { ok: true; value: T } | { ok: false; detail: string };

const RAD_TO_DEG = 180 / Math.PI;

function unavailable(key: BodyMetricKey, reason: UnavailableReason, detail: string): MetricResult {
  return { status: 'unavailable', key, reason, detail };
}

function ok(
  key: BodyMetricKey,
  value: number,
  unit: ScanMeasurement['unit'],
  source: ScanMeasurement['source'],
  confidence: MeasurementConfidence,
  note: string
): MetricResult {
  return { status: 'ok', measurement: { key, value, unit, source, confidence, note } };
}

function resolveOptions(o: BodyMetricOptions): Resolved<{ aspect: number; minVis: number }> {
  if (!o || !isValidAspectRatio(o.aspectRatio)) {
    return { ok: false, detail: 'A valid image aspect ratio (width / height) is required to compute angles and distances.' };
  }
  const minVis = o.minVisibility === undefined ? DEFAULT_MIN_VISIBILITY : o.minVisibility;
  if (typeof minVis !== 'number' || !Number.isFinite(minVis) || minVis < 0 || minVis > 1) {
    return { ok: false, detail: 'minVisibility must be a number between 0 and 1.' };
  }
  return { ok: true, value: { aspect: o.aspectRatio, minVis } };
}

/** A landmark is usable only if detected, finite, confident enough and inside the frame. */
function useLandmark(landmarks: LandmarkList, name: PoseLandmarkName, aspect: number, minVis: number): Usable {
  const label = POSE_LANDMARK_LABEL[name];
  const r = readLandmark(landmarks, name, minVis);
  switch (r.status) {
    case 'missing':
      return { ok: false, detail: `${label} was not detected.` };
    case 'non_finite':
      return { ok: false, detail: `${label} has invalid coordinates.` };
    case 'visibility_unknown':
      return { ok: false, detail: `${label} has no valid confidence score.` };
    case 'low_visibility':
      return { ok: false, detail: `${label} is not clearly visible.` };
    default:
      break;
  }
  const p = r.point!;
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
    return { ok: false, detail: `${label} is outside the frame (its position would be a guess).` };
  }
  return { ok: true, pt: { x: p.x * aspect, y: p.y }, vis: r.visibility as number };
}

function gather(
  landmarks: LandmarkList,
  names: readonly PoseLandmarkName[],
  aspect: number,
  minVis: number
): Resolved<{ pts: Partial<Record<PoseLandmarkName, Pt>>; minVis: number }> {
  const pts: Partial<Record<PoseLandmarkName, Pt>> = {};
  let lowest = 1;
  for (const name of names) {
    const u = useLandmark(landmarks, name, aspect, minVis);
    if (!u.ok) return { ok: false, detail: u.detail };
    pts[name] = u.pt;
    lowest = Math.min(lowest, u.vis);
  }
  return { ok: true, value: { pts, minVis: lowest } };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The landmarks that define the torso axis and body span.
 *
 * Front view: midpoints of the left/right pairs. Side view: one side only (the
 * clearly visible side with the higher lowest-visibility), since the far side
 * is normally hidden behind the body.
 *
 * Requires an upright ordering (nose above shoulders above hips above ankles
 * in image y), otherwise the geometry is not meaningful and we say so.
 */
interface UprightChain {
  nose?: Pt;
  shoulder: Pt;
  hip: Pt;
  ankle?: Pt;
  minVisibility: number;
}

function resolveChain(
  landmarks: LandmarkList,
  view: ScanView,
  aspect: number,
  minVis: number,
  needs: { nose: boolean; ankle: boolean }
): Resolved<UprightChain> {
  const build = (side: 'both' | 'left' | 'right'): Resolved<UprightChain> => {
    const sideNames = (part: 'Shoulder' | 'Hip' | 'Ankle'): PoseLandmarkName[] =>
      side === 'both'
        ? [`left${part}` as PoseLandmarkName, `right${part}` as PoseLandmarkName]
        : [`${side}${part}` as PoseLandmarkName];
    const names: PoseLandmarkName[] = [...sideNames('Shoulder'), ...sideNames('Hip')];
    if (needs.ankle) names.push(...sideNames('Ankle'));
    if (needs.nose) names.push('nose');
    const g = gather(landmarks, names, aspect, minVis);
    if (!g.ok) return g;
    const { pts, minVis: lowest } = g.value;
    const pick = (part: 'Shoulder' | 'Hip' | 'Ankle'): Pt => {
      const n = sideNames(part);
      return n.length === 2 ? mid(pts[n[0]] as Pt, pts[n[1]] as Pt) : (pts[n[0]] as Pt);
    };
    const chain: UprightChain = {
      shoulder: pick('Shoulder'),
      hip: pick('Hip'),
      ankle: needs.ankle ? pick('Ankle') : undefined,
      nose: needs.nose ? pts.nose : undefined,
      minVisibility: lowest,
    };
    const upright =
      chain.shoulder.y < chain.hip.y &&
      (!chain.nose || chain.nose.y < chain.shoulder.y) &&
      (!chain.ankle || chain.hip.y < chain.ankle.y);
    if (!upright) {
      return {
        ok: false,
        detail: 'Landmarks are not in an upright order (head above shoulders above hips above feet); stand upright with the camera held level.',
      };
    }
    return { ok: true, value: chain };
  };

  if (view !== 'side') return build('both');
  const left = build('left');
  const right = build('right');
  if (left.ok && right.ok) return right.value.minVisibility > left.value.minVisibility ? right : left;
  if (left.ok) return left;
  if (right.ok) return right;
  return { ok: false, detail: `Left side: ${left.detail} Right side: ${right.detail}` };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const TILT_NOTE =
  'Angle of the line between the two joints in the 2D photo, relative to horizontal. Positive = the joint on the right of the image is lower. ' +
  'Photo-based and approximate: camera tilt or a turned body changes it. Sign depends on whether the image is mirrored; compare the size, not the direction.';

function calculateTilt(
  key: 'shoulder_tilt' | 'hip_tilt',
  leftName: PoseLandmarkName,
  rightName: PoseLandmarkName,
  landmarks: LandmarkList,
  o: BodyMetricOptions
): MetricResult {
  if (o?.view !== 'front') {
    return unavailable(key, 'not_applicable_to_view', 'Tilt between left and right joints is only meaningful in a front-facing photo.');
  }
  const opts = resolveOptions(o);
  if (!opts.ok) return unavailable(key, 'invalid_options', opts.detail);
  const { aspect, minVis } = opts.value;
  const g = gather(landmarks, [leftName, rightName], aspect, minVis);
  if (!g.ok) return unavailable(key, 'landmark_not_usable', g.detail);
  const a = g.value.pts[leftName] as Pt;
  const b = g.value.pts[rightName] as Pt;
  const [p1, p2] = a.x <= b.x ? [a, b] : [b, a]; // p1 = left of the image
  const dx = p2.x - p1.x;
  if (dx < MIN_LANDMARK_SEPARATION) {
    return unavailable(key, 'degenerate_geometry', 'The two landmarks are too close together horizontally (is the body turned side-on?).');
  }
  const deg = Math.atan2(p2.y - p1.y, dx) * RAD_TO_DEG;
  return ok(key, deg, 'deg', 'landmark', confidenceFromVisibility(g.value.minVis), TILT_NOTE);
}

/** Tilt of the line between the shoulder joints. Front view only. */
export function calculateShoulderTilt(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  return calculateTilt('shoulder_tilt', 'leftShoulder', 'rightShoulder', landmarks, o);
}

/** Tilt of the line between the hip joints. Front view only. */
export function calculateHipTilt(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  return calculateTilt('hip_tilt', 'leftHip', 'rightHip', landmarks, o);
}

/**
 * Shoulder-joint distance divided by hip-joint distance. Front view only.
 * This is a ratio of joint spacings, not of body widths: clothing, arms,
 * body shape and a slightly turned stance all affect it. Unusual values
 * (outside 0.5 to 2.5) are reported with low confidence.
 */
export function calculateShoulderHipWidthRatio(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  const key = 'shoulder_hip_width_ratio';
  if (o?.view !== 'front') {
    return unavailable(key, 'not_applicable_to_view', 'The shoulder-to-hip width ratio needs a front-facing photo.');
  }
  const opts = resolveOptions(o);
  if (!opts.ok) return unavailable(key, 'invalid_options', opts.detail);
  const { aspect, minVis } = opts.value;
  const g = gather(landmarks, ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'], aspect, minVis);
  if (!g.ok) return unavailable(key, 'landmark_not_usable', g.detail);
  const { pts } = g.value;
  const shoulderWidth = dist(pts.leftShoulder as Pt, pts.rightShoulder as Pt);
  const hipWidth = dist(pts.leftHip as Pt, pts.rightHip as Pt);
  if (shoulderWidth < MIN_LANDMARK_SEPARATION || hipWidth < MIN_LANDMARK_SEPARATION) {
    return unavailable(key, 'degenerate_geometry', 'The shoulder or hip landmarks are too close together to form a reliable ratio (is the body turned side-on?).');
  }
  const ratio = shoulderWidth / hipWidth;
  let confidence = confidenceFromVisibility(g.value.minVis);
  let note =
    'Ratio of the distance between the shoulder joints to the distance between the hip joints in a front photo. Joint spacing, not body width; unitless.';
  if (ratio < PLAUSIBLE_WIDTH_RATIO[0] || ratio > PLAUSIBLE_WIDTH_RATIO[1]) {
    confidence = 'low';
    note += ' This value is unusual: check that you faced the camera squarely and that the landmarks are correct.';
  }
  return ok(key, ratio, 'ratio', 'landmark', confidence, note);
}

const TORSO_BODY_NOTE =
  'Torso = distance from the shoulder point to the hip point. "Body height" here = distance from the nose to the ankle point, which is shorter than standing height (it excludes the top of the head and the floor). ' +
  'A 2D ratio of landmark distances: sensitive to camera angle and posture, and not comparable with ratios computed from a different pose or framing.';

interface TorsoGeometry {
  torsoLength: number;
  span: number;
  minVisibility: number;
}

type TorsoResult = { ok: true; value: TorsoGeometry } | { ok: false; detail: string; reason: UnavailableReason };

function torsoGeometry(landmarks: LandmarkList, o: BodyMetricOptions): TorsoResult {
  const opts = resolveOptions(o);
  if (!opts.ok) return { ok: false, detail: opts.detail, reason: 'invalid_options' };
  const chain = resolveChain(landmarks, o.view, opts.value.aspect, opts.value.minVis, { nose: true, ankle: true });
  if (!chain.ok) {
    const geometry = chain.detail.startsWith('Landmarks are not in an upright');
    return { ok: false, detail: chain.detail, reason: geometry ? 'degenerate_geometry' : 'landmark_not_usable' };
  }
  const c = chain.value;
  const torsoLength = dist(c.shoulder, c.hip);
  const span = dist(c.nose as Pt, c.ankle as Pt);
  if (torsoLength < MIN_LANDMARK_SEPARATION || span < MIN_LANDMARK_SEPARATION) {
    return { ok: false, detail: 'Torso or body-height landmarks are too close together to measure.', reason: 'degenerate_geometry' };
  }
  return { ok: true, value: { torsoLength, span, minVisibility: c.minVisibility } };
}

/**
 * Torso length divided by nose-to-ankle length (see `TORSO_BODY_NOTE` for the
 * exact landmark definitions). Works from front or side view; in a side view
 * the single clearer side is used and confidence is capped at 'medium'.
 */
export function calculateTorsoToBodyHeightRatio(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  const key = 'torso_to_body_height_ratio';
  const g = torsoGeometry(landmarks, o);
  if (!g.ok) return unavailable(key, g.reason, g.detail);
  let confidence = confidenceFromVisibility(g.value.minVisibility);
  if (o.view === 'side') confidence = capConfidence(confidence, 'medium');
  return ok(key, g.value.torsoLength / g.value.span, 'ratio', 'landmark', confidence, TORSO_BODY_NOTE);
}

/**
 * Angle between the hip-to-shoulder line and vertical, in degrees. Positive =
 * the shoulders are to the right of the hips in the image. In a front photo
 * this is sideways lean; in a side photo it is forward/back lean (which way is
 * "forward" depends on which way the person faces). Approximate and
 * perspective-dependent. Not a posture diagnosis.
 */
export function calculateTorsoLean(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  const key = 'torso_lean';
  const opts = resolveOptions(o);
  if (!opts.ok) return unavailable(key, 'invalid_options', opts.detail);
  const chain = resolveChain(landmarks, o.view, opts.value.aspect, opts.value.minVis, { nose: false, ankle: false });
  if (!chain.ok) {
    const geometry = chain.detail.startsWith('Landmarks are not in an upright');
    return unavailable(key, geometry ? 'degenerate_geometry' : 'landmark_not_usable', chain.detail);
  }
  const { shoulder, hip, minVisibility } = chain.value;
  if (dist(shoulder, hip) < MIN_LANDMARK_SEPARATION) {
    return unavailable(key, 'degenerate_geometry', 'Shoulder and hip landmarks are too close together to measure lean.');
  }
  const deg = Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * RAD_TO_DEG;
  let confidence = confidenceFromVisibility(minVisibility);
  if (o.view === 'side') confidence = capConfidence(confidence, 'medium');
  return ok(
    key,
    deg,
    'deg',
    'landmark',
    confidence,
    'Angle of the hip-to-shoulder line from vertical in the 2D photo. Positive = shoulders are to the right of the hips in the image. Approximate; depends on camera angle and posture.'
  );
}

/**
 * APPROXIMATE torso length in centimetres:
 *   ratio(torso / nose-to-ankle) x (heightCm x NOSE_TO_ANKLE_FRACTION_OF_HEIGHT)
 *
 * Assumptions (all of which real photos violate to some degree):
 *  1. Nose-to-ankle landmark span is about 87% of standing height.
 *  2. Camera is level, at about mid-body height, and perpendicular to the
 *     person, who stands upright in a plane parallel to the image (no
 *     perspective foreshortening, no lens distortion, no leaning).
 *  3. The landmarks sit where the real joints are.
 * Confidence is always 'low'. This is not a tape-measure value and must not be
 * presented as one.
 */
export function calculateApproxTorsoLengthCm(landmarks: LandmarkList, o: BodyMetricOptions): MetricResult {
  const key = 'approx_torso_length_cm';
  const h = o?.heightCm;
  if (h === undefined || h === null) {
    return unavailable(key, 'height_not_provided', 'Enter your height to see an approximate length in centimetres.');
  }
  if (typeof h !== 'number' || !Number.isFinite(h) || h < MIN_HEIGHT_CM || h > MAX_HEIGHT_CM) {
    return unavailable(key, 'invalid_height', `Height must be a number between ${MIN_HEIGHT_CM} and ${MAX_HEIGHT_CM} cm.`);
  }
  const g = torsoGeometry(landmarks, o);
  if (!g.ok) return unavailable(key, g.reason, g.detail);
  const cm = (g.value.torsoLength / g.value.span) * (h * NOSE_TO_ANKLE_FRACTION_OF_HEIGHT);
  return ok(
    key,
    cm,
    'cm',
    'calculated',
    'low',
    `Approximate. Estimated from your entered height (${h} cm) and the 2D torso-to-body ratio, assuming the nose-to-ankle span is about ${Math.round(
      NOSE_TO_ANKLE_FRACTION_OF_HEIGHT * 100
    )}% of your height and that you stood upright, square to a level camera. Perspective and posture can change this materially. Not a tape measurement.`
  );
}

/**
 * Runs every metric that applies to the view.
 *   front: shoulder tilt, hip tilt, shoulder/hip width ratio, torso/body ratio, torso lean, approx torso length
 *   side:  torso/body ratio, torso lean, approx torso length
 */
export function calculateBodyMetrics(landmarks: LandmarkList, o: BodyMetricOptions): BodyMetricsReport {
  const view: ScanView = o?.view === 'side' ? 'side' : 'front';
  const opts: BodyMetricOptions = { ...o, view };
  const results: MetricResult[] =
    view === 'front'
      ? [
          calculateShoulderTilt(landmarks, opts),
          calculateHipTilt(landmarks, opts),
          calculateShoulderHipWidthRatio(landmarks, opts),
          calculateTorsoToBodyHeightRatio(landmarks, opts),
          calculateTorsoLean(landmarks, opts),
          calculateApproxTorsoLengthCm(landmarks, opts),
        ]
      : [
          calculateTorsoToBodyHeightRatio(landmarks, opts),
          calculateTorsoLean(landmarks, opts),
          calculateApproxTorsoLengthCm(landmarks, opts),
        ];
  const measurements: ScanMeasurement[] = [];
  const unavailableList: MetricUnavailable[] = [];
  for (const r of results) {
    if (r.status === 'ok') measurements.push(r.measurement);
    else unavailableList.push({ key: r.key, reason: r.reason, detail: r.detail });
  }
  return { view, results, measurements, unavailable: unavailableList };
}
