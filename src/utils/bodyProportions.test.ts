import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_VISIBILITY,
  NOSE_TO_ANKLE_FRACTION_OF_HEIGHT,
  calculateApproxTorsoLengthCm,
  calculateBodyMetrics,
  calculateHipTilt,
  calculateShoulderHipWidthRatio,
  calculateShoulderTilt,
  calculateTorsoLean,
  calculateTorsoToBodyHeightRatio,
  confidenceFromVisibility,
  type BodyMetricOptions,
  type MetricResult,
} from './bodyProportions';
import { makeFrontPose, makeSidePose } from './syntheticPose.testutil';

// All fixtures here are hand-placed SYNTHETIC landmarks, not camera or model output.
const front: BodyMetricOptions = { view: 'front', aspectRatio: 1 };
const side: BodyMetricOptions = { view: 'side', aspectRatio: 1 };

function value(r: MetricResult): number {
  if (r.status !== 'ok') throw new Error(`expected ok, got unavailable: ${r.reason} (${r.detail})`);
  return r.measurement.value;
}
function reason(r: MetricResult): string {
  if (r.status !== 'unavailable') throw new Error('expected unavailable');
  return r.reason;
}

describe('shoulder and hip tilt', () => {
  it('is 0 degrees for level shoulders and hips', () => {
    expect(value(calculateShoulderTilt(makeFrontPose(), front))).toBeCloseTo(0, 6);
    expect(value(calculateHipTilt(makeFrontPose(), front))).toBeCloseTo(0, 6);
  });

  it('matches a known angle: dx 0.2, dy 0.05 => -14.0362 deg (right-of-image joint higher)', () => {
    const pose = makeFrontPose({ rightShoulder: { y: 0.3 } }); // image-left joint lower, image-right joint higher
    expect(value(calculateShoulderTilt(pose, front))).toBeCloseTo(-14.0362, 3);
  });

  it('matches an exact 45 degree hip tilt and flips sign when mirrored', () => {
    const pose = makeFrontPose({ leftHip: { x: 0.6, y: 0.6 }, rightHip: { x: 0.4, y: 0.4 } });
    expect(value(calculateHipTilt(pose, front))).toBeCloseTo(45, 6);
    const mirrored = makeFrontPose({ leftHip: { x: 0.4, y: 0.6 }, rightHip: { x: 0.6, y: 0.4 } });
    expect(value(calculateHipTilt(mirrored, front))).toBeCloseTo(-45, 6);
  });

  it('uses the aspect ratio: x is scaled by width/height (dx 0.2 -> 0.1 gives atan(0.5) = 26.565 deg)', () => {
    const pose = makeFrontPose({ rightShoulder: { y: 0.2 } }); // image-left joint higher by 0.05
    expect(value(calculateShoulderTilt(pose, { view: 'front', aspectRatio: 0.5 }))).toBeCloseTo(26.5651, 3);
    expect(value(calculateShoulderTilt(pose, front))).toBeCloseTo(14.0362, 3);
  });

  it('reports landmark provenance, degrees and confidence', () => {
    const r = calculateShoulderTilt(makeFrontPose(), front);
    expect(r.status === 'ok' && r.measurement).toMatchObject({ key: 'shoulder_tilt', unit: 'deg', source: 'landmark', confidence: 'high' });
  });

  it('is not applicable to side view', () => {
    expect(reason(calculateShoulderTilt(makeFrontPose(), side))).toBe('not_applicable_to_view');
    expect(reason(calculateHipTilt(makeFrontPose(), side))).toBe('not_applicable_to_view');
  });

  it('is unavailable when the two landmarks collapse horizontally', () => {
    const pose = makeFrontPose({ leftShoulder: { x: 0.5 }, rightShoulder: { x: 0.51 } });
    expect(reason(calculateShoulderTilt(pose, front))).toBe('degenerate_geometry');
  });
});

