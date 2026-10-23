import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, LoaderCircle, RotateCcw, ShieldCheck, SwitchCamera, Timer, X } from 'lucide-react';
import type { NewScanPhoto, ScanView } from '../../types/bodyScan';
import { queryCameraPermission, type PermissionQueryResult } from '../../services/camera';
import { FrameCaptureError, captureFrame } from '../../services/frameCapture';
import type { CaptureQualityAssessment } from '../../utils/captureQuality';
import { CAPTURE_GUIDANCE } from './captureGuidance';
import { CaptureQualityPanel } from './CaptureQualityPanel';
import { useCamera } from './useCamera';
import { useObjectUrl } from './useObjectUrl';

interface CameraCaptureProps {
  view: ScanView;
  /** Called when the person accepts the photo. The photo is in memory only; the caller decides what to do (this phase: nothing persistent). */
  onCaptured: (photo: NewScanPhoto) => void;
  /** Called after the camera has been released. */
  onCancel: () => void;
  /**
   * A real quality assessment, when a later phase can produce one. Phase 2B passes
   * nothing, and the panel then states that automatic checks are not running.
   */
  qualityAssessment?: CaptureQualityAssessment | null;
}

type Phase = 'intro' | 'requesting' | 'live' | 'problem' | 'review';
type TimerOption = 0 | 3 | 5 | 10;

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400';
const primaryBtn = `touch-press inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-lime-400 hover:bg-lime-300 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-black font-bold text-sm rounded-xl transition-colors ${focusRing}`;
const secondaryBtn = `touch-press inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 text-zinc-200 rounded-xl text-xs font-semibold ${focusRing}`;

