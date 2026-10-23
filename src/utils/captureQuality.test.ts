import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPTURE_QUALITY_CONFIG,
  assessCaptureQuality,
  measureLandmarkMotion,
  resolveCaptureQualityConfig,
  toCaptureQualityReport,
  type CaptureQualityAssessment,
  type QualityCheckId,
} from './captureQuality';
import { makeFrontPose, makeSidePose } from './syntheticPose.testutil';
import type { LandmarkPoint } from '../types/bodyScan';

// All landmark fixtures are hand-placed SYNTHETIC numbers, not camera or pose-model output.
// Brightness / sharpness / motion values below are likewise just numbers passed in; nothing here analyses an image.

const goodInputs = { brightness: 0.5, sharpness: 200, motion: 0.002 };
const check = (a: CaptureQualityAssessment, id: QualityCheckId) => a.checks.find((c) => c.id === id)!;

/** Shift every landmark x by dx. */
const shiftX = (pose: LandmarkPoint[], dx: number) => pose.map((p) => ({ ...p, x: p.x + dx }));

describe('assessCaptureQuality: all inputs good', () => {
  it('passes, is complete, and maps to a "good" stored report with no issues', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), ...goodInputs });
    expect(a.status).toBe('pass');
    expect(a.complete).toBe(true);
    expect(a.notEvaluated).toEqual([]);
    expect(a.feedback).toEqual([]);
    expect(a.checks).toHaveLength(7);
    expect(toCaptureQualityReport(a)).toEqual({ level: 'good', issues: [] });
  });
});

describe('landmark visibility', () => {
  it('fails when a required landmark has low confidence, naming it', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ leftAnkle: { visibility: 0.3 } }), ...goodInputs });
    expect(a.status).toBe('fail');
    expect(check(a, 'landmarks_visible').status).toBe('fail');
    expect(check(a, 'landmarks_visible').message).toContain('Left ankle');
    expect(a.feedback.length).toBeGreaterThan(0);
  });

  it('warns (not fails) for borderline confidence between min and good thresholds', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ nose: { visibility: 0.6 } }), ...goodInputs });
    expect(check(a, 'landmarks_visible').status).toBe('warning');
    expect(a.status).toBe('warning');
    expect(toCaptureQualityReport(a).level).toBe('fair');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', []],
  ])('fails with a clear message when landmarks are %s', (_n, lm) => {
    const a = assessCaptureQuality({ view: 'front', landmarks: lm as never, ...goodInputs });
    expect(a.status).toBe('fail');
    expect(check(a, 'landmarks_visible').message).toMatch(/no body landmarks/i);
    expect(check(a, 'in_frame').status).toBe('not_evaluated');
  });

  it('fails when the landmark array is too short to contain the required indices', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose().slice(0, 12), ...goodInputs });
    expect(check(a, 'landmarks_visible').status).toBe('fail');
  });

  it('fails without throwing on NaN / Infinity coordinates and missing visibility', () => {
    const nan = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ nose: { x: Number.NaN } }), ...goodInputs });
    expect(check(nan, 'landmarks_visible').status).toBe('fail');
    const inf = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ nose: { y: Infinity } }), ...goodInputs });
    expect(check(inf, 'landmarks_visible').status).toBe('fail');
    const noVis = makeFrontPose();
    delete noVis[0].visibility;
    expect(check(assessCaptureQuality({ view: 'front', landmarks: noVis, ...goodInputs }), 'landmarks_visible').status).toBe('fail');
  });

  it('side view needs only ONE complete side: passes with the right chain hidden', () => {
    const a = assessCaptureQuality({ view: 'side', landmarks: makeSidePose(), ...goodInputs });
    expect(check(a, 'landmarks_visible').status).toBe('pass');
    expect(a.status).toBe('pass');
  });

  it('side view fails if each side is missing a different landmark', () => {
    const pose = makeSidePose({ leftAnkle: { visibility: 0.1 }, rightShoulder: { visibility: 0.1 } });
    expect(check(assessCaptureQuality({ view: 'side', landmarks: pose, ...goodInputs }), 'landmarks_visible').status).toBe('fail');
  });
});

