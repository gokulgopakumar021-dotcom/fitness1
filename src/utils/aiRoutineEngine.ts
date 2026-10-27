import { EquipmentType, LoggedExercise, PlannedExercise, UserProfile, WorkoutDay, WorkoutPlan, WorkoutSession } from '../types';
import { MUSCLE_REGIONS, MuscleRegionId, isMuscleRegionId } from './muscleMap/regions';
import { buildMuscleMapSummary, LoadStatus } from './muscleMap/trainingLoad';
import { inferMuscleGroup } from './recoveryAnalytics';

export type RecoveryLevel = 'fresh' | 'recovered' | 'recovering' | 'fatigued';
export type RoutineActionRecommendation = 'primary_target' | 'secondary_volume' | 'active_recovery' | 'rest_deload';

export interface MuscleRegionFatigueReport {
  regionId: MuscleRegionId;
  label: string;
  status: LoadStatus;
  setsPast7Days: number;
  lastTrainedDay: string | null;
  daysSinceLastTrained: number | null;
  recoveryStatus: RecoveryLevel;
  recommendation: RoutineActionRecommendation;
}

export interface AiRoutineExerciseSubstitute {
  name: string;
  equipment: EquipmentType;
  reason: string;
}

export interface AiRoutineExercise {
  id: string;
  name: string;
  muscleGroup: string;
  muscleRegionId: MuscleRegionId;
  equipment: EquipmentType;
  workingSets: number;
  repRange: string;
  targetRir: number;
  restSeconds: number;
  tempo?: string;
  notes?: string;
  fatigueRationale: string;
  substitutes: AiRoutineExerciseSubstitute[];
}

export interface AiGeneratedRoutine {
  id: string;
  routineName: string;
  targetSplit: string;
  durationMinutes: number;
  summaryRationale: string;
  targetedMuscles: string[];
  restedMuscles: string[];
  exercises: AiRoutineExercise[];
  equipmentUsed: EquipmentType[];
  createdAt: string;
  isAiGenerated: boolean;
  isOfflineFallback?: boolean;
}

/**
 * Extracts equipment types used across the athlete's recent completed sessions.
 */
export function extractRecentEquipment(sessions: readonly WorkoutSession[]): EquipmentType[] {
  const completed = (sessions || [])
    .filter((s) => s && s.status === 'completed' && Array.isArray(s.exercises))
    .slice(0, 15); // Look at last 15 completed sessions

  const equipmentSet = new Set<EquipmentType>();

  completed.forEach((session) => {
    session.exercises.forEach((ex) => {
      if (ex && ex.equipment) {
        equipmentSet.add(ex.equipment);
      }
    });
  });

  // Default to common equipment if none logged yet
  if (equipmentSet.size === 0) {
    return ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
  }

  return Array.from(equipmentSet);
}

/**
 * Generates a comprehensive fatigue and recovery report for each canonical muscle region.
 */
export function summarizeMuscleHeatmapForAi(
  sessions: readonly WorkoutSession[],
  now: Date = new Date(),
  isDemoMode: boolean = false
): MuscleRegionFatigueReport[] {
  const summary = buildMuscleMapSummary(sessions, now, { dataset: isDemoMode ? 'demo' : 'real' });
  const todayMs = now.getTime();

  return MUSCLE_REGIONS.map((region) => {
    const data = summary.regions[region.id];
    const sets7d = data?.currentPeriodSets || 0;
    const lastDay = data?.lastTrainedDay || null;

    let daysAgo: number | null = null;
    if (lastDay) {
      const parts = lastDay.split('-').map(Number);
      if (parts.length === 3) {
        const lastDate = new Date(parts[0], parts[1] - 1, parts[2]);
        daysAgo = Math.max(0, Math.floor((todayMs - lastDate.getTime()) / (24 * 60 * 60 * 1000)));
      }
    }

    // Determine recovery classification
    let recoveryStatus: RecoveryLevel = 'recovered';
    let recommendation: RoutineActionRecommendation = 'primary_target';

    if (daysAgo === 0 || daysAgo === 1) {
      // Trained today or yesterday
      recoveryStatus = sets7d >= 10 ? 'fatigued' : 'recovering';
      recommendation = sets7d >= 10 ? 'rest_deload' : 'active_recovery';
    } else if (daysAgo === 2 || daysAgo === 3) {
      // Trained 2-3 days ago
      if (data?.status === 'heavier') {
        recoveryStatus = 'recovering';
        recommendation = 'secondary_volume';
      } else {
        recoveryStatus = 'recovered';
        recommendation = 'primary_target';
      }
    } else {
      // 4+ days ago or never trained in recent window
      recoveryStatus = 'fresh';
      recommendation = 'primary_target';
    }

    return {
      regionId: region.id,
      label: region.label,
      status: data?.status || 'no_recent_work',
      setsPast7Days: sets7d,
      lastTrainedDay: lastDay,
      daysSinceLastTrained: daysAgo,
      recoveryStatus,
      recommendation
    };
  });
}

