import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_COUNT, adaptPoseLandmarkerResult } from './poseResultAdapter';

// Hand-made, native-shaped data. Not output from a real model.
const native = (n = POSE_LANDMARK_COUNT, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({ x: i / 100, y: 0.5, z: -0.1, visibility: 0.9, presence: 0.8, ...extra }));

describe('adaptPoseLandmarkerResult', () => {
  it('converts a 33-landmark pose, preserving x, y, z and visibility', () => {
    const r = adaptPoseLandmarkerResult({ landmarks: [native()], worldLandmarks: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.landmarks).toHaveLength(POSE_LANDMARK_COUNT);
    expect(r.landmarks[7]).toEqual({ x: 0.07, y: 0.5, z: -0.1, visibility: 0.9 });
  });

  it('drops MediaPipe-only fields the app contract does not have (presence, world landmarks)', () => {
    const r = adaptPoseLandmarkerResult({ landmarks: [native()], worldLandmarks: [native()] });
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.landmarks[0]).sort()).toEqual(['visibility', 'x', 'y', 'z']);
  });

  it('does not clamp coordinates: out-of-frame joints keep their values', () => {
    const pose = native();
    pose[27] = { x: 0.4, y: 1.08, z: 0, visibility: 0.3, presence: 0.2 };
    pose[28] = { x: -0.05, y: 0.9, z: 0, visibility: 0.6, presence: 0.5 };
    const r = adaptPoseLandmarkerResult({ landmarks: [pose] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.landmarks[27]).toMatchObject({ x: 0.4, y: 1.08, visibility: 0.3 });
    expect(r.landmarks[28]).toMatchObject({ x: -0.05, visibility: 0.6 });
  });

  it('leaves visibility out when the model did not give a usable number, rather than inventing one', () => {
    const pose = native();
    pose[3] = { x: 0.3, y: 0.3, z: 0 } as never;
    pose[4] = { x: 0.3, y: 0.3, z: 0, visibility: Number.NaN } as never;
    pose[5] = { x: 0.3, y: 0.3, z: 0, visibility: '0.9' } as never;
    const r = adaptPoseLandmarkerResult({ landmarks: [pose] });
    if (!r.ok) throw new Error('expected ok');
    for (const i of [3, 4, 5]) expect(r.landmarks[i]).not.toHaveProperty('visibility');
  });

  it('omits a non-finite z instead of passing it on', () => {
    const pose = native();
    pose[9] = { x: 0.3, y: 0.3, z: Number.POSITIVE_INFINITY, visibility: 0.9 } as never;
    const r = adaptPoseLandmarkerResult({ landmarks: [pose] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.landmarks[9]).not.toHaveProperty('z');
  });

  it('returns an independent copy that survives the native result being changed or closed', () => {
    const pose = native();
    const r = adaptPoseLandmarkerResult({ landmarks: [pose] });
    if (!r.ok) throw new Error('expected ok');
    pose[0].x = 99;
    expect(r.landmarks[0].x).toBe(0);
    expect(r.landmarks[0]).not.toBe(pose[0]);
  });

  it('reports no_pose when the model found nobody', () => {
    expect(adaptPoseLandmarkerResult({ landmarks: [] })).toEqual({ ok: false, reason: 'no_pose' });
    expect(adaptPoseLandmarkerResult({ landmarks: [[]] })).toEqual({ ok: false, reason: 'no_pose' });
  });

  it('reads only the first pose', () => {
    const second = native().map((p) => ({ ...p, x: 0.9 }));
    const r = adaptPoseLandmarkerResult({ landmarks: [native(), second] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.landmarks[0].x).toBe(0);
  });

  describe('malformed results are rejected whole, never partially passed on', () => {
    const cases: [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'pose'],
      ['a number', 7],
      ['no landmarks field', {}],
      ['landmarks not an array', { landmarks: 'x' }],
      ['pose not an array', { landmarks: [{}] }],
      ['too few landmarks', { landmarks: [native(32)] }],
      ['too many landmarks', { landmarks: [native(34)] }],
      ['a null landmark', { landmarks: [[...native(32), null]] }],
      ['a primitive landmark', { landmarks: [[...native(32), 5]] }],
      ['a landmark without x', { landmarks: [[...native(32), { y: 0.5, visibility: 1 }]] }],
      ['a NaN coordinate', { landmarks: [[...native(32), { x: Number.NaN, y: 0.5, visibility: 1 }]] }],
      ['an Infinity coordinate', { landmarks: [[...native(32), { x: 0.5, y: Number.POSITIVE_INFINITY, visibility: 1 }]] }],
      ['a string coordinate', { landmarks: [[...native(32), { x: '0.5', y: 0.5, visibility: 1 }]] }],
    ];
    for (const [name, input] of cases) {
      it(name, () => {
        expect(adaptPoseLandmarkerResult(input)).toEqual({ ok: false, reason: 'malformed' });
      });
    }
  });
});
