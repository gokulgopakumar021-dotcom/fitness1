/**
 * Test-only fakes for on-device pose detection. NEVER import this from
 * production code: it fabricates landmarks and an engine that "detects" them.
 *
 * These let tests check lifecycle and state handling (loading, retry, cancel,
 * dispose, front/side separation). They say NOTHING about how the real MediaPipe
 * model behaves on real photos or devices; that needs manual testing.
 */

import { vi, type Mock } from 'vitest';
import type { LandmarkPoint } from '../types/bodyScan';
import { adaptPoseLandmarkerResult, type PoseAdaptResult } from '../utils/poseResultAdapter';
import { PoseEngineError, type DecodedImage, type LandmarkerLike, type PoseEngine, type PoseRuntime } from './poseLandmarker';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function defer<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A native-shaped Pose Landmarker result built from synthetic landmarks. `close` is a spy. */
export function makeNativeResult(landmarks: readonly LandmarkPoint[] | null) {
  return {
    landmarks: landmarks ? [landmarks.map((p) => ({ z: 0, ...p }))] : [],
    worldLandmarks: landmarks ? [landmarks.map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }))] : [],
    close: vi.fn(),
  };
}

/** Adapted (app-format) result from synthetic landmarks, as the real engine would return it. */
export const adapted = (landmarks: readonly LandmarkPoint[] | null): PoseAdaptResult =>
  adaptPoseLandmarkerResult(makeNativeResult(landmarks));

export interface FakeLandmarker extends LandmarkerLike {
  detect: Mock;
  close: Mock;
}

/** With no argument the landmarker finds nobody. An explicit `undefined` / `null` is returned as-is, to test garbage output. */
export function makeFakeLandmarker(...args: [result?: unknown]): FakeLandmarker {
  const result = args.length === 0 ? makeNativeResult(null) : args[0];
  return { detect: vi.fn(() => result), close: vi.fn() } as FakeLandmarker;
}

export interface FakeRuntime extends PoseRuntime {
  createLandmarker: Mock;
}

export function makeFakeRuntime(landmarker: LandmarkerLike = makeFakeLandmarker()): FakeRuntime {
  return { createLandmarker: vi.fn(async () => landmarker) };
}

/** A fake decoded image whose release is observable. */
export function makeFakeDecode() {
  const released: unknown[] = [];
  const decodeImage = vi.fn(async (blob: Blob): Promise<DecodedImage> => {
    const source = { fakeImageFor: blob };
    return { source, release: () => void released.push(source) };
  });
  return { decodeImage, released };
}

/** A Response-like object for the model fetch. */
export function modelResponse(bytes: number | Uint8Array, init: { status?: number; contentType?: string } = {}): Response {
  const body = typeof bytes === 'number' ? new Uint8Array(bytes).fill(0x50) : bytes; // 'P': not '<'
  return new Response(body as unknown as BodyInit, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/octet-stream' },
  });
}

export interface FakeEngine extends PoseEngine {
  load: Mock;
  detect: Mock;
  dispose: Mock;
}

/**
 * A scriptable stand-in for the pose engine. By default load() resolves at once
 * and detect() resolves with the next queued result (or `no_pose`), honouring
 * the AbortSignal like the real engine. Override with mockImplementationOnce.
 */
export function createFakePoseEngine(queuedResults: PoseAdaptResult[] = []): FakeEngine {
  const queue = [...queuedResults];
  let disposed = false;
  const engine = {
    get status() {
      return disposed ? ('disposed' as const) : ('ready' as const);
    },
    load: vi.fn(async (signal?: AbortSignal) => {
      if (disposed) throw new PoseEngineError('disposed', 'Pose detection was stopped.');
      if (signal?.aborted) throw new PoseEngineError('cancelled', 'Pose detection was cancelled.');
    }),
    detect: vi.fn(async (_blob: Blob, signal?: AbortSignal): Promise<PoseAdaptResult> => {
      if (disposed) throw new PoseEngineError('disposed', 'Pose detection was stopped.');
      if (signal?.aborted) throw new PoseEngineError('cancelled', 'Pose detection was cancelled.');
      return queue.shift() ?? { ok: false, reason: 'no_pose' };
    }),
    dispose: vi.fn(() => {
      disposed = true;
    }),
  };
  return engine as FakeEngine;
}
