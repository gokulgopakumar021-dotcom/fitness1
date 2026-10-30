import type { PlannedExercise, WorkoutPlan } from '../types';

/**
 * Display-only helpers for the Plans screen.
 * They only count and format values already stored on a plan; nothing here estimates duration,
 * progress or anything else the plan does not hold.
 */

export interface PlanSummary {
  dayCount: number;
  exerciseCount: number;
  /** Sum of `workingSets` over every exercise (the prescribed working sets in the plan). */
  setCount: number;
  /** Distinct muscle groups in first-seen order. 'General' is the importer's placeholder and is left out. */
  muscleGroups: string[];
}

export function summarizePlan(plan: Pick<WorkoutPlan, 'days'>): PlanSummary {
  let exerciseCount = 0;
  let setCount = 0;
  const seen = new Set<string>();
  const muscleGroups: string[] = [];
  for (const day of plan.days) {
    for (const ex of day.exercises) {
      exerciseCount += 1;
      setCount += Number.isFinite(ex.workingSets) ? ex.workingSets : 0;
      const group = (ex.muscleGroup || '').trim();
      const key = group.toLowerCase();
      if (group && key !== 'general' && !seen.has(key)) {
        seen.add(key);
        muscleGroups.push(group);
      }
    }
  }
  return { dayCount: plan.days.length, exerciseCount, setCount, muscleGroups };
}

/** Same summary for a single training day. */
export function summarizeDay(exercises: PlannedExercise[]): { exerciseCount: number; setCount: number } {
  return {
    exerciseCount: exercises.length,
    setCount: exercises.reduce((acc, ex) => acc + (Number.isFinite(ex.workingSets) ? ex.workingSets : 0), 0)
  };
}

export const pluralize = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** 'machine' -> 'Machine', 'some_value' -> 'Some value'. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '';
}

/** 90 -> '90 s', 120 -> '2 min', 150 -> '2 min 30 s'. */
export function formatRest(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 120) return `${Math.round(seconds)} s`;
  const min = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return rem ? `${min} min ${rem} s` : `${min} min`;
}

const STRATEGY_LABELS: Record<string, string> = {
  double_progression: 'Double progression',
  top_set_only: 'Top-set only',
  consecutive_sessions: 'Dual-session consolidation',
  linear_load: 'Linear micro-load',
  rep_accumulation: 'Rep accumulation'
};

export const strategyLabel = (strategy: string): string => STRATEGY_LABELS[strategy] ?? humanize(strategy);
