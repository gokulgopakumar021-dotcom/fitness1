import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameCaptureError, captureFrame, fitWithin } from './frameCapture';

/** jsdom has no canvas; stub just enough to exercise our logic. */
function stubCanvas(opts: { context?: boolean; blob?: Blob | null } = {}) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => (opts.context === false ? null : { drawImage })) as unknown as HTMLCanvasElement['getContext']
  );
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(opts.blob === undefined ? new Blob(['x'], { type: 'image/jpeg' }) : opts.blob);
    });
  return { drawImage, toBlob };
}

function fakeVideo(width: number, height: number, readyState = 4): HTMLVideoElement {
  const v = document.createElement('video');
  Object.defineProperty(v, 'videoWidth', { value: width });
  Object.defineProperty(v, 'videoHeight', { value: height });
  Object.defineProperty(v, 'readyState', { value: readyState });
  return v;
}

describe('fitWithin', () => {
  it('keeps small frames as they are (never upscales)', () => {
    expect(fitWithin(640, 480, 1920)).toEqual({ width: 640, height: 480 });
  });
  it('scales large frames down preserving aspect ratio', () => {
    expect(fitWithin(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(2160, 3840, 1920)).toEqual({ width: 1080, height: 1920 });
  });
  it('rejects invalid sizes', () => {
    for (const [w, h, m] of [[0, 10, 100], [10, 0, 100], [NaN, 10, 100], [10, 10, 0], [-1, 10, 100]]) {
      expect(fitWithin(w, h, m)).toBeNull();
    }
  });
});

describe('captureFrame', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('draws the frame and returns a JPEG blob with its dimensions and view', async () => {
    const { drawImage } = stubCanvas();
    const video = fakeVideo(1280, 720);
    const photo = await captureFrame(video, 'front');
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(photo).toMatchObject({ view: 'front', mimeType: 'image/jpeg', width: 1280, height: 720 });
    expect(photo.blob).toBeInstanceOf(Blob);
  });

  it('downsizes frames larger than maxDimension', async () => {
    stubCanvas();
    const photo = await captureFrame(fakeVideo(3840, 2160), 'side', { maxDimension: 1000 });
    expect(photo).toMatchObject({ view: 'side', width: 1000, height: 563 });
  });

  it('passes the requested JPEG quality to the encoder', async () => {
    const { toBlob } = stubCanvas();
    await captureFrame(fakeVideo(100, 100), 'front', { quality: 0.5 });
    expect(toBlob.mock.calls[0][1]).toBe('image/jpeg');
    expect(toBlob.mock.calls[0][2]).toBe(0.5);
  });

  it('draws the frame un-mirrored (no horizontal flip transform)', async () => {
    const calls: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      drawImage: vi.fn(),
      scale: () => calls.push('scale'),
      translate: () => calls.push('translate'),
      setTransform: () => calls.push('setTransform'),
    })) as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['x']));
    });
    await captureFrame(fakeVideo(100, 100), 'front');
    expect(calls).toEqual([]);
  });

  it('rejects with not_ready when the video has no frame yet (0x0)', async () => {
    stubCanvas();
    await expect(captureFrame(fakeVideo(0, 0), 'front')).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('rejects with not_ready when the video has no current data', async () => {
    stubCanvas();
    await expect(captureFrame(fakeVideo(640, 480, 1), 'front')).rejects.toBeInstanceOf(FrameCaptureError);
  });

  it('rejects with canvas_unavailable when no 2d context can be created', async () => {
    stubCanvas({ context: false });
    await expect(captureFrame(fakeVideo(640, 480), 'front')).rejects.toMatchObject({ code: 'canvas_unavailable' });
  });

  it('rejects with encode_failed when the encoder returns no blob; never fabricates an image', async () => {
    stubCanvas({ blob: null });
    await expect(captureFrame(fakeVideo(640, 480), 'front')).rejects.toMatchObject({ code: 'encode_failed' });
  });

  it('makes no network requests and writes nothing to browser storage', async () => {
    stubCanvas();
    localStorage.clear();
    sessionStorage.clear();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await captureFrame(fakeVideo(640, 480), 'front');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    vi.unstubAllGlobals();
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  });
});
