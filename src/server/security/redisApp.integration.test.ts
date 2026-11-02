// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

import { createApp } from '../../../server';
import { UNIVERSAL_MODEL_OUTPUT } from './aiFixtures';
import { loadSecurityConfig } from './config';
import { DegradingRateStore, MemoryRateStore, type RateStore } from './rateLimit';
import { RedisRateStore } from './redisRateStore';
import { acquireRedis, redisSuite, TcpProxy, urlViaProxy, type RedisTarget } from './redisTestHarness';
import { prepareSecurityRuntime, StartupConfigError } from './runtime';
import { fakeToken, listen, mockVerifier, testConfig } from './testUtils';

const target: RedisTarget | null = await acquireRedis();
const prefix = `app${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proxy: TcpProxy;
let closers: Array<() => Promise<void>> = [];
let logs: ReturnType<typeof vi.spyOn>[] = [];
const logged = () => logs.flatMap((s) => (s.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');

const BODY: Record<string, unknown> = {
  '/ai-food-parser': { query: '2 eggs and toast', mealCategory: 'breakfast' },
  '/extract-plan': { text: 'Day 1: Bench 3x8' },
  '/ai-generate-physique': { archetype: 'v_taper', gender: 'male', targetBodyFat: 10, customPrompt: '', muscleEmphasis: ['Lats'] },
  '/ai-physique-analysis': { dreamPhysique: { archetype: 'v_taper', title: 'x' }, currentProfile: { name: 'A' } }
};
const FAIL_CLOSED_ROUTES = ['/extract-plan', '/ai-generate-physique', '/ai-physique-analysis'];

async function redisStore(over: Partial<ConstructorParameters<typeof RedisRateStore>[0]> = {}) {
  const s = new RedisRateStore({ url: urlViaProxy(target!, proxy), keyPrefix: `${prefix}${Math.random().toString(36).slice(2, 6)}`, commandTimeoutMs: 400, logEveryMs: 0, ...over });
  closers.push(() => s.close());
  expect(await s.waitUntilReady(3000)).toBe(true);
  return s;
}
async function boot(rateStore: RateStore, cfg: Parameters<typeof testConfig>[0] = {}) {
  const srv = await listen(createApp({ verifyToken: mockVerifier, config: testConfig(cfg), rateStore }));
  closers.push(srv.close);
  const call = (path: string, user = 'user-a', body: unknown = BODY[path]) =>
    fetch(`${srv.base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeToken({ sub: user })}` }, body: JSON.stringify(body) });
  const health = () => fetch(`${srv.base}/api/health`);
  return { srv, call, health };
}

beforeAll(async () => {
  if (!target) return;
  proxy = new TcpProxy(target.host, target.port);
  await proxy.start();
});
afterAll(async () => {
  await proxy?.close();
  await target?.stop();
});
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  generate.mockReset();
  generate.mockResolvedValue({ text: JSON.stringify(UNIVERSAL_MODEL_OUTPUT) });
  logs = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})];
});
afterEach(async () => {
  logs.forEach((l) => l.mockRestore());
  await proxy?.restore();
  proxy?.unstall();
  await Promise.all(closers.splice(0).map((c) => c()));
});

redisSuite('Rate limiting through the real Express pipeline on Redis', target, () => {
  it('two app instances sharing one Redis enforce ONE per-user limit', async () => {
    const a = await boot(await redisStore({ keyPrefix: prefix + 'shared' }), { rateUserPerMin: 6 });
    const b = await boot(await redisStore({ keyPrefix: prefix + 'shared' }), { rateUserPerMin: 6 });
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await (i % 2 ? a : b).call('/ai-food-parser', 'shared-user')).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 429, 429, 429, 429]);
    // another user is unaffected, on either instance
    expect((await a.call('/ai-food-parser', 'other-user')).status).toBe(200);
    // the in-memory alternative would have allowed 6 PER instance: prove the contrast
    const m1 = await boot(new MemoryRateStore(), { rateUserPerMin: 6 });
    const m2 = await boot(new MemoryRateStore(), { rateUserPerMin: 6 });
    const memCodes: number[] = [];
    for (let i = 0; i < 10; i++) memCodes.push((await (i % 2 ? m1 : m2).call('/ai-food-parser', 'u')).status);
    expect(memCodes.filter((c) => c === 200)).toHaveLength(10);
  });

  describe('fail-closed (default policy)', () => {
    it('503 rate_limit_unavailable when Redis is down; no Gemini spend; no degraded header; health unchanged', async () => {
      const { call, health } = await boot(await redisStore());
      expect((await call('/ai-food-parser')).status).toBe(200);
      generate.mockClear();
      await proxy.cut();
      for (const route of ['/ai-food-parser', ...FAIL_CLOSED_ROUTES]) {
        const r = await call(route);
        const body = await r.json();
        expect([route, r.status, body.code]).toEqual([route, 503, 'rate_limit_unavailable']);
        expect(r.headers.get('retry-after')).toBe('5');
        expect(r.headers.get('x-ratelimit-mode')).toBeNull();
        expect(JSON.stringify(body)).not.toMatch(/redis|127\.0\.0\.1|ECONN|AUTH/i);
        expect(body.requestId).toBeTruthy();
      }
      expect(generate).not.toHaveBeenCalled();
      const h = await health();
      expect(h.status).toBe(200);
      expect(Object.keys(await h.json()).sort()).toEqual(['status', 'time']);
      expect(h.headers.get('x-ratelimit-mode')).toBeNull();
    });

    it('unauthenticated callers also get 503 (not a 401 that would bypass counting) during an outage, and recover afterwards', async () => {
      const { srv, call } = await boot(await redisStore());
      await proxy.cut();
      const anon = await fetch(`${srv.base}/api/ai-food-parser`, { method: 'POST' });
      expect(anon.status).toBe(503);
      await proxy.restore();
      let status = 0;
      for (let i = 0; i < 60 && status !== 200; i++) {
        status = (await call('/ai-food-parser')).status;
        if (status !== 200) await sleep(100);
      }
      expect(status).toBe(200);
    });

    it('a stalled Redis (timeouts, not refusals) is also fail-closed and bounded', async () => {
      const { call } = await boot(await redisStore({ commandTimeoutMs: 250 }));
      proxy.stall();
      const t0 = Date.now();
      const r = await call('/ai-food-parser');
      expect(r.status).toBe(503);
      expect(Date.now() - t0).toBeLessThan(1500);
      proxy.unstall();
    });
  });

  describe('explicit degraded mode (RATE_LIMIT_FAILURE_POLICY=degraded)', () => {
    const degrading = async () => new DegradingRateStore(await redisStore(), new MemoryRateStore(), Date.now, 0);

    it('regular AI routes keep working per-instance with X-RateLimit-Mode: degraded; sensitive routes still 503; health clean', async () => {
      const { call, health } = await boot(await degrading());
      expect((await call('/ai-food-parser')).headers.get('x-ratelimit-mode')).toBeNull(); // healthy: no header
      await proxy.cut();
      const ok = await call('/ai-food-parser');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-ratelimit-mode')).toBe('degraded');
      for (const route of FAIL_CLOSED_ROUTES) {
        generate.mockClear();
        const r = await call(route);
        expect([route, r.status, (await r.json()).code]).toEqual([route, 503, 'rate_limit_unavailable']);
        expect(r.headers.get('x-ratelimit-mode')).toBe('degraded');
        expect(generate).not.toHaveBeenCalled();
      }
      const h = await health();
      expect(h.status).toBe(200);
      expect(h.headers.get('x-ratelimit-mode')).toBeNull();
      expect(Object.keys(await h.json()).sort()).toEqual(['status', 'time']);
      expect(logged()).toContain('rate_limit_degraded');
    });

    it('limits still apply per instance while degraded, and the header disappears after recovery', async () => {
      const { call } = await boot(await degrading(), { rateUserPerMin: 3 });
      await proxy.cut();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await call('/ai-food-parser', 'deg-user')).status);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      await proxy.restore();
      let hdr: string | null = 'degraded';
      for (let i = 0; i < 60 && hdr !== null; i++) {
        hdr = (await call('/ai-food-parser', `fresh-${i}`)).headers.get('x-ratelimit-mode');
        if (hdr !== null) await sleep(100);
      }
      expect(hdr).toBeNull();
    });

    it('the failed-authentication lockout keeps working per instance while degraded', async () => {
      const { srv } = await boot(await degrading(), { authFailMax: 2 });
      await proxy.cut();
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await fetch(`${srv.base}/api/ai-food-parser`, { method: 'POST' })).status);
      expect(codes).toEqual([401, 401, 429, 429]);
    });
  });
});

redisSuite('Startup runtime with Redis (prepareSecurityRuntime)', target, () => {
  it('connects, reports a credential-free summary, and hands back a working shared store', async () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis', REDIS_URL: urlViaProxy(target!, proxy) });
    const rt = await prepareSecurityRuntime(cfg, { readyTimeoutMs: 3000 });
    try {
      expect(rt.summary).toMatchObject({ rateStore: 'redis', rateFailurePolicy: 'closed' });
      expect((await rt.rateStore.hit(`user:rt-${Math.random()}`, 5000)).count).toBe(1);
      const out = logged();
      expect(out).toContain('security_runtime');
      expect(out).toContain('"distributed":true');
      if (target!.password) {
        expect(out).not.toContain(target!.password);
        expect(JSON.stringify(rt.summary)).not.toContain(target!.password);
      }
    } finally {
      await rt.close();
      await rt.close(); // idempotent
    }
  });

  it('degraded policy wraps the Redis store and says so', async () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'production', REDIS_URL: urlViaProxy(target!, proxy), RATE_LIMIT_FAILURE_POLICY: 'degraded' });
    const rt = await prepareSecurityRuntime(cfg, { readyTimeoutMs: 3000 });
    try {
      expect(rt.rateStore).toBeInstanceOf(DegradingRateStore);
      expect(rt.summary.rateFailurePolicy).toBe('degraded');
      expect(logged()).toContain('degraded mode');
    } finally {
      await rt.close();
    }
  });

  it('refuses to start when Redis is required but down at boot (also under the degraded policy)', async () => {
    await proxy.cut();
    for (const policy of ['closed', 'degraded']) {
      const url = urlViaProxy(target!, proxy);
      const cfg = loadSecurityConfig({ NODE_ENV: 'production', REDIS_URL: url, RATE_LIMIT_FAILURE_POLICY: policy });
      const err = await prepareSecurityRuntime(cfg, { readyTimeoutMs: 600 }).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/refusing to start/);
      expect(err?.message).not.toContain(url);
      if (target!.password) expect(err?.message + logged()).not.toContain(target!.password);
    }
  });
});

describe('Startup runtime without Redis', () => {
  it('refuses invalid configuration with setting names only', async () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://:topsecret@h:1', RATE_LIMIT_FAILURE_POLICY: 'sometimes', RATE_LIMIT_STORE: 'nope' });
    const err = await prepareSecurityRuntime(cfg).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(StartupConfigError);
    expect((err as Error).message).toMatch(/RATE_LIMIT_FAILURE_POLICY/);
    expect((err as Error).message).not.toContain('topsecret');
  });

  it('production without REDIS_URL refuses to start (no silent memory fallback)', async () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'production' });
    expect(cfg.rateStore).toBe('redis');
    await expect(prepareSecurityRuntime(cfg)).rejects.toBeInstanceOf(StartupConfigError);
  });

  it('createApp() itself will not run production-configured Redis limits on a memory store', () => {
    expect(() => createApp({ verifyToken: mockVerifier, config: { ...testConfig(), rateStore: 'redis' } })).toThrow(/no rate store was provided/);
  });

  it('explicit memory store works in production, with a loud warning that limits are not shared', async () => {
    const rt = await prepareSecurityRuntime(loadSecurityConfig({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'memory' }));
    expect(rt.summary.rateStore).toBe('memory');
    expect(logged()).toContain('not shared between instances');
    await rt.close();
  });
});