describe('shoulder-to-hip width ratio', () => {
  it('equals 0.20 / 0.14 for the synthetic pose', () => {
    const r = calculateShoulderHipWidthRatio(makeFrontPose(), front);
    expect(value(r)).toBeCloseTo(0.2 / 0.14, 6);
    expect(r.status === 'ok' && r.measurement).toMatchObject({ unit: 'ratio', source: 'landmark' });
  });

  it('is independent of aspect ratio for purely horizontal spacings', () => {
    expect(value(calculateShoulderHipWidthRatio(makeFrontPose(), { view: 'front', aspectRatio: 0.5 }))).toBeCloseTo(0.2 / 0.14, 6);
  });

  it('is unavailable (not NaN/Infinity) when hip landmarks coincide', () => {
    const pose = makeFrontPose({ leftHip: { x: 0.5, y: 0.55 }, rightHip: { x: 0.5, y: 0.55 } });
    expect(reason(calculateShoulderHipWidthRatio(pose, front))).toBe('degenerate_geometry');
  });

  it('flags implausible ratios with low confidence and a warning note', () => {
    const pose = makeFrontPose({ leftHip: { x: 0.52 }, rightHip: { x: 0.48 } }); // 0.2 / 0.04 = 5
    const r = calculateShoulderHipWidthRatio(pose, front);
    expect(r.status === 'ok' && r.measurement.confidence).toBe('low');
    expect(r.status === 'ok' && r.measurement.note).toMatch(/unusual/i);
  });

  it('is not applicable to side view', () => {
    expect(reason(calculateShoulderHipWidthRatio(makeFrontPose(), side))).toBe('not_applicable_to_view');
  });
});

describe('torso to body height ratio', () => {
  it('equals 0.30 / 0.80 = 0.375 in front view and documents its landmark definitions', () => {
    const r = calculateTorsoToBodyHeightRatio(makeFrontPose(), front);
    expect(value(r)).toBeCloseTo(0.375, 6);
    expect(r.status === 'ok' && r.measurement.note).toMatch(/nose to the ankle/i);
  });

  it('uses aspect-corrected distances when the body is not vertical-only', () => {
    // shoulders shifted +0.1 in x: torso = hypot(0.1*aspect, 0.3)
    const pose = makeFrontPose({ leftShoulder: { x: 0.7 }, rightShoulder: { x: 0.5 } });
    expect(value(calculateTorsoToBodyHeightRatio(pose, front))).toBeCloseTo(Math.hypot(0.1, 0.3) / 0.8, 6);
    expect(value(calculateTorsoToBodyHeightRatio(pose, { view: 'front', aspectRatio: 0.5 }))).toBeCloseTo(Math.hypot(0.05, 0.3) / Math.hypot(0, 0.8), 6);
  });

  it('works from the clearer side in side view and caps confidence at medium', () => {
    const r = calculateTorsoToBodyHeightRatio(makeSidePose(), side);
    expect(value(r)).toBeCloseTo(0.375, 6);
    expect(r.status === 'ok' && r.measurement.confidence).toBe('medium');
  });

  it('uses the right side when only the right chain is visible', () => {
    const pose = makeSidePose({
      leftShoulder: { visibility: 0.1 },
      leftHip: { visibility: 0.1 },
      leftKnee: { visibility: 0.1 },
      leftAnkle: { visibility: 0.1 },
      rightShoulder: { visibility: 0.95 },
      rightHip: { visibility: 0.95 },
      rightKnee: { visibility: 0.95 },
      rightAnkle: { visibility: 0.95 },
    });
    expect(value(calculateTorsoToBodyHeightRatio(pose, side))).toBeCloseTo(0.375, 6);
  });

  it('is unavailable in side view when neither side is fully usable', () => {
    const pose = makeSidePose({ leftAnkle: { visibility: 0.1 } }); // right chain is already low
    expect(reason(calculateTorsoToBodyHeightRatio(pose, side))).toBe('landmark_not_usable');
  });

  it('is unavailable for a non-upright (inverted) pose', () => {
    const pose = makeFrontPose({ nose: { y: 0.95 } });
    expect(reason(calculateTorsoToBodyHeightRatio(pose, front))).toBe('degenerate_geometry');
  });

  it('is unavailable when torso length is zero (shoulders and hips at the same height)', () => {
    const pose = makeFrontPose({ leftHip: { y: 0.25 }, rightHip: { y: 0.25 } });
    const r = calculateTorsoToBodyHeightRatio(pose, front);
    expect(r.status).toBe('unavailable');
  });
});

describe('torso lean', () => {
  it('is 0 for a vertical torso', () => {
    expect(value(calculateTorsoLean(makeFrontPose(), front))).toBeCloseTo(0, 6);
  });

  it('matches a known angle: shoulders 0.1 right of hips over 0.3 height => 18.435 deg', () => {
    const pose = makeFrontPose({ leftShoulder: { x: 0.7 }, rightShoulder: { x: 0.5 } });
    expect(value(calculateTorsoLean(pose, front))).toBeCloseTo(18.4349, 3);
  });

  it('is available in side view from one side', () => {
    const pose = makeSidePose({ leftShoulder: { x: 0.6 } });
    expect(value(calculateTorsoLean(pose, side))).toBeCloseTo(18.4349, 3);
  });
});

