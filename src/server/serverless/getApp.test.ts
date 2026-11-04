// @vitest-environment node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSecurityConfig } from '../security/config';
import type { RateHit } from '../security/rateLimit';
import { MemoryRateStore } from '../security/rateLimit';
import type { RedisRateStore } from '../security/redisRateStore';
import { requestContext } from '../security/requestContext';
import { QUOTA_ENV } from '../security/testUtils';
import { AppInitError, createAppProvider, INIT_FAILURE_MESSAGE, resolveRequestId, sendInitFailure, type AppProviderOptions } from './getApp';

const SECRET_PASSWORD = 'SUPERSECRETREDISPASSWORD123';
const SECRET_HOST = 'redis-secret-host.example.upstash.io';
const GEMINI_SECRET = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE123';
const REDIS_URL = `rediss://default:${SECRET_PASSWORD}@${SECRET_HOST}:6379`;

const prodEnv = (over: Record<string, string | undefined> = {}) => ({ NODE_ENV: 'production', REDIS_URL, GEMINI_API_KEY: GEMINI_SECRET, ...QUOTA_ENV, ...over });
const configFrom = (env: Record<string, string | undefined>) => () => loadSecurityConfig(env as NodeJS.ProcessEnv);

/** A stand-in for RedisRateStore: records lifecycle calls, never opens a socket. */
class FakeRedis {
  closeCalls = 0;
  hits = 0;
  constructor(
    readonly url: string,
    private readonly readyAfterMs: number | null
  ) {}
  get isReady() {
    return this.closeCalls === 0 && this.readyAfterMs !== null;
  }
  async waitUntilReady(): Promise<boolean> {
    if (this.readyAfterMs === null) return false;
    if (this.readyAfterMs > 0) await new Promise((r) => setTimeout(r, this.readyAfterMs!));
    return true;
  }
  async close() {
    this.closeCalls += 1;
  }
  async hit(): Promise<RateHit> {
    this.hits += 1;
    return { count: 1, resetAt: Date.now() + 60_000 };
  }
  async peek(): Promise<RateHit | undefined> {
    return undefined;
  }
}

function harness(readiness: Array<number | null> = [0], extra: Partial<AppProviderOptions> = {}, env = prodEnv()) {
  const created: FakeRedis[] = [];
  const clock = { t: 1_000_000 };
  let attempt = 0;
  const provider = createAppProvider({
    loadConfig: configFrom(env),
    redisFactory: (url) => {
      const mode = readiness[Math.min(attempt++, readiness.length - 1)];
      const store = new FakeRedis(url, mode);
      created.push(store);
      return store as unknown as RedisRateStore;
    },
    now: () => clock.t,
    readyTimeoutMs: 50,
    ...extra
  });
  return { provider, created, clock };
}

/** Everything the logger (console.*) wrote, as one string. */
function captureLogs() {
  const lines: string[] = [];
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(grab));
  return { text: () => lines.join('\n'), restore: () => spies.forEach((s) => s.mockRestore()) };
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  logs.restore();
});

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      })
  };
}

