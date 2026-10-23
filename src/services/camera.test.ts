import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CameraController,
  classifyCameraError,
  getCameraEnvironmentFailure,
  stopStream,
  type CameraFailureCode,
} from './camera';
import {
  FakeStream,
  FakeTrack,
  domError,
  installFakeCamera,
  removeMediaDevices,
  setSecureContext,
  type FakeCamera,
} from './fakeMedia.testutil';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let cam: FakeCamera;
beforeEach(() => {
  cam = installFakeCamera();
});
afterEach(() => cam.uninstall());

describe('classifyCameraError', () => {
  const cases: Array<[string, CameraFailureCode]> = [
    ['NotAllowedError', 'permission_denied'],
    ['PermissionDeniedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'no_camera'],
    ['DevicesNotFoundError', 'no_camera'],
    ['NotReadableError', 'in_use'],
    ['TrackStartError', 'in_use'],
    ['AbortError', 'in_use'],
    ['SomethingElse', 'unknown'],
  ];
  it.each(cases)('%s -> %s', (name, code) => {
    expect(classifyCameraError(domError(name)).code).toBe(code);
  });
  it('never throws on non-error values and falls back to unknown', () => {
    for (const v of [null, undefined, 42, 'boom', {}, { name: 5 }]) {
      expect(classifyCameraError(v).code).toBe('unknown');
    }
  });
  it('gives every failure a title and an actionable message', () => {
    for (const [name] of cases) {
      const f = classifyCameraError(domError(name));
      expect(f.title.length).toBeGreaterThan(5);
      expect(f.message.length).toBeGreaterThan(20);
    }
  });
});

describe('environment checks', () => {
  it('reports unsupported when mediaDevices is missing', () => {
    const restore = removeMediaDevices();
    expect(getCameraEnvironmentFailure()?.code).toBe('unsupported');
    restore();
  });
  it('reports insecure_context on non-secure pages', () => {
    const restore = setSecureContext(false);
    expect(getCameraEnvironmentFailure()?.code).toBe('insecure_context');
    restore();
  });
  it('reports nothing when the camera API is usable', () => {
    expect(getCameraEnvironmentFailure()).toBeNull();
  });
});

describe('CameraController: permission states', () => {
  it('starts as not_requested and does NOT touch the camera until start() is called', () => {
    const c = new CameraController();
    expect(c.getState()).toMatchObject({ status: 'not_requested', stream: null, failure: null });
    expect(cam.getUserMedia).not.toHaveBeenCalled();
  });

  it('goes requesting -> granted and asks for video only (never audio)', async () => {
    const c = new CameraController();
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.getState().status));
    await c.start();
    expect(seen).toContain('requesting');
    expect(c.getState().status).toBe('granted');
    expect(c.getState().stream).not.toBeNull();
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
    expect(cam.getUserMedia.mock.calls[0][0].video).toBeTruthy();
  });

  it('maps a refused prompt to denied with no stream', async () => {
    const c = new CameraController();
    cam.failNext(domError('NotAllowedError'));
    await c.start();
    expect(c.getState()).toMatchObject({ status: 'denied', stream: null });
    expect(c.getState().failure?.code).toBe('permission_denied');
  });

  it('maps a missing camera to unavailable', async () => {
    const c = new CameraController();
    cam.failNext(domError('NotFoundError'));
    await c.start();
    expect(c.getState().status).toBe('unavailable');
    expect(c.getState().failure?.code).toBe('no_camera');
  });

  it('maps a busy camera to error', async () => {
    const c = new CameraController();
    cam.failNext(domError('NotReadableError'));
    await c.start();
    expect(c.getState().status).toBe('error');
    expect(c.getState().failure?.code).toBe('in_use');
  });

  it('reports unavailable without calling getUserMedia when the API is missing', async () => {
    const restore = removeMediaDevices();
    const c = new CameraController();
    await c.start();
    expect(c.getState()).toMatchObject({ status: 'unavailable' });
    expect(c.getState().failure?.code).toBe('unsupported');
    restore();
  });

  it('reports unavailable on insecure pages without prompting', async () => {
    const restore = setSecureContext(false);
    const c = new CameraController();
    await c.start();
    expect(c.getState().failure?.code).toBe('insecure_context');
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    restore();
  });

  it('can be retried after a denial', async () => {
    const c = new CameraController();
    cam.failNext(domError('NotAllowedError'));
    await c.start();
    await c.start();
    expect(c.getState().status).toBe('granted');
    expect(c.getState().failure).toBeNull();
  });

  it('retries once with relaxed constraints when the preferred ones are overconstrained', async () => {
    const c = new CameraController();
    cam.failNext(domError('OverconstrainedError'));
    await c.start({ deviceId: 'stale-id' });
    expect(cam.getUserMedia).toHaveBeenCalledTimes(2);
    expect(cam.getUserMedia.mock.calls[1][0]).toEqual({ video: true, audio: false });
    expect(c.getState().status).toBe('granted');
  });
});