describe('approximate torso length in cm', () => {
  it('is torso ratio x (height x documented fraction), labelled approximate with low confidence', () => {
    const r = calculateApproxTorsoLengthCm(makeFrontPose(), { ...front, heightCm: 180 });
    expect(value(r)).toBeCloseTo(0.375 * 180 * NOSE_TO_ANKLE_FRACTION_OF_HEIGHT, 6);
    expect(NOSE_TO_ANKLE_FRACTION_OF_HEIGHT).toBe(0.87);
    expect(r.status === 'ok' && r.measurement).toMatchObject({ unit: 'cm', source: 'calculated', confidence: 'low' });
    expect(r.status === 'ok' && r.measurement.note).toMatch(/approximate/i);
    expect(r.status === 'ok' && r.measurement.note).toMatch(/not a tape measurement/i);
  });

  it('stays low confidence even with perfect landmark visibility', () => {
    const r = calculateApproxTorsoLengthCm(makeFrontPose({}, 1), { ...front, heightCm: 170 });
    expect(r.status === 'ok' && r.measurement.confidence).toBe('low');
  });

  it('requires a height', () => {
    expect(reason(calculateApproxTorsoLengthCm(makeFrontPose(), front))).toBe('height_not_provided');
    expect(reason(calculateApproxTorsoLengthCm(makeFrontPose(), { ...front, heightCm: null }))).toBe('height_not_provided');
  });

  it.each([0, -5, 99, 251, 1000, Number.NaN, Infinity, '180' as unknown as number])('rejects invalid height %s', (h) => {
    expect(reason(calculateApproxTorsoLengthCm(makeFrontPose(), { ...front, heightCm: h }))).toBe('invalid_height');
  });

  it('accepts the boundary heights', () => {
    expect(calculateApproxTorsoLengthCm(makeFrontPose(), { ...front, heightCm: 100 }).status).toBe('ok');
    expect(calculateApproxTorsoLengthCm(makeFrontPose(), { ...front, heightCm: 250 }).status).toBe('ok');
  });

  it('is unavailable when the landmarks do not support it, even with a valid height', () => {
    expect(reason(calculateApproxTorsoLengthCm(makeFrontPose({ leftAnkle: { visibility: 0.1 } }), { ...front, heightCm: 180 }))).toBe('landmark_not_usable');
  });
});

describe('landmark validity handling', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty array', []],
    ['too-short array', makeFrontPose().slice(0, 12)],
  ])('%s landmarks => unavailable, no throw', (_n, lm) => {
    const rep = calculateBodyMetrics(lm as never, { ...front, heightCm: 180 });
    expect(rep.measurements).toHaveLength(0);
    expect(rep.unavailable.length).toBe(rep.results.length);
  });

  it('rejects low-confidence landmarks (below default 0.5) and respects a custom threshold', () => {
    const pose = makeFrontPose({ leftShoulder: { visibility: 0.45 } });
    expect(DEFAULT_MIN_VISIBILITY).toBe(0.5);
    expect(reason(calculateShoulderTilt(pose, front))).toBe('landmark_not_usable');
    expect(calculateShoulderTilt(pose, { ...front, minVisibility: 0.4 }).status).toBe('ok');
  });

  it('rejects landmarks with missing or invalid visibility rather than assuming they are visible', () => {
    const noVis = makeFrontPose();
    delete noVis[11].visibility;
    expect(reason(calculateShoulderTilt(noVis, front))).toBe('landmark_not_usable');
    expect(reason(calculateShoulderTilt(makeFrontPose({ leftShoulder: { visibility: 1.5 } }), front))).toBe('landmark_not_usable');
    expect(reason(calculateShoulderTilt(makeFrontPose({ leftShoulder: { visibility: Number.NaN } }), front))).toBe('landmark_not_usable');
  });

  it.each([Number.NaN, Infinity, -Infinity])('rejects non-finite coordinate %s', (bad) => {
    expect(reason(calculateShoulderTilt(makeFrontPose({ leftShoulder: { x: bad } }), front))).toBe('landmark_not_usable');
    expect(reason(calculateShoulderTilt(makeFrontPose({ leftShoulder: { y: bad } }), front))).toBe('landmark_not_usable');
  });

  it('rejects landmarks outside the 0..1 frame instead of using a guessed position', () => {
    expect(reason(calculateHipTilt(makeFrontPose({ leftHip: { y: 1.2 } }), front))).toBe('landmark_not_usable');
    expect(reason(calculateHipTilt(makeFrontPose({ leftHip: { x: -0.1 } }), front))).toBe('landmark_not_usable');
  });

  it('tolerates sparse arrays and null entries', () => {
    const sparse = makeFrontPose() as unknown[];
    sparse[11] = null;
    delete sparse[12];
    expect(reason(calculateShoulderTilt(sparse as never, front))).toBe('landmark_not_usable');
  });

  it.each([0, -1, Number.NaN, Infinity, 0.01, 50, undefined as unknown as number])('rejects invalid aspect ratio %s', (a) => {
    expect(reason(calculateShoulderTilt(makeFrontPose(), { view: 'front', aspectRatio: a }))).toBe('invalid_options');
    expect(reason(calculateTorsoLean(makeFrontPose(), { view: 'front', aspectRatio: a }))).toBe('invalid_options');
  });

  it('rejects an invalid minVisibility option', () => {
    expect(reason(calculateTorsoLean(makeFrontPose(), { ...front, minVisibility: 2 }))).toBe('invalid_options');
    expect(reason(calculateTorsoLean(makeFrontPose(), { ...front, minVisibility: Number.NaN }))).toBe('invalid_options');
  });

  it('does not mutate its input', () => {
    const pose = Object.freeze(makeFrontPose().map((p) => Object.freeze({ ...p })));
    expect(() => calculateBodyMetrics(pose as never, { ...front, heightCm: 180 })).not.toThrow();
  });
});

