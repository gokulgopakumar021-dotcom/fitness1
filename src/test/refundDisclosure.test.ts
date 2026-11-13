// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDisclosure, paymentLabel } from '../utils/billingPresentation';
import type { BillingPayment, BillingPlan } from '../lib/billingApi';

/**
 * Stage 2D / Stage 4: the ₹5 card verification debit.
 *
 * What the code does: Razorpay may make the debit (VERIFICATION_DEBIT_PAISE = 500). This code issues NO refund; the server only
 * reads Razorpay's refund status and alerts if it never shows as refunded. Razorpay's documentation describes the ₹5 as
 * auto-refunded, but that has not been verified in Razorpay Test Mode for this account (and nothing here may initiate real payments).
 * So no customer-facing text may promise an automatic refund. "not refunded automatically" (about the FULL plan price) is accurate and allowed.
 */
const ROOT = process.cwd();
const CLAIM = /(?<!not )refunded automatically|refunds? (it|this|the debit) automatically|auto-?refund|refunded back|returned automatically|processing automatically|refund is (on its way|being processed)/i;
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(n) && !/\.(test|spec)\.(ts|tsx)$/.test(n) && !/testFakes/.test(n)) out.push(relative(ROOT, f).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

describe('no customer-facing text promises an automatic refund of the ₹5 debit', () => {
  it('scans a real source tree', () => {
    expect(sources().length).toBeGreaterThan(200);
  });

  it('no production source file (UI, presentation helpers, legal pages, server messages) contains an automatic-refund claim', () => {
    const hits = sources().flatMap((f) => {
      const code = strip(readFileSync(join(ROOT, f), 'utf8'));
      return code.split('\n').flatMap((line, i) => (CLAIM.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : []));
    });
    expect(hits).toEqual([]);
  });

  it('the scanner itself catches the old wording and accepts the accurate one (self-test)', () => {
    for (const bad of ['is made and refunded automatically', 'Razorpay refunds it automatically', 'auto-refunded', 'Refund is processing automatically', 'refunded back to you'])
      expect(CLAIM.test(bad), bad).toBe(true);
    for (const ok of ['This is the full plan price and is not refunded automatically.', 'Razorpay may make a small card verification debit, shown as ₹5.', 'Refunded in full'])
      expect(CLAIM.test(ok), ok).toBe(false);
  });
});

describe('what customers are told instead', () => {
  const plan: BillingPlan = { key: 'monthly', amountPaise: 29900, currency: 'INR', interval: 'month' } as unknown as BillingPlan;
  const lines = buildDisclosure({ plan, trialEligible: true, trialDays: 3, verificationDebitPaise: 500, firstChargeAt: '2026-11-13T12:00:00Z' }).join('\n');

  it('the pre-checkout disclosure says the debit MAY be made, that it is not part of the price, and points to the Refund Policy', () => {
    expect(lines).toContain('Razorpay may make a ₹5 card verification debit');
    expect(lines).toContain('not part of your plan price');
    expect(lines).toContain('Refund Policy');
  });

  it('the disclosure still states the first charge, renewal and how to cancel, and never calls the trial free', () => {
    expect(lines).toContain('₹299');
    expect(lines).toMatch(/until you cancel/);
    expect(lines).toMatch(/cancel in Settings, then Billing/);
    expect(lines).not.toMatch(/\bfree\b|no charge/i);
  });

  const pay = (o: Partial<BillingPayment>): BillingPayment =>
    ({ id: 'p', kind: 'authorization', status: 'captured', amountPaise: 500, amountRefundedPaise: 0, currency: 'INR', method: 'card', paidAt: null, createdAt: '2026-11-10T00:00:00Z', ...o }) as BillingPayment;

  it('billing history says "Refunded in full" ONLY when the record shows a full refund, and otherwise makes no promise', () => {
    expect(paymentLabel(pay({ status: 'refunded', amountRefundedPaise: 500 })).detail).toBe('Refunded in full');
    const pending = paymentLabel(pay({})).detail;
    expect(pending).toMatch(/Not shown as refunded yet/);
    expect(pending).not.toMatch(/automatic|processing|on its way/i);
    expect(paymentLabel(pay({ status: 'failed' })).detail).toBe('Failed');
  });
});
