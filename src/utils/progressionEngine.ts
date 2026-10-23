import {
  EquipmentType,
  LoggedExercise,
  LoggedSet,
  ProgressiveOverloadRecommendation,
  ProgressionRuleCode,
  ProgressionStrategy,
  TrainingPhase,
  UserProfile,
  WorkoutSession
} from '../types';
import { calculateEpley1RM, calculateVolumeLoad, parseRepRange } from './calculations';

export interface ExerciseHistorySummary {
  exerciseName: string;
  equipment: EquipmentType;
  repRange: string;
  targetRir: number;
  sessions: {
    sessionId: string;
    date: string;
    workingSets: LoggedSet[];
    warmupSets: LoggedSet[];
    totalVolume: number;
    topWeight: number;
    avgRir?: number;
    estimated1RM: number;
  }[];
}

export interface OverloadAnalyticsConfig {
  planId?: string;
  planName?: string;
  prescribedRepRange?: string; // e.g. "8-12", "6-8", "5x5", "10-15"
  prescribedSets?: number;
  prescribedRir?: number;
  progressionStrategy?: ProgressionStrategy;
  customIncrement?: number;
  trainingPhase?: TrainingPhase;
}

/**
 * Extracts and groups workout history for a specific exercise across all completed sessions.
 */
export function extractExerciseHistory(
  sessions: WorkoutSession[],
  exerciseName: string
): ExerciseHistorySummary | null {
  const normalizedTarget = exerciseName.trim().toLowerCase();
  const matchingSessions: ExerciseHistorySummary['sessions'] = [];
  let foundEquipment: EquipmentType = 'barbell';
  let foundRepRange: string = '8-12';
  let foundRir: number = 2;

  // Filter completed sessions, sort chronologically ascending
  const sortedSessions = [...sessions]
    .filter((s) => s.status === 'completed')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const session of sortedSessions) {
    const exercise = session.exercises.find(
      (e) => e.name.trim().toLowerCase() === normalizedTarget
    );
    if (!exercise) continue;

    foundEquipment = exercise.equipment || foundEquipment;
    if (exercise.repRange) foundRepRange = exercise.repRange;
    if (exercise.targetRir !== undefined) foundRir = exercise.targetRir;

    const workingSets = exercise.sets.filter((s) => s.completed && !s.skipped && s.type === 'working');
    const warmupSets = exercise.sets.filter((s) => s.completed && !s.skipped && s.type === 'warmup');

    if (workingSets.length === 0 && warmupSets.length === 0) continue;

    const totalVolume = calculateVolumeLoad(workingSets, false);
    const topWeight = Math.max(...workingSets.map((s) => Number(s.weight) || 0), 0);

    // Calculate best estimated 1RM among working sets
    let best1RM = 0;
    for (const s of workingSets) {
      const e1rm = calculateEpley1RM(Number(s.weight) || 0, Number(s.reps) || 0);
      if (e1rm > best1RM) best1RM = e1rm;
    }

    // Average logged RIR
    const rirList = workingSets.filter((s) => s.rir !== undefined).map((s) => s.rir as number);
    const avgRir = rirList.length > 0 ? rirList.reduce((a, b) => a + b, 0) / rirList.length : undefined;

    matchingSessions.push({
      sessionId: session.id,
      date: session.date,
      workingSets,
      warmupSets,
      totalVolume,
      topWeight,
      avgRir,
      estimated1RM: best1RM
    });
  }

  if (matchingSessions.length === 0) return null;

  return {
    exerciseName,
    equipment: foundEquipment,
    repRange: foundRepRange,
    targetRir: foundRir,
    sessions: matchingSessions
  };
}

/**
 * Deterministic Double Progression Engine.
 * Evaluates the actual completed sets against prescribed rep range and programmed RIR,
 * with customizable plan-specific overload configurations.
 */