/**
 * Evaluates the fatigue heatmap to automatically identify the most optimal training split.
 */
export function recommendOptimalSplitFromHeatmap(reports: MuscleRegionFatigueReport[]): {
  recommendedSplit: string;
  rationale: string;
  primaryMuscles: string[];
  restMuscles: string[];
} {
  const reportMap = new Map(reports.map((r) => [r.regionId, r]));

  const chest = reportMap.get('chest');
  const shoulders = reportMap.get('shoulders');
  const back = reportMap.get('back');
  const arms = reportMap.get('arms');
  const quads = reportMap.get('quadriceps');
  const hamGlutes = reportMap.get('hamstrings_glutes');
  const core = reportMap.get('core');

  // Compute readiness scores (higher = fresher)
  const scoreRegion = (r?: MuscleRegionFatigueReport): number => {
    if (!r) return 5;
    if (r.recoveryStatus === 'fresh') return 10;
    if (r.recoveryStatus === 'recovered') return 7;
    if (r.recoveryStatus === 'recovering') return 3;
    return 0; // fatigued
  };

  const pushScore = (scoreRegion(chest) * 1.5 + scoreRegion(shoulders) + scoreRegion(arms) * 0.7) / 3.2;
  const pullScore = (scoreRegion(back) * 1.5 + scoreRegion(arms) + scoreRegion(core) * 0.5) / 3.0;
  const legsScore = (scoreRegion(quads) * 1.2 + scoreRegion(hamGlutes) * 1.2) / 2.4;
  const upperScore = (pushScore + pullScore) / 2;
  const lowerScore = legsScore;

  const pushFresh = (chest?.recoveryStatus === 'fresh' || chest?.recoveryStatus === 'recovered') &&
                    (shoulders?.recoveryStatus === 'fresh' || shoulders?.recoveryStatus === 'recovered');

  const pullFresh = (back?.recoveryStatus === 'fresh' || back?.recoveryStatus === 'recovered');
  const legsFresh = (quads?.recoveryStatus === 'fresh' || quads?.recoveryStatus === 'recovered') &&
                    (hamGlutes?.recoveryStatus === 'fresh' || hamGlutes?.recoveryStatus === 'recovered');

  const fatiguedList: string[] = reports
    .filter((r) => r.recoveryStatus === 'fatigued' || r.recoveryStatus === 'recovering')
    .map((r) => r.label);

  if (pushScore >= pullScore && pushScore >= legsScore && pushFresh) {
    return {
      recommendedSplit: 'Push (Chest, Shoulders & Triceps)',
      rationale: `Anterior pushing chain is primed with ${chest?.setsPast7Days || 0} sets on chest and ${shoulders?.setsPast7Days || 0} sets on shoulders in the past week.`,
      primaryMuscles: ['Chest', 'Shoulders', 'Arms'],
      restMuscles: fatiguedList
    };
  }

  if (pullScore >= pushScore && pullScore >= legsScore && pullFresh) {
    return {
      recommendedSplit: 'Pull (Back, Lats & Biceps)',
      rationale: `Posterior pulling chain is fully recovered with ${back?.setsPast7Days || 0} sets on back/lats in the past week.`,
      primaryMuscles: ['Back / Lats', 'Arms', 'Core / Lower Back'],
      restMuscles: fatiguedList
    };
  }

  if (legsFresh) {
    return {
      recommendedSplit: 'Legs & Lower Body (Quads & Posterior Chain)',
      rationale: `Lower body musculature is ready for loading with fresh quads and glutes.`,
      primaryMuscles: ['Quadriceps', 'Hamstrings / Glutes', 'Calves'],
      restMuscles: fatiguedList
    };
  }

  return {
    recommendedSplit: 'Full Body (Adaptive Recovery Focus)',
    rationale: 'Balanced full-body stimulus targeting freshest regional muscle fibers while avoiding overloaded stabilizers.',
    primaryMuscles: reports.filter((r) => r.recoveryStatus === 'fresh').map((r) => r.label),
    restMuscles: fatiguedList
  };
}

