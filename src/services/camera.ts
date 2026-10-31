/**
 * Camera service for Body Scan.
 *
 * Framework-free (no React). Owns the MediaStream lifecycle so that camera
 * tracks are always released, including when a permission prompt is still
 * pending at the moment the user leaves.
 *
 * PRIVACY
 * - Never starts on its own. `start()` is only called from a user action.
 * - Video only (`audio: false`). The microphone is never requested.
 * - Frames are never read, copied, uploaded or logged here. The stream is only
 *   handed to a <video> element for live preview.
 * - Errors are classified into user-facing messages; raw errors are not logged.
 */

export type CameraStatus =
  | 'not_requested' // camera is off and nothing has been asked of the browser
  | 'requesting' //    getUserMedia is pending (permission prompt may be showing)
  | 'granted' //       a live stream is running
  | 'denied' //        permission refused, blocked by policy, or revoked
  | 'unavailable' //   no camera / unsupported browser / insecure context
  | 'error'; //        camera exists but could not be started or stopped unexpectedly

export type CameraFailureCode =
  | 'permission_denied'
  | 'permission_revoked'
  | 'insecure_context'
  | 'unsupported'
  | 'no_camera'
  | 'in_use'
  | 'track_ended'
  | 'unknown';

export interface CameraFailure {
  code: CameraFailureCode;
  /** Short heading. */
  title: string;
  /** What happened and what the user can do. */
  message: string;
  /** Extra hint, shown in smaller text. */
  hint?: string;
}

/** Why a camera that was running has been switched off by the app (not a failure). */
export type CameraNotice = 'page_hidden';

export type CameraFacing = 'user' | 'environment' | 'unknown';

export interface CameraState {
  status: CameraStatus;
  stream: MediaStream | null;
  failure: CameraFailure | null;
  notice: CameraNotice | null;
  facing: CameraFacing;
  /** True once granted and the device reports more than one video input. */
  canSwitch: boolean;
}

export interface StartOptions {
  /** Preferred camera direction on phones. Default 'user' (front camera, so the person can see themselves). */
  facingMode?: 'user' | 'environment';
  /** Specific camera, used by switchCamera(). */
  deviceId?: string;
}

export const INITIAL_CAMERA_STATE: CameraState = {
  status: 'not_requested',
  stream: null,
  failure: null,
  notice: null,
  facing: 'unknown',
  canSwitch: false,
};

// ---------------------------------------------------------------------------
// Messages & classification
// ---------------------------------------------------------------------------

const FAILURES: Record<CameraFailureCode, Omit<CameraFailure, 'code'>> = {
  permission_denied: {
    title: 'Camera access was blocked',
    message:
      'IronLog AI cannot use your camera because permission was not granted. To take Body Scan photos, allow camera access for this site in your browser or device settings, then try again.',
    hint: 'If you are viewing IronLog AI inside an embedded preview, the page hosting it must also allow camera access.',
  },
  permission_revoked: {
    title: 'Camera access was turned off',
    message:
      'Camera permission was removed while the camera was on, so it has been switched off. Allow camera access for this site in your browser or device settings to continue.',
  },
  insecure_context: {
    title: 'Camera needs a secure connection',
    message:
      'Browsers only allow camera access on secure (HTTPS) pages. Open IronLog AI over HTTPS, or from localhost during development.',
  },
  unsupported: {
    title: 'Camera is not supported here',
    message:
      'This browser does not support camera access. Try an up-to-date version of Chrome, Safari, Edge or Firefox.',
  },
  no_camera: {
    title: 'No camera found',
    message:
      'No camera was found on this device. Connect a camera and try again, or use a device that has one. You can still enter measurements manually.',
  },
  in_use: {
    title: 'Camera could not be started',
    message:
      'The camera did not start. It may be in use by another app or browser tab. Close anything else using the camera and try again.',
  },
  track_ended: {
    title: 'Camera stopped unexpectedly',
    message:
      'The camera stopped, for example because it was disconnected or another app took it over. Check the camera and try again.',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'The camera could not be started. Please try again.',
  },
};

export function buildFailure(code: CameraFailureCode): CameraFailure {
  return { code, ...FAILURES[code] };
}

const failureStatus = (code: CameraFailureCode): CameraStatus => {
  switch (code) {
    case 'permission_denied':
    case 'permission_revoked':
      return 'denied';
    case 'insecure_context':
    case 'unsupported':
    case 'no_camera':
      return 'unavailable';
    default:
      return 'error';
  }
};

const errorName = (err: unknown): string =>
  typeof err === 'object' && err !== null && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : '';

/** Maps a getUserMedia rejection to a failure. Never returns null; unknown errors become `unknown`. */
export function classifyCameraError(err: unknown): CameraFailure {
  switch (errorName(err)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return buildFailure('permission_denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return buildFailure('no_camera');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return buildFailure('in_use');
    default:
      return buildFailure('unknown');
  }
}

const isOverconstrained = (err: unknown): boolean =>
  errorName(err) === 'OverconstrainedError' || errorName(err) === 'ConstraintNotSatisfiedError';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Returns a failure if the camera cannot even be attempted in this environment, else null. */
export function getCameraEnvironmentFailure(): CameraFailure | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return buildFailure('insecure_context');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return buildFailure('unsupported');
  }
  return null;
}

export type PermissionQueryResult = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Reads the camera permission without prompting. 'unknown' where the Permissions API cannot query the camera (e.g. Safari). */
export async function queryCameraPermission(): Promise<PermissionQueryResult> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* stopping must never throw into the caller */
    }
  }
}

async function countVideoInputs(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}

