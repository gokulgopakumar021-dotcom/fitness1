import { WorkoutPlan } from '../../types';
import { inferMuscleGroup } from '../recoveryAnalytics';
import { MAX_ADJUSTMENTS, MIN_SETS_FLOOR, REST_CAP_SECONDS } from './engine';
import { AdaptiveReview, AiExplanation, CoachingContext, PlanAdjustment } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const MAX_CONTEXT_BYTES = 100_000;
const MAX_SUMMARY_CHARS = 400;
const MAX_EXPLANATION_CHARS = 280;

/** Structural check of an untrusted coaching context at the API boundary. */
export function validateCoachingContext(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['context must be an object'] };
  const c = raw as Partial<CoachingContext>;
  try {
    if (JSON.stringify(raw).length > MAX_CONTEXT_BYTES) errors.push('context too large');
  } catch {
    errors.push('context not serialisable');
  }
  if (typeof c.generatedAt !== 'string' || Number.isNaN(Date.parse(c.generatedAt))) errors.push('generatedAt invalid');
  if (!c.athlete || typeof c.athlete !== 'object') errors.push('athlete missing');
  if (!c.dataQuality || typeof c.dataQuality.completedSessions !== 'number') errors.push('dataQuality missing');
  if (!c.recovery || typeof c.recovery !== 'object') errors.push('recovery missing');
  if (!c.sleep || typeof c.sleep !== 'object') errors.push('sleep missing');
  if (!c.exerciseHistory || typeof c.exerciseHistory !== 'object') errors.push('exerciseHistory missing');
  if (!c.progression || typeof c.progression !== 'object') errors.push('progression missing');
  if (!Array.isArray(c.knownExercises) || c.knownExercises.length > 400) errors.push('knownExercises invalid');
  if (!Array.isArray(c.loggedEquipment)) errors.push('loggedEquipment invalid');
  if (c.plan !== null) {
    const p = c.plan;
    if (!p || typeof p.id !== 'string' || typeof p.updatedAt !== 'string' || !Array.isArray(p.days) || p.days.length > 14) {
      errors.push('plan invalid');
    } else {
      for (const d of p.days) {
        if (!d || typeof d.id !== 'string' || !Array.isArray(d.exercises) || d.exercises.length > 40) {
          errors.push('plan day invalid');
          break;
        }
        if (d.exercises.some((e) => !e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.workingSets !== 'number' || typeof e.restSeconds !== 'number')) {
          errors.push('plan exercise invalid');
          break;
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Safety validation of a review against the CURRENT stored plan. Run before anything is persisted.
 * Rejects stale reviews (plan changed since), changed baseline values, and out-of-bounds edits.
 */
export function validateReviewForApply(
  review: AdaptiveReview,
  plan: WorkoutPlan | undefined,
  selectedIds: string[]
): ValidationResult & { reason?: 'no_plan' | 'stale' | 'invalid' | 'nothing_selected' } {
  const errors: string[] = [];
  if (!plan || review.planId !== plan.id) return { ok: false, errors: ['The plan for this review no longer exists.'], reason: 'no_plan' };
  if (review.status !== 'ok') return { ok: false, errors: ['This review has nothing to apply.'], reason: 'invalid' };
  if (plan.updatedAt !== review.basePlanUpdatedAt) {
    return { ok: false, errors: ['Your plan changed after this review was made. Run a new review.'], reason: 'stale' };
  }
  const day = plan.days.find((d) => d.id === review.targetDayId);
  if (!day) return { ok: false, errors: ['The reviewed day no longer exists.'], reason: 'stale' };

  const chosen = review.adjustments.filter((a) => selectedIds.includes(a.id));
  if (chosen.length === 0) return { ok: false, errors: ['No changes selected.'], reason: 'nothing_selected' };
  if (review.adjustments.length > MAX_ADJUSTMENTS) errors.push('Too many adjustments.');
  if (new Set(chosen.map((a) => a.id)).size !== chosen.length) errors.push('Duplicate adjustment.');
  if (new Set(chosen.map((a) => a.exerciseId)).size !== chosen.length) errors.push('Conflicting adjustments for one exercise.');

  for (const a of chosen) {
    const ex = day.exercises.find((e) => e.id === a.exerciseId);
    if (!ex) {
      errors.push(`${a.exerciseName} is no longer in this day.`);
      continue;
    }
    if (a.kind === 'reduce_sets') {
      if (ex.workingSets !== a.from) errors.push(`${a.exerciseName}: set count changed since the review.`);
      if (!Number.isInteger(a.to) || a.to !== a.from - 1 || a.to < MIN_SETS_FLOOR) errors.push(`${a.exerciseName}: invalid set change.`);
    } else if (a.kind === 'increase_rest') {
      if (ex.restSeconds !== a.from) errors.push(`${a.exerciseName}: rest time changed since the review.`);
      if (!Number.isInteger(a.to) || a.to <= a.from || a.to > REST_CAP_SECONDS || a.to - a.from > 60) errors.push(`${a.exerciseName}: invalid rest change.`);
    } else if (a.kind === 'substitute_exercise') {
      const nm = a.substitute?.name?.trim() ?? '';
      if (ex.name !== a.from) errors.push(`${a.exerciseName}: exercise changed since the review.`);
      if (!nm || nm.length > 80 || nm !== a.to) errors.push(`${a.exerciseName}: invalid substitute.`);
      else {
        if (inferMuscleGroup(nm, a.substitute.muscleGroup) !== inferMuscleGroup(ex.name, ex.muscleGroup)) errors.push(`${a.exerciseName}: substitute targets a different muscle group.`);
        if (day.exercises.some((e) => e.name.toLowerCase() === nm.toLowerCase())) errors.push(`${nm} is already in this day.`);
      }
    } else {
      errors.push('Unknown adjustment type.');
    }
  }
  return errors.length ? { ok: false, errors, reason: 'invalid' } : { ok: true, errors: [] };
}

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
}

/**
 * Validates untrusted model output. The model may only supply wording: unknown adjustment ids are
 * dropped, lengths are capped, and any text that introduces a number not present in the
 * deterministic review is rejected so it cannot invent measurements.
 */
export function parseAiExplanation(raw: unknown, review: AdaptiveReview): AiExplanation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { summary?: unknown; explanations?: unknown };
  const allowed = numbersIn(
    [
      review.headline,
      ...review.adjustments.flatMap((a) => [a.reason, String(a.from), String(a.to), a.exerciseName]),
      ...review.notes.map((n) => n.text),
      ...review.evidence.map((e) => `${e.label} ${e.detail}`)
    ].join(' ')
  );
  const clean = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim();
    if (!t || t.length > max) return null;
    for (const n of numbersIn(t)) if (!allowed.has(n)) return null;
    return t;
  };
  const summary = clean(r.summary, MAX_SUMMARY_CHARS);
  const byAdjustmentId: Record<string, string> = {};
  if (Array.isArray(r.explanations)) {
    for (const item of r.explanations) {
      if (!item || typeof item !== 'object') continue;
      const { id, text } = item as { id?: unknown; text?: unknown };
      if (typeof id !== 'string' || !review.adjustments.some((a: PlanAdjustment) => a.id === id)) continue;
      const t = clean(text, MAX_EXPLANATION_CHARS);
      if (t) byAdjustmentId[id] = t;
    }
  }
  if (!summary && Object.keys(byAdjustmentId).length === 0) return null;
  return { summary: summary ?? '', byAdjustmentId };
}