// Built-in evidence-based exercise database for intelligent offline fallback
interface ExerciseCatalogItem {
  name: string;
  muscleGroup: string;
  regionId: MuscleRegionId;
  equipment: EquipmentType;
  compound: boolean;
  defaultRepRange: string;
  defaultRir: number;
  restSecs: number;
  tempo: string;
  notes: string;
  substitutes: AiRoutineExerciseSubstitute[];
}

const EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  // Chest
  {
    name: 'Barbell Bench Press',
    muscleGroup: 'Chest',
    regionId: 'chest',
    equipment: 'barbell',
    compound: true,
    defaultRepRange: '6-8',
    defaultRir: 2,
    restSecs: 120,
    tempo: '3-0-1-0',
    notes: 'Retract scapulae, maintain consistent arch and touch lower sternum.',
    substitutes: [
      { name: 'Dumbbell Bench Press', equipment: 'dumbbell', reason: 'Allows greater humeral adduction with individual limb control.' },
      { name: 'Chest Press Machine', equipment: 'machine', reason: 'Eliminates stabilizing demands for pure pectoral output.' }
    ]
  },
  {
    name: 'Incline Dumbbell Press',
    muscleGroup: 'Chest',
    regionId: 'chest',
    equipment: 'dumbbell',
    compound: true,
    defaultRepRange: '8-12',
    defaultRir: 2,
    restSecs: 90,
    tempo: '3-1-1-0',
    notes: 'Set bench to 30 degrees to bias clavicular pectoralis head.',
    substitutes: [
      { name: 'Incline Smith Machine Press', equipment: 'machine', reason: 'Fixed plane of motion isolates upper chest fibers.' },
      { name: 'Low-to-High Cable Fly', equipment: 'cable', reason: 'Continuous tension through peak contraction.' }
    ]
  },
  {
    name: 'Standing Cable Fly',
    muscleGroup: 'Chest',
    regionId: 'chest',
    equipment: 'cable',
    compound: false,
    defaultRepRange: '10-15',
    defaultRir: 1,
    restSecs: 75,
    tempo: '2-1-1-1',
    notes: 'Cross hands at midline for maximum pectoral shortened position.',
    substitutes: [
      { name: 'Dumbbell Chest Fly', equipment: 'dumbbell', reason: 'Free weight alternative emphasizing deep stretch.' },
      { name: 'Pec Deck Machine', equipment: 'machine', reason: 'Eliminates elbow strain while maintaining horizontal adduction.' }
    ]
  },
  {
    name: 'Push-Ups (Deficit or Weighted)',
    muscleGroup: 'Chest',
    regionId: 'chest',
    equipment: 'bodyweight',
    compound: true,
    defaultRepRange: '12-20',
    defaultRir: 1,
    restSecs: 60,
    tempo: '2-0-1-0',
    notes: 'Brace core and squeeze pectorals at top lockout.',
    substitutes: [
      { name: 'Dips (Chest Lean)', equipment: 'bodyweight', reason: 'Higher vertical pressing demand on lower pec fibers.' }
    ]
  },

  // Shoulders
  {
    name: 'Overhead Barbell Press',
    muscleGroup: 'Shoulders',
    regionId: 'shoulders',
    equipment: 'barbell',
    compound: true,
    defaultRepRange: '6-8',
    defaultRir: 2,
    restSecs: 120,
    tempo: '2-1-1-0',
    notes: 'Squeeze glutes, press vertically through head window.',
    substitutes: [
      { name: 'Seated Dumbbell Shoulder Press', equipment: 'dumbbell', reason: 'Better shoulder joint articulation freedom.' },
      { name: 'Shoulder Press Machine', equipment: 'machine', reason: 'Safely limits spinal loading.' }
    ]
  },
  {
    name: 'Dumbbell Lateral Raise',
    muscleGroup: 'Shoulders',
    regionId: 'shoulders',
    equipment: 'dumbbell',
    compound: false,
    defaultRepRange: '12-15',
    defaultRir: 1,
    restSecs: 60,
    tempo: '2-0-1-1',
    notes: 'Slight torso forward lean; raise in scapular plane (30 degrees forward).',
    substitutes: [
      { name: 'Cable Lateral Raise', equipment: 'cable', reason: 'Even resistance profile throughout abduction arc.' },
      { name: 'Machine Lateral Raise', equipment: 'machine', reason: 'Locked isolation of medial deltoid.' }
    ]
  },
  {
    name: 'Face Pulls with Rope',
    muscleGroup: 'Shoulders',
    regionId: 'shoulders',
    equipment: 'cable',
    compound: false,
    defaultRepRange: '12-16',
    defaultRir: 2,
    restSecs: 60,
    tempo: '2-1-1-1',
    notes: 'Pull to eye level while externally rotating forearms back.',
    substitutes: [
      { name: 'Rear Delt Dumbbell Fly', equipment: 'dumbbell', reason: 'Hinged posterior delt targeting with free weights.' },
      { name: 'Reverse Pec Deck', equipment: 'machine', reason: 'High rear delt activation with guided stabilization.' }
    ]
  },

  // Back / Lats
  {
    name: 'Barbell Bent-Over Row',
    muscleGroup: 'Back / Lats',
    regionId: 'back',
    equipment: 'barbell',
    compound: true,
    defaultRepRange: '6-10',
    defaultRir: 2,
    restSecs: 120,
    tempo: '3-0-1-1',
    notes: 'Hinge at 45 degrees, drive elbows back towards hip pocket.',
    substitutes: [
      { name: 'One-Arm Dumbbell Row', equipment: 'dumbbell', reason: 'Supported torso protects lower back during pulling.' },
      { name: 'Chest-Supported T-Bar Row', equipment: 'machine', reason: 'Zero axial spine loading while overloading lat fibers.' }
    ]
  },
  {
    name: 'Lat Pulldown (Neutral or Wide Grip)',
    muscleGroup: 'Back / Lats',
    regionId: 'back',
    equipment: 'cable',
    compound: true,
    defaultRepRange: '8-12',
    defaultRir: 2,
    restSecs: 90,
    tempo: '2-1-1-0',
    notes: 'Drive elbows down and back, avoid excessive backward swinging.',
    substitutes: [
      { name: 'Pull-Ups / Chin-Ups', equipment: 'bodyweight', reason: 'Kinesthetic closed-chain vertical pulling benchmark.' },
      { name: 'Diverging Lat Machine', equipment: 'machine', reason: 'Independent bilateral lat recruitment.' }
    ]
  },
  {
    name: 'Seated Cable Row',
    muscleGroup: 'Back / Lats',
    regionId: 'back',
    equipment: 'cable',
    compound: true,
    defaultRepRange: '10-12',
    defaultRir: 2,
    restSecs: 75,
    tempo: '2-1-1-1',
    notes: 'Allow full scapular protraction forward, squeeze rhomboids on retraction.',
    substitutes: [
      { name: 'Dumbbell Chest-Supported Row', equipment: 'dumbbell', reason: 'Isolated upper back hypertrophy without spinal fatigue.' }
    ]
  },

  // Legs (Quads)
  {
    name: 'Barbell Back Squat',
    muscleGroup: 'Quadriceps',
    regionId: 'quadriceps',
    equipment: 'barbell',
    compound: true,
    defaultRepRange: '5-8',
    defaultRir: 2,
    restSecs: 150,
    tempo: '3-1-1-0',
    notes: 'Deep knee flexion past parallel with knees tracking over toes.',
    substitutes: [
      { name: 'Leg Press (Quad Focus)', equipment: 'machine', reason: 'High quad overload with lower axial fatigue.' },
      { name: 'Goblet Squat', equipment: 'dumbbell', reason: 'Upright torso quad bias with free weights.' },
      { name: 'Bulgarian Split Squat', equipment: 'dumbbell', reason: 'Unilateral quad overload with minimal spinal load.' }
    ]
  },
  {
    name: 'Leg Extension Machine',
    muscleGroup: 'Quadriceps',
    regionId: 'quadriceps',
    equipment: 'machine',
    compound: false,
    defaultRepRange: '10-15',
    defaultRir: 1,
    restSecs: 60,
    tempo: '2-1-1-1',
    notes: 'Pause at full knee extension for peak rectus femoris recruitment.',
    substitutes: [
      { name: 'Dumbbell Walking Lunge', equipment: 'dumbbell', reason: 'Dynamic quad and glute stability work.' },
      { name: 'Bodyweight Sissy Squat', equipment: 'bodyweight', reason: 'Strict quad isolation without machines.' }
    ]
  },

  // Legs (Hamstrings / Glutes)
  {
    name: 'Romanian Deadlift (Barbell or Dumbbell)',
    muscleGroup: 'Hamstrings / Glutes',
    regionId: 'hamstrings_glutes',
    equipment: 'barbell',
    compound: true,
    defaultRepRange: '8-10',
    defaultRir: 2,
    restSecs: 120,
    tempo: '3-1-1-0',
    notes: 'Push hips straight back with soft knees until deep hamstring stretch.',
    substitutes: [
      { name: 'Dumbbell Romanian Deadlift', equipment: 'dumbbell', reason: 'Allows keeping weight closer to center of gravity.' },
      { name: 'Seated Hamstring Leg Curl', equipment: 'machine', reason: 'Isolates hamstring flexor function without lower back fatigue.' }
    ]
  },
  {
    name: 'Lying or Seated Leg Curl',
    muscleGroup: 'Hamstrings / Glutes',
    regionId: 'hamstrings_glutes',
    equipment: 'machine',
    compound: false,
    defaultRepRange: '10-14',
    defaultRir: 1,
    restSecs: 75,
    tempo: '3-0-1-1',
    notes: 'Point toes toward shins to prevent calf cramping during flexion.',
    substitutes: [
      { name: 'Dumbbell Hamstring Curl', equipment: 'dumbbell', reason: 'Bench lying curl alternative.' },
      { name: 'Nordic Hamstring Curl', equipment: 'bodyweight', reason: 'Intense eccentric hamstring strengthener.' }
    ]
  },

  // Arms
  {
    name: 'Incline Dumbbell Biceps Curl',
    muscleGroup: 'Arms',
    regionId: 'arms',
    equipment: 'dumbbell',
    compound: false,
    defaultRepRange: '10-12',
    defaultRir: 1,
    restSecs: 60,
    tempo: '3-0-1-1',
    notes: 'Full supination and stretch of the long biceps head at the bottom.',
    substitutes: [
      { name: 'Barbell / EZ-Bar Biceps Curl', equipment: 'barbell', reason: 'Heavy loading potential for arm hypertrophy.' },
      { name: 'Cable Biceps Curl', equipment: 'cable', reason: 'Constant mechanical tension throughout the arc.' }
    ]
  },
  {
    name: 'Cable Triceps Pushdown',
    muscleGroup: 'Arms',
    regionId: 'arms',
    equipment: 'cable',
    compound: false,
    defaultRepRange: '10-14',
    defaultRir: 1,
    restSecs: 60,
    tempo: '2-0-1-1',
    notes: 'Lock elbows at ribs; flare rope or depress bar to full extension.',
    substitutes: [
      { name: 'Dumbbell Overhead Triceps Extension', equipment: 'dumbbell', reason: 'Long head triceps stretch bias.' },
      { name: 'Dips / Bench Dips', equipment: 'bodyweight', reason: 'Compound triceps builder using bodyweight.' }
    ]
  },

  // Calves
  {
    name: 'Standing Calf Raise',
    muscleGroup: 'Calves',
    regionId: 'calves',
    equipment: 'machine',
    compound: false,
    defaultRepRange: '12-16',
    defaultRir: 1,
    restSecs: 60,
    tempo: '3-2-1-1',
    notes: '2-second deep pause in the stretched bottom position to eliminate Achilles elastic rebound.',
    substitutes: [
      { name: 'Single-Leg Dumbbell Calf Raise', equipment: 'dumbbell', reason: 'Unilateral calf strengthener on step platform.' },
      { name: 'Bodyweight Deficit Calf Raise', equipment: 'bodyweight', reason: 'High-rep calisthenic calf overload.' }
    ]
  },

  // Core
  {
    name: 'Hanging Leg / Knee Raise',
    muscleGroup: 'Core / Lower Back',
    regionId: 'core',
    equipment: 'bodyweight',
    compound: false,
    defaultRepRange: '10-15',
    defaultRir: 2,
    restSecs: 60,
    tempo: '2-1-1-0',
    notes: 'Roll pelvis toward sternum rather than swinging legs from hip flexors.',
    substitutes: [
      { name: 'Cable Woodchopper / Pallof Press', equipment: 'cable', reason: 'Anti-rotation rotational core stabilizer.' },
      { name: 'Abdominal Crunch Machine', equipment: 'machine', reason: 'Progressive overload tracking for rectus abdominis.' }
    ]
  }
];

