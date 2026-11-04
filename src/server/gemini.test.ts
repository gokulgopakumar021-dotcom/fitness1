// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyError } from './security/errors';
import { GEMINI_TIMEOUT_MS, createGenAI } from './gemini';

const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] }), {
    status: 200,
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

const req = { model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] };

describe('createGenAI: hard per-call Gemini deadline (owner decision: 90 s)', () => {
  it('the production deadline is exactly 90 seconds, below the 120 s function maxDuration', () => {
    expect(GEMINI_TIMEOUT_MS).toBe(90_000);
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
    const c = classifyError(err, { message: 'fallback' });
    expect(c).toMatchObject({ status: 504, code: 'upstream_timeout' });
    expect(c.message).not.toMatch(/abort|k\b/i);
  });

  it('the deadline covers SDK retries and back-off: repeated 503s do not extend it', async () => {
    let n = 0;
    const flaky = async () => {
      n += 1;
      return new Response('{}', { status: 503 });
    };
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: flaky as never } }, 400);
    const t0 = Date.now();
    await ai.models.generateContent(req).then(() => null, () => null);
    expect(Date.now() - t0).toBeLessThan(2500); // the SDK's own back-off alone is 1 s, 2 s, 4 s... for 5 attempts
    expect(n).toBeLessThan(5);
  });

  it('a fast response passes through unchanged and leaves no timer behind', async () => {
    const ai = createGenAI({ apiKey: 'k', httpOptions: { fetch: (async () => ok()) as never } }, 60_000);
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
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
    expect(classifyError(err, { message: 'f' })).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });
});
