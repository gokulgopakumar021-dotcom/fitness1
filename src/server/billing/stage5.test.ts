// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: vi.fn() }; } }));

import { createApp } from '../app';
import { ApiError } from '../security/errors';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { RazorpayError } from './gateway';
import { createBillingService } from './service';
import { hmacSha256Hex } from './signature';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

const userA = { id: 'user-a', email: 'alice@example.com', emailVerified: true };
const userB = { id: 'user-b', email: 'bob@example.com', emailVerified: true };
const sigOf = (p: string, s: string) => hmacSha256Hex(SECRETS.keySecret, `${p}|${s}`);
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ApiError ? e.code : `other:${String(e)}`));
const whSign = (b: Buffer) => hmacSha256Hex(SECRETS.webhookSecret, b);
const whBody = (event: string, subId: string) => Buffer.from(JSON.stringify({ entity: 'event', event, created_at: 1_793_000_000, payload: { subscription: { entity: { id: subId } } } }));

function setup() {
  const clock = new FakeClock();
  const config = testBillingConfig();
  const store = new FakeStore(clock);
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  return { clock, config, store, gateway, svc };
}
type T = ReturnType<typeof setup>;

/** A user who authorized during the trial (Razorpay: authenticated). */
async function trialing(t: T, user = userA, payOver: Record<string, unknown> = {}) {
  const id = (await t.svc.createSubscription(user, 'monthly')).subscriptionId;
  t.gateway.authorize(id, 'pay_Auth00001', 500, payOver);
  await t.svc.verifyAuthorization(user, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Auth00001', id) });
  return id;
}
const rzpState = (t: T, id: string, over: Record<string, unknown>) => Object.assign(t.gateway.subs.get(id)!, over);
const asActive = (t: T, id: string) => rzpState(t, id, { status: 'active', paid_count: 1, current_start: 1_793_000_000, current_end: 1_795_592_000, charge_at: 1_795_592_000 });

/** Paid for one cycle, then the renewal failed: Razorpay says `pending` or `halted`. */
async function failedRenewal(t: T, status: 'pending' | 'halted') {
  const id = await trialing(t);
  const charged = whBody('subscription.charged', id);
  asActive(t, id);
  await t.svc.handleWebhook(charged, whSign(charged), `evt_paid_${id}`); // mirror the paid state
  t.clock.advance(61_000);
  rzpState(t, id, { status, paid_count: 1 });
  const failed = whBody(`subscription.${status}`, id);
  await t.svc.handleWebhook(failed, whSign(failed), `evt_${status}_${id}`); // Razorpay's webhook moves the mirror to pending/halted
  return id;
}

describe('payment recovery (pending and halted)', () => {
  let t: T;
  beforeEach(() => { t = setup(); });

  it.each(['pending', 'halted'] as const)('returns Checkout parameters for a %s subscription, re-reading Razorpay first', async (status) => {
    const id = await failedRenewal(t, status);
    const r = await t.svc.startRecovery(userA);
    expect(r).toMatchObject({ subscriptionId: id, keyId: 'rzp_test_abc123XYZ', planKey: 'monthly', amountPaise: 29900, status, cardChangeOnly: true });
    expect(t.store.subs[0].status).toBe(status);
    expect(JSON.stringify(r)).not.toContain(SECRETS.keySecret);
  });
  it('refuses when nothing needs recovery: no subscription, trialing, active, or one that already healed at Razorpay', async () => {
    expect(await code(t.svc.startRecovery(userA))).toBe('recovery_not_available');
    const id = await trialing(t);
    expect(await code(t.svc.startRecovery(userA))).toBe('recovery_not_available');
    asActive(t, id);
    expect(await code(t.svc.startRecovery(userA))).toBe('recovery_not_available');
    rzpState(t, id, { status: 'halted' });
    t.clock.advance(61_000);
    rzpState(t, id, { status: 'active' }); // healed from Razorpay's emailed link before the user opened Checkout
    expect(await code(t.svc.startRecovery(userA))).toBe('recovery_not_available');
    expect(t.store.subs[0].status).toBe('active');
  });
  it('never exposes another user\'s subscription: user B has nothing to recover', async () => {
    await failedRenewal(t, 'halted');
    expect(await code(t.svc.startRecovery(userB))).toBe('recovery_not_available');
  });
  it('an unauthorized (created) subscription is not a recovery case', async () => {
    await t.svc.createSubscription(userA, 'monthly');
    expect(await code(t.svc.startRecovery(userA))).toBe('recovery_not_available');
  });
  it('a Razorpay failure is a safe error and changes nothing', async () => {
    await failedRenewal(t, 'halted');
    t.gateway.fail.fetchSubscription = new RazorpayError('upstream', 502, undefined, true);
    expect(await code(t.svc.startRecovery(userA))).toBe('billing_upstream_error');
    expect(t.store.subs[0].status).toBe('halted'); // mirror untouched (still the last good state)
  });

  describe('confirming the Checkout result through /verify', () => {
    it('an invalid signature changes nothing and does not even ask Razorpay', async () => {
      const id = await failedRenewal(t, 'halted');
      const fetches = vi.spyOn(t.gateway, 'fetchSubscription');
      const r = await code(t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Recover001', razorpay_subscription_id: id, razorpay_signature: 'a'.repeat(64) }));
      expect(r).toBe('invalid_signature');
      expect(fetches).not.toHaveBeenCalled();
      expect(t.store.subs[0].status).toBe('halted');
    });
    it('a valid signature is not enough: while Razorpay still says halted it is 409 and nothing is granted', async () => {
      const id = await failedRenewal(t, 'halted');
      const r = await code(t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Recover001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Recover001', id) }));
      expect(r).toBe('authorization_not_confirmed');
      expect(t.store.subs[0].status).toBe('halted');
      expect(t.store.subs[0].payment_status).toBe('failed');
    });
    it('once Razorpay says active again, the mirror is updated and the response says recovered', async () => {
      const id = await failedRenewal(t, 'halted');
      rzpState(t, id, { status: 'active', paid_count: 2, current_start: 1_795_592_000, current_end: 1_798_184_000, charge_at: 1_798_184_000 });
      const r = await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Recover001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Recover001', id) });
      expect(r).toMatchObject({ verified: true, alreadyVerified: true, recovered: true });
      expect(t.store.subs[0]).toMatchObject({ status: 'active', payment_status: 'paid', paid_count: 2 });
    });
    it('records no payment from the callback itself (the charge arrives as subscription.charged)', async () => {
      const id = await failedRenewal(t, 'pending');
      rzpState(t, id, { status: 'active', paid_count: 2, current_end: 1_798_184_000 });
      const before = t.store.payments.length;
      await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Recover001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Recover001', id) });
      expect(t.store.payments).toHaveLength(before);
    });
    it('another user cannot confirm someone else\'s recovery', async () => {
      const id = await failedRenewal(t, 'halted');
      rzpState(t, id, { status: 'active', paid_count: 2 });
      const r = await code(t.svc.verifyAuthorization(userB, { razorpay_payment_id: 'pay_Recover001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Recover001', id) }));
      expect(r).toBe('subscription_not_found');
      expect(t.store.subs[0].status).toBe('halted');
    });
  });

  it('a halted subscription that Razorpay has since reactivated is healed by a status read (not left showing "payment failed")', async () => {
    const id = await failedRenewal(t, 'halted');
    await t.svc.getStatus(userA);
    expect(t.store.subs[0].status).toBe('halted');
    t.clock.advance(61_000);
    rzpState(t, id, { status: 'active', paid_count: 2, current_end: 1_798_184_000 });
    const s = await t.svc.getStatus(userA);
    expect(s.subscription?.status).toBe('active');
  });
  it('the subscription.activated webhook heals a halted subscription idempotently', async () => {
    const id = await failedRenewal(t, 'halted');
    await t.svc.getStatus(userA);
    rzpState(t, id, { status: 'active', paid_count: 2, current_end: 1_798_184_000 });
    const b = whBody('subscription.activated', id);
    expect((await t.svc.handleWebhook(b, whSign(b), 'evt_heal')).body.result).toBe('processed');
    expect(t.store.subs[0].status).toBe('active');
    expect((await t.svc.handleWebhook(b, whSign(b), 'evt_heal')).body.result).toBe('duplicate');
  });
});

describe('account deletion: cancel first, then delete', () => {
  let t: T;
  beforeEach(() => { t = setup(); });

  it('a user with no billing is ready at once, and the database gate agrees', async () => {
    expect(await t.svc.deletionCheck(userA)).toMatchObject({ requires: 'none' });
    expect(await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false })).toMatchObject({ ready: true, requires: 'none', cancelled: 0 });
    expect(t.gateway.cancels).toHaveLength(0);
    expect(t.store.deleteAccount('user-a')).toBe('deleted');
  });

  it('without this flow the database gate refuses (BL001) for every live state', async () => {
    const id = await trialing(t);
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
    asActive(t, id);
    await t.svc.getStatus(userA);
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
  });

  it('trial: no confirmation needed; Razorpay is cancelled now, stop is verified, then deletion succeeds', async () => {
    const id = await trialing(t);
    expect(await t.svc.deletionCheck(userA)).toMatchObject({ requires: 'cancel_billing' });
    const r = await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    expect(r).toMatchObject({ ready: true, cancelled: 1 });
    expect(t.gateway.cancels).toEqual([{ id, cycleEnd: false }]);
    expect(t.store.subs[0]).toMatchObject({ status: 'cancelled' });
    expect(t.store.subs[0].billing_stop_verified_at).not.toBeNull();
    expect(t.store.deleteAccount('user-a')).toBe('deleted');
  });

  it('paid: refuses without explicit confirmation and does NOT cancel at Razorpay', async () => {
    const id = await trialing(t);
    asActive(t, id);
    expect(await t.svc.deletionCheck(userA)).toMatchObject({ requires: 'confirm_cancel_paid', accessEndsAt: new Date(1_795_592_000 * 1000).toISOString() });
    const r = await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    expect(r).toMatchObject({ ready: false, requires: 'confirm_cancel_paid', cancelled: 0 });
    expect(t.gateway.cancels).toHaveLength(0);
    expect(t.store.subs[0].status).toBe('active');
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
  });
  it('paid: with confirmation it cancels immediately (not at cycle end), access ends now, stop is verified, deletion succeeds', async () => {
    const id = await trialing(t);
    asActive(t, id);
    const r = await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: true });
    expect(r).toMatchObject({ ready: true, cancelled: 1 });
    expect(t.gateway.cancels).toEqual([{ id, cycleEnd: false }]);
    const row = t.store.subs[0];
    expect(row.status).toBe('cancelled');
    expect(row.access_ends_at).toBe(new Date(t.clock.now()).toISOString());
    expect(row.billing_stop_verified_at).not.toBeNull();
    expect(t.store.deleteAccount('user-a')).toBe('deleted');
  });
  it('a trial that converted to paid since the mirror was written is detected from Razorpay and needs confirmation', async () => {
    const id = await trialing(t); // mirror: authenticated
    asActive(t, id); // Razorpay: active (webhook not processed yet)
    expect(t.store.subs[0].status).toBe('authenticated');
    expect(await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false })).toMatchObject({ ready: false, requires: 'confirm_cancel_paid' });
  });
  it.each(['pending', 'halted'] as const)('%s: cancelled now without a paid-access confirmation (there is no paid access to lose)', async (status) => {
    const id = await failedRenewal(t, status);
    const r = await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    expect(r).toMatchObject({ ready: true, cancelled: 1 });
    expect(t.gateway.cancels).toEqual([{ id, cycleEnd: false }]);
    expect(t.store.deleteAccount('user-a')).toBe('deleted');
  });
  it('an unauthorized (created) subscription is cancelled at Razorpay so Checkout can never be finished after deleting', async () => {
    const id = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId;
    expect(await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false })).toMatchObject({ ready: true });
    expect(t.gateway.cancels).toEqual([{ id, cycleEnd: false }]);
    expect(t.gateway.subs.get(id)!.status).toBe('cancelled');
  });
  it('a row that never reached Razorpay is retired locally, with no Razorpay call', async () => {
    t.store.failNext.attachRazorpayId = true;
    await code(t.svc.createSubscription(userA, 'monthly')); // leaves an expired intent row with no Razorpay id
    expect(await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false })).toMatchObject({ ready: true, cancelled: 0 });
  });
  it('a terminal row that was never verified (lost webhook) is verified from Razorpay, so deletion is not blocked forever', async () => {
    const id = await trialing(t);
    rzpState(t, id, { status: 'cancelled' });
    t.store.subs[0].status = 'cancelled'; // mirror terminal, but billing_stop_verified_at is null
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
    expect(await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false })).toMatchObject({ ready: true });
    expect(t.store.deleteAccount('user-a')).toBe('deleted');
  });
  it('if Razorpay does not report a terminal status, it is 409 and deletion stays blocked', async () => {
    const id = await trialing(t);
    vi.spyOn(t.gateway, 'cancelSubscription').mockResolvedValue({ ...t.gateway.subs.get(id)!, status: 'authenticated' });
    expect(await code(t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false }))).toBe('cancellation_not_confirmed');
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
  });
  it('a Razorpay timeout is a safe 504 and nothing is marked stopped', async () => {
    await trialing(t);
    t.gateway.fail.cancelSubscription = new RazorpayError('timeout', undefined, undefined, true);
    expect(await code(t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false }))).toBe('billing_timeout');
    expect(t.store.subs[0].billing_stop_verified_at).toBeNull();
    expect(t.store.deleteAccount('user-a')).toBe('billing_cancellation_required');
  });
  it('a database failure is a safe 503 and nothing is sent to Razorpay', async () => {
    await trialing(t);
    t.gateway.cancels.length = 0;
    t.store.failNext.listBlockingForUser = true;
    expect(await code(t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false }))).toBe('billing_unavailable');
    expect(t.gateway.cancels).toHaveLength(0);
  });
  it('only ever touches the caller\'s subscriptions: user B\'s are untouched', async () => {
    const a = await trialing(t, userA);
    const b = (await t.svc.createSubscription(userB, 'annual')).subscriptionId;
    await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: true });
    expect(t.gateway.cancels.map((c) => c.id)).toEqual([a]);
    expect(t.gateway.subs.get(b)!.status).toBe('created');
  });
  it('is idempotent: running it twice cancels once', async () => {
    await trialing(t);
    await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    expect(t.gateway.cancels).toHaveLength(1);
  });
});

