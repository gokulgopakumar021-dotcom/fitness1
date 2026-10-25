/**
 * On-device pose detection for Body Scan (Phase 2C), built on MediaPipe Tasks
 * Vision "Pose Landmarker" in single-image mode.
 *
 * PRIVACY
 * - Inference runs in this browser tab (WASM, CPU delegate). Photos, frames and
 *   landmarks are never sent anywhere: this module makes exactly ONE kind of
 *   network request, a same-origin GET for the model file. It sends no body.
 * - The MediaPipe package is pinned to 0.10.35 on purpose. Releases from 1.0.0
 *   contain a usage-logging client that posts to a Google endpoint when a task
 *   is created or closed; 0.10.35 contains no network endpoints. Do not bump the
 *   version without re-running the audit in docs/body-scan-pose-model.md (a test
 *   enforces the pin and scans the installed bundle).
 * - The WASM runtime is bundled by Vite as hashed assets on this app's own
 *   origin, and the model is served from `public/models/`. Nothing is fetched
 *   from a CDN or a third-party host.
 * - Nothing here stores, caches or logs photos, landmarks or measurements.
 *
 * LIFECYCLE
 * - Nothing is loaded until `load()` / `detect()` is called (lazy dynamic
 *   import), so the rest of Iron Log pays no start-up cost.
 * - `load()` shares one in-flight attempt and may be retried after a failure.
 * - `dispose()` aborts work in flight and closes the landmarker. A landmarker
 *   that finishes creating after `dispose()` is closed immediately.
 * - After a period with no detections the landmarker is released and is
 *   re-created on the next use (the model file then usually comes from the
 *   browser's HTTP cache).
 *
 * LIMITS
 * - `detect()` is synchronous inside MediaPipe, so it runs on the main thread.
 *   The engine yields to the browser first so a "analysing" state can paint, but
 *   the UI can still pause briefly while the model runs. A Web Worker would fix
 *   that and is deliberately left for a later, device-tested change.
 * - Only one person is tracked (numPoses = 1).
 */

import { adaptPoseLandmarkerResult, type PoseAdaptResult } from '../utils/poseResultAdapter';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** MediaPipe Pose Landmarker bundle served from `public/models/`. See docs/body-scan-pose-model.md. */
export const POSE_MODEL_VARIANT = 'pose_landmarker_full';
export const POSE_MODEL_FILE = `${POSE_MODEL_VARIANT}.task`;

/** Same-origin URL of the model, honouring Vite's `base`. */
export function defaultModelUrl(): string {
  return `${import.meta.env.BASE_URL}models/${POSE_MODEL_FILE}`;
}

/**
 * Smallest response accepted as a model. Only a guard against error pages and
 * empty bodies: it is deliberately far below any real Pose Landmarker bundle.
 */
export const MIN_MODEL_BYTES = 100_000;

/** Landmarker is released after this long without a detection. */
export const IDLE_RELEASE_MS = 120_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PoseEngineErrorCode =
  | 'unsupported' //            this browser cannot run the engine at all
  | 'runtime_load_failed' //    the MediaPipe code / WASM could not be loaded
  | 'model_missing' //          the model file is not deployed (404, or a web page instead of a model)
  | 'model_download_failed' //  network or server problem fetching the model
  | 'model_invalid' //          the response is too small to be a model
  | 'init_failed' //            the landmarker could not be created
  | 'image_decode_failed' //    the photo could not be decoded for analysis
  | 'inference_failed' //       the model threw while analysing the photo
  | 'cancelled' //              the caller's AbortSignal fired
  | 'disposed'; //              the engine was disposed

