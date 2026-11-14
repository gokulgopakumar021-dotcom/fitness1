// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LegalRoot } from '../components/legal/LegalRoot';
import { LEGAL } from './legalConfig';
import type { LegalRouteKey } from './routes';
import { loadBillingConfig } from '../server/billing/config';
import { buildDisclosure } from '../utils/billingPresentation';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Stage 13: the owner-approved facts in the policy text must equal what the code actually does, and the draft state must
 * stay protected. These tests add checks; they do not replace the Stage 2D / Stage 6 release gate.
 */
const text = (route: LegalRouteKey): string => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<LegalRoot route={route} />));
  el.querySelectorAll('[data-legal-review-note],[data-legal-draft-banner]').forEach((n) => n.remove());
  const out = (el.textContent ?? '').replace(/\s+/g, ' ');
  act(() => root.unmount());
  el.remove();
  return out;
};

describe('Stage 13: policy text equals the code defaults the owner approved', () => {
  const cfg = loadBillingConfig({});
  it('code defaults are ₹299 / ₹1,499 and a three-day trial', () => {
    expect(cfg.plans.monthly.amountPaise).toBe(29_900);
    expect(cfg.plans.annual.amountPaise).toBe(149_900);
    expect(cfg.trialDays).toBe(3);
  });
  it('the Terms state the same prices and the three-day trial', () => {
    const t = text('terms');
    expect(t).toContain('₹299 per month');
    expect(t).toContain('₹1,499 per year');
    expect(t).toMatch(/currently three days/);
  });
  it('the Terms add no tax amount and no extra charge', () => {
    expect(text('terms')).not.toMatch(/\bGST\b.*\b\d+\s?%|\+\s?GST|plus (GST|tax)/i);
  });
});

describe('Stage 13: draft state and owner decisions stay in place', () => {
  it('LEGAL.isDraft is true, no effective date, versions are still draft labels', () => {
    expect(LEGAL.isDraft).toBe(true);
    expect(LEGAL.effectiveDate).toBeNull();
    expect(LEGAL.termsVersion).toMatch(/draft/);
    expect(LEGAL.privacyVersion).toMatch(/draft/);
  });
  it('no referral programme wording appears in any initial-launch policy page', () => {
    const src = readdirSync(resolve('src/components/legal/content')).map((f) => readFileSync(resolve('src/components/legal/content', f), 'utf8')).join('\n');
    expect(src).not.toMatch(/referral|refer a friend|referral commission/i);
  });
  it('the refund page keeps the approved limited-refund approach and never promises automatic refunds', () => {
    const t = text('refund-policy');
    expect(t).toMatch(/duplicate payments, incorrect charges, and billing errors/);
    expect(t).toMatch(/do not offer general change-of-mind refunds/);
    expect(t).not.toMatch(/automatically refunded|refunded automatically|always refund|non-refundable/i);
  });
  it('the contact page shows the support address and never calls the service a registered company', () => {
    const t = text('contact');
    expect(t).toContain(LEGAL.supportEmail);
    expect(t).toMatch(/an individual, not a registered company/);
    expect(t).not.toMatch(/(Pvt|Private) Ltd|\bLLP\b|\bCIN\b|GSTIN|registered office/i);
    expect(t).not.toMatch(/\+?\d[\d\s-]{9,}/);
  });
  it('the age wording says self-declaration style and never claims verification', () => {
    const all = (['terms', 'privacy'] as const).map(text).join(' ');
    expect(all).toMatch(/do not independently verify your age|we do not verify it/);
    expect(all).not.toMatch(/verified (your )?age|age verification (is|was) (done|performed)|government ID/i);
  });
});

describe('Stage 13: Body Scan and support wording', () => {
  it('the Terms limit Body Scan to adults and do not claim measurement or diagnosis', () => {
    const t = text('terms');
    expect(t).toMatch(/Body Scan is for people aged 18 or over/);
    expect(t).toMatch(/cannot tell you your body-fat percentage or diagnose anything/);
  });
  it('the Privacy Policy discloses support emails without inventing a retention period', () => {
    const t = text('privacy');
    expect(t).toMatch(/If you email us, we receive your email address/);
    expect(t).toMatch(/not set a fixed period for keeping support emails/);
  });
});

describe('Stage 13: deletion text matches the schema', () => {
  it('the Privacy Policy says acceptance and 18+ records are removed with the account', () => {
    expect(text('privacy')).toMatch(/records of accepting or acknowledging the Terms and Privacy Policy and of your 18\+ confirmation are removed/);
  });
  it('and the schema really cascades both tables from auth.users', () => {
    const a = readFileSync('supabase/migrations/20261112060134_legal_acceptances.sql', 'utf8');
    const b = readFileSync('supabase/migrations/20261113043241_age_eligibility.sql', 'utf8');
    expect(a).toMatch(/user_id\s+uuid not null references auth\.users \(id\) on delete cascade/);
    expect(b).toMatch(/user_id\s+uuid primary key references auth\.users \(id\) on delete cascade/);
  });
});

/**
 * Stage 13.1: trial-timing wording. The implemented timing is anchored here from the source so the wording cannot drift from it:
 * trial_end_at = checkout creation (database clock) + authorisation window + trial days, and the same instant is sent to Razorpay as
 * start_at. The date is fixed at checkout; it is not recomputed from the moment of authorisation, and no 72-hour promise is made.
 */
