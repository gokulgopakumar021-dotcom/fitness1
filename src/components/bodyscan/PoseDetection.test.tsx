import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyScanFlow } from './BodyScanFlow';
import { DEFAULT_PROFILE } from '../../storage/db';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import { getStorageSummary, listScans } from '../../storage/bodyScanStore';
import { installFakeCamera, type FakeCamera } from '../../services/fakeMedia.testutil';
import { PoseEngineError } from '../../services/poseLandmarker';
import { adapted, createFakePoseEngine, defer, type FakeEngine } from '../../services/fakePose.testutil';
import type { PoseAdaptResult } from '../../utils/poseResultAdapter';
import { makeFrontPose, makeSidePose } from '../../utils/syntheticPose.testutil';
import type { UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Every landmark below is SYNTHETIC test data. None of it is output from a real model or a real person.

let container: HTMLDivElement;
let root: Root;
let cam: FakeCamera;
let engine: FakeEngine;
let createEngine: ReturnType<typeof vi.fn<() => FakeEngine>>;
let blobCounter = 0;

const render = async (profile: UserProfile) => {
  await act(async () => {
    root.render(<BodyScanFlow profile={profile} onClose={() => {}} createEngine={createEngine} />);
  });
};
const click = async (el: Element | undefined) => {
  if (!el) throw new Error('element not found');
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const byText = (tag: string, text: string) =>
  Array.from(container.querySelectorAll(tag)).find((e) => e.textContent?.includes(text)) as HTMLElement | undefined;
const flush = () =>
  act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
const result = (view: 'front' | 'side') => container.querySelector<HTMLElement>(`[data-testid="pose-result-${view}"]`);

const giveConsent = async (age = 30) => {
  await render({ ...DEFAULT_PROFILE, age });
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await click(boxes[0]);
  await click(boxes[1]);
  await click(byText('button', 'Continue'));
};

/** Takes a photo for `view` through the real camera UI (with fake media) and accepts it. */
const takeAndAccept = async (view: 'front' | 'side', verb: 'Take' | 'Retake' = 'Take') => {
  await click(byText('button', `${verb} ${view} photo`));
  await click(byText('button', 'Turn on camera'));
  await flush();
  const v = container.querySelector('video')!;
  Object.defineProperty(v, 'videoWidth', { configurable: true, value: 720 });
  Object.defineProperty(v, 'videoHeight', { configurable: true, value: 1280 });
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
  await act(async () => {
    v.dispatchEvent(new Event('loadeddata'));
  });
  await click(byText('button', 'Take photo'));
  await flush();
  await click(byText('button', 'Use this photo'));
  await flush();
};

const ok = (lm = makeFrontPose()): PoseAdaptResult => adapted(lm);

beforeEach(() => {
  cam = installFakeCamera();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
  );
  // A different blob per capture, so tests can tell which photo was analysed.
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(new Blob([`jpeg-${++blobCounter}`], { type: 'image/jpeg' }));
  });
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:fake');
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  localStorage.clear();
  blobCounter = 0;
  engine = createFakePoseEngine();
  createEngine = vi.fn(() => engine);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cam.uninstall();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

describe('pose detection is lazy and respects the consent and 18+ gates', () => {
  it('creates no engine (and loads no model) before a photo has been accepted', async () => {
    await render({ ...DEFAULT_PROFILE, age: 30 }); // consent screen
    expect(createEngine).not.toHaveBeenCalled();
    await giveConsent();
    expect(createEngine).not.toHaveBeenCalled(); // privacy controls + photo list
    await click(byText('button', 'Take front photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    expect(createEngine).not.toHaveBeenCalled(); // live camera preview, photo not yet accepted
  });

  it('never creates an engine for an under-18 profile, even though the flow component mounts', async () => {
    await render({ ...DEFAULT_PROFILE, age: 16 });
    expect(container.textContent).toContain('Body Scan is for adults');
    expect(createEngine).not.toHaveBeenCalled();
    expect(byText('button', 'Take front photo')).toBeUndefined();
  });

  it('never creates an engine before consent, and the consent form is unchanged', async () => {
    await render({ ...DEFAULT_PROFILE, age: 30 });
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect((container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]).checked).toBe(false); // photo storage still opt-in
    expect((byText('button', 'Continue') as HTMLButtonElement).disabled).toBe(true);
    expect(createEngine).not.toHaveBeenCalled();
  });
});

describe('successful detection', () => {
  it('analyses the ACCEPTED photo on this device, and shows a result that does not overclaim', async () => {
    engine = createFakePoseEngine([ok()]);
    await giveConsent();
    await takeAndAccept('front');

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.detect).toHaveBeenCalledTimes(1);
    const analysed = engine.detect.mock.calls[0][0] as Blob;
    expect(analysed).toBeInstanceOf(Blob);
    expect(await analysed.text()).toBe('jpeg-1');

    const panel = result('front')!;
    expect(panel.dataset.status).toBe('usable');
    expect(panel.textContent).toContain('Body pose detected');
    expect(panel.textContent).toContain('9 of 9 required body points');
    // The three checks nobody ran are named, not shown as passes.
    expect(panel.textContent).toContain('Not checked in this version: lighting, sharpness, holding still');
    expect(panel.textContent).toContain('does not measure or assess your body');
    // No scan / measurement / health claims.
    expect(container.textContent).not.toMatch(/scan (is )?complete|body fat|muscle mass|\bkg\b|circumference|score|posture is|analysis complete/i);
  });

  it('shows loading, then detecting, then the result', async () => {
    const load = defer<void>();
    const detect = defer<PoseAdaptResult>();
    engine.load.mockImplementationOnce(() => load.promise);
    engine.detect.mockImplementationOnce(() => detect.promise);
    await giveConsent();
    await takeAndAccept('front');
    expect(container.textContent).toContain('Preparing on-device pose detection');
    expect(container.textContent).toContain('The photo is not uploaded');
    await act(async () => load.resolve());
    expect(container.textContent).toContain('Looking for body landmarks in your front photo on this device');
    await act(async () => detect.resolve(ok()));
    expect(result('front')?.dataset.status).toBe('usable');
    expect(container.textContent).not.toContain('Looking for body landmarks');
  });
});

describe('failed, partial and malformed outcomes', () => {
  it('no landmarks detected -> failed panel with advice and a prominent retake', async () => {
    engine = createFakePoseEngine([{ ok: false, reason: 'no_pose' }]);
    await giveConsent();
    await takeAndAccept('front');
    const panel = result('front')!;
    expect(panel.dataset.status).toBe('failed');
    expect(panel.textContent).toContain('No body was detected in this photo');
    expect(panel.textContent).toMatch(/retake the photo/i);
    expect(byText('button', 'Retake front photo')).toBeTruthy();
    expect(byText('button', 'Retake front photo')!.className).toContain('bg-lime-400'); // primary: this is the next step
  });

  it('partial pose (legs out of frame) -> partial panel naming the problem, retake offered', async () => {
    const cutOff = makeFrontPose({ leftAnkle: { y: 1.05, visibility: 0.2 }, rightAnkle: { y: 1.05, visibility: 0.2 } });
    engine = createFakePoseEngine([ok(cutOff)]);
    await giveConsent();
    await takeAndAccept('front');
    const panel = result('front')!;
    expect(panel.dataset.status).toBe('partial');
    expect(panel.textContent).toContain('Body pose only partly detected');
    expect(panel.textContent).toContain('7 of 9 required body points');
    expect(panel.textContent).toMatch(/Not clearly visible: .*ankle/i);
    expect(byText('button', 'Retake front photo')!.className).toContain('bg-lime-400');
  });

  it('low-confidence landmarks everywhere -> failed, not accepted just because the model returned an array', async () => {
    const lowEverywhere = makeFrontPose({}, 0.1);
    engine = createFakePoseEngine([ok(lowEverywhere)]);
    await giveConsent();
    await takeAndAccept('front');
    expect(result('front')!.dataset.status).toBe('failed');
    expect(result('front')!.textContent).toContain('Not enough of your body could be located');
  });

  it('malformed inference result -> failed with an in-place retry that reuses the photo', async () => {
    engine = createFakePoseEngine([{ ok: false, reason: 'malformed' }, ok()]);
    await giveConsent();
    await takeAndAccept('front');
    expect(result('front')!.textContent).toContain('The pose result could not be read');
    const getUserMediaCalls = cam.getUserMedia.mock.calls.length;
    await click(byText('button', 'Try front analysis again'));
    await flush();
    expect(result('front')!.dataset.status).toBe('usable');
    expect(cam.getUserMedia.mock.calls.length).toBe(getUserMediaCalls); // no new camera permission request
  });
});

describe('model / engine errors and retry without the camera', () => {
  const failWith = (code: ConstructorParameters<typeof PoseEngineError>[0]) =>
    engine.load.mockRejectedValueOnce(new PoseEngineError(code, 'x'));

  it('model not deployed -> clear message and Try again; retry re-runs on the SAME photo and does not ask for the camera', async () => {
    failWith('model_missing');
    engine.detect.mockResolvedValueOnce(ok());
    await giveConsent();
    await takeAndAccept('front');

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('pose model file is not available');
    expect(alert?.textContent).toContain('Your photo is still here');
    expect(container.querySelector('img[alt^="Temporary front photo"]')).toBeTruthy(); // photo kept
    expect(engine.detect).not.toHaveBeenCalled();
    const getUserMediaCalls = cam.getUserMedia.mock.calls.length;

    await click(byText('button', 'Try front analysis again'));
    await flush();
    expect(engine.load).toHaveBeenCalledTimes(2);
    expect(engine.detect).toHaveBeenCalledTimes(1);
    expect(result('front')!.dataset.status).toBe('usable');
    expect(cam.getUserMedia.mock.calls.length).toBe(getUserMediaCalls);
    expect(container.textContent).not.toContain('Turn on camera');
  });

  it('download / runtime / init failures each show a retryable error', async () => {
    for (const code of ['model_download_failed', 'runtime_load_failed', 'init_failed', 'model_invalid'] as const) {
      await act(async () => root.unmount());
      root = createRoot(container);
      localStorage.clear(); // consent is persisted: start every iteration at the consent screen
      engine = createFakePoseEngine();
      createEngine.mockImplementation(() => engine);
      failWith(code);
      await giveConsent();
      await takeAndAccept('front');
      expect(container.querySelector('[role="alert"]'), code).toBeTruthy();
      expect(byText('button', 'Try front analysis again'), code).toBeTruthy();
    }
  });

  it('unsupported browser -> says so and does not offer a pointless retry; the rest of the app is unaffected', async () => {
    failWith('unsupported');
    await giveConsent();
    await takeAndAccept('front');
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('cannot run pose detection');
    expect(byText('button', 'Try front analysis again')).toBeUndefined();
    expect(byText('button', 'Retake front photo')).toBeTruthy();
    expect(byText('button', 'Back to Body Metrics')).toBeTruthy();
  });

  it('inference failure -> retryable error', async () => {
    engine.detect.mockRejectedValueOnce(new PoseEngineError('inference_failed', 'x')).mockResolvedValueOnce(ok());
    await giveConsent();
    await takeAndAccept('front');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('hit an error');
    await click(byText('button', 'Try front analysis again'));
    await flush();
    expect(result('front')!.dataset.status).toBe('usable');
  });

  it('an unexpected non-engine exception is treated as an inference failure, not a crash', async () => {
    engine.detect.mockRejectedValueOnce(new Error('SECRET internals'));
    await giveConsent();
    await takeAndAccept('front');
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('hit an error');
    expect(alert.textContent).not.toContain('SECRET');
  });
});

describe('retake', () => {
  it('retaking runs a fresh analysis on the NEW photo and replaces the old result', async () => {
    engine = createFakePoseEngine([{ ok: false, reason: 'no_pose' }, ok()]);
    await giveConsent();
    await takeAndAccept('front');
    expect(result('front')!.dataset.status).toBe('failed');

    await takeAndAccept('front', 'Retake');
    expect(engine.detect).toHaveBeenCalledTimes(2);
    expect(await (engine.detect.mock.calls[0][0] as Blob).text()).toBe('jpeg-1');
    expect(await (engine.detect.mock.calls[1][0] as Blob).text()).toBe('jpeg-2');
    expect(result('front')!.dataset.status).toBe('usable');
    expect(createEngine).toHaveBeenCalledTimes(1); // the engine is reused, not rebuilt
  });

  it('a slow result for the OLD photo can never overwrite the new one (rapid retake)', async () => {
    const first = defer<PoseAdaptResult>();
    engine.detect.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(ok());
    await giveConsent();
    await takeAndAccept('front'); // run 1 is now stuck in detect()
    const firstSignal = engine.detect.mock.calls[0][1] as AbortSignal;
    await takeAndAccept('front', 'Retake'); // run 2 finishes straight away
    expect(firstSignal.aborted).toBe(true); // run 1 was cancelled when the photo was replaced
    expect(result('front')!.dataset.status).toBe('usable');

    await act(async () => first.resolve({ ok: false, reason: 'no_pose' })); // run 1 finally answers
    expect(result('front')!.dataset.status).toBe('usable'); // unchanged
  });
});

describe('front and side stay separate', () => {
  it('analyses each view on its own photo and keeps separate results', async () => {
    engine = createFakePoseEngine([ok(makeFrontPose()), { ok: false, reason: 'no_pose' }]);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');

    expect(engine.detect).toHaveBeenCalledTimes(2);
    expect(await (engine.detect.mock.calls[0][0] as Blob).text()).toBe('jpeg-1'); // front photo
    expect(await (engine.detect.mock.calls[1][0] as Blob).text()).toBe('jpeg-2'); // side photo
    expect(result('front')!.dataset.status).toBe('usable');
    expect(result('side')!.dataset.status).toBe('failed');
    expect(result('front')!.closest('li')!.textContent).toContain('Front photo');
    expect(result('side')!.closest('li')!.textContent).toContain('Side photo');
    expect(result('side')!.closest('li')!.textContent).not.toContain('Body pose detected'); // front's result did not leak in
    expect(createEngine).toHaveBeenCalledTimes(1); // one shared engine, two independent analyses
  });

  it('judges a side photo against the side rule (one complete side chain), not the front rule', async () => {
    engine = createFakePoseEngine([ok(makeFrontPose()), ok(makeSidePose())]);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(result('front')!.textContent).toContain('9 of 9 required');
    expect(result('side')!.dataset.status).toBe('usable');
    expect(result('side')!.textContent).toContain('5 of 5 required');
  });

  it('retaking one view does not disturb, re-run or cancel the other', async () => {
    engine = createFakePoseEngine([ok(makeFrontPose()), { ok: false, reason: 'no_pose' }, ok(makeSidePose())]);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(result('side')!.dataset.status).toBe('failed');
    const frontBefore = result('front')!.textContent;

    await takeAndAccept('side', 'Retake');
    expect(engine.detect).toHaveBeenCalledTimes(3);
    expect(result('side')!.dataset.status).toBe('usable');
    expect(result('front')!.dataset.status).toBe('usable');
    expect(result('front')!.textContent).toBe(frontBefore);
  });

  it('a failing view can be retried independently', async () => {
    engine = createFakePoseEngine([ok(makeFrontPose())]);
    engine.detect.mockResolvedValueOnce(ok(makeFrontPose())).mockRejectedValueOnce(new PoseEngineError('inference_failed', 'x')).mockResolvedValueOnce(ok(makeSidePose()));
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(result('front')!.dataset.status).toBe('usable');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    await click(byText('button', 'Try side analysis again'));
    await flush();
    expect(result('side')!.dataset.status).toBe('usable');
    expect(engine.detect).toHaveBeenCalledTimes(3);
  });
});

describe('cleanup, cancellation and disposal', () => {
  it('leaving Body Scan while analysing cancels the run, disposes the engine and updates no state afterwards', async () => {
    const pending = defer<PoseAdaptResult>();
    engine.detect.mockImplementationOnce(() => pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await giveConsent();
    await takeAndAccept('front');
    const signal = engine.detect.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    expect(engine.dispose).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(ok())); // answer arrives after unmount
    await flush();
    expect(errors).not.toHaveBeenCalled(); // no "state update on unmounted component" or act warnings
    root = createRoot(container);
  });

  it('leaving during model loading cancels the load and disposes the engine', async () => {
    const gate = defer<void>();
    engine.load.mockImplementationOnce(() => gate.promise);
    await giveConsent();
    await takeAndAccept('front');
    const signal = engine.load.mock.calls[0][0] as AbortSignal;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    expect(engine.detect).not.toHaveBeenCalled(); // never starts inference after leaving
    root = createRoot(container);
  });

  it('"Discard these photos" cancels analysis in flight and forgets the results', async () => {
    const pending = defer<PoseAdaptResult>();
    engine.detect.mockImplementationOnce(() => pending.promise);
    await giveConsent();
    await takeAndAccept('front');
    const signal = engine.detect.mock.calls[0][1] as AbortSignal;
    await click(byText('button', 'Discard these photos'));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(ok()));
    expect(result('front')).toBeNull();
    expect(container.textContent).toContain('Not taken');
    expect(container.textContent).not.toContain('Body pose detected');
  });

  it('the camera is released before analysis even starts, and analysis never reopens it', async () => {
    const pending = defer<PoseAdaptResult>();
    engine.detect.mockImplementationOnce(() => pending.promise);
    await giveConsent();
    await takeAndAccept('front');
    expect(cam.streams.every((s) => s.allStopped)).toBe(true);
    await act(async () => pending.resolve(ok()));
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.streams.every((s) => s.allStopped)).toBe(true);
  });

  for (const label of ['Delete all scan history', 'Delete all saved photos', 'Withdraw consent and delete all Body Scan data']) {
    it(`"${label}" drops the detection results and disposes the engine along with the photos`, async () => {
      engine = createFakePoseEngine([ok()]);
      await giveConsent();
      await takeAndAccept('front');
      expect(result('front')).toBeTruthy();
      await click(byText('button', label));
      await click(byText('button', 'Yes, delete'));
      await flush();
      expect(result('front')).toBeNull();
      expect(container.querySelector('img[alt^="Temporary"]')).toBeNull();
      expect(engine.dispose).toHaveBeenCalled();
    });
  }

  it('cancelling a deletion confirmation keeps the photo and its result', async () => {
    engine = createFakePoseEngine([ok()]);
    await giveConsent();
    await takeAndAccept('front');
    await click(byText('button', 'Delete all scan history'));
    await click(byText('button', 'Cancel'));
    expect(result('front')).toBeTruthy();
    expect(engine.dispose).not.toHaveBeenCalled();
  });
});

