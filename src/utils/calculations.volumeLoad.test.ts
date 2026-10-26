import { describe, expect, it } from 'vitest';
import { LoggedSet, SetType } from '../types';
import { calculateVolumeLoad } from './calculations';

/**
 * CHARACTERIZATION TESTS: edge cases of calculateVolumeLoad that src/test/workout.test.ts does not cover.
 * Pins current behaviour only; no production code is changed.
 */

const set = (over: Partial<LoggedSet> & { type?: SetType }): LoggedSet => ({
  id: 's', setNumber: 1, type: 'working', weight: 100, reps: 10, completed: true, timestamp: '', ...over
});

describe('characterization: calculateVolumeLoad edge cases', () => {
  it('returns 0 for an empty list', () => {
    expect(calculateVolumeLoad([])).toBe(0);
    expect(calculateVolumeLoad([], false)).toBe(0);
  });

  it('contributes 0 for bodyweight sets with zero recorded weight, without throwing', () => {
    expect(calculateVolumeLoad([set({ weight: 0, reps: 12 })])).toBe(0);
  });

  it('includes drop and failure sets as working volume', () => {
    expect(calculateVolumeLoad([set({ type: 'drop', weight: 60, reps: 10 }), set({ type: 'failure', weight: 80, reps: 5 })])).toBe(600 + 400);
  });

  it('excludes a set flagged skipped even when it is also marked completed', () => {
    // Differs from calculateLocalRecoveryInsights, which counts such a set (see recoveryAnalytics.test.ts).
    expect(calculateVolumeLoad([set({ skipped: true })])).toBe(0);
  });

  it('treats non-numeric weight or reps as 0 instead of producing NaN', () => {
    expect(calculateVolumeLoad([set({ weight: NaN })])).toBe(0);
    expect(calculateVolumeLoad([set({ reps: undefined as unknown as number })])).toBe(0);
  });

  it('coerces numeric strings (as can arrive from form inputs)', () => {
    expect(calculateVolumeLoad([set({ weight: '50' as unknown as number, reps: '4' as unknown as number })])).toBe(200);
  });
});