describe('CameraController: lifecycle cleanup', () => {
  it('stop() releases every track and returns to not_requested', async () => {
    const c = new CameraController();
    await c.start();
    const s = cam.streams[0];
    expect(s.allStopped).toBe(false);
    c.stop();
    expect(s.allStopped).toBe(true);
    expect(c.getState()).toMatchObject({ status: 'not_requested', stream: null });
  });

  it('stop() is idempotent and safe before any start', () => {
    const c = new CameraController();
    expect(() => {
      c.stop();
      c.stop();
    }).not.toThrow();
    expect(c.getState().status).toBe('not_requested');
  });

  it('stop() after a failure clears the failure (cancel from an error screen)', async () => {
    const c = new CameraController();
    cam.failNext(domError('NotAllowedError'));
    await c.start();
    c.stop();
    expect(c.getState()).toMatchObject({ status: 'not_requested', failure: null });
  });

  it('stop(notice) records why the app switched the camera off', async () => {
    const c = new CameraController();
    await c.start();
    c.stop('page_hidden');
    expect(c.getState()).toMatchObject({ status: 'not_requested', notice: 'page_hidden' });
    await c.start();
    expect(c.getState().notice).toBeNull();
  });

  it('stops a stream that arrives AFTER stop() (user left while the permission prompt was open)', async () => {
    const c = new CameraController();
    const pending = cam.deferNext();
    const started = c.start();
    expect(c.getState().status).toBe('requesting');
    c.stop();
    pending.resolve();
    await started;
    expect(cam.streams).toHaveLength(1);
    expect(cam.streams[0].allStopped).toBe(true);
    expect(c.getState()).toMatchObject({ status: 'not_requested', stream: null });
  });

  it('ignores a late DENIAL after stop() instead of showing an error to someone who left', async () => {
    const c = new CameraController();
    const pending = cam.deferNext();
    const started = c.start();
    c.stop();
    pending.reject(domError('NotAllowedError'));
    await started;
    expect(c.getState()).toMatchObject({ status: 'not_requested', failure: null });
  });

  it('a second start() supersedes the first: the first stream is stopped, only the second is live', async () => {
    const c = new CameraController();
    const first = cam.deferNext();
    const p1 = c.start();
    const p2 = c.start(); // second call uses the default immediate implementation
    first.resolve();
    await Promise.all([p1, p2]);
    expect(cam.streams).toHaveLength(2);
    // Creation order differs from call order (the first request was held open), so identify streams by identity.
    const live = cam.streams.find((s) => s.asMediaStream() === c.getState().stream)!;
    const superseded = cam.streams.find((s) => s !== live)!;
    expect(live).toBeDefined();
    expect(superseded.allStopped).toBe(true);
    expect(live.allStopped).toBe(false);
    expect(c.getState().status).toBe('granted');
  });

  it('start() while already streaming stops the old stream before opening a new one', async () => {
    const c = new CameraController();
    await c.start();
    const s1 = cam.streams[0];
    let s1StoppedBeforeNextRequest = false;
    cam.getUserMedia.mockImplementationOnce(async () => {
      s1StoppedBeforeNextRequest = s1.allStopped;
      const s = new FakeStream([new FakeTrack('video')]);
      cam.streams.push(s);
      return s.asMediaStream();
    });
    await c.start();
    expect(s1StoppedBeforeNextRequest).toBe(true);
  });

  it('removes its track listeners when stopped', async () => {
    const c = new CameraController();
    await c.start();
    const track = cam.streams[0].tracks[0];
    expect(track.listenerCount('ended')).toBe(1);
    c.stop();
    expect(track.listenerCount('ended')).toBe(0);
  });

  it('can be restarted after stop()', async () => {
    const c = new CameraController();
    await c.start();
    c.stop();
    await c.start();
    expect(c.getState().status).toBe('granted');
    expect(cam.streams[1].allStopped).toBe(false);
  });

  it('stopStream tolerates null and tracks that throw', () => {
    expect(() => stopStream(null)).not.toThrow();
    const bad = new FakeTrack();
    bad.stop.mockImplementation(() => {
      throw new Error('boom');
    });
    const good = new FakeTrack();
    expect(() => stopStream(new FakeStream([bad, good]).asMediaStream())).not.toThrow();
    expect(good.stopped).toBe(true);
  });
});