describe('getApp: successful cold start', () => {
  it('builds the real Express app once, with the Redis store the runtime prepared, and serves health', async () => {
    const { provider, created } = harness();
    const app = await provider.getApp();
    expect(created).toHaveLength(1);
    expect(created[0].url).toBe(REDIS_URL);

    const srv = await serve(app);
    try {
      const res = await fetch(`${srv.base}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', time: expect.any(String) });
      expect(created[0].hits).toBeGreaterThan(0); // the per-IP limiter really used the injected Redis store
    } finally {
      await srv.close();
    }
  });

  it('returns the same app on later calls without creating another Redis client', async () => {
    const { provider, created } = harness();
    const a = await provider.getApp();
    const b = await provider.getApp();
    expect(b).toBe(a);
    expect(created).toHaveLength(1);
  });

  it('passes the prepared rate store and loaded config to createApp unchanged', async () => {
    const buildApp = vi.fn(() => express());
    const { provider, created } = harness([0], { buildApp: buildApp as never });
    await provider.getApp();
    expect(buildApp).toHaveBeenCalledTimes(1);
    const deps = (buildApp.mock.calls[0] as unknown as [{ rateStore: unknown; config: { rateStore: string } }])[0];
    expect(deps.rateStore).toBe(created[0]);
    expect(deps.config.rateStore).toBe('redis');
  });
});

describe('getApp: concurrent cold starts (single flight)', () => {
  it('200 simultaneous cold requests create exactly one Redis client and one app', async () => {
    const buildApp = vi.fn(() => express());
    const { provider, created } = harness([40], { buildApp: buildApp as never });
    const apps = await Promise.all(Array.from({ length: 200 }, () => provider.getApp()));
    expect(created).toHaveLength(1);
    expect(buildApp).toHaveBeenCalledTimes(1);
    expect(new Set(apps).size).toBe(1);
  });

  it('concurrent requests during a failing init all fail together and create one client', async () => {
    const { provider, created } = harness([null]);
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => provider.getApp()));
    expect(created).toHaveLength(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(created[0].closeCalls).toBe(1);
  });
});

describe('getApp: Redis unavailable during initialisation', () => {
  it('rejects with a categorised AppInitError and closes the half-open client exactly once', async () => {
    const { provider, created } = harness([null]);
    const err = await provider.getApp().then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AppInitError);
    expect((err as AppInitError).reason).toBe('redis_unavailable');
    expect((err as AppInitError).retryAfterSec).toBe(5);
    expect(created).toHaveLength(1);
    expect(created[0].closeCalls).toBe(1); // prepareSecurityRuntime closed it; our clean-up must not close it again
  });

  it('closes the client exactly once when createApp throws after Redis became ready', async () => {
    const { provider, created } = harness([0], {
      buildApp: (() => {
        throw new Error(`boom ${SECRET_PASSWORD}`);
      }) as never
    });
    const err = (await provider.getApp().catch((e: unknown) => e)) as AppInitError;
    expect(err).toBeInstanceOf(AppInitError);
    expect(err.reason).toBe('init_error');
    expect(created[0].closeCalls).toBe(1);
  });

  it('closes the client when the runtime itself throws unexpectedly after creating it', async () => {
    const { provider, created } = harness([0], {
      prepareRuntime: (async (_c: unknown, o: { redisFactory: (u: string) => RedisRateStore }) => {
        o.redisFactory(REDIS_URL);
        throw new TypeError(`unexpected ${REDIS_URL}`);
      }) as never
    });
    const err = (await provider.getApp().catch((e: unknown) => e)) as AppInitError;
    expect(err.reason).toBe('redis_unavailable');
    expect(created[0].closeCalls).toBe(1);
  });
});

describe('getApp: recovery after a failed initialisation', () => {
  it('fails fast during the cooldown without touching Redis, then retries and recovers with no redeploy', async () => {
    const { provider, created, clock } = harness([null, 0]);

    await expect(provider.getApp()).rejects.toMatchObject({ reason: 'redis_unavailable' });
    expect(created).toHaveLength(1);

    // Inside the cooldown: immediate rejection, no new client, remaining time reported.
    clock.t += 2_000;
    const cooling = (await provider.getApp().catch((e: unknown) => e)) as AppInitError;
    expect(cooling).toBeInstanceOf(AppInitError);
    expect(cooling.reason).toBe('redis_unavailable');
    expect(cooling.retryAfterSec).toBe(3);
    expect(created).toHaveLength(1);

    // After the cooldown: a fresh attempt is made and succeeds.
    clock.t += 3_000;
    const app = await provider.getApp();
    expect(typeof app).toBe('function');
    expect(created).toHaveLength(2);
    expect(created[1].closeCalls).toBe(0);
    expect(await provider.getApp()).toBe(app);
    expect(created).toHaveLength(2);
  });

  it('does not cache the rejected promise: two failures in a row each trigger a fresh attempt, then success', async () => {
    const { provider, created, clock } = harness([null, null, 0]);
    await expect(provider.getApp()).rejects.toBeInstanceOf(AppInitError);
    clock.t += 5_000;
    await expect(provider.getApp()).rejects.toBeInstanceOf(AppInitError);
    clock.t += 5_000;
    await expect(provider.getApp()).resolves.toBeTypeOf('function');
    expect(created).toHaveLength(3);
    expect(created.map((c) => c.closeCalls)).toEqual([1, 1, 0]);
  });

  it('recovers from an invalid configuration once the environment is fixed', async () => {
    const env = prodEnv({ REDIS_URL: undefined });
    const { provider, created, clock } = harness([0], {}, env);
    await expect(provider.getApp()).rejects.toMatchObject({ reason: 'invalid_configuration' });
    expect(created).toHaveLength(0);
    env.REDIS_URL = REDIS_URL; // the loader reads the same object on the next attempt
    clock.t += 5_000;
    await expect(provider.getApp()).resolves.toBeTypeOf('function');
  });
});

describe('getApp: invalid configuration', () => {
  it('rejects with invalid_configuration, never connects, and logs setting NAMES only', async () => {
    const env = prodEnv({ REDIS_URL: undefined, RATE_LIMIT_FAILURE_POLICY: 'whatever' });
    const { provider, created } = harness([0], {}, env);
    await expect(provider.getApp()).rejects.toMatchObject({ reason: 'invalid_configuration', retryAfterSec: 5 });
    expect(created).toHaveLength(0);
    const text = logs.text();
    expect(text).toContain('serverless_init_failed');
    expect(text).toContain('RATE_LIMIT_FAILURE_POLICY');
    expect(text).not.toContain(GEMINI_SECRET);
    expect(text).not.toContain(SECRET_PASSWORD);
  });
});

describe('getApp: never a memory rate store', () => {
  it.each([
    ['non-production default (NODE_ENV=test)', { NODE_ENV: 'test' }, 'memory_rate_store_not_allowed'],
    ['explicit RATE_LIMIT_STORE=memory in production', { RATE_LIMIT_STORE: 'memory' }, 'memory_rate_store_not_allowed'],
    ['RATE_LIMIT_FAILURE_POLICY=degraded (per-instance fallback counters)', { RATE_LIMIT_FAILURE_POLICY: 'degraded' }, 'degraded_rate_policy_not_allowed']
  ] as const)('refuses %s before anything connects or builds', async (_name, over, reason) => {
    const buildApp = vi.fn(() => express());
    const prepareRuntime = vi.fn();
    const { provider, created } = harness([0], { buildApp: buildApp as never, prepareRuntime: prepareRuntime as never }, prodEnv(over));
    await expect(provider.getApp()).rejects.toMatchObject({ reason });
    expect(created).toHaveLength(0);
    expect(prepareRuntime).not.toHaveBeenCalled();
    expect(buildApp).not.toHaveBeenCalled();
  });

  it('serves a Redis-backed app only: the store handed to createApp is the Redis client, never MemoryRateStore', async () => {
    const buildApp = vi.fn(() => express());
    const { provider, created } = harness([0], { buildApp: buildApp as never });
    await provider.getApp();
    const deps = (buildApp.mock.calls[0] as unknown as [{ rateStore: unknown }])[0];
    expect(deps.rateStore).not.toBeInstanceOf(MemoryRateStore);
    expect(deps.rateStore).toBe(created[0]);
  });

  it('a Redis outage never degrades to memory: the app is not built', async () => {
    const buildApp = vi.fn(() => express());
    const { provider } = harness([null], { buildApp: buildApp as never });
    await expect(provider.getApp()).rejects.toBeInstanceOf(AppInitError);
    expect(buildApp).not.toHaveBeenCalled();
  });
});

describe('getApp: controlled 503 response and no secret leakage', () => {
  it('returns the fixed JSON envelope with Retry-After, request id and no detail', async () => {
    const { provider } = harness([null]);
    const srv = await serve(async (req, res) => {
      try {
        (await provider.getApp())(req, res);
      } catch (e) {
        sendInitFailure(req, res, e);
      }
    });
    try {
      const res = await fetch(`${srv.base}/api/anything`, { headers: { 'X-Request-Id': 'client-req-12345' } });
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-request-id')).toBe('client-req-12345');
      expect(await res.json()).toEqual({ success: false, error: INIT_FAILURE_MESSAGE, code: 'service_unavailable', requestId: 'client-req-12345' });
    } finally {
      await srv.close();
    }
  });

  it('generates a request id when none or an unsafe one is supplied', async () => {
    const { provider } = harness([null]);
    const srv = await serve(async (req, res) => {
      try {
        (await provider.getApp())(req, res);
      } catch (e) {
        sendInitFailure(req, res, e);
      }
    });
    try {
      const none = await fetch(`${srv.base}/x`);
      const bad = await fetch(`${srv.base}/x`, { headers: { 'X-Request-Id': 'bad id with spaces!' } });
      for (const r of [none, bad]) {
        const id = r.headers.get('x-request-id')!;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect((await r.json()).requestId).toBe(id);
      }
    } finally {
      await srv.close();
    }
  });

  it('leaks no credential, host, URL, stack or error text in the response or the logs', async () => {
    const failures: Array<AppProviderOptions & { name: string }> = [
      { name: 'redis unreachable', redisFactory: () => new FakeRedis(REDIS_URL, null) as unknown as RedisRateStore },
      {
        name: 'createApp throws with secrets in its message',
        buildApp: (() => {
          throw new Error(`failed ${REDIS_URL} key=${GEMINI_SECRET} Bearer abc.def.ghi`);
        }) as never
      },
      {
        name: 'client factory throws with the url',
        redisFactory: () => {
          throw new Error(`cannot connect to ${REDIS_URL}`);
        }
      }
    ];
    for (const f of failures) {
      const provider = createAppProvider({ loadConfig: configFrom(prodEnv()), readyTimeoutMs: 20, ...f });
      const srv = await serve(async (req, res) => {
        try {
          (await provider.getApp())(req, res);
        } catch (e) {
          sendInitFailure(req, res, e);
        }
      });
      try {
        const res = await fetch(`${srv.base}/api/health`);
        const body = await res.text();
        const response = body + JSON.stringify([...res.headers.entries()]);
        expect(res.status, f.name).toBe(503);
        // The caller sees nothing about the deployment: no credential, no host, no URL, no stack.
        for (const secret of [SECRET_PASSWORD, SECRET_HOST, GEMINI_SECRET, 'rediss://', 'Bearer abc', 'at Object', 'node_modules']) {
          expect(response, `${f.name}: response contains ${secret}`).not.toContain(secret);
        }
        // Logs may name the redacted target (existing, intentional: `rediss://***@host:port`) but never a credential,
        // an API key, a bearer token, the unredacted URL or a stack trace.
        for (const secret of [SECRET_PASSWORD, GEMINI_SECRET, `default:${SECRET_PASSWORD}`, 'Bearer abc', 'at Object', 'node_modules']) {
          expect(logs.text(), `${f.name}: logs contain ${secret}`).not.toContain(secret);
        }
      } finally {
        await srv.close();
      }
    }
  });

  it('sendInitFailure with an unexpected error type is still a controlled 503', async () => {
    const srv = await serve((req, res) => sendInitFailure(req, res, new Error(`secret ${SECRET_PASSWORD}`)));
    try {
      const res = await fetch(`${srv.base}/api/health`);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(await res.text()).not.toContain(SECRET_PASSWORD);
      expect(logs.text()).not.toContain(SECRET_PASSWORD);
    } finally {
      await srv.close();
    }
  });

  it('HEAD gets the same status and headers with no body', async () => {
    const srv = await serve((req, res) => sendInitFailure(req, res, new AppInitError('redis_unavailable', 5)));
    try {
      const res = await fetch(`${srv.base}/api/health`, { method: 'HEAD' });
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(await res.text()).toBe('');
    } finally {
      await srv.close();
    }
  });
});