/** Messages are fixed strings: they never contain image data, landmarks or underlying error text. */
export class PoseEngineError extends Error {
  readonly code: PoseEngineErrorCode;
  constructor(code: PoseEngineErrorCode, message: string) {
    super(message);
    this.name = 'PoseEngineError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PoseEngineStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';

/** The subset of MediaPipe's PoseLandmarker the engine uses. */
export interface LandmarkerLike {
  detect(image: unknown): unknown;
  close(): void;
}

/** Loaded MediaPipe code, able to create a landmarker from model bytes. */
export interface PoseRuntime {
  createLandmarker(modelBytes: Uint8Array): Promise<LandmarkerLike>;
}

export interface DecodedImage {
  source: unknown;
  /** Frees the decoded pixels. Always called, success or not. */
  release(): void;
}

export interface PoseEngineDeps {
  /** Same-origin URL of the model file. Throws RangeError at construction if it is not same-origin. */
  modelUrl?: string;
  loadRuntime?: () => Promise<PoseRuntime>;
  fetchModel?: (url: string, init: RequestInit) => Promise<Response>;
  decodeImage?: (blob: Blob) => Promise<DecodedImage>;
  /** Lets the browser paint before the synchronous inference call. */
  yieldToUi?: () => Promise<void>;
  idleReleaseMs?: number;
}

export interface PoseEngine {
  readonly status: PoseEngineStatus;
  /** Loads the runtime and model. Idempotent; shares one attempt; retry after a failure starts a fresh one. */
  load(signal?: AbortSignal): Promise<void>;
  /** Analyses one photo. Loads first if needed. Never returns data from a different call. */
  detect(blob: Blob, signal?: AbortSignal): Promise<PoseAdaptResult>;
  /** Aborts work in flight and releases the landmarker. Safe to call more than once. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Default implementations (browser)
// ---------------------------------------------------------------------------

/**
 * Loads MediaPipe lazily and points it at WASM files served by this app.
 * `FilesetResolver.forVisionTasks` is not used: it would need a fixed directory,
 * but the bundler emits hashed file names. It only builds this same pair of paths.
 */
async function loadMediaPipeRuntime(): Promise<PoseRuntime> {
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
  return {
    createLandmarker: (modelBytes) =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelBytes, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        outputSegmentationMasks: false,
      }),
  };
}

async function decodeBlobToImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, release: () => bitmap.close() };
  }
  // Older browsers: decode through an <img>. The temporary object URL is revoked as soon as decoding ends.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    return {
      source: img,
      release: () => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function defaultYieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 30);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertSameOrigin(url: string): void {
  if (typeof location === 'undefined') return; // not in a browser: there is no origin to compare against
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    throw new RangeError('Pose model URL is not a valid URL.');
  }
  if (parsed.origin !== location.origin) {
    throw new RangeError('The pose model must be served from this app’s own origin, never a third-party host.');
  }
}

function safeClose(target: { close(): void } | null | undefined): void {
  try {
    target?.close();
  } catch {
    // Releasing is best-effort; there is nothing useful to do if it throws.
  }
}

