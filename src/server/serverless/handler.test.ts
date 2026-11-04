// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { loadSecurityConfig } from '../security/config';
import { MemoryQuotaStore } from '../security/quota';
import type { RateHit } from '../security/rateLimit';
import type { RedisRateStore } from '../security/redisRateStore';
import { fakeToken, mockVerifier, QUOTA_ENV } from '../security/testUtils';
import { AppInitError, createAppProvider, INIT_FAILURE_MESSAGE } from './getApp';
import { createHandler } from './handler';
import { RESERVED_REWRITE_PARAM as R } from './normalizeUrl';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SECRET = 'SUPERSECRETREDISPASSWORD123';
const REDIS_URL = `rediss://default:${SECRET}@redis-secret-host.example.upstash.io:6379`;

class FakeRedis {
  closeCalls = 0;
  hits = 0;
  get isReady() {
    return this.closeCalls === 0;
  }
  async waitUntilReady() {
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

const prodEnv = { NODE_ENV: 'production', REDIS_URL, GEMINI_API_KEY: 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE123', ...QUOTA_ENV };

/** The REAL createApp, with only the external edges faked: Redis, Supabase token verification and the quota RPC. */
function realAppProvider() {
  const redis = new FakeRedis();
  const provider = createAppProvider({
    loadConfig: () => loadSecurityConfig(prodEnv as NodeJS.ProcessEnv),
    redisFactory: () => redis as unknown as RedisRateStore,
    buildApp: (deps) => createApp({ ...deps, verifyToken: mockVerifier, quotaStore: new MemoryQuotaStore() }),
    readyTimeoutMs: 50
  });
  return { provider, redis };
}

async function serve(listener: http.RequestListener) {
  const server = http.createServer(listener);
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

let logSpies: ReturnType<typeof vi.spyOn>[] = [];
const logged = () => logSpies.flatMap((s) => (s.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');
beforeEach(() => {
  logSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => logSpies.forEach((s) => s.mockRestore()));

const ROUTES: Array<[string, string]> = [
  ['GET', '/api/health'],
  ['POST', '/api/extract-plan'],
  ['POST', '/api/generate-plan'],
  ['POST', '/api/exercise-coach'],
  ['POST', '/api/generate-ai-routine'],
  ['GET', '/api/nutrition/barcode/5449000000996'],
  ['POST', '/api/ai-food-parser'],
  ['POST', '/api/ai-workout-insights'],
  ['POST', '/api/ai-plan-overload-tuning'],
  ['POST', '/api/ai-nutrition-coach'],
  ['POST', '/api/ai-recovery-insights'],
  ['POST', '/api/ai-personal-trainer'],
  ['POST', '/api/adaptive-coach/explain'],
  ['POST', '/api/ai-form-analyzer'],
  ['POST', '/api/ai-warmup-generator'],
  ['POST', '/api/ai-generate-physique'],
  ['POST', '/api/ai-physique-analysis']
];

describe('real handler over the real Express app (fake Redis / token verifier / quota only)', () => {
  it('health stays public and keeps its contract, with and without the injected rewrite parameter', async () => {
    const { provider, redis } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    try {
      for (const url of ['/api/health', `/api/health?${R}=health`]) {
        const res = await fetch(`${srv.base}${url}`);
        expect(res.status, url).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok', time: expect.any(String) });
        expect(res.headers.get('x-request-id')).toBeTruthy();
        expect(res.headers.get('x-content-type-options')).toBe('nosniff'); // helmet ran
      }
      expect(redis.hits).toBeGreaterThan(0); // the per-IP limiter used the Redis store
    } finally {
      await srv.close();
    }
  });

  it('every route other than health still requires authentication (401, also with the rewrite parameter and for unknown paths)', async () => {
    const { provider } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    try {
      expect(ROUTES).toHaveLength(17);
      for (const [method, p] of ROUTES.filter(([, u]) => u !== '/api/health')) {
        const res = await fetch(`${srv.base}${p}?${R}=x`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined });
        expect(res.status, `${method} ${p}`).toBe(401);
      }
      for (const p of ['/api', '/api/', '/api/does-not-exist', '/api/__anything']) expect((await fetch(`${srv.base}${p}?${R}=x`)).status, p).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it('an authenticated request reaches the route and its body/method are untouched', async () => {
    const { provider } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    const auth = { authorization: `Bearer ${fakeToken()}` };
    try {
      // Route handler's own validation answers (no network): proves auth -> policy -> body parse -> route all ran.
      const bad = await fetch(`${srv.base}/api/nutrition/barcode/abc?${R}=nutrition%2Fbarcode%2Fabc`, { headers: auth });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ success: false, found: false });

      const post = await fetch(`${srv.base}/api/adaptive-coach/explain?${R}=adaptive-coach%2Fexplain`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ context: { not: 'valid' } })
      });
      expect(post.status).toBe(400);
      expect(await post.json()).toMatchObject({ success: false, code: 'invalid_request' });
    } finally {
      await srv.close();
    }
  });

  it('a wrong HTTP method on a known path is still refused by the existing pipeline (no route is created by the rewrite)', async () => {
    const { provider } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    try {
      const res = await fetch(`${srv.base}/api/health`, { method: 'POST' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    } finally {
      await srv.close();
    }
  });

  it('serves 200 concurrent cold requests from one initialisation', async () => {
    const { provider } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    try {
      const results = await Promise.all(Array.from({ length: 200 }, () => fetch(`${srv.base}/api/health`).then((r) => r.status)));
      expect(new Set(results)).toEqual(new Set([200]));
    } finally {
      await srv.close();
    }
  });
});

describe('what Express receives', () => {
  async function probeApp() {
    const app = express();
    app.all('*', (req, res) => res.json({ url: req.url, originalUrl: req.originalUrl, query: req.query, method: req.method, body: req.body ?? null }));
    return app;
  }

  it('normalises req.url before delegating; client `path` and other parameters are preserved', async () => {
    const app = await probeApp();
    const srv = await serve(createHandler(async () => app));
    try {
      const res = await fetch(`${srv.base}/api/x?path=client&${R}=x%2Fy&tag=a&tag=b`);
      const json = await res.json();
      expect(json.originalUrl).toBe('/api/x?path=client&tag=a&tag=b');
      expect(json.query).toEqual({ path: 'client', tag: ['a', 'b'] });
      expect(JSON.stringify(json)).not.toContain(R);
    } finally {
      await srv.close();
    }
  });

  it('passes the method and the request body through unchanged', async () => {
    const app = express();
    app.use(express.json());
    app.post('*', (req, res) => res.json({ method: req.method, body: req.body, url: req.originalUrl }));
    const srv = await serve(createHandler(async () => app));
    try {
      const res = await fetch(`${srv.base}/api/x?${R}=x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1, nested: { b: [1, 2] } }) });
      expect(await res.json()).toEqual({ method: 'POST', body: { a: 1, nested: { b: [1, 2] } }, url: '/api/x' });
    } finally {
      await srv.close();
    }
  });
});

describe('initialisation failure through the handler', () => {
  it('answers with the controlled JSON 503 and never reaches Express; recovers after the cooldown', async () => {
    let attempt = 0;
    const reached = vi.fn();
    const app = express();
    app.use((_req, res) => {
      reached();
      res.json({ ok: true });
    });
    const getApp = async () => {
      if (attempt++ === 0) throw new AppInitError('redis_unavailable', 5);
      return app;
    };
    const srv = await serve(createHandler(getApp));
    try {
      const down = await fetch(`${srv.base}/api/health`, { headers: { 'x-request-id': 'client-req-12345' } });
      expect(down.status).toBe(503);
      expect(down.headers.get('retry-after')).toBe('5');
      expect(down.headers.get('x-request-id')).toBe('client-req-12345');
      expect(await down.json()).toEqual({ success: false, error: INIT_FAILURE_MESSAGE, code: 'service_unavailable', requestId: 'client-req-12345' });
      expect(reached).not.toHaveBeenCalled();

      const up = await fetch(`${srv.base}/api/health`);
      expect(up.status).toBe(200);
      expect(reached).toHaveBeenCalledTimes(1);
    } finally {
      await srv.close();
    }
  });

  it('with real Redis unreachable (fake that never becomes ready) health is 503, never a false 200, and nothing leaks', async () => {
    const dead = { closeCalls: 0, isReady: false, waitUntilReady: async () => false, close: async function (this: { closeCalls: number }) { this.closeCalls += 1; }, hit: async () => { throw new Error('x'); }, peek: async () => undefined };
    const provider = createAppProvider({ loadConfig: () => loadSecurityConfig(prodEnv as NodeJS.ProcessEnv), redisFactory: () => dead as unknown as RedisRateStore, readyTimeoutMs: 20 });
    const srv = await serve(createHandler(provider.getApp));
    try {
      const res = await fetch(`${srv.base}/api/health`);
      const text = await res.text();
      expect(res.status).toBe(503);
      // The caller sees nothing about the deployment.
      for (const s of [SECRET, 'redis-secret-host', 'rediss://', 'at Object', 'node_modules']) expect(text).not.toContain(s);
      // Logs may name the REDACTED target (existing, intentional) but never a credential or a stack.
      for (const s of [SECRET, `default:${SECRET}`, 'at Object', 'node_modules']) expect(logged()).not.toContain(s);
    } finally {
      await srv.close();
    }
  });

  it('an error thrown synchronously out of the app is a controlled 500 with no detail', async () => {
    const app = (() => {
      throw new Error(`boom ${SECRET}`);
    }) as unknown as express.Express;
    const srv = await serve(createHandler(async () => app));
    try {
      const res = await fetch(`${srv.base}/api/health`);
      const text = await res.text();
      expect(res.status).toBe(500);
      expect(JSON.parse(text)).toMatchObject({ success: false, code: 'internal_error' });
      expect(text).not.toContain(SECRET);
      expect(logged()).not.toContain(SECRET);
    } finally {
      await srv.close();
    }
  });
});

describe('the real function entry (api/index.ts)', () => {
  it('default-exports a request handler and importing it has no side effects', async () => {
    const mod = await import('../../../api/index');
    expect(typeof mod.default).toBe('function');
    expect(Object.keys(mod)).toEqual(['default']);
  });

  it('with an unsafe/non-Redis environment it fails closed with a controlled 503 instead of serving from memory', async () => {
    const mod = await import('../../../api/index');
    const srv = await serve(mod.default as unknown as http.RequestListener);
    try {
      const res = await fetch(`${srv.base}/api/health`); // vitest runs with NODE_ENV=test: no Redis store may be selected
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBeTruthy();
      expect(await res.json()).toMatchObject({ success: false, code: 'service_unavailable' });
    } finally {
      await srv.close();
    }
  });
});

describe('repository hygiene: the Stage 1 diagnostic endpoint is gone', () => {
  const SPIKE = ['__vercel', '_spike'].join(''); // assembled so this file does not contain the literal

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', 'coverage', '.vercel'].includes(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (st.size < 2_000_000) out.push(full);
    }
    return out;
  }

  it('no source, config or script file mentions the spike endpoint (historical reports under docs/ may)', () => {
    const offenders = walk(ROOT)
      .filter((f) => !f.startsWith(path.join(ROOT, 'docs')))
      .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|html|md|yml|yaml)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes(SPIKE))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('api/ contains exactly one function file (anything else there becomes a public Vercel Function)', () => {
    expect(readdirSync(path.join(ROOT, 'api'))).toEqual(['index.ts']);
  });

  it('the endpoint answers 401/404-class, not 200, through the real app', async () => {
    const { provider } = realAppProvider();
    const srv = await serve(createHandler(provider.getApp));
    try {
      for (const p of [`/api/${SPIKE}/path`, `/api/${SPIKE}/method`, `/api/${SPIKE}/unknown`]) {
        const res = await fetch(`${srv.base}${p}`);
        expect(res.status, p).toBe(401);
      }
    } finally {
      await srv.close();
    }
  });

  it('the handler touches the request URL in exactly one place: writing back the normalised value', () => {
    const lines = readFileSync(path.join(ROOT, 'src/server/serverless/handler.ts'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /\breq\.(url|query|originalUrl)\b/.test(l))
      .map((l) => l.trim());
    expect(lines).toEqual(["req.url = normalizeRewrittenUrl(req.url ?? '/');"]);
  });

  it('entry point and handler have no listener, timer, signal handler, process exit, Vite or local-runner import', () => {
    for (const f of ['api/index.ts', 'src/server/serverless/handler.ts']) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/\.listen\s*\(/);
      expect(src, f).not.toMatch(/process\.(exit|on|once)\s*\(/);
      expect(src, f).not.toMatch(/setInterval|setTimeout/);
      expect(src, f).not.toMatch(/from ['"](vite|dotenv)['"]/);
      expect(src, f).not.toMatch(/from ['"][./]*\/server(\.js|\.ts)?['"]/);
      expect(src, f).not.toMatch(/express\.static|sendFile/);
    }
  });
});
