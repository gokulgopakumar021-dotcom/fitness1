/**
 * AI Workout Mirror - Domain Types
 *
 * All tracking runs strictly on-device in the browser tab.
 * No video, camera frames, photos, or raw landmark streams are ever sent to a server.
 */

export type WorkoutMirrorExerciseId =
  | 'squat'
  | 'pushup'
  | 'forward_lunge'
  | 'reverse_lunge'
  | 'shoulder_press'
  | 'bicep_curl'
  | 'plank'
  | 'jumping_jack';

export type ExerciseCategory = 'strength' | 'bodyweight' | 'core' | 'cardio';

export type CameraAngleRequirement =
  | 'front'
  | 'side'
  | 'front_or_side'
  | 'diagonal_45';

export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

/** MediaPipe 33 Landmark indices */
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type PoseLandmarkIndex = typeof POSE_LANDMARKS[keyof typeof POSE_LANDMARKS];

export interface MirrorPoint {
  x: number; // 0..1 normalised
  y: number; // 0..1 normalised
  z?: number; // relative depth
  visibility?: number; // 0..1 confidence
}

export type MovementPhase =
  | 'idle'
  | 'setup'
  | 'starting'
  | 'eccentric' // lowering
  | 'inflection' // peak depth / bottom / peak stretch
  | 'concentric' // ascending / pressing / curling
  | 'lockout' // rep finished
  | 'hold' // static hold (plank)
  | 'breakdown'; // form collapsed

export type FeedbackSeverity = 'info' | 'positive' | 'warning' | 'error';
export type FeedbackCategory = 'positive' | 'correction' | 'tracking';

export interface FormObservation {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  message: string;
  timestamp: number;
  metricKey?: string;
  metricValue?: number;
  targetValue?: number;
  highlightJoints?: number[];
}

export interface RepetitionRecord {
  repNumber: number;
  durationMs: number;
  minAngle?: number;
  maxAngle?: number;
  formScore: number; // 0..100
  observations: FormObservation[];
  wasCameraVerified: boolean;
}

export interface MirrorSetData {
  setNumber: number;
  targetReps?: number;
  targetDurationSec?: number;
  detectedReps: number;
  userAdjustedReps: number;
  activeDurationSec: number;
  averageFormScore: number; // 0..100
  reps: RepetitionRecord[];
  observationsSummary: Record<string, number>;
}

export interface WorkoutMirrorSession {
  id: string;
  userId: string;
  exerciseId: WorkoutMirrorExerciseId;
  exerciseName: string;
  startedAt: string; // ISO
  endedAt?: string; // ISO
  totalDurationSec: number;
  sets: MirrorSetData[];
  overallConsistencyScore: number; // 0..100
  primaryObservations: string[];
  feedbackNotes: string[];
}

export interface ExerciseDefinition {
  id: WorkoutMirrorExerciseId;
  name: string;
  category: ExerciseCategory;
  difficulty: ExerciseDifficulty;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string;
  recommendedCameraAngle: CameraAngleRequirement;
  cameraAngleExplanation: string;
  instructions: string[];
  techniquePoints: string[];
  supportedChecks: string[];
  knownLimitations: string[];
  defaultTargetReps?: number;
  defaultTargetDurationSec?: number;
  isStaticHold?: boolean;
}

export type CameraDistanceStatus = 'too_close' | 'too_far' | 'optimal' | 'not_detected';

export interface BodyVisibilityStatus {
  isFullyVisible: boolean;
  isHeadVisible: boolean;
  isTorsoVisible: boolean;
  areHipsVisible: boolean;
  areKneesVisible: boolean;
  areFeetVisible: boolean;
  distanceStatus: CameraDistanceStatus;
  advice: string;
  missingLandmarks: string[];
  averageConfidence: number;
}
