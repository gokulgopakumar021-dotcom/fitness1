// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

// Fake supabase-js: only `createClient(...).rpc(...).abortSignal(...)` is used by SupabaseQuotaStore.
const sb = vi.hoisted(() => ({
  createClient: vi.fn(),
  impl: null as null | ((args: { fn: string; params: Record<string, unknown>; signal?: AbortSignal }) => Promise<unknown>)
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...a: unknown[]) => {
    sb.createClient(...a);
    return {
      rpc: (fn: string, params: Record<string, unknown>) => ({
        abortSignal: (signal: AbortSignal) => sb.impl!({ fn, params, signal })
      })
    };
  }
}));

import { createApp } from '../../../server';
import { UNIVERSAL_MODEL_OUTPUT } from './aiFixtures';
import { VALID } from './aiRequestFixtures';
import { loadSecurityConfig } from './config';
import { ALWAYS_CLOSED_BUCKETS, ENDPOINTS } from './endpoints';
import { DegradingQuotaStore, MemoryQuotaStore, QuotaStoreUnavailableError, SupabaseQuotaStore, type QuotaRequest, type QuotaStore } from './quota';
import { fakeToken, listen, mockVerifier, testConfig } from './testUtils';

const SECRET = 'SECRET-DB-DETAIL password=hunter2 relation "ai_usage_quota" at 10.0.0.5';
const REQ: QuotaRequest = { userId: 'u1', bucket: 'exercise-coach', limit: 5, day: '2026-11-02', accessToken: 'tok.en.sig' };
const CFG = { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_test' };

const reasonOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(QuotaStoreUnavailableError);
    expect((e as Error).message).toBe('Quota store unavailable');
    expect((e as Error).message + (e as QuotaStoreUnavailableError).reason).not.toContain('hunter2');
    return (e as QuotaStoreUnavailableError).reason;
  }
  throw new Error('expected consume() to throw');
};

/* ------------------------------------------------------------------ SupabaseQuotaStore */
describe('SupabaseQuotaStore: every failure becomes QuotaStoreUnavailableError', () => {
  beforeEach(() => sb.createClient.mockReset());

  it('success: array or object row; sends bucket/limit and the caller JWT, never a service key', async () => {
    sb.impl = async ({ fn, params }) => ({ data: [{ allowed: true, used: 3 }], error: null, fn, params });
    const store = new SupabaseQuotaStore(CFG);
    expect(await store.consume(REQ)).toEqual({ allowed: true, used: 3, limit: 5 });
    const [url, key, opts] = sb.createClient.mock.calls[0];
    expect(url).toBe(CFG.supabaseUrl);
    expect(key).toBe(CFG.supabaseKey);
    expect(opts.global.headers.Authorization).toBe('Bearer tok.en.sig');
    expect(opts.auth.persistSession).toBe(false);
    sb.impl = async ({ fn, params }) => {
      expect(fn).toBe('consume_ai_quota');
      expect(params).toEqual({ p_bucket: 'exercise-coach', p_limit: 5 });
      return { data: { allowed: false, used: '5' }, error: null };
    };
    expect(await store.consume(REQ)).toEqual({ allowed: false, used: 5, limit: 5 });
  });

  it('not configured / no token: fails before any network call', async () => {
    expect(await reasonOf(new SupabaseQuotaStore({}).consume(REQ))).toBe('not_configured');
    expect(await reasonOf(new SupabaseQuotaStore({ supabaseUrl: CFG.supabaseUrl }).consume(REQ))).toBe('not_configured');
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume({ ...REQ, accessToken: undefined }))).toBe('no_token');
    expect(sb.createClient).not.toHaveBeenCalled();
  });

  it('RPC error: reason carries only the short error code, never the message', async () => {
    sb.impl = async () => ({ data: null, error: { code: '42501', message: SECRET } });
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('rpc_42501');
    sb.impl = async () => ({ data: null, error: { code: 'PGRST202', message: SECRET } }); // function missing = migration not applied
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('rpc_PGRST202');
    sb.impl = async () => ({ data: null, error: { message: SECRET } });
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('rpc_error');
    sb.impl = async () => ({ data: null, error: { code: 'not a code; DROP TABLE', message: SECRET } });
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('rpc_error');
  });

  it('thrown transport error -> transport (message never propagated)', async () => {
    sb.impl = async () => {
      throw new Error(SECRET);
    };
    expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('transport');
  });

  it('timeout: a hung RPC is aborted by the signal (both reported and thrown AbortError forms)', async () => {
    const hang = (mode: 'throw' | 'return') => async ({ signal }: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        signal!.addEventListener('abort', () => {
          const err = Object.assign(new Error(SECRET), { name: 'AbortError' });
          mode === 'throw' ? reject(err) : resolve({ data: null, error: err });
        });
      });
    for (const mode of ['throw', 'return'] as const) {
      sb.impl = hang(mode);
      const t0 = Date.now();
      expect(await reasonOf(new SupabaseQuotaStore(CFG, { timeoutMs: 40 }).consume(REQ))).toBe('timeout');
      expect(Date.now() - t0).toBeLessThan(2_000);
    }
  });

  it('unexpected response shapes -> bad_shape (never treated as allowed)', async () => {
    const bad: unknown[] = [null, [], {}, { allowed: 'true', used: 1 }, [{ allowed: true }], [{ allowed: true, used: 'x' }], 'ok', 7];
    for (const data of bad) {
      sb.impl = async () => ({ data, error: null });
      expect(await reasonOf(new SupabaseQuotaStore(CFG).consume(REQ))).toBe('bad_shape');
    }
  });
});