describe('health through the init layer', () => {
  it('is 503 (never a false 200) while initialisation fails, and 200 with the unchanged contract after recovery', async () => {
    const { provider, clock } = harness([null, 0]);
    const srv = await serve(async (req, res) => {
      try {
        (await provider.getApp())(req, res);
      } catch (e) {
        sendInitFailure(req, res, e);
      }
    });
    try {
      const down = await fetch(`${srv.base}/api/health`);
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({ success: false, code: 'service_unavailable' });

      clock.t += 5_000;
      const up = await fetch(`${srv.base}/api/health`);
      expect(up.status).toBe(200);
      expect(await up.json()).toEqual({ status: 'ok', time: expect.any(String) });
    } finally {
      await srv.close();
    }
  });
});

describe('request id parity with the app middleware', () => {
  it.each([
    ['abcdefgh'],
    ['a'.repeat(64)],
    ['a'.repeat(65)],
    ['short'],
    ['has space in it'],
    ['ok.id_with-chars.123'],
    ['semi;colon;inject'],
    ['']
  ])('accepts/rejects %j exactly as requestContext does', async (inbound) => {
    const app = express();
    app.use(requestContext);
    app.get('/', (req, res) => void res.json({ id: req.requestId }));
    const srv = await serve(app);
    try {
      const res = await fetch(srv.base, { headers: inbound ? { 'X-Request-Id': inbound } : {} });
      const appId = (await res.json()).id as string;
      const mine = resolveRequestId(inbound || undefined);
      // Either both echo the inbound value, or both generated a fresh uuid.
      expect(appId === inbound).toBe(mine === inbound);
    } finally {
      await srv.close();
    }
  });
});

