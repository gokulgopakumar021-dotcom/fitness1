import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateAngle, calculateVerticalAngle } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class ShoulderPressEngine implements IExerciseEngine {
  readonly exerciseId = 'shoulder_press' as const;

  private repCount = 0;
  private phase: MovementPhase = 'idle';
  private maxElbowAngle = 80;
  private hadIncompleteLockout = false;
  private hadAsymmetry = false;
  private hadArchingBack = false;

  getRepCount(): number {
    return this.repCount;
  }

  setRepCount(count: number): void {
    this.repCount = Math.max(0, count);
  }

  reset(): void {
    this.repCount = 0;
    this.phase = 'idle';
    this.maxElbowAngle = 80;
    this.hadIncompleteLockout = false;
    this.hadAsymmetry = false;
    this.hadArchingBack = false;
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

    // Asymmetry check if both arms are visible
    if (leftShoulder && leftElbow && leftWrist && rightShoulder && rightElbow && rightWrist) {
      const leftAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
      const rightAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
      const wristHeightDiff = Math.abs(leftWrist.y - rightWrist.y);

      if (elbowAngle > 120 && (Math.abs(leftAngle - rightAngle) > 28 || wristHeightDiff > 0.09)) {
        this.hadAsymmetry = true;
        observations.push({
          id: `press-asym-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Press both arms symmetrically to equal overhead height.',
          timestamp: timestampMs,
          highlightJoints: [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.RIGHT_WRIST],
        });
      }
    }

    // Spine lean check (hyperextension / leaning back)
    if (shoulder && hip) {
      const spineTilt = calculateVerticalAngle(shoulder, hip);
      if (elbowAngle > 130 && spineTilt > 18) {
        this.hadArchingBack = true;
        observations.push({
          id: `press-arch-${timestampMs}`,
          category: 'correction',
          severity: 'warning',
          message: 'Brace your core! Avoid arching your lower back overhead.',
          timestamp: timestampMs,
        });
      }
    }

    // State Machine for Shoulder Press:
    // Racked/Bottom: elbow angle <= 95°, wrists near shoulders
    // Pressing up (concentric): elbow angle increasing
    // Overhead Lockout: elbow angle >= 165°
    // Lowering down (eccentric): elbow angle decreasing
    // Returned to rack: returns <= 95° -> Rep!
    let progressPercent = 0;

    switch (this.phase) {
      case 'idle':
      case 'setup':
      case 'lockout':
        if (elbowAngle <= 100) {
          this.phase = 'starting';
          this.maxElbowAngle = elbowAngle;
        }
        break;

      case 'starting':
        if (elbowAngle > 105) {
          this.maxElbowAngle = elbowAngle;
          this.hadIncompleteLockout = false;
          this.hadAsymmetry = false;
          this.hadArchingBack = false;
          if (elbowAngle >= 162) {
            this.phase = 'inflection';
          } else {
            this.phase = 'concentric';
          }
        }
        break;

      case 'concentric':
        if (elbowAngle > this.maxElbowAngle) {
          this.maxElbowAngle = elbowAngle;
        }
        progressPercent = Math.min(100, Math.max(0, ((elbowAngle - 90) / (165 - 90)) * 100));

        if (elbowAngle >= 162) {
          this.phase = 'inflection';
        } else if (elbowAngle < this.maxElbowAngle - 18 && this.maxElbowAngle < 145) {
          this.hadIncompleteLockout = true;
          this.phase = 'eccentric';
        }
        break;

      case 'inflection':
        if (elbowAngle > this.maxElbowAngle) {
          this.maxElbowAngle = elbowAngle;
        }
        progressPercent = 100;
        if (elbowAngle <= 102) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;
        } else if (elbowAngle < this.maxElbowAngle - 10) {
          this.phase = 'eccentric';
        }
        break;

      case 'eccentric':
        progressPercent = Math.min(100, Math.max(0, ((165 - elbowAngle) / (165 - 90)) * 100));
        if (elbowAngle <= 102) {
          this.phase = 'lockout';
          repCompletedThisFrame = true;
          this.repCount += 1;

          if (this.hadIncompleteLockout && this.maxElbowAngle < 155) {
            observations.push({
              id: `press-lockout-${timestampMs}`,
              category: 'correction',
              severity: 'info',
              message: 'Lock out fully overhead for complete shoulder extension.',
              timestamp: timestampMs,
            });
          } else if (!this.hadAsymmetry && !this.hadArchingBack) {
            observations.push({
              id: `good-press-${timestampMs}`,
              category: 'positive',
              severity: 'positive',
              message: 'Crisp overhead lockout and solid core stability!',
              timestamp: timestampMs,
            });
          }
        }
        break;
    }

    let formScoreThisFrame = 95;
    if (this.hadAsymmetry) formScoreThisFrame -= 20;
    if (this.hadArchingBack) formScoreThisFrame -= 25;
    if (this.hadIncompleteLockout) formScoreThisFrame -= 15;
    formScoreThisFrame = Math.max(40, formScoreThisFrame);

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(elbowAngle),
      targetAngle: 165,
      repCompletedThisFrame,
      repCount: this.repCount,
      formScoreThisFrame,
      observations,
      progressPercent: Math.round(progressPercent),
      debugMetrics: {
        elbowAngle: Math.round(elbowAngle),
        maxElbowAngle: Math.round(this.maxElbowAngle),
      },
    };
  }
}