/* ------------------------------------------------------------------ DegradingQuotaStore */
describe('DegradingQuotaStore (explicit degraded policy)', () => {
  const failing = (e: unknown = new QuotaStoreUnavailableError('rpc_down')): QuotaStore => ({ consume: async () => { throw e; } });
  let logs: ReturnType<typeof vi.spyOn>[] = [];
  const logged = () => logs.flatMap((s) => (s.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');
  beforeEach(() => {
    logs = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
  });
  afterEach(() => logs.forEach((s) => s.mockRestore()));

  it('counts per instance, marks the decision degraded, enforces the limit, and logs', async () => {
    const store = new DegradingQuotaStore(failing(), new MemoryQuotaStore());
    const req = { ...REQ, limit: 2 };
    expect(await store.consume(req)).toMatchObject({ allowed: true, used: 1, degraded: true });
    expect(await store.consume(req)).toMatchObject({ allowed: true, used: 2, degraded: true });
    expect(await store.consume(req)).toMatchObject({ allowed: false, degraded: true });
    expect(logged()).toContain('quota_store_degraded');
    expect(logged()).toContain('rpc_down');
  });

  it('allowDegraded=false re-throws and never touches the memory fallback', async () => {
    const fallback = new MemoryQuotaStore();
    const spy = vi.spyOn(fallback, 'consume');
    const store = new DegradingQuotaStore(failing(), fallback);
    await expect(store.consume({ ...REQ, allowDegraded: false })).rejects.toBeInstanceOf(QuotaStoreUnavailableError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('only QuotaStoreUnavailableError is degraded; any other error propagates', async () => {
    const fallback = new MemoryQuotaStore();
    const spy = vi.spyOn(fallback, 'consume');
    await expect(new DegradingQuotaStore(failing(new TypeError('bug')), fallback).consume(REQ)).rejects.toThrow('bug');
    expect(spy).not.toHaveBeenCalled();
  });

  it('recovers: once the primary works again decisions are shared and not marked degraded', async () => {
    let down = true;
    const primary: QuotaStore = { consume: async () => { if (down) throw new QuotaStoreUnavailableError('x'); return { allowed: true, used: 9, limit: 10 }; } };
    const store = new DegradingQuotaStore(primary, new MemoryQuotaStore());
    expect((await store.consume(REQ)).degraded).toBe(true);
    down = false;
    expect(await store.consume(REQ)).toEqual({ allowed: true, used: 9, limit: 10 });
  });

  it('log is throttled and reports how many were suppressed', async () => {
    let t = 1_000_000;
    const store = new DegradingQuotaStore(failing(), new MemoryQuotaStore(), () => t, 10_000);
    for (let i = 0; i < 5; i++) await store.consume({ ...REQ, userId: `u${i}` });
    expect((logged().match(/quota_store_degraded/g) ?? []).length).toBe(1);
    t += 10_001;
    await store.consume(REQ);
    expect((logged().match(/quota_store_degraded/g) ?? []).length).toBe(2);
    expect(logged()).toContain('"suppressed":4');
  });
});

/* ------------------------------------------------------------------ the app: gate behaviour on every AI route */
const AI_ROUTES = Object.entries(ENDPOINTS).filter(([, p]) => p.ai).map(([k, p]) => ({ key: k, path: k.split(' ')[1], bucket: p.bucket }));
const CLOSED = AI_ROUTES.filter((r) => ALWAYS_CLOSED_BUCKETS.has(r.bucket));
const DEGRADABLE = AI_ROUTES.filter((r) => !ALWAYS_CLOSED_BUCKETS.has(r.bucket));

type Srv = Awaited<ReturnType<typeof listen>>;
let srv: Srv | null = null;
let spies: ReturnType<typeof vi.spyOn>[] = [];
const allLogged = () => spies.flatMap((s) => (s.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');
const auth = (claims: Record<string, unknown> = {}) => ({ Authorization: `Bearer ${fakeToken({ sub: `u-${Math.random()}`, ...claims })}` });
const post = (path: string, body: unknown, headers: Record<string, string> = auth()) =>
  fetch(`${srv!.base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const boot = async (opts: Parameters<typeof createApp>[0]) => {
  srv = await listen(createApp({ verifyToken: mockVerifier, config: testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000 }), ...opts }));
  return srv;
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  generate.mockReset();
  generate.mockResolvedValue({ text: JSON.stringify(UNIVERSAL_MODEL_OUTPUT) });
  spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(async () => {
  await srv?.close();
  srv = null;
  spies.forEach((s) => s.mockRestore());
});

describe('route inventory', () => {
  it('covers all 15 AI routes, 3 always-closed and 12 degradable', () => {
    expect(AI_ROUTES).toHaveLength(15);
    expect(CLOSED.map((r) => r.bucket).sort()).toEqual(['ai-generate-physique', 'ai-physique-analysis', 'extract-plan']);
    expect(DEGRADABLE).toHaveLength(12);
  });
});

describe('policy closed (default): a failing quota store means 503 quota_unavailable on every AI route', () => {
  const store = (e: unknown): QuotaStore => ({ consume: vi.fn(async () => { throw e; }) });

  it.each(AI_ROUTES)('$key', async ({ key, path }) => {
    const s = store(new QuotaStoreUnavailableError('rpc_42501'));
    await boot({ quotaStore: s });
    const res = await post(path, VALID[key]);
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('x-quota-mode')).toBeNull();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ success: false, code: 'quota_unavailable' });
    expect(typeof body.requestId).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'requestId', 'success']);
    expect(generate).not.toHaveBeenCalled();
    expect(s.consume).toHaveBeenCalledTimes(1);
    expect(allLogged()).toContain('quota_unavailable');
    expect(allLogged()).toContain('rpc_42501');
  });

  it('the response and logs never contain DB error text', async () => {
    // The store throws a typed error whose cause would be sensitive; nothing but the reason code may surface.
    const e = new QuotaStoreUnavailableError('rpc_error');
    (e as { cause?: unknown }).cause = new Error(SECRET);
    await boot({ quotaStore: store(e) });
    const res = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(await res.text()).not.toContain('hunter2');
    expect(allLogged()).not.toContain('hunter2');
  });

  it('an unexpected (untyped) store error is NOT reported as quota_unavailable and leaks nothing', async () => {
    await boot({ quotaStore: store(new Error(SECRET)) });
    const res = await post('/exercise-coach', VALID['POST /exercise-coach']);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).code).toBe('internal_error');
    expect(text).not.toContain('hunter2');
    expect(generate).not.toHaveBeenCalled();
  });

  it('non-AI and unauthenticated paths never consult the quota store', async () => {
    const s = store(new QuotaStoreUnavailableError('x'));
    await boot({ quotaStore: s });
    expect((await fetch(`${srv!.base}/api/health`)).status).toBe(200);
    expect((await fetch(`${srv!.base}/api/nutrition/barcode/not-a-barcode`, { headers: auth() })).status).not.toBe(503);
    expect((await post('/exercise-coach', VALID['POST /exercise-coach'], {})).status).toBe(401);
    expect((await post('/exercise-coach', {}, auth())).status).toBe(400); // invalid body is rejected before quota
    expect(s.consume).not.toHaveBeenCalled();
  });
});

describe('policy degraded (explicit): 12 routes keep working per instance, 3 stay closed', () => {
  const degraded = (limitOverrides: Record<string, number> = {}) => {
    const primary: QuotaStore = { consume: vi.fn(async () => { throw new QuotaStoreUnavailableError('rpc_down'); }) };
    return { primary, store: new DegradingQuotaStore(primary, new MemoryQuotaStore()), cfg: testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000, quotaOverrides: limitOverrides, quotaFailurePolicy: 'degraded' }) };
  };

  it.each(DEGRADABLE)('$key -> 200 with X-Quota-Mode: degraded', async ({ key, path }) => {
    const d = degraded();
    await boot({ quotaStore: d.store, config: d.cfg });
    const res = await post(path, VALID[key]);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-quota-mode')).toBe('degraded');
    expect(res.headers.get('x-quota-limit')).not.toBeNull();
    // adaptive-coach/explain is deterministic-first and may answer without calling Gemini; every other route calls it once.
    if (!key.includes('adaptive-coach')) expect(generate).toHaveBeenCalledTimes(1);
    expect(allLogged()).toContain('quota_store_degraded');
  });

  it.each(CLOSED)('$key stays 503 quota_unavailable even in degraded mode', async ({ key, path }) => {
    const d = degraded();
    await boot({ quotaStore: d.store, config: d.cfg });
    const res = await post(path, VALID[key]);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('quota_unavailable');
    expect(res.headers.get('x-quota-mode')).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('the per-instance limit is still enforced (429) while degraded; remaining header is honest', async () => {
    const d = degraded({ 'exercise-coach': 2 });
    await boot({ quotaStore: d.store, config: d.cfg });
    const h = auth({ sub: 'same-user' });
    const r1 = await post('/exercise-coach', VALID['POST /exercise-coach'], h);
    expect(r1.headers.get('x-quota-remaining')).toBe('1');
    expect((await post('/exercise-coach', VALID['POST /exercise-coach'], h)).status).toBe(200);
    const r3 = await post('/exercise-coach', VALID['POST /exercise-coach'], h);
    expect(r3.status).toBe(429);
    expect((await r3.json()).code).toBe('quota_exceeded');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('recovery: when the shared store returns, responses are no longer marked degraded', async () => {
    let down = true;
    const primary: QuotaStore = { consume: async () => { if (down) throw new QuotaStoreUnavailableError('x'); return { allowed: true, used: 1, limit: 60 }; } };
    await boot({ quotaStore: new DegradingQuotaStore(primary, new MemoryQuotaStore()), config: testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000, quotaFailurePolicy: 'degraded' }) });
    expect((await post('/exercise-coach', VALID['POST /exercise-coach'])).headers.get('x-quota-mode')).toBe('degraded');
    down = false;
    const ok = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-quota-mode')).toBeNull();
  });
});

describe('wiring from configuration (createApp builds the store)', () => {
  const live = (cfg: Parameters<typeof testConfig>[0]) => testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000, supabaseKey: 'sb_publishable_test', ...cfg });

  it('quotaStore=supabase + closed: a down Supabase gives 503 quota_unavailable end to end (real SupabaseQuotaStore)', async () => {
    sb.impl = async () => ({ data: null, error: { code: 'PGRST301', message: SECRET } });
    await boot({ config: live({ quotaStore: 'supabase', quotaFailurePolicy: 'closed' }) });
    const res = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(res.status).toBe(503);
    expect(JSON.parse(await res.text()).code).toBe('quota_unavailable');
    expect(allLogged()).toContain('rpc_PGRST301');
    expect(allLogged()).not.toContain('hunter2');
    expect(generate).not.toHaveBeenCalled();
  });

  it('quotaStore=supabase + degraded: real store failing degrades only the 12 routes', async () => {
    sb.impl = async () => {
      throw new Error(SECRET);
    };
    await boot({ config: live({ quotaStore: 'supabase', quotaFailurePolicy: 'degraded' }) });
    const ok = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-quota-mode')).toBe('degraded');
    expect((await post('/extract-plan', VALID['POST /extract-plan'])).status).toBe(503);
  });

  it('quotaStore=supabase healthy: the RPC decision is enforced (exhausted -> 429 with Retry-After)', async () => {
    sb.impl = async () => ({ data: [{ allowed: false, used: 60 }], error: null });
    await boot({ config: live({ quotaStore: 'supabase' }) });
    const res = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('forwards the caller JWT (not a service key) to the RPC', async () => {
    sb.createClient.mockReset();
    sb.impl = async () => ({ data: [{ allowed: true, used: 1 }], error: null });
    const token = fakeToken({ sub: 'jwt-user' });
    await boot({ config: live({ quotaStore: 'supabase' }) });
    expect((await post('/exercise-coach', VALID['POST /exercise-coach'], { Authorization: `Bearer ${token}` })).status).toBe(200);
    expect(sb.createClient.mock.calls[0][2].global.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('local development: default config (no env) uses the memory store and just works', async () => {
    const cfg = { ...loadSecurityConfig({ NODE_ENV: 'development' }), rateUserPerMin: 10_000, rateIpPerMin: 10_000 };
    expect(cfg.quotaStore).toBe('memory');
    await boot({ config: cfg });
    const res = await post('/exercise-coach', VALID['POST /exercise-coach']);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-quota-mode')).toBeNull();
    expect(sb.createClient).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ configuration rules */
describe('configuration: QUOTA_STORE / QUOTA_FAILURE_POLICY', () => {
  const PROD = { NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' };
  const SUPA = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' };
  const q = (env: Record<string, string>) => loadSecurityConfig(env);

  it('development / test default to memory with no problems', () => {
    for (const NODE_ENV of ['development', 'test', '']) {
      const c = q({ NODE_ENV });
      expect(c.quotaStore).toBe('memory');
      expect(c.quotaFailurePolicy).toBe('closed');
      expect(c.problems).toEqual([]);
    }
  });

  it('production defaults to supabase and requires Supabase config (setting names only in the message)', () => {
    const bad = q(PROD);
    expect(bad.quotaStore).toBe('supabase');
    expect(bad.problems.join()).toMatch(/QUOTA_STORE=supabase/);
    expect(bad.problems.join()).toMatch(/SUPABASE_URL/);
    expect(q({ ...PROD, ...SUPA }).problems).toEqual([]);
    expect(q({ ...PROD, SUPABASE_URL: SUPA.SUPABASE_URL }).problems.join()).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(q({ ...PROD, VITE_SUPABASE_URL: SUPA.SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'x' }).problems).toEqual([]);
  });

  it('explicit QUOTA_STORE=memory in production is allowed but warns loudly', () => {
    const c = q({ ...PROD, QUOTA_STORE: 'memory' });
    expect(c.problems).toEqual([]);
    expect(c.warnings.join()).toMatch(/per-process memory quota/);
  });

  it('QUOTA_STORE=supabase explicitly outside production still needs Supabase config', () => {
    expect(q({ NODE_ENV: 'development', QUOTA_STORE: 'supabase' }).problems.join()).toMatch(/QUOTA_STORE=supabase/);
    expect(q({ NODE_ENV: 'development', QUOTA_STORE: 'SUPABASE', ...SUPA }).problems).toEqual([]);
  });

  it('a typo is a startup problem, not a silent downgrade to memory', () => {
    for (const bad of ['supabse', 'redis', 'true', 'none']) {
      const c = q({ ...PROD, ...SUPA, QUOTA_STORE: bad });
      expect(c.problems.join()).toMatch(/QUOTA_STORE must be/);
      expect(c.quotaStore).toBe('supabase'); // the strict side
      expect(q({ NODE_ENV: 'development', QUOTA_STORE: bad }).problems.join()).toMatch(/QUOTA_STORE must be/);
    }
  });

  it('QUOTA_FAILURE_POLICY: closed by default, degraded is explicit and warns, garbage is a problem', () => {
    expect(q({ ...PROD, ...SUPA }).quotaFailurePolicy).toBe('closed');
    const d = q({ ...PROD, ...SUPA, QUOTA_FAILURE_POLICY: 'Degraded' });
    expect(d.quotaFailurePolicy).toBe('degraded');
    expect(d.warnings.join()).toMatch(/QUOTA_FAILURE_POLICY=degraded/);
    expect(q({ ...PROD, ...SUPA, QUOTA_FAILURE_POLICY: 'open' }).problems.join()).toMatch(/QUOTA_FAILURE_POLICY must be/);
    expect(q({ ...PROD, ...SUPA, QUOTA_FAILURE_POLICY: 'open' }).quotaFailurePolicy).toBe('closed'); // garbage never becomes permissive
    expect(q({ NODE_ENV: 'development', QUOTA_FAILURE_POLICY: 'degraded' }).warnings.join()).toMatch(/no effect with QUOTA_STORE=memory/);
  });
});
