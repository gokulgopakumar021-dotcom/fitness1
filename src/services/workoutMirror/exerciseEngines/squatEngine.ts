import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateAngle, calculateVerticalAngle, calculateDistance2D } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class SquatEngine implements IExerciseEngine {
  readonly exerciseId = 'squat' as const;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private minKneeAngle = 180;
  private repStartTime = 0;
  private hadKneeValgus = false;
  private hadExcessiveLean = false;
  private hadShallowDepth = false;

  getRepCount(): number {
    return this.repCount;
  }

  setRepCount(count: number): void {
    this.repCount = Math.max(0, count);
  }

  reset(): void {
    this.repCount = 0;
    this.phase = 'idle';
    this.minKneeAngle = 180;
    this.repStartTime = 0;
    this.hadKneeValgus = false;
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

    // Use side with higher visibility or average if both visible
    const leftVis = (leftHip?.visibility ?? 0) + (leftKnee?.visibility ?? 0) + (leftAnkle?.visibility ?? 0);
    const rightVis = (rightHip?.visibility ?? 0) + (rightKnee?.visibility ?? 0) + (rightAnkle?.visibility ?? 0);

    let activeHip = leftHip;
    let activeKnee = leftKnee;
    let activeAnkle = leftAnkle;
    let activeShoulder = leftShoulder;

    if (rightVis > leftVis) {
      activeHip = rightHip;
      activeKnee = rightKnee;
      activeAnkle = rightAnkle;
      activeShoulder = rightShoulder;
    }

    if (!activeHip || !activeKnee || !activeAnkle) {
      return {
        movementPhase: this.phase,
        repCompletedThisFrame: false,
        repCount: this.repCount,
        formScoreThisFrame: 80,
        observations: [],
        progressPercent: 0,
      };
    }

    const kneeAngle = calculateAngle(activeHip, activeKnee, activeAnkle);
    let torsoTilt = 0;
    if (activeShoulder) {
      torsoTilt = calculateVerticalAngle(activeShoulder, activeHip);
    }

    // Check knee valgus if both knees and ankles are in view
    if (leftKnee && rightKnee && leftAnkle && rightAnkle && leftHip && rightHip) {
      const kneeDist = calculateDistance2D(leftKnee, rightKnee);
      const ankleDist = calculateDistance2D(leftAnkle, rightAnkle);
      const hipDist = calculateDistance2D(leftHip, rightHip);

      // In descent / bottom, if knees pinch closer than 78% of ankle/hip distance
      if (kneeAngle < 130 && ankleDist > 0.08 && kneeDist < ankleDist * 0.72) {
        this.hadKneeValgus = true;
        observations.push({
          id: `valgus-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Knees caving inward! Push knees outward over your toes.',
          timestamp: timestampMs,
          highlightJoints: [POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.RIGHT_KNEE],
        });
      }
    }

    // Check excessive forward torso collapse (> 48° from vertical)
    if (kneeAngle < 130 && torsoTilt > 48) {
      this.hadExcessiveLean = true;
      observations.push({
        id: `lean-${timestampMs}`,
        category: 'correction',
        severity: 'warning',
        message: 'Keep your chest proud; avoid collapsing torso forward.',
        timestamp: timestampMs,
        highlightJoints: [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
      });
    }

    // State Machine
    // Standing: kneeAngle >= 155°
    // Descending: kneeAngle drops below 145°
    // Inflection (Bottom): kneeAngle <= 100° (target <= 95°)
    // Ascending: kneeAngle rising above 115°
    // Lockout: returns >= 155° -> Rep counted!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (kneeAngle >= 150) {
          this.phase = 'starting';
          this.minKneeAngle = kneeAngle;
        }
        break;

      case 'starting':
        if (kneeAngle < 145) {
          this.repStartTime = timestampMs;
          this.minKneeAngle = kneeAngle;
          this.hadKneeValgus = false;
          this.hadExcessiveLean = false;
          this.hadShallowDepth = false;
          if (kneeAngle <= 98) {
            this.phase = 'inflection';
          } else {
            this.phase = 'eccentric';
          }
        }
        break;

      case 'eccentric':
        if (kneeAngle < this.minKneeAngle) {
          this.minKneeAngle = kneeAngle;
        }

        // Calculate progress toward 90° target (160° down to 90°)
        progressPercent = Math.min(100, Math.max(0, ((160 - kneeAngle) / (160 - 90)) * 100));

        if (kneeAngle <= 98) {
          this.phase = 'inflection';
        } else if (kneeAngle > this.minKneeAngle + 15 && this.minKneeAngle < 135) {
          // Began standing up before hitting parallel
          this.hadShallowDepth = true;
          this.phase = 'concentric';
        }
        break;

      case 'inflection':
        if (kneeAngle < this.minKneeAngle) {
          this.minKneeAngle = kneeAngle;
        }
        progressPercent = 100;
        if (kneeAngle >= 155) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;
        } else if (kneeAngle > this.minKneeAngle + 10) {
          this.phase = 'concentric';
        }
        break;

      case 'concentric':
        // Ascending back up from 90° to 160°
        progressPercent = Math.min(100, Math.max(0, ((kneeAngle - 90) / (160 - 90)) * 100));

        if (kneeAngle >= 155) {
          // Rep completed!
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadShallowDepth && this.minKneeAngle > 102) {
            observations.push({
              id: `depth-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Try squatting a little deeper to parallel thighs next rep.',
              timestamp: timestampMs,
            });
          } else if (!this.hadKneeValgus && !this.hadExcessiveLean) {
            observations.push({
              id: `good-squat-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Great squat depth and knee path! Keep it up.',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    // Compute instantaneous form score
    let formScoreThisFrame = 95;
    if (this.hadKneeValgus) formScoreThisFrame -= 25;
    if (this.hadExcessiveLean) formScoreThisFrame -= 20;
    if (this.hadShallowDepth) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(40, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(kneeAngle),
      targetAngle: 90,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        kneeAngle: Math.round(kneeAngle),
        minKneeAngle: Math.round(this.minKneeAngle),
        torsoTilt: Math.round(torsoTilt),
      },
    };
  }
}
