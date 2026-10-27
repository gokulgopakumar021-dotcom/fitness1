import { describe, expect, it } from 'vitest';
import { getExerciseIndex } from '../../data/exerciseIndex';
import { STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN } from '../../data/starterPlans';
import type { ExerciseIndexEntry } from '../../types/video';
import { matchVideoFilename, prepareIndex, resolveExerciseKey } from './matcher';

const real = prepareIndex(getExerciseIndex());
const synthetic = (entries: ExerciseIndexEntry[]) => prepareIndex(entries);

describe('exercise index (derived from existing data)', () => {
  it('reuses biomechanics ids verbatim and adds no duplicate keys', () => {
    const idx = getExerciseIndex();
    expect(idx.find((e) => e.key === 'barbell-bench-press')?.source).toBe('biomechanics');
    expect(new Set(idx.map((e) => e.key)).size).toBe(idx.length);
  });
  it('covers every starter-plan exercise exactly once without duplicating a biomechanics exercise', () => {
    const names = [...STARTER_PPL_PLAN.days, ...STARTER_UPPER_LOWER_PLAN.days].flatMap((d) => d.exercises.map((e) => e.name));
    for (const name of new Set(names)) expect(resolveExerciseKey(name, real), name).not.toBeNull();
    expect(getExerciseIndex().filter((e) => e.key.includes('bench-press') && e.source === 'starter-plan' && e.name === 'Barbell Bench Press')).toHaveLength(0);
  });
});

describe('matchVideoFilename', () => {
  it('matches an exact key, name and alias automatically, with decreasing confidence', () => {
    const byKey = matchVideoFilename('barbell-bench-press.mp4', real);
    expect(byKey).toMatchObject({ exerciseKey: 'barbell-bench-press', method: 'exact_key', reviewStatus: 'matched', confidence: 1 });
    const byName = matchVideoFilename('Barbell Back Squat.mp4', real);
    expect(byName).toMatchObject({ exerciseKey: 'barbell-squat', method: 'exact_name', reviewStatus: 'matched' });
    const byAlias = matchVideoFilename('0042_Back_Squat.mp4', real);
    expect(byAlias).toMatchObject({ exerciseKey: 'barbell-squat', method: 'exact_alias', reviewStatus: 'matched', confidence: 0.9 });
  });

  it('does not map a different movement onto an alias substring ("Hack Squat" is not "Squat")', () => {
    const r = matchVideoFilename('Hack Squat.mp4', real);
    expect(r.exerciseKey).toBeNull();
    expect(r.reviewStatus).not.toBe('matched');
  });

  it('downgrades an exact match whose equipment contradicts the video', () => {
    // The biomechanics data lists "Dumbbell Lateral Raise" as an alias of the CABLE lateral raise.
    const r = matchVideoFilename('Dumbbell Lateral Raise.mp4', real);
    expect(r).toMatchObject({ reviewStatus: 'needs_review', reason: 'equipment_conflict', exerciseKey: null, suggestedKey: 'cable-lateral-raise' });
  });

  it('sends ties at the best exact tier to review instead of picking one', () => {
    const idx = synthetic([
      { key: 'a', name: 'Alpha Row', aliases: ['Row'], source: 'biomechanics' },
      { key: 'b', name: 'Beta Row', aliases: ['Row'], source: 'biomechanics' }
    ]);
    const r = matchVideoFilename('Row.mp4', idx);
    expect(r).toMatchObject({ reviewStatus: 'needs_review', reason: 'ambiguous', exerciseKey: null });
    expect(r.candidates.map((c) => c.key).sort()).toEqual(['a', 'b']);
  });

  it('only SUGGESTS for fuzzy matches and never assigns an exercise key', () => {
    const idx = synthetic([
      { key: 'incline-dumbbell-bench-press', name: 'Incline Dumbbell Bench Press', aliases: [], source: 'starter-plan' },
      { key: 'seated-cable-row', name: 'Seated Cable Row', aliases: [], source: 'starter-plan' }
    ]);
    const r = matchVideoFilename('Incline Dumbbell Bench Press Chest.mp4', idx);
    expect(r).toMatchObject({ method: 'fuzzy', reviewStatus: 'needs_review', reason: 'fuzzy_only', exerciseKey: null, suggestedKey: 'incline-dumbbell-bench-press' });
    expect(r.confidence).toBeLessThan(1);
  });

  it('refuses a fuzzy suggestion when two candidates are too close', () => {
    const idx = synthetic([
      { key: 'x', name: 'Wide Grip Lat Pulldown Machine', aliases: [], source: 'starter-plan' },
      { key: 'y', name: 'Wide Grip Lat Pulldown Cable', aliases: [], source: 'starter-plan' }
    ]);
    expect(matchVideoFilename('Wide Grip Lat Pulldown.mp4', idx).reviewStatus).toBe('unmatched');
  });

  it('leaves unrelated and empty names unmatched', () => {
    expect(matchVideoFilename('Yoga Flow Sequence.mp4', real)).toMatchObject({ reviewStatus: 'unmatched', exerciseKey: null, reason: 'no_match' });
    expect(matchVideoFilename('0001.mp4', real)).toMatchObject({ reviewStatus: 'unmatched', reason: 'empty_name' });
  });
});

describe('resolveExerciseKey (runtime lookup)', () => {
  it('resolves known workout names and ignores custom or conflicting ones', () => {
    expect(resolveExerciseKey('Barbell Bench Press', real)).toBe('barbell-bench-press');
    expect(resolveExerciseKey('My Custom Cable Thing', real)).toBeNull();
    expect(resolveExerciseKey('Dumbbell Lateral Raise', real)).toBeNull();
  });
});
