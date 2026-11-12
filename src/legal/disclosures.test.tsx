import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: { email: 'me@example.com' } as { email: string } | null,
  changePassword: vi.fn(),
  signOutOtherDevices: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn()
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../storage/resetAll', () => ({ eraseAccountLocalData: vi.fn(async () => {}) }));
const api = vi.hoisted(() => ({ fetchDeletionCheck: vi.fn(), prepareDeletion: vi.fn() }));
vi.mock('../lib/billingApi', async (orig) => ({ ...(await orig<typeof import('../lib/billingApi')>()), ...api }));

import { LandingPage } from '../components/home/LandingPage';
import { Disclosure } from '../components/billing/BillingParts';
import { AccountSecurity } from '../components/settings/AccountSecurity';
import { LegalLinks } from '../components/legal/LegalLinks';
import { loadBillingConfig } from '../server/billing/config';

let container: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const hrefs = (el: ParentNode) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'none', subscription: null, accessEndsAt: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('landing page', () => {
  const mount = () => act(() => root.render(<LandingPage onSignIn={() => {}} onSignUp={() => {}} />));

  it('the PRIVACY navigation link opens /privacy, not an in-page marketing section', () => {
    mount();
    const nav = Array.from(container.querySelectorAll('header nav a')).find((a) => a.textContent === 'PRIVACY')!;
    expect(nav.getAttribute('href')).toBe('/privacy');
    expect(hrefs(container.querySelector('header')!)).not.toContain('#security');
  });

  it('the footer links to all five legal pages', () => {
    mount();
    const footer = container.querySelector('footer nav[aria-label="Legal documents"]')!;
    expect(hrefs(footer)).toEqual(['/privacy', '/terms', '/refund-policy', '/cancellation-policy', '/contact']);
  });

  it('no longer calls the product "Free", and separates no-plan features from AI features', () => {
    mount();
    const t = container.textContent ?? '';
    expect(t).not.toMatch(/Get Started — Free|Create Free Account|Start free/i);
    expect(t).toContain('Without a paid plan');
    expect(t).toMatch(/AI features: may need a trial or a paid plan/);
    expect(t).not.toMatch(/GST|tax(es)? (included|extra)/i);
  });

  it('shows the approved prices, and they match the server defaults (drift guard)', () => {
    mount();
    const t = container.textContent ?? '';
    expect(t).toContain('₹299 per month');
    expect(t).toContain('₹1,499 per year');
    const cfg = loadBillingConfig({});
    expect([cfg.plans.monthly.amountPaise, cfg.plans.annual.amountPaise]).toEqual([29_900, 149_900]);
  });

  it('the privacy section no longer implies everything is tied to the account', () => {
    mount();
    const t = container.textContent ?? '';
    expect(t).not.toContain('tied to your private account');
    expect(t).toMatch(/stay on your device and are not backed up/);
    expect(t).not.toMatch(/ad trackers/i);
  });
});

describe('billing disclosure (before Razorpay opens)', () => {
  const plan = { key: 'monthly', amountPaise: 29_900, period: 'monthly', interval: 1 } as any;

  it('links Terms, Refund Policy and Cancellation Policy, in a new tab, next to the unchanged agree checkbox', () => {
    act(() => root.render(<Disclosure plan={plan} trialEligible trialDays={3} verificationDebitPaise={500} firstChargeAt="2026-11-20T00:00:00Z" agreed={false} onAgree={() => {}} />));
    const links = container.querySelector('[data-testid="disclosure-legal-links"]')!;
    expect(hrefs(links)).toEqual(['/terms', '/refund-policy', '/cancellation-policy']);
    for (const a of Array.from(links.querySelectorAll('a'))) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(container.textContent).toContain('I have read the above and I agree to these recurring billing terms.');
  });
});

describe('Settings links', () => {
  it('LegalLinks lists all five pages by default and warns that they open in a new tab', () => {
    act(() => root.render(<LegalLinks />));
    expect(hrefs(container)).toEqual(['/privacy', '/terms', '/refund-policy', '/cancellation-policy', '/contact']);
    expect(container.textContent).toContain('opens in a new tab');
  });

  it('Settings (Privacy & data card, footer) and Billing panel mount LegalLinks', () => {
    const data = readFileSync('src/components/settings/DataPanel.tsx', 'utf8');
    expect(data).toContain('title="Policies & support"');
    expect(data).toContain('<LegalLinks');
    expect(readFileSync('src/components/settings/SettingsView.tsx', 'utf8')).toContain('<LegalLinks');
    const billing = readFileSync('src/components/billing/BillingPanel.tsx', 'utf8');
    expect(billing).toContain('data-testid="billing-legal-links"');
    expect(billing).toContain("keys={['refund-policy', 'cancellation-policy', 'terms', 'contact']}");
  });
});

describe('account deletion disclosures (wording only, behaviour unchanged)', () => {
  it('the Account section and the dialog disclose retained billing records, the email hash, third-party copies, other devices and Razorpay dependence', async () => {
    await act(async () => root.render(<AccountSecurity />));
    const section = container.querySelector('[data-testid="deletion-retention-note"]')!.textContent!;
    expect(section).toMatch(/billing records are kept/);
    expect(section).toMatch(/one-way hash of your email/);
    expect(section).toMatch(/Razorpay and our other providers keep their own records/);
    expect(section).toMatch(/backups held by them age out/);
    expect(section).toMatch(/If Razorpay cannot be reached, deletion can be blocked/);
    expect(container.querySelector('[data-testid="deletion-retention-note"] a')!.getAttribute('href')).toBe('/privacy#deleting-account');

    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete account…')!;
    await act(async () => btn.click());
    await flush();
    const dlg = document.querySelector('[data-testid="deletion-modal-disclosure"]')!.textContent!;
    expect(dlg).toMatch(/Billing records are kept/);
    expect(dlg).toMatch(/hash of your email/);
    expect(dlg).toMatch(/Other devices keep their local data/);
    expect(dlg).toMatch(/Razorpay is unavailable, deletion may be blocked/);
    // no false "everything is permanently erased" claim
    expect(`${section} ${dlg}`).not.toMatch(/all (of your )?data (is|will be) (permanently )?(deleted|erased|removed)/i);
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });
});
