// @vitest-environment node
/**
 * billing_unavailable diagnostics. The client-facing 503 is deliberately generic; these tests pin that (a) the body stays generic and
 * leaks nothing, (b) the server log line for the same request carries the SAME request id and names the failing condition
 * (configuration, Razorpay authentication, database), and (c) no failure path activates a trial or grants access.
 * Everything uses the in-memory fakes: no Razorpay or database call is made.
 */
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: vi.fn() }; } }));

import { createApp } from '../app';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { BillingUnavailableError, describeBillingFailure } from './diagnostics';
import { createEntitlementGate } from './entitlement';
import { RazorpayError } from './gateway';
import { BillingStoreError } from './store';
import { createBillingService } from './service';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

const GENERIC = 'Billing is temporarily unavailable. Please try again shortly.';
let server: Awaited<ReturnType<typeof listen>> | undefined;
let errSpy: MockInstance<(...a: unknown[]) => void>;

const logs = () => errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
const logged = (event: string) => logs().filter((l) => l.event === event);
const auth = () => ({ authorization: `Bearer ${fakeToken({ sub: 'user-a', email: 'user-a@example.com' })}`, 'content-type': 'application/json' });
const create = () => fetch(server!.base + '/api/billing/subscriptions', { method: 'POST', headers: auth(), body: JSON.stringify({ planKey: 'monthly' }) });

function boot(mode: 'ok' | 'unconfigured' = 'ok') {
  const clock = new FakeClock();
  const config = testBillingConfig();
  const store = new FakeStore(clock);
  const gateway = new FakeGateway(config);
  const billing = mode === 'ok'
    ? { service: createBillingService({ config, store, gateway, now: clock.now }) }
    : { config: testBillingConfig({ RAZORPAY_KEY_SECRET: '', RAZORPAY_PLAN_ID_MONTHLY: '' }) };
  return { store, gateway, app: createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing }) };
}

beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(async () => { await server?.close(); server = undefined; vi.restoreAllMocks(); });

/** The body, the X-Request-Id header and the log line must agree, and nothing sensitive may appear anywhere. */
async function expectSafeAndCorrelated(r: Response, event: string) {
  const text = await r.text();
  const body = JSON.parse(text) as { success: boolean; error: string; code: string; requestId: string };
  expect(r.status).toBe(503);
  expect(body).toMatchObject({ success: false, code: 'billing_unavailable', error: GENERIC });
  expect(r.headers.get('retry-after')).toBe('10');
  expect(body.requestId).toBeTruthy();
  expect(r.headers.get('x-request-id')).toBe(body.requestId);
  const line = logged(event).find((l) => l.requestId === body.requestId);
  expect(line, `no ${event} log line with request id ${body.requestId}`).toBeDefined();
  const everything = text + JSON.stringify(logs());
  for (const secret of Object.values(SECRETS)) expect(everything).not.toContain(secret);
  expect(everything).not.toMatch(/stack|Bearer|authorization/i);
  return { body, line: line as Record<string, unknown> };
}

describe('missing environment configuration', () => {
  it('names the unset settings in the log (never their values), under the response request id; the body stays generic', async () => {
    const { app } = boot('unconfigured');
    server = await listen(app);
    const { line } = await expectSafeAndCorrelated(await create(), 'billing_not_configured');
    expect(line.reason).toBe('config');
    expect(line.problems).toEqual(expect.arrayContaining(['RAZORPAY_KEY_SECRET is not set.', 'RAZORPAY_PLAN_ID_MONTHLY must be a Razorpay plan id (plan_...).']));
  });
  it('the read-only status route reports the same way', async () => {
    const { app } = boot('unconfigured');
    server = await listen(app);
    const r = await fetch(server.base + '/api/billing/status', { headers: auth() });
    await expectSafeAndCorrelated(r, 'billing_not_configured');
  });
  it('an unauthenticated caller still gets 401 (the configuration state is not revealed before authentication)', async () => {
    const { app } = boot('unconfigured');
    server = await listen(app);
    const r = await fetch(server.base + '/api/billing/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"planKey":"monthly"}' });
    expect(r.status).toBe(401);
  });
});

