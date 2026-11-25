// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: vi.fn() }; } }));

import { createApp } from '../app';
import { ApiError } from '../security/errors';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { issueFullPriceToken } from './referralDiscount';
import { createBillingService, type DiscountChoiceResult } from './service';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

const OFFER = 'offer_Referral0001';
const userA = { id: 'user-a', email: 'alice@example.com', emailVerified: true };

function setup(over: Record<string, string> = { RAZORPAY_OFFER_ID_REFERRAL: OFFER }) {
  const clock = new FakeClock();
  const config = testBillingConfig(over);
  const store = new FakeStore(clock);
  store.partners.set('CREATOR20', { status: 'active' });
  store.partners.set('PAUSED20', { status: 'suspended' });
  store.partners.set('SELFCODE1', { status: 'active', userId: 'user-a' });
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  return { clock, config, store, gateway, svc };
}
const errCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? e.code : 'other'; } };
const isChoice = (r: unknown): r is DiscountChoiceResult => !!r && typeof r === 'object' && 'discountUnavailable' in r;

describe('sign-up attribution (service)', () => {
  it('a valid code is recorded with the signed-in user, source signup', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'creator20');
    expect(t.store.attributions.get('user-a')).toEqual({ code: 'CREATOR20', status: 'active' });
  });

  it.each([['UNKNOWN9'], ['PAUSED20'], ['SELFCODE1'], ['ab'], ['has space'], ['TOOLONGCODE0123456789XYZ'], [''], [undefined], [42], [{ code: 'CREATOR20' }]])(
    'a wrong code (%j) resolves exactly like a good one and attributes nothing',
    async (code) => {
      const t = setup();
      await expect(t.svc.attributeReferral(userA, code)).resolves.toBeUndefined();
      expect(t.store.attributions.has('user-a')).toBe(false);
    }
  );

  it('malformed codes never reach the database', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'ab');
    await t.svc.attributeReferral(userA, undefined);
    expect(t.store.signupAttempts).toHaveLength(0);
  });

  it('first touch is immutable: a second code does not replace the first', async () => {
    const t = setup();
    t.store.partners.set('OTHER2026', { status: 'active' });
    await t.svc.attributeReferral(userA, 'CREATOR20');
    await t.svc.attributeReferral(userA, 'OTHER2026');
    expect(t.store.attributions.get('user-a')?.code).toBe('CREATOR20');
  });

  it('a user who already has a billing row is silently not attributed', async () => {
    const t = setup();
    await t.svc.createSubscription(userA, 'monthly', {});
    await expect(t.svc.attributeReferral(userA, 'CREATOR20')).resolves.toBeUndefined();
    expect(t.store.attributions.has('user-a')).toBe(false);
  });

  it('an unverified email is refused (same rule as the other billing routes)', async () => {
    const t = setup();
    expect(await errCode(t.svc.attributeReferral({ ...userA, emailVerified: false }, 'CREATOR20'))).toBe('email_not_verified');
    expect(t.store.signupAttempts).toHaveLength(0);
  });

  it('a database failure is an error (so the browser keeps the code), never a hint about the code', async () => {
    const t = setup();
    t.store.failNext.attributeSignup = true;
    expect(await errCode(t.svc.attributeReferral(userA, 'CREATOR20'))).not.toBe('ok');
    await t.svc.attributeReferral(userA, 'CREATOR20');
    expect(t.store.attributions.has('user-a')).toBe(true);
  });
});

