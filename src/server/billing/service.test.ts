// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../security/errors';
import { RazorpayError } from './gateway';
import { hashEmail } from './emailHash';
import { createBillingService } from './service';
import { hmacSha256Hex } from './signature';
import { BillingStoreError } from './store';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

const userA = { id: 'user-a', email: 'alice@example.com', emailVerified: true };
const userB = { id: 'user-b', email: 'bob@example.com', emailVerified: true };

function setup(over: Record<string, string> = {}) {
  const clock = new FakeClock();
  const config = testBillingConfig(over);
  const store = new FakeStore(clock);
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  return { clock, config, store, gateway, svc };
}
const sig = (pay: string, sub: string) => hmacSha256Hex(SECRETS.keySecret, `${pay}|${sub}`);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? e.code : `other:${(e as Error).message}`; } };

describe('subscription creation', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('creates a trial subscription with a future start_at equal to the trial end, using server-side plan data only', async () => {
    const r = await t.svc.createSubscription(userA, 'monthly');
    const sent = t.gateway.created[0];
    expect(sent.plan_id).toBe('plan_MonthlyTest01');
    expect(sent.total_count).toBe(120);
    expect(sent.start_at! * 1000).toBeGreaterThan(t.clock.now() + 3 * 86_400_000); // at least 3 days after "now", because the auth window comes first
    expect(new Date(r.firstChargeAt!).getTime()).toBe(sent.start_at! * 1000);
    expect(sent.expire_by).toBeLessThan(sent.start_at!);
    expect(sent.notes.user_id).toBe('user-a');
    expect(r).toMatchObject({ amountPaise: 29900, trialEligible: true, trialDays: 3, authorization: { amountPaise: 500, refundable: true }, keyId: 'rzp_test_abc123XYZ', reused: false });
    expect(JSON.stringify(r)).not.toContain(SECRETS.keySecret);
    expect(t.store.subs[0].status).toBe('created');
  });
  it('annual uses the annual plan, 149900 paise and total_count 10', async () => {
    const r = await t.svc.createSubscription(userA, 'annual');
    expect(r.amountPaise).toBe(149900);
    expect(t.gateway.created[0]).toMatchObject({ plan_id: 'plan_AnnualTest001', total_count: 10 });
  });
  it('refuses an unverified email and a missing email, and never calls Razorpay', async () => {
    expect(await code(t.svc.createSubscription({ ...userA, emailVerified: false }, 'monthly'))).toBe('email_not_verified');
    expect(await code(t.svc.createSubscription({ id: 'x', emailVerified: true }, 'monthly'))).toBe('email_not_verified');
    expect(t.gateway.created).toHaveLength(0);
  });
  it('refuses to start when the Razorpay plan amount differs from configuration', async () => {
    t.gateway.plans.get('plan_MonthlyTest01')!.item.amount = 49900;
    expect(await code(t.svc.createSubscription(userA, 'monthly'))).toBe('plan_mismatch');
    expect(t.gateway.created).toHaveLength(0);
  });
  it('is unavailable (503) when billing is not configured', async () => {
    const s = setup({ RAZORPAY_KEY_SECRET: '' });
    expect(await code(s.svc.createSubscription(userA, 'monthly'))).toBe('billing_unavailable');
  });
  it('prevents duplicate subscriptions: a second call reuses the same Razorpay subscription', async () => {
    const a = await t.svc.createSubscription(userA, 'monthly');
    const b = await t.svc.createSubscription(userA, 'monthly');
    expect(b.subscriptionId).toBe(a.subscriptionId);
    expect(b.reused).toBe(true);
    expect(t.gateway.created).toHaveLength(1);
    expect(t.store.subs).toHaveLength(1);
  });
  it('switching plan before authorizing cancels the unauthorized one at Razorpay first', async () => {
    const a = await t.svc.createSubscription(userA, 'monthly');
    const b = await t.svc.createSubscription(userA, 'annual');
    expect(t.gateway.cancels).toEqual([{ id: a.subscriptionId, cycleEnd: false }]);
    expect(b.subscriptionId).not.toBe(a.subscriptionId);
    expect(t.store.subs.filter((s) => s.status === 'created')).toHaveLength(1);
    expect(t.store.subs.find((s) => s.razorpay_subscription_id === a.subscriptionId)!.billing_stop_verified_at).not.toBeNull();
  });
  it('refuses a second subscription while one is authenticated or active', async () => {
    const a = await t.svc.createSubscription(userA, 'monthly');
    t.gateway.authorize(a.subscriptionId, 'pay_Auth00001', 500);
    await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: a.subscriptionId, razorpay_signature: sig('pay_Auth00001', a.subscriptionId) });
    expect(await code(t.svc.createSubscription(userA, 'annual'))).toBe('subscription_exists');
    expect(t.gateway.created).toHaveLength(1);
  });
  it('a failed Razorpay create expires the intent row and leaves the trial reusable', async () => {
    t.gateway.fail.createSubscription = new RazorpayError('upstream', 500, undefined, true);
    expect(await code(t.svc.createSubscription(userA, 'monthly'))).toBe('billing_upstream_error');
    expect(t.store.subs[0].status).toBe('expired');
    t.gateway.fail.createSubscription = undefined;
    const r = await t.svc.createSubscription(userA, 'monthly');
    expect(r.trialEligible).toBe(true);
  });
  it('maps timeouts to 504, auth failures to a generic 503, and rejections to 409 without leaking details', async () => {
    t.gateway.fail.fetchPlan = new RazorpayError('timeout', undefined, undefined, true);
    expect(await code(t.svc.createSubscription(userA, 'monthly'))).toBe('billing_timeout');
    const s2 = setup();
    s2.gateway.fail.fetchPlan = new RazorpayError('auth', 401, 'BAD_REQUEST_ERROR');
    expect(await code(s2.svc.createSubscription(userA, 'monthly'))).toBe('billing_unavailable');
    const s3 = setup();
    s3.gateway.fail.createSubscription = new RazorpayError('rejected', 400, 'BAD_REQUEST_ERROR');
    expect(await code(s3.svc.createSubscription(userA, 'monthly'))).toBe('billing_rejected');
  });
  it('database errors become a safe 503 and nothing is sent to Razorpay', async () => {
    t.store.failNext.beginSubscription = true;
    expect(await code(t.svc.createSubscription(userA, 'monthly'))).toBe('billing_unavailable');
    expect(t.gateway.created).toHaveLength(0);
  });
  it('if the Razorpay id cannot be saved, the new Razorpay subscription is cancelled (no orphan mandate)', async () => {
    t.store.failNext.attachRazorpayId = true;
    expect(await code(t.svc.createSubscription(userA, 'monthly'))).toBe('billing_unavailable');
    expect(t.gateway.cancels).toHaveLength(1);
    expect(t.store.subs[0].status).toBe('expired');
  });
  it('a user whose trial is used gets no start_at and an authorization equal to the full plan amount', async () => {
    const hash = hashEmail(userA.email, SECRETS.pepper)!;
    t.store.claims.set(hash, { userId: userA.id, subscriptionId: null, state: 'consumed' });
    const r = await t.svc.createSubscription(userA, 'monthly');
    expect(r.trialEligible).toBe(false);
    expect(r.firstChargeAt).toBeNull();
    expect(r.authorization).toEqual({ amountPaise: 29900, refundable: false });
    expect(t.gateway.created[0].start_at).toBeUndefined();
  });
  it('the same confirmed email on a new account (after deletion) gets no second trial', async () => {
    const hash = hashEmail('alice@example.com', SECRETS.pepper)!;
    t.store.claims.set(hash, { userId: null, subscriptionId: null, state: 'consumed' });
    const r = await t.svc.createSubscription({ ...userA, id: 'user-a-new', email: 'Alice+promo@Example.com' }, 'monthly');
    expect(r.trialEligible).toBe(false); // case and plus tag normalise to the claimed address
  });
});

