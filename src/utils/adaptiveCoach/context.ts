import {
  DailySleepLog,
  EquipmentType,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { extractExerciseHistory, generateProgressionRecommendation } from '../progressionEngine';
import { calculateLocalRecoveryInsights, inferMuscleGroup } from '../recoveryAnalytics';
import { CoachingContext, ExerciseEvidence, ProgressionEvidence } from './types';

export const LOOKBACK_DAYS = 42;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_EXERCISE = 4;

export interface CoachingInputs {
  profile: UserProfile;
  plans: WorkoutPlan[];
  activePlanId: string | null;
  sessions: WorkoutSession[];
  activeSession: WorkoutSession | null;
  sleepLogs: DailySleepLog[];
  now?: Date;
}

function daysBetween(dateStr: string, now: Date): number {
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

/** The day after the most recently completed session of this plan, wrapping; the first day if none. */
export function pickTargetDayId(plan: WorkoutPlan, sessions: WorkoutSession[]): string | null {
  const days = [...plan.days].sort((a, b) => a.dayOrder - b.dayOrder);
  if (days.length === 0) return null;
  const last = sessions
    .filter((s) => s.status === 'completed' && s.planId === plan.id && s.dayId && days.some((d) => d.id === s.dayId))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  if (!last) return days[0].id;
  const idx = days.findIndex((d) => d.id === last.dayId);
  return days[(idx + 1) % days.length].id;
}

/**
 * Pure: assembles the minimal coaching context from stored data. Never fabricates values;
 * anything missing stays null/empty so the rules engine can say so.
 */
export function buildCoachingContext(inputs: CoachingInputs): CoachingContext {
  const now = inputs.now ?? new Date();
  const { profile, plans, sessions, activeSession } = inputs;

  const plan =
    plans.find((p) => p.id === inputs.activePlanId) ?? plans.find((p) => p.isActive) ?? null;

  const completed = sessions
    .filter((s) => s.status === 'completed' && daysBetween(s.date, now) <= LOOKBACK_DAYS)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const lastSession = completed[completed.length - 1];

  const targetDayId = plan ? pickTargetDayId(plan, sessions) : null;
  const targetDay = plan?.days.find((d) => d.id === targetDayId) ?? null;

  const exerciseHistory: Record<string, ExerciseEvidence> = {};
  const progression: Record<string, ProgressionEvidence> = {};

  if (plan && targetDay) {
    for (const ex of targetDay.exercises) {
      const key = ex.name.trim().toLowerCase();
      const rows: ExerciseEvidence['sessions'] = [];
      for (const s of completed) {
        const match = s.exercises.find((e) => e.name.trim().toLowerCase() === key);
        if (!match) continue;
        const working = match.sets.filter((x) => x.type === 'working');
        if (working.length === 0) continue;
        const done = working.filter((x) => x.completed && !x.skipped);
        const rirs = done.filter((x) => typeof x.rir === 'number').map((x) => x.rir as number);
        rows.push({
          date: s.date,
          topWeight: Math.max(0, ...done.map((x) => Number(x.weight) || 0)),
          reps: done.map((x) => Number(x.reps) || 0),
          totalVolume: done.reduce((a, x) => a + (Number(x.weight) || 0) * (Number(x.reps) || 0), 0),
          avgRir: rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null,
          plannedSets: working.length,
          completedSets: done.length,
          skippedOrIncompleteSets: working.length - done.length
        });
      }
      if (rows.length === 0) continue;
      exerciseHistory[ex.name] = { sessions: rows.slice(-MAX_SESSIONS_PER_EXERCISE) };

      // Reuse the existing deterministic progression engine on real history only.
      const history = extractExerciseHistory(completed, ex.name);
      if (history && history.sessions.length > 0) {
        const rec = generateProgressionRecommendation(history, profile, ex.name, ex.equipment, ex.repRange, ex.targetRir, {
          planId: plan.id,
          planName: plan.name,
          prescribedRepRange: ex.repRange,
          prescribedSets: ex.workingSets,
          prescribedRir: ex.targetRir,
          progressionStrategy: ex.progressionStrategy ?? plan.defaultStrategy,
          customIncrement: ex.customIncrement,
          trainingPhase: plan.progressionPhase ?? profile.trainingPhase
        });
        progression[ex.name] = {
          ruleApplied: rec.ruleApplied,
          ruleTitle: rec.ruleTitle,
          currentWeight: rec.currentWeight,
          recommendedWeight: rec.recommendedWeight,
          recommendedRepTarget: rec.recommendedRepTarget,
          isProvisional: !!rec.flags.isProvisional
        };
      }
    }
  }

  // Recovery (existing analytics; only meaningful with completed history)
  let recovery: CoachingContext['recovery'] = {
    available: false,
    overallReadiness: null,
    fatigueLevel: null,
    restRecommendedToday: false,
    fatiguedMuscleGroups: []
  };
  if (completed.length > 0) {
    const r = calculateLocalRecoveryInsights(sessions, profile, plan);
    recovery = {
      available: true,
      overallReadiness: r.overallReadiness,
      fatigueLevel: r.systemicFatigueLevel,
      restRecommendedToday: r.optimalRestDays.isRestRecommendedToday,
      fatiguedMuscleGroups: r.muscleRecovery.filter((m) => m.status === 'fatigued').map((m) => m.muscleGroup)
    };
  }

  // Sleep: last 5 days, real (non-demo) logs only
  const recentSleep = inputs.sleepLogs.filter(
    (l) => !l.isDemo && daysBetween(l.date, now) >= 0 && daysBetween(l.date, now) <= 5 && l.hoursSlept > 0
  );
  const sleep: CoachingContext['sleep'] = {
    nightsLogged: recentSleep.length,
    avgHours: recentSleep.length ? recentSleep.reduce((a, l) => a + l.hoursSlept, 0) / recentSleep.length : null,
    reliable: recentSleep.length >= 3
  };

  // Substitution candidates come only from what the athlete has planned or logged.
  const known = new Map<string, { name: string; muscleGroup: string; equipment: EquipmentType }>();
  const loggedEquipment = new Set<EquipmentType>();
  for (const p of plans) {
    for (const d of p.days) for (const e of d.exercises) {
      known.set(e.name.toLowerCase(), { name: e.name, muscleGroup: inferMuscleGroup(e.name, e.muscleGroup), equipment: e.equipment });
    }
  }
  for (const s of completed) for (const e of s.exercises) {
    if (e.sets.some((x) => x.completed && !x.skipped)) loggedEquipment.add(e.equipment);
    if (!known.has(e.name.toLowerCase())) {
      known.set(e.name.toLowerCase(), { name: e.name, muscleGroup: inferMuscleGroup(e.name, e.muscleGroup), equipment: e.equipment });
    }
  }

  return {
    generatedAt: now.toISOString(),
    athlete: {
      primaryGoal: profile.primaryGoal,
      trainingExperience: profile.trainingExperience,
      trainingDaysPerWeek: profile.trainingDaysPerWeek,
      trainingSplitName: profile.trainingSplitName,
      trainingPhase: profile.trainingPhase,
      preferredUnit: profile.preferredUnit
    },
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          updatedAt: plan.updatedAt,
          days: plan.days.map((d) => ({
            id: d.id,
            dayName: d.dayName,
            dayOrder: d.dayOrder,
            // free-text notes are intentionally not copied (privacy)
            exercises: d.exercises.map(({ notes: _notes, ...rest }) => rest)
          }))
        }
      : null,
    targetDayId,
    activeSessionDayId: activeSession && activeSession.status === 'in_progress' ? activeSession.dayId ?? null : null,
    exerciseHistory,
    progression,
    recovery,
    sleep,
    knownExercises: [...known.values()],
    loggedEquipment: [...loggedEquipment],
    dataQuality: {
      completedSessions: completed.length,
      lastSessionDate: lastSession?.date ?? null,
      daysSinceLastSession: lastSession ? daysBetween(lastSession.date, now) : null,
      usesDemoData: completed.some((s) => s.isDemo)
    }
  };
}