function facingOf(stream: MediaStream): CameraFacing {
  const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  return facing === 'user' || facing === 'environment' ? facing : 'unknown';
}

function buildConstraints(opts: StartOptions): MediaStreamConstraints {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
  else video.facingMode = { ideal: opts.facingMode ?? 'user' };
  return { video, audio: false };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

type Listener = () => void;

/**
 * Owns one camera session at a time.
 *
 * Guarantees:
 * - Every stream it opens is stopped: on stop(), when replaced by a new
 *   start(), when its track ends, when permission is revoked, and if it
 *   arrives after the session was cancelled (late-resolving permission prompt).
 * - After stop() the controller is idle and can be started again.
 */
export class CameraController {
  private state: CameraState = INITIAL_CAMERA_STATE;
  private listeners = new Set<Listener>();
  /** Incremented on every start()/stop(); an async step whose token is stale discards its result. */
  private token = 0;
  private stream: MediaStream | null = null;
  private detachWatchers: (() => void) | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): CameraState => this.state;

  private set(next: Partial<CameraState>): void {
    this.state = { ...this.state, ...next };
    for (const l of Array.from(this.listeners)) l();
  }

  /** Stops the active stream (if any) and removes watchers. Does not change status. */
  private releaseStream(): void {
    this.detachWatchers?.();
    this.detachWatchers = null;
    stopStream(this.stream);
    this.stream = null;
  }

  /** Must be called from a user action. Replaces any running or pending session. */
  async start(opts: StartOptions = {}): Promise<void> {
    const myToken = ++this.token;
    this.releaseStream();

    const envFailure = getCameraEnvironmentFailure();
    if (envFailure) {
      this.set({ status: failureStatus(envFailure.code), stream: null, failure: envFailure, notice: null, canSwitch: false });
      return;
    }

    this.set({ status: 'requesting', stream: null, failure: null, notice: null, canSwitch: false });

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(opts));
      } catch (err) {
        // A stale deviceId or unsupported resolution must not block the camera entirely.
        if (!isOverconstrained(err) || myToken !== this.token) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    } catch (err) {
      if (myToken !== this.token) return; // cancelled; nothing to release, nothing to report
      const failure = classifyCameraError(err);
      this.set({ status: failureStatus(failure.code), stream: null, failure, canSwitch: false });
      return;
    }

    if (myToken !== this.token) {
      // The user left / cancelled while the browser prompt was open. Do not leak the camera.
      stopStream(stream);
      return;
    }

    this.stream = stream;
    this.attachWatchers(stream, myToken);
    this.set({ status: 'granted', stream, failure: null, notice: null, facing: facingOf(stream), canSwitch: false });

    const inputs = await countVideoInputs();
    if (myToken === this.token) this.set({ canSwitch: inputs > 1 });
  }

  /** Cycles to the next video input. No-op unless more than one exists. */
  async switchCamera(): Promise<void> {
    // Only a camera that is already running can be switched. Never turns the camera on by itself.
    if (this.state.status !== 'granted' || !this.stream) return;
    const myToken = this.token;
    const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(
      (d) => d.kind === 'videoinput' && d.deviceId
    );
    // stop() (unmount, cancel, hidden tab) or another start() ran while devices were being listed:
    // do not reopen the camera for a session that no longer exists.
    if (myToken !== this.token) return;
    if (devices.length < 2) return;
    const currentId = this.stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
    const index = devices.findIndex((d) => d.deviceId === currentId);
    const next = devices[(index + 1) % devices.length];
    // start() releases the current stream first; many phones cannot open two cameras at once.
    await this.start({ deviceId: next.deviceId });
  }

  /** Switches the camera off. `notice` explains an app-initiated stop to the user. Safe to call repeatedly. */
  stop(notice: CameraNotice | null = null): void {
    this.token++; // cancels any pending start()
    this.releaseStream();
    if (this.state.status !== 'not_requested' || this.state.stream || this.state.notice !== notice) {
      this.set({ ...INITIAL_CAMERA_STATE, notice });
    }
  }

  private attachWatchers(stream: MediaStream, myToken: number): void {
    const cleanups: Array<() => void> = [];
    let active = true; // false once these watchers have been detached

    // Track ended by the browser/OS: permission revoked, device unplugged, taken by another app.
    // (Calling track.stop() ourselves does not fire 'ended'.)
    const onEnded = () => {
      if (myToken !== this.token) return;
      this.releaseStream();
      void queryCameraPermission().then((permission) => {
        if (myToken !== this.token) return;
        const code: CameraFailureCode = permission === 'denied' ? 'permission_revoked' : 'track_ended';
        const failure = buildFailure(code);
        this.set({ status: failureStatus(code), stream: null, failure, canSwitch: false });
      });
    };
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', onEnded);
      cleanups.push(() => track.removeEventListener('ended', onEnded));
    }

    // Permission changed to 'denied' while running (some browsers keep the track alive).
    void (async () => {
      try {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (!active || myToken !== this.token) return;
        const onChange = () => {
          if (!active || myToken !== this.token || status.state !== 'denied') return;
          this.releaseStream();
          const failure = buildFailure('permission_revoked');
          this.set({ status: 'denied', stream: null, failure, canSwitch: false });
        };
        status.addEventListener('change', onChange);
        cleanups.push(() => status.removeEventListener('change', onChange));
      } catch {
        /* Permissions API not available for 'camera' here; track 'ended' still covers revocation in most browsers. */
      }
    })();

    this.detachWatchers = () => {
      active = false;
      for (const c of cleanups.splice(0)) c();
    };
  }
}
