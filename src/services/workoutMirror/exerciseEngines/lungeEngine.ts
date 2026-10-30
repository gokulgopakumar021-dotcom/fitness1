import {
  FormObservation,
  MirrorPoint,
  MovementPhase,
  POSE_LANDMARKS,
  WorkoutMirrorExerciseId,
} from '../../../types/workoutMirror';
import { calculateAngle, calculateVerticalAngle } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class LungeEngine implements IExerciseEngine {
  readonly exerciseId: WorkoutMirrorExerciseId;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private minLeadKneeAngle = 180;
  private hadExcessiveLean = false;
  private hadShallowDepth = false;

  constructor(exerciseId: 'forward_lunge' | 'reverse_lunge' = 'forward_lunge') {
    this.exerciseId = exerciseId;
  }

  getRepCount(): number {
    return this.repCount;
  }

  setRepCount(count: number): void {
    this.repCount = Math.max(0, count);
  }

  reset(): void {
    this.repCount = 0;
    this.phase = 'idle';
    this.minLeadKneeAngle = 180;
    this.hadExcessiveLean = false;
    this.hadShallowDepth = false;
  }

  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult {
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const leftKnee = landmarks[POSE_LANDMARKS.LEFT_KNEE];
    const leftAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];

    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const rightKnee = landmarks[POSE_LANDMARKS.RIGHT_KNEE];
    const rightAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];

    const observations: FormObservation[] = [];
    let repCompletedThisFrame = false;

    if (!leftKnee || !leftHip || !leftAnkle || !rightKnee || !rightHip || !rightAnkle) {
      return {
        movementPhase: this.phase,
        repCompletedThisFrame: false,
        repCount: this.repCount,
        formScoreThisFrame: 80,
        observations: [],
        progressPercent: 0,
      };
    }

    const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
    const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);

    // Lead leg is the one undergoing deeper flexion
    const isLeftLead = leftKneeAngle < rightKneeAngle;
    const leadKneeAngle = isLeftLead ? leftKneeAngle : rightKneeAngle;
    const leadShoulder = isLeftLead ? leftShoulder : rightShoulder;
    const leadHip = isLeftLead ? leftHip : rightHip;

    // Torso incline check
    let torsoTilt = 0;
    if (leadShoulder && leadHip) {
      torsoTilt = calculateVerticalAngle(leadShoulder, leadHip);
      if (leadKneeAngle < 130 && torsoTilt > 30) {
        this.hadExcessiveLean = true;
        observations.push({
          id: `lunge-torso-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Keep chest upright and tall over your hips.',
          timestamp: timestampMs,
        });
      }
    }

    // State machine for lunge:
    // Standing: leadKneeAngle >= 155°
    // Stepping/Descending: leadKneeAngle < 145°
    // Bottom lunge: leadKneeAngle <= 98° (target ~90°)
    // Ascending / Recovery: leadKneeAngle rising > 120°
    // Lockout: returns >= 155° -> Rep!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (leadKneeAngle >= 150) {
          this.phase = 'starting';
          this.minLeadKneeAngle = leadKneeAngle;
        }
        break;

      case 'starting':
        if (leadKneeAngle < 145) {
          this.phase = 'eccentric';
          this.minLeadKneeAngle = leadKneeAngle;
          this.hadExcessiveLean = false;
          this.hadShallowDepth = false;
        }
        break;

      case 'eccentric':
        if (leadKneeAngle < this.minLeadKneeAngle) {
          this.minLeadKneeAngle = leadKneeAngle;
        }
        progressPercent = Math.min(100, Math.max(0, ((155 - leadKneeAngle) / (155 - 90)) * 100));

        if (leadKneeAngle <= 98) {
          this.phase = 'inflection';
        } else if (leadKneeAngle > this.minLeadKneeAngle + 15 && this.minLeadKneeAngle < 130) {
          this.hadShallowDepth = true;
          this.phase = 'concentric';
        }
        break;

      case 'inflection':
        if (leadKneeAngle < this.minLeadKneeAngle) {
          this.minLeadKneeAngle = leadKneeAngle;
        }
        progressPercent = 100;
        if (leadKneeAngle > this.minLeadKneeAngle + 12) {
          this.phase = 'concentric';
        }
        break;

      case 'concentric':
        progressPercent = Math.min(100, Math.max(0, ((leadKneeAngle - 90) / (155 - 90)) * 100));
        if (leadKneeAngle >= 150) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadShallowDepth && this.minLeadKneeAngle > 105) {
            observations.push({
              id: `lunge-depth-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Step deeper into your lunge (aim for a 90° front knee bend).',
              timestamp: timestampMs,
            });
          } else if (!this.hadExcessiveLean) {
            observations.push({
              id: `good-lunge-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Clean lunge depth and upright posture!',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    let formScoreThisFrame = 95;
    if (this.hadExcessiveLean) formScoreThisFrame -= 25;
    if (this.hadShallowDepth) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(40, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(leadKneeAngle),
      targetAngle: 90,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        leadKneeAngle: Math.round(leadKneeAngle),
        minLeadKneeAngle: Math.round(this.minLeadKneeAngle),
        torsoTilt: Math.round(torsoTilt),
        leadSide: isLeftLead ? 'left' : 'right',
      },
    };
  }
}
