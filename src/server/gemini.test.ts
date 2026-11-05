// @vitest-environment node
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyError } from './security/errors';
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  GEMINI_FALLBACK_MIN_REMAINING_MS,
  GEMINI_MAX_ATTEMPTS,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_RETRY_MAX_DELAY_MS,
  GEMINI_TIMEOUT_MS,
  backoffDelayMs,
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
  config: { responseMimeType: 'application/json', systemInstruction: 'be brief', maxOutputTokens: 1234 }
};
const fixed = (e: unknown) => classifyError(e, { message: 'fallback' });
const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
const FAST_RETRY = { retryDelay: { baseMs: 1, maxMs: 2 } };
const make = (steps: Step[], log: Call[], timeoutMs = 60_000, extra = {}) =>
  createGenAI({ apiKey: 'KEY-SECRET', httpOptions: { fetch: scripted(steps, log) } }, timeoutMs, { ...FAST_RETRY, ...extra });

type LogLine = Record<string, unknown> & { event: string; level: string };
/** Captures every console line the logger writes (all levels) and returns the parsed gemini_* events. */
function captureLogs() {
  const lines: string[] = [];
  const sink = (...args: unknown[]) => {
    lines.push(String(args[0]));
  };
  vi.spyOn(console, 'log').mockImplementation(sink);
  vi.spyOn(console, 'warn').mockImplementation(sink);
  vi.spyOn(console, 'error').mockImplementation(sink);
  return {
    raw: () => lines.join('\n'),
    events: () => lines.map((l) => JSON.parse(l) as LogLine).filter((l) => String(l.event).startsWith('gemini_')),
    names: () => lines.map((l) => (JSON.parse(l) as LogLine).event).filter((e) => String(e).startsWith('gemini_'))
  };
}
const fail = (e: unknown) => e as { status?: number; name?: string };

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

  it('the SDK does not retry on its own: retryOptions is unset, so every HTTP request is one this wrapper made and counted (SDK 2.31.0)', async () => {
    const log: Call[] = [];
    captureLogs();
    const ai = make([{ status: 503 }], log, 60_000, { fallbackModel: 'off' });
    const err = await ai.models.generateContent(req).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(2); // exact, not \"fewer than 5\": primary + the ONE wrapper retry; the SDK adds none
    expect(fail(err).status).toBe(503);
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

describe('createGenAI: bounded 503 recovery (retry primary once, then one fallback request)', () => {
  it('constants: at most 3 attempts, 1-2 s back-off, 10 s guard, 90 s deadline', () => {
    expect(GEMINI_MAX_ATTEMPTS).toBe(3);
    expect(GEMINI_RETRY_BASE_DELAY_MS).toBe(1_000);
    expect(GEMINI_RETRY_MAX_DELAY_MS).toBe(2_000);
    expect(GEMINI_FALLBACK_MIN_REMAINING_MS).toBe(10_000);
    expect(GEMINI_TIMEOUT_MS).toBe(90_000);
  });

  it('1. primary succeeds immediately: exactly one request and no recovery events', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const res = await make(['ok', { status: 503 }, { status: 503 }], log).models.generateContent(prodReq);
    expect(res.text).toBe('hi');
    expect(log.map((c) => c.model)).toEqual([PRIMARY]);
    expect(logs.events()).toEqual([]);
  });

  it('2. primary 503, retry succeeds: two requests, both to the primary, the fallback is never called', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const res = await make([{ status: 503 }, { okText: 'from-retry' }, { status: 503 }], log).models.generateContent(prodReq);
    expect(res.text).toBe('from-retry');
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
    expect(logs.names()).toEqual(['gemini_retry', 'gemini_retry_succeeded']);
  });

  it('3. primary 503, retry 503, fallback succeeds: three requests in order primary, primary, fallback', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const res = await make([{ status: 503 }, { status: 503 }, { okText: 'from-fallback' }, { status: 503 }], log).models.generateContent(prodReq);
    expect(res.text).toBe('from-fallback');
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
    expect(logs.names()).toEqual(['gemini_retry', 'gemini_fallback', 'gemini_fallback_succeeded']);
    expect(logs.names()).not.toContain('gemini_recovery_failed');
  });

  it('3b. only the model changes: body, response MIME type, system instruction and output limit are identical on all attempts', async () => {
    const log: Call[] = [];
    captureLogs();
    await make([{ status: 503 }, { status: 503 }, 'ok'], log).models.generateContent(prodReq);
    expect(log).toHaveLength(3);
    expect(log[1].body).toEqual(log[0].body);
    expect(log[2].body).toEqual(log[0].body);
    const body = log[2].body as { generationConfig?: Record<string, unknown>; systemInstruction?: unknown };
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 1234 });
    expect(JSON.stringify(body.systemInstruction)).toContain('be brief');
    expect(log[0].headers['x-goog-api-key']).toBe(log[2].headers['x-goog-api-key']);
  });

  it('4. all three attempts return 503: exactly three requests, never a fourth, sanitized 502 ai_upstream_error', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 503 }], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
    expect(fail(err).status).toBe(503);
    const c = fixed(err);
    expect(c).toMatchObject({ status: 502, code: 'ai_upstream_error' });
    expect(c.message).toBe('The AI service is temporarily unavailable. Please try again shortly.');
    expect(c.message).not.toContain(PROVIDER_DETAIL);
    expect(logs.names()).toEqual(['gemini_retry', 'gemini_fallback', 'gemini_recovery_failed']);
    expect(logs.events().at(-1)).toMatchObject({
      reason: 'exhausted',
      attempts: 3,
      models: [PRIMARY, PRIMARY, FALLBACK],
      statuses: [503, 503, 503],
      fallbackAttempted: true
    });
  });

  it('4b. a non-503 on the retry or on the fallback ends recovery at once (no further attempt)', async () => {
    const a: Call[] = [];
    const errA = await make([{ status: 503 }, { status: 429 }], a).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(a.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
    expect(fail(errA).status).toBe(429);

    const b: Call[] = [];
    const errB = await make([{ status: 503 }, { status: 503 }, { status: 400 }], b).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(b.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
    expect(fail(errB).status).toBe(400);
  });

  it('5. primary 400: no retry, no fallback, no recovery log', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 400 }, 'ok'], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(400);
    expect(logs.events()).toEqual([]);
  });

  it.each([401, 403])('6. primary %i: no retry and no fallback', async (status) => {
    const log: Call[] = [];
    const err = await make([{ status }, 'ok'], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(status);
  });

  it('7. primary 429: no retry and no fallback (quota errors are never retried)', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 429 }, 'ok'], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(429);
    expect(logs.events()).toEqual([]);
  });

  it.each([404, 408, 500, 502, 504])('8. primary %i: no retry, no fallback, error rethrown unchanged', async (status) => {
    const log: Call[] = [];
    const err = await make([{ status }, 'ok'], log).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(status);
  });

  it('8b. a non-HTTP failure (network error) is not a 503: one attempt only', async () => {
    let n = 0;
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: (async () => { n += 1; throw new TypeError('fetch failed'); }) as never } }, 60_000, FAST_RETRY);
    await ai.models.generateContent(prodReq).then(() => null, () => null);
    expect(n).toBe(1);
  });

  it('9. caller abort during the back-off wait: no further request, fast AbortError (504 upstream_timeout), listeners cleaned', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const ctl = new AbortController();
    const ai = make([{ status: 503 }, 'ok'], log, 60_000, { retryDelay: { baseMs: 500, maxMs: 1000 }, random: () => 0.5 });
    setTimeout(() => ctl.abort(), 50);
    const before = timers();
    const t0 = Date.now();
    const err = await ai.models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(400); // did not sit out the 750 ms back-off
    expect(log).toHaveLength(1); // the retry was never sent
    expect(fail(err).name).toBe('AbortError');
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
    expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0);
    expect(timers()).toBeLessThanOrEqual(before); // back-off timer and deadline timer are both gone
    expect(logs.events().at(-1)).toMatchObject({ event: 'gemini_recovery_failed', reason: 'aborted', attempts: 1 });
  });

  it('9b. a caller abort during the retry attempt or the fallback attempt cancels it and starts nothing more', async () => {
    for (const [steps, expected] of [
      [[{ status: 503 }, 'hang'], [PRIMARY, PRIMARY]],
      [[{ status: 503 }, { status: 503 }, 'hang'], [PRIMARY, PRIMARY, FALLBACK]]
    ] as Array<[Step[], string[]]>) {
      const log: Call[] = [];
      captureLogs();
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 80);
      const t0 = Date.now();
      const err = await make(steps, log).models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
      expect(log.map((c) => c.model)).toEqual(expected);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
      vi.restoreAllMocks();
    }
  });

  it('9c. a caller abort that lands together with the first 503 starts no retry and rethrows the original 503', async () => {
    const log: Call[] = [];
    captureLogs();
    const ctl = new AbortController();
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: scripted([{ status: 503 }], log, () => ctl.abort()) } }, 60_000, FAST_RETRY);
    const err = await ai.models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } }).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(503);
  });

  it('10. the shared deadline expiring during the retry attempt ends the call: 504, no fallback, one shared deadline', async () => {
    const log: Call[] = [];
    captureLogs();
    const ai = make([{ status: 503, delayMs: 150 }, 'hang'], log, 400, { minRemainingMs: 0 });
    const t0 = Date.now();
    const err = await ai.models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    const took = Date.now() - t0;
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]); // no third request after the deadline
    expect(took).toBeGreaterThanOrEqual(350);
    expect(took).toBeLessThan(650); // would be far later if the retry or the back-off reset the deadline
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('10b. the fallback request shares the same deadline too', async () => {
    const log: Call[] = [];
    captureLogs();
    const ai = make([{ status: 503, delayMs: 100 }, { status: 503, delayMs: 100 }, 'hang'], log, 500, { minRemainingMs: 0 });
    const t0 = Date.now();
    const err = await ai.models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    const took = Date.now() - t0;
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
    expect(took).toBeGreaterThanOrEqual(450);
    expect(took).toBeLessThan(750);
    expect(fixed(err)).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('10c. retry and fallback requests advertise only the time that is really left (X-Server-Timeout)', async () => {
    const log: Call[] = [];
    captureLogs();
    await make([{ status: 503, delayMs: 1100 }, { status: 503, delayMs: 1100 }, 'ok'], log, 5000, { minRemainingMs: 0 }).models.generateContent(prodReq);
    expect(log[0].headers['x-server-timeout']).toBe('5');
    expect(Number(log[1].headers['x-server-timeout'])).toBeLessThanOrEqual(4); // ~3.9 s left
    expect(Number(log[2].headers['x-server-timeout'])).toBeLessThanOrEqual(3); // ~2.8 s left
  });

  it('11. insufficient time: with less than 10 s of deadline left nothing is retried and the original 503 is rethrown', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 503 }, 'ok'], log, 5_000).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(503);
    expect(logs.names()).toEqual(['gemini_recovery_failed']); // no retry/fallback event: none was activated
    expect(logs.events()[0]).toMatchObject({ reason: 'insufficient_time', attempts: 1, fallbackAttempted: false });
  });

  it('11b. the guard counts the back-off delay: a retry that would leave less than the minimum after waiting is skipped', async () => {
    const skipped: Call[] = [];
    captureLogs();
    await make([{ status: 503 }, 'ok'], skipped, 1_000, { minRemainingMs: 600, retryDelay: { baseMs: 500, maxMs: 500 }, random: () => 0 })
      .models.generateContent(prodReq)
      .then(() => null, () => null);
    expect(skipped).toHaveLength(1); // ~1000 - 500 = 500 ms < 600 ms

    const allowed: Call[] = [];
    const res = await make([{ status: 503 }, 'ok'], allowed, 1_000, { minRemainingMs: 400, retryDelay: { baseMs: 500, maxMs: 500 }, random: () => 0 }).models.generateContent(prodReq);
    expect(res.text).toBe('hi');
    expect(allowed).toHaveLength(2);
  });

  it('11c. too little time after a failed retry skips the fallback only: two requests, the 503 is rethrown', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 503 }, { status: 503, delayMs: 420 }, 'ok'], log, 500, { minRemainingMs: 100 })
      .models.generateContent(prodReq)
      .then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]); // ~80 ms left < 100 ms
    expect(fail(err).status).toBe(503);
    expect(logs.names()).toEqual(['gemini_retry', 'gemini_recovery_failed']);
    expect(logs.events().at(-1)).toMatchObject({ reason: 'insufficient_time', attempts: 2, fallbackAttempted: false });
  });

  it('12. fallback disabled ("off"): the primary is retried once, then the 503 is rethrown (two requests, no fallback)', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const err = await make([{ status: 503 }], log, 60_000, { fallbackModel: 'off' }).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
    expect(fail(err).status).toBe(503);
    expect(logs.names()).toEqual(['gemini_retry', 'gemini_recovery_failed']);
    expect(logs.events().at(-1)).toMatchObject({ reason: 'no_fallback', fallbackAttempted: false });
  });

  it('13. requested model already equals the fallback: retried once, never "fallen back" to itself (two requests)', async () => {
    for (const model of [FALLBACK, `models/${FALLBACK}`]) {
      const log: Call[] = [];
      captureLogs();
      const err = await make([{ status: 503 }], log).models.generateContent({ ...prodReq, model }).then(() => null, (e: unknown) => e);
      expect(log).toHaveLength(2);
      expect(new Set(log.map((c) => c.model))).toEqual(new Set([FALLBACK]));
      expect(fail(err).status).toBe(503);
      vi.restoreAllMocks();
    }
  });

  it('13b. the same applies to a custom configured fallback model', async () => {
    const log: Call[] = [];
    captureLogs();
    await make([{ status: 503 }], log, 60_000, { fallbackModel: 'gemini-3.5-flash-lite' })
      .models.generateContent({ ...prodReq, model: 'gemini-3.5-flash-lite' })
      .then(() => null, () => null);
    expect(log).toHaveLength(2);
  });

  it('14. logging: only ids, models, attempts, numeric statuses, outcome and timings; never prompt, key, history or provider text', async () => {
    const log: Call[] = [];
    const logs = captureLogs();
    const secretReq = {
      ...prodReq,
      contents: [
        { role: 'user', parts: [{ text: 'HISTORY-SECRET-1' }] },
        { role: 'model', parts: [{ text: 'HISTORY-SECRET-2' }] },
        { role: 'user', parts: [{ text: 'PROMPT-SECRET' }] }
      ],
      config: { ...prodReq.config, systemInstruction: 'SYSTEM-SECRET' }
    };
    await make([{ status: 503 }], log).models.generateContent(secretReq).then(() => null, () => null);
    await make([{ status: 503 }, { status: 503 }, 'ok'], [], 60_000).models.generateContent(secretReq);
    await make([{ status: 503 }, 'ok'], [], 60_000).models.generateContent(secretReq);
    const raw = logs.raw();
    for (const secret of ['PROMPT-SECRET', 'HISTORY-SECRET-1', 'HISTORY-SECRET-2', 'SYSTEM-SECRET', 'KEY-SECRET', PROVIDER_DETAIL, 'x-goog-api-key']) {
      expect(raw).not.toContain(secret);
    }
    const allowed: Record<string, string[]> = {
      gemini_retry: ['attempt', 'delayMs', 'event', 'generationId', 'level', 'model', 'status', 'ts'],
      gemini_retry_succeeded: ['attempts', 'elapsedMs', 'event', 'generationId', 'level', 'model', 'ts'],
      gemini_fallback: ['attempt', 'event', 'from', 'generationId', 'level', 'status', 'to', 'ts'],
      gemini_fallback_succeeded: ['attempts', 'elapsedMs', 'event', 'from', 'generationId', 'level', 'to', 'ts'],
      gemini_recovery_failed: ['attempts', 'elapsedMs', 'event', 'fallbackAttempted', 'generationId', 'level', 'models', 'reason', 'statuses', 'ts']
    };
    for (const e of logs.events()) {
      expect(Object.keys(e).sort()).toEqual(allowed[e.event]);
      expect(typeof e.generationId).toBe('string');
    }
    const ids = new Set(logs.events().map((e) => e.generationId));
    expect(ids.size).toBe(3); // one id per generation, shared by all of that generation's events
  });

  it('14b. logging: one id per generation, no duplicate or contradictory events, final-failure event is emitted exactly once', async () => {
    const logs = captureLogs();
    await make([{ status: 503 }], [], 60_000).models.generateContent(prodReq).then(() => null, () => null);
    const events = logs.events();
    expect(new Set(events.map((e) => e.generationId)).size).toBe(1);
    expect(events.filter((e) => e.event === 'gemini_recovery_failed')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'gemini_fallback')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'gemini_retry')).toHaveLength(1);
    expect(events.some((e) => e.event.endsWith('succeeded'))).toBe(false);
    expect(events.at(-1)?.elapsedMs).toEqual(expect.any(Number));
  });

  it('15. timers and listeners are cleaned up on every path (success, retry success, fallback success, failure, abort during back-off)', async () => {
    captureLogs();
    const scenarios: Step[][] = [['ok'], [{ status: 503 }, 'ok'], [{ status: 503 }, { status: 503 }, 'ok'], [{ status: 503 }], [{ status: 400 }]];
    for (const steps of scenarios) {
      const ctl = new AbortController();
      const before = timers();
      expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0);
      await make(steps, [], 60_000)
        .models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } })
        .then(() => null, () => null);
      expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0);
      expect(timers()).toBeLessThanOrEqual(before);
      expect(ctl.signal.aborted).toBe(false); // cleanup must not abort the caller's signal
    }
    // abort during back-off (the caller's signal is aborted by design here)
    const ctl = new AbortController();
    const before = timers();
    setTimeout(() => ctl.abort(), 30);
    await make([{ status: 503 }, 'ok'], [], 60_000, { retryDelay: { baseMs: 400, maxMs: 400 }, random: () => 0 })
      .models.generateContent({ ...prodReq, config: { ...prodReq.config, abortSignal: ctl.signal } })
      .then(() => null, () => null);
    expect(getEventListeners(ctl.signal, 'abort')).toHaveLength(0);
    expect(timers()).toBeLessThanOrEqual(before);
  });

  it('16. nothing is started after a success: the request count equals the position of the first success', async () => {
    captureLogs();
    for (const [steps, expected] of [
      [['ok', { status: 503 }, { status: 503 }], 1],
      [[{ status: 503 }, 'ok', { status: 503 }], 2],
      [[{ status: 503 }, { status: 503 }, 'ok', { status: 503 }], 3]
    ] as Array<[Step[], number]>) {
      const log: Call[] = [];
      const res = await make(steps, log).models.generateContent(prodReq);
      expect(res.text).toBe('hi');
      await new Promise((r) => setTimeout(r, 30)); // a stray late attempt would show up here
      expect(log).toHaveLength(expected);
    }
  });

  it('16b. the request count never exceeds GEMINI_MAX_ATTEMPTS, whatever the upstream does', async () => {
    captureLogs();
    for (const steps of [[{ status: 503 }], [{ status: 503 }, { status: 503 }, { status: 503 }]] as Step[][]) {
      const log: Call[] = [];
      await make(steps, log).models.generateContent(prodReq).then(() => null, () => null);
      expect(log.length).toBeLessThanOrEqual(GEMINI_MAX_ATTEMPTS);
    }
  });
});