export function generateProgressionRecommendation(
  history: ExerciseHistorySummary | null,
  profile: UserProfile,
  exerciseName: string,
  equipment: EquipmentType,
  prescribedRepRange: string = '8-12',
  prescribedRir: number = 2,
  planConfig?: OverloadAnalyticsConfig
): ProgressiveOverloadRecommendation {
  const timestamp = new Date().toISOString();
  const effectiveRepRange = planConfig?.prescribedRepRange || prescribedRepRange || '8-12';
  const effectiveRir = planConfig?.prescribedRir !== undefined ? planConfig.prescribedRir : prescribedRir;
  const { min: minReps, max: maxReps } = parseRepRange(effectiveRepRange);
  const phase: TrainingPhase = planConfig?.trainingPhase || profile.trainingPhase || 'hypertrophy';
  const strategy: ProgressionStrategy = planConfig?.progressionStrategy || 'double_progression';

  // Fallback / Provisional when no history is present
  if (!history || history.sessions.length === 0) {
    return {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      exerciseName,
      equipment,
      ruleApplied: 'E_NEW_BASELINE',
      ruleTitle: 'Provisional Baseline (Rule E)',
      currentWeight: 0,
      currentRepsSummary: 'No completed session yet',
      recommendedWeight: equipment === 'barbell' ? 20 : equipment === 'dumbbell' ? 10 : 25,
      recommendedRepTarget: `${minReps} reps`,
      explanation: `New exercise with insufficient recorded history. Perform baseline sets within ${effectiveRepRange} reps at RIR ${effectiveRir} to establish your calibrated starting load for "${planConfig?.planName || 'your routine'}".`,
      trainingPhase: phase,
      planId: planConfig?.planId,
      planName: planConfig?.planName,
      strategyUsed: strategy,
      flags: { isProvisional: true },
      userAction: 'pending',
      timestamp
    };
  }

  const latestSession = history.sessions[history.sessions.length - 1];
  const previousSession = history.sessions.length >= 2 ? history.sessions[history.sessions.length - 2] : null;

  const latestWorkingSets = latestSession.workingSets;
  if (latestWorkingSets.length === 0) {
    return {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      exerciseName,
      equipment,
      ruleApplied: 'E_NEW_BASELINE',
      ruleTitle: 'Provisional Baseline (Rule E)',
      currentWeight: 0,
      currentRepsSummary: 'No working sets logged in last session',
      recommendedWeight: 20,
      recommendedRepTarget: `${minReps} reps`,
      explanation: `No completed working sets were recorded in the latest session. Complete at least one working set to unlock progression analysis.`,
      trainingPhase: phase,
      planId: planConfig?.planId,
      planName: planConfig?.planName,
      strategyUsed: strategy,
      flags: { isProvisional: true },
      userAction: 'pending',
      timestamp
    };
  }

  const currentWeight = latestWorkingSets[0].weight;
  const currentReps = latestWorkingSets.map((s) => s.reps);
  const currentRepsSummary = `${currentWeight} kg × [${currentReps.join(', ')}] reps`;

  const previousWorkingSets = previousSession ? previousSession.workingSets : [];
  const previousWeight = previousWorkingSets.length > 0 ? previousWorkingSets[0].weight : undefined;
  const previousReps = previousWorkingSets.map((s) => s.reps);
  const previousRepsSummary = previousWorkingSets.length > 0 ? `${previousWeight} kg × [${previousReps.join(', ')}] reps` : undefined;

  // Determine load increment (supports plan-level / exercise-level override)
  let increment = 2.5;
  if (planConfig?.customIncrement !== undefined && planConfig.customIncrement > 0) {
    increment = planConfig.customIncrement;
  } else if (equipment === 'dumbbell') {
    increment = profile.minDumbbellIncrement || 2.0;
  } else if (equipment === 'barbell') {
    increment = profile.minBarbellIncrement || 2.5;
  } else if (equipment === 'machine' || equipment === 'cable') {
    increment = profile.minMachineIncrement || 2.5;
  } else if (equipment === 'bodyweight') {
    increment = 0; // handled via reps or weight
  }

  // Safety Phase Check: Re-entry / Adaptation / Deload
  if (phase === 'deload') {
    const deloadWeight = Number((currentWeight * 0.75).toFixed(1));
    return {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      exerciseName,
      equipment,
      ruleApplied: 'C_REPS_DECLINED',
      ruleTitle: 'Deload Phase Modulation',
      currentWeight,
      currentRepsSummary,
      previousWeight,
      previousRepsSummary,
      recommendedWeight: deloadWeight,
      recommendedRepTarget: `${minReps} reps`,
      explanation: `Deload phase active for ${planConfig?.planName || 'training plan'}. Reduce intensity to ~75% (${deloadWeight} kg) with lower working set volume to dissipate systemic fatigue and facilitate tissue recovery.`,
      trainingPhase: phase,
      planId: planConfig?.planId,
      planName: planConfig?.planName,
      strategyUsed: strategy,
      flags: { recoveryAlert: false },
      userAction: 'pending',
      timestamp
    };
  }

  if (phase === 're_entry' || phase === 'adaptation') {
    return {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      exerciseName,
      equipment,
      ruleApplied: 'B_REPS_IMPROVED',
      ruleTitle: `${phase === 're_entry' ? 'Re-entry' : 'Adaptation'} Phase Guardrail`,
      currentWeight,
      currentRepsSummary,
      previousWeight,
      previousRepsSummary,
      recommendedWeight: currentWeight,
      recommendedRepTarget: `${Math.min(minReps + 1, maxReps)} reps`,
      explanation: `Prioritizing anatomical adaptation, movement groove, and connective tissue recovery in ${planConfig?.planName || 'this routine'}. Hold ${currentWeight} kg steady and accumulate crisp repetitions without aggressive load jumps.`,
      trainingPhase: phase,
      planId: planConfig?.planId,
      planName: planConfig?.planName,
      strategyUsed: strategy,
      flags: {},
      userAction: 'pending',
      timestamp
    };
  }

  // Bodyweight movements
  if (equipment === 'bodyweight') {
    const allAtTop = currentReps.every((r) => r >= maxReps);
    if (allAtTop) {
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'F_BODYWEIGHT',
        ruleTitle: 'Bodyweight Progression (Rule F)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: currentWeight > 0 ? currentWeight + (planConfig?.customIncrement || 2.5) : (planConfig?.customIncrement || 2.5),
        recommendedRepTarget: `${minReps} reps`,
        explanation: `All bodyweight sets achieved the top of range (${maxReps} reps). Recommended next step: introduce +${planConfig?.customIncrement || 2.5} kg external loading (dip belt/vest) or advance to a more challenging movement variation.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    } else {
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'B_REPS_IMPROVED',
        ruleTitle: 'Bodyweight Rep Accumulation',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: currentWeight,
        recommendedRepTarget: `+1 rep across sets`,
        explanation: `Continue unweighted. Aim to add 1-2 repetitions across working sets until you can hit ${maxReps} reps across all sets.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    }
  }

  // Multi-session fatigue check (Rule D)
  if (history.sessions.length >= 3) {
    const last3 = history.sessions.slice(-3);
    const vol1 = last3[0].totalVolume;
    const vol2 = last3[1].totalVolume;
    const vol3 = last3[2].totalVolume;
    const isConsecutiveDecline = vol3 < vol2 && vol2 < vol1 && vol3 < vol1 * 0.85;

    if (isConsecutiveDecline) {
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'D_MULTI_SESSION_DECLINE',
        ruleTitle: 'Recovery & Fatigue Alert (Rule D)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: currentWeight,
        recommendedRepTarget: `${minReps} reps`,
        explanation: `Performance has fallen across multiple consecutive sessions in ${planConfig?.planName || 'your routine'}. This pattern flags potential accumulated systemic fatigue or insufficient recovery. Do not increase weight. Review total weekly training volume, sleep duration, and nutrition intake.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: { recoveryAlert: true, volumeWarning: true },
        userAction: 'pending',
        timestamp
      };
    }
  }

  // --- STRATEGY A: TOP-SET ONLY PROGRESSION ---
  if (strategy === 'top_set_only') {
    const topSetHit = currentReps.length > 0 && currentReps[0] >= maxReps;
    if (topSetHit) {
      const nextWeight = Number((currentWeight + increment).toFixed(1));
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'A_TOP_REPS_ACHIEVED',
        ruleTitle: 'Top-Set Progression Satisfied (Plan Overload Rule)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: nextWeight,
        recommendedRepTarget: `${minReps} reps`,
        explanation: `Your lead working set achieved ${currentReps[0]} reps (target: ${maxReps}). Per your uploaded plan's Top-Set Progression rule, advance load by +${increment} kg to ${nextWeight} kg next session.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    }
  }

  // --- STRATEGY B: CONSECUTIVE SESSIONS STABILITY ---
  if (strategy === 'consecutive_sessions') {
    const allReachedTopCurrent = currentReps.length > 0 && currentReps.every((r) => r >= maxReps);
    const allReachedTopPrev = previousReps.length > 0 && previousReps.every((r) => r >= maxReps);

    if (allReachedTopCurrent && allReachedTopPrev) {
      const nextWeight = Number((currentWeight + increment).toFixed(1));
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'A_TOP_REPS_ACHIEVED',
        ruleTitle: 'Dual-Session Consolidation Complete (Rule A)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: nextWeight,
        recommendedRepTarget: `${minReps} reps`,
        explanation: `Confirmed top reps (${maxReps}) across 2 consecutive sessions at ${currentWeight} kg with solid execution. Conservative overload verified: increment load by +${increment} kg to ${nextWeight} kg.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    } else if (allReachedTopCurrent && !allReachedTopPrev) {
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'B_REPS_IMPROVED',
        ruleTitle: 'Consolidate Form (Dual-Session Rule)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: currentWeight,
        recommendedRepTarget: `${maxReps} reps`,
        explanation: `First session hitting ${maxReps} reps achieved. As configured in your plan's 2-session criteria, repeat ${currentWeight} kg once more to confirm mastery before increasing weight.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    }
  }

  // --- STRATEGY C: LINEAR LOAD ---
  if (strategy === 'linear_load') {
    const allAboveMin = currentReps.length > 0 && currentReps.every((r) => r >= minReps);
    if (allAboveMin) {
      const nextWeight = Number((currentWeight + increment).toFixed(1));
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'A_TOP_REPS_ACHIEVED',
        ruleTitle: 'Linear Overload Target Met',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: nextWeight,
        recommendedRepTarget: `${minReps} reps`,
        explanation: `All working sets achieved target threshold (${minReps}+ reps). Progress load linearly by +${increment} kg to ${nextWeight} kg.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    }
  }

  // --- STANDARD DOUBLE PROGRESSION (RULE A) ---
  const allReachedTop = currentReps.length > 0 && currentReps.every((r) => r >= maxReps);
  const meetsRir = latestSession.avgRir === undefined || latestSession.avgRir >= effectiveRir - 0.5;

  if (allReachedTop && meetsRir) {
    const nextWeight = Number((currentWeight + increment).toFixed(1));
    return {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      exerciseName,
      equipment,
      ruleApplied: 'A_TOP_REPS_ACHIEVED',
      ruleTitle: 'Target Criteria Met — Load Increase (Rule A)',
      currentWeight,
      currentRepsSummary,
      previousWeight,
      previousRepsSummary,
      recommendedWeight: nextWeight,
      recommendedRepTarget: `${minReps} reps`,
      explanation: `All prescribed working sets reached the top of the repetition range (${maxReps} reps) at ${currentWeight} kg with target effort (${effectiveRir} RIR). Double progression satisfied: advance load by +${increment} kg to ${nextWeight} kg for ${planConfig?.planName || 'your routine'}. Repetitions will reset toward ${minReps} reps.`,
      trainingPhase: phase,
      planId: planConfig?.planId,
      planName: planConfig?.planName,
      strategyUsed: strategy,
      flags: {},
      userAction: 'pending',
      timestamp
    };
  }

  // Check if repetitions declined from immediate previous session at same weight (Rule C)
  if (previousSession && previousWeight === currentWeight) {
    const prevTotalReps = previousReps.reduce((a, b) => a + b, 0);
    const currTotalReps = currentReps.reduce((a, b) => a + b, 0);

    if (currTotalReps < prevTotalReps - 2) {
      return {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        exerciseName,
        equipment,
        ruleApplied: 'C_REPS_DECLINED',
        ruleTitle: 'Repetition Dip — Repeat Load (Rule C)',
        currentWeight,
        currentRepsSummary,
        previousWeight,
        previousRepsSummary,
        recommendedWeight: currentWeight,
        recommendedRepTarget: `Recover previous rep count (${prevTotalReps} total)`,
        explanation: `Repetitions decreased (${currTotalReps} total vs ${prevTotalReps} previously) at ${currentWeight} kg. Repeat the current load. Ensure 2-3 minutes of rest between sets and assess acute session fatigue before adjusting weight.`,
        trainingPhase: phase,
        planId: planConfig?.planId,
        planName: planConfig?.planName,
        strategyUsed: strategy,
        flags: {},
        userAction: 'pending',
        timestamp
      };
    }
  }

  // --- RULE B: REPETITIONS IMPROVED BUT TOP OF RANGE NOT REACHED ---
  const lowestRep = Math.min(...currentReps);
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    exerciseName,
    equipment,
    ruleApplied: 'B_REPS_IMPROVED',
    ruleTitle: 'Accumulate Repetitions (Rule B)',
    currentWeight,
    currentRepsSummary,
    previousWeight,
    previousRepsSummary,
    recommendedWeight: currentWeight,
    recommendedRepTarget: `${Math.min(lowestRep + 1, maxReps)} reps`,
    explanation: `Stay at ${currentWeight} kg. Working sets have not yet filled the upper boundary of your ${effectiveRepRange} repetition target in "${planConfig?.planName || 'your routine'}". Strive to add 1-2 repetitions to your trailing sets next session while maintaining crisp form.`,
    trainingPhase: phase,
    planId: planConfig?.planId,
    planName: planConfig?.planName,
    strategyUsed: strategy,
    flags: {},
    userAction: 'pending',
    timestamp
  };
}
