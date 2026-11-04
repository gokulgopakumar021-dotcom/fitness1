// @vitest-environment node
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyError } from './security/errors';
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  GEMINI_FALLBACK_MIN_REMAINING_MS,
  GEMINI_TIMEOUT_MS,
  createGenAI,
  resolveFallbackModel
} from './gemini';

const ok = (text = 'hi') =>
  new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  408: 'DEADLINE_EXCEEDED',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  502: 'BAD_GATEWAY',
  503: 'UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED'
};
const PROVIDER_DETAIL = 'PROVIDER-SECRET-DETAIL';

const failure = (status: number) =>
  new Response(JSON.stringify({ error: { code: status, message: PROVIDER_DETAIL, status: STATUS_NAMES[status] ?? 'UNKNOWN' } }), {
    status,
    headers: { 'content-type': 'application/json' }
  });

/** A fetch that never answers but honours the abort signal, like the real one. */
function hangingFetch(calls: { n: number }) {
  return (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      calls.n += 1;
      const sig = init?.signal;
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (sig?.aborted) abort();
      else sig?.addEventListener('abort', abort, { once: true });
    });
}

interface Call {
  model: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
type Step = 'ok' | 'hang' | { status: number; delayMs?: number } | { okText: string };

const sleepOrAbort = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });

