import { describe, expect, it } from 'vitest';
import {
  EXERCISE_BIOMECHANICS,
  getBiomechanicsForExercise,
  NO_BIOMECHANICS_GUIDE_MESSAGE,
  normalizeExerciseLookupText
} from './exerciseBiomechanics';

/**
 * Regression guard for the post-merge audit finding U1: the lookup used to fall back to the barbell squat guide (or
 * another loosely related guide) for exercises it did not know. Every case asserts the result is either the CORRECT
 * guide or no guide at all, and that squat guidance is never returned for a non-squat.
 */
function expectCorrectOrAbsent(name: string, correctKeys: readonly string[]) {
  const r = getBiomechanicsForExercise(name);
  if (r.status === 'no_match') return r;
  expect(correctKeys, `"${name}" was given the "${r.key}" guide`).toContain(r.key);
  expect(r.data.id).toBe(r.key);
  return r;
}

describe('getBiomechanicsForExercise: regression cases from the audit', () => {
  it('Romanian deadlift gets the Romanian deadlift guide, not the conventional deadlift or a squat', () => {
    const r = getBiomechanicsForExercise('Romanian Deadlift');
    expect(r).toMatchObject({ status: 'match', key: 'romanian-deadlift' });
    expect(expectCorrectOrAbsent('Romanian Deadlift', ['romanian-deadlift']).status).toBe('match');
    for (const variant of ['romanian deadlift', 'ROMANIAN  DEADLIFT', 'Romanian Deadlift (RDL)', 'RDL', 'Barbell RDL']) {
      expect(getBiomechanicsForExercise(variant), variant).toMatchObject({ status: 'match', key: 'romanian-deadlift' });
    }
  });

  it.each([
    ['Face Pull'],
    ['Leg Extension'],
    ['Bicep Curl'],
    ['Hanging Leg Raise'],
    ['Plank'],
    ['Pull-up']
  ])('%s has no verified guide, so there is none (and certainly not squat guidance)', (name) => {
    const r = expectCorrectOrAbsent(name, []);
    expect(r).toEqual({ status: 'no_match', reason: 'unknown' });
  });

  it('keeps the verified guide for an exercise that has one', () => {
    expect(getBiomechanicsForExercise('Barbell Back Squat')).toMatchObject({ status: 'match', key: 'barbell-squat', matchedBy: 'name' });
    expect(getBiomechanicsForExercise('Back Squat')).toMatchObject({ status: 'match', key: 'barbell-squat', matchedBy: 'alias' });
    expect(getBiomechanicsForExercise('barbell-bench-press')).toMatchObject({ status: 'match', key: 'barbell-bench-press', matchedBy: 'key' });
    expect(getBiomechanicsForExercise('Lat Pulldown')).toMatchObject({ status: 'match', key: 'lat-pulldown' });
    expect(getBiomechanicsForExercise('Overhead Press')).toMatchObject({ status: 'match', key: 'overhead-press' });
    expect(getBiomechanicsForExercise('Barbell Row')).toMatchObject({ status: 'match', key: 'barbell-row' });
    const squat = getBiomechanicsForExercise('Barbell Back Squat');
    if (squat.status !== 'match') throw new Error('expected a match');
    expect(squat.data).toBe(EXERCISE_BIOMECHANICS['barbell-squat']);
    expect(squat.data.name).toBe('Barbell Back Squat'); // the canonical name, never the caller's text
  });

  it('returns no guide for an unknown custom exercise', () => {
    expect(getBiomechanicsForExercise('Gokul Special Cable Crunch Combo')).toEqual({ status: 'no_match', reason: 'unknown' });
  });

  it('returns no guide for empty or whitespace-only names', () => {
    for (const blank of ['', '   ', '\n\t', '---', '()']) expect(getBiomechanicsForExercise(blank), JSON.stringify(blank)).toEqual({ status: 'no_match', reason: 'empty' });
  });

  it('exposes the message the UI shows when there is no guide', () => {
    expect(NO_BIOMECHANICS_GUIDE_MESSAGE).toBe('No form guide available for this exercise.');
  });
});