describe('authorization verification', () => {
  let t: ReturnType<typeof setup>;
  let subId: string;
  beforeEach(async () => { t = setup(); subId = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId; });
  const body = (pay = 'pay_Auth00001', s = subId, signature = sig(pay, s)) => ({ razorpay_payment_id: pay, razorpay_subscription_id: s, razorpay_signature: signature });

  it('valid signature + Razorpay confirmation starts the trial, records the INR 5 authorization, consumes the claim', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    const r = await t.svc.verifyAuthorization(userA, body());
    expect(r.verified).toBe(true);
    const row = t.store.subs[0];
    expect(row.status).toBe('authenticated');
    expect(row.auth_verified_at).not.toBeNull();
    expect(row.trial_start_at).not.toBeNull();
    expect(row.razorpay_customer_id).toBe('cust_Test0001');
    expect(t.store.payments).toHaveLength(1);
    expect(t.store.payments[0]).toMatchObject({ kind: 'authorization', amountPaise: 500, status: 'refunded' });
    expect([...t.store.claims.values()][0].state).toBe('consumed');
    expect((await t.store.getEntitlement('user-a')).has_access).toBe(true);
  });
  it('an invalid signature changes nothing', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    expect(await code(t.svc.verifyAuthorization(userA, body('pay_Auth00001', subId, 'f'.repeat(64))))).toBe('invalid_signature');
    expect(t.store.subs[0].status).toBe('created');
    expect(t.store.payments).toHaveLength(0);
    expect((await t.store.getEntitlement('user-a')).has_access).toBe(false);
  });
  it('a signature for a different payment id is rejected', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    expect(await code(t.svc.verifyAuthorization(userA, { ...body(), razorpay_payment_id: 'pay_Other0002' }))).toBe('invalid_signature');
  });
  it('a valid signature alone grants nothing while Razorpay still says created', async () => {
    expect(await code(t.svc.verifyAuthorization(userA, body()))).toBe('authorization_not_confirmed');
    expect(t.store.subs[0].status).toBe('created');
    expect((await t.store.getEntitlement('user-a')).has_access).toBe(false);
  });
  it("another user cannot verify, read or affect someone else's subscription (indistinguishable from unknown)", async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    expect(await code(t.svc.verifyAuthorization(userB, body()))).toBe('subscription_not_found');
    expect(await code(t.svc.verifyAuthorization(userB, body('pay_Auth00001', 'sub_DoesNotExist1')))).toBe('subscription_not_found');
    expect(t.store.subs[0].status).toBe('created');
  });
  it('is idempotent: a repeat verify records one payment and does not touch trial_start_at', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    await t.svc.verifyAuthorization(userA, body());
    const first = t.store.subs[0].trial_start_at;
    t.clock.advance(60_000);
    const again = await t.svc.verifyAuthorization(userA, body());
    expect(again.alreadyVerified).toBe(true);
    expect(t.store.payments).toHaveLength(1);
    expect(t.store.subs[0].trial_start_at).toBe(first);
  });
  it('an unknown Razorpay status is never treated as success', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    t.gateway.subs.get(subId)!.status = 'mystery';
    expect(await code(t.svc.verifyAuthorization(userA, body()))).toBe('authorization_not_confirmed');
    expect(t.store.subs[0].status).toBe('created');
  });
  it('a Razorpay outage after a valid signature returns a retryable error and grants nothing', async () => {
    t.gateway.authorize(subId, 'pay_Auth00001', 500);
    t.gateway.fail.fetchSubscription = new RazorpayError('timeout', undefined, undefined, true);
    expect(await code(t.svc.verifyAuthorization(userA, body()))).toBe('billing_timeout');
    expect(t.store.subs[0].auth_verified_at).toBeNull();
  });
});