describe('orphaned subscriptions and the refunded INR 5 after deletion (end to end)', () => {
  let t: T;
  beforeEach(() => { t = setup(); });

  it('after a verified cancel-and-delete, late webhooks are processed without cancelling again or creating payments for nobody', async () => {
    const id = await trialing(t);
    await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    t.store.deleteAccount('user-a');
    expect(t.store.subs[0].user_id).toBeNull();
    const b = whBody('subscription.cancelled', id);
    const r = await t.svc.handleWebhook(b, whSign(b), 'evt_late');
    expect(r.body.result).toBe('processed');
    expect(t.gateway.cancels).toHaveLength(1);
    expect(t.store.subs[0].status).toBe('cancelled');
  });
  it('an orphan that is still live (deleted outside the gate, e.g. from the Supabase dashboard) is cancelled by its next webhook', async () => {
    const id = await trialing(t);
    asActive(t, id);
    t.store.subs[0].user_id = null; // what on-delete-set-null leaves behind
    t.gateway.cancels.length = 0;
    const b = whBody('subscription.charged', id);
    const r = await t.svc.handleWebhook(b, whSign(b), 'evt_orphan');
    expect(r.body.result).toBe('orphan_cancelled');
    expect(t.gateway.cancels).toEqual([{ id, cycleEnd: false }]);
    expect(t.store.subs[0]).toMatchObject({ status: 'cancelled' });
    expect(t.store.subs[0].billing_stop_verified_at).not.toBeNull();
    // a duplicate delivery does nothing more
    expect((await t.svc.handleWebhook(b, whSign(b), 'evt_orphan')).body.result).toBe('duplicate');
    expect(t.gateway.cancels).toHaveLength(1);
  });
  it('an orphan whose Razorpay cancel fails is reported as failed (HTTP 500) so Razorpay retries, and is not marked stopped', async () => {
    const id = await trialing(t);
    t.store.subs[0].user_id = null;
    t.gateway.fail.cancelSubscription = new RazorpayError('upstream', 502, undefined, true);
    const b = whBody('subscription.charged', id);
    const r = await t.svc.handleWebhook(b, whSign(b), 'evt_orphan2');
    expect(r.status).toBe(500);
    expect(t.store.subs[0].billing_stop_verified_at).toBeNull();
    expect(t.store.events.get('evt_orphan2')!.status).toBe('failed');
  });
  it('the reconciler still checks the INR 5 refund of a deleted account, and records it with no user attached', async () => {
    const id = await trialing(t, userA, { refund_status: null, amount_refunded: 0 });
    expect(t.store.payments[0].status).toBe('captured');
    await t.svc.prepareDeletion(userA, { confirmCancelPaidNow: false });
    t.store.deleteAccount('user-a');
    expect(t.store.payments[0].userId).toBeNull();
    const first = await t.svc.reconcileBatch();
    expect(first.unrefunded).toBe(1);
    t.gateway.payments.set('pay_Auth00001', { ...t.gateway.payments.get('pay_Auth00001')!, refund_status: 'full', amount_refunded: 500 });
    const second = await t.svc.reconcileBatch();
    expect(second.unrefunded).toBe(0);
    expect(t.store.payments[0]).toMatchObject({ status: 'refunded', userId: null });
    expect(id).toBeTruthy();
  });
});