describe('no persistence and no network', () => {
  it('detection writes nothing to localStorage, IndexedDB or the network, even with photo storage consented', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    try {
      engine = createFakePoseEngine([ok(makeFrontPose()), ok(makeSidePose())]);
      await render({ ...DEFAULT_PROFILE, age: 30 });
      const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      await click(boxes[0]);
      await click(boxes[1]);
      await click(boxes[2]); // opt in to photo storage
      await click(byText('button', 'Continue'));
      expect(getBodyScanConsent()).toMatchObject({ photoStorage: true });
      const keysBefore = Object.keys(localStorage).sort();

      await takeAndAccept('front');
      await takeAndAccept('side');
      expect(result('front')!.dataset.status).toBe('usable');
      expect(result('side')!.dataset.status).toBe('usable');

      expect(Object.keys(localStorage).sort()).toEqual(keysBefore);
      expect(JSON.stringify({ ...localStorage })).not.toMatch(/landmark|visibility|jpeg/i);
      expect(await getStorageSummary()).toMatchObject({ scanCount: 0, photoCount: 0, photoBytes: 0 });
      expect(await listScans()).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      delete (navigator as unknown as Record<string, unknown>).sendBeacon;
    }
  });

  it('the page copy says photos and landmarks stay on this device and are not saved or uploaded', async () => {
    await giveConsent();
    expect(container.textContent).toContain('on this device only');
    expect(container.textContent).toContain('not saved or uploaded, even if you allowed photo storage');
    expect(container.textContent).toContain('does not complete a scan');
  });
});

