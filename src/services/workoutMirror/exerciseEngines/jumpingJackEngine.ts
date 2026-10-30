import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateDistance2D } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class JumpingJackEngine implements IExerciseEngine {
  readonly exerciseId = 'jumping_jack' as const;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private maxWristSpread = 0;
  private maxFootSpread = 0;
  private hadIncompleteArmExtension = false;
  private hadNarrowFeet = false;

  getRepCount(): number {
    return this.repCount;
  }

  setRepCount(count: number): void {
    this.repCount = Math.max(0, count);
  }

  reset(): void {
    this.repCount = 0;
    this.phase = 'idle';
    this.maxWristSpread = 0;
    this.maxFootSpread = 0;
    this.hadIncompleteArmExtension = false;
    this.hadNarrowFeet = false;
  }

  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult {
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const leftAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];
    const rightAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];

    const observations: FormObservation[] = [];
    let repCompletedThisFrame = false;

    if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder || !leftAnkle || !rightAnkle) {
      return {
        movementPhase: this.phase,
        repCompletedThisFrame: false,
        repCount: this.repCount,
        formScoreThisFrame: 80,
        observations: [],
        progressPercent: 0,
      };
    }

    const shoulderDist = Math.max(0.08, calculateDistance2D(leftShoulder, rightShoulder));
    const ankleDist = calculateDistance2D(leftAnkle, rightAnkle);
    const wristDist = calculateDistance2D(leftWrist, rightWrist);

    // Height of wrists relative to shoulders (negative if above shoulders)
    const avgWristY = (leftWrist.y + rightWrist.y) / 2;
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const armsOverhead = avgWristY < avgShoulderY - 0.08;
    const feetSpreadRatio = ankleDist / shoulderDist;

    // Jumping Jack States:
    // Closed (start/end): feet together (ratio < 1.3), hands down (avgWristY > avgShoulderY)
    // Opening: feet moving apart, arms swinging up
    // Open (apex): arms overhead, feet wide (ratio >= 1.6)
    // Closing: returning to start
    // Closed: Rep!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (feetSpreadRatio < 1.3 && avgWristY > avgShoulderY) {
          this.phase = 'starting';
          this.maxWristSpread = wristDist;
          this.maxFootSpread = feetSpreadRatio;
        }
        break;

      case 'starting':
        if (feetSpreadRatio > 1.35 || armsOverhead) {
          this.maxWristSpread = wristDist;
          this.maxFootSpread = feetSpreadRatio;
          this.hadIncompleteArmExtension = false;
          this.hadNarrowFeet = false;
          if (armsOverhead && feetSpreadRatio >= 1.6) {
            this.phase = 'inflection';
          } else {
            this.phase = 'eccentric';
          }
        }
        break;

      case 'eccentric': // Opening
        if (feetSpreadRatio > this.maxFootSpread) this.maxFootSpread = feetSpreadRatio;
        if (wristDist > this.maxWristSpread) this.maxWristSpread = wristDist;

        progressPercent = Math.min(100, Math.max(0, ((feetSpreadRatio - 1.2) / (1.8 - 1.2)) * 100));

        if (armsOverhead && feetSpreadRatio >= 1.6) {
          this.phase = 'inflection'; // Peak open
        } else if (feetSpreadRatio < this.maxFootSpread - 0.25 && this.maxFootSpread < 1.5) {
          this.hadNarrowFeet = true;
          this.phase = 'concentric'; // Returning prematurely
        }
        break;

      case 'inflection':
        progressPercent = 100;
        if (feetSpreadRatio <= 1.3 && avgWristY > avgShoulderY) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;
        } else if (feetSpreadRatio < this.maxFootSpread - 0.15 || !armsOverhead) {
          this.phase = 'concentric'; // Closing inward
        }
        break;

      case 'concentric': // Closing
        progressPercent = Math.min(100, Math.max(0, ((1.8 - feetSpreadRatio) / (1.8 - 1.2)) * 100));
        if (feetSpreadRatio <= 1.3 && avgWristY > avgShoulderY) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadNarrowFeet) {
            observations.push({
              id: `jack-feet-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Jump feet out wider on the opening stride.',
              timestamp: timestampMs,
            });
          } else {
            observations.push({
              id: `good-jack-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Rhythmic, high-energy jump with full reach!',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    let formScoreThisFrame = 95;
    if (this.hadIncompleteArmExtension) formScoreThisFrame -= 20;
    if (this.hadNarrowFeet) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(50, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(feetSpreadRatio * 100),
      targetAngle: 180,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        feetSpreadRatio: feetSpreadRatio.toFixed(2),
        armsOverhead: armsOverhead ? 1 : 0,
      },
    };
  }
}