/**
 * Generates an intelligent, deterministic fallback routine when offline or without Gemini API key,
 * strictly matching the user's fatigue heatmap and equipment availability.
 */
export function generateOfflineAdaptiveRoutine(
  heatmapReports: MuscleRegionFatigueReport[],
  availableEquipment: EquipmentType[],
  chosenSplit?: string,
  durationMinutes: number = 55
): AiGeneratedRoutine {
  const allowedEquip = new Set(availableEquipment);
  const splitInfo = recommendOptimalSplitFromHeatmap(heatmapReports);
  const activeSplit = chosenSplit && chosenSplit !== 'auto' ? chosenSplit : splitInfo.recommendedSplit;

  // Filter exercises matching available equipment
  const equipFilteredCatalog = EXERCISE_CATALOG.filter((ex) => allowedEquip.has(ex.equipment));

  // Determine target exercise count based on duration
  const targetExerciseCount = durationMinutes <= 40 ? 4 : durationMinutes <= 60 ? 5 : 7;

  // Classify regions by fatigue
  const freshRegions = new Set(
    heatmapReports
      .filter((r) => r.recoveryStatus === 'fresh' || r.recoveryStatus === 'recovered')
      .map((r) => r.regionId)
  );

  const fatiguedRegions = new Set(
    heatmapReports
      .filter((r) => r.recoveryStatus === 'fatigued')
      .map((r) => r.regionId)
  );

  // Map split to candidate muscle groups
  const splitLower = activeSplit.toLowerCase();
  let candidateRegions: MuscleRegionId[] = [];

  if (splitLower.includes('push')) {
    candidateRegions = ['chest', 'shoulders', 'arms'];
  } else if (splitLower.includes('pull')) {
    candidateRegions = ['back', 'arms', 'core'];
  } else if (splitLower.includes('leg') || splitLower.includes('lower')) {
    candidateRegions = ['quadriceps', 'hamstrings_glutes', 'calves'];
  } else if (splitLower.includes('upper')) {
    candidateRegions = ['chest', 'back', 'shoulders', 'arms'];
  } else {
    // Full body or auto: prioritize fresh regions
    candidateRegions = heatmapReports
      .filter((r) => freshRegions.has(r.regionId))
      .map((r) => r.regionId);
    if (candidateRegions.length === 0) {
      candidateRegions = ['chest', 'back', 'quadriceps', 'shoulders'];
    }
  }

  // Filter out severely fatigued regions if alternatives exist
  const viableRegions = candidateRegions.filter((reg) => !fatiguedRegions.has(reg));
  const finalRegions = viableRegions.length >= 2 ? viableRegions : candidateRegions;

  const selectedExercises: AiRoutineExercise[] = [];
  const usedExerciseNames = new Set<string>();

  // Pick compound movements first for fresh regions
  finalRegions.forEach((regId) => {
    if (selectedExercises.length >= targetExerciseCount) return;
    const candidates = equipFilteredCatalog.filter(
      (ex) => ex.regionId === regId && !usedExerciseNames.has(ex.name)
    );

    // Prefer compound if available
    const picked = candidates.find((c) => c.compound) || candidates[0];
    if (picked) {
      usedExerciseNames.add(picked.name);
      const report = heatmapReports.find((r) => r.regionId === regId);
      const sets7d = report?.setsPast7Days || 0;
      const daysAgo = report?.daysSinceLastTrained;

      const fatigueRationale = report?.recoveryStatus === 'fresh'
        ? `Capitalizes on fully recovered ${picked.muscleGroup} (${sets7d} sets in past week; ${daysAgo !== null ? `${daysAgo}d since session` : 'fresh'}) for peak overload.`
        : `Calibrated with optimal volume for ${picked.muscleGroup} to stimulate hypertrophy without exceeding systemic recovery capacity.`;

      // Filter substitutes by available equipment
      const validSubs = picked.substitutes.filter((sub) => allowedEquip.has(sub.equipment));

      selectedExercises.push({
        id: `ai-ex-${Date.now()}-${selectedExercises.length + 1}`,
        name: picked.name,
        muscleGroup: picked.muscleGroup,
        muscleRegionId: picked.regionId,
        equipment: picked.equipment,
        workingSets: picked.compound ? 3 : 3,
        repRange: picked.defaultRepRange,
        targetRir: picked.defaultRir,
        restSeconds: picked.restSecs,
        tempo: picked.tempo,
        notes: picked.notes,
        fatigueRationale,
        substitutes: validSubs
      });
    }
  });

  // If still need exercises, fill with isolations
  for (const regId of finalRegions) {
    if (selectedExercises.length >= targetExerciseCount) break;
    const candidates = equipFilteredCatalog.filter(
      (ex) => ex.regionId === regId && !usedExerciseNames.has(ex.name)
    );
    if (candidates[0]) {
      const picked = candidates[0];
      usedExerciseNames.add(picked.name);
      const validSubs = picked.substitutes.filter((sub) => allowedEquip.has(sub.equipment));

      selectedExercises.push({
        id: `ai-ex-${Date.now()}-${selectedExercises.length + 1}`,
        name: picked.name,
        muscleGroup: picked.muscleGroup,
        muscleRegionId: picked.regionId,
        equipment: picked.equipment,
        workingSets: 3,
        repRange: picked.defaultRepRange,
        targetRir: picked.defaultRir,
        restSeconds: picked.restSecs,
        tempo: picked.tempo,
        notes: picked.notes,
        fatigueRationale: `Selected to target ${picked.muscleGroup} with ${picked.equipment} resistance matching your available equipment inventory.`,
        substitutes: validSubs
      });
    }
  }

  const targeted = Array.from(new Set(selectedExercises.map((e) => e.muscleGroup)));
  const rested = heatmapReports
    .filter((r) => fatiguedRegions.has(r.regionId) && !selectedExercises.some((e) => e.muscleRegionId === r.regionId))
    .map((r) => r.label);

  return {
    id: `routine-adaptive-${Date.now()}`,
    routineName: `Adaptive ${activeSplit.replace(/\(.*?\)/g, '').trim()} Protocol`,
    targetSplit: activeSplit,
    durationMinutes,
    summaryRationale: `Structured around your logged muscle fatigue heatmap. Direct volume is prioritized for fresh muscle groups (${targeted.join(', ')}), while shielding recovering muscle groups (${rested.length > 0 ? rested.join(', ') : 'none severely fatigued'}) from excessive systemic load. Restricted exclusively to your available equipment (${availableEquipment.join(', ')}).`,
    targetedMuscles: targeted,
    restedMuscles: rested,
    exercises: selectedExercises,
    equipmentUsed: Array.from(new Set(selectedExercises.map((e) => e.equipment))),
    createdAt: new Date().toISOString(),
    isAiGenerated: false,
    isOfflineFallback: true
  };
}