/** Mocked fetch that plays `steps` in order (the last one repeats) and records every request. Never touches the network. */
function scripted(steps: Step[], log: Call[], onCall?: (n: number) => void) {
  return (async (url: unknown, init?: RequestInit) => {
    const index = Math.min(log.length, steps.length - 1);
    const step = steps[index];
    log.push({
      model: /\/models\/([^:/]+):/.exec(String(url))?.[1] ?? '?',
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: Object.fromEntries(new Headers(init?.headers).entries())
    });
    onCall?.(log.length);
    if (step === 'hang') return new Promise<Response>((_r, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
    if (step === 'ok') return ok();
    if ('okText' in step) return ok(step.okText);
    if (step.delayMs) await sleepOrAbort(step.delayMs, init?.signal);
    return failure(step.status);
  }) as never;
}

const PRIMARY = 'gemini-3.8-flash';
const FALLBACK = 'gemini-3.6-flash';
const req = { model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] };
const prodReq = {
  model: PRIMARY,
  contents: [{ role: 'user', parts: [{ text: 'PROMPT-SECRET' }] }],
  config: { responseMimeType: 'application/json', systemInstruction: 'be brief', temperature: 0.3 }
};
const fixed = (e: unknown) => classifyError(e, { message: 'fallback' });
const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
const make = (steps: Step[], log: Call[], timeoutMs = 60_000, extra = {}) =>
  createGenAI({ apiKey: 'KEY-SECRET', httpOptions: { fetch: scripted(steps, log) } }, timeoutMs, extra);

beforeEach(() => {
  delete process.env.GEMINI_FALLBACK_MODEL; // a developer's shell must not change test outcomes
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GEMINI_FALLBACK_MODEL;
});

describe('createGenAI: hard per-call Gemini deadline (owner decision: 90 s)', () => {
  it('the production deadline is exactly 90 seconds, below the 120 s function maxDuration', () => {
    expect(GEMINI_TIMEOUT_MS).toBe(90_000);
    expect(GEMINI_FALLBACK_MIN_REMAINING_MS).toBe(10_000);
  });

  it('a hanging upstream request is aborted at the deadline and classified as the fixed 504 upstream_timeout', async () => {
    const calls = { n: 0 };
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: hangingFetch(calls) as never } }, 200);
    const t0 = Date.now();
    const err = await ai.models.generateContent(req).then(() => null, (e: unknown) => e);
    const took = Date.now() - t0;
    expect(err).toBeTruthy();
    expect(took).toBeGreaterThanOrEqual(150);
    expect(took).toBeLessThan(1500);
    const c = fixed(err);
    expect(c).toMatchObject({ status: 504, code: 'upstream_timeout' });
    expect(c.message).not.toMatch(/abort|k\b/i);
  });

  it('the SDK does not retry on its own: retryOptions is unset, so a 503 is exactly one HTTP call per model (SDK 2.31.0)', async () => {
    const log: Call[] = [];
    const ai = make([{ status: 503 }], log, 60_000, { fallbackModel: 'off' });
    const t0 = Date.now();
    const err = await ai.models.generateContent(req).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1); // exact, not "fewer than 5": no SDK retry and no back-off
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((err as { status?: number }).status).toBe(503);
  });

  it('a fast response passes through unchanged and leaves no timer behind', async () => {
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: (async () => ok()) as never } }, 60_000);
    const before = timers(); // the test runner holds its own timers
    const res = await ai.models.generateContent(req);
    expect(res.text).toBe('hi');
    expect(timers()).toBeLessThanOrEqual(before);
  });

  it('keeps caller headers and still honours a caller-supplied abort signal', async () => {
    const seen: Record<string, string>[] = [];
    const capture = async (_u: unknown, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return ok();
    };
    const ai = createGenAI({ apiKey: 'k', httpOptions: { headers: { 'User-Agent': 'aistudio-build' }, fetch: capture as never } }, 60_000);
    await ai.models.generateContent(req);
    expect(seen[0]['user-agent']).toContain('aistudio-build');

    const calls = { n: 0 };
    const ai2 = createGenAI({ apiKey: 'k', httpOptions: { fetch: hangingFetch(calls) as never } }, 60_000);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const err = await ai2.models.generateContent({ ...req, config: { abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
    expect(calls.n).toBe(1); // a caller abort never starts a fallback
  });
});

describe('createGenAI: 503 model fallback', () => {
  it('1. primary success: the fallback is not called', async () => {
    const log: Call[] = [];
    const res = await make(['ok'], log).models.generateContent(prodReq);
    expect(res.text).toBe('hi');
    expect(log.map((c) => c.model)).toEqual([PRIMARY]);
  });

  it('2+3. primary 503 then fallback success: fallback is attempted and its response is returned normally', async () => {
    const log: Call[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await make([{ status: 503 }, { okText: 'from-fallback' }], log).models.generateContent(prodReq);
    expect(res.text).toBe('from-fallback');
    expect(log.map((c) => c.model)).toEqual([PRIMARY, FALLBACK]); // exactly two HTTP calls
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('3b. only the model changes: body, response MIME type, system instruction and temperature are identical', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await make([{ status: 503 }, 'ok'], log).models.generateContent(prodReq);
    expect(log[0].body).toEqual(log[1].body);
    const body = log[1].body as { generationConfig?: Record<string, unknown>; systemInstruction?: unknown };
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0.3 });
    expect(JSON.stringify(body.systemInstruction)).toContain('be brief');
    expect(log[0].headers['x-goog-api-key']).toBe(log[1].headers['x-goog-api-key']);
  });

  it('3c. UNAVAILABLE logs one sanitized line: only from/to/status, never prompt, key or provider text', async () => {
    const log: Call[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await make([{ status: 503 }, 'ok'], log).models.generateContent(prodReq);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({ event: 'gemini_fallback', from: PRIMARY, to: FALLBACK, status: 503 });
    expect(Object.keys(parsed).sort()).toEqual(['event', 'from', 'level', 'status', 'to', 'ts']);
    for (const secret of ['PROMPT-SECRET', 'KEY-SECRET', PROVIDER_DETAIL]) expect(line).not.toContain(secret);
  });

  it('4. both models return 503: the sanitized error is preserved (502 ai_upstream_error, fixed message)', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await make([{ status: 503 }], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, FALLBACK]); // never a third call
    expect((err as { status?: number }).status).toBe(503);
    const c = fixed(err);
    expect(c).toMatchObject({ status: 502, code: 'ai_upstream_error' });
    expect(c.message).toBe('The AI service is temporarily unavailable. Please try again shortly.');
    expect(c.message).not.toContain(PROVIDER_DETAIL);
  });

  it('5. primary 400: no fallback', async () => {
    const log: Call[] = [];
    const err = await make([{ status: 400 }], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(400);
  });

  it.each([401, 403])('6. primary %i: no fallback', async (status) => {
    const log: Call[] = [];
    const err = await make([{ status }], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(status);
  });

  it.each([404, 408, 429, 500, 502, 504])('6b. primary %i: no fallback and the error is rethrown unchanged', async (status) => {
    const log: Call[] = [];
    const err = await make([{ status }], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(status);
  });

  it('a non-HTTP failure (network error) is not a 503 and does not trigger the fallback', async () => {
    let n = 0;
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: (async () => { n += 1; throw new TypeError('fetch failed'); }) as never } }, 60_000);
    await ai.models.generateContent(prodReq).then(() => null, () => null);
    expect(n).toBe(1);
  });

  it('7. one shared 90 s-style deadline covers both attempts (the fallback gets no fresh timer)', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ai = make([{ status: 503, delayMs: 250 }, 'hang'], log, 500, { minRemainingMs: 0 });
    const t0 = Date.now();
    const err = await ai.models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    const took = Date.now() - t0;
    expect(log.map((c) => c.model)).toEqual([PRIMARY, FALLBACK]);
    expect(took).toBeGreaterThanOrEqual(450);
    expect(took).toBeLessThan(750); // would be ~750 ms+ if the fallback reset the deadline
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('7b. the fallback request advertises only the time that is really left (X-Server-Timeout)', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await make([{ status: 503, delayMs: 1100 }, 'ok'], log, 3000, { minRemainingMs: 0 }).models.generateContent(prodReq);
    expect(log[0].headers['x-server-timeout']).toBe('3');
    expect(log[1].headers['x-server-timeout']).toBe('2'); // ~1.9 s left, rounded up by the SDK
  });

  it('8a. a caller abort during the primary attempt cancels the operation and starts no fallback', async () => {
    const log: Call[] = [];
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const err = await make(['hang'], log).models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('8b. a caller abort during the fallback attempt cancels it', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 80);
    const t0 = Date.now();
    const err = await make([{ status: 503 }, 'hang'], log).models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, FALLBACK]);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('8c. a caller abort that lands together with the 503 starts no fallback and rethrows the original 503', async () => {
    const log: Call[] = [];
    const ctl = new AbortController();
    const ai = createGenAI(
      { apiKey: 'k', httpOptions: { fetch: scripted([{ status: 503 }], log, () => ctl.abort()) } },
      60_000
    );
    const err = await ai.models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(503);
  });

  it('9. timers and the caller-signal listener are cleaned up on success, on fallback success and on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scenarios: Step[][] = [['ok'], [{ status: 503 }, 'ok'], [{ status: 503 }], [{ status: 400 }]];
    for (const steps of scenarios) {
      const ctl = new AbortController();
      const before = timers();
      expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0);
      await make(steps, [], 60_000)
        .models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } })
        .then(() => null, () => null);
      expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0); // removed in finally
      expect(timers()).toBeLessThanOrEqual(before); // the 90 s timer is cleared
      expect(ctl.signal.aborted).toBe(false); // cleanup must not abort the caller's signal
    }
  });

  it('11. fallback is skipped when less than 10 s of the deadline remain; the original 503 is rethrown', async () => {
    const log: Call[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await make([{ status: 503 }], log, 5_000).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(503);
    expect(warn).not.toHaveBeenCalled(); // no fallback was activated, so nothing is logged as one
  });

  it('11b. the guard measures time actually left: a slow primary 503 leaves too little for a fallback', async () => {
    const log: Call[] = [];
    const err = await make([{ status: 503, delayMs: 300 }], log, 500, { minRemainingMs: 300 })
      .models.generateContent(prodReq)
      .then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1); // ~200 ms left < 300 ms
    expect((err as { status?: number }).status).toBe(503);
  });

  it('12. requested model already equals the fallback: no duplicate fallback call', async () => {
    for (const model of [FALLBACK, `models/${FALLBACK}`]) {
      const log: Call[] = [];
      const err = await make([{ status: 503 }], log).models.generateContent({ ...prodReq, model }).then(() => null, (e: unknown) => e);
      expect(log).toHaveLength(1);
      expect((err as { status?: number }).status).toBe(503);
    }
  });

  it('12b. the same applies to a custom configured fallback model', async () => {
    const log: Call[] = [];
    await make([{ status: 503 }], log, 60_000, { fallbackModel: 'gemini-3.5-flash-lite' })
      .models.generateContent({ ...prodReq, model: 'gemini-3.5-flash-lite' })
      .then(() => null, () => null);
    expect(log).toHaveLength(1);
  });
});

