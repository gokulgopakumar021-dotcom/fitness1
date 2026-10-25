import { WorkoutPlan } from '../../types';
import { AdaptiveReview } from './types';
import { validateReviewForApply } from './validate';

export interface PlanStore {
  getPlans(): WorkoutPlan[];
  savePlans(plans: WorkoutPlan[]): void;
}

export type ApplyResult =
  | { ok: true; applied: string[]; plan: WorkoutPlan }
  | { ok: false; reason: 'no_plan' | 'stale' | 'invalid' | 'nothing_selected' | 'save_failed' | 'already_applied'; message: string };

/**
 * Pure. Returns a copy of the plan with only the selected adjustments applied to the reviewed day.
 * Other days, exercises, fields and plans are untouched. Assumes validateReviewForApply passed.
 */
export function applyAdjustmentsToPlan(plan: WorkoutPlan, review: AdaptiveReview, selectedIds: string[], nowIso: string): WorkoutPlan {
  const chosen = review.adjustments.filter((a) => selectedIds.includes(a.id));
  const updatedAt = nowIso === plan.updatedAt ? new Date(Date.parse(nowIso) + 1).toISOString() : nowIso;
  return {
    ...plan,
    updatedAt,
    days: plan.days.map((day) => {
      if (day.id !== review.targetDayId) return day;
      return {
        ...day,
        exercises: day.exercises.map((ex) => {
          const a = chosen.find((c) => c.exerciseId === ex.id);
          if (!a) return ex;
          if (a.kind === 'reduce_sets') return { ...ex, workingSets: a.to };
          if (a.kind === 'increase_rest') return { ...ex, restSeconds: a.to };
          // Substitution: keep the slot (id, sets, reps, rest, RIR); drop form notes/tempo that described the old lift.
          const { notes: _n, tempo: _t, ...rest } = ex;
          return { ...rest, name: a.substitute.name, muscleGroup: a.substitute.muscleGroup, equipment: a.substitute.equipment };
        })
      };
    })
  };
}

/**
 * Validate, apply and verify. Only the stored plan is written; sessions (including any in-progress
 * session) and history are never read for writing. The persisted result is read back to confirm.
 */
export function applyAcceptedReview(
  review: AdaptiveReview,
  selectedIds: string[],
  store: PlanStore,
  now: () => Date = () => new Date()
): ApplyResult {
  {
    const plans = store.getPlans();
    const plan = plans.find((p) => p.id === review.planId);

    // Duplicate submission: the plan already holds every selected target value.
    if (plan && plan.updatedAt !== review.basePlanUpdatedAt) {
      const day = plan.days.find((d) => d.id === review.targetDayId);
      const chosen = review.adjustments.filter((a) => selectedIds.includes(a.id));
      const already =
        !!day &&
        chosen.length > 0 &&
        chosen.every((a) => {
          const ex = day.exercises.find((e) => e.id === a.exerciseId);
          if (!ex) return false;
          return a.kind === 'reduce_sets' ? ex.workingSets === a.to : a.kind === 'increase_rest' ? ex.restSeconds === a.to : ex.name === a.to;
        });
      if (already) return { ok: false, reason: 'already_applied', message: 'These changes are already saved in your plan.' };
    }

    const check = validateReviewForApply(review, plan, selectedIds);
    if (!check.ok) return { ok: false, reason: check.reason ?? 'invalid', message: check.errors[0] ?? 'These changes could not be validated.' };

    const updated = applyAdjustmentsToPlan(plan as WorkoutPlan, review, selectedIds, now().toISOString());
    store.savePlans(plans.map((p) => (p.id === updated.id ? updated : p)));

    // storage layer swallows write errors, so confirm what was actually persisted
    const persisted = store.getPlans().find((p) => p.id === updated.id);
    const day = persisted?.days.find((d) => d.id === review.targetDayId);
    const chosen = review.adjustments.filter((a) => selectedIds.includes(a.id));
    const verified =
      !!persisted &&
      persisted.updatedAt === updated.updatedAt &&
      chosen.every((a) => {
        const ex = day?.exercises.find((e) => e.id === a.exerciseId);
        if (!ex) return false;
        return a.kind === 'reduce_sets' ? ex.workingSets === a.to : a.kind === 'increase_rest' ? ex.restSeconds === a.to : ex.name === a.to;
      });
    if (!verified) {
      // best effort restore of the original list
      store.savePlans(plans);
      return { ok: false, reason: 'save_failed', message: 'Your plan could not be saved, so nothing was changed.' };
    }
    return {
      ok: true,
      plan: persisted as WorkoutPlan,
      applied: chosen.map((a) =>
        a.kind === 'reduce_sets'
          ? `${a.exerciseName}: ${a.from} → ${a.to} sets`
          : a.kind === 'increase_rest'
            ? `${a.exerciseName}: rest ${a.from}s → ${a.to}s`
            : `${a.from} → ${a.to}`
      )
    };
  }
}