describe('Razorpay failures', () => {
  it('authentication failure (401): generic 503 to the client, reason razorpay_auth + status in the log, and no trial or row is left behind', async () => {
    const { app, gateway, store } = boot();
    gateway.fail.fetchPlan = new RazorpayError('auth', 401, 'BAD_REQUEST_ERROR');
    server = await listen(app);
    const { line } = await expectSafeAndCorrelated(await create(), 'billing_unavailable');
    expect(line).toMatchObject({ reason: 'razorpay_auth', httpStatus: 401, upstreamCode: 'BAD_REQUEST_ERROR', method: 'POST', path: '/api/billing/subscriptions', userId: 'user-a' });
    expect(gateway.created).toHaveLength(0);
    expect(store.subs).toHaveLength(0);
    expect(store.claims.size).toBe(0);
  });
  it('authentication failure while creating the subscription: the intent row is marked failed, no trial is consumed, nothing is activated', async () => {
    const { app, gateway, store } = boot();
    gateway.fail.createSubscription = new RazorpayError('auth', 403);
    server = await listen(app);
    const { line } = await expectSafeAndCorrelated(await create(), 'billing_unavailable');
    expect(line.reason).toBe('razorpay_auth');
    expect(store.subs.every((s) => s.status !== 'authenticated' && s.status !== 'active' && !s.trial_start_at && !s.auth_verified_at)).toBe(true);
    expect([...store.claims.values()].some((c) => c.state === 'consumed')).toBe(false);
  });
  it('non-auth Razorpay failures keep their own codes and are NOT reported as billing_unavailable', async () => {
    for (const [err, status, code] of [
      [new RazorpayError('timeout', undefined, undefined, true), 504, 'billing_timeout'],
      [new RazorpayError('upstream', 502, undefined, true), 502, 'billing_upstream_error'],
      [new RazorpayError('rejected', 400), 409, 'billing_rejected']
    ] as const) {
      const { app, gateway } = boot();
      gateway.fail.fetchPlan = err;
      const s = await listen(app);
      const r = await fetch(s.base + '/api/billing/subscriptions', { method: 'POST', headers: auth(), body: JSON.stringify({ planKey: 'monthly' }) });
      expect(r.status).toBe(status);
      expect((await r.json()).code).toBe(code);
      await s.close();
    }
    expect(logged('billing_unavailable')).toHaveLength(0);
  });
});

describe('database failures', () => {
  it('a database error becomes the generic 503; the log carries op and SQLSTATE under the same request id', async () => {
    const { app, store } = boot();
    store.failNext.beginSubscription = true; // FakeStore raises BillingStoreError(op, 'XX000')
    server = await listen(app);
    const { line } = await expectSafeAndCorrelated(await create(), 'billing_unavailable');
    expect(line).toMatchObject({ reason: 'database', op: 'beginSubscription', sqlstate: 'XX000' });
  });
  it('a missing-table error (42P01) is distinguishable from a configuration problem in the log', async () => {
    const { app, store } = boot();
    store.beginSubscription = async () => { throw new BillingStoreError('begin_subscription', '42P01'); };
    server = await listen(app);
    const { line } = await expectSafeAndCorrelated(await create(), 'billing_unavailable');
    expect(line).toMatchObject({ reason: 'database', op: 'begin_subscription', sqlstate: '42P01' });
    expect(line.problems).toBeUndefined();
  });
});

describe('entitlement gate (BILLING_ENFORCEMENT=on) fails closed and says why', () => {
  it('a failing entitlement check returns the generic 503 and logs the cause with the request id', async () => {
    const app = express();
    app.use('/api', (req, res, next) => { req.requestId = 'req-test-0001'; res.setHeader('X-Request-Id', req.requestId); req.user = { id: 'user-a' } as never; next(); },
      createEntitlementGate({ mode: 'on', check: async () => { throw new BillingStoreError('entitlement', '42883'); } }), (_req, res) => res.json({ ok: true }));
    server = await listen(app);
    const r = await fetch(server.base + '/api/generate-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: 'billing_unavailable', requestId: 'req-test-0001' });
    expect(logged('entitlement_check_failed')[0]).toMatchObject({ requestId: 'req-test-0001', reason: 'database', op: 'entitlement', sqlstate: '42883' });
    expect(logged('entitlement_unavailable')[0]).toMatchObject({ requestId: 'req-test-0001' });
  });
  it('still never grants access when the check fails', async () => {
    const app = express();
    let reached = false;
    app.use('/api', (req, _res, next) => { req.requestId = 'req-test-0002'; req.user = { id: 'user-a' } as never; next(); },
      createEntitlementGate({ mode: 'on', check: async () => { throw new Error('boom'); } }), (_req, res) => { reached = true; res.json({ ok: true }); });
    server = await listen(app);
    expect((await fetch(server.base + '/api/generate-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(503);
    expect(reached).toBe(false);
  });
});

describe('after the cause is fixed', () => {
  it('the same request succeeds, returns the server-decided plan and trial terms, and logs no billing_unavailable', async () => {
    const { app, gateway, store } = boot();
    server = await listen(app);
    const r = await create();
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ success: true, planKey: 'monthly', amountPaise: 29900, currency: 'INR', trialEligible: true, trialDays: 3 });
    expect(r.headers.get('x-request-id')).toBeTruthy();
    expect(gateway.created).toHaveLength(1);
    // Creating a checkout never activates anything by itself: access still requires Razorpay-confirmed authorization.
    expect(store.subs[0].status).toBe('created');
    expect(store.subs[0].auth_verified_at).toBeFalsy();
    expect(logged('billing_unavailable')).toHaveLength(0);
  });
});

describe('describeBillingFailure', () => {
  it('classifies each failure family with static fields only', () => {
    expect(describeBillingFailure(new BillingUnavailableError('config', { problems: ['X is not set.'] }))).toEqual({ reason: 'config', problems: ['X is not set.'] });
    expect(describeBillingFailure(new RazorpayError('timeout', undefined))).toMatchObject({ reason: 'razorpay_timeout' });
    expect(describeBillingFailure(new BillingStoreError('get_live', '57014'))).toEqual({ reason: 'database', op: 'get_live', sqlstate: '57014' });
    expect(describeBillingFailure(new TypeError('secret-looking message'))).toEqual({ reason: 'unexpected', errName: 'TypeError' });
    expect(JSON.stringify(describeBillingFailure(new TypeError('secret-looking message')))).not.toContain('secret-looking');
  });
});
