// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpikeApp, SPIKE_SERVICE, SPIKE_VERSION } from '../../../api/_spike/app';
import handler from '../../../api/index';

let server: http.Server;
let base = '';

beforeAll(async () => {
  // Use the real function entry's default export, exactly as Vercel would call it.
  server = http.createServer(handler as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('vercel spike app', () => {
  it('exports an Express-compatible request listener from the function entry', () => {
    expect(typeof handler).toBe('function');
    expect(typeof createSpikeApp()).toBe('function');
  });

  it('GET /api/health', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      ok: true,
      service: SPIKE_SERVICE,
      runtime: 'vercel-function',
      version: SPIKE_VERSION,
    });
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('GET path diagnostic reports method, path, originalUrl, match', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/path?x=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      method: 'GET',
      path: '/api/__vercel_spike/path',
      originalUrl: '/api/__vercel_spike/path?x=1',
      routeMatched: true,
    });
  });

  it('POST method diagnostic echoes method and JSON body', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/method`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      method: 'POST',
      path: '/api/__vercel_spike/method',
      body: { hello: 'world' },
    });
  });

  it('rejects oversized bodies with controlled 413 and no stack', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/method`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(5000) }),
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'payload_too_large' });
    expect(text).not.toMatch(/at\s.+\(|node_modules|stack/i);
  });

  it('rejects malformed JSON with controlled 400', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/method`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('unknown /api/__vercel_spike/* returns controlled JSON 404', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/unknown`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'spike_route_not_found',
      method: 'GET',
      path: '/api/__vercel_spike/unknown',
      routeMatched: false,
    });
  });

  it('wrong method on a spike route is a controlled JSON 404', async () => {
    const res = await fetch(`${base}/api/__vercel_spike/method`);
    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });

  it('other unknown /api/* paths return controlled JSON 404', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found', method: 'GET', path: '/api/nope' });
  });

  it('does not leak env vars, headers, cookies or auth tokens', async () => {
    process.env.SPIKE_CANARY_SECRET = 'canary-secret-value-123';
    const bodies: string[] = [];
    for (const [path, init] of [
      ['/api/health', {}],
      ['/api/__vercel_spike/path', {}],
      ['/api/__vercel_spike/unknown', {}],
      ['/api/nope', {}],
      ['/api/__vercel_spike/method', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ] as const) {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init as { headers?: Record<string, string> }).headers,
          authorization: 'Bearer canary-bearer-token',
          cookie: 'sid=canary-cookie',
        },
      });
      bodies.push(await res.text());
    }
    delete process.env.SPIKE_CANARY_SECRET;
    const all = bodies.join('\n');
    expect(all).not.toMatch(/canary-secret-value-123|canary-bearer-token|canary-cookie/);
    expect(all).not.toMatch(/authorization|cookie|SUPABASE|REDIS|GEMINI/i);
  });
});
