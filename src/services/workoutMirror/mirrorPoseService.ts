import { MirrorPoint, POSE_LANDMARKS } from '../../types/workoutMirror';

export interface PoseConnection {
  start: number;
  end: number;
}

export const SKELETON_CONNECTIONS: PoseConnection[] = [
  // Torso box
  { start: POSE_LANDMARKS.LEFT_SHOULDER, end: POSE_LANDMARKS.RIGHT_SHOULDER },
  { start: POSE_LANDMARKS.LEFT_SHOULDER, end: POSE_LANDMARKS.LEFT_HIP },
  { start: POSE_LANDMARKS.RIGHT_SHOULDER, end: POSE_LANDMARKS.RIGHT_HIP },
  { start: POSE_LANDMARKS.LEFT_HIP, end: POSE_LANDMARKS.RIGHT_HIP },

  // Left Arm
  { start: POSE_LANDMARKS.LEFT_SHOULDER, end: POSE_LANDMARKS.LEFT_ELBOW },
  { start: POSE_LANDMARKS.LEFT_ELBOW, end: POSE_LANDMARKS.LEFT_WRIST },

  // Right Arm
  { start: POSE_LANDMARKS.RIGHT_SHOULDER, end: POSE_LANDMARKS.RIGHT_ELBOW },
  { start: POSE_LANDMARKS.RIGHT_ELBOW, end: POSE_LANDMARKS.RIGHT_WRIST },

  // Left Leg
  { start: POSE_LANDMARKS.LEFT_HIP, end: POSE_LANDMARKS.LEFT_KNEE },
  { start: POSE_LANDMARKS.LEFT_KNEE, end: POSE_LANDMARKS.LEFT_ANKLE },
  { start: POSE_LANDMARKS.LEFT_ANKLE, end: POSE_LANDMARKS.LEFT_FOOT_INDEX },

  // Right Leg
  { start: POSE_LANDMARKS.RIGHT_HIP, end: POSE_LANDMARKS.RIGHT_KNEE },
  { start: POSE_LANDMARKS.RIGHT_KNEE, end: POSE_LANDMARKS.RIGHT_ANKLE },
  { start: POSE_LANDMARKS.RIGHT_ANKLE, end: POSE_LANDMARKS.RIGHT_FOOT_INDEX },

  // Head/Collar
  { start: POSE_LANDMARKS.NOSE, end: POSE_LANDMARKS.LEFT_SHOULDER },
  { start: POSE_LANDMARKS.NOSE, end: POSE_LANDMARKS.RIGHT_SHOULDER },
];

export interface SkeletonDrawOptions {
  highlightJoints?: number[];
  colorTheme?: 'volt' | 'warning' | 'alert' | 'cyan';
  lineWidth?: number;
  mirrorHorizontally?: boolean;
}

export class MirrorPoseService {
  private landmarker: any = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;
  private lastInferenceTime = 0;

  async init(): Promise<void> {
    if (this.landmarker) return;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const simd = await vision.FilesetResolver.isSimdSupported();
        const [loader, binary] = simd
          ? await Promise.all([
              import('@mediapipe/tasks-vision/vision_wasm_internal.js?url'),
              import('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'),
            ])
          : await Promise.all([
              import('@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url'),
              import('@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url'),
            ]);

        const fileset = { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default };

        const modelUrl = `${import.meta.env.BASE_URL}models/pose_landmarker_full.task`;
        const res = await fetch(modelUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch pose model: ${res.status}`);
        }
        const modelBuffer = new Uint8Array(await res.arrayBuffer());

        this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetBuffer: modelBuffer,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  isReady(): boolean {
    return this.landmarker !== null;
  }

  detectForVideo(video: HTMLVideoElement, timestampMs: number): MirrorPoint[] | null {
    if (!this.landmarker || !video || video.readyState < 2) {
      return null;
    }

    // Ensure monotonically increasing timestamp for MediaPipe video mode
    const now = Math.max(timestampMs, this.lastInferenceTime + 1);
    this.lastInferenceTime = now;

    try {
      const result = this.landmarker.detectForVideo(video, now);
      if (!result?.landmarks?.[0] || result.landmarks[0].length < 33) {
        return null;
      }

      const raw = result.landmarks[0];
      return raw.map((pt: any) => ({
        x: pt.x,
        y: pt.y,
        z: pt.z,
        visibility: pt.visibility ?? 1.0,
      }));
    } catch {
      return null;
    }
  }

  drawSkeleton(
    ctx: CanvasRenderingContext2D,
    landmarks: MirrorPoint[],
    width: number,
    height: number,
    options: SkeletonDrawOptions = {}
  ): void {
    if (!landmarks || landmarks.length < 33) return;

    const {
      highlightJoints = [],
      colorTheme = 'volt',
      lineWidth = 3,
      mirrorHorizontally = true,
    } = options;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    let primaryColor = '#CCFF00'; // Iron Log volt
    let glowColor = 'rgba(204, 255, 0, 0.4)';
    if (colorTheme === 'warning') {
      primaryColor = '#F59E0B';
      glowColor = 'rgba(245, 158, 11, 0.45)';
    } else if (colorTheme === 'alert') {
      primaryColor = '#EF4444';
      glowColor = 'rgba(239, 68, 68, 0.5)';
    } else if (colorTheme === 'cyan') {
      primaryColor = '#38BDF8';
      glowColor = 'rgba(56, 189, 248, 0.4)';
    }

    const highlightColor = '#EF4444';
    const highlightSet = new Set(highlightJoints);

    const getCanvasCoord = (pt: MirrorPoint) => {
      const x = mirrorHorizontally ? (1 - pt.x) * width : pt.x * width;
      const y = pt.y * height;
      return { x, y };
    };

    // Draw connection lines
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const conn of SKELETON_CONNECTIONS) {
      const p1 = landmarks[conn.start];
      const p2 = landmarks[conn.end];
      if (!p1 || !p2) continue;

      const conf1 = p1.visibility ?? 1;
      const conf2 = p2.visibility ?? 1;
      if (conf1 < 0.4 || conf2 < 0.4) continue;

      const c1 = getCanvasCoord(p1);
      const c2 = getCanvasCoord(p2);

      const isHighlighted = highlightSet.has(conn.start) || highlightSet.has(conn.end);

      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);

      ctx.strokeStyle = isHighlighted ? highlightColor : primaryColor;
      ctx.shadowColor = isHighlighted ? 'rgba(239, 68, 68, 0.6)' : glowColor;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }

    // Draw joint dots
    ctx.shadowBlur = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const pt = landmarks[i];
      if (!pt || (pt.visibility ?? 1) < 0.4) continue;

      // Skip eye/ear detail dots for cleaner mirror aesthetic
      if (i >= 1 && i <= 8) continue;

      const c = getCanvasCoord(pt);
      const isHighlighted = highlightSet.has(i);

      ctx.beginPath();
      const radius = isHighlighted ? 6 : i === POSE_LANDMARKS.NOSE ? 5 : 4;
      ctx.arc(c.x, c.y, radius, 0, 2 * Math.PI);

      ctx.fillStyle = isHighlighted ? highlightColor : '#FFFFFF';
      ctx.strokeStyle = isHighlighted ? '#FFFFFF' : primaryColor;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  dispose(): void {
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        // ignore
      }
      this.landmarker = null;
    }
    this.initPromise = null;
    this.isInitializing = false;
  }
}

export const mirrorPoseService = new MirrorPoseService();
