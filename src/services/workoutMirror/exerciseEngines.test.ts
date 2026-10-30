import { describe, it, expect } from 'vitest';
import {
  SquatEngine,
  PushupEngine,
  LungeEngine,
  BicepCurlEngine,
  ShoulderPressEngine,
  PlankEngine,
  JumpingJackEngine,
} from './exerciseEngines';
import { MirrorPoint, POSE_LANDMARKS } from '../../types/workoutMirror';

function createBlankPose(): MirrorPoint[] {
  return Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  }));
}

describe('Exercise Engines', () => {
  describe('SquatEngine', () => {
    it('accurately detects full squat rep and counts it', () => {
      const engine = new SquatEngine();
      const pose = createBlankPose();

      // Standing setup: hip (0.5, 0.4), knee (0.5, 0.65), ankle (0.5, 0.9) -> 180°
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.5, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.5, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.5, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.5, y: 0.2, visibility: 0.95 };

      pose[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.55, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.55, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.55, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_SHOULDER] = { x: 0.55, y: 0.2, visibility: 0.95 };

      // Frame 1: Standing
      let res = engine.processFrame(pose, 100);
      expect(res.movementPhase).toBe('starting');
      expect(res.repCount).toBe(0);

      // Frame 2: Descending into bottom squat: knee angle ~90°
      // hip (0.4, 0.65), knee (0.5, 0.65), ankle (0.5, 0.9)
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.35, y: 0.65, visibility: 0.95 };
      res = engine.processFrame(pose, 500);
      expect(res.movementPhase).toBe('inflection');

      // Frame 3: Ascending
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.42, y: 0.55, visibility: 0.95 };
      res = engine.processFrame(pose, 900);
      expect(res.movementPhase).toBe('concentric');

      // Frame 4: Return to standing lockout
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.5, y: 0.4, visibility: 0.95 };
      res = engine.processFrame(pose, 1400);

      expect(res.repCompletedThisFrame).toBe(true);
      expect(res.repCount).toBe(1);
      expect(engine.getRepCount()).toBe(1);
    });

    it('detects inward knee valgus during squat', () => {
      const engine = new SquatEngine();
      const pose = createBlankPose();

      // Lowered with knees pinched close:
      // Ankle distance: 0.35 to 0.65 = 0.30
      // Knee distance: 0.47 to 0.53 = 0.06 (< 72% of ankle distance)
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.4, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.6, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.48, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.52, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.35, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.65, y: 0.9, visibility: 0.95 };

      const res = engine.processFrame(pose, 200);
      const valgusObs = res.observations.find((o) => o.message.includes('valgus') || o.message.includes('Knees caving'));
      expect(valgusObs).toBeDefined();
    });
  });

  describe('PushupEngine', () => {
    it('detects full pushup rep and counts it', () => {
      const engine = new PushupEngine();
      const pose = createBlankPose();

      // Lockout top: shoulder (0.3, 0.4), elbow (0.3, 0.55), wrist (0.3, 0.7) -> 180°
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.3, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.3, y: 0.55, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.3, y: 0.7, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.5, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.8, y: 0.4, visibility: 0.95 };

      // Top
      let res = engine.processFrame(pose, 100);
      expect(res.repCount).toBe(0);

      // Bottom chest to floor: elbow flexed 90°
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.3, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.15, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.15, y: 0.75, visibility: 0.95 };
      res = engine.processFrame(pose, 500);
      expect(res.movementPhase).toBe('inflection');

      // Return to top lockout
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.3, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.3, y: 0.55, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.3, y: 0.7, visibility: 0.95 };
      res = engine.processFrame(pose, 1000);

      expect(res.repCompletedThisFrame).toBe(true);
      expect(res.repCount).toBe(1);
    });

    it('detects hip sagging in push-up', () => {
      const engine = new PushupEngine();
      const pose = createBlankPose();

      // Hip sagging downwards: shoulder (0.2, 0.3), hip (0.5, 0.6), ankle (0.8, 0.3)
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.2, y: 0.3, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.2, y: 0.45, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.2, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.5, y: 0.65, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.8, y: 0.3, visibility: 0.95 };

      const res = engine.processFrame(pose, 200);
      const sagObs = res.observations.find((o) => o.message.includes('sagging'));
      expect(sagObs).toBeDefined();
    });
  });

  describe('BicepCurlEngine', () => {
    it('detects full bicep curl repetition and flags elbow drift', () => {
      const engine = new BicepCurlEngine();
      const pose = createBlankPose();

      // Full bottom extension: shoulder (0.5, 0.3), elbow (0.5, 0.55), wrist (0.5, 0.8) -> 180°
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.5, y: 0.3, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.5, y: 0.8, visibility: 0.95 };

      // Extended
      let res = engine.processFrame(pose, 100);
      expect(res.repCount).toBe(0);

      // Flexed peak curl: wrist near shoulder (0.5, 0.32), elbow angle ~45°
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.48, y: 0.34, visibility: 0.95 };
      res = engine.processFrame(pose, 600);
      expect(res.movementPhase).toBe('inflection');

      // Return to bottom extension
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.5, y: 0.8, visibility: 0.95 };
      res = engine.processFrame(pose, 1200);

      expect(res.repCompletedThisFrame).toBe(true);
      expect(res.repCount).toBe(1);
    });
  });

  describe('ShoulderPressEngine', () => {
    it('detects overhead press and lockout', () => {
      const engine = new ShoulderPressEngine();
      const pose = createBlankPose();

      // Racked at shoulder: shoulder (0.5, 0.4), elbow (0.5, 0.55), wrist (0.5, 0.4) -> 90°
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.5, y: 0.4, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.5, y: 0.4, visibility: 0.95 };

      let res = engine.processFrame(pose, 100);
      expect(res.repCount).toBe(0);

      // Overhead lockout: elbow extended straight up: wrist (0.5, 0.1), elbow (0.5, 0.25) -> ~180°
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.5, y: 0.25, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.5, y: 0.1, visibility: 0.95 };
      res = engine.processFrame(pose, 600);
      expect(res.movementPhase).toBe('inflection');

      // Lower back to shoulders
      pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.5, y: 0.4, visibility: 0.95 };
      res = engine.processFrame(pose, 1200);

      expect(res.repCompletedThisFrame).toBe(true);
      expect(res.repCount).toBe(1);
    });
  });

  describe('PlankEngine', () => {
    it('tracks static hold duration and detects alignment', () => {
      const engine = new PlankEngine();
      const pose = createBlankPose();

      // Straight plank: shoulder (0.2, 0.5), hip (0.5, 0.5), ankle (0.8, 0.5) -> 180°
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.2, y: 0.5, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_HIP] = { x: 0.5, y: 0.5, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.8, y: 0.5, visibility: 0.95 };

      engine.processFrame(pose, 1000);
      const res = engine.processFrame(pose, 3000);

      expect(res.movementPhase).toBe('hold');
      expect(res.formScoreThisFrame).toBe(100);
    });
  });

  describe('JumpingJackEngine', () => {
    it('detects jumping jack cycle and counts repetition', () => {
      const engine = new JumpingJackEngine();
      const pose = createBlankPose();

      // Closed: feet together (ankle dist 0.08, shoulder dist 0.2), wrists down (y > shoulder y)
      pose[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.4, y: 0.3, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_SHOULDER] = { x: 0.6, y: 0.3, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.38, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.62, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.48, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.52, y: 0.9, visibility: 0.95 };

      let res = engine.processFrame(pose, 100);
      expect(res.repCount).toBe(0);

      // Open: hands overhead (wrist y 0.1), feet wide (ankle dist 0.40)
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.3, y: 0.1, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.7, y: 0.1, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.3, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.7, y: 0.9, visibility: 0.95 };

      res = engine.processFrame(pose, 500);
      expect(res.movementPhase).toBe('inflection');

      // Return to closed
      pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.38, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.62, y: 0.6, visibility: 0.95 };
      pose[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.48, y: 0.9, visibility: 0.95 };
      pose[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.52, y: 0.9, visibility: 0.95 };

      res = engine.processFrame(pose, 1000);
      expect(res.repCompletedThisFrame).toBe(true);
      expect(res.repCount).toBe(1);
    });
  });
});
