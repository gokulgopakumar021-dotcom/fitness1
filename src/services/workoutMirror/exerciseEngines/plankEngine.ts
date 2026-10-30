import { FormObservation, MirrorPoint, MovementPhase, POSE_LANDMARKS } from '../../../types/workoutMirror';
import { calculateAngle } from '../jointGeometry';
import { EngineFrameResult, IExerciseEngine } from './types';

export class PlankEngine implements IExerciseEngine {
  readonly exerciseId = 'plank' as const;

  private phase: MovementPhase = 'idle';
  private holdStartTimestamp = 0;
  private lastTimestamp = 0;
  private totalHoldDurationMs = 0;
  private goodFormDurationMs = 0;

  getRepCount(): number {
    // For plank, "rep count" is reported as seconds of good-form hold
    return Math.floor(this.goodFormDurationMs / 1000);
  }

  setRepCount(count: number): void {
    this.goodFormDurationMs = count * 1000;
  }

  reset(): void {
    this.phase = 'idle';
    this.holdStartTimestamp = 0;
    this.lastTimestamp = 0;
    this.totalHoldDurationMs = 0;
    this.goodFormDurationMs = 0;
  }

  processFrame(landmarks: MirrorPoint[], timestampMs: number): EngineFrameResult {
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const leftAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];

    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const rightAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];

    const leftVis = (leftShoulder?.visibility ?? 0) + (leftHip?.visibility ?? 0) + (leftAnkle?.visibility ?? 0);
    const rightVis = (rightShoulder?.visibility ?? 0) + (rightHip?.visibility ?? 0) + (rightAnkle?.visibility ?? 0);

    const shoulder = rightVis > leftVis ? rightShoulder : leftShoulder;
    const hip = rightVis > leftVis ? rightHip : leftHip;
    const ankle = rightVis > leftVis ? rightAnkle : leftAnkle;

    const observations: FormObservation[] = [];

    if (!shoulder || !hip || !ankle) {
      return {
        movementPhase: this.phase,
        repCompletedThisFrame: false,
        repCount: Math.floor(this.goodFormDurationMs / 1000),
        formScoreThisFrame: 80,
        observations: [],
        activeDurationSec: Math.floor(this.totalHoldDurationMs / 1000),
        goodFormDurationSec: Math.floor(this.goodFormDurationMs / 1000),
        progressPercent: 0,
      };
    }

    const spineAngle = calculateAngle(shoulder, hip, ankle);
    const dt = this.lastTimestamp > 0 ? Math.min(200, timestampMs - this.lastTimestamp) : 0;
    this.lastTimestamp = timestampMs;

    let isGoodAlignment = true;

    // Check for hip sag
    if (spineAngle < 155) {
      isGoodAlignment = false;
      this.phase = 'breakdown';
      observations.push({
        id: `plank-sag-${timestampMs}`,
        category: 'correction',
        severity: 'warning',
        message: 'Hips are sagging! Engage core and glutes to elevate hips into line.',
        timestamp: timestampMs,
        highlightJoints: [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
      });
    } else if (spineAngle > 195) {
      isGoodAlignment = false;
      this.phase = 'breakdown';
      observations.push({
        id: `plank-pike-${timestampMs}`,
        category: 'correction',
        severity: 'info',
        message: 'Hips are too high! Lower slightly into a straight horizontal plank.',
        timestamp: timestampMs,
      });
    } else {
      this.phase = 'hold';
    }

    // Accumulate hold duration
    if (this.holdStartTimestamp === 0) {
      this.holdStartTimestamp = timestampMs;
    }

    this.totalHoldDurationMs += dt;
    if (isGoodAlignment) {
      this.goodFormDurationMs += dt;
    }

    const goodSec = Math.floor(this.goodFormDurationMs / 1000);
    const totalSec = Math.floor(this.totalHoldDurationMs / 1000);

    // Provide encouragement milestone every 15 seconds of clean hold
    if (goodSec > 0 && goodSec % 15 === 0 && dt > 0) {
      observations.push({
        id: `plank-milestone-${goodSec}`,
        category: 'positive',
        severity: 'positive',
        message: `Solid plank line! ${goodSec}s hold strong.`,
        timestamp: timestampMs,
      });
    }

    const consistencyPercent =
      this.totalHoldDurationMs > 0
        ? Math.round((this.goodFormDurationMs / this.totalHoldDurationMs) * 100)
        : 100;

    return {
      movementPhase: this.phase,
      currentAngle: Math.round(spineAngle),
      targetAngle: 180,
      repCompletedThisFrame: false,
      repCount: goodSec,
      formScoreThisFrame: isGoodAlignment ? 100 : 65,
      observations,
      activeDurationSec: totalSec,
      goodFormDurationSec: goodSec,
      progressPercent: consistencyPercent,
      debugMetrics: {
        spineAngle: Math.round(spineAngle),
        goodFormDurationSec: goodSec,
        totalDurationSec: totalSec,
      },
    };
  }
}
