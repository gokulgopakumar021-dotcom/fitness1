import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateAngle } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class PushupEngine implements IExerciseEngine {
  readonly exerciseId = 'pushup' as const;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private minElbowAngle = 180;
  private hadHipSag = false;
  private hadHipPike = false;
  private hadIncompleteDepth = false;

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
    this.hadHipSag = false;
    this.hadHipPike = false;
    this.hadIncompleteDepth = false;
  }

  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult {
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const leftElbow = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const leftAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];

    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const rightElbow = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const rightAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];

    const leftVis = (leftShoulder?.visibility ?? 0) + (leftElbow?.visibility ?? 0) + (leftWrist?.visibility ?? 0);
    const rightVis = (rightShoulder?.visibility ?? 0) + (rightElbow?.visibility ?? 0) + (rightWrist?.visibility ?? 0);

    const shoulder = rightVis > leftVis ? rightShoulder : leftShoulder;
    const elbow = rightVis > leftVis ? rightElbow : leftElbow;
    const wrist = rightVis > leftVis ? rightWrist : leftWrist;
    const hip = rightVis > leftVis ? rightHip : leftHip;
    const ankle = rightVis > leftVis ? rightAnkle : leftAnkle;

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

    // Core alignment check if shoulder, hip, ankle are in view
    let spineAngle = 180;
    if (shoulder && hip && ankle) {
      spineAngle = calculateAngle(shoulder, hip, ankle);

      // In pushup plank, hip sag causes angle < 155°
      if (spineAngle < 155) {
        this.hadHipSag = true;
        observations.push({
          id: `sag-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Hips are sagging! Engage glutes and core to protect your back.',
          timestamp: timestampMs,
          highlightJoints: [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
        });
      } else if (spineAngle > 195) {
        this.hadHipPike = true;
        observations.push({
          id: `pike-${timestampMs}`,
          category: 'correction',
          severity: 'info',
          message: 'Lower your hips into a straight plank line.',
          timestamp: timestampMs,
        });
      }
    }

    // Push-up state machine:
    // Lockout/Plank: elbow angle >= 155°
    // Lowering: elbow angle < 140°
    // Bottom: elbow angle <= 92°
    // Pressing: elbow angle rising past 120°
    // Lockout: returns >= 155° -> Rep!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (elbowAngle >= 150) {
          this.phase = 'starting';
          this.minElbowAngle = elbowAngle;
        }
        break;

      case 'starting':
        if (elbowAngle < 140) {
          this.minElbowAngle = elbowAngle;
          this.hadHipSag = false;
          this.hadHipPike = false;
          this.hadIncompleteDepth = false;
          if (elbowAngle <= 92) {
            this.phase = 'inflection';
          } else {
            this.phase = 'eccentric';
          }
        }
        break;

      case 'eccentric':
        if (elbowAngle < this.minElbowAngle) {
          this.minElbowAngle = elbowAngle;
        }
        // Progress down to 90°
        progressPercent = Math.min(100, Math.max(0, ((155 - elbowAngle) / (155 - 90)) * 100));

        if (elbowAngle <= 92) {
          this.phase = 'inflection';
        } else if (elbowAngle > this.minElbowAngle + 15 && this.minElbowAngle < 130) {
          this.hadIncompleteDepth = true;
          this.phase = 'concentric';
        }
        break;

      case 'inflection':
        if (elbowAngle < this.minElbowAngle) {
          this.minElbowAngle = elbowAngle;
        }
        progressPercent = 100;
        if (elbowAngle >= 150) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;
        } else if (elbowAngle > this.minElbowAngle + 12) {
          this.phase = 'concentric';
        }
        break;

      case 'concentric':
        progressPercent = Math.min(100, Math.max(0, ((elbowAngle - 90) / (155 - 90)) * 100));
        if (elbowAngle >= 150) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadIncompleteDepth && this.minElbowAngle > 96) {
            observations.push({
              id: `pushup-depth-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Lower your chest deeper (aim for 90° at elbows).',
              timestamp: timestampMs,
            });
          } else if (!this.hadHipSag && !this.hadHipPike) {
            observations.push({
              id: `good-pushup-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Strong push-up and solid plank line!',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    let formScoreThisFrame = 95;
    if (this.hadHipSag) formScoreThisFrame -= 25;
    if (this.hadHipPike) formScoreThisFrame -= 15;
    if (this.hadIncompleteDepth) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(40, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(elbowAngle),
      targetAngle: 90,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        elbowAngle: Math.round(elbowAngle),
        minElbowAngle: Math.round(this.minElbowAngle),
        spineAngle: Math.round(spineAngle),
      },
    };
  }
}