describe('auto-apply at checkout for an attributed user', () => {
  it('monthly with no typed code links the offer, keeps the trial and the 5 rupee verification payment is not discounted', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(isChoice(r)).toBe(false);
    if (isChoice(r)) return;
    expect(t.gateway.created[0].offer_id).toBe(OFFER);
    expect(t.gateway.created[0].start_at).toBeTypeOf('number');
    expect(r.authorization).toEqual({ amountPaise: 500, refundable: true });
    expect(r.amountPaise).toBe(39_900);
    expect(r.referralDiscount).toEqual({ applied: true, firstChargePaise: 31_920, renewalPaise: 39_900 });
  });

  it('annual never gets the discount', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const r = await t.svc.createSubscription(userA, 'annual', {});
    expect(t.gateway.created[0].offer_id).toBeUndefined();
    expect(isChoice(r) ? null : r.referralDiscount).toBeUndefined();
  });

  it('a user who was never attributed gets no offer and no choice', async () => {
    const t = setup();
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(t.gateway.created[0].offer_id).toBeUndefined();
    expect(isChoice(r)).toBe(false);
  });

  it('after a captured monthly charge the discount is used up: a later monthly checkout links no offer', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const first = await t.svc.createSubscription(userA, 'monthly', {});
    if (isChoice(first)) throw new Error('unexpected choice');
    const row = t.store.subs[0];
    t.store.payments.push({ id: 'p1', userId: 'user-a', subscriptionId: row.id, razorpayPaymentId: 'pay_Charge0001', kind: 'charge', status: 'captured', amountPaise: 31_920, amountRefundedPaise: 0, method: 'card', paidAt: null, refundedAt: null } as never);
    expect(await t.store.activeReferral('user-a')).toBe(false);
    // the first subscription ends (cancelled and verified stopped), then the customer subscribes again
    row.status = 'cancelled'; row.ended_at = new Date(t.clock.now()).toISOString(); row.billing_stop_verified_at = row.ended_at;
    const again = await t.svc.createSubscription(userA, 'monthly', {});
    expect(isChoice(again)).toBe(false);
    expect(t.gateway.created).toHaveLength(2);
    expect(t.gateway.created[1].offer_id).toBeUndefined();
  });

  it('a failed or authorization-only payment leaves the discount unused', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const first = await t.svc.createSubscription(userA, 'monthly', {});
    if (isChoice(first)) throw new Error('unexpected choice');
    const row = t.store.subs[0];
    const base = { userId: 'user-a', subscriptionId: row.id, amountRefundedPaise: 0, method: 'card', paidAt: null, refundedAt: null } as const;
    t.store.payments.push({ ...base, id: 'p1', razorpayPaymentId: 'pay_Auth00001', kind: 'authorization', status: 'captured', amountPaise: 500 } as never);
    t.store.payments.push({ ...base, id: 'p2', razorpayPaymentId: 'pay_Fail00001', kind: 'charge', status: 'failed', amountPaise: 31_920 } as never);
    expect(await t.store.activeReferral('user-a')).toBe(true);
  });

  it('Razorpay refusing the offer stops with a choice: nothing is created and full price is never charged on its own', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    t.gateway.rejectOffer = true;
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(isChoice(r) && r.reason).toBe('offer_rejected');
    expect(t.gateway.created.filter((c) => !c.offer_id)).toHaveLength(0);
    expect(t.store.subs.every((s) => s.status === 'expired')).toBe(true);
  });

  it('no trial available: stop and choose, nothing created', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    t.store.claims.set('someone-else-hash', { userId: 'other', subscriptionId: null, state: 'consumed' });
    t.store.claims.set('x', { userId: 'user-a', subscriptionId: null, state: 'consumed' });
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(isChoice(r) && r.reason).toBe('trial_unavailable');
    expect(t.gateway.created).toHaveLength(0);
  });

  it('the one-time full-price token still wins over auto-apply (explicit 399)', async () => {
    const t = setup();
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const token = issueFullPriceToken(SECRETS.pepper, { userId: 'user-a', planKey: 'monthly', amountPaise: 39_900, latestRowId: 'none' }, t.clock.now());
    const r = await t.svc.createSubscription(userA, 'monthly', { fullPriceToken: token });
    expect(isChoice(r)).toBe(false);
    expect(t.gateway.created[0].offer_id).toBeUndefined();
    expect(isChoice(r) ? null : r.referralDiscount).toBeUndefined();
  });

  it('with the offer not configured nothing is promised and nothing changes', async () => {
    const t = setup({});
    await t.svc.attributeReferral(userA, 'CREATOR20');
    const status = await t.svc.getStatus(userA);
    expect(status.referral).toEqual({ enabled: false, attributed: false });
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(isChoice(r)).toBe(false);
    expect(t.gateway.created[0].offer_id).toBeUndefined();
  });

  it('status tells the client the discount is attached (display only)', async () => {
    const t = setup();
    expect((await t.svc.getStatus(userA)).referral).toEqual({ enabled: true, attributed: false });
    await t.svc.attributeReferral(userA, 'CREATOR20');
    expect((await t.svc.getStatus(userA)).referral).toEqual({ enabled: true, attributed: true });
  });

  it('a typed code at checkout still works as the fallback', async () => {
    const t = setup();
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'creator20' });
    expect(isChoice(r)).toBe(false);
    expect(t.gateway.created[0].offer_id).toBe(OFFER);
  });
});

describe('POST /api/billing/referral/attribute', () => {
  let server: Awaited<ReturnType<typeof listen>>;
  let store: FakeStore;
  beforeEach(async () => {
    const clock = new FakeClock();
    const config = testBillingConfig({ RAZORPAY_OFFER_ID_REFERRAL: OFFER });
    store = new FakeStore(clock);
    store.partners.set('CREATOR20', { status: 'active' });
    store.partners.set('PAUSED20', { status: 'suspended' });
    const service = createBillingService({ config, store, gateway: new FakeGateway(config), now: clock.now });
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing: { service } }));
  });
  afterEach(async () => { await server.close(); });

  const auth = (sub: string, extra: Record<string, unknown> = {}) => ({ authorization: `Bearer ${fakeToken({ sub, email: `${sub}@example.com`, ...extra })}`, 'content-type': 'application/json' });
  const post = (headers: Record<string, string>, body: unknown) => fetch(server.base + '/api/billing/referral/attribute', { method: 'POST', headers, body: JSON.stringify(body) });

  it('requires a verified Supabase token', async () => {
    expect((await post({ 'content-type': 'application/json' }, { code: 'CREATOR20' })).status).toBe(401);
    expect(store.signupAttempts).toHaveLength(0);
  });

  it('attributes the token user; a user id in the body is ignored', async () => {
    const r = await post(auth('user-a'), { code: 'CREATOR20', userId: 'user-b', referred_user_id: 'user-b' });
    expect(r.status).toBe(200);
    expect(store.attributions.has('user-a')).toBe(true);
    expect(store.attributions.has('user-b')).toBe(false);
  });

  it('good, unknown, inactive and malformed codes get the same status and the same body', async () => {
    const answers: Array<[number, string]> = [];
    for (const [i, code] of ['CREATOR20', 'UNKNOWN9', 'PAUSED20', 'ab!'].entries()) {
      const r = await post(auth(`user-${i}`), { code });
      answers.push([r.status, JSON.stringify(await r.json())]);
    }
    expect(new Set(answers.map((a) => a.join('|'))).size).toBe(1);
    expect(answers[0]).toEqual([200, JSON.stringify({ success: true })]);
  });

  it('an unverified email is refused and records nothing', async () => {
    const r = await post(auth('user-a', { verified: false }), { code: 'CREATOR20' });
    expect(r.status).toBe(403);
    expect(store.attributions.size).toBe(0);
  });

  it('is rate limited like the other billing routes (5 per minute)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post(auth('user-rl'), { code: 'UNKNOWN9' })).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toContain(429);
  });
});
