import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFrontPose } from '../utils/syntheticPose.testutil';
import {
  IDLE_RELEASE_MS,
  MIN_MODEL_BYTES,
  POSE_MODEL_FILE,
  PoseEngineError,
  createPoseEngine,
  defaultModelUrl,
  type PoseEngineDeps,
  type PoseEngineErrorCode,
} from './poseLandmarker';
import {
  defer,
  makeFakeDecode,
  makeFakeLandmarker,
  makeFakeRuntime,
  makeNativeResult,
  modelResponse,
  type FakeLandmarker,
} from './fakePose.testutil';

const BLOB = new Blob(['not-a-real-photo'], { type: 'image/jpeg' });
const MODEL_URL = '/models/test-model.task';

/** Engine wired to fakes. Every dependency is replaceable per test. */
function build(
  opts: { native?: unknown; landmarker?: FakeLandmarker; deps?: Partial<PoseEngineDeps>; fetchModel?: PoseEngineDeps['fetchModel'] } = {}
) {
  // `'native' in opts` (not `??`): undefined / null are legitimate "garbage" outputs the tests want to pass through.
  const landmarker = opts.landmarker ?? makeFakeLandmarker('native' in opts ? opts.native : makeNativeResult(makeFrontPose()));
  const runtime = makeFakeRuntime(landmarker);
  const loadRuntime = vi.fn(async () => runtime);
  const fetchModel = vi.fn(opts.fetchModel ?? (async () => modelResponse(MIN_MODEL_BYTES + 50)));
  const decode = makeFakeDecode();
  const engine = createPoseEngine({
    modelUrl: MODEL_URL,
    loadRuntime,
    fetchModel,
    decodeImage: decode.decodeImage,
    yieldToUi: async () => {},
    ...opts.deps,
  });
  return { engine, landmarker, runtime, loadRuntime, fetchModel, decode };
}

