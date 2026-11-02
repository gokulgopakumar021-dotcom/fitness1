// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

// Fake supabase-js (only `createClient(...).rpc(...).abortSignal(...)` is used by SupabaseQuotaStore).
const sb = vi.hoisted(() => ({ rpcCalls: 0, down: false }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: () => ({
      abortSignal: async () => {
        sb.rpcCalls++;
        if (sb.down) throw new Error('SECRET-DB-DETAIL connection refused 10.0.0.5');
        return { data: { allowed: true, used: 1 }, error: null };
      }
    })
  })
}));

import { createApp } from '../../../server';
import { UNIVERSAL_MODEL_OUTPUT } from './aiFixtures';
import { VALID } from './aiRequestFixtures';
import { ENDPOINTS } from './endpoints';
import { DegradingRateStore, MemoryRateStore, RateStoreUnavailableError, type RateStore } from './rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from './testUtils';

/**
 * Per-route failure policy, end to end. For every route and every combination of
 *   shared rate store (healthy / down) x RATE_LIMIT_FAILURE_POLICY x quota store (healthy / down) x QUOTA_FAILURE_POLICY
 * the observed outcome must equal the policy written in docs/security/route-failure-policy.md.
 *
 * The expectation below is written from that policy, NOT derived from ALWAYS_CLOSED_BUCKETS, so a change to the
 * always-closed set (or a route silently becoming degradable) fails here.
 */
const ALWAYS_CLOSED = ['POST /extract-plan', 'POST /ai-generate-physique', 'POST /ai-physique-analysis'];
const BARCODE = 'GET /nutrition/barcode/5449000000996';
const HEALTH = 'GET /health';
const AI = Object.keys(ENDPOINTS).filter((k) => ENDPOINTS[k].ai);
const ROUTES = [...AI, BARCODE, HEALTH];
// With the fixture payload (no sessions) this route answers `nothing_to_explain` itself and makes no Gemini call. It still
// consumes quota: usage is counted on attempt, before the handler (decision 3).
const NO_GEMINI_WITH_FIXTURE = ['POST /adaptive-coach/explain'];

const failingRateStore: RateStore = {
  hit: async () => {
    throw new RateStoreUnavailableError();
  },
  peek: async () => {
    throw new RateStoreUnavailableError();
  }
};

interface Scenario {
  rateDown: boolean;
  ratePolicy: 'closed' | 'degraded';
  quotaDown: boolean;
  quotaPolicy: 'closed' | 'degraded';
}

/** What the policy says each route does, as `status|code|X-RateLimit-Mode|X-Quota-Mode`. */
function expected(route: string, s: Scenario): string {
  if (route === HEALTH) return '200|-|-|-'; // public probe: unchanged in every mode, never marked degraded
  const closedRoute = ALWAYS_CLOSED.includes(route);
  const rateMode = s.rateDown && s.ratePolicy === 'degraded' ? 'degraded' : '-';
  if (s.rateDown && (s.ratePolicy === 'closed' || closedRoute)) {
    // closed policy: the limiter throws before it can mark anything; degraded + always-closed: marked, then refused.
    return `503|rate_limit_unavailable|${s.ratePolicy === 'degraded' ? 'degraded' : '-'}|-`;
  }
  if (route === BARCODE) return `handler|-|${rateMode}|-`; // rate-limited only: never consults the quota store
  if (s.quotaDown && (s.quotaPolicy === 'closed' || closedRoute)) return `503|quota_unavailable|${rateMode}|-`;
  return `200|-|${rateMode}|${s.quotaDown ? 'degraded' : '-'}`;
}

