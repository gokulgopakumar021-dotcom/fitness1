import { describe, expect, it } from 'vitest';
import type { BillingPayment, BillingPlan, BillingStatus } from '../lib/billingApi';
import { accessEndDate, buildDisclosure, daysRemaining, formatInr, panelState, paymentLabel, sameLocalDay } from './billingPresentation';

const monthly: BillingPlan = { key: 'monthly', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly', interval: 1 };
const annual: BillingPlan = { key: 'annual', amountPaise: 149900, currency: 'INR', billingPeriod: 'yearly', interval: 1 };

const status = (over: Partial<BillingStatus> = {}): BillingStatus => ({
  enforcement: 'off',
  emailVerified: true,
  trial: { eligible: true, days: 3, firstChargePreviewAt: '2026-11-13T12:00:00Z', verificationDebit: { amountPaise: 500, refundedAutomatically: true } },
  plans: [monthly, annual],
  entitlement: { state: 'none', hasAccess: false, accessEndsAt: null },
  subscription: null,
  ...over
});

describe('formatInr', () => {
  it('formats whole rupees without decimals and keeps paise', () => {
    expect(formatInr(29900)).toBe('₹299');
    expect(formatInr(149900)).toBe('₹1,499');
    expect(formatInr(500)).toBe('₹5');
    expect(formatInr(12950)).toBe('₹129.50');
  });
});

describe('daysRemaining', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  it('rounds up, never goes negative, and handles missing dates', () => {
    expect(daysRemaining('2026-11-13T12:00:00Z', now)).toBe(3);
    expect(daysRemaining('2026-11-12T13:00:00Z', now)).toBe(3);
    expect(daysRemaining('2026-11-10T12:00:01Z', now)).toBe(1);
    expect(daysRemaining('2026-11-09T12:00:00Z', now)).toBe(0);
    expect(daysRemaining(null, now)).toBe(0);
    expect(daysRemaining('not a date', now)).toBe(0);
  });
});

describe('sameLocalDay', () => {
  it('compares calendar days and rejects bad input', () => {
    expect(sameLocalDay('2026-11-13T12:00:00Z', '2026-11-13T12:30:00Z')).toBe(true);
    expect(sameLocalDay('2026-11-13T12:00:00Z', '2026-11-15T12:00:00Z')).toBe(false);
    expect(sameLocalDay(null, '2026-11-13T12:00:00Z')).toBe(false);
  });
});

describe('panelState', () => {
  it('follows the server entitlement state', () => {
    for (const s of ['trialing', 'active', 'cancelled_active', 'payment_pending', 'payment_failed', 'trial_expired', 'cancelled'] as const) {
      expect(panelState(status({ entitlement: { state: s, hasAccess: false, accessEndsAt: null } }))).toBe(s);
    }
  });
  it('reports a subscription that never reached authorisation as unfinished, and unknown states as none', () => {
    const sub = { status: 'created' } as BillingStatus['subscription'];
    expect(panelState(status({ subscription: sub }))).toBe('unfinished');
    expect(panelState(status({ entitlement: { state: 'something_new', hasAccess: false, accessEndsAt: null } }))).toBe('none');
  });
  it('accessEndDate prefers the entitlement and falls back to the subscription row', () => {
    expect(accessEndDate(status({ entitlement: { state: 'trialing', hasAccess: true, accessEndsAt: '2026-11-13T00:00:00Z' } }))).toBe('2026-11-13T00:00:00Z');
    expect(accessEndDate(status({ subscription: { accessEndsAt: '2026-12-01T00:00:00Z' } as BillingStatus['subscription'] }))).toBe('2026-12-01T00:00:00Z');
  });
});

describe('buildDisclosure (what the person reads before Checkout)', () => {
  const trial = buildDisclosure({ plan: monthly, trialEligible: true, trialDays: 3, verificationDebitPaise: 500, firstChargeAt: '2026-11-13T12:00:00Z' }).join('\n');
  const noTrial = buildDisclosure({ plan: annual, trialEligible: false, trialDays: 3, verificationDebitPaise: 500, firstChargeAt: null }).join('\n');

  it('discloses amount, interval, trial length, first charge date, the verification debit and its automatic refund, renewal and cancellation', () => {
    expect(trial).toContain('₹299 per month');
    expect(trial).toContain('3-day trial');
    expect(trial).toContain('₹5 card verification debit');
    expect(trial).toMatch(/refunds it automatically/);
    expect(trial).toContain('13 Nov 2026');
    expect(trial).toMatch(/renews every month at ₹299 until you cancel/);
    expect(trial).toMatch(/cancel in Settings, then Billing/);
  });
  it('never calls the trial free and never says "no charge"', () => {
    for (const text of [trial, noTrial]) {
      expect(text).not.toMatch(/\bfree\b/i);
      expect(text).not.toMatch(/no charge|not charged|won't be charged|zero/i);
    }
  });
  it('limits the ₹5 claim to cards and points other methods at Checkout', () => {
    expect(trial).toMatch(/card verification debit/);
    expect(trial).toMatch(/UPI or e-mandate, check the amount shown in Razorpay Checkout/);
  });
  it('says the full price is charged today, with no verification debit, when there is no trial', () => {
    expect(noTrial).toContain('Charged today: ₹1,499');
    expect(noTrial).toContain('not refunded automatically');
    expect(noTrial).not.toContain('verification debit');
    expect(noTrial).toContain('per year');
  });
});

describe('paymentLabel', () => {
  const base: BillingPayment = { id: 'p', kind: 'authorization', status: 'authorized', amountPaise: 500, amountRefundedPaise: 0, currency: 'INR', method: 'card', paidAt: null, createdAt: '2026-11-10T00:00:00Z' };
  it('only says "Refunded in full" when the record shows a full refund', () => {
    expect(paymentLabel(base).detail).toMatch(/processing automatically/);
    expect(paymentLabel({ ...base, status: 'refunded', amountRefundedPaise: 500 }).detail).toBe('Refunded in full');
    expect(paymentLabel({ ...base, amountRefundedPaise: 500 }).detail).toBe('Refunded in full');
    expect(paymentLabel({ ...base, amountRefundedPaise: 200 }).detail).toMatch(/processing/);
  });
  it('labels charges separately from verification debits', () => {
    expect(paymentLabel({ ...base, kind: 'charge', status: 'captured', amountPaise: 29900 }).title).toBe('Subscription charge');
  });
});