const codeOf = async (p: Promise<unknown>): Promise<PoseEngineErrorCode | 'no error'> => {
  try {
    await p;
    return 'no error';
  } catch (err) {
    if (err instanceof PoseEngineError) return err.code;
    throw err;
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('model location', () => {
  it('serves the model from this app (honouring Vite base) and names the chosen variant', () => {
    expect(defaultModelUrl().endsWith(`models/${POSE_MODEL_FILE}`)).toBe(true);
    expect(POSE_MODEL_FILE).toBe('pose_landmarker_full.task');
    expect(new URL(defaultModelUrl(), location.href).origin).toBe(location.origin);
  });

  it('refuses a model URL on another origin at construction (never a third-party host)', () => {
    expect(() => createPoseEngine({ modelUrl: 'https://cdn.example.com/pose.task' })).toThrow(RangeError);
    expect(() => createPoseEngine({ modelUrl: '//cdn.example.com/pose.task' })).toThrow(RangeError);
    expect(() => createPoseEngine({ modelUrl: '/models/pose.task' })).not.toThrow();
    expect(() => createPoseEngine({ modelUrl: `${location.origin}/models/pose.task` })).not.toThrow();
  });
});

describe('initialization', () => {
  it('is lazy: constructing the engine loads and fetches nothing', () => {
    const { engine, loadRuntime, fetchModel } = build();
    expect(engine.status).toBe('idle');
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(fetchModel).not.toHaveBeenCalled();
  });

  it('loads the runtime, fetches the model with a plain same-origin GET (no body), creates one landmarker', async () => {
    const { engine, runtime, loadRuntime, fetchModel } = build();
    await engine.load();
    expect(engine.status).toBe('ready');
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    const [url, init] = fetchModel.mock.calls[0];
    expect(url).toBe(MODEL_URL);
    expect(init).toMatchObject({ credentials: 'same-origin' });
    expect(init).not.toHaveProperty('body');
    expect(init).not.toHaveProperty('method'); // default GET
    expect(runtime.createLandmarker).toHaveBeenCalledTimes(1);
    const bytes = runtime.createLandmarker.mock.calls[0][0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(MIN_MODEL_BYTES + 50);
  });

  it('shares one attempt between concurrent load() calls and is a no-op once ready', async () => {
    const { engine, loadRuntime, fetchModel, runtime } = build();
    await Promise.all([engine.load(), engine.load(), engine.load()]);
    await engine.load();
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    expect(runtime.createLandmarker).toHaveBeenCalledTimes(1);
  });

  it('reports the loading state while the attempt is in flight', async () => {
    const gate = defer<void>();
    const { engine } = build({ deps: { loadRuntime: async () => (await gate.promise, makeFakeRuntime()) } });
    const p = engine.load();
    expect(engine.status).toBe('loading');
    gate.resolve();
    await p;
    expect(engine.status).toBe('ready');
  });

  it('reports "unsupported" without loading anything when WebAssembly is missing', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const { engine, loadRuntime, fetchModel } = build();
    expect(await codeOf(engine.load())).toBe('unsupported');
    expect(engine.status).toBe('failed');
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(fetchModel).not.toHaveBeenCalled();
  });
});

describe('initialization failures and retry', () => {
  it('runtime failure -> runtime_load_failed, then a retry starts a fresh attempt and succeeds', async () => {
    const good = makeFakeRuntime();
    const loadRuntime = vi.fn().mockRejectedValueOnce(new Error('chunk 404')).mockResolvedValue(good);
    const { engine } = build({ deps: { loadRuntime } });
    expect(await codeOf(engine.load())).toBe('runtime_load_failed');
    expect(engine.status).toBe('failed');
    await engine.load(); // retry
    expect(engine.status).toBe('ready');
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(good.createLandmarker).toHaveBeenCalledTimes(1);
  });

  it('model 404 -> model_missing; once the file exists a retry succeeds', async () => {
    let present = false;
    const { engine } = build({
      fetchModel: async () => (present ? modelResponse(MIN_MODEL_BYTES + 1) : modelResponse(10, { status: 404 })),
    });
    expect(await codeOf(engine.load())).toBe('model_missing');
    present = true;
    await engine.load();
    expect(engine.status).toBe('ready');
  });

  it('other HTTP errors and network failures -> model_download_failed', async () => {
    const a = build({ fetchModel: async () => modelResponse(10, { status: 503 }) });
    expect(await codeOf(a.engine.load())).toBe('model_download_failed');
    const b = build({
      fetchModel: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await codeOf(b.engine.load())).toBe('model_download_failed');
  });

  it('a 200 web page (host rewrites unknown paths to index.html) is "not deployed", not a model', async () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>Iron Log</body></html>'.padEnd(MIN_MODEL_BYTES + 10, ' '));
    const a = build({ fetchModel: async () => modelResponse(html, { contentType: 'text/html; charset=utf-8' }) });
    expect(await codeOf(a.engine.load())).toBe('model_missing');
    const b = build({ fetchModel: async () => modelResponse(html, { contentType: 'application/octet-stream' }) }); // sniffed
    expect(await codeOf(b.engine.load())).toBe('model_missing');
    expect(a.runtime.createLandmarker).not.toHaveBeenCalled();
  });

  it('a body smaller than any plausible model -> model_invalid', async () => {
    const { engine, runtime } = build({ fetchModel: async () => modelResponse(MIN_MODEL_BYTES - 1) });
    expect(await codeOf(engine.load())).toBe('model_invalid');
    expect(runtime.createLandmarker).not.toHaveBeenCalled();
  });

  it('landmarker creation failure -> init_failed, then retry succeeds', async () => {
    const lm = makeFakeLandmarker();
    const runtime = makeFakeRuntime(lm);
    runtime.createLandmarker.mockRejectedValueOnce(new Error('wasm trap')).mockResolvedValue(lm);
    const { engine } = build({ deps: { loadRuntime: async () => runtime } });
    expect(await codeOf(engine.load())).toBe('init_failed');
    await engine.load();
    expect(engine.status).toBe('ready');
  });

  it('error messages are fixed text: underlying error details never leak into them', async () => {
    const { engine } = build({ deps: { loadRuntime: async () => Promise.reject(new Error('SECRET-detail /home/x')) } });
    await expect(engine.load()).rejects.toSatisfy((e: Error) => !/SECRET|home/.test(e.message));
  });
});

describe('inference', () => {
  it('analyses a photo: decodes it, runs the landmarker once on that image, adapts the result, frees everything', async () => {
    const native = makeNativeResult(makeFrontPose());
    const { engine, landmarker, decode } = build({ native });
    const result = await engine.detect(BLOB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.landmarks).toHaveLength(33);
    expect(result.landmarks[0]).toMatchObject({ x: 0.5, y: 0.1, visibility: 0.99 });
    expect(decode.decodeImage).toHaveBeenCalledWith(BLOB);
    expect(landmarker.detect).toHaveBeenCalledTimes(1);
    expect(landmarker.detect.mock.calls[0][0]).toEqual({ fakeImageFor: BLOB }); // the decoded photo, nothing else
    expect(decode.released).toHaveLength(1); // decoded pixels released
    expect(native.close).toHaveBeenCalledTimes(1); // native result released
  });

  it('loads on demand when detect() is the first call', async () => {
    const { engine, loadRuntime } = build();
    await engine.detect(BLOB);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(engine.status).toBe('ready');
  });

  it('reports no_pose when the model found nobody', async () => {
    const { engine } = build({ native: makeNativeResult(null) });
    expect(await engine.detect(BLOB)).toEqual({ ok: false, reason: 'no_pose' });
  });

  it('reports malformed for garbage output instead of passing it on, and still frees the image', async () => {
    for (const garbage of [undefined, null, 42, {}, { landmarks: 'x' }, { landmarks: [[{ x: 1 }]] }]) {
      const { engine, decode } = build({ native: garbage });
      expect(await engine.detect(BLOB)).toEqual({ ok: false, reason: 'malformed' });
      expect(decode.released).toHaveLength(1);
    }
  });

  it('inference throwing -> inference_failed with the image still released; the engine stays usable', async () => {
    const lm = makeFakeLandmarker();
    lm.detect.mockImplementationOnce(() => {
      throw new Error('model exploded with pixels');
    });
    lm.detect.mockImplementation(() => makeNativeResult(makeFrontPose()));
    const { engine, decode } = build({ landmarker: lm });
    const first = engine.detect(BLOB);
    await expect(first).rejects.toMatchObject({ code: 'inference_failed' });
    await expect(first).rejects.toSatisfy((e: Error) => !/pixels/.test(e.message));
    expect(decode.released).toHaveLength(1);
    expect((await engine.detect(BLOB)).ok).toBe(true); // retry works without re-loading
    expect(engine.status).toBe('ready');
  });

  it('undecodable photo -> image_decode_failed', async () => {
    const { engine, landmarker } = build({
      deps: {
        decodeImage: async () => {
          throw new Error('bad jpeg');
        },
      },
    });
    expect(await codeOf(engine.detect(BLOB))).toBe('image_decode_failed');
    expect(landmarker.detect).not.toHaveBeenCalled();
  });

  it('a load failure surfaces its own error and never decodes or runs the model', async () => {
    const { engine, decode, landmarker } = build({ fetchModel: async () => modelResponse(1, { status: 404 }) });
    expect(await codeOf(engine.detect(BLOB))).toBe('model_missing');
    expect(decode.decodeImage).not.toHaveBeenCalled();
    expect(landmarker.detect).not.toHaveBeenCalled();
  });

  it('yields to the browser before running the (synchronous) model', async () => {
    const order: string[] = [];
    const lm = makeFakeLandmarker();
    lm.detect.mockImplementation(() => (order.push('detect'), makeNativeResult(makeFrontPose())));
    const { engine } = build({
      landmarker: lm,
      deps: { yieldToUi: async () => void order.push('yield') },
    });
    await engine.detect(BLOB);
    expect(order).toEqual(['yield', 'detect']);
  });
});

describe('cancellation', () => {
  it('an already-aborted signal rejects immediately without touching the network or model', async () => {
    const { engine, fetchModel, landmarker } = build();
    const c = new AbortController();
    c.abort();
    expect(await codeOf(engine.detect(BLOB, c.signal))).toBe('cancelled');
    expect(await codeOf(engine.load(c.signal))).toBe('cancelled');
    expect(fetchModel).not.toHaveBeenCalled();
    expect(landmarker.detect).not.toHaveBeenCalled();
  });

  it('aborting during decoding cancels, skips the model and still releases the image', async () => {
    const gate = defer<void>();
    const decode = makeFakeDecode();
    const slowDecode = vi.fn(async (b: Blob) => (await gate.promise, decode.decodeImage(b)));
    const { engine, landmarker } = build({ deps: { decodeImage: slowDecode } });
    const c = new AbortController();
    const p = engine.detect(BLOB, c.signal);
    await vi.waitFor(() => expect(slowDecode).toHaveBeenCalled());
    c.abort();
    gate.resolve();
    expect(await codeOf(p)).toBe('cancelled');
    expect(landmarker.detect).not.toHaveBeenCalled();
    expect(decode.released).toHaveLength(1);
  });

  it('a caller that stops waiting does not cancel the shared load another caller needs', async () => {
    const gate = defer<void>();
    const sharedRuntime = makeFakeRuntime();
    const loadRuntime = vi.fn(async () => (await gate.promise, sharedRuntime));
    const { engine } = build({ deps: { loadRuntime } });
    const c = new AbortController();
    const impatient = engine.load(c.signal);
    const patient = engine.load();
    c.abort();
    expect(await codeOf(impatient)).toBe('cancelled');
    gate.resolve();
    await patient;
    expect(engine.status).toBe('ready');
    expect(loadRuntime).toHaveBeenCalledTimes(1); // one shared attempt, not restarted
    expect(sharedRuntime.createLandmarker).toHaveBeenCalledTimes(1); // and it ran to completion
  });
});

describe('disposal', () => {
  it('closes the landmarker, becomes disposed, is idempotent, and rejects further use', async () => {
    const { engine, landmarker } = build();
    await engine.load();
    engine.dispose();
    engine.dispose();
    expect(engine.status).toBe('disposed');
    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(await codeOf(engine.detect(BLOB))).toBe('disposed');
    expect(await codeOf(engine.load())).toBe('disposed');
  });

  it('disposing before anything loaded releases nothing and starts nothing', async () => {
    const { engine, loadRuntime, fetchModel } = build();
    engine.dispose();
    expect(engine.status).toBe('disposed');
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(fetchModel).not.toHaveBeenCalled();
  });

  it('disposing while the runtime loads stops before fetching the model', async () => {
    const gate = defer<void>();
    const { engine, fetchModel } = build({ deps: { loadRuntime: async () => (await gate.promise, makeFakeRuntime()) } });
    const p = engine.load();
    engine.dispose();
    gate.resolve();
    expect(await codeOf(p)).toBe('disposed');
    expect(fetchModel).not.toHaveBeenCalled();
    expect(engine.status).toBe('disposed');
  });

  it('disposing while the model downloads aborts that request', async () => {
    let seenSignal: AbortSignal | undefined;
    const { engine } = build({
      fetchModel: (_url, init) => {
        seenSignal = init.signal as AbortSignal;
        return new Promise((_res, rej) => seenSignal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      },
    });
    const p = engine.load();
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    engine.dispose();
    expect(seenSignal!.aborted).toBe(true);
    expect(await codeOf(p)).toBe('disposed');
  });

  it('a landmarker that finishes creating AFTER dispose is closed immediately, not leaked', async () => {
    const lm = makeFakeLandmarker();
    const gate = defer<void>();
    const runtime = makeFakeRuntime(lm);
    runtime.createLandmarker.mockImplementation(async () => (await gate.promise, lm));
    const { engine } = build({ deps: { loadRuntime: async () => runtime } });
    const p = engine.load();
    await vi.waitFor(() => expect(runtime.createLandmarker).toHaveBeenCalled());
    engine.dispose();
    gate.resolve();
    expect(await codeOf(p)).toBe('disposed');
    expect(lm.close).toHaveBeenCalledTimes(1);
    expect(engine.status).toBe('disposed');
  });

  it('disposing during decoding means the model never runs, and the decoded image is still released', async () => {
    const gate = defer<void>();
    const decode = makeFakeDecode();
    const { engine, landmarker } = build({ deps: { decodeImage: async (b) => (await gate.promise, decode.decodeImage(b)) } });
    await engine.load();
    const p = engine.detect(BLOB);
    await vi.waitFor(() => expect(engine.status).toBe('ready'));
    engine.dispose();
    gate.resolve();
    expect(await codeOf(p)).toBe('disposed');
    expect(landmarker.detect).not.toHaveBeenCalled();
    expect(decode.released).toHaveLength(1);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('a throwing close() does not break disposal', async () => {
    const lm = makeFakeLandmarker();
    lm.close.mockImplementation(() => {
      throw new Error('already closed');
    });
    const { engine } = build({ landmarker: lm });
    await engine.load();
    expect(() => engine.dispose()).not.toThrow();
    expect(engine.status).toBe('disposed');
  });
});

describe('idle release', () => {
  it('releases the landmarker after a quiet period and transparently re-creates it on next use', async () => {
    vi.useFakeTimers();
    const { engine, landmarker, runtime } = build();
    await engine.detect(BLOB);
    expect(engine.status).toBe('ready');
    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS - 1);
    expect(landmarker.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(engine.status).toBe('idle');
    await engine.detect(BLOB);
    expect(runtime.createLandmarker).toHaveBeenCalledTimes(2);
    expect(engine.status).toBe('ready');
  });

  it('does not release while a detection is in flight', async () => {
    vi.useFakeTimers();
    const gate = defer<void>();
    const decode = makeFakeDecode();
    const { engine, landmarker } = build({ deps: { decodeImage: async (b) => (await gate.promise, decode.decodeImage(b)) } });
    await engine.load();
    const p = engine.detect(BLOB);
    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS * 3);
    expect(landmarker.close).not.toHaveBeenCalled();
    gate.resolve();
    await p;
    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS + 1);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('dispose() cancels a pending idle release so close() is not called twice', async () => {
    vi.useFakeTimers();
    const { engine, landmarker } = build();
    await engine.detect(BLOB);
    engine.dispose();
    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS * 2);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });
});

describe('default image decoding', () => {
  const noYield = { yieldToUi: async () => {} };

  it('uses createImageBitmap and closes the bitmap afterwards', async () => {
    const bitmap = { close: vi.fn(), tag: 'bitmap' };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const { engine, landmarker } = build({ deps: { ...noYield, decodeImage: undefined } });
    await engine.detect(BLOB);
    expect(landmarker.detect).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to an <img> when createImageBitmap is unavailable, and revokes the temporary object URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => (created.push('blob:t'), 'blob:t')),
      revokeObjectURL: vi.fn((u: string) => void revoked.push(u)),
    }));
    class FakeImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      private _src = '';
      set src(v: string) {
        this._src = v;
        if (v) queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const { engine, landmarker } = build({ deps: { ...noYield, decodeImage: undefined } });
    await engine.detect(BLOB);
    expect(landmarker.detect.mock.calls[0][0]).toBeInstanceOf(FakeImage);
    expect(created).toEqual(['blob:t']);
    expect(revoked).toEqual(['blob:t']);
  });

  it('maps an <img> decode error to image_decode_failed and still revokes the URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:t'), revokeObjectURL: revoke }));
    class BrokenImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(v: string) {
        if (v) queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);
    const { engine } = build({ deps: { ...noYield, decodeImage: undefined } });
    expect(await codeOf(engine.detect(BLOB))).toBe('image_decode_failed');
    expect(revoke).toHaveBeenCalledWith('blob:t');
  });
});