describe('GEMINI_FALLBACK_MODEL configuration', () => {
  it('10a. unset or empty uses the default gemini-3.6-flash', () => {
    expect(DEFAULT_GEMINI_FALLBACK_MODEL).toBe(FALLBACK);
    expect(resolveFallbackModel(undefined)).toBe(FALLBACK);
    expect(resolveFallbackModel('')).toBe(FALLBACK);
    expect(resolveFallbackModel('   ')).toBe(FALLBACK);
  });

  it('10b. "off" disables, a valid model id is used as given', () => {
    expect(resolveFallbackModel('off')).toBeNull();
    expect(resolveFallbackModel(' OFF ')).toBeNull();
    expect(resolveFallbackModel('gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(resolveFallbackModel(' gemini-3.6-flash ')).toBe('gemini-3.6-flash');
  });

  it('10c. invalid values disable the fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['gpt-4', 'gemini-', 'gemini-3.6 flash', 'Gemini-3.6-flash', 'gemini-3.6-flash;drop', '../gemini-3.6-flash', 'gemini-é']) {
      expect(resolveFallbackModel(bad), bad).toBeNull();
    }
  });

  it('10d. an invalid value logs ONE sanitized warning per process and never echoes the value', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fresh = await import('./gemini');
    expect(fresh.resolveFallbackModel('sk-SECRET-looking-value')).toBeNull();
    expect(fresh.resolveFallbackModel('sk-SECRET-looking-value')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ event: 'gemini_fallback_config_invalid' });
    expect(line).not.toContain('SECRET');
  });

  it('10e. end to end: invalid configuration leaves primary behaviour unchanged (one call, original 503)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: Call[] = [];
    const err = await make([{ status: 503 }], log, 60_000, { fallbackModel: 'not a model' }).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(503);
  });

  it('10f. end to end: "off" disables the fallback', async () => {
    const log: Call[] = [];
    await make([{ status: 503 }], log, 60_000, { fallbackModel: 'off' }).models.generateContent(prodReq).then(() => null, () => null);
    expect(log).toHaveLength(1);
  });

  it('10g. end to end: the environment variable is read when no explicit setting is passed (unset = default, set = override, off = disabled)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    let log: Call[] = [];
    await make([{ status: 503 }, 'ok'], log).models.generateContent(prodReq); // unset
    expect(log.map((c) => c.model)).toEqual([PRIMARY, FALLBACK]);

    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
    log = [];
    await make([{ status: 503 }, 'ok'], log).models.generateContent(prodReq);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, 'gemini-3.5-flash-lite']);

    process.env.GEMINI_FALLBACK_MODEL = 'off';
    log = [];
    await make([{ status: 503 }, 'ok'], log).models.generateContent(prodReq).then(() => null, () => null);
    expect(log.map((c) => c.model)).toEqual([PRIMARY]);
  });
});
