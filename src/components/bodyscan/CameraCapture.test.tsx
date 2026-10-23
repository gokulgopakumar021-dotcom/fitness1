import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraCapture } from './CameraCapture';
import type { NewScanPhoto } from '../../types/bodyScan';
import {
  domError,
  installFakeCamera,
  removeMediaDevices,
  type FakeCamera,
} from '../../services/fakeMedia.testutil';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let cam: FakeCamera;
let onCaptured: ReturnType<typeof vi.fn<(p: NewScanPhoto) => void>>;
let onCancel: ReturnType<typeof vi.fn<() => void>>;
let urlCounter = 0;

const flush = () =>
  act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const text = () => container.textContent ?? '';
const video = () => container.querySelector('video') as HTMLVideoElement | null;

const render = async (props: Partial<React.ComponentProps<typeof CameraCapture>> = {}) => {
  await act(async () => {
    root.render(<CameraCapture view="front" onCaptured={onCaptured} onCancel={onCancel} {...props} />);
  });
};

/** Starts the camera the way a user would, and waits for the stream. */
const startCamera = async () => {
  await click(button('Turn on camera'));
  await flush();
};

/** Simulates the <video> element receiving its first frame. */
const makeVideoReady = async (width = 720, height = 1280) => {
  const v = video()!;
  Object.defineProperty(v, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(v, 'videoHeight', { configurable: true, value: height });
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
  await act(async () => {
    v.dispatchEvent(new Event('loadeddata'));
  });
};

const stubCanvas = (opts: { context?: boolean } = {}) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => (opts.context === false ? null : { drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
  );
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
};

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  cam = installFakeCamera();
  onCaptured = vi.fn();
  onCancel = vi.fn();
  urlCounter = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => `blob:fake-${++urlCounter}`);
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cam.uninstall();
  vi.useRealTimers();
  setVisibility('visible');
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

describe('CameraCapture: before the camera is started', () => {
  it('does not touch the camera on mount; shows guidance, consent-style explanation and an explicit start button', async () => {
    await render();
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    expect(video()).toBeNull();
    expect(button('Turn on camera')).toBeTruthy();
    expect(text()).toContain('browser will ask for permission');
    expect(text()).toContain('How to take your front photo');
    expect(text()).toContain('2 to 3 metres');
  });

  it('shows side-view guidance for the side view', async () => {
    await render({ view: 'side' });
    expect(text()).toContain('How to take your side photo');
    expect(text()).toContain('Turn 90 degrees');
  });

  it('warns up front (without prompting) when the browser is already blocking the camera', async () => {
    cam.uninstall();
    cam = installFakeCamera({ permissionState: 'denied' });
    await render();
    await flush();
    expect(text()).toContain('currently blocking camera access');
    expect(cam.getUserMedia).not.toHaveBeenCalled();
  });

  it('states honestly that automatic quality checks are not running', async () => {
    await render();
    expect(container.querySelector('[data-testid="quality-not-running"]')).toBeTruthy();
    expect(text()).toContain('not running');
    expect(text()).not.toMatch(/Looks OK|No problems were found/);
  });

  it('asks for the camera only after the click, and for video only', async () => {
    await render();
    await click(button('Turn on camera'));
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
  });
});