let srv: Awaited<ReturnType<typeof listen>> | null = null;
let spies: ReturnType<typeof vi.spyOn>[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  generate.mockReset();
  generate.mockResolvedValue({ text: JSON.stringify(UNIVERSAL_MODEL_OUTPUT) });
  sb.rpcCalls = 0;
  sb.down = false;
  spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
  // Open Food Facts is the only outbound call besides Gemini; answer it locally, pass everything else through.
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('openfoodfacts')
      ? Promise.resolve(new Response(JSON.stringify({ status: 0, status_verbose: 'product not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : realFetch(input, init)) as typeof fetch);
});
afterEach(async () => {
  await srv?.close();
  srv = null;
  vi.restoreAllMocks();
});

async function observe(route: string, headers: Record<string, string>): Promise<{ result: string; status: number }> {
  const [method, path] = route.split(' ');
  const res = await fetch(`${srv!.base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(VALID[route]) : undefined
  });
  const text = await res.text();
  let code = '-';
  try {
    code = JSON.parse(text).code ?? '-';
  } catch {
    /* non-JSON */
  }
  const status = route === BARCODE && (res.status === 200 || res.status === 404) ? 'handler' : String(res.status);
  return { result: `${status}|${code}|${res.headers.get('x-ratelimit-mode') ?? '-'}|${res.headers.get('x-quota-mode') ?? '-'}`, status: res.status };
}

const SCENARIOS: Scenario[] = [];
for (const rateDown of [false, true])
  for (const quotaDown of [false, true])
    for (const ratePolicy of ['closed', 'degraded'] as const)
      for (const quotaPolicy of ['closed', 'degraded'] as const) SCENARIOS.push({ rateDown, ratePolicy, quotaDown, quotaPolicy });

describe('route inventory (the policy below covers exactly these routes)', () => {
  it('15 AI routes, 3 always-closed, 12 degradable, plus barcode and health', () => {
    expect(AI).toHaveLength(15);
    expect(AI.filter((k) => ALWAYS_CLOSED.includes(k))).toHaveLength(3);
    expect(ROUTES).toHaveLength(17);
  });
});

describe('per-route failure matrix', () => {
  it.each(SCENARIOS)('rate %# : rateDown=$rateDown/$ratePolicy quotaDown=$quotaDown/$quotaPolicy', async (s) => {
    const rateStore: RateStore = !s.rateDown ? new MemoryRateStore() : s.ratePolicy === 'degraded' ? new DegradingRateStore(failingRateStore, new MemoryRateStore(), Date.now, 0) : failingRateStore;
    sb.down = s.quotaDown;
    srv = await listen(
      createApp({
        verifyToken: mockVerifier,
        rateStore,
        config: testConfig({ quotaStore: 'supabase', supabaseKey: 'sb_publishable_test', quotaFailurePolicy: s.quotaPolicy, rateUserPerMin: 10_000, rateIpPerMin: 10_000 })
      })
    );

    const observed: Record<string, string> = {};
    const want: Record<string, string> = {};
    let wantGemini = 0;
    let wantRpc = 0;
    for (const route of ROUTES) {
      const headers: Record<string, string> = route === HEALTH ? {} : { Authorization: `Bearer ${fakeToken({ sub: `u-${Math.random()}` })}` };
      observed[route] = (await observe(route, headers)).result;
      want[route] = expected(route, s);
      if (AI.includes(route) && !want[route].startsWith('503|rate_limit_unavailable')) wantRpc++;
      if (AI.includes(route) && want[route].startsWith('200') && !NO_GEMINI_WITH_FIXTURE.includes(route)) wantGemini++;
    }
    expect(observed).toEqual(want);
    expect(generate).toHaveBeenCalledTimes(wantGemini); // no Gemini spend on any refused request
    expect(sb.rpcCalls).toBe(wantRpc); // quota is consulted exactly for AI routes that passed the rate stage
    const logged = spies.flatMap((x) => (x.mock.calls as unknown[][]).map((c) => c.map(String).join(' '))).join('\n');
    expect(logged).not.toContain('SECRET-DB-DETAIL');
  });
});

describe('always-closed routes are never counted in memory', () => {
  it('with both stores down and both policies degraded, the three routes still refuse and the rest are served', async () => {
    sb.down = true;
    srv = await listen(
      createApp({
        verifyToken: mockVerifier,
        rateStore: new DegradingRateStore(failingRateStore, new MemoryRateStore(), Date.now, 0),
        config: testConfig({ quotaStore: 'supabase', supabaseKey: 'sb_publishable_test', quotaFailurePolicy: 'degraded', rateUserPerMin: 10_000, rateIpPerMin: 10_000 })
      })
    );
    const h = { Authorization: `Bearer ${fakeToken({ sub: 'u-fixed' })}` };
    for (const route of ALWAYS_CLOSED) for (let i = 0; i < 3; i++) expect((await observe(route, h)).status, route).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    expect((await observe('POST /ai-food-parser', h)).status).toBe(200);
  });
});