describe('createGenAI: back-off timing (deterministic fake timers, production defaults)', () => {
  afterEach(() => vi.useRealTimers());

  it('backoffDelayMs: 1.0-2.0 s for the single retry, exponential in the retry index, hard-capped, jitter clamped', () => {
    expect(backoffDelayMs(0, 1000, 2000, () => 0)).toBe(1000);
    expect(backoffDelayMs(0, 1000, 2000, () => 0.5)).toBe(1500);
    expect(backoffDelayMs(0, 1000, 2000, () => 0.999999)).toBeLessThan(2000);
    expect(backoffDelayMs(0, 1000, 2000, () => 0.999999)).toBeGreaterThanOrEqual(1999);
    expect(backoffDelayMs(1, 500, 100_000, () => 0)).toBe(1000); // exponential in the index
    expect(backoffDelayMs(5, 1000, 2000, () => 0)).toBe(2000); // capped
    expect(backoffDelayMs(0, 1000, 2000, () => 7)).toBeLessThan(2000); // jitter above 1 is clamped
    expect(backoffDelayMs(0, 1000, 2000, () => -3)).toBe(1000); // jitter below 0 is clamped
  });

  it.each([
    [0, 1000],
    [0.5, 1500],
    [0.9, 1900]
  ])('with jitter %s the retry is sent exactly %i ms after the 503 (not earlier)', async (rnd, delay) => {
    vi.useFakeTimers();
    captureLogs();
    const log: Call[] = [];
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: scripted([{ status: 503 }, 'ok'], log) } }, GEMINI_TIMEOUT_MS, { random: () => rnd });
    const pending = ai.models.generateContent(prodReq);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(log).toHaveLength(1); // still waiting
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.text).toBe('hi');
    expect(log).toHaveLength(2);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
  });

  it('the fallback follows the second 503 immediately (no extra delay): total recovery delay is the single back-off', async () => {
    vi.useFakeTimers();
    captureLogs();
    const log: Call[] = [];
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: scripted([{ status: 503 }, { status: 503 }, 'ok'], log) } }, GEMINI_TIMEOUT_MS, { random: () => 0.999 });
    const pending = ai.models.generateContent(prodReq);
    await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_DELAY_MS); // the whole bounded back-off, nothing more
    const res = await pending;
    expect(res.text).toBe('hi');
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
  });

  it('with production defaults, a 503 with under ~12 s of deadline left is not retried', async () => {
    vi.useFakeTimers();
    captureLogs();
    const log: Call[] = [];
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: scripted([{ status: 503 }, 'ok'], log) } }, 11_000, { random: () => 0.999 });
    const err = await ai.models.generateContent(prodReq).then(() => null, (e: unknown) => e); // 11 000 - ~2 000 < 10 000
    expect(log).toHaveLength(1);
    expect(fail(err).status).toBe(503);
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

  it('10e. end to end: invalid configuration disables only the fallback: primary, one primary retry, original 503 (two calls, all primary)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: Call[] = [];
    const err = await make([{ status: 503 }], log, 60_000, { fallbackModel: 'not a model' }).models.generateContent(prodReq).then(() => null, (e: unknown) => e);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
    expect((err as { status?: number }).status).toBe(503);
  });

  it('10f. end to end: "off" disables the fallback', async () => {
    const log: Call[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await make([{ status: 503 }], log, 60_000, { fallbackModel: 'off' }).models.generateContent(prodReq).then(() => null, () => null);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
  });

  it('10g. end to end: the environment variable is read when no explicit setting is passed (unset = default, set = override, off = disabled)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    let log: Call[] = [];
    await make([{ status: 503 }, { status: 503 }, 'ok'], log).models.generateContent(prodReq); // unset
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);

    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
    log = [];
    await make([{ status: 503 }, { status: 503 }, 'ok'], log).models.generateContent(prodReq);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, 'gemini-3.5-flash-lite']);

    process.env.GEMINI_FALLBACK_MODEL = 'off';
    log = [];
    await make([{ status: 503 }], log).models.generateContent(prodReq).then(() => null, () => null);
    expect(log.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
  });
});