describe('CameraCapture: permission and error states', () => {
  it('shows a waiting state while the permission prompt is open', async () => {
    cam.deferNext();
    await render();
    await click(button('Turn on camera'));
    expect(text()).toContain('Waiting for camera permission');
    expect(video()).toBeNull();
  });

  it('shows a clear alert when permission is denied, offers retry, and recovers when allowed', async () => {
    cam.failNext(domError('NotAllowedError'));
    await render();
    await startCamera();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Camera access was blocked');
    expect(alert?.textContent).toContain('allow camera access');
    expect(video()).toBeNull();
    expect(button('Try again')).toBeTruthy();

    await click(button('Try again'));
    await flush();
    expect(video()).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains when no camera exists and points to manual entry', async () => {
    cam.failNext(domError('NotFoundError'));
    await render();
    await startCamera();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No camera found');
    expect(text()).toContain('add measurements by hand');
  });

  it('explains an unsupported browser and does not offer a pointless retry', async () => {
    const restore = removeMediaDevices();
    await render();
    await click(button('Turn on camera'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not supported');
    expect(button('Try again')).toBeUndefined();
    expect(button('Back')).toBeTruthy();
    restore();
  });

  it('shows an error when the camera is busy, with retry', async () => {
    cam.failNext(domError('NotReadableError'));
    await render();
    await startCamera();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Camera could not be started');
    expect(button('Try again')).toBeTruthy();
  });

  it('reports revocation while the camera is on: stream stopped and a specific message shown', async () => {
    await render();
    await startCamera();
    await makeVideoReady();
    cam.permission.state = 'denied';
    await act(async () => {
      cam.streams[0].tracks[0].emitEnded();
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Camera access was turned off');
    expect(cam.streams[0].allStopped).toBe(true);
    expect(video()).toBeNull();
  });

  it('reports an unplugged camera as a stop, not as a permission problem', async () => {
    await render();
    await startCamera();
    cam.permission.state = 'granted';
    await act(async () => {
      cam.streams[0].tracks[0].emitEnded();
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Camera stopped unexpectedly');
  });
});

describe('CameraCapture: live preview and controls', () => {
  it('shows the preview, a camera-on indicator and an alignment guide that does not claim detection', async () => {
    await render();
    await startCamera();
    const v = video()!;
    expect(v).not.toBeNull();
    expect(v.muted).toBe(true);
    expect(v.getAttribute('playsinline')).not.toBeNull();
    expect((v as unknown as { srcObject: unknown }).srcObject).toBe(cam.streams[0]);
    expect(text()).toContain('Camera on');
    expect(text()).toContain('No body detection is running');
  });

  it('keeps the shutter disabled until the video has a frame', async () => {
    await render();
    await startCamera();
    expect(button('Take photo')!.disabled).toBe(true);
    await makeVideoReady();
    expect(button('Take photo')!.disabled).toBe(false);
  });

  it('never takes a photo by itself', async () => {
    const toBlob = stubCanvas();
    await render();
    await startCamera();
    await makeVideoReady();
    await flush();
    expect(toBlob).not.toHaveBeenCalled();
    expect(onCaptured).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
  });

  it('mirrors the preview for selfie/unknown cameras but not for a rear camera', async () => {
    await render();
    await startCamera();
    expect(video()!.className).toContain('-scale-x-100');

    await act(async () => root.unmount());
    cam.uninstall();
    cam = installFakeCamera({ facingMode: 'environment' });
    root = createRoot(container);
    await render();
    await startCamera();
    expect(video()!.className).not.toContain('-scale-x-100');
  });

  it('shows Switch camera only when more than one camera exists', async () => {
    await render();
    await startCamera();
    expect(button('Switch camera')).toBeUndefined();

    await act(async () => root.unmount());
    cam.uninstall();
    cam = installFakeCamera({ devices: [{ deviceId: 'a', label: 'A' }, { deviceId: 'b', label: 'B' }] });
    root = createRoot(container);
    await render();
    await startCamera();
    expect(button('Switch camera')).toBeTruthy();
  });

  it('switching cameras releases the old stream and shows the new one', async () => {
    cam.uninstall();
    cam = installFakeCamera({ devices: [{ deviceId: 'a', label: 'A' }, { deviceId: 'b', label: 'B' }] });
    await render();
    await startCamera();
    await click(button('Switch camera'));
    await flush();
    expect(cam.streams).toHaveLength(2);
    expect(cam.streams[0].allStopped).toBe(true);
    expect(cam.streams[1].allStopped).toBe(false);
    expect(video()).not.toBeNull();
  });

  it('the timer and shutter controls are native, labelled, keyboard-reachable elements', async () => {
    await render();
    await startCamera();
    const select = container.querySelector('select#capture-timer') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(container.querySelector('label[for="capture-timer"]')).toBeTruthy();
    expect(button('Take photo')!.tagName).toBe('BUTTON');
    expect(container.querySelector('video')!.getAttribute('aria-label')).toBe('Live camera preview');
  });
});

describe('CameraCapture: releasing the camera', () => {
  it('Cancel stops every track and calls onCancel', async () => {
    await render();
    await startCamera();
    await click(container.querySelector('button[aria-label^="Cancel"]'));
    expect(cam.streams[0].allStopped).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels and releases the camera', async () => {
    await render();
    await startCamera();
    await act(async () => {
      container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(cam.streams[0].allStopped).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('unmounting while the camera is live releases it', async () => {
    await render();
    await startCamera();
    expect(cam.streams[0].allStopped).toBe(false);
    await act(async () => root.unmount());
    expect(cam.streams[0].allStopped).toBe(true);
    root = createRoot(container); // keep afterEach symmetrical
  });

  it('unmounting while the permission prompt is open releases a stream that arrives later', async () => {
    const pending = cam.deferNext();
    await render();
    await click(button('Turn on camera'));
    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(cam.streams).toHaveLength(1);
    expect(cam.streams[0].allStopped).toBe(true);
    root = createRoot(container);
  });

  it('hiding the tab switches the camera off and says why; it does not restart by itself', async () => {
    await render();
    await startCamera();
    await act(async () => setVisibility('hidden'));
    expect(cam.streams[0].allStopped).toBe(true);
    expect(video()).toBeNull();
    await act(async () => setVisibility('visible'));
    expect(text()).toContain('switched off because you left this tab');
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1); // no silent restart
    expect(button('Turn on camera')).toBeTruthy();
  });

  it('hiding the tab while the prompt is open cancels it and releases a late stream', async () => {
    const pending = cam.deferNext();
    await render();
    await click(button('Turn on camera'));
    await act(async () => setVisibility('hidden'));
    await act(async () => {
      pending.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(cam.streams[0].allStopped).toBe(true);
  });

  it('hiding the tab when the camera was never started does nothing', async () => {
    await render();
    await act(async () => setVisibility('hidden'));
    expect(text()).not.toContain('switched off because you left');
  });
});

describe('CameraCapture: capture, review and retake', () => {
  it('captures a frame, switches the camera off, and shows it for review before anything is accepted', async () => {
    stubCanvas();
    await render();
    await startCamera();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toMatch(/^blob:fake-/);
    expect(cam.streams[0].allStopped).toBe(true); // camera off after the shot
    expect(video()).toBeNull();
    expect(onCaptured).not.toHaveBeenCalled(); // not accepted yet
    expect(text()).toContain('not saved or uploaded');
  });

  it('"Use this photo" hands over the in-memory photo with its view and size', async () => {
    stubCanvas();
    await render({ view: 'side' });
    await startCamera();
    await makeVideoReady(720, 1280);
    await click(button('Take photo'));
    await flush();
    await click(button('Use this photo'));
    expect(onCaptured).toHaveBeenCalledTimes(1);
    const photo = onCaptured.mock.calls[0][0];
    expect(photo).toMatchObject({ view: 'side', mimeType: 'image/jpeg', width: 720, height: 1280 });
    expect(photo.blob).toBeInstanceOf(Blob);
  });

  it('Retake discards the photo, revokes its preview URL and starts a fresh stream', async () => {
    stubCanvas();
    await render();
    await startCamera();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();
    expect(container.querySelector('img')).toBeTruthy();

    await click(button('Retake'));
    await flush();
    expect(container.querySelector('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    expect(cam.streams).toHaveLength(2);
    expect(cam.streams[1].allStopped).toBe(false);
    expect(video()).not.toBeNull();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('revokes the preview URL when leaving the screen', async () => {
    stubCanvas();
    await render();
    await startCamera();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();
    await act(async () => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    root = createRoot(container);
  });

  it('shows an error and stays live when the frame cannot be captured; no fake photo appears', async () => {
    stubCanvas({ context: false });
    await render();
    await startCamera();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not prepare the photo');
    expect(container.querySelector('img')).toBeNull();
    expect(video()).not.toBeNull();
    expect(cam.streams[0].allStopped).toBe(false);
  });
});

describe('CameraCapture: self-timer', () => {
  const setupTimer = async (seconds: string) => {
    vi.useFakeTimers();
    stubCanvas();
    await render();
    await click(button('Turn on camera'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await makeVideoReady();
    const select = container.querySelector('select#capture-timer') as HTMLSelectElement;
    await act(async () => {
      select.value = seconds;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('counts down, then takes the photo', async () => {
    await setupTimer('3');
    await click(button('Start 3s timer'));
    expect(container.querySelector('[data-testid="countdown"]')?.textContent).toBe('3');
    await tick(1000);
    expect(container.querySelector('[data-testid="countdown"]')?.textContent).toBe('2');
    expect(container.querySelector('img')).toBeNull();
    // One second per act(): React only re-renders (and schedules the next timeout) when an act scope exits.
    await tick(1000);
    await tick(1000); // countdown reaches 0 and the capture starts
    await tick(0); //    let the async capture settle
    expect(container.querySelector('img')).toBeTruthy();
    expect(cam.streams[0].allStopped).toBe(true);
  });

  it('pressing the button again cancels the countdown and no photo is taken', async () => {
    await setupTimer('3');
    await click(button('Start 3s timer'));
    await click(button('Cancel timer'));
    expect(container.querySelector('[data-testid="countdown"]')).toBeNull();
    await tick(5000);
    expect(container.querySelector('img')).toBeNull();
    expect(video()).not.toBeNull();
  });

  it('leaving the screen mid-countdown releases the camera and never takes the photo', async () => {
    await setupTimer('5');
    await click(button('Start 5s timer'));
    await tick(1000);
    const toBlob = HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>;
    await act(async () => root.unmount());
    await tick(10000);
    expect(cam.streams[0].allStopped).toBe(true);
    expect(toBlob).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('the camera stopping mid-countdown cancels the countdown', async () => {
    await setupTimer('5');
    await click(button('Start 5s timer'));
    await act(async () => setVisibility('hidden'));
    expect(container.querySelector('[data-testid="countdown"]')).toBeNull();
    await tick(10000);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('CameraCapture: privacy', () => {
  it('capture, retake and accept make no network requests and write nothing to browser storage', async () => {
    stubCanvas();
    localStorage.clear();
    sessionStorage.clear();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const idbOpen = vi.spyOn(indexedDB ?? ({} as IDBFactory), 'open').mockImplementation(() => {
      throw new Error('IndexedDB must not be used in Phase 2B');
    });

    await render();
    await startCamera();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();
    await click(button('Retake'));
    await flush();
    await makeVideoReady();
    await click(button('Take photo'));
    await flush();
    await click(button('Use this photo'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    vi.unstubAllGlobals();
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  });
});

describe('CameraCapture: hardening', () => {
  it('a second press while a photo is still being encoded does not start a second capture', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
    );
    const pending: BlobCallback[] = [];
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        pending.push(cb);
      });
    await render();
    await startCamera();
    await makeVideoReady();
    const shutter = button('Take photo')!;
    await click(shutter);
    expect(shutter.disabled).toBe(true); // cannot be pressed again while encoding
    await act(async () => shutter.click());
    expect(toBlob).toHaveBeenCalledTimes(1);

    await act(async () => pending[0](new Blob(['jpeg'], { type: 'image/jpeg' })));
    await flush();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(cam.streams[0].allStopped).toBe(true);
  });

  it('Escape pressed inside the self-timer dropdown only closes the dropdown; it does not cancel the capture', async () => {
    await render();
    await startCamera();
    const select = container.querySelector('select')!;
    await act(async () => {
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(cam.streams[0].allStopped).toBe(false);
    expect(video()).not.toBeNull();
  });
});