describe('CameraController: revocation and unexpected stops', () => {
  it('a track ending while permission is now denied is reported as revoked, and everything is stopped', async () => {
    const c = new CameraController();
    await c.start();
    const s = cam.streams[0];
    cam.permission.state = 'denied';
    s.tracks[0].emitEnded();
    await flush();
    expect(c.getState()).toMatchObject({ status: 'denied', stream: null });
    expect(c.getState().failure?.code).toBe('permission_revoked');
    expect(s.allStopped).toBe(true);
  });

  it('a track ending for another reason (unplugged) is an error, not a permission problem', async () => {
    const c = new CameraController();
    await c.start();
    cam.permission.state = 'granted';
    cam.streams[0].tracks[0].emitEnded();
    await flush();
    expect(c.getState().status).toBe('error');
    expect(c.getState().failure?.code).toBe('track_ended');
  });

  it('where the Permissions API cannot query the camera, an ended track is a generic stop (no false "revoked" claim)', async () => {
    cam.uninstall();
    cam = installFakeCamera({ permissionsApiThrows: true });
    const c = new CameraController();
    await c.start();
    cam.streams[0].tracks[0].emitEnded();
    await flush();
    expect(c.getState().failure?.code).toBe('track_ended');
  });

  it('permission flipping to denied while the track is still alive stops the camera', async () => {
    const c = new CameraController();
    await c.start();
    await flush();
    const s = cam.streams[0];
    cam.permission.change('denied');
    expect(c.getState()).toMatchObject({ status: 'denied', stream: null });
    expect(c.getState().failure?.code).toBe('permission_revoked');
    expect(s.allStopped).toBe(true);
  });

  it('removes the permission listener on stop()', async () => {
    const c = new CameraController();
    await c.start();
    await flush();
    expect(cam.permission.listenerCount).toBe(1);
    c.stop();
    expect(cam.permission.listenerCount).toBe(0);
  });

  it('an ended event from an OLD stream does not disturb a newer one', async () => {
    const c = new CameraController();
    await c.start();
    const old = cam.streams[0];
    await c.start();
    old.tracks[0].emitEnded(); // no listeners remain, so nothing should happen
    await flush();
    expect(c.getState().status).toBe('granted');
    expect(cam.streams[1].allStopped).toBe(false);
  });
});

describe('CameraController: switching cameras', () => {
  beforeEach(() => {
    cam.uninstall();
    cam = installFakeCamera({
      devices: [
        { deviceId: 'front', label: 'Front' },
        { deviceId: 'back', label: 'Back' },
      ],
    });
  });

  it('reports canSwitch only when more than one video input exists', async () => {
    const c = new CameraController();
    await c.start();
    expect(c.getState().canSwitch).toBe(true);

    cam.uninstall();
    cam = installFakeCamera({ devices: [{ deviceId: 'only', label: 'Only' }] });
    const single = new CameraController();
    await single.start();
    expect(single.getState().canSwitch).toBe(false);
  });

  it('switchCamera stops the current stream BEFORE requesting the next device', async () => {
    const c = new CameraController();
    await c.start();
    const first = cam.streams[0];
    let firstStoppedAtSwitch = false;
    cam.getUserMedia.mockImplementationOnce(async () => {
      firstStoppedAtSwitch = first.allStopped;
      const s = new FakeStream([new FakeTrack('video', { deviceId: 'back' })]);
      cam.streams.push(s);
      return s.asMediaStream();
    });
    await c.switchCamera();
    expect(firstStoppedAtSwitch).toBe(true);
    expect(c.getState().status).toBe('granted');
  });

  it('requests a different deviceId than the one in use', async () => {
    const c = new CameraController();
    await c.start();
    await c.switchCamera();
    const lastCall = cam.getUserMedia.mock.calls.at(-1)![0] as MediaStreamConstraints;
    expect((lastCall.video as MediaTrackConstraints).deviceId).toEqual({ exact: 'back' });
  });

  it('a failed switch leaves no stream running and reports the error', async () => {
    const c = new CameraController();
    await c.start();
    const first = cam.streams[0];
    cam.failNext(domError('NotReadableError'));
    await c.switchCamera();
    expect(first.allStopped).toBe(true);
    expect(c.getState()).toMatchObject({ status: 'error', stream: null });
  });

  it('is a no-op with a single camera', async () => {
    cam.uninstall();
    cam = installFakeCamera({ devices: [{ deviceId: 'only', label: 'Only' }] });
    const c = new CameraController();
    await c.start();
    await c.switchCamera();
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.streams[0].allStopped).toBe(false);
  });
});

describe('CameraController: facing', () => {
  it('reads facingMode from the track settings, otherwise unknown', async () => {
    cam.uninstall();
    cam = installFakeCamera({ facingMode: 'environment' });
    const a = new CameraController();
    await a.start();
    expect(a.getState().facing).toBe('environment');

    cam.uninstall();
    cam = installFakeCamera();
    const b = new CameraController();
    await b.start();
    expect(b.getState().facing).toBe('unknown');
  });
});
