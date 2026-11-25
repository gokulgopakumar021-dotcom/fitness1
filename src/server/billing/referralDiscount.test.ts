// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../security/errors';
import { discountedFirstChargePaise, issueFullPriceToken, verifyFullPriceToken } from './referralDiscount';
import { createBillingService, type DiscountChoiceResult } from './service';
import { FakeClock, FakeGateway, FakeStore, testBillingConfig } from './testFakes';

const OFFER = 'offer_Referral0001';
const userA = { id: 'user-a', email: 'alice@example.com', emailVerified: true };

function setup(over: Record<string, string> = { RAZORPAY_OFFER_ID_REFERRAL: OFFER }) {
  const clock = new FakeClock();
  const config = testBillingConfig(over);
  const store = new FakeStore(clock);
  store.partners.set('CREATOR20', { status: 'active' });
  store.partners.set('PAUSED20', { status: 'suspended' });
  const gateway = new FakeGateway(config);
  const svc = createBillingService({ config, store, gateway, now: clock.now });
  return { clock, config, store, gateway, svc };
}
const errCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? e.code : 'other'; } };
const isChoice = (r: unknown): r is DiscountChoiceResult => !!r && typeof r === 'object' && 'discountUnavailable' in r;

describe('pricing', () => {
  it('monthly is 399 and annual 1,499; first discounted monthly charge is exactly 319.20', () => {
    const c = testBillingConfig();
    expect([c.plans.monthly.amountPaise, c.plans.annual.amountPaise]).toEqual([39_900, 149_900]);
    expect(discountedFirstChargePaise(39_900)).toBe(31_920);
  });
  it('the referral offer id is optional, and a malformed one is a configuration problem', () => {
    expect(testBillingConfig().referralOfferId).toBeUndefined();
    expect(testBillingConfig({ RAZORPAY_OFFER_ID_REFERRAL: OFFER }).referralOfferId).toBe(OFFER);
    expect(testBillingConfig({ RAZORPAY_OFFER_ID_REFERRAL: 'bad id' }).problems.join()).toContain('RAZORPAY_OFFER_ID_REFERRAL');
  });
});

describe('creator code at checkout', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('a valid code on the monthly plan links the offer, keeps the trial and leaves the 5 rupee authorization alone', async () => {
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'creator20' });
    expect(isChoice(r)).toBe(false);
    if (isChoice(r)) return;
    expect(t.gateway.created[0].offer_id).toBe(OFFER);
    expect(t.gateway.created[0].start_at).toBeTypeOf('number'); // future start = trial
    expect(r.authorization).toEqual({ amountPaise: 500, refundable: true });
    expect(r.amountPaise).toBe(39_900);
    expect(r.referralDiscount).toEqual({ applied: true, firstChargePaise: 31_920, renewalPaise: 39_900 });
  });

  it('no code: no offer and no discount field', async () => {
    const r = await t.svc.createSubscription(userA, 'monthly', {});
    expect(t.gateway.created[0].offer_id).toBeUndefined();
    expect(isChoice(r) ? null : r.referralDiscount).toBeUndefined();
  });

  it('annual never gets the discount: a code on the annual plan is refused', async () => {
    expect(await errCode(t.svc.createSubscription(userA, 'annual', { referralCode: 'CREATOR20' }))).toBe('referral_monthly_only');
    expect(t.gateway.created).toHaveLength(0);
  });

  it.each([['UNKNOWN9', 'invalid_code'], ['PAUSED20', 'invalid_code']] as const)('code %s is refused with a choice and nothing is created at Razorpay', async (code, reason) => {
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: code });
    expect(isChoice(r) && r.reason).toBe(reason);
    expect(t.gateway.created).toHaveLength(0);
    expect(t.store.subs).toHaveLength(0);
  });

  it('a self-referral is refused', async () => {
    t.store.partners.set('MINE1234', { status: 'active', userId: userA.id });
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'MINE1234' });
    expect(isChoice(r) && r.reason).toBe('invalid_code');
  });

  it('with the offer switched off (no offer id) a code never silently charges full price', async () => {
    const off = setup({});
    const r = await off.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    expect(isChoice(r) && r.reason).toBe('not_configured');
    expect(off.gateway.created).toHaveLength(0);
  });

  it('a user whose trial is used gets a choice, not an immediate discounted or full charge', async () => {
    t.store.claims.set('x', { userId: userA.id, subscriptionId: null, state: 'consumed' });
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    expect(isChoice(r) && r.reason).toBe('trial_unavailable');
    expect(t.gateway.created).toHaveLength(0);
  });

  it('if Razorpay rejects the offer, checkout stops with a choice; the failed attempt is retired and no subscription is left behind', async () => {
    t.gateway.rejectOffer = true;
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    expect(isChoice(r) && r.reason).toBe('offer_rejected');
    expect(t.gateway.created).toHaveLength(1);
    expect(t.gateway.created.every((c) => c.offer_id === OFFER)).toBe(true); // never retried without the offer on our own
    expect(t.store.subs.every((s) => s.status === 'expired')).toBe(true);
  });

  it('if Razorpay returns a subscription without the offer linked, it is cancelled and the customer gets the choice', async () => {
    const orig = t.gateway.createSubscription.bind(t.gateway);
    t.gateway.createSubscription = async (p) => orig({ ...p, offer_id: undefined });
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    expect(isChoice(r) && r.reason).toBe('offer_rejected');
    expect(t.gateway.cancels).toHaveLength(1);
  });
});

