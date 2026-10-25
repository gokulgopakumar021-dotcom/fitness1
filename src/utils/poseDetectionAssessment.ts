import type { LandmarkPoint, ScanView } from '../types/bodyScan';
import {
  DEFAULT_CAPTURE_QUALITY_CONFIG,
  assessCaptureQuality,
  selectRequiredReads,
  toCaptureQualityReport,
  type CaptureQualityAssessment,
} from './captureQuality';
import type { PoseAdaptResult } from './poseResultAdapter';

/**
 * Decides what a pose-detection result means for ONE photo.
 *
 * "The model returned landmarks" (inference success) is not the same as "the
 * pose is usable" (acceptance). This module keeps the two apart:
 *
 *   usable  every required landmark is reliably visible and no evaluated check
 *           found a problem (warnings are allowed and are reported).
 *   partial a pose was found and at least half of the required landmarks are
 *           reliable, but something is missing or a framing check failed
 *           (cut off at an edge, too far / too close, off-centre).
 *   failed  nothing usable: no pose, an unreadable result, fewer than half of
 *           the required landmarks reliable, or a collapsed / degenerate pose.
 *
 * Quality inputs: ONLY landmark-derived checks are run. Brightness, sharpness
 * and motion are never supplied, so those checks stay `not_evaluated`; they are
 * never guessed and never counted as a pass. `qualityComplete` is therefore
 * false for every outcome produced by this phase, and the UI must say so.
 *
 * The two numeric rules below are NEW heuristics introduced in Phase 2C. They
 * are not calibrated against real users or devices. Existing capture-quality
 * thresholds are used unchanged.
 *
 * Front and side views are assessed independently: the view decides which
 * landmarks are required (all nine for front, one complete side chain for
 * side), and nothing here combines or compares the two coordinate systems.
 *
 * Pure module: no browser APIs, no React, no I/O.
 */

/** Below this fraction of reliable required landmarks the result is `failed` rather than `partial`. */
export const MIN_RELIABLE_FRACTION_FOR_PARTIAL = 0.5;

/** Required landmarks spanning less than this fraction of image height are treated as a collapsed pose. */
export const MIN_POSE_VERTICAL_SPAN = 0.05;

export type PoseDetectionStatus = 'usable' | 'partial' | 'failed';

export type PoseFailureReason = 'no_pose' | 'malformed_result' | 'too_few_landmarks' | 'degenerate_pose';

export interface PoseDetectionOutcome {
  view: ScanView;
  status: PoseDetectionStatus;
  failureReason?: PoseFailureReason;
  /** Landmarks for this view only, in this photo's own normalised coordinates. Null when none could be read. */
  landmarks: LandmarkPoint[] | null;
  /** Landmark-based quality checks. Null when no usable landmark list existed to run them on. */
  assessment: CaptureQualityAssessment | null;
  /** How many of the landmarks required for this view were reliably visible. */
  required: { total: number; reliable: number } | null;
  /** False whenever any quality check (lighting, sharpness, stillness) could not be evaluated. */
  qualityComplete: boolean;
  /** One-line, user-facing result. */
  headline: string;
  /** What was found (problems and borderline items), failures first. Empty when nothing needs saying. */
  details: string[];
  /** What the person can do about it. */
  advice: string[];
}

function failed(view: ScanView, reason: PoseFailureReason, headline: string, advice: string[]): PoseDetectionOutcome {
  return {
    view,
    status: 'failed',
    failureReason: reason,
    landmarks: null,
    assessment: null,
    required: null,
    qualityComplete: false,
    headline,
    details: [],
    advice,
  };
}

export function assessPoseDetection(view: ScanView, adapted: PoseAdaptResult): PoseDetectionOutcome {
  if (!adapted.ok) {
    if (adapted.reason === 'no_pose') {
      return failed(view, 'no_pose', 'No body was detected in this photo', [
        'Stand fully in view of the camera, in good light, against a plain background, and retake the photo.',
      ]);
    }
    return failed(view, 'malformed_result', 'The pose result could not be read', [
      'Try the analysis again. If it keeps happening, retake the photo.',
    ]);
  }

  const { landmarks } = adapted;
  const minVisibility = DEFAULT_CAPTURE_QUALITY_CONFIG.minLandmarkVisibility;
  const reads = selectRequiredReads(landmarks, view, minVisibility);
  const total = reads.length;
  const reliableReads = reads.filter((r) => r.read.status === 'ok');
  const reliable = reliableReads.length;
  const required = { total, reliable };

  // No brightness / sharpness / motion are passed: those checks report `not_evaluated`.
  const assessment = assessCaptureQuality({ view, landmarks });
  const report = toCaptureQualityReport(assessment);
  const base = {
    view,
    landmarks,
    assessment,
    required,
    qualityComplete: assessment.complete,
    details: report.issues,
    advice: assessment.feedback,
  };

  if (reliable < Math.ceil(total * MIN_RELIABLE_FRACTION_FOR_PARTIAL)) {
    return {
      ...base,
      status: 'failed',
      failureReason: 'too_few_landmarks',
      headline: 'Not enough of your body could be located',
    };
  }

  const ys = reliableReads.map((r) => r.read.point!.y);
  if (ys.length >= 2 && Math.max(...ys) - Math.min(...ys) < MIN_POSE_VERTICAL_SPAN) {
    return {
      ...base,
      status: 'failed',
      failureReason: 'degenerate_pose',
      headline: 'The detected pose does not look like a standing body',
      advice: ['Stand upright facing the camera with your whole body in view, then retake the photo.', ...assessment.feedback],
    };
  }

  const anyCheckFailed = assessment.checks.some((c) => c.status === 'fail');
  if (reliable === total && !anyCheckFailed) {
    return { ...base, status: 'usable', headline: 'Body pose detected' };
  }

  return {
    ...base,
    status: 'partial',
    headline: reliable < total ? 'Body pose only partly detected' : 'Body pose detected, but the framing needs adjusting',
  };
}
