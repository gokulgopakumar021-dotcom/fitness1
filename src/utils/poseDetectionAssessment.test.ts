import { describe, expect, it } from 'vitest';
import type { LandmarkPoint } from '../types/bodyScan';
import { MIN_POSE_VERTICAL_SPAN, MIN_RELIABLE_FRACTION_FOR_PARTIAL, assessPoseDetection } from './poseDetectionAssessment';
import { POSE_LANDMARK } from './poseLandmarks';
import type { PoseAdaptResult } from './poseResultAdapter';
import { makeFrontPose, makeSidePose } from './syntheticPose.testutil';

// All landmarks below are SYNTHETIC (see syntheticPose.testutil.ts). They exercise the rules only.
const ok = (landmarks: LandmarkPoint[]): PoseAdaptResult => ({ ok: true, landmarks });

describe('assessPoseDetection: usable', () => {
  it('accepts a complete, clear front pose and keeps the landmarks for this view', () => {
    const lm = makeFrontPose();
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('usable');
    expect(o.view).toBe('front');
    expect(o.landmarks).toBe(lm);
    expect(o.required).toEqual({ total: 9, reliable: 9 });
    expect(o.failureReason).toBeUndefined();
  });

  it('accepts a side pose when ONE complete side chain is visible', () => {
    const o = assessPoseDetection('side', ok(makeSidePose()));
    expect(o.status).toBe('usable');
    expect(o.required).toEqual({ total: 5, reliable: 5 });
  });

  it('still accepts a pose with borderline-visibility warnings, and reports them', () => {
    const o = assessPoseDetection('front', ok(makeFrontPose({}, 0.6)));
    expect(o.status).toBe('usable');
    expect(o.assessment?.checks.find((c) => c.id === 'landmarks_visible')?.status).toBe('warning');
    expect(o.details.join(' ')).toMatch(/borderline/i);
  });
});

describe('assessPoseDetection: unevaluated checks are neither failures nor passes', () => {
  it('never supplies brightness, sharpness or motion, so those stay not_evaluated and the result is incomplete', () => {
    const o = assessPoseDetection('front', ok(makeFrontPose()));
    const byId = (id: string) => o.assessment?.checks.find((c) => c.id === id);
    for (const id of ['brightness', 'sharpness', 'stillness']) {
      expect(byId(id)?.status).toBe('not_evaluated');
      expect(byId(id)?.value).toBeUndefined(); // no number was invented
    }
    expect(o.assessment?.notEvaluated).toEqual(['brightness', 'sharpness', 'stillness']);
    expect(o.qualityComplete).toBe(false);
    expect(o.status).toBe('usable'); // not downgraded to a failure just because they were not evaluated
  });

  it('does not count not_evaluated checks as problems in the details', () => {
    const o = assessPoseDetection('front', ok(makeFrontPose()));
    expect(o.details).toEqual([]);
  });
});

describe('assessPoseDetection: partial', () => {
  it('is partial when a leg is cut off at the bottom edge but most points are reliable', () => {
    const lm = makeFrontPose({ leftAnkle: { y: 1.05, visibility: 0.2 }, rightAnkle: { y: 1.05, visibility: 0.2 } });
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('partial');
    expect(o.required).toEqual({ total: 9, reliable: 7 });
    expect(o.headline).toBe('Body pose only partly detected');
    expect(o.advice.join(' ')).toMatch(/whole body|in view/i);
  });

  it('is partial when every landmark is reliable but the person is too small in frame', () => {
    const lm = makeFrontPose({
      nose: { y: 0.35 },
      leftShoulder: { y: 0.4 },
      rightShoulder: { y: 0.4 },
      leftHip: { y: 0.55 },
      rightHip: { y: 0.55 },
      leftKnee: { y: 0.65 },
      rightKnee: { y: 0.65 },
      leftAnkle: { y: 0.72 },
      rightAnkle: { y: 0.72 },
    });
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('partial');
    expect(o.required).toEqual({ total: 9, reliable: 9 });
    expect(o.headline).toBe('Body pose detected, but the framing needs adjusting');
  });

  it('is partial when a joint touches the frame edge even though it is clearly visible', () => {
    const o = assessPoseDetection('front', ok(makeFrontPose({ rightAnkle: { x: 0.003 } })));
    expect(o.status).toBe('partial');
    expect(o.assessment?.checks.find((c) => c.id === 'in_frame')?.status).toBe('fail');
  });

  it('is partial when the person is well off-centre', () => {
    const shift = (x: number) => x + 0.3;
    const lm = makeFrontPose({
      nose: { x: shift(0.5) },
      leftShoulder: { x: shift(0.6) },
      rightShoulder: { x: shift(0.4) },
      leftHip: { x: shift(0.57) },
      rightHip: { x: shift(0.43) },
      leftKnee: { x: shift(0.57) },
      rightKnee: { x: shift(0.43) },
      leftAnkle: { x: shift(0.57) },
      rightAnkle: { x: shift(0.43) },
    });
    expect(assessPoseDetection('front', ok(lm)).status).toBe('partial');
  });
});