/** True when the first non-whitespace byte is '<' (an HTML / XML document, never a model bundle). */
const looksLikeWebPage = (bytes: Uint8Array): boolean => {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const c = bytes[i];
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
    return c === 0x3c;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createPoseEngine(deps: PoseEngineDeps = {}): PoseEngine {
  const modelUrl = deps.modelUrl ?? defaultModelUrl();
  assertSameOrigin(modelUrl);
  const loadRuntime = deps.loadRuntime ?? loadMediaPipeRuntime;
  const fetchModel = deps.fetchModel ?? ((url: string, init: RequestInit) => fetch(url, init));
  const decodeImage = deps.decodeImage ?? decodeBlobToImage;
  const yieldToUi = deps.yieldToUi ?? defaultYieldToUi;
  const idleReleaseMs = deps.idleReleaseMs ?? IDLE_RELEASE_MS;

  let status: PoseEngineStatus = 'idle';
  let landmarker: LandmarkerLike | null = null;
  let loading: Promise<void> | null = null;
  let activeDetections = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const lifetime = new AbortController(); // aborted by dispose()

  const disposedError = () => new PoseEngineError('disposed', 'Pose detection was stopped.');
  const cancelledError = () => new PoseEngineError('cancelled', 'Pose detection was cancelled.');

  const checkAlive = () => {
    if (lifetime.signal.aborted) throw disposedError();
  };
  const checkCaller = (signal?: AbortSignal) => {
    checkAlive();
    if (signal?.aborted) throw cancelledError();
  };

  const cancelIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const scheduleIdleRelease = () => {
    cancelIdle();
    if (status !== 'ready' || activeDetections > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (status !== 'ready' || activeDetections > 0) return;
      const lm = landmarker;
      landmarker = null;
      status = 'idle';
      safeClose(lm);
    }, idleReleaseMs);
  };

  async function fetchModelBytes(): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetchModel(modelUrl, { signal: lifetime.signal, credentials: 'same-origin' });
    } catch {
      checkAlive();
      throw new PoseEngineError('model_download_failed', 'The pose model could not be downloaded.');
    }
    if (!response.ok) {
      throw response.status === 404
        ? new PoseEngineError('model_missing', 'The pose model file is not available in this version of the app.')
        : new PoseEngineError('model_download_failed', 'The pose model could not be downloaded.');
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      checkAlive();
      throw new PoseEngineError('model_download_failed', 'The pose model could not be downloaded.');
    }
    // A host that rewrites unknown paths to index.html answers 200 with a web page: that means "not deployed".
    if (/text\/html/i.test(response.headers?.get?.('content-type') ?? '') || looksLikeWebPage(bytes)) {
      throw new PoseEngineError('model_missing', 'The pose model file is not available in this version of the app.');
    }
    if (bytes.byteLength < MIN_MODEL_BYTES) {
      throw new PoseEngineError('model_invalid', 'The pose model file looks incomplete.');
    }
    return bytes;
  }

  async function doLoad(): Promise<void> {
    status = 'loading';
    try {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function' || typeof fetch !== 'function') {
        throw new PoseEngineError('unsupported', 'This browser cannot run on-device pose detection.');
      }
      let runtime: PoseRuntime;
      try {
        runtime = await loadRuntime();
      } catch {
        checkAlive();
        throw new PoseEngineError('runtime_load_failed', 'The pose detection engine could not be loaded.');
      }
      checkAlive();
      const bytes = await fetchModelBytes();
      checkAlive();
      let created: LandmarkerLike;
      try {
        created = await runtime.createLandmarker(bytes);
      } catch {
        checkAlive();
        throw new PoseEngineError('init_failed', 'The pose model could not be started on this device.');
      }
      if (lifetime.signal.aborted) {
        safeClose(created); // finished after dispose(): do not leak it
        throw disposedError();
      }
      landmarker = created;
      status = 'ready';
    } catch (err) {
      if (!lifetime.signal.aborted) status = 'failed';
      throw err instanceof PoseEngineError ? err : new PoseEngineError('init_failed', 'The pose model could not be started on this device.');
    }
  }

  function load(signal?: AbortSignal): Promise<void> {
    try {
      checkCaller(signal);
    } catch (err) {
      return Promise.reject(err);
    }
    if (status === 'ready') return Promise.resolve();
    if (!loading) {
      loading = doLoad().finally(() => {
        loading = null;
      });
    }
    const attempt = loading;
    if (!signal) return attempt;
    // The caller can stop waiting without cancelling the shared attempt (another caller may still need it).
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(cancelledError());
      signal.addEventListener('abort', onAbort, { once: true });
      attempt.then(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  async function detect(blob: Blob, signal?: AbortSignal): Promise<PoseAdaptResult> {
    checkCaller(signal);
    cancelIdle();
    activeDetections++;
    let decoded: DecodedImage | null = null;
    try {
      await load(signal);
      checkCaller(signal);
      try {
        decoded = await decodeImage(blob);
      } catch {
        checkCaller(signal);
        throw new PoseEngineError('image_decode_failed', 'This photo could not be read for analysis.');
      }
      await yieldToUi();
      checkCaller(signal);
      const lm = landmarker;
      if (!lm) throw disposedError();
      let native: unknown;
      try {
        native = lm.detect(decoded.source);
      } catch {
        throw new PoseEngineError('inference_failed', 'Pose detection failed on this photo.');
      }
      const adapted = adaptPoseLandmarkerResult(native);
      if (native !== null && typeof native === 'object' && typeof (native as { close?: unknown }).close === 'function') {
        safeClose(native as { close(): void });
      }
      return adapted;
    } finally {
      if (decoded) {
        try {
          decoded.release();
        } catch {
          // Best-effort: the decoded copy is only in memory and is dropped with its last reference.
        }
      }
      activeDetections--;
      scheduleIdleRelease();
    }
  }

  function dispose(): void {
    if (status === 'disposed') return;
    status = 'disposed';
    lifetime.abort();
    cancelIdle();
    const lm = landmarker;
    landmarker = null;
    safeClose(lm);
  }

  return {
    get status() {
      return status;
    },
    load,
    detect,
    dispose,
  };
}