/**
 * Converts an AI generated routine into a full standard WorkoutPlan format
 * for storage in db.savePlans().
 */
export function convertAiRoutineToWorkoutPlan(
  routine: AiGeneratedRoutine,
  profile: UserProfile
): WorkoutPlan {
  const planId = `plan-ai-${Date.now()}`;
  const dayId = `day-${Date.now()}-1`;

  const plannedExercises: PlannedExercise[] = routine.exercises.map((ex, index) => ({
    id: `pex-${Date.now()}-${index + 1}`,
    name: ex.name,
    muscleGroup: ex.muscleGroup,
    equipment: ex.equipment,
    workingSets: ex.workingSets,
    repRange: ex.repRange,
    targetRir: ex.targetRir,
    restSeconds: ex.restSeconds,
    tempo: ex.tempo,
    notes: `${ex.notes ? `${ex.notes} • ` : ''}${ex.fatigueRationale}`,
    progressionStrategy: 'double_progression'
  }));

  const workoutDay: WorkoutDay = {
    id: dayId,
    dayName: routine.routineName,
    dayOrder: 1,
    exercises: plannedExercises
  };

  return {
    id: planId,
    name: routine.routineName,
    trainingSplit: routine.targetSplit,
    description: routine.summaryRationale,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
    isUploaded: false,
    progressionPhase: profile.trainingPhase || 'hypertrophy',
    defaultStrategy: 'double_progression',
    planNotes: `Generated based on muscle fatigue heatmap analysis and equipment availability (${routine.equipmentUsed.join(', ')}).`,
    days: [workoutDay]
  };
}

