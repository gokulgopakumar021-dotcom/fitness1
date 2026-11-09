// @vitest-environment node
/**
 * Stage 6: gap-filling tests found while mapping docs/billing/SECURITY_REVIEW.md to the master prompt's section 10 list.
 * Everything uses the in-memory fakes; no Razorpay or database call is made.
 */
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { listen } from '../security/testUtils';
import { loadBillingConfig } from './config';
import { createEntitlementGate } from './entitlement';
import { RazorpayError } from './gateway';
import { createBillingEntitlementGate } from './routes';
import { createBillingService } from './service';
import { hmacSha256Hex } from './signature';
import { FakeClock, FakeGateway, FakeStore, SECRETS, TEST_ENV, testBillingConfig } from './testFakes';

const user = { id: 'user-a', email: 'alice@example.com', emailVerified: true };
const keySig = (p: string, s: string) => hmacSha256Hex(SECRETS.keySecret, `${p}|${s}`);
const whSig = (b: Buffer) => hmacSha256Hex(SECRETS.webhookSecret, b);
const body = (event: string, subId: string, payId?: string) =>
  Buffer.from(JSON.stringify({ entity: 'event', event, created_at: 1_793_000_000, payload: { subscription: { entity: { id: subId } }, ...(payId ? { payment: { entity: { id: payId } } } : {}) } }));

function world() {
  const clock = new FakeClock();
  const config = testBillingConfig();
  const store = new FakeStore(clock);
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  return { clock, config, store, gateway, svc };
}
async function authorized() {
  const w = world();
  const subId = (await w.svc.createSubscription(user, 'monthly')).subscriptionId;
  w.gateway.authorize(subId, 'pay_Auth00001', 500);
  await w.svc.verifyAuthorization(user, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: subId, razorpay_signature: keySig('pay_Auth00001', subId) });
  return { ...w, subId };
}

// ------------------------------------------------------------------------------------------------ entitlement states at the gate
describe('entitlement gate: every state the database can report', () => {
  let srv: Awaited<ReturnType<typeof listen>> | undefined;
  afterEach(async () => { await srv?.close(); srv = undefined; });

  // The nine states of billing_get_entitlement() (see the Stage 1 migration). The master prompt's seven categories map onto them:
  // active trial = trialing, active paid = active, expired trial = trial_expired, cancelled = cancelled / cancelled_active,
  // payment pending = payment_pending, payment failed = payment_failed, subscription expired = expired.
  const STATES: Array<[string, boolean]> = [
    ['trialing', true], ['active', true], ['cancelled_active', true],
    ['payment_pending', false], ['payment_failed', false], ['trial_expired', false], ['cancelled', false], ['expired', false], ['none', false]
  ];

  it.each(STATES)('on: %s -> access %s, decided by the server-side state only', async (state, hasAccess) => {
    const app = express();
    app.use('/api', (req, _res, next) => { req.user = { id: 'user-a' } as never; next(); }, createEntitlementGate({ mode: 'on', check: async () => ({ state, hasAccess }) }), (_req, res) => res.json({ ok: true }));
    srv = await listen(app);
    const r = await fetch(srv.base + '/api/generate-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (hasAccess) {
      expect(r.status).toBe(200);
    } else {
      expect(r.status).toBe(402);
      expect(await r.json()).toMatchObject({ code: 'subscription_required', entitlement: { state } });
    }
  });

  it('a client-supplied "paid" claim in headers, query or body changes nothing', async () => {
    const app = express();
    app.use('/api', (req, _res, next) => { req.user = { id: 'user-a' } as never; next(); }, createEntitlementGate({ mode: 'on', check: async () => ({ state: 'none', hasAccess: false }) }), (_req, res) => res.json({ ok: true }));
    srv = await listen(app);
    const r = await fetch(srv.base + '/api/generate-plan?hasAccess=true&state=active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entitlement': 'active', 'x-has-access': 'true' },
      body: JSON.stringify({ hasAccess: true, entitlement: { state: 'active' }, subscription: { status: 'active' } })
    });
    expect(r.status).toBe(402);
  });
});

