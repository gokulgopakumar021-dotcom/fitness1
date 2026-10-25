import { EquipmentType, PlannedExercise, TrainingExperience, TrainingPhase, PrimaryGoal } from '../../types';

/** Minimal, privacy-safe context. Deliberately excludes name, age, body weight, photos and body-scan data. */
export interface CoachingContext {
  generatedAt: string; // ISO
  athlete: {
    primaryGoal: PrimaryGoal;
    trainingExperience: TrainingExperience;
    trainingDaysPerWeek: number;
    trainingSplitName: string;
    trainingPhase: TrainingPhase;
    preferredUnit: 'kg' | 'lbs';
  };
  plan: {
    id: string;
    name: string;
    updatedAt: string;
    days: { id: string; dayName: string; dayOrder: number; exercises: PlannedExercise[] }[];
  } | null;
  targetDayId: string | null;
  /** Only populated when an in-progress session exists, so the UI can warn that it will not be altered. */
  activeSessionDayId: string | null;
  exerciseHistory: Record<string, ExerciseEvidence>;
  /** Output of the existing progression engine, per target-day exercise that has real history. */
  progression: Record<string, ProgressionEvidence>;
  recovery: {
    available: boolean;
    overallReadiness: number | null;
    fatigueLevel: 'Low' | 'Optimal' | 'Elevated' | 'High' | null;
    restRecommendedToday: boolean;
    fatiguedMuscleGroups: string[];
  };
  sleep: {
    nightsLogged: number; // within the last 5 days
    avgHours: number | null;
    reliable: boolean; // >= 3 non-demo nights
  };
  /** Exercises the athlete has actually planned or logged. Only these may be suggested as substitutes. */
  knownExercises: { name: string; muscleGroup: string; equipment: EquipmentType }[];
  loggedEquipment: EquipmentType[];
  dataQuality: {
    completedSessions: number; // within the lookback window
    lastSessionDate: string | null;
    daysSinceLastSession: number | null;
    usesDemoData: boolean;
  };
}

export interface ExerciseEvidence {
  sessions: {
    date: string;
    topWeight: number;
    reps: number[];
    totalVolume: number;
    avgRir: number | null;
    plannedSets: number;
    completedSets: number;
    skippedOrIncompleteSets: number;
  }[]; // chronological, newest last, max 4
}

export interface ProgressionEvidence {
  ruleApplied: string;
  ruleTitle: string;
  currentWeight: number;
  recommendedWeight: number;
  recommendedRepTarget: string;
  isProvisional: boolean;
}

export interface EvidenceItem {
  id: string;
  label: string;
  detail: string;
}

export type PlanAdjustment =
  | {
      id: string; // `${exerciseId}:workingSets`
      kind: 'reduce_sets';
      exerciseId: string;
      exerciseName: string;
      from: number;
      to: number;
      reason: string;
      evidenceIds: string[];
    }
  | {
      id: string; // `${exerciseId}:restSeconds`
      kind: 'increase_rest';
      exerciseId: string;
      exerciseName: string;
      from: number;
      to: number;
      reason: string;
      evidenceIds: string[];
    }
  | {
      id: string; // `${exerciseId}:substitute`
      kind: 'substitute_exercise';
      exerciseId: string;
      exerciseName: string;
      from: string;
      to: string;
      substitute: { name: string; muscleGroup: string; equipment: EquipmentType };
      reason: string;
      evidenceIds: string[];
    };

/** Informational only: the plan stores no load, so load changes can be reviewed but not applied. */
export interface ReviewOnlyNote {
  id: string;
  exerciseName: string;
  text: string;
  evidenceIds: string[];
}

export type ReviewStatus = 'ok' | 'no_plan' | 'insufficient_data';
export type ReviewVerdict = 'follow_plan' | 'adjust' | 'lighter_session' | 'none';

export interface AdaptiveReview {
  status: ReviewStatus;
  verdict: ReviewVerdict;
  headline: string;
  /** Deterministic: same inputs give the same fingerprint. Used to match AI text to this review. */
  fingerprint: string;
  generatedAt: string;
  planId: string | null;
  basePlanUpdatedAt: string | null;
  targetDayId: string | null;
  targetDayName: string | null;
  adjustments: PlanAdjustment[];
  notes: ReviewOnlyNote[];
  evidence: EvidenceItem[];
  /** What the athlete needs to provide when status is not 'ok'. */
  missingInfo: string[];
  /** Plain-language limits worth showing (e.g. thin sleep data). */
  caveats: string[];
}

export interface AiExplanation {
  summary: string;
  byAdjustmentId: Record<string, string>;
}