describe('reconciler alerting', () => {
  it('flags an authorization whose payment id was never recorded (lost browser callback) after an hour, for seven days', async () => {
    const t = setup();
    const id = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId;
    t.gateway.authorize(id, 'pay_Auth00001', 500);
    // The browser callback is lost: Razorpay is authenticated and a status read mirrors it, with no payment row.
    t.clock.advance(31 * 60_000); // past expire_by, so a status read re-fetches the subscription
    await t.svc.getStatus(userA);
    expect(t.store.subs[0].auth_verified_at).not.toBeNull();
    expect(t.store.payments).toHaveLength(0);
    expect((await t.svc.reconcileBatch()).authPaymentMissing).toBe(0); // too recent
    t.clock.advance(3_700_000);
    const r = await t.svc.reconcileBatch();
    expect(r).toMatchObject({ authPaymentMissing: 1, alerts: 1 });
    t.clock.advance(8 * 86_400_000);
    expect((await t.svc.reconcileBatch()).authPaymentMissing).toBe(0); // out of the alert window
  });
  it('a healthy run raises no alert', async () => {
    const t = setup();
    await trialing(t);
    t.clock.advance(2 * 3_600_000);
    expect(await t.svc.reconcileBatch()).toMatchObject({ unrefunded: 0, authPaymentMissing: 0, alerts: 0, failed: 0 });
  });
});

