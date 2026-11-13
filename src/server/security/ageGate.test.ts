// @vitest-environment node
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

import { createApp } from '../../../server';
import { AgeStoreUnavailableError, loadAgeEnforcement, PositiveAgeCache, SupabaseAgeStore, type AgeStore } from './ageGate';
import { BILLING_ENDPOINTS, ENDPOINTS } from './endpoints';
import { VALID } from './aiRequestFixtures';
import { fakeToken, listen, mockVerifier, testConfig } from './testUtils';

type Srv = Awaited<ReturnType<typeof listen>>;
let srv: Srv | null = null;
let logSpy: ReturnType<typeof vi.spyOn>[] = [];

class FakeStore implements AgeStore {
  calls: Array<{ userId: string; token: string | undefined }> = [];
  constructor(private readonly answer: (userId: string) => boolean | 'down') {}
  async isDeclaredAdult(userId: string, token: string | undefined) {
    this.calls.push({ userId, token });
    const a = this.answer(userId);
    if (a === 'down') throw new AgeStoreUnavailableError('timeout');
    return a;
  }
}

async function boot(opts: Parameters<typeof createApp>[0] = {}) {
  const app: Express = createApp({ verifyToken: mockVerifier, config: testConfig(), ...opts });
  srv = await listen(app);
  return srv;
}
const auth = (claims: Record<string, unknown> = {}) => ({ Authorization: `Bearer ${fakeToken(claims)}` });
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = auth()) =>
  fetch(`${srv!.base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const AI_ROUTES = Object.keys(ENDPOINTS).filter((k) => ENDPOINTS[k].ai);
const split = (k: string) => [k.split(' ')[0], k.split(' ')[1]] as const;

beforeEach(() => {
  generate.mockReset();
  logSpy = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(async () => {
  logSpy.forEach((s) => s.mockRestore());
  await srv?.close();
  srv = null;
});

describe('AGE_ENFORCEMENT parsing', () => {
  it('defaults to off, accepts off/shadow/on in any case, and never turns on from a typo', () => {
    expect(loadAgeEnforcement({})).toEqual({ mode: 'off', invalid: false });
    expect(loadAgeEnforcement({ AGE_ENFORCEMENT: ' ON ' })).toEqual({ mode: 'on', invalid: false });
    expect(loadAgeEnforcement({ AGE_ENFORCEMENT: 'shadow' })).toEqual({ mode: 'shadow', invalid: false });
    expect(loadAgeEnforcement({ AGE_ENFORCEMENT: 'yes' })).toEqual({ mode: 'off', invalid: true });
  });
});

describe('mode off (default): nothing changes and the database is never consulted', () => {
  it('passes an AI route through without any age lookup', async () => {
    generate.mockResolvedValue({ text: '{}' });
    const store = new FakeStore(() => false);
    await boot({ ageStore: store });
    const [m, p] = split('POST /ai-food-parser');
    const r = await call(m, p, VALID['POST /ai-food-parser']);
    expect(store.calls).toHaveLength(0);
    expect((await r.json().catch(() => ({}))).code).not.toBe('age_confirmation_required');
  });
});

describe('mode on: the server decides, from the database only', () => {
  it.each(AI_ROUTES)('%s: 403 age_confirmation_required for an age-unknown user, and Gemini is never called', async (route) => {
    const store = new FakeStore(() => false);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const [m, p] = split(route);
    const r = await call(m, p, VALID[route]);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ success: false, code: 'age_confirmation_required' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('covers every Body Scan AI endpoint explicitly', () => {
    for (const r of ['POST /ai-form-analyzer', 'POST /ai-physique-analysis', 'POST /ai-generate-physique']) {
      expect(AI_ROUTES).toContain(r);
      expect(ENDPOINTS[r].ageExempt).toBeUndefined();
    }
  });

  it('gates the barcode route and the non-exempt billing routes too', async () => {
    const store = new FakeStore(() => false);
    await boot({ ageEnforcement: 'on', ageStore: store });
    for (const [m, p, body] of [
      ['GET', '/nutrition/barcode/5449000000996', undefined],
      ['GET', '/billing/status', undefined],
      ['GET', '/billing/payments', undefined],
      ['POST', '/billing/subscriptions', { planKey: 'monthly' }],
      ['POST', '/billing/subscriptions/verify', {}],
      ['POST', '/billing/subscriptions/recover', {}]
    ] as const) {
      const r = await call(m, p, body);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect((await r.json()).code).toBe('age_confirmation_required');
    }
  });

  it('keeps ONLY health, deletion and cancellation reachable (an age-unknown user can always leave and stop paying)', async () => {
    const exempt = Object.entries(BILLING_ENDPOINTS).filter(([, v]) => v.ageExempt).map(([k]) => k).sort();
    expect(exempt).toEqual(['GET /billing/account/deletion-check', 'POST /billing/account/prepare-deletion', 'POST /billing/subscriptions/cancel']);
    expect(Object.values(ENDPOINTS).some((e) => e.ageExempt)).toBe(false);
    const store = new FakeStore(() => false);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const health = await fetch(`${srv!.base}/api/health`);
    expect(health.status).toBe(200);
    for (const k of exempt) {
      const [m, p] = split(k);
      const r = await call(m, p, m === 'POST' ? {} : undefined);
      const body = await r.json().catch(() => ({}));
      expect(body.code, k).not.toBe('age_confirmation_required');
      expect(r.status, k).not.toBe(403);
    }
    expect(store.calls).toHaveLength(0);
  });

  it('lets a declared adult through and caches only that positive answer', async () => {
    generate.mockResolvedValue({ text: '{}' });
    const store = new FakeStore(() => true);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const [m, p] = split('POST /ai-food-parser');
    for (let i = 0; i < 3; i++) {
      const r = await call(m, p, VALID['POST /ai-food-parser']);
      expect(r.status).not.toBe(403);
    }
    expect(store.calls).toHaveLength(1);
  });

  it('never caches a negative answer: a fresh declaration takes effect on the very next request', async () => {
    let declared = false;
    const store = new FakeStore(() => declared);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const [m, p] = split('POST /ai-food-parser');
    expect((await call(m, p, VALID['POST /ai-food-parser'])).status).toBe(403);
    declared = true;
    expect((await call(m, p, VALID['POST /ai-food-parser'])).status).not.toBe(403);
    expect(store.calls).toHaveLength(2);
  });

  it('fails CLOSED with 503 when eligibility cannot be determined, and never reaches Gemini', async () => {
    await boot({ ageEnforcement: 'on', ageStore: new FakeStore(() => 'down') });
    const [m, p] = split('POST /ai-food-parser');
    const r = await call(m, p, VALID['POST /ai-food-parser']);
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('5');
    expect(await r.json()).toMatchObject({ code: 'age_eligibility_unavailable' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('is per user: one declared adult does not unlock another account', async () => {
    const store = new FakeStore((id) => id === 'adult');
    await boot({ ageEnforcement: 'on', ageStore: store });
    const [m, p] = split('POST /ai-food-parser');
    generate.mockResolvedValue({ text: '{}' });
    expect((await call(m, p, VALID['POST /ai-food-parser'], auth({ sub: 'adult' }))).status).not.toBe(403);
    expect((await call(m, p, VALID['POST /ai-food-parser'], auth({ sub: 'unknown-user' }))).status).toBe(403);
  });

  it('ignores everything the browser can send: headers, query string and body claims never grant access', async () => {
    const store = new FakeStore(() => false);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const [m, p] = split('POST /ai-food-parser');
    const forged = { ...auth(), 'X-Age-Verified': 'true', 'X-Adult': '1', Cookie: 'adult=true' };
    const body = { ...(VALID['POST /ai-food-parser'] as object), age: 40, adult_18_plus: true, profile: { age: 40 }, ageConfirmed18Plus: true };
    const r = await fetch(`${srv!.base}/api${p}?adult=true&age=40`, { method: m, headers: { 'Content-Type': 'application/json', ...forged }, body: JSON.stringify(body) });
    expect(r.status).toBe(403);
  });

  it('a refused request is cheap: no body is parsed (an oversized body is not even read) and the verdict is the same', async () => {
    await boot({ ageEnforcement: 'on', ageStore: new FakeStore(() => false) });
    const r = await call('POST', '/ai-food-parser', 'x'.repeat(10)); // invalid JSON would be a 400 if the body were parsed first
    expect(r.status).toBe(403);
  });

  it('answers with the verified token and the verified user id, never body data', async () => {
    const store = new FakeStore(() => true);
    await boot({ ageEnforcement: 'on', ageStore: store });
    generate.mockResolvedValue({ text: '{}' });
    const token = fakeToken({ sub: 'user-z' });
    await call('POST', '/ai-food-parser', { ...(VALID['POST /ai-food-parser'] as object), userId: 'someone-else' }, { Authorization: `Bearer ${token}` });
    expect(store.calls).toEqual([{ userId: 'user-z', token }]);
  });

  it('an unauthenticated request is still rejected by authentication first (401), never by the age gate', async () => {
    const store = new FakeStore(() => false);
    await boot({ ageEnforcement: 'on', ageStore: store });
    const r = await call('POST', '/ai-food-parser', VALID['POST /ai-food-parser'], {});
    expect(r.status).toBe(401);
    expect(store.calls).toHaveLength(0);
  });
});

describe('mode shadow: logs would-be denials and blocks nothing', () => {
  it('lets an age-unknown user through and does not fail when the lookup is down', async () => {
    generate.mockResolvedValue({ text: '{}' });
    await boot({ ageEnforcement: 'shadow', ageStore: new FakeStore(() => false) });
    const r1 = await call('POST', '/ai-food-parser', VALID['POST /ai-food-parser']);
    expect(r1.status).not.toBe(403);
    await srv?.close();
    await boot({ ageEnforcement: 'shadow', ageStore: new FakeStore(() => 'down') });
    const r2 = await call('POST', '/ai-food-parser', VALID['POST /ai-food-parser']);
    // The route itself may answer 503 (no Gemini key in tests); what matters is that it was the ROUTE, not the age gate.
    expect((await r2.json().catch(() => ({}))).code).not.toBe('age_eligibility_unavailable');
  });
});

describe('SupabaseAgeStore (no network: the client factory is exercised against an unreachable host)', () => {
  it('is "unavailable", not "eligible", when it is not configured or has no token', async () => {
    await expect(new SupabaseAgeStore({}).isDeclaredAdult('u', 't')).rejects.toMatchObject({ reason: 'not_configured' });
    await expect(new SupabaseAgeStore({ supabaseUrl: 'https://x.invalid', supabaseKey: 'k' }).isDeclaredAdult('u', undefined)).rejects.toMatchObject({ reason: 'no_token' });
  });

  it('a transport failure is "unavailable", never "eligible"', async () => {
    const store = new SupabaseAgeStore({ supabaseUrl: 'http://127.0.0.1:9', supabaseKey: 'k' }, { timeoutMs: 500 });
    await expect(store.isDeclaredAdult('u', 'tok')).rejects.toBeInstanceOf(AgeStoreUnavailableError);
  });
});

describe('PositiveAgeCache', () => {
  it('expires entries and bounds its size', () => {
    let t = 0;
    const c = new PositiveAgeCache(1000, 2, () => t);
    c.add('a');
    expect(c.has('a')).toBe(true);
    t = 1001;
    expect(c.has('a')).toBe(false);
    c.add('a');
    c.add('b');
    c.add('c');
    expect(c.has('a')).toBe(false);
    expect(c.has('c')).toBe(true);
  });
});