export const CameraCapture: React.FC<CameraCaptureProps> = ({ view, onCaptured, onCancel, qualityAssessment = null }) => {
  const guidance = CAPTURE_GUIDANCE[view];
  const cam = useCamera();
  const { start, stop, switchCamera } = cam;

  const [photo, setPhoto] = useState<NewScanPhoto | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<TimerOption>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [knownPermission, setKnownPermission] = useState<PermissionQueryResult>('unknown');

  const videoRef = useRef<HTMLVideoElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);
  const previewUrl = useObjectUrl(photo?.blob ?? null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const phase: Phase = photo
    ? 'review'
    : cam.status === 'granted'
      ? 'live'
      : cam.status === 'requesting'
        ? 'requesting'
        : cam.status === 'not_requested'
          ? 'intro'
          : 'problem';

  // Read (never request) the current permission so the intro can warn if the browser is already blocking the camera.
  useEffect(() => {
    let cancelled = false;
    void queryCameraPermission().then((p) => {
      if (!cancelled) setKnownPermission(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Attach / detach the live stream. The track release itself is owned by the camera controller.
  useEffect(() => {
    const video = videoRef.current;
    setVideoReady(false);
    if (!video) return;
    video.srcObject = cam.stream;
    if (cam.stream) {
      const playing = video.play?.();
      if (playing && typeof playing.catch === 'function') playing.catch(() => undefined);
    }
    return () => {
      video.srcObject = null;
    };
  }, [cam.stream]);

  // Move keyboard / screen-reader focus to the new step heading when the step changes.
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [phase]);

  // A running countdown must not outlive the camera.
  useEffect(() => {
    if (cam.status !== 'granted') setCountdown(null);
  }, [cam.status]);

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCaptureError(null);
    try {
      const taken = await captureFrame(video, view);
      if (!mountedRef.current) return; // left the screen while encoding: discard
      setPhoto(taken);
      stop(); // camera off as soon as the photo exists
    } catch (err) {
      if (!mountedRef.current) return;
      setCaptureError(err instanceof FrameCaptureError ? err.message : 'The photo could not be taken. Please try again.');
    }
  }, [view, stop]);

  // Self-timer tick. Cleanup clears the timeout so nothing fires after unmount or cancel.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      void takePhoto();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown, takePhoto]);

  const handleShutter = () => {
    if (countdown !== null) {
      setCountdown(null); // second press cancels the timer
      return;
    }
    if (timerSeconds > 0) setCountdown(timerSeconds);
    else void takePhoto();
  };

  const handleCancel = () => {
    setCountdown(null);
    stop();
    onCancel();
  };

  const handleRetake = () => {
    setPhoto(null);
    setCaptureError(null);
    void start();
  };

  const canShoot = phase === 'live' && videoReady;
  const mirrored = cam.facing !== 'environment';
  const failure = cam.failure;
  const canRetry = !!failure && failure.code !== 'unsupported' && failure.code !== 'insecure_context';

  const heading =
    phase === 'review'
      ? `Review your ${guidance.label.toLowerCase()} photo`
      : phase === 'live'
        ? `${guidance.title}: camera on`
        : phase === 'problem'
          ? (failure?.title ?? 'Camera problem')
          : phase === 'requesting'
            ? 'Waiting for camera permission'
            : guidance.title;

  const announcement =
    phase === 'live'
      ? videoReady
        ? 'Camera is on and ready.'
        : 'Camera is on. Preparing preview.'
      : phase === 'review'
        ? 'Photo taken. Camera is off.'
        : phase === 'problem'
          ? `${failure?.title ?? 'Camera problem'}. Camera is off.`
          : phase === 'requesting'
            ? 'Waiting for camera permission.'
            : 'Camera is off.';

  return (
    <section
      aria-labelledby="camera-capture-heading"
      className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-4 sm:p-5 lg:p-7 shadow-xl space-y-5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleCancel();
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
            Photo {guidance.stepNumber} of 2 · {guidance.label} view
          </div>
          <h2
            id="camera-capture-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg sm:text-xl font-bold text-zinc-100 outline-none"
          >
            {heading}
          </h2>
        </div>
        <button type="button" onClick={handleCancel} className={secondaryBtn} aria-label="Cancel and turn the camera off">
          <X className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Cancel</span>
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Stage */}
        <div className="space-y-3 min-w-0">
          <div className="relative w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black min-h-[16rem]">
            {phase === 'live' && cam.stream && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  aria-label="Live camera preview"
                  onLoadedData={() => setVideoReady(true)}
                  onPlaying={() => setVideoReady(true)}
                  className={`block w-full max-h-[70vh] object-contain bg-black ${mirrored ? '-scale-x-100' : ''}`}
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 100 150"
                  preserveAspectRatio="xMidYMid meet"
                  className="pointer-events-none absolute inset-0 h-full w-full text-lime-400/70"
                >
                  <rect x="12" y="6" width="76" height="138" rx="4" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="3 2" />
                  <ellipse cx="50" cy="22" rx="7" ry="9" fill="none" stroke="currentColor" strokeWidth="0.6" />
                  <path d="M36 38 H64 L68 86 H32 Z M40 86 V138 M60 86 V138" fill="none" stroke="currentColor" strokeWidth="0.6" />
                </svg>
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-100">
                  <span className="h-2 w-2 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden="true" />
                  Camera on
                </div>
                <div className="absolute inset-x-0 bottom-2 px-3 text-center text-[11px] text-zinc-300">
                  Alignment guide only. No body detection is running.
                </div>
                {countdown !== null && (
                  <div
                    role="status"
                    aria-live="assertive"
                    className="absolute inset-0 flex items-center justify-center bg-black/40 text-7xl font-black text-lime-400"
                    data-testid="countdown"
                  >
                    {countdown}
                  </div>
                )}
              </>
            )}

            {phase === 'review' && previewUrl && (
              <img
                src={previewUrl}
                alt={`Your ${guidance.label.toLowerCase()} photo, for review. It exists only in this tab.`}
                className="block w-full max-h-[70vh] object-contain bg-black"
              />
            )}

            {phase === 'requesting' && (
              <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 p-6 text-center text-zinc-300">
                <LoaderCircle className="h-8 w-8 motion-safe:animate-spin text-lime-400" aria-hidden="true" />
                <p className="text-sm">Waiting for camera permission…</p>
                <p className="text-xs text-zinc-500">Choose “Allow” in your browser’s prompt to continue.</p>
              </div>
            )}

            {phase === 'intro' && (
              <div className="flex min-h-[16rem] flex-col items-center justify-center gap-4 p-6 text-center">
                <Camera className="h-10 w-10 text-lime-400" aria-hidden="true" />
                {cam.notice === 'page_hidden' && (
                  <p role="status" className="max-w-sm rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    The camera was switched off because you left this tab or app. Turn it back on when you are ready.
                  </p>
                )}
                {knownPermission === 'denied' && (
                  <p className="max-w-sm rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Your browser is currently blocking camera access for this site. You will need to allow it in your
                    browser or device settings before the camera can start.
                  </p>
                )}
                <p className="max-w-sm text-xs leading-relaxed text-zinc-300">
                  Turning on the camera shows a live preview so you can line up your {guidance.label.toLowerCase()} photo. Your
                  browser will ask for permission first.
                </p>
                <button type="button" onClick={() => void start()} className={primaryBtn}>
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  Turn on camera
                </button>
              </div>
            )}

            {phase === 'problem' && failure && (
              <div role="alert" className="flex min-h-[16rem] flex-col items-center justify-center gap-3 p-6 text-center">
                <CameraOff className="h-9 w-9 text-rose-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-zinc-100">{failure.title}</p>
                <p className="max-w-md text-xs leading-relaxed text-zinc-300">{failure.message}</p>
                {failure.hint && <p className="max-w-md text-[11px] leading-relaxed text-zinc-500">{failure.hint}</p>}
                <p className="max-w-md text-[11px] text-zinc-500">You can still add measurements by hand from Body Metrics.</p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {canRetry && (
                    <button type="button" onClick={() => void start()} className={primaryBtn}>
                      Try again
                    </button>
                  )}
                  <button type="button" onClick={handleCancel} className={secondaryBtn}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>

          {captureError && (
            <p role="alert" className="text-xs text-rose-400">
              {captureError}
            </p>
          )}

          {/* Controls */}
          {phase === 'live' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-400" htmlFor="capture-timer">
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  Self-timer
                </label>
                <select
                  id="capture-timer"
                  value={timerSeconds}
                  disabled={countdown !== null}
                  onChange={(e) => setTimerSeconds(Number(e.target.value) as TimerOption)}
                  className={`rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-200 ${focusRing}`}
                >
                  <option value={0}>Off</option>
                  <option value={3}>3 seconds</option>
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                {cam.canSwitch && (
                  <button type="button" onClick={() => void switchCamera()} className={secondaryBtn} aria-label="Switch camera">
                    <SwitchCamera className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Switch camera</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleShutter}
                  disabled={!canShoot}
                  className={primaryBtn}
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  {countdown !== null ? 'Cancel timer' : timerSeconds > 0 ? `Start ${timerSeconds}s timer` : 'Take photo'}
                </button>
              </div>
            </div>
          )}

          {phase === 'review' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-zinc-400">
                Check that your whole body is visible from head to feet. The photo is shown as taken, so it may look flipped
                compared with the live preview. It exists only in this tab and is not saved or uploaded.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleRetake} className={secondaryBtn}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Retake
                </button>
                <button type="button" onClick={() => photo && onCaptured(photo)} className={primaryBtn}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Use this photo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Guidance + quality */}
        <div className="space-y-4 min-w-0">
          <section aria-labelledby="capture-guidance-heading" className="space-y-2">
            <h3 id="capture-guidance-heading" className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-300">
              How to take your {guidance.label.toLowerCase()} photo
            </h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-zinc-300 marker:text-lime-400">
              {guidance.instructions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </section>

          <CaptureQualityPanel assessment={qualityAssessment} />

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-400" aria-hidden="true" />
            <span>
              Frames stay on this device. Nothing is uploaded, recorded or saved here, and the camera switches off when you
              take the photo, cancel, or leave this screen.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
};
