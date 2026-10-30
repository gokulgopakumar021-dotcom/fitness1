import {
  FormObservation,
  MirrorPoint,
  MovementPhase,
  WorkoutMirrorExerciseId,
} from '../../../types/workoutMirror';

export interface EngineFrameResult {
  movementPhase: MovementPhase;
  currentAngle?: number;
  targetAngle?: number;
  repCompletedThisFrame: boolean;
  repCount: number;
  formScoreThisFrame: number; // 0..100
  observations: FormObservation[];
  activeDurationSec?: number; // for static holds like plank
  goodFormDurationSec?: number;
  progressPercent: number; // 0..100 in current rep cycle
  debugMetrics?: Record<string, number | string>;
}

export interface IExerciseEngine {
  readonly exerciseId: WorkoutMirrorExerciseId;
  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult;
  reset(): void;
  getRepCount(): number;
  setRepCount(count: number): void;
}
