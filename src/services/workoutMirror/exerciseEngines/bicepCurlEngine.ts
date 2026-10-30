import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateAngle, calculateVerticalAngle } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class BicepCurlEngine implements IExerciseEngine {
  readonly exerciseId = 'bicep_curl' as const;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private minElbowAngle = 180;
  private hadElbowDrift = false;
  private hadIncompleteExtension = false;
  private hadIncompleteFlexion = false;

  getRepCount(): number {
    return this.repCount;
  }

  setRepCount(count: number): void {
    this.repCount = Math.max(0, count);
  }

  reset(): void {
    this.repCount = 0;
    this.phase = 'idle';
    this.minElbowAngle = 180;
    this.hadElbowDrift = false;
    this.hadIncompleteExtension = false;
    this.hadIncompleteFlexion = false;
  }

  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult {
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const leftElbow = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];

    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const rightElbow = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];

    const leftVis = (leftShoulder?.visibility ?? 0) + (leftElbow?.visibility ?? 0) + (leftWrist?.visibility ?? 0);
    const rightVis = (rightShoulder?.visibility ?? 0) + (rightElbow?.visibility ?? 0) + (rightWrist?.visibility ?? 0);

    const shoulder = rightVis > leftVis ? rightShoulder : leftShoulder;
    const elbow = rightVis > leftVis ? rightElbow : leftElbow;
    const wrist = rightVis > leftVis ? rightWrist : leftWrist;
    const hip = rightVis > leftVis ? rightHip : leftHip;

    const observations: FormObservation[] = [];
    let repCompletedThisFrame = false;

    if (!shoulder || !elbow || !wrist) {
      return {
        movementPhase: this.phase,
        repCompletedThisFrame: false,
        repCount: this.repCount,
        formScoreThisFrame: 80,
        observations: [],
        progressPercent: 0,
      };
    }

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);

    // Elbow drift check: angle of upper arm (shoulder -> elbow) relative to vertical
    let upperArmTilt = 0;
    if (shoulder && elbow) {
      upperArmTilt = calculateVerticalAngle(shoulder, elbow);
      // If elbow swings forward > 32° during curl
      if (elbowAngle < 120 && upperArmTilt > 32) {
        this.hadElbowDrift = true;
        observations.push({
          id: `elbow-drift-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Pin elbows to your ribs! Avoid swinging elbows forward.',
          timestamp: timestampMs,
          highlightJoints: [POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.RIGHT_ELBOW],
        });
      }
    }

    // Curl State Machine:
    // Bottom Extension: elbowAngle >= 145°
    // Curling up (concentric): elbowAngle decreasing
    // Peak Flexion (inflection): elbowAngle <= 60° (target 45°-55°)
    // Lowering down (eccentric): elbowAngle opening back up
    // Extension: returns >= 145° -> Rep!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (elbowAngle >= 140) {
          this.phase = 'starting';
          this.minElbowAngle = elbowAngle;
        }
        break;

      case 'starting':
        if (elbowAngle < 135) {
          this.minElbowAngle = elbowAngle;
          this.hadElbowDrift = false;
          this.hadIncompleteExtension = false;
          this.hadIncompleteFlexion = false;
          if (elbowAngle <= 60) {
            this.phase = 'inflection';
          } else {
            this.phase = 'concentric';
          }
        }
        break;

      case 'concentric':
        if (elbowAngle < this.minElbowAngle) {
          this.minElbowAngle = elbowAngle;
        }
        // Progress from 145° down to 55°
        progressPercent = Math.min(100, Math.max(0, ((145 - elbowAngle) / (145 - 55)) * 100));

        if (elbowAngle <= 60) {
          this.phase = 'inflection';
        } else if (elbowAngle > this.minElbowAngle + 18 && this.minElbowAngle < 110) {
          this.hadIncompleteFlexion = true;
          this.phase = 'eccentric';
        }
        break;

      case 'inflection':
        if (elbowAngle < this.minElbowAngle) {
          this.minElbowAngle = elbowAngle;
        }
        progressPercent = 100;
        if (elbowAngle >= 142) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;
        } else if (elbowAngle > this.minElbowAngle + 12) {
          this.phase = 'eccentric';
        }
        break;

      case 'eccentric':
        progressPercent = Math.min(100, Math.max(0, ((elbowAngle - 55) / (145 - 55)) * 100));
        if (elbowAngle >= 142) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadIncompleteFlexion && this.minElbowAngle > 70) {
            observations.push({
              id: `curl-peak-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Curl higher toward shoulders for a peak bicep contraction.',
              timestamp: timestampMs,
            });
          } else if (!this.hadElbowDrift) {
            observations.push({
              id: `good-curl-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Strict curl form with stationary elbows!',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    let formScoreThisFrame = 95;
    if (this.hadElbowDrift) formScoreThisFrame -= 25;
    if (this.hadIncompleteFlexion) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(40, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(elbowAngle),
      targetAngle: 55,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        elbowAngle: Math.round(elbowAngle),
        minElbowAngle: Math.round(this.minElbowAngle),
        upperArmTilt: Math.round(upperArmTilt),
      },
    };
  }
}
