// @vitest-environment node
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from './errors';
import { createRateLimiter, DegradingRateStore, MemoryRateStore, RateStoreUnavailableError } from './rateLimit';
import { buildRedisKey, RedisRateStore } from './redisRateStore';
import { acquireRedis, redisSuite, TcpProxy, urlViaProxy, type RedisTarget } from './redisTestHarness';

const target: RedisTarget | null = await acquireRedis();
const prefix = `t${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proxy: TcpProxy;
const stores: RedisRateStore[] = [];
let logs: ReturnType<typeof vi.spyOn>[] = [];
const logged = () => logs.flatMap((s) => (s.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');

/** A store talking to Redis through the controllable proxy. */
function makeStore(over: Partial<ConstructorParameters<typeof RedisRateStore>[0]> = {}) {
  const s = new RedisRateStore({ url: urlViaProxy(target!, proxy), keyPrefix: prefix, commandTimeoutMs: 400, logEveryMs: 0, ...over });
  stores.push(s);
  return s;
}
async function ready(s: RedisRateStore) {
  expect(await s.waitUntilReady(3000)).toBe(true);
  return s;
}
async function eventually<T>(fn: () => Promise<T>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() > end) throw e;
      await sleep(100);
    }
  }
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
  logs = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})];
});
afterEach(async () => {
  logs.forEach((l) => l.mockRestore());
  await proxy?.restore();
  proxy?.unstall();
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

async function appWith(store: ConstructorParameters<typeof Object>[0], max: number, windowMs = 60_000) {
  const app = express();
  app.set('trust proxy', true);
  app.use(createRateLimiter({ name: 'test', windowMs, max, key: (req) => String(req.get('x-id') ?? 'anon'), store: store as any }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

redisSuite('RedisRateStore against a real Redis', target, () => {
  describe('basic consumption', () => {
    it('counts hits, returns a reset time inside the window', async () => {
      const s = await ready(makeStore());
      const k = `user:${Math.random()}`;
      const t0 = Date.now();
      const a = await s.hit(k, 5000);
      const b = await s.hit(k, 5000);
      expect([a.count, b.count]).toEqual([1, 2]);
      expect(a.degraded).toBeUndefined();
      expect(b.resetAt).toBeGreaterThan(t0);
      expect(b.resetAt).toBeLessThanOrEqual(t0 + 5000 + 250);
      expect((await s.peek(k))?.count).toBe(2);
      expect(await s.peek(`user:never-${Math.random()}`)).toBeUndefined();
    });

    it('rejects out-of-range windows without touching Redis', async () => {
      const s = await ready(makeStore());
      await expect(s.hit('k', 0)).rejects.toBeInstanceOf(RangeError);
      await expect(s.hit('k', 1.5)).rejects.toBeInstanceOf(RangeError);
      await expect(s.hit('k', 25 * 60 * 60 * 1000)).rejects.toBeInstanceOf(RangeError);
    });
  });

  describe('limit boundary through the real limiter middleware', () => {
    it('allows exactly `max` requests, then 429s with Retry-After, and keeps rejecting', async () => {
      const store = await ready(makeStore());
      const app = await appWith(store, 3);
      try {
        const id = `b-${Math.random()}`;
        const codes: number[] = [];
        let last: Response | undefined;
        for (let i = 0; i < 6; i++) {
          last = await fetch(`${app.base}/x`, { headers: { 'x-id': id } });
          codes.push(last.status);
        }
        expect(codes).toEqual([200, 200, 200, 429, 429, 429]);
        expect(Number(last!.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        expect(last!.headers.get('ratelimit-remaining')).toBe('0');
        expect((await last!.json()).code).toBe('rate_limited');
      } finally {
        await app.close();
      }
    });
  });

  describe('key isolation', () => {
    it('keeps users, IPs and limiter names separate', async () => {
      const s = await ready(makeStore());
      const r = Math.random();
      await s.hit(`user:alice-${r}`, 5000);
      await s.hit(`user:alice-${r}`, 5000);
      expect((await s.hit(`user:bob-${r}`, 5000)).count).toBe(1);
      expect((await s.hit(`ip:10.0.0.1-${r}`, 5000)).count).toBe(1);
      expect((await s.hit(`ip:10.0.0.2-${r}`, 5000)).count).toBe(1);
      expect((await s.hit(`endpoint:alice-${r}`, 5000)).count).toBe(1);
      expect((await s.peek(`user:alice-${r}`))?.count).toBe(2);
    });

    it('hostile key material cannot collide, inject or inflate the key', async () => {
      const keys = ['user:a', 'user:a\n', 'user:a:b', 'user:*', 'user:a b', 'user:' + 'x'.repeat(1_000_000), 'user:é', 'ip:a'];
      const built = keys.map((k) => buildRedisKey(prefix, k));
      expect(new Set(built).size).toBe(keys.length);
      for (const b of built) {
        expect(b.length).toBeLessThan(100);
        expect(b).toMatch(/^[A-Za-z0-9_.:-]+$/);
      }
      const s = await ready(makeStore());
      for (const k of keys) expect((await s.hit(k + Math.random(), 5000)).count).toBe(1);
    });

    it('two different key prefixes never share counters', async () => {
      const a = await ready(makeStore({ keyPrefix: `${prefix}a` }));
      const b = await ready(makeStore({ keyPrefix: `${prefix}b` }));
      await a.hit('user:same', 5000);
      expect((await b.hit('user:same', 5000)).count).toBe(1);
    });
  });

  describe('expiry and reset', () => {
    it('resets the count after the window and always leaves a TTL on the key', async () => {
      const s = await ready(makeStore());
      const k = `user:exp-${Math.random()}`;
      expect((await s.hit(k, 300)).count).toBe(1);
      expect((await s.hit(k, 300)).count).toBe(2);
      const raw = createClient({ url: target!.url });
      await raw.connect();
      try {
        const ttl = await raw.pTTL(buildRedisKey(prefix, k));
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(300);
        await sleep(400);
        expect(await raw.exists(buildRedisKey(prefix, k))).toBe(0);
        expect(await s.peek(k)).toBeUndefined();
        expect((await s.hit(k, 300)).count).toBe(1);
      } finally {
        await raw.quit();
      }
    });

    it('does not extend the window on later hits (fixed window)', async () => {
      const s = await ready(makeStore());
      const k = `user:fixed-${Math.random()}`;
      const first = await s.hit(k, 600);
      await sleep(300);
      const second = await s.hit(k, 600);
      expect(second.resetAt - first.resetAt).toBeLessThan(120);
    });

    it('repairs a key that somehow has no TTL (it can never become permanent)', async () => {
      const s = await ready(makeStore());
      const k = `user:nottl-${Math.random()}`;
      const raw = createClient({ url: target!.url });
      await raw.connect();
      try {
        await raw.set(buildRedisKey(prefix, k), '7'); // simulates a crash between INCR and EXPIRE in a non-atomic design
        expect(await raw.pTTL(buildRedisKey(prefix, k))).toBe(-1);
        const h = await s.hit(k, 2000);
        expect(h.count).toBe(8);
        expect(await raw.pTTL(buildRedisKey(prefix, k))).toBeGreaterThan(0);
      } finally {
        await raw.quit();
      }
    });
  });

  describe('atomicity and sharing', () => {
    it('200 parallel hits on one key yield exactly the counts 1..200', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 5000 }));
      const k = `user:par-${Math.random()}`;
      const res = await Promise.all(Array.from({ length: 200 }, () => s.hit(k, 10_000)));
      const counts = res.map((r) => r.count).sort((a, b) => a - b);
      expect(counts).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
      expect((await s.peek(k))?.count).toBe(200);
    });

    it('two independent clients ("instances") share one counter with no lost or duplicate increments', async () => {
      const a = await ready(makeStore({ commandTimeoutMs: 5000 }));
      const b = await ready(makeStore({ commandTimeoutMs: 5000 }));
      const k = `user:multi-${Math.random()}`;
      const res = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).hit(k, 10_000)));
      expect(res.map((r) => r.count).sort((x, y) => x - y)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    });

    it('exactly `max` of N concurrent requests pass the limiter across two instances', async () => {
      const a = await ready(makeStore({ commandTimeoutMs: 5000 }));
      const b = await ready(makeStore({ commandTimeoutMs: 5000 }));
      const [appA, appB] = [await appWith(a, 10), await appWith(b, 10)];
      try {
        const id = `c-${Math.random()}`;
        const codes = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${(i % 2 ? appA : appB).base}/x`, { headers: { 'x-id': id } }).then((r) => r.status)));
        expect(codes.filter((c) => c === 200)).toHaveLength(10);
        expect(codes.filter((c) => c === 429)).toHaveLength(30);
      } finally {
        await Promise.all([appA.close(), appB.close()]);
      }
    });
  });

  describe('failure, timeout and reconnection', () => {
    it('connection loss -> RateStoreUnavailableError quickly (no hang, no queueing), with no secret in logs', async () => {
      const s = await ready(makeStore());
      expect((await s.hit('user:f1', 5000)).count).toBeGreaterThan(0);
      await proxy.cut();
      const t0 = Date.now();
      await expect(s.hit('user:f1', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      expect(Date.now() - t0).toBeLessThan(1500);
      await expect(s.peek('user:f1')).rejects.toBeInstanceOf(RateStoreUnavailableError);
      expect(await s.ping()).toBe(false);
      const out = logged();
      expect(out).toContain('rate_store_unavailable');
      if (target!.password) expect(out).not.toContain(target!.password);
      expect(out).not.toContain('AUTH');
    });

    it('a stalled Redis -> command timeout within the configured bound', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 250 }));
      proxy.stall();
      const t0 = Date.now();
      await expect(s.hit('user:slow', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(200);
      expect(took).toBeLessThan(1200);
      expect(logged()).toContain('COMMAND_TIMEOUT');
      proxy.unstall();
    });

    it('reconnects by itself after an outage, keeps data stored in Redis, and logs recovery', async () => {
      const s = await ready(makeStore());
      const k = `user:rec-${Math.random()}`;
      await s.hit(k, 60_000);
      await s.hit(k, 60_000);
      await proxy.cut();
      await expect(s.hit(k, 60_000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      await proxy.restore();
      const h = await eventually(() => s.hit(k, 60_000));
      expect(h.count).toBe(3); // counters survived: Redis itself never restarted
      expect(logged()).toContain('rate_store_recovered');
      expect(s.isReady).toBe(true);
    });

    it('an unreachable Redis at construction never throws from the constructor and never crashes the process', async () => {
      const dead = new RedisRateStore({ url: 'redis://127.0.0.1:1', keyPrefix: prefix, connectTimeoutMs: 200, logEveryMs: 0 });
      stores.push(dead);
      await expect(dead.hit('user:x', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      expect(await dead.waitUntilReady(400)).toBe(false);
    });
  });

  describe('serverless connection lifecycle (Stage 3.4)', () => {
    it('a silently stalled connection is recycled after consecutive timeouts, then serves again without a restart', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 150, recycleAfterTimeouts: 3, pingIntervalMs: 0 }));
      const k = `user:stale-${Math.random()}`;
      await s.hit(k, 60_000);
      proxy.stall(); // sockets stay open, nothing answers: the client still believes it is ready
      for (let i = 0; i < 3; i++) await expect(s.hit(k, 60_000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      expect(logged()).toContain('rate_store_recycling_connection');
      proxy.unstall();
      const h = await eventually(() => s.hit(k, 60_000), 5000);
      // Same Redis data, only the connection was replaced. unstall() flushes the held INCRs, so the count may be higher.
      expect(h.count).toBeGreaterThanOrEqual(2);
    });

    it('stays failed-closed on every request while the connection is stalled (no memory fallback, no hang)', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 120, recycleAfterTimeouts: 0, pingIntervalMs: 0 }));
      proxy.stall();
      for (let i = 0; i < 6; i++) {
        const t0 = Date.now();
        await expect(s.hit('user:fc', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
        expect(Date.now() - t0).toBeLessThan(1000);
      }
      expect(s).not.toBeInstanceOf(MemoryRateStore);
      expect(logged()).not.toContain('rate_store_recycling_connection'); // 0 disables recycling
      proxy.unstall();
    });

    it('a successful command resets the timeout run, so scattered timeouts never trigger a recycle', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 120, recycleAfterTimeouts: 3, pingIntervalMs: 0 }));
      for (let round = 0; round < 3; round++) {
        proxy.stall();
        await expect(s.hit('user:r', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
        await expect(s.hit('user:r', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
        proxy.unstall();
        await eventually(() => s.hit('user:r', 5000), 3000);
      }
      expect(logged()).not.toContain('rate_store_recycling_connection');
    });

    it('a retired client cannot crash or confuse the live one (repeated recycles, one live connection)', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 100, recycleAfterTimeouts: 1, pingIntervalMs: 0 }));
      for (let i = 0; i < 3; i++) {
        proxy.stall();
        await expect(s.hit('user:cyc', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
        proxy.unstall();
        await eventually(() => s.hit('user:cyc', 5000), 5000);
      }
      expect(s.isReady).toBe(true);
    });

    it('a close() after a recycle releases the live client and stays closed (no resurrection)', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 100, recycleAfterTimeouts: 1, pingIntervalMs: 0 }));
      proxy.stall();
      await expect(s.hit('user:cl', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      proxy.unstall();
      await eventually(() => s.hit('user:cl', 5000), 5000);
      await s.close();
      expect(s.isReady).toBe(false);
      await expect(s.hit('user:cl', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
    });

    it('idle PINGs keep running on a healthy connection and do not disturb it', async () => {
      const s = await ready(makeStore({ pingIntervalMs: 50 }));
      await sleep(400);
      expect(s.isReady).toBe(true);
      expect((await s.hit(`user:idle-${Math.random()}`, 5000)).count).toBe(1);
      expect(logged()).not.toContain('rate_store_unavailable');
    });

    it('an idle connection cut by the network is re-established without any request, and the next request succeeds', async () => {
      const s = await ready(makeStore({ pingIntervalMs: 50 }));
      await proxy.cut();
      await eventually(async () => {
        if (s.isReady) throw new Error('still believes it is ready');
      }, 3000);
      await proxy.restore();
      expect(await s.waitUntilReady(5000)).toBe(true);
      expect((await s.hit(`user:cut-${Math.random()}`, 5000)).count).toBe(1);
    });

    it('readiness: not ready before connect completes against a dead target, ready only once connected', async () => {
      const dead = new RedisRateStore({ url: 'redis://127.0.0.1:1', keyPrefix: prefix, connectTimeoutMs: 100, logEveryMs: 0 });
      stores.push(dead);
      expect(dead.isReady).toBe(false);
      expect(await dead.waitUntilReady(300)).toBe(false);
      const live = makeStore();
      expect(await live.waitUntilReady(3000)).toBe(true);
      expect(live.isReady).toBe(true);
    });

    it('rejects invalid lifecycle options at construction', () => {
      expect(() => new RedisRateStore({ url: 'redis://127.0.0.1:1', pingIntervalMs: -1 })).toThrow(RangeError);
      expect(() => new RedisRateStore({ url: 'redis://127.0.0.1:1', pingIntervalMs: 1.5 })).toThrow(RangeError);
      expect(() => new RedisRateStore({ url: 'redis://127.0.0.1:1', recycleAfterTimeouts: -2 })).toThrow(RangeError);
    });

    it('no secret reaches the logs during stall, recycle and recovery', async () => {
      const s = await ready(makeStore({ commandTimeoutMs: 100, recycleAfterTimeouts: 2, pingIntervalMs: 0 }));
      proxy.stall();
      for (let i = 0; i < 2; i++) await expect(s.hit('user:sec', 5000)).rejects.toBeInstanceOf(RateStoreUnavailableError);
      proxy.unstall();
      await eventually(() => s.hit('user:sec', 5000), 5000);
      const out = logged();
      if (target!.password) expect(out).not.toContain(target!.password);
      expect(out).not.toContain('AUTH');
    });
  });

  describe('DegradingRateStore over real Redis', () => {
    it('uses Redis while healthy, per-instance counts while down (flagged), and returns to Redis on recovery', async () => {
      const redis = await ready(makeStore());
      const store = new DegradingRateStore(redis, new MemoryRateStore(), Date.now, 0);
      const k = `user:deg-${Math.random()}`;
      const h1 = await store.hit(k, 60_000);
      expect(h1).toMatchObject({ count: 1 });
      expect(h1.degraded).toBeUndefined();

      await proxy.cut();
      const h2 = await store.hit(k, 60_000);
      const h3 = await store.hit(k, 60_000);
      expect([h2.count, h3.count]).toEqual([1, 2]); // per-instance, NOT continuing Redis' count
      expect(h2.degraded).toBe(true);
      expect(logged()).toContain('rate_limit_degraded');

      await proxy.restore();
      const back = await eventually(async () => {
        const h = await store.hit(k, 60_000);
        if (h.degraded) throw new Error('still degraded');
        return h;
      });
      expect(back.count).toBe(2); // Redis' own counter resumes
    });
  });
});
