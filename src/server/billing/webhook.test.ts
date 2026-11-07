// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { RazorpayError } from './gateway';
import { createBillingService } from './service';
import { hmacSha256Hex, sha256Hex } from './signature';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

const user = { id: 'user-a', email: 'alice@example.com', emailVerified: true };
const sign = (b: Buffer) => hmacSha256Hex(SECRETS.webhookSecret, b);
const body = (event: string, subId: string, payId?: string) => Buffer.from(JSON.stringify({ entity: 'event', event, created_at: 1_793_000_000, payload: { subscription: { entity: { id: subId } }, ...(payId ? { payment: { entity: { id: payId } } } : {}) } }));

async function setup() {
  const clock = new FakeClock();
  const config = testBillingConfig();
  const store = new FakeStore(clock);
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  const subId = (await svc.createSubscription(user, 'monthly')).subscriptionId;
  gateway.authorize(subId, 'pay_Auth00001', 500);
  const sig = (p: string, s: string) => hmacSha256Hex(SECRETS.keySecret, `${p}|${s}`);
  await svc.verifyAuthorization(user, { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: subId, razorpay_signature: sig('pay_Auth00001', subId) });
  return { clock, config, store, gateway, svc, subId };
}
const deliver = (t: Awaited<ReturnType<typeof setup>>, b: Buffer, id: string, signature = sign(b)) => t.svc.handleWebhook(b, signature, id);

/** Razorpay's view after the trial converts and the first INR 299 charge succeeds. */
const charged = (t: Awaited<ReturnType<typeof setup>>) => {
  const s = t.gateway.subs.get(t.subId)!;
  Object.assign(s, { status: 'active', paid_count: 1, current_start: 1_793_000_000, current_end: 1_795_592_000, charge_at: 1_795_592_000 });
  t.gateway.payments.set('pay_Charge001', { id: 'pay_Charge001', status: 'captured', amount: 29900, currency: 'INR', method: 'upi', created_at: 1_793_000_000 });
};

