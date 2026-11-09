// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadBillingConfig } from './config';
import { hashEmail, normalizeEmail } from './emailHash';
import { hmacSha256Hex, safeEqualHex, verifyPaymentSignature, verifyWebhookSignature } from './signature';
import { SECRETS, TEST_ENV } from './testFakes';

describe('payment signature (Checkout)', () => {
  const sign = (pay: string, sub: string) => hmacSha256Hex(SECRETS.keySecret, `${pay}|${sub}`);
  const args = { paymentId: 'pay_Abc12345', subscriptionId: 'sub_Abc12345', keySecret: SECRETS.keySecret };
  it('accepts the documented HMAC over payment_id|subscription_id', () => {
    expect(verifyPaymentSignature({ ...args, signature: sign('pay_Abc12345', 'sub_Abc12345') })).toBe(true);
  });
  it('rejects a wrong signature, a signature for another subscription, and a swapped order', () => {
    expect(verifyPaymentSignature({ ...args, signature: 'a'.repeat(64) })).toBe(false);
    expect(verifyPaymentSignature({ ...args, signature: sign('pay_Abc12345', 'sub_Other9999') })).toBe(false);
    expect(verifyPaymentSignature({ ...args, signature: sign('sub_Abc12345', 'pay_Abc12345') })).toBe(false);
  });
  it('rejects malformed input without throwing', () => {
    for (const sig of ['', 'zz', 'a'.repeat(63), 'g'.repeat(64), undefined as unknown as string]) expect(verifyPaymentSignature({ ...args, signature: sig })).toBe(false);
    expect(verifyPaymentSignature({ ...args, keySecret: '', signature: sign('pay_Abc12345', 'sub_Abc12345') })).toBe(false);
  });
  it('safeEqualHex only equates identical 64-char hex', () => {
    expect(safeEqualHex('a'.repeat(64), 'a'.repeat(64))).toBe(true);
    expect(safeEqualHex('a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(safeEqualHex('abc', 'abc')).toBe(false);
  });
});

describe('webhook signature (raw body)', () => {
  const body = Buffer.from('{"event":"subscription.charged",  "payload":{}}\n'); // deliberate odd whitespace
  const good = hmacSha256Hex(SECRETS.webhookSecret, body);
  it('verifies the exact received bytes', () => expect(verifyWebhookSignature(body, good, SECRETS.webhookSecret)).toBe(true));
  it('fails if even whitespace differs (a re-serialised object never matches)', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString())));
    expect(verifyWebhookSignature(reserialised, good, SECRETS.webhookSecret)).toBe(false);
  });
  it('rejects missing/invalid signature, wrong secret, missing secret, empty body', () => {
    expect(verifyWebhookSignature(body, undefined, SECRETS.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(body, 'nope', SECRETS.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(body, good, 'another-secret')).toBe(false);
    expect(verifyWebhookSignature(body, good, undefined)).toBe(false);
    expect(verifyWebhookSignature(Buffer.alloc(0), good, SECRETS.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature('string-not-buffer' as unknown as Buffer, good, SECRETS.webhookSecret)).toBe(false);
  });
});

describe('trial-claim email hash', () => {
  it('normalises case, plus tags, Gmail dots and googlemail', () => {
    expect(normalizeEmail('  John.Doe+gym@Gmail.com ')).toBe('johndoe@gmail.com');
    expect(normalizeEmail('j.o.h.n@googlemail.com')).toBe('john@gmail.com');
    expect(normalizeEmail('a.b@example.com')).toBe('a.b@example.com'); // dots kept for other providers
    expect(normalizeEmail('nope')).toBeUndefined();
    expect(normalizeEmail('@x.com')).toBeUndefined();
  });
  it('is stable, peppered and never contains the address', () => {
    const a = hashEmail('A.b+x@gmail.com', SECRETS.pepper);
    expect(a).toBe(hashEmail('ab@gmail.com', SECRETS.pepper));
    expect(a).not.toBe(hashEmail('ab@gmail.com', 'a-different-pepper-0000'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('ab');
  });
});

describe('billing configuration', () => {
  it('uses the approved defaults', () => {
    const c = loadBillingConfig(TEST_ENV);
    expect(c.problems).toEqual([]);
    expect(c.configured).toBe(true);
    expect([c.plans.monthly.amountPaise, c.plans.annual.amountPaise]).toEqual([29900, 149900]);
    expect([c.plans.monthly.totalCount, c.plans.annual.totalCount]).toEqual([120, 10]);
    expect([c.trialDays, c.pendingGraceHours, c.authWindowMinutes, c.enforcement]).toEqual([3, 0, 30, 'off']);
  });
  it('is not configured when anything required is missing, and problem text never contains a value', () => {
    for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'BILLING_TRIAL_PEPPER', 'SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_PLAN_ID_MONTHLY']) {
      const env: Record<string, string | undefined> = { ...TEST_ENV, [k]: undefined };
      const c = loadBillingConfig(env);
      expect(c.configured, k).toBe(false);
      expect(JSON.stringify(c.problems)).not.toMatch(/DO_NOT_LEAK/);
    }
    expect(loadBillingConfig({}).configured).toBe(false);
  });
  it('refuses live keys unless explicitly allowed, and rejects bad numbers', () => {
    expect(loadBillingConfig({ ...TEST_ENV, RAZORPAY_KEY_ID: 'rzp_live_abc123XYZ' }).configured).toBe(false);
    expect(loadBillingConfig({ ...TEST_ENV, RAZORPAY_KEY_ID: 'rzp_live_abc123XYZ', BILLING_ALLOW_LIVE_KEYS: 'true' }).configured).toBe(true);
    for (const [k, v] of [['BILLING_PRICE_MONTHLY_PAISE', '0'], ['BILLING_PRICE_ANNUAL_PAISE', '1500001'], ['BILLING_TRIAL_DAYS', '99'], ['BILLING_PENDING_GRACE_HOURS', '-1'], ['BILLING_ENFORCEMENT', 'maybe'], ['RAZORPAY_PLAN_ID_ANNUAL', 'not-a-plan']]) {
      expect(loadBillingConfig({ ...TEST_ENV, [k]: v }).configured, k).toBe(false);
    }
  });
});
