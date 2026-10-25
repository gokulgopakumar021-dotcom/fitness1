import { PlannedExercise } from '../../types';
import { inferMuscleGroup } from '../recoveryAnalytics';
import { AdaptiveReview, CoachingContext, EvidenceItem, PlanAdjustment, ReviewOnlyNote, ReviewVerdict } from './types';

// ---- Tunable, documented thresholds ----
export const MIN_COMPLETED_SESSIONS = 2;
export const STALE_AFTER_DAYS = 28;
export const MIN_SETS_FLOOR = 2; // never reduce an exercise below this
export const REST_STEP_SECONDS = 30;
export const REST_CAP_SECONDS = 180;
export const MAX_ADJUSTMENTS = 5;
export const LOW_SLEEP_AVG_HOURS = 6;
export const RIR_OVERSHOOT = 2; // avg RIR this far below target counts as "grinding"
const LIGHT_SESSION_MAX_EXERCISES = 2;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fingerprintOf(parts: unknown): string {
  const str = JSON.stringify(parts);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `ac-${(h >>> 0).toString(36)}`;
}

function empty(
  ctx: CoachingContext,
  status: 'no_plan' | 'insufficient_data',
  headline: string,
  missingInfo: string[]
): AdaptiveReview {
  return {
    status,
    verdict: 'none',
    headline,
    fingerprint: fingerprintOf([status, missingInfo, ctx.plan?.id, ctx.plan?.updatedAt]),
    generatedAt: ctx.generatedAt,
    planId: ctx.plan?.id ?? null,
    basePlanUpdatedAt: ctx.plan?.updatedAt ?? null,
    targetDayId: ctx.targetDayId,
    targetDayName: ctx.plan?.days.find((d) => d.id === ctx.targetDayId)?.dayName ?? null,
    adjustments: [],
    notes: [],
    evidence: [],
    missingInfo,
    caveats: []
  };
}

/**
 * Deterministic adaptive review. All numbers come from stored data or the existing progression
 * engine. No randomness, no network. AI (if any) only adds wording on top of this output.
 */