describe('assessPoseDetection: failed', () => {
  it('fails with no_pose when the model found nobody, with no landmarks or assessment', () => {
    const o = assessPoseDetection('front', { ok: false, reason: 'no_pose' });
    expect(o).toMatchObject({ status: 'failed', failureReason: 'no_pose', landmarks: null, assessment: null, required: null });
    expect(o.qualityComplete).toBe(false);
    expect(o.headline).toMatch(/no body/i);
  });

  it('fails with malformed_result when the inference output could not be read', () => {
    const o = assessPoseDetection('side', { ok: false, reason: 'malformed' });
    expect(o).toMatchObject({ status: 'failed', failureReason: 'malformed_result', landmarks: null, view: 'side' });
  });

  it('fails when fewer than half of the required landmarks are reliable (front: 4 of 9)', () => {
    const low = { visibility: 0.1 };
    const lm = makeFrontPose({
      leftHip: low,
      rightHip: low,
      leftKnee: low,
      rightKnee: low,
      leftAnkle: low,
    });
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('failed');
    expect(o.failureReason).toBe('too_few_landmarks');
    expect(o.required).toEqual({ total: 9, reliable: 4 });
    expect(o.landmarks).toBe(lm); // the model did return landmarks; they are kept, just not accepted
  });

  it('is partial, not failed, at exactly half rounded up (front: 5 of 9)', () => {
    const low = { visibility: 0.1 };
    const o = assessPoseDetection('front', ok(makeFrontPose({ leftKnee: low, rightKnee: low, leftAnkle: low, rightAnkle: low })));
    expect(o.required).toEqual({ total: 9, reliable: 5 });
    expect(o.status).toBe('partial');
    expect(MIN_RELIABLE_FRACTION_FOR_PARTIAL).toBe(0.5);
  });

  it('fails on a landmark list the model reported with no usable visibility at all', () => {
    const lm = makeFrontPose().map((p) => ({ x: p.x, y: p.y })); // visibility missing everywhere
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('failed');
    expect(o.required).toEqual({ total: 9, reliable: 0 });
  });

  it('fails a collapsed pose where every point sits at (almost) the same height', () => {
    const lm = makeFrontPose();
    for (const i of Object.values(POSE_LANDMARK)) lm[i] = { x: 0.2 + (i % 5) * 0.1, y: 0.5, visibility: 0.99 };
    const o = assessPoseDetection('front', ok(lm));
    expect(o.status).toBe('failed');
    expect(o.failureReason).toBe('degenerate_pose');
    expect(MIN_POSE_VERTICAL_SPAN).toBeGreaterThan(0);
  });

  it('fails when head and feet are inverted by being squashed together rather than calling it usable', () => {
    const lm = makeFrontPose({ nose: { y: 0.9 }, leftAnkle: { y: 0.1 }, rightAnkle: { y: 0.1 } });
    expect(assessPoseDetection('front', ok(lm)).status).not.toBe('usable');
  });
});

