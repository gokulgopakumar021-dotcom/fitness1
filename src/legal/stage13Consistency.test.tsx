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