export function generateAdaptiveReview(ctx: CoachingContext): AdaptiveReview {
  if (!ctx.plan || ctx.plan.days.length === 0) {
    return empty(ctx, 'no_plan', 'No active workout plan to review', [
      'Activate or create a workout plan in the Plans tab so there is something to adjust.'
    ]);
  }
  const day = ctx.plan.days.find((d) => d.id === ctx.targetDayId);
  if (!day || day.exercises.length === 0) {
    return empty(ctx, 'no_plan', 'The next planned day has no exercises', [
      'Add exercises to the next day of your active plan.'
    ]);
  }

  const dq = ctx.dataQuality;
  if (dq.completedSessions < MIN_COMPLETED_SESSIONS) {
    return empty(ctx, 'insufficient_data', 'Not enough training history yet', [
      `Complete at least ${MIN_COMPLETED_SESSIONS} logged workouts (you have ${dq.completedSessions} in the last 6 weeks) so a review has real performance data to work from.`
    ]);
  }
  if (dq.daysSinceLastSession !== null && dq.daysSinceLastSession > STALE_AFTER_DAYS) {
    return empty(ctx, 'insufficient_data', 'Your latest logged workout is too old to base adjustments on', [
      `Your last logged workout was ${dq.daysSinceLastSession} days ago. Log a session first, then review again.`
    ]);
  }

  const evidence: EvidenceItem[] = [];
  const addEvidence = (label: string, detail: string): string => {
    const id = `e${evidence.length + 1}`;
    evidence.push({ id, label, detail });
    return id;
  };
  const adjustments: PlanAdjustment[] = [];
  const notes: ReviewOnlyNote[] = [];
  const caveats: string[] = [];
  const touched = new Set<string>(); // exercise ids already adjusted

  // --- Rule 1: sustained decline (existing progression Rule D) -> trim one set ---
  for (const ex of day.exercises) {
    const prog = ctx.progression[ex.name];
    const hist = ctx.exerciseHistory[ex.name];
    if (prog?.ruleApplied !== 'D_MULTI_SESSION_DECLINE' || !hist) continue;
    if (ex.workingSets <= MIN_SETS_FLOOR) continue;
    const vols = hist.sessions.slice(-3).map((s) => fmt(Math.round(s.totalVolume)));
    const ev = addEvidence(
      `${ex.name}: declining volume`,
      `Working volume over the last 3 sessions: ${vols.join(' → ')} (${prog.ruleTitle}).`
    );
    adjustments.push({
      id: `${ex.id}:workingSets`,
      kind: 'reduce_sets',
      exerciseId: ex.id,
      exerciseName: ex.name,
      from: ex.workingSets,
      to: ex.workingSets - 1,
      reason: `Volume has fallen three sessions in a row, so trimming one set can help recovery before pushing load again.`,
      evidenceIds: [ev]
    });
    touched.add(ex.id);
  }

  // --- Rule 2: lighter session needs >= 2 independent signals (never one bad night / one weak set) ---
  const signals: string[] = [];
  const signalEvidence: string[] = [];
  if (ctx.recovery.available && (ctx.recovery.restRecommendedToday || ctx.recovery.fatigueLevel === 'High')) {
    signals.push('recovery');
    signalEvidence.push(
      addEvidence(
        'Recovery status',
        `Systemic fatigue is ${ctx.recovery.fatigueLevel ?? 'unknown'}${ctx.recovery.overallReadiness !== null ? ` (readiness ${ctx.recovery.overallReadiness}%)` : ''}${ctx.recovery.restRecommendedToday ? '; the recovery model recommends rest today' : ''}.`
      )
    );
  }
  if (ctx.sleep.reliable && ctx.sleep.avgHours !== null && ctx.sleep.avgHours < LOW_SLEEP_AVG_HOURS) {
    signals.push('sleep');
    signalEvidence.push(
      addEvidence('Sleep', `Average ${fmt(Math.round(ctx.sleep.avgHours * 10) / 10)} h across ${ctx.sleep.nightsLogged} logged nights in the last 5 days.`)
    );
  }
  const dayMuscles = new Set(day.exercises.map((e) => inferMuscleGroup(e.name, e.muscleGroup)));
  const fatiguedHere = ctx.recovery.fatiguedMuscleGroups.filter((m) => dayMuscles.has(m));
  const decliningHere = adjustments.filter((a) => a.kind === 'reduce_sets').length;
  if (fatiguedHere.length > 0 || decliningHere >= 2) {
    signals.push('local');
    signalEvidence.push(
      addEvidence(
        'Muscles for this day',
        fatiguedHere.length > 0
          ? `Still fatigued from recent training: ${fatiguedHere.join(', ')}.`
          : `${decliningHere} exercises on this day show a multi-session decline.`
      )
    );
  }

  let verdict: ReviewVerdict = 'follow_plan';
  if (signals.length >= 2) {
    verdict = 'lighter_session';
    // Trim one set from up to two accessory exercises (from the end of the day), not already trimmed.
    const candidates = [...day.exercises].reverse().filter((e) => e.workingSets > MIN_SETS_FLOOR && !touched.has(e.id));
    for (const ex of candidates.slice(0, LIGHT_SESSION_MAX_EXERCISES)) {
      adjustments.push({
        id: `${ex.id}:workingSets`,
        kind: 'reduce_sets',
        exerciseId: ex.id,
        exerciseName: ex.name,
        from: ex.workingSets,
        to: ex.workingSets - 1,
        reason: `Multiple recovery signals point the same way (${signals.length}), so this accessory loses one set while main lifts stay as planned.`,
        evidenceIds: signalEvidence
      });
      touched.add(ex.id);
    }
  } else if (signals.length === 1 && decliningHere === 0) {
    caveats.push('One recovery signal alone is not enough to change your session, so the plan stays as written.');
  }
  if (ctx.sleep.nightsLogged > 0 && !ctx.sleep.reliable) {
    caveats.push(`Only ${ctx.sleep.nightsLogged} night(s) of sleep logged recently, so sleep was not used as evidence.`);
  } else if (ctx.sleep.nightsLogged === 0) {
    caveats.push('No recent sleep logs, so sleep was not considered.');
  }
  if (!ctx.recovery.available) caveats.push('No recovery estimate was available.');

  // --- Rule 3: grinding (RIR well below target on 2+ recent sessions) with short rest -> +30 s ---
  for (const ex of day.exercises) {
    if (touched.has(ex.id)) continue;
    const hist = ctx.exerciseHistory[ex.name];
    if (!hist || ex.restSeconds >= REST_CAP_SECONDS) continue;
    const last2 = hist.sessions.slice(-2);
    if (last2.length < 2 || last2.some((s) => s.avgRir === null)) continue;
    if (!last2.every((s) => (s.avgRir as number) <= ex.targetRir - RIR_OVERSHOOT)) continue;
    if (ex.restSeconds >= 150) continue;
    const ev = addEvidence(
      `${ex.name}: sets close to failure`,
      `Average RIR ${last2.map((s) => fmt(Math.round((s.avgRir as number) * 10) / 10)).join(' and ')} in the last 2 sessions against a target of ${ex.targetRir}.`
    );
    adjustments.push({
      id: `${ex.id}:restSeconds`,
      kind: 'increase_rest',
      exerciseId: ex.id,
      exerciseName: ex.name,
      from: ex.restSeconds,
      to: Math.min(REST_CAP_SECONDS, ex.restSeconds + REST_STEP_SECONDS),
      reason: 'Sets are landing well past the target effort, so a little more rest can protect rep quality.',
      evidenceIds: [ev]
    });
  }

  // --- Rule 4: exercise repeatedly not completed -> substitute from the athlete's own exercises ---
  for (const ex of day.exercises) {
    if (touched.has(ex.id)) continue;
    const hist = ctx.exerciseHistory[ex.name];
    if (!hist) continue;
    const last3 = hist.sessions.slice(-3);
    const skipped = last3.filter((s) => s.completedSets === 0);
    if (last3.length < 3 || skipped.length < 2) continue;
    const group = inferMuscleGroup(ex.name, ex.muscleGroup);
    const inDay = new Set(day.exercises.map((e) => e.name.toLowerCase()));
    const alt = ctx.knownExercises
      .filter((k) => k.muscleGroup === group && !inDay.has(k.name.toLowerCase()) && ctx.loggedEquipment.includes(k.equipment))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    const ev = addEvidence(
      `${ex.name}: repeatedly not completed`,
      `No working sets were completed in ${skipped.length} of the last ${last3.length} sessions where it was planned.`
    );
    if (alt) {
      adjustments.push({
        id: `${ex.id}:substitute`,
        kind: 'substitute_exercise',
        exerciseId: ex.id,
        exerciseName: ex.name,
        from: ex.name,
        to: alt.name,
        substitute: alt,
        reason: `${alt.name} trains the same muscle group (${group}) with equipment you have logged before.`,
        evidenceIds: [ev]
      });
      touched.add(ex.id);
    } else {
      notes.push({
        id: `${ex.id}:note-skip`,
        exerciseName: ex.name,
        text: `${ex.name} keeps getting skipped, but none of your planned or logged exercises is a clear match for ${group}. Consider choosing a replacement in the Plans tab.`,
        evidenceIds: [ev]
      });
    }
  }

  // --- Review-only load notes from the existing progression engine (plan stores no load) ---
  for (const ex of day.exercises) {
    const prog = ctx.progression[ex.name];
    if (!prog || prog.isProvisional) continue;
    const unit = ctx.athlete.preferredUnit;
    if ((prog.ruleApplied === 'A_TOP_REPS_ACHIEVED' || prog.ruleApplied === 'B_REPS_IMPROVED') && prog.recommendedWeight !== prog.currentWeight) {
      const ev = addEvidence(`${ex.name}: progression`, `${prog.ruleTitle}: last working weight ${fmt(prog.currentWeight)} kg.`);
      notes.push({
        id: `${ex.id}:note-load`,
        exerciseName: ex.name,
        text: `Progression engine suggests ${fmt(prog.recommendedWeight)} kg × ${prog.recommendedRepTarget} (from ${fmt(prog.currentWeight)} kg). Load is chosen when you log the set, so this is shown for review only.${unit === 'lbs' ? ' Values are in kg.' : ''}`,
        evidenceIds: [ev]
      });
    } else if (prog.ruleApplied === 'D_MULTI_SESSION_DECLINE') {
      notes.push({
        id: `${ex.id}:note-hold`,
        exerciseName: ex.name,
        text: `Hold ${fmt(prog.currentWeight)} kg for ${ex.name}; do not add load while performance is declining.`,
        evidenceIds: adjustments.find((a) => a.exerciseId === ex.id)?.evidenceIds ?? []
      });
    }
  }

  const capped = adjustments.slice(0, MAX_ADJUSTMENTS);
  if (capped.length > 0 && verdict === 'follow_plan') verdict = 'adjust';
  if (capped.length === 0) verdict = 'follow_plan';

  if (dq.usesDemoData) caveats.push('Some of the history is demo data.');
  if (ctx.activeSessionDayId) {
    caveats.push('A workout is in progress. Accepted changes apply to the saved plan only; your in-progress session is not modified.');
  }

  const headline =
    verdict === 'lighter_session'
      ? `Lighter session suggested for ${day.dayName}`
      : verdict === 'adjust'
        ? `${capped.length} small adjustment${capped.length === 1 ? '' : 's'} suggested for ${day.dayName}`
        : `Follow your plan for ${day.dayName}`;

  return {
    status: 'ok',
    verdict,
    headline,
    fingerprint: fingerprintOf([ctx.plan.id, ctx.plan.updatedAt, day.id, capped.map((a) => [a.id, a.from, a.to]), notes.map((n) => n.id)]),
    generatedAt: ctx.generatedAt,
    planId: ctx.plan.id,
    basePlanUpdatedAt: ctx.plan.updatedAt,
    targetDayId: day.id,
    targetDayName: day.dayName,
    adjustments: capped,
    notes,
    evidence,
    missingInfo: [],
    caveats
  };
}

export function exerciseById(day: { exercises: PlannedExercise[] }, id: string): PlannedExercise | undefined {
  return day.exercises.find((e) => e.id === id);
}