describe('confidence from visibility', () => {
  it.each([
    [0.99, 'high'],
    [0.85, 'high'],
    [0.84, 'medium'],
    [0.65, 'medium'],
    [0.64, 'low'],
    [0.5, 'low'],
    [Number.NaN, 'low'],
  ])('%s => %s', (v, expected) => {
    expect(confidenceFromVisibility(v)).toBe(expected);
  });

  it('a metric takes the LOWEST visibility among its landmarks', () => {
    const pose = makeFrontPose({ rightShoulder: { visibility: 0.7 } });
    const r = calculateShoulderTilt(pose, front);
    expect(r.status === 'ok' && r.measurement.confidence).toBe('medium');
  });
});

describe('calculateBodyMetrics', () => {
  it('front view with height returns all six metrics, each with unit, source and confidence', () => {
    const rep = calculateBodyMetrics(makeFrontPose(), { ...front, heightCm: 175 });
    expect(rep.measurements.map((m) => m.key)).toEqual([
      'shoulder_tilt',
      'hip_tilt',
      'shoulder_hip_width_ratio',
      'torso_to_body_height_ratio',
      'torso_lean',
      'approx_torso_length_cm',
    ]);
    for (const m of rep.measurements) {
      expect(['deg', 'ratio', 'cm']).toContain(m.unit);
      expect(['landmark', 'calculated']).toContain(m.source);
      expect(m.confidence).toBeDefined();
      expect(m.note).toBeTruthy();
    }
    expect(rep.unavailable).toHaveLength(0);
  });

  it('front view without height lists the cm value as unavailable instead of inventing one', () => {
    const rep = calculateBodyMetrics(makeFrontPose(), front);
    expect(rep.measurements).toHaveLength(5);
    expect(rep.unavailable).toEqual([expect.objectContaining({ key: 'approx_torso_length_cm', reason: 'height_not_provided' })]);
  });

  it('side view only reports metrics that a side photo supports', () => {
    const rep = calculateBodyMetrics(makeSidePose(), { ...side, heightCm: 175 });
    expect(rep.measurements.map((m) => m.key)).toEqual(['torso_to_body_height_ratio', 'torso_lean', 'approx_torso_length_cm']);
  });

  it('never produces body fat, muscle mass, weight or circumference measurements', () => {
    const keys = [
      ...calculateBodyMetrics(makeFrontPose(), { ...front, heightCm: 175 }).measurements,
      ...calculateBodyMetrics(makeSidePose(), { ...side, heightCm: 175 }).measurements,
    ].map((m) => m.key);
    for (const k of keys) expect(k).not.toMatch(/fat|muscle|weight|circumference|waist|chest|arm|thigh|kg|percent/i);
    for (const m of [...calculateBodyMetrics(makeFrontPose(), { ...front, heightCm: 175 }).measurements]) {
      expect(['kg', '%']).not.toContain(m.unit);
    }
  });

  it('falls back to front for an unrecognised view value instead of throwing', () => {
    const rep = calculateBodyMetrics(makeFrontPose(), { view: 'back' as never, aspectRatio: 1 });
    expect(rep.view).toBe('front');
  });
});