describe('HTTP: recovery and deletion routes', () => {
  let server: Awaited<ReturnType<typeof listen>>;
  let t: T;
  const auth = (sub: string) => ({ authorization: `Bearer ${fakeToken({ sub, email: `${sub}@example.com` })}`, 'content-type': 'application/json' });
  const post = (path: string, headers: Record<string, string>, body: unknown) => fetch(server.base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  beforeEach(async () => {
    t = setup();
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing: { service: t.svc } }));
    return async () => { await server.close(); };
  });

  it('all three routes require a verified token', async () => {
    for (const [m, p] of [['POST', '/api/billing/subscriptions/recover'], ['GET', '/api/billing/account/deletion-check'], ['POST', '/api/billing/account/prepare-deletion']]) {
      const r = await fetch(server.base + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });
  it('prepare-deletion takes consent from a strict boolean in the body only', async () => {
    const id = (await t.svc.createSubscription(userA, 'monthly')).subscriptionId;
    t.gateway.authorize(id, 'pay_Auth00001', 500);
    await t.svc.verifyAuthorization(userA, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sigOf('pay_Auth00001', id) });
    asActive(t, id);
    for (const bad of ['true', 1]) {
      const r = await post('/api/billing/account/prepare-deletion', auth('user-a'), { confirmCancelPaidNow: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post('/api/billing/account/prepare-deletion?confirmCancelPaidNow=true', auth('user-a'), {})).status).toBe(200);
    expect(t.gateway.cancels).toHaveLength(0); // a query string is not consent
    const ok = await post('/api/billing/account/prepare-deletion', auth('user-a'), { confirmCancelPaidNow: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, ready: true });
    expect(t.gateway.cancels).toHaveLength(1);
  });
  it('responses carry no Razorpay ids other than the Checkout subscription id, and are never cached', async () => {
    const id = await failedRenewal(t, 'halted');
    const r = await post('/api/billing/subscriptions/recover', auth('user-a'), {});
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    expect(text).toContain(id);
    expect(text).not.toMatch(/cust_|pay_|plan_|key_secret|DO_NOT_LEAK/);
    const check = await fetch(server.base + '/api/billing/account/deletion-check', { headers: auth('user-a') });
    expect(await check.text()).not.toMatch(/sub_|cust_|pay_|plan_/);
  });
  it('user B gets nothing from user A\'s subscription on any of the three routes', async () => {
    await failedRenewal(t, 'halted');
    expect((await post('/api/billing/subscriptions/recover', auth('user-b'), {})).status).toBe(409);
    const check = await (await fetch(server.base + '/api/billing/account/deletion-check', { headers: auth('user-b') })).json();
    expect(check).toMatchObject({ requires: 'none', subscription: null });
    expect(await (await post('/api/billing/account/prepare-deletion', auth('user-b'), { confirmCancelPaidNow: true })).json()).toMatchObject({ ready: true, cancelled: 0 });
    expect(t.gateway.cancels).toHaveLength(0);
  });
});