describe('in-frame check', () => {
  it('fails when feet are cut off at the bottom and advises stepping back', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ leftAnkle: { y: 1.02 }, rightAnkle: { y: 1.02 } }), ...goodInputs });
    const c = check(a, 'in_frame');
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/ankle/i);
    expect(c.advice).toMatch(/feet/i);
  });

  it('fails when the head touches the top edge', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ nose: { y: 0.002 } }), ...goodInputs });
    expect(check(a, 'in_frame').status).toBe('fail');
    expect(check(a, 'in_frame').advice).toMatch(/head/i);
  });

  it('respects a configurable margin', () => {
    const pose = makeFrontPose({ nose: { y: 0.05 } });
    expect(check(assessCaptureQuality({ view: 'front', landmarks: pose, ...goodInputs }), 'in_frame').status).toBe('pass');
    expect(check(assessCaptureQuality({ view: 'front', landmarks: pose, ...goodInputs }, { frameMargin: 0.1 }), 'in_frame').status).toBe('fail');
  });
});

describe('centring', () => {
  it('passes when centred, warns when moderately off-centre, fails when far off', () => {
    const base = makeFrontPose();
    expect(check(assessCaptureQuality({ view: 'front', landmarks: base, ...goodInputs }), 'centered').status).toBe('pass');
    const warn = check(assessCaptureQuality({ view: 'front', landmarks: shiftX(base, 0.2), ...goodInputs }), 'centered');
    expect(warn.status).toBe('warning');
    expect(warn.value).toBeCloseTo(0.2, 6);
    expect(check(assessCaptureQuality({ view: 'front', landmarks: shiftX(base, 0.3), ...goodInputs }), 'centered').status).toBe('fail');
    expect(check(assessCaptureQuality({ view: 'front', landmarks: shiftX(base, -0.3), ...goodInputs }), 'centered').status).toBe('fail');
  });

  it('is not evaluated when fewer than two landmarks are reliable', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({}, 0.1), ...goodInputs });
    expect(check(a, 'centered').status).toBe('not_evaluated');
  });
});

describe('body-height fraction (nose to lowest ankle)', () => {
  const withSpan = (top: number, bottom: number) =>
    makeFrontPose({ nose: { y: top }, leftAnkle: { y: bottom }, rightAnkle: { y: bottom }, leftShoulder: { y: top + 0.05 }, rightShoulder: { y: top + 0.05 }, leftHip: { y: (top + bottom) / 2 }, rightHip: { y: (top + bottom) / 2 }, leftKnee: { y: bottom - 0.05 }, rightKnee: { y: bottom - 0.05 } });

  it('passes inside the limits (0.80 with defaults)', () => {
    const c = check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), ...goodInputs }), 'body_height_fraction');
    expect(c.status).toBe('pass');
    expect(c.value).toBeCloseTo(0.8, 6);
  });

  it('warns when a bit small (0.50) and fails when far away (0.30)', () => {
    expect(check(assessCaptureQuality({ view: 'front', landmarks: withSpan(0.25, 0.75), ...goodInputs }), 'body_height_fraction').status).toBe('warning');
    const far = check(assessCaptureQuality({ view: 'front', landmarks: withSpan(0.35, 0.65), ...goodInputs }), 'body_height_fraction');
    expect(far.status).toBe('fail');
    expect(far.advice).toMatch(/closer/i);
  });

  it('warns when nearly filling the frame (0.95)', () => {
    const c = check(assessCaptureQuality({ view: 'front', landmarks: withSpan(0.03, 0.98), ...goodInputs }), 'body_height_fraction');
    expect(c.status).toBe('warning');
    expect(c.value).toBeCloseTo(0.95, 6);
  });

  it('limits are configurable', () => {
    const cfg = { heightFractionMax: 0.7, heightFractionHardMax: 0.75 };
    expect(check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), ...goodInputs }, { heightFractionMax: 0.7 }), 'body_height_fraction').status).toBe('warning');
    const tooClose = check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), ...goodInputs }, cfg), 'body_height_fraction');
    expect(tooClose.status).toBe('fail');
    expect(tooClose.advice).toMatch(/step back/i);
  });

  it('fails for an inverted pose (feet above head) and is not evaluated without a reliable ankle', () => {
    expect(check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ nose: { y: 0.95 } }), ...goodInputs }), 'body_height_fraction').status).toBe('fail');
    expect(
      check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose({ leftAnkle: { visibility: 0.1 }, rightAnkle: { visibility: 0.1 } }), ...goodInputs }), 'body_height_fraction').status
    ).toBe('not_evaluated');
  });
});