describe('cancellation and entitlement', () => {
  async function authorized() {
    const t = setup();
    const id = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId;
    t.gateway.authorize(id, 'pay_Auth00001', 500);
    await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig('pay_Auth00001', id) });
    return { ...t, id };
  }
  it('cancelling during the trial cancels billing now and keeps access to the original trial end', async () => {
    const t = await authorized();
    const r = await t.svc.cancel(userA);
    expect(t.gateway.cancels.at(-1)).toEqual({ id: t.id, cycleEnd: false });
    const row = t.store.subs[0];
    expect(row.status).toBe('cancelled');
    expect(r.accessEndsAt).toBe(row.trial_end_at);
    expect(row.billing_stop_verified_at).not.toBeNull();
  });
  it('cancelling a paid subscription uses cycle-end, stays active, and keeps access to the paid period end', async () => {
    const t = await authorized();
    const s = t.gateway.subs.get(t.id)!;
    s.status = 'active'; s.paid_count = 1; s.current_start = 1_793_000_000; s.current_end = 1_795_592_000; s.charge_at = 1_795_592_000;
    const r = await t.svc.cancel(userA);
    expect(t.gateway.cancels.at(-1)).toEqual({ id: t.id, cycleEnd: true });
    const row = t.store.subs[0];
    expect(row.status).toBe('active');
    expect(row.cancel_at_cycle_end).toBe(true);
    expect(r.accessEndsAt).toBe(new Date(1_795_592_000 * 1000).toISOString());
    expect(row.billing_stop_verified_at).toBeNull(); // Razorpay has not reported a terminal state yet
  });
  it('repeating a cycle-end cancel is idempotent', async () => {
    const t = await authorized();
    const s = t.gateway.subs.get(t.id)!; s.status = 'active'; s.paid_count = 1; s.current_end = 1_795_592_000;
    await t.svc.cancel(userA);
    const again = await t.svc.cancel(userA);
    expect(again.alreadyRequested).toBe(true);
    expect(t.gateway.cancels).toHaveLength(1);
  });
  it('cancel with nothing to cancel is 404, and only ever touches the caller\'s own subscription', async () => {
    const t = await authorized();
    expect(await code(t.svc.cancel(userB))).toBe('no_active_subscription');
    expect(t.gateway.cancels).toHaveLength(0);
  });
  it('an unauthorized (created) subscription can be abandoned', async () => {
    const t = setup();
    await t.svc.createSubscription(userA, 'monthly');
    await t.svc.cancel(userA);
    expect(t.store.subs[0].status).toBe('cancelled');
  });
});

