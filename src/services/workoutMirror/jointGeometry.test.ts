import { describe, it, expect } from 'vitest';
import {
  calculateAngle,
  calculate3DAngle,
  calculateVerticalAngle,
  calculateHorizontalAngle,
  calculateDistance2D,
  calculateMidpoint,
  LandmarkSmoothingFilter,
  evaluateBodyVisibility,
} from './jointGeometry';
import { MirrorPoint, POSE_LANDMARKS } from '../../types/workoutMirror';

describe('jointGeometry', () => {
  it('calculates right angle (90 degrees) accurately', () => {
    const a: MirrorPoint = { x: 0, y: 1 };
    const b: MirrorPoint = { x: 0, y: 0 };
    const c: MirrorPoint = { x: 1, y: 0 };

    const angle = calculateAngle(a, b, c);
    expect(Math.round(angle)).toBe(90);
  });

  it('calculates straight line (180 degrees) accurately', () => {
    const a: MirrorPoint = { x: 0, y: -1 };
    const b: MirrorPoint = { x: 0, y: 0 };
    const c: MirrorPoint = { x: 0, y: 1 };

    const angle = calculateAngle(a, b, c);
    expect(Math.round(angle)).toBe(180);
  });

  it('calculates 3D angle taking depth into account', () => {
    const a: MirrorPoint = { x: 0, y: 0, z: 1 };
    const b: MirrorPoint = { x: 0, y: 0, z: 0 };
    const c: MirrorPoint = { x: 1, y: 0, z: 0 };

    const angle = calculate3DAngle(a, b, c);
    expect(Math.round(angle)).toBe(90);
  });

  it('calculates vertical inclination angle', () => {
    const a: MirrorPoint = { x: 0.5, y: 0.2 };
    const b: MirrorPoint = { x: 0.5, y: 0.8 }; // plumb line

    const tilt = calculateVerticalAngle(a, b);
    expect(Math.round(tilt)).toBe(0);

    const horizontalA: MirrorPoint = { x: 0.2, y: 0.5 };
    const horizontalB: MirrorPoint = { x: 0.8, y: 0.5 };
    const horizontalTilt = calculateVerticalAngle(horizontalA, horizontalB);
    expect(Math.round(horizontalTilt)).toBe(90);
  });

  it('calculates horizontal angle', () => {
    const a: MirrorPoint = { x: 0.2, y: 0.5 };
    const b: MirrorPoint = { x: 0.8, y: 0.5 };

    const tilt = calculateHorizontalAngle(a, b);
    expect(Math.round(tilt)).toBe(0);
  });

  it('calculates 2D distance and midpoint', () => {
    const a: MirrorPoint = { x: 0, y: 0 };
    const b: MirrorPoint = { x: 3, y: 4 };

    expect(calculateDistance2D(a, b)).toBe(5);

    const mid = calculateMidpoint(a, b);
    expect(mid.x).toBe(1.5);
    expect(mid.y).toBe(2);
  });

  it('smooths raw landmark jitter using Exponential Moving Average', () => {
    const filter = new LandmarkSmoothingFilter(0.5);

    const frame1: MirrorPoint[] = [{ x: 0.5, y: 0.5, visibility: 0.9 }];
    const smoothed1 = filter.filter(frame1);
    expect(smoothed1[0].x).toBe(0.5);

    const frame2: MirrorPoint[] = [{ x: 0.6, y: 0.5, visibility: 0.9 }];
    const smoothed2 = filter.filter(frame2);
    // 0.5 * 0.6 + 0.5 * 0.5 = 0.55
    expect(smoothed2[0].x).toBeCloseTo(0.55);

    filter.reset();
  });

  it('evaluates body visibility and detects missing landmarks', () => {
    // Null landmarks
    const nullRes = evaluateBodyVisibility(null);
    expect(nullRes.isFullyVisible).toBe(false);
    expect(nullRes.distanceStatus).toBe('not_detected');

    // Partial landmarks without feet
    const partial: MirrorPoint[] = Array.from({ length: 33 }, (_, i) => {
      const isFootJoint = i >= POSE_LANDMARKS.LEFT_ANKLE && i <= POSE_LANDMARKS.RIGHT_FOOT_INDEX;
      return {
        x: 0.5,
        y: 0.3 + (i / 33) * 0.4,
        visibility: isFootJoint ? 0.1 : 0.9,
      };
    });

    const partialRes = evaluateBodyVisibility(partial);
    expect(partialRes.areFeetVisible).toBe(false);
    expect(partialRes.isFullyVisible).toBe(false);
  });
});