describe('brightness (caller-supplied mean luminance 0..1)', () => {
  const run = (brightness: number | null | undefined) => check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness }), 'brightness');
  it.each([
    [0.05, 'fail'],
    [0.2, 'warning'],
    [0.5, 'pass'],
    [0.9, 'warning'],
    [0.97, 'fail'],
  ])('%s => %s', (v, expected) => {
    expect(run(v).status).toBe(expected);
  });
  it('is not evaluated (never a pass) when missing', () => {
    expect(run(undefined).status).toBe('not_evaluated');
    expect(run(null).status).toBe('not_evaluated');
    expect(run(undefined).message).toMatch(/not supplied/i);
  });
  it.each([Number.NaN, Infinity, -0.1, 1.5, '0.5' as unknown as number])('treats invalid value %s as not evaluated', (v) => {
    const c = run(v);
    expect(c.status).toBe('not_evaluated');
    expect(c.message).toMatch(/invalid/i);
  });
});

describe('sharpness (caller-supplied, higher = sharper)', () => {
  const run = (sharpness: number | null | undefined) => check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), sharpness }), 'sharpness');
  it.each([
    [20, 'fail'],
    [70, 'warning'],
    [150, 'pass'],
  ])('%s => %s', (v, expected) => {
    expect(run(v).status).toBe(expected);
  });
  it('is not evaluated when missing or invalid', () => {
    expect(run(undefined).status).toBe('not_evaluated');
    for (const bad of [Number.NaN, -5, Infinity]) expect(run(bad).status).toBe('not_evaluated');
  });
  it('thresholds are configurable for other sharpness metrics', () => {
    const c = check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), sharpness: 0.3 }, { sharpnessFailBelow: 0.1, sharpnessWarnBelow: 0.5 }), 'sharpness');
    expect(c.status).toBe('warning');
  });
});

describe('stillness (caller-supplied motion, fractions of image height)', () => {
  const run = (motion: number | null | undefined) => check(assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), motion }), 'stillness');
  it.each([
    [0.002, 'pass'],
    [0.015, 'warning'],
    [0.04, 'fail'],
  ])('%s => %s', (v, expected) => {
    expect(run(v).status).toBe(expected);
  });
  it('is not evaluated when missing or invalid', () => {
    expect(run(undefined).status).toBe('not_evaluated');
    for (const bad of [Number.NaN, -1, Infinity]) expect(run(bad).status).toBe('not_evaluated');
  });
});

describe('overall status and partial results', () => {
  it('with no brightness/sharpness/motion: a clean pose is a PARTIAL pass', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose() });
    expect(a.status).toBe('pass');
    expect(a.complete).toBe(false);
    expect(a.notEvaluated).toEqual(['brightness', 'sharpness', 'stillness']);
    // not-evaluated checks are not reported as issues in the stored report
    expect(toCaptureQualityReport(a).issues).toEqual([]);
  });

  it('a single failure dominates warnings and passes, and failures are listed first in issues/feedback', () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.2 /* warning */, sharpness: 10 /* fail */, motion: 0.002 });
    expect(a.status).toBe('fail');
    const report = toCaptureQualityReport(a);
    expect(report.level).toBe('poor');
    expect(report.issues[0]).toMatch(/blurry/i);
    expect(report.issues[1]).toMatch(/dark/i);
    expect(a.feedback[0]).toMatch(/steady|lens/i);
  });

  it('does not mutate frozen input', () => {
    const pose = Object.freeze(makeFrontPose().map((p) => Object.freeze({ ...p })));
    expect(() => assessCaptureQuality({ view: 'front', landmarks: pose as never, ...goodInputs })).not.toThrow();
  });

  it('treats an unrecognised view as front rather than throwing', () => {
    expect(() => assessCaptureQuality({ view: 'back' as never, landmarks: makeFrontPose(), ...goodInputs })).not.toThrow();
  });
});