describe('getBiomechanicsForExercise: no substring or movement-pattern matching', () => {
  it.each([
    'Front Squat', 'Goblet Squat', 'Bulgarian Split Squat', 'Walking Lunge', 'Hack Squat',
    'Incline Bench Press', 'Dumbbell Bench Press', 'Push-up', 'Chest Press Machine',
    'Sumo Deadlift', 'Stiff Leg Deadlift', 'Hip Thrust',
    'Dumbbell Shoulder Press', 'Arnold Press',
    'Seated Cable Row', 'Dumbbell Row', 'T-Bar Row',
    'Chin-up', 'Lat Prayer', 'Rear Delt Raise', 'Front Raise', 'Calf Raise'
  ])('%s does not borrow another exercise\'s guide', (name) => {
    expect(getBiomechanicsForExercise(name)).toMatchObject({ status: 'no_match' });
  });

  it('never returns the barbell squat guide for a name that is not a squat alias', () => {
    const squatNames = new Set(['barbell squat', 'barbell back squat', 'squat', 'back squat', 'high bar squat', 'low bar squat']);
    const samples = [
      'Romanian Deadlift', 'Face Pull', 'Leg Extension', 'Bicep Curl', 'Hanging Leg Raise', 'Plank', 'Pull-up',
      'Leg Press', 'Leg Curl', 'Goblet Squat', 'Something Unknown', '', 'Squats', 'Squat Jump'
    ];
    for (const name of samples) {
      const r = getBiomechanicsForExercise(name);
      if (r.status === 'match' && r.key === 'barbell-squat') expect(squatNames.has(normalizeExerciseLookupText(name)), name).toBe(true);
    }
  });

  it('does not trust aliases whose guide is for different equipment', () => {
    // The 'Dumbbell Lateral Raise' alias points at the cable guide and 'Dumbbell RDL' at the barbell guide.
    expect(getBiomechanicsForExercise('Dumbbell Lateral Raise')).toMatchObject({ status: 'no_match' });
    expect(getBiomechanicsForExercise('Dumbbell RDL')).toMatchObject({ status: 'no_match' });
    // The equipment-neutral or matching-equipment forms still work.
    expect(getBiomechanicsForExercise('Cable Lateral Raise')).toMatchObject({ status: 'match', key: 'cable-lateral-raise' });
    expect(getBiomechanicsForExercise('Lateral Raise')).toMatchObject({ status: 'match', key: 'cable-lateral-raise' });
    expect(getBiomechanicsForExercise('Barbell RDL')).toMatchObject({ status: 'match', key: 'romanian-deadlift' });
  });
});

describe('getBiomechanicsForExercise: data integrity', () => {
  it('every record key equals its id', () => {
    for (const [key, data] of Object.entries(EXERCISE_BIOMECHANICS)) expect(data.id).toBe(key);
  });

  it('every key and canonical name resolves to its own entry (no ambiguity between entries)', () => {
    for (const [key, data] of Object.entries(EXERCISE_BIOMECHANICS)) {
      expect(getBiomechanicsForExercise(key), key).toMatchObject({ status: 'match', key });
      expect(getBiomechanicsForExercise(data.name), data.name).toMatchObject({ status: 'match', key });
    }
  });

  it('every verified alias resolves to its own entry', () => {
    const unverified = new Set(['dumbbell lateral raise', 'dumbbell rdl']);
    for (const [key, data] of Object.entries(EXERCISE_BIOMECHANICS)) {
      for (const alias of data.aliases) {
        if (unverified.has(normalizeExerciseLookupText(alias))) continue;
        expect(getBiomechanicsForExercise(alias), `${key} alias "${alias}"`).toMatchObject({ status: 'match', key });
      }
    }
  });

  it('normalises case, hyphens, punctuation and spacing only', () => {
    expect(normalizeExerciseLookupText('  Pull-Up!! ')).toBe('pull up');
    expect(normalizeExerciseLookupText('Romanian Deadlift (RDL)')).toBe('romanian deadlift rdl');
  });
});