/**
 * Converts an AI generated routine directly into a live WorkoutSession
 * ready for immediate execution in WorkoutSessionTracker.
 */
export function convertAiRoutineToActiveSession(
  routine: AiGeneratedRoutine,
  activePlanId?: string
): WorkoutSession {
  const todayStr = new Date().toISOString().split('T')[0];
  const sessionId = `session-${Date.now()}`;

  const exercises: LoggedExercise[] = routine.exercises.map((ex, exIndex) => {
    const defaultReps = parseInt(ex.repRange.split('-')[0] || '10', 10);
    const sets = [];

    // Optional warmup for barbell compound lifts
    if (ex.equipment === 'barbell') {
      sets.push({
        id: `set-${Date.now()}-${exIndex}-w`,
        setNumber: 1,
        type: 'warmup' as const,
        weight: 20, // Olympic bar
        reps: 10,
        completed: false,
        timestamp: new Date().toISOString()
      });
    }

    for (let i = 1; i <= ex.workingSets; i++) {
      sets.push({
        id: `set-${Date.now()}-${exIndex}-${i}`,
        setNumber: sets.length + 1,
        type: 'working' as const,
        weight: 0,
        reps: defaultReps,
        rir: ex.targetRir,
        completed: false,
        timestamp: new Date().toISOString()
      });
    }

    return {
      id: `lex-${Date.now()}-${exIndex}`,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      equipment: ex.equipment,
      repRange: ex.repRange,
      targetRir: ex.targetRir,
      restSeconds: ex.restSeconds,
      notes: `${ex.notes ? `${ex.notes} • ` : ''}${ex.fatigueRationale}`,
      isUnilateral: false,
      sets
    };
  });

  return {
    id: sessionId,
    planId: activePlanId,
    dayName: routine.routineName,
    date: todayStr,
    startTime: new Date().toISOString(),
    status: 'in_progress',
    exercises
  };
}