describe('Stage 13.1: trial timing wording matches the implemented timing', () => {
  const sql = readFileSync('supabase/migrations/20261106052859_billing_core.sql', 'utf8');
  const service = readFileSync('src/server/billing/service.ts', 'utf8');
  const customerFacing = (): string[] => {
    const pages = (['terms', 'privacy', 'refund-policy', 'cancellation-policy', 'contact'] as const).map(text);
    const disclosure = buildDisclosure({
      plan: { key: 'monthly', amountPaise: 29900, currency: 'INR', interval: 'month', billingPeriod: 'monthly' } as never,
      trialEligible: true, trialDays: 3, verificationDebitPaise: 500, firstChargeAt: '2026-11-13T12:00:00Z'
    }).join('\n');
    const ui = ['BillingParts', 'BillingOnboarding', 'BillingPanel'].map((f) => readFileSync(`src/components/billing/${f}.tsx`, 'utf8')).join('\n');
    return [...pages, disclosure, ui];
  };

  it('source: the trial end is the authorisation deadline plus the trial days, fixed in the database at checkout creation', () => {
    expect(sql).toMatch(/v_expire := now\(\) \+ v_window;/);
    expect(sql).toMatch(/v_trial_end := case when v_eligible then v_expire \+ make_interval\(days => p_trial_days\) else null end;/);
  });
  it('source: the stored trial end is what is sent to Razorpay as start_at, with expire_by as the authorisation deadline', () => {
    expect(service).toMatch(/start_at: Math\.floor\(Date\.parse\(begin\.trial_end_at as string\) \/ 1000\)/);
    expect(service).toMatch(/expire_by: Math\.floor\(Date\.parse\(begin\.expire_by as string\) \/ 1000\)/);
  });
  it('the Terms say the date is set at checkout, call the first charge scheduled, and disclaim any payment guarantee', () => {
    const t = text('terms');
    expect(t).toMatch(/set when you start checkout and does not move if you authorise later/);
    expect(t).toMatch(/first plan charge is scheduled for the date your trial is set to end/);
    expect(t).toMatch(/exact time it is taken can vary/);
    expect(t).toMatch(/does not guarantee that a later payment will succeed/);
  });
  it('the pre-checkout disclosure calls the first charge scheduled and says the date is set at checkout', () => {
    const d = buildDisclosure({
      plan: { key: 'monthly', amountPaise: 29900, currency: 'INR', interval: 'month', billingPeriod: 'monthly' } as never,
      trialEligible: true, trialDays: 3, verificationDebitPaise: 500, firstChargeAt: '2026-11-13T12:00:00Z'
    }).join('\n');
    expect(d).toMatch(/is scheduled for 13 Nov 2026/);
    expect(d).toMatch(/date is set when you start checkout/);
    expect(d).not.toMatch(/the day your trial ends/);
  });
  it('no customer-facing document promises 72 hours or three full days after authorisation, or an exact charge time', () => {
    for (const c of customerFacing()) {
      expect(c).not.toMatch(/\b72[- ]?hours?\b/i);
      expect(c).not.toMatch(/(three|3)[- ]full[- ]days?|full (three|3)[- ]day|exactly (three|3) days|(three|3) days? (after|from) (you )?(authoris|authoriz|confirm)/i);
      expect(c).not.toMatch(/Counted from when your authorisation was confirmed/);
      expect(c).not.toMatch(/charged? (at|by) (exactly|precisely)|guaranteed (first )?(charge|payment)/i);
    }
  });
  it('no document or review note says the first charge follows sign-up', () => {
    const docs = ['docs/legal/IRON_LOG_AI_INDIAN_LAWYER_REVIEW_PACKET.md', 'docs/legal/IRON_LOG_AI_OWNER_INFORMATION_REQUIRED.md'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const terms = readFileSync('src/components/legal/content/TermsPage.tsx', 'utf8');
    expect(terms).not.toMatch(/authorisation window[^.]*after sign-up/);
    expect(docs.replace(/Stage 13 wrongly said "after sign-up"/, '')).not.toMatch(/authorisation window[^.]*after sign-up/);
  });
});

describe('Stage 13.1: owner decisions are unchanged', () => {
  it('prices, the one-trial rule, the limited refund approach and 18+ wording are all still in place', () => {
    const terms = text('terms');
    expect(terms).toContain('₹299 per month');
    expect(terms).toContain('₹1,499 per year');
    expect(terms).toMatch(/One trial is allowed per account and per email address/);
    expect(text('refund-policy')).not.toMatch(/change of mind[^.]*(will|can) be refunded/i);
    expect(terms).toMatch(/18/);
    expect(['terms', 'privacy'].map((r) => text(r as LegalRouteKey)).join(' ')).not.toMatch(/verified (your )?age|government ID/i);
  });
  it('the draft state and the release gate stay active', () => {
    expect(LEGAL.isDraft).toBe(true);
    expect(LEGAL.effectiveDate).toBeNull();
    expect(readFileSync('src/legal/releaseGate.ts', 'utf8')).toMatch(/releaseBlockers/);
  });
  it('the ₹5 wording makes no verified-refund claim', () => {
    const all = (['terms', 'refund-policy'] as const).map(text).join(' ');
    expect(all).not.toMatch(/₹5[^.]*(is|will be) (automatically )?refunded|₹5 (is|will be) returned/i);
  });
});