describe('config validation', () => {
  it('defaults resolve unchanged and overrides with undefined values are ignored', () => {
    expect(resolveCaptureQualityConfig()).toEqual(DEFAULT_CAPTURE_QUALITY_CONFIG);
    expect(resolveCaptureQualityConfig({ frameMargin: undefined })).toEqual(DEFAULT_CAPTURE_QUALITY_CONFIG);
  });
  it('throws RangeError for non-finite or inconsistent thresholds', () => {
    expect(() => resolveCaptureQualityConfig({ frameMargin: Number.NaN })).toThrow(RangeError);
    expect(() => resolveCaptureQualityConfig({ minLandmarkVisibility: 0.9 })).toThrow(RangeError); // > good (0.7)
    expect(() => resolveCaptureQualityConfig({ heightFractionMin: 0.95 })).toThrow(RangeError); // > max
    expect(() => resolveCaptureQualityConfig({ brightnessWarnLow: 0.05 })).toThrow(RangeError); // < failLow
    expect(() => resolveCaptureQualityConfig({ sharpnessFailBelow: 500 })).toThrow(RangeError);
    expect(() => resolveCaptureQualityConfig({ motionWarnAbove: 0.5 })).toThrow(RangeError);
    expect(() => assessCaptureQuality({ view: 'front' }, { centerOffsetWarn: 0.4 })).toThrow(RangeError);
  });
});

describe('measureLandmarkMotion (derives stillness from supplied landmark frames)', () => {
  it('is 0 for identical frames', () => {
    expect(measureLandmarkMotion([makeFrontPose(), makeFrontPose(), makeFrontPose()], 1)).toBeCloseTo(0, 10);
  });

  it('matches a known value: every tracked landmark moves 0.02 in y between two frames => RMS spread 0.01', () => {
    const moved = makeFrontPose().map((p) => ({ ...p, y: p.y + 0.02 }));
    expect(measureLandmarkMotion([makeFrontPose(), moved], 1)).toBeCloseTo(0.01, 8);
  });

  it('scales x by the aspect ratio: 0.02 in x with aspect 0.5 => 0.005', () => {
    const moved = makeFrontPose().map((p) => ({ ...p, x: p.x + 0.02 }));
    expect(measureLandmarkMotion([makeFrontPose(), moved], 0.5)).toBeCloseTo(0.005, 8);
  });

  it('returns null when it cannot be computed (never 0, which would look perfectly still)', () => {
    expect(measureLandmarkMotion([], 1)).toBeNull();
    expect(measureLandmarkMotion([makeFrontPose()], 1)).toBeNull();
    expect(measureLandmarkMotion(undefined as never, 1)).toBeNull();
    expect(measureLandmarkMotion([makeFrontPose(), makeFrontPose()], 0)).toBeNull();
    expect(measureLandmarkMotion([makeFrontPose(), makeFrontPose()], Number.NaN)).toBeNull();
    expect(measureLandmarkMotion([[], []], 1)).toBeNull();
    expect(measureLandmarkMotion([makeFrontPose(), null as never], 1)).toBeNull();
  });

  it('ignores frames where a landmark is non-finite and uses the rest', () => {
    const bad = makeFrontPose({ leftShoulder: { x: Number.NaN } });
    const v = measureLandmarkMotion([makeFrontPose(), bad, makeFrontPose()], 1);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v as number)).toBe(true);
  });

  it('feeds the stillness check end to end', () => {
    const moved = makeFrontPose().map((p) => ({ ...p, y: p.y + 0.06 })); // spread 0.03 > fail 0.025
    const motion = measureLandmarkMotion([makeFrontPose(), moved], 1);
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.5, sharpness: 200, motion });
    expect(check(a, 'stillness').status).toBe('fail');
  });
});