describe('status and payments', () => {
  it('reports server-configured plans, trial eligibility and the INR 5 disclosure data, with no Razorpay ids', async () => {
    const t = setup();
    const s = await t.svc.getStatus(userA);
    expect(s.plans.map((p) => [p.key, p.amountPaise])).toEqual([['monthly', 29900], ['annual', 149900]]);
    expect(s.trial).toMatchObject({ eligible: true, days: 3, verificationDebit: { amountPaise: 500, refundedAutomatically: true } });
    expect(s.entitlement.hasAccess).toBe(false);
    await t.svc.createSubscription(userA, 'monthly');
    const after = await t.svc.getStatus(userA);
    expect(JSON.stringify(after)).not.toMatch(/sub_Test|plan_Monthly|cust_/);
  });
  it('an unverified email is never offered a trial', async () => {
    const s = await setup().svc.getStatus({ ...userA, emailVerified: false });
    expect(s.trial.eligible).toBe(false);
  });
  it('payment history is scoped to the caller', async () => {
    const t = setup();
    const id = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId;
    t.gateway.authorize(id, 'pay_Auth00001', 500);
    await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig('pay_Auth00001', id) });
    expect((await t.svc.listPayments(userA)).length).toBe(1);
    expect(await t.svc.listPayments(userB)).toEqual([]);
  });
  it('database failure on status is a safe 503', async () => {
    const t = setup();
    t.store.failNext.entitlement = true;
    expect(await code(t.svc.getStatus(userA))).toBe('billing_unavailable');
    void BillingStoreError;
  });
});
