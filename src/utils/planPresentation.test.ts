import { describe, expect, it } from 'vitest';
import type { PlannedExercise, WorkoutPlan } from '../types';
import { formatRest, humanize, pluralize, strategyLabel, summarizeDay, summarizePlan } from './planPresentation';

const ex = (over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  id: `e-${Math.random()}`,
  name: 'Bench Press',
  muscleGroup: 'Chest',
  equipment: 'barbell',
  workingSets: 3,
  repRange: '8-12',
  targetRir: 2,
  restSeconds: 90,
  ...over
});

const plan = (days: PlannedExercise[][]): Pick<WorkoutPlan, 'days'> => ({
  days: days.map((exercises, i) => ({ id: `d${i}`, dayName: `Day ${i + 1}`, dayOrder: i + 1, exercises }))
});

describe('summarizePlan', () => {
  it('counts days, exercises and prescribed working sets', () => {
    const s = summarizePlan(plan([[ex({ workingSets: 4 }), ex({ workingSets: 3 })], [ex({ workingSets: 2 })]]));
    expect(s).toMatchObject({ dayCount: 2, exerciseCount: 3, setCount: 9 });
  });

  it('lists distinct muscle groups once, ignoring case and the importer placeholder', () => {
    const s = summarizePlan(
      plan([[ex({ muscleGroup: 'Chest' }), ex({ muscleGroup: 'chest' }), ex({ muscleGroup: 'General' }), ex({ muscleGroup: ' ' }), ex({ muscleGroup: 'Back' })]])
    );
    expect(s.muscleGroups).toEqual(['Chest', 'Back']);
  });

  it('handles an empty plan and non-finite set counts without NaN', () => {
    expect(summarizePlan(plan([]))).toEqual({ dayCount: 0, exerciseCount: 0, setCount: 0, muscleGroups: [] });
    expect(summarizePlan(plan([[ex({ workingSets: NaN })]])).setCount).toBe(0);
  });
});

describe('summarizeDay', () => {
  it('sums sets for one day', () => {
    expect(summarizeDay([ex({ workingSets: 3 }), ex({ workingSets: 5 })])).toEqual({ exerciseCount: 2, setCount: 8 });
  });
});

describe('formatting', () => {
  it('formats rest durations', () => {
    expect(formatRest(90)).toBe('90 s');
    expect(formatRest(120)).toBe('2 min');
    expect(formatRest(150)).toBe('2 min 30 s');
    expect(formatRest(0)).toBe('');
    expect(formatRest(NaN)).toBe('');
  });

  it('pluralizes and humanizes', () => {
    expect(pluralize(1, 'day')).toBe('1 day');
    expect(pluralize(2, 'day')).toBe('2 days');
    expect(humanize('machine')).toBe('Machine');
    expect(humanize('top_set')).toBe('Top set');
  });

  it('labels known and unknown strategies', () => {
    expect(strategyLabel('double_progression')).toBe('Double progression');
    expect(strategyLabel('custom_thing')).toBe('Custom thing');
  });
});