// ------------------------------------------------------------------------------------------------ enforcement misconfiguration
describe('BILLING_ENFORCEMENT misconfiguration is never silent', () => {
  let err: MockInstance<(...a: unknown[]) => void>;
  beforeEach(() => { err = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => err.mockRestore());

  it('accepts any letter case and surrounding spaces', () => {
    for (const [raw, want] of [['ON', 'on'], [' On ', 'on'], ['Shadow', 'shadow'], ['OFF', 'off']] as const) {
      const c = loadBillingConfig({ ...TEST_ENV, BILLING_ENFORCEMENT: raw });
      expect(c.enforcement, raw).toBe(want);
      expect(c.problems, raw).toEqual([]);
    }
  });
  it('an unrecognised value leaves the gate off (no lock-out) but logs an error at startup', () => {
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'enabled' });
    expect(config.enforcement).toBe('off');
    createBillingEntitlementGate({ config });
    const lines = err.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines.some((l: string) => l.includes('billing_enforcement_invalid'))).toBe(true);
    expect(lines.join('\n')).not.toContain('DO_NOT_LEAK');
  });
  it('a valid value logs nothing', () => {
    createBillingEntitlementGate({ config: testBillingConfig({ BILLING_ENFORCEMENT: 'on' }) });
    expect(err).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------------ duplicate creation, concurrently
describe('duplicate subscription creation under concurrency', () => {
  it('two simultaneous create calls by one user create exactly one Razorpay subscription; the other is told to wait (409)', async () => {
    const { svc, gateway, store } = world();
    const results = await Promise.allSettled([svc.createSubscription(user, 'monthly'), svc.createSubscription(user, 'monthly'), svc.createSubscription(user, 'monthly')]);
    expect(gateway.created).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ status: 409, code: 'subscription_in_progress' });
    expect(store.subs.filter((s) => s.user_id === user.id && s.status !== 'expired')).toHaveLength(1);
    expect(gateway.cancels).toEqual([]); // nothing was created and then thrown away
  });
  it('an intent row left behind by a crash (never reached Razorpay) is retired once it is old, so the user is not stuck', async () => {
    const { svc, gateway, store, clock } = world();
    await store.beginSubscription({ userId: user.id, emailHash: 'h', planKey: 'monthly', razorpayPlanId: 'plan_MonthlyTest01', billingPeriod: 'monthly', amountPaise: 29900, trialDays: 3, authWindowMinutes: 30 });
    await expect(svc.createSubscription(user, 'monthly')).rejects.toMatchObject({ status: 409, code: 'subscription_in_progress' }); // still young
    clock.advance(5 * 60_000);
    const r = await svc.createSubscription(user, 'monthly');
    expect(r.subscriptionId).toMatch(/^sub_/);
    expect(gateway.created).toHaveLength(1);
    expect(store.subs.filter((s) => s.user_id === user.id && s.status === 'expired')).toHaveLength(1);
  });
  it('different users do not block each other', async () => {
    const { svc, gateway } = world();
    await Promise.all([svc.createSubscription(user, 'monthly'), svc.createSubscription({ id: 'user-b', email: 'bob@example.com', emailVerified: true }, 'monthly')]);
    expect(gateway.created.length).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------------ webhook replay and concurrency
describe('webhook replay and concurrent delivery', () => {
  const charge = (t: Awaited<ReturnType<typeof authorized>>) => {
    Object.assign(t.gateway.subs.get(t.subId)!, { status: 'active', paid_count: 1, current_start: 1_793_000_000, current_end: 1_795_592_000 });
    t.gateway.payments.set('pay_Charge001', { id: 'pay_Charge001', status: 'captured', amount: 29900, currency: 'INR', method: 'upi', created_at: 1_793_000_000 });
  };

  it('the same signed body replayed under a DIFFERENT event id (the id header is not signed) is harmless: state converges, one payment', async () => {
    const t = await authorized();
    charge(t);
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    const first = await t.svc.handleWebhook(b, whSig(b), 'evt_first');
    const replay = await t.svc.handleWebhook(b, whSig(b), 'evt_replayed_with_new_id');
    expect(first.body.result).toBe('processed');
    expect(replay.status).toBe(200);
    const row = t.store.subs[0];
    expect(row.status).toBe('active');
    expect(row.paid_count).toBe(1);
    expect(t.store.payments.filter((p) => p.razorpayPaymentId === 'pay_Charge001')).toHaveLength(1);
    expect(t.store.payments.find((p) => p.razorpayPaymentId === 'pay_Charge001')?.kind).toBe('charge');
  });
  it('a replay can never grant more than Razorpay currently says (the event is a hint, Razorpay is the truth)', async () => {
    const t = await authorized();
    charge(t);
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    await t.svc.handleWebhook(b, whSig(b), 'evt_1');
    // Razorpay later cancels and the period is over; an old captured "charged" body is replayed.
    Object.assign(t.gateway.subs.get(t.subId)!, { status: 'cancelled' });
    await t.svc.handleWebhook(body('subscription.cancelled', t.subId), whSig(body('subscription.cancelled', t.subId)), 'evt_2');
    await t.svc.handleWebhook(b, whSig(b), 'evt_replay_3');
    expect(t.store.subs[0].status).toBe('cancelled');
  });
  it('two identical deliveries at the same instant are processed once', async () => {
    const t = await authorized();
    charge(t);
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    const [a, c] = await Promise.all([t.svc.handleWebhook(b, whSig(b), 'evt_same'), t.svc.handleWebhook(b, whSig(b), 'evt_same')]);
    const results = [a.body.result, c.body.result].sort();
    expect(results.filter((r) => r === 'processed')).toHaveLength(1);
    expect(results.some((r) => r === 'duplicate' || r === 'in_progress')).toBe(true);
    expect(t.store.payments.filter((p) => p.razorpayPaymentId === 'pay_Charge001')).toHaveLength(1);
  });
  it('payment failure: a subscription that Razorpay reports as halted is never given access by a "charged" body', async () => {
    const t = await authorized();
    Object.assign(t.gateway.subs.get(t.subId)!, { status: 'halted' });
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    t.gateway.payments.set('pay_Charge001', { id: 'pay_Charge001', status: 'captured', amount: 29900, currency: 'INR', method: 'card', created_at: 1_793_000_000 });
    await t.svc.handleWebhook(b, whSig(b), 'evt_forged_charge');
    expect(t.store.subs[0].status).toBe('halted');
    expect(await t.svc.checkEntitlement(user.id)).toMatchObject({ hasAccess: false });
  });
});

// ------------------------------------------------------------------------------------------------ nothing sensitive reaches the logs
describe('logs and responses carry no secret, even when dependencies fail with secret-bearing errors', () => {
  const spies: Array<MockInstance<(...a: unknown[]) => void>> = [];
  const out = () => spies.flatMap((s) => s.mock.calls.map((c: unknown[]) => c.map(String).join(' '))).join('\n');
  beforeEach(() => { for (const m of ['log', 'info', 'warn', 'error'] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {})); });
  afterEach(() => { spies.splice(0).forEach((s) => s.mockRestore()); });

  const leaky = `request to https://api.razorpay.com failed with Authorization: Basic ${Buffer.from(`rzp_test_abc123XYZ:${SECRETS.keySecret}`).toString('base64')} ${SECRETS.serviceRole} ${SECRETS.webhookSecret} ${SECRETS.pepper}`;
  const SECRET_RE = /DO_NOT_LEAK|rzp_test_abc123XYZ|cnpwX3Rlc3Rf/;

  it('an unexpected error thrown by the gateway is logged by name only and answered with a generic message', async () => {
    const { svc, gateway } = world();
    gateway.createSubscription = async () => { throw new Error(leaky); };
    const e = await svc.createSubscription(user, 'monthly').catch((x) => x);
    expect(JSON.stringify({ status: e.status, code: e.code, message: e.message })).not.toMatch(SECRET_RE);
    expect(out()).not.toMatch(SECRET_RE);
  });
  it('a Razorpay rejection carrying free text is reduced to a safe code in the response and the logs', async () => {
    const { svc, gateway } = world();
    gateway.fail.createSubscription = new RazorpayError('rejected', 400, 'BAD_REQUEST_ERROR');
    const e = await svc.createSubscription(user, 'monthly').catch((x) => x);
    expect(JSON.stringify({ status: e.status, code: e.code, message: e.message })).not.toMatch(SECRET_RE);
    expect(out()).not.toMatch(SECRET_RE);
  });
  it('an unexpected error while processing a webhook is retryable (500) and leaks nothing', async () => {
    const t = await authorized();
    t.gateway.fetchSubscription = async () => { throw new Error(leaky); };
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    const r = await t.svc.handleWebhook(b, whSig(b), 'evt_boom');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toMatch(SECRET_RE);
    expect(out()).not.toMatch(SECRET_RE);
  });
  it('a bad webhook signature logs nothing sensitive and does not echo the body or the signature', async () => {
    const t = await authorized();
    const b = body('subscription.charged', t.subId);
    const r = await t.svc.handleWebhook(b, 'f'.repeat(64), 'evt_bad');
    expect(r.status).toBe(400);
    expect(out()).not.toContain('f'.repeat(64));
    expect(out()).not.toContain(t.subId);
  });
  it('a database failure is reported with the operation name only', async () => {
    const { svc, store } = world();
    store.failNext.beginSubscription = true;
    const e = await svc.createSubscription(user, 'monthly').catch((x) => x);
    expect(e.status).toBe(503);
    expect(out()).not.toMatch(SECRET_RE);
    expect(out()).toContain('begin');
  });
});