describe('serverless module hygiene', () => {
  const ROOT = path.resolve(import.meta.dirname, '../../..');
  const FILE = path.join(ROOT, 'src/server/serverless/getApp.ts');

  it('has no process control, listener or timer of its own', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/process\.(exit|on|once)\s*\(/);
    expect(src).not.toMatch(/\.listen\s*\(/);
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src).not.toMatch(/from ['"](vite|dotenv)['"]|from ['"]\.\.\/\.\.\/\.\.\/server['"]/);
  });

  it('importing it in a fresh Node process with no environment has no effect: it exits by itself, no handlers, no connection attempt', async () => {
    const script = [
      `const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT'), process.listenerCount('exit')];`,
      `const m = await import(${JSON.stringify(FILE)});`,
      `const after = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT'), process.listenerCount('exit')];`,
      `console.log('RESULT ' + JSON.stringify({ ok: typeof m.getApp === 'function' && typeof m.createAppProvider === 'function', same: JSON.stringify(before) === JSON.stringify(after) }));`
    ].join('\n');
    const child = spawn(path.join(ROOT, 'node_modules/.bin/tsx'), ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const outcome = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ code: null, timedOut: true });
      }, 25_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut: false });
      });
    });
    expect({ timedOut: outcome.timedOut, code: outcome.code, stderr }).toEqual({ timedOut: false, code: 0, stderr: '' });
    expect(JSON.parse(stdout.split('\n').find((l) => l.startsWith('RESULT '))!.slice(7))).toEqual({ ok: true, same: true });
  }, 40_000);
});
