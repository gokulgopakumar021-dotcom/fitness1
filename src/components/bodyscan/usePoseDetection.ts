import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanView } from '../../types/bodyScan';
import { PoseEngineError, type PoseEngine, type PoseEngineErrorCode } from '../../services/poseLandmarker';
import { assessPoseDetection, type PoseDetectionOutcome } from '../../utils/poseDetectionAssessment';

/**
 * Pose-detection state for the front and side photos, kept strictly apart: each
 * view has its own state, its own cancellable run and its own landmarks. Nothing
 * here merges or compares the two views.
 *
 * The engine is created lazily on the first accepted photo (so nothing loads
 * before the person actually uses Body Scan) and is disposed when the owning
 * component unmounts. Runs are cancelled on unmount, on retake, and on discard;
 * a result that arrives after that is dropped and never touches state.
 *
 * Landmarks live only in this hook's React state. They are not persisted,
 * logged or sent anywhere.
 */

export type DetectionState =
  | { phase: 'loading_model' }
  | { phase: 'detecting' }
  | { phase: 'done'; outcome: PoseDetectionOutcome }
  | { phase: 'error'; code: PoseEngineErrorCode; message: string; retryable: boolean };

export type DetectionStates = Partial<Record<ScanView, DetectionState>>;

const ERROR_COPY: Record<PoseEngineErrorCode, { message: string; retryable: boolean }> = {
  unsupported: {
    message: 'This browser cannot run pose detection on your device, so this photo cannot be analysed here.',
    retryable: false,
  },
  runtime_load_failed: {
    message: 'The pose detection engine could not be loaded. Check your connection and try again.',
    retryable: true,
  },
  model_missing: {
    message: 'The pose model file is not available in this version of the app, so photos cannot be analysed yet.',
    retryable: true,
  },
  model_download_failed: {
    message: 'The pose model could not be downloaded. Check your connection and try again.',
    retryable: true,
  },
  model_invalid: { message: 'The pose model file looks incomplete, so photos cannot be analysed.', retryable: true },
  init_failed: { message: 'The pose model could not be started on this device.', retryable: true },
  image_decode_failed: { message: 'This photo could not be read for analysis. Try again, or retake it.', retryable: true },
  inference_failed: { message: 'Pose detection hit an error on this photo. Try again, or retake it.', retryable: true },
  cancelled: { message: 'Pose detection was cancelled.', retryable: true },
  disposed: { message: 'Pose detection was stopped.', retryable: true },
};

interface Run {
  id: number;
  controller: AbortController;
}

export function usePoseDetection(createEngine: () => PoseEngine) {
  const [states, setStates] = useState<DetectionStates>({});
  const engineRef = useRef<PoseEngine | null>(null);
  const runsRef = useRef<Partial<Record<ScanView, Run>>>({});
  const nextId = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const runs = runsRef.current;
    return () => {
      mountedRef.current = false;
      for (const view of Object.keys(runs) as ScanView[]) {
        runs[view]?.controller.abort();
        delete runs[view];
      }
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const getEngine = useCallback((): PoseEngine => {
    if (!engineRef.current || engineRef.current.status === 'disposed') engineRef.current = createEngine();
    return engineRef.current;
  }, [createEngine]);

  /** Analyses `blob` as the photo for `view`. Replaces and cancels any earlier run for that view. */
  const run = useCallback(
    (view: ScanView, blob: Blob) => {
      runsRef.current[view]?.controller.abort();
      const controller = new AbortController();
      const id = ++nextId.current;
      runsRef.current[view] = { id, controller };
      const isCurrent = () => mountedRef.current && !controller.signal.aborted && runsRef.current[view]?.id === id;
      const set = (state: DetectionState) => setStates((prev) => ({ ...prev, [view]: state }));

      set({ phase: 'loading_model' });
      void (async () => {
        try {
          const engine = getEngine();
          await engine.load(controller.signal);
          if (!isCurrent()) return;
          set({ phase: 'detecting' });
          const adapted = await engine.detect(blob, controller.signal);
          if (!isCurrent()) return;
          set({ phase: 'done', outcome: assessPoseDetection(view, adapted) });
        } catch (err) {
          if (!isCurrent()) return;
          const code: PoseEngineErrorCode = err instanceof PoseEngineError ? err.code : 'inference_failed';
          if (code === 'cancelled' || code === 'disposed') return;
          set({ phase: 'error', code, ...ERROR_COPY[code] });
        }
      })();
    },
    [getEngine]
  );

  /** Cancels any run for `view` and forgets its result. */
  const clear = useCallback((view: ScanView) => {
    runsRef.current[view]?.controller.abort();
    delete runsRef.current[view];
    setStates((prev) => {
      if (!(view in prev)) return prev;
      const { [view]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const clearAll = useCallback(() => {
    for (const view of Object.keys(runsRef.current) as ScanView[]) {
      runsRef.current[view]?.controller.abort();
      delete runsRef.current[view];
    }
    setStates({});
  }, []);

  return { states, run, clear, clearAll };
}