describe('webhook processing', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });

  it('rejects an invalid signature before touching the database', async () => {
    const b = body('subscription.charged', t.subId);
    t.store.calls.length = 0;
    const r = await deliver(t, b, 'evt_001', 'a'.repeat(64));
    expect(r.status).toBe(400);
    expect(t.store.calls).toEqual([]);
    expect(t.store.events.size).toBe(0);
  });
  it('rejects a body modified after signing', async () => {
    const b = body('subscription.charged', t.subId);
    const r = await deliver(t, Buffer.concat([b, Buffer.from(' ')]), 'evt_001', sign(b));
    expect(r.status).toBe(400);
  });
  it('rejects a missing event id and invalid JSON (even when correctly signed)', async () => {
    const b = body('subscription.charged', t.subId);
    expect((await t.svc.handleWebhook(b, sign(b), undefined)).status).toBe(400);
    const junk = Buffer.from('not json');
    expect((await t.svc.handleWebhook(junk, sign(junk), 'evt_9')).status).toBe(400);
  });
  it('subscription.charged re-fetches Razorpay, moves to active/paid, records the charge', async () => {
    charged(t);
    const r = await deliver(t, body('subscription.charged', t.subId, 'pay_Charge001'), 'evt_002');
    expect(r).toEqual({ status: 200, body: { received: true, result: 'processed' } });
    const row = t.store.subs[0];
    expect(row).toMatchObject({ status: 'active', payment_status: 'paid', paid_count: 1 });
    expect(row.next_billing_at).toBe(new Date(1_795_592_000 * 1000).toISOString());
    expect(t.store.payments.find((p) => p.razorpayPaymentId === 'pay_Charge001')).toMatchObject({ kind: 'charge', status: 'captured', amountPaise: 29900 });
    expect(t.store.events.get('evt_002')!.status).toBe('processed');
  });
  it('writes Razorpay\'s state, not the webhook\'s claim (a forged-looking payload cannot grant access)', async () => {
    // Event says "charged" but Razorpay still reports authenticated: the mirror must stay authenticated and unpaid.
    await deliver(t, body('subscription.charged', t.subId, 'pay_Charge001'), 'evt_003');
    expect(t.store.subs[0]).toMatchObject({ status: 'authenticated', paid_count: 0 });
  });
  it('duplicate delivery is acknowledged and does no work', async () => {
    charged(t);
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    await deliver(t, b, 'evt_004');
    t.gateway.created.length = 0;
    const before = t.store.payments.length;
    const dup = await deliver(t, b, 'evt_004');
    expect(dup).toEqual({ status: 200, body: { received: true, result: 'duplicate' } });
    expect(t.store.payments).toHaveLength(before);
  });
  it('an in-progress delivery returns 409 so Razorpay retries', async () => {
    t.store.events.set('evt_005', { status: 'received', type: 'subscription.charged', code: null });
    expect((await deliver(t, body('subscription.charged', t.subId), 'evt_005')).status).toBe(409);
  });
  it('a failed attempt is marked failed (HTTP 500) and the retry succeeds', async () => {
    charged(t);
    t.gateway.fail.fetchSubscription = new RazorpayError('timeout', undefined, undefined, true);
    const b = body('subscription.charged', t.subId, 'pay_Charge001');
    expect((await deliver(t, b, 'evt_006')).status).toBe(500);
    expect(t.store.events.get('evt_006')!.status).toBe('failed');
    t.gateway.fail.fetchSubscription = undefined;
    expect((await deliver(t, b, 'evt_006')).body.result).toBe('processed');
    expect(t.store.subs[0].status).toBe('active');
  });
  it('database failure while processing returns 500 (retry), never 200', async () => {
    charged(t);
    t.store.failNext.applyPatch = true;
    expect((await deliver(t, body('subscription.charged', t.subId), 'evt_007')).status).toBe(500);
  });
  it('an event for a subscription we do not know is ignored, not retried forever', async () => {
    const r = await deliver(t, body('subscription.charged', 'sub_SomeoneElse01'), 'evt_008');
    expect(r.status).toBe(200);
    expect(t.store.events.get('evt_008')).toMatchObject({ status: 'ignored', code: 'unknown_subscription' });
  });
  it('unhandled event types are recorded as ignored', async () => {
    const r = await deliver(t, body('payment.captured', t.subId), 'evt_009');
    expect(r.body.result).toBe('ignored');
  });
  it('pending -> halted maps to retrying -> failed, with no access', async () => {
    charged(t);
    await deliver(t, body('subscription.charged', t.subId, 'pay_Charge001'), 'evt_010');
    t.gateway.subs.get(t.subId)!.status = 'pending';
    await deliver(t, body('subscription.pending', t.subId), 'evt_011');
    expect(t.store.subs[0]).toMatchObject({ status: 'pending', payment_status: 'retrying' });
    t.gateway.subs.get(t.subId)!.status = 'halted';
    await deliver(t, body('subscription.halted', t.subId), 'evt_012');
    expect(t.store.subs[0]).toMatchObject({ status: 'halted', payment_status: 'failed' });
    expect((await t.store.getEntitlement('user-a')).has_access).toBe(false);
  });
  it('subscription.cancelled finalises the row, keeps promised access, and records a verified stop', async () => {
    charged(t);
    await deliver(t, body('subscription.charged', t.subId, 'pay_Charge001'), 'evt_013');
    t.gateway.subs.get(t.subId)!.status = 'cancelled';
    await deliver(t, body('subscription.cancelled', t.subId), 'evt_014');
    const row = t.store.subs[0];
    expect(row.status).toBe('cancelled');
    expect(row.access_ends_at).toBe(new Date(1_795_592_000 * 1000).toISOString());
    expect(row.billing_stop_verified_at).not.toBeNull();
  });
  it('a terminal subscription is never moved back by a stale event', async () => {
    t.gateway.subs.get(t.subId)!.status = 'cancelled';
    await deliver(t, body('subscription.cancelled', t.subId), 'evt_015');
    t.gateway.subs.get(t.subId)!.status = 'active';
    await deliver(t, body('subscription.activated', t.subId), 'evt_016');
    expect(t.store.subs[0].status).toBe('cancelled');
  });
  it('an unknown Razorpay status fails the event and changes nothing', async () => {
    t.gateway.subs.get(t.subId)!.status = 'brand_new_state';
    const r = await deliver(t, body('subscription.updated', t.subId), 'evt_017');
    expect(r.status).toBe(500);
    expect(t.store.subs[0].status).toBe('authenticated');
  });
  it('an orphaned subscription (owner deleted) is cancelled at Razorpay and its stop recorded', async () => {
    t.store.subs[0].user_id = null;
    const r = await deliver(t, body('subscription.charged', t.subId), 'evt_018');
    expect(r.body.result).toBe('orphan_cancelled');
    expect(t.gateway.cancels.at(-1)).toEqual({ id: t.subId, cycleEnd: false });
    expect(t.store.subs[0].billing_stop_verified_at).not.toBeNull();
  });
  it('stores a SHA-256 digest of the body, never the body', async () => {
    const b = body('subscription.charged', t.subId);
    expect(sha256Hex(b)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...t.store.events.values()])).not.toContain('payload');
  });
});

describe('reconciler', () => {
  it('flags an INR 5 authorization that Razorpay does not show as refunded', async () => {
    const t = await setup();
    t.gateway.payments.set('pay_Auth00001', { ...t.gateway.payments.get('pay_Auth00001')!, refund_status: null, amount_refunded: 0 });
    t.store.payments[0].status = 'captured';
    const r = await t.svc.reconcileBatch();
    expect(r.unrefunded).toBe(1);
  });
  it('a refunded authorization is recorded and not flagged', async () => {
    const t = await setup();
    t.store.payments[0].status = 'authorized';
    const r = await t.svc.reconcileBatch();
    expect(r.unrefunded).toBe(0);
    expect(t.store.payments[0].status).toBe('refunded');
  });
});