describe('existing behaviour preserved', () => {
  it('a photo is still accepted and shown as temporary when detection fails; nothing blocks the existing flow', async () => {
    engine.load.mockRejectedValueOnce(new PoseEngineError('model_missing', 'x'));
    await giveConsent();
    await takeAndAccept('front');
    expect(container.textContent).toContain('Taken (temporary)');
    expect(byText('button', 'Discard these photos')).toBeTruthy();
  });
});

describe('session summary is advisory and honest about detection results', () => {
  const summary = () => container.querySelector<HTMLElement>('[data-testid="session-summary"]');

  it('does not say the photos are fine when both detections failed, and still lets the person keep or retake them', async () => {
    engine = createFakePoseEngine([{ ok: false, reason: 'no_pose' }, { ok: false, reason: 'no_pose' }]);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(summary()!.dataset.summary).toBe('needs_attention');
    expect(summary()!.textContent).toMatch(/needs another look/i);
    expect(summary()!.textContent).toMatch(/advisory/i);
    expect(summary()!.textContent).not.toMatch(/show a usable pose/i);
    // Advisory, not a gate: the photos are still held and can be retaken or discarded.
    expect(byText('button', 'Retake front photo')).toBeTruthy();
    expect(byText('button', 'Discard these photos')).toBeTruthy();
  });

  it('says both show a usable pose only when both detections were usable', async () => {
    engine = createFakePoseEngine([ok(makeFrontPose()), ok(makeSidePose())]);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(summary()!.dataset.summary).toBe('all_usable');
    expect(summary()!.textContent).toMatch(/nothing is measured, scored or saved/i);
  });

  it('needs attention when one view is usable and the other errored', async () => {
    engine.detect.mockResolvedValueOnce(ok(makeFrontPose())).mockRejectedValueOnce(new PoseEngineError('inference_failed', 'x'));
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(summary()!.dataset.summary).toBe('needs_attention');
  });

  it('says the photos are being checked while an analysis is still running', async () => {
    const slow = defer<PoseAdaptResult>();
    engine.detect.mockResolvedValueOnce(ok(makeFrontPose())).mockImplementationOnce(() => slow.promise);
    await giveConsent();
    await takeAndAccept('front');
    await takeAndAccept('side');
    expect(summary()!.dataset.summary).toBe('analysing');
    await act(async () => slow.resolve(ok(makeSidePose())));
    expect(summary()!.dataset.summary).toBe('all_usable');
  });
});