describe('assessPoseDetection: front and side are assessed independently', () => {
  it('requires different landmarks per view for the same landmark list', () => {
    // Side pose: right chain is low-visibility. Judged as FRONT it is missing four required points; as SIDE it is complete.
    const lm = makeSidePose();
    const asFront = assessPoseDetection('front', ok(lm));
    const asSide = assessPoseDetection('side', ok(lm));
    expect(asFront.required).toEqual({ total: 9, reliable: 5 });
    expect(asFront.status).toBe('partial');
    expect(asSide.required).toEqual({ total: 5, reliable: 5 });
    expect(asSide.status).toBe('usable');
    expect(asFront.view).toBe('front');
    expect(asSide.view).toBe('side');
  });

  it('does not share or mutate landmark data between calls', () => {
    const front = makeFrontPose();
    const side = makeSidePose();
    const before = JSON.stringify([front, side]);
    const a = assessPoseDetection('front', ok(front));
    const b = assessPoseDetection('side', ok(side));
    expect(JSON.stringify([front, side])).toBe(before);
    expect(a.landmarks).toBe(front);
    expect(b.landmarks).toBe(side);
    expect(a.landmarks).not.toBe(b.landmarks);
  });
});

// Boundary behaviour of the two PROVISIONAL Phase 2C rules. These tests pin what the rules do today;
// they do not show the values are right. Calibration needs real photos (see docs/body-scan-pose-model.md).
describe('assessPoseDetection: provisional rule boundaries', () => {
  const low = { visibility: 0.1 };

  it('treats a landmark at exactly the minimum visibility (0.5) as reliable, and just below it as not', () => {
    const atMin = assessPoseDetection('front', ok(makeFrontPose({}, 0.5)));
    expect(atMin.required).toEqual({ total: 9, reliable: 9 });
    const below = assessPoseDetection('front', ok(makeFrontPose({}, 0.49)));
    expect(below.required).toEqual({ total: 9, reliable: 0 });
    expect(below.status).toBe('failed');
  });

  it('side view: 3 of 5 reliable is partial, 2 of 5 is failed (half rounded up)', () => {
    const three = assessPoseDetection('side', ok(makeSidePose({ leftKnee: low, leftAnkle: low })));
    expect(three.required).toEqual({ total: 5, reliable: 3 });
    expect(three.status).toBe('partial');
    const two = assessPoseDetection('side', ok(makeSidePose({ leftHip: low, leftKnee: low, leftAnkle: low })));
    expect(two.required).toEqual({ total: 5, reliable: 2 });
    expect(two.status).toBe('failed');
    expect(two.failureReason).toBe('too_few_landmarks');
  });

  it('the collapsed-pose rule uses the vertical span of the reliable points, in image-height units', () => {
    const flatten = (span: number) => {
      const lm = makeFrontPose();
      for (const i of Object.values(POSE_LANDMARK)) lm[i] = { x: 0.2 + (i % 5) * 0.1, y: 0.5, visibility: 0.99 };
      lm[POSE_LANDMARK.leftAnkle] = { x: 0.57, y: 0.5 + span, visibility: 0.99 };
      return assessPoseDetection('front', ok(lm));
    };
    expect(flatten(MIN_POSE_VERTICAL_SPAN * 0.8).failureReason).toBe('degenerate_pose'); // clearly below the span
    expect(flatten(MIN_POSE_VERTICAL_SPAN * 1.2).failureReason).not.toBe('degenerate_pose'); // clearly above it
  });

  it('ignores unreliable points when measuring the span, so one wild low-visibility point cannot hide a collapse', () => {
    const lm = makeFrontPose();
    for (const i of Object.values(POSE_LANDMARK)) lm[i] = { x: 0.2 + (i % 5) * 0.1, y: 0.5, visibility: 0.99 };
    lm[POSE_LANDMARK.rightAnkle] = { x: 0.43, y: 0.95, visibility: 0.2 }; // far away but not reliable
    const o = assessPoseDetection('front', ok(lm));
    expect(o.required).toEqual({ total: 9, reliable: 8 });
    expect(o.failureReason).toBe('degenerate_pose');
  });

  it('a result with unusable (non-finite) coordinates is malformed upstream and never reaches the rules', () => {
    const o = assessPoseDetection('front', { ok: false, reason: 'malformed' });
    expect(o.status).toBe('failed');
    expect(o.failureReason).toBe('malformed_result');
    expect(o.landmarks).toBeNull();
  });
});