describe('explicit full-price acceptance', () => {
  async function choiceAfterRejection() {
    const t = setup();
    t.gateway.rejectOffer = true;
    const r = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    if (!isChoice(r)) throw new Error('expected a choice');
    t.gateway.rejectOffer = false;
    return { t, r };
  }

  it('the token creates a normal 399 subscription with no offer, once', async () => {
    const { t, r } = await choiceAfterRejection();
    const ok = await t.svc.createSubscription(userA, 'monthly', { fullPriceToken: r.fullPriceToken, referralCode: 'CREATOR20' });
    expect(isChoice(ok)).toBe(false);
    const sent = t.gateway.created[t.gateway.created.length - 1];
    expect(sent.offer_id).toBeUndefined();
    expect(isChoice(ok) ? null : ok.referralDiscount).toBeUndefined();
  });

  it('the token cannot be replayed once it has been used', async () => {
    const { t, r } = await choiceAfterRejection();
    await t.svc.createSubscription(userA, 'monthly', { fullPriceToken: r.fullPriceToken });
    expect(await errCode(t.svc.createSubscription(userA, 'monthly', { fullPriceToken: r.fullPriceToken }))).toBe('full_price_token_invalid');
  });

  it('the token is bound to the user, the plan and the price', async () => {
    const { t, r } = await choiceAfterRejection();
    expect(await errCode(t.svc.createSubscription({ ...userA, id: 'user-b', email: 'bob@example.com' }, 'monthly', { fullPriceToken: r.fullPriceToken }))).toBe('full_price_token_invalid');
    expect(await errCode(t.svc.createSubscription(userA, 'annual', { fullPriceToken: r.fullPriceToken }))).toBe('full_price_token_invalid');
    const secret = t.config.trialPepper as string;
    const latest = t.store.subs[t.store.subs.length - 1].id;
    const wrongPrice = issueFullPriceToken(secret, { userId: userA.id, planKey: 'monthly', amountPaise: 29_900, latestRowId: latest }, t.clock.now());
    expect(await errCode(t.svc.createSubscription(userA, 'monthly', { fullPriceToken: wrongPrice }))).toBe('full_price_token_invalid');
  });

  it('the token expires and a tampered token fails', async () => {
    const { t, r } = await choiceAfterRejection();
    const secret = t.config.trialPepper as string;
    const b = { userId: userA.id, planKey: 'monthly' as const, amountPaise: 39_900, latestRowId: t.store.subs[t.store.subs.length - 1].id };
    const tok = issueFullPriceToken(secret, b, t.clock.now());
    expect(verifyFullPriceToken(secret, tok, b, t.clock.now() + 5 * 60_000)).toBe(true);
    expect(verifyFullPriceToken(secret, tok, b, t.clock.now() + 11 * 60_000)).toBe(false);
    expect(verifyFullPriceToken(secret, r.fullPriceToken.slice(0, -2) + 'xx', b, t.clock.now())).toBe(false);
    expect(verifyFullPriceToken('another-secret-of-16-chars', tok, b, t.clock.now())).toBe(false);
  });
});

describe('when the discount counts as used', () => {
  it('the 5 rupee authorization does not consume it, a failed payment does not, a captured monthly charge does', async () => {
    const t = setup();
    const first = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    if (isChoice(first)) throw new Error('unexpected choice');
    const row = t.store.subs[0];
    const pay = (id: string, kind: 'authorization' | 'charge', status: 'captured' | 'failed', amountPaise: number) =>
      t.store.recordPayment({ userId: userA.id, subscriptionId: row.id, razorpayPaymentId: id, razorpayInvoiceId: null, kind, status, amountPaise, amountRefundedPaise: 0, method: 'card', errorCode: null, paidAt: null, refundedAt: null });
    await pay('pay_Auth00001', 'authorization', 'captured', 500);
    await pay('pay_Fail00001', 'charge', 'failed', 31_920);
    expect(await t.store.referralEligibility(userA.id, 'CREATOR20', 'h')).toBe('eligible');
    await pay('pay_Chrg00001', 'charge', 'captured', 31_920);
    expect(await t.store.referralEligibility(userA.id, 'CREATOR20', 'h')).toBe('not_eligible');
  });

  it('a user who already paid the monthly charge gets a choice instead of a second discount', async () => {
    const t = setup();
    const first = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    if (isChoice(first)) throw new Error('unexpected choice');
    const row = t.store.subs[0];
    await t.store.recordPayment({ userId: userA.id, subscriptionId: row.id, razorpayPaymentId: 'pay_Chrg00002', razorpayInvoiceId: null, kind: 'charge', status: 'captured', amountPaise: 39_900, amountRefundedPaise: 0, method: 'card', errorCode: null, paidAt: null, refundedAt: null });
    const again = await t.svc.createSubscription(userA, 'monthly', { referralCode: 'CREATOR20' });
    expect(isChoice(again) && again.reason).toBe('not_eligible');
  });
});

describe('existing subscribers keep their stored price', () => {
  it('payment recovery re-uses the same subscription and the amount stored on it, not the new configured price', async () => {
    const t = setup();
    const r = await t.svc.createSubscription(userA, 'monthly');
    expect(r.amountPaise).toBe(39_900);
    const row = t.store.subs[0];
    // A subscriber created before the price change: stored 299, authorised, now with a failed renewal.
    Object.assign(row, { amount_paise: 29_900, status: 'pending', auth_verified_at: '2026-10-01T00:00:00.000Z' });
    t.gateway.subs.get(r.subscriptionId)!.status = 'pending';
    const rec = await t.svc.startRecovery(userA);
    expect(rec).toMatchObject({ subscriptionId: r.subscriptionId, amountPaise: 29_900 });
    expect(t.gateway.created).toHaveLength(1); // no new subscription was created
  });
});
