import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; user_metadata: Record<string, unknown> } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const api = vi.hoisted(() => ({
  fetchBillingStatus: vi.fn(),
  fetchBillingPayments: vi.fn(),
  createSubscription: vi.fn(),
  verifySubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  startRecovery: vi.fn()
}));
vi.mock('../../lib/billingApi', async (orig) => ({ ...(await orig<typeof import('../../lib/billingApi')>()), ...api }));
const checkout = vi.hoisted(() => ({ openSubscriptionCheckout: vi.fn() }));
vi.mock('../../lib/razorpayCheckout', () => checkout);
const onboardingLib = vi.hoisted(() => ({ markBillingOnboardingDone: vi.fn() }));
vi.mock('../../lib/billingOnboarding', async (orig) => ({ ...(await orig<typeof import('../../lib/billingOnboarding')>()), ...onboardingLib }));

import { BillingOnboardingGate } from './BillingOnboardingGate';
import { BillingApiError, type BillingStatus, type PublicSubscription } from '../../lib/billingApi';

const NOW = Date.parse('2026-11-10T12:00:00Z');
let container: HTMLDivElement;
let root: Root;

const baseStatus = (over: Partial<BillingStatus> = {}): BillingStatus & { success: true } => ({
  success: true,
  enforcement: 'off',
  emailVerified: true,
  trial: { eligible: true, days: 3, firstChargePreviewAt: '2026-11-13T12:00:00Z', verificationDebit: { amountPaise: 500, refundedAutomatically: true } },
  plans: [
    { key: 'monthly', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly', interval: 1 },
    { key: 'annual', amountPaise: 149900, currency: 'INR', billingPeriod: 'yearly', interval: 1 }
  ],
  entitlement: { state: 'none', hasAccess: false, accessEndsAt: null },
  subscription: null,
  ...over
});
const sub = (over: Partial<PublicSubscription> = {}): PublicSubscription => ({
  id: 's1', planKey: 'monthly', status: 'authenticated', paymentStatus: 'authorized', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly',
  trialStartAt: '2026-11-10T09:00:00Z', trialEndAt: '2026-11-13T09:00:00Z', currentPeriodStart: null, currentPeriodEnd: null, nextBillingAt: '2026-11-13T09:00:00Z',
  paidCount: 0, cancelRequestedAt: null, cancelAtCycleEnd: false, cancelledAt: null, accessEndsAt: null, createdAt: '2026-11-10T09:00:00Z', ...over
});
const trialingStatus = (over: Partial<PublicSubscription> = {}) =>
  baseStatus({ entitlement: { state: 'trialing', hasAccess: true, accessEndsAt: '2026-11-13T09:00:00Z' }, subscription: sub(over), trial: { ...baseStatus().trial, eligible: false } });
const created = (over: Record<string, unknown> = {}) => ({
  success: true, subscriptionId: 'sub_ABC123456', keyId: 'rzp_test_key', planKey: 'monthly', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly',
  trialEligible: true, trialDays: 3, firstChargeAt: '2026-11-13T12:00:00Z', authorizationExpiresAt: null, authorization: { amountPaise: 500, refundable: true }, reused: false, ...over
});
const callback = { razorpay_payment_id: 'pay_ABC123456', razorpay_subscription_id: 'sub_ABC123456', razorpay_signature: 'a'.repeat(64) };

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const text = () => container.textContent ?? '';
const byText = (sel: string, t: string | RegExp) =>
  Array.from(container.querySelectorAll<HTMLElement>(sel)).find((e) => (typeof t === 'string' ? e.textContent?.trim() === t : t.test(e.textContent ?? '')));
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const APP = <div data-testid="app">the app</div>;
const mount = async () => {
  await act(async () => { root.render(<BillingOnboardingGate>{APP}</BillingOnboardingGate>); });
  await flush();
};
const app = () => container.querySelector('[data-testid="app"]');
const agree = () => click(container.querySelector('input[type="checkbox"]'));
const startButton = () => byText('button', /^Start 3-day trial|^Subscribe/) as HTMLButtonElement | undefined;
const newUser = () => { auth.user = { id: 'u-new', email: 'new@example.com', user_metadata: { full_name: 'New Lifter', billing_onboarding: 'pending' } }; };

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  checkout.openSubscriptionCheckout.mockReset();
  onboardingLib.markBillingOnboardingDone.mockReset();
  onboardingLib.markBillingOnboardingDone.mockResolvedValue(true);
  api.fetchBillingStatus.mockResolvedValue(baseStatus());
  api.fetchBillingPayments.mockResolvedValue([]);
  newUser();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('post-signup routing', () => {
  it('sends a newly registered account to plan selection instead of the app', async () => {
    await mount();
    expect(app()).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Start your 3-day trial');
    expect(api.fetchBillingStatus).toHaveBeenCalled();
  });

  it('leaves existing accounts alone: no flag means the app opens and no billing request is made', async () => {
    auth.user = { id: 'u-old', email: 'old@example.com', user_metadata: { full_name: 'Old Lifter' } };
    await mount();
    expect(app()).not.toBeNull();
    expect(api.fetchBillingStatus).not.toHaveBeenCalled();
  });

  it('does not show onboarding again once it is done on the account (any device)', async () => {
    auth.user = { id: 'u-new', email: 'new@example.com', user_metadata: { billing_onboarding: 'done' } };
    await mount();
    expect(app()).not.toBeNull();
    expect(api.fetchBillingStatus).not.toHaveBeenCalled();
  });

  it('shows the app when signed out of everything (no user)', async () => {
    auth.user = null;
    await mount();
    expect(app()).not.toBeNull();
  });

  it('skipping opens the app at once and records it, without creating a subscription', async () => {
    await mount();
    await click(byText('button', 'Skip for now'));
    expect(app()).not.toBeNull();
    expect(onboardingLib.markBillingOnboardingDone).toHaveBeenCalledTimes(1);
    expect(api.createSubscription).not.toHaveBeenCalled();
  });

  it('never locks anyone out: the app opens even if recording the skip fails', async () => {
    onboardingLib.markBillingOnboardingDone.mockResolvedValue(false);
    await mount();
    await click(byText('button', 'Continue without a plan'));
    expect(app()).not.toBeNull();
  });

  it('refreshing keeps onboarding: a new mount lands on the same screen with no trial started', async () => {
    await mount();
    act(() => root.unmount());
    root = createRoot(container);
    await mount();
    expect(app()).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Start your 3-day trial');
    expect(api.createSubscription).not.toHaveBeenCalled();
  });

  it('after a refresh in the middle of checkout it restores the plan of the unfinished attempt and does not restart anything', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ subscription: sub({ status: 'created', paymentStatus: 'none', planKey: 'annual', amountPaise: 149900, billingPeriod: 'yearly', trialStartAt: null }) }));
    await mount();
    expect(text()).toContain("You haven't finished authorising payment");
    expect((container.querySelector('input[value="annual"]') as HTMLInputElement).checked).toBe(true);
    expect(text()).toContain('Selected plan');
    expect(api.createSubscription).not.toHaveBeenCalled();
  });
});

describe('plan selection screen', () => {
  it('shows both plans, the trial and the authorisation debit before anything is started, and never calls the trial free', async () => {
    await mount();
    expect(text()).toContain('₹299 per month');
    expect(text()).toContain('₹1,499 per year');
    expect(text()).toMatch(/3-day trial/);
    expect(text()).toContain('₹5');
    expect(text()).toMatch(/Razorpay may make a small card verification debit, shown as ₹5/);
    expect(text()).toMatch(/refund handling is described in the Refund Policy/);
    expect(text()).not.toMatch(/(?<!not )refunded automatically|refunds? it automatically|auto-?refund/i); // Stage 4: no promise we cannot verify
    expect(text()).toMatch(/only after Razorpay confirms|starts once Razorpay confirms|Once Razorpay confirms/);
    expect(text()).toMatch(/until you cancel/);
    expect(text()).not.toMatch(/\bfree\b/i);
    expect(text()).not.toMatch(/no charge/i);
    expect(api.createSubscription).not.toHaveBeenCalled();
  });

  it('keeps the start button disabled until the billing terms are accepted', async () => {
    await mount();
    expect(startButton()!.disabled).toBe(true);
    await agree();
    expect(startButton()!.disabled).toBe(false);
  });

  it('monthly: shows the selected plan, then sends only the plan key', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    expect(container.querySelector('[data-testid="selected-plan"]')!.textContent).toContain('Monthly, ₹299 per month');
    await agree();
    await click(startButton());
    expect(api.createSubscription).toHaveBeenCalledTimes(1);
    expect(api.createSubscription).toHaveBeenCalledWith('monthly');
  });

  it('annual: switching plans updates the selected plan and the key sent, and asks for the terms again', async () => {
    api.createSubscription.mockResolvedValue(created({ planKey: 'annual', amountPaise: 149900, billingPeriod: 'yearly' }));
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await agree();
    await click(container.querySelector('input[value="annual"]'));
    expect(container.querySelector('[data-testid="selected-plan"]')!.textContent).toContain('Annual, ₹1,499 per year');
    expect(startButton()!.disabled).toBe(true);
    await agree();
    await click(startButton());
    expect(api.createSubscription).toHaveBeenCalledWith('annual');
  });

  it('opens Checkout with what the server returned and never with a client price', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await agree();
    await click(startButton());
    const args = checkout.openSubscriptionCheckout.mock.calls[0][0];
    expect(args).toMatchObject({ keyId: 'rzp_test_key', subscriptionId: 'sub_ABC123456', email: 'new@example.com' });
    expect(JSON.stringify(api.createSubscription.mock.calls)).not.toMatch(/amount|trial|user/i);
  });

  it('blocks duplicate submissions: two clicks in the same tick create one subscription', async () => {
    let release!: (v: unknown) => void;
    api.createSubscription.mockImplementation(() => new Promise((r) => { release = r; }));
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await agree();
    const btn = startButton()!;
    await act(async () => { btn.click(); btn.click(); });
    expect(api.createSubscription).toHaveBeenCalledTimes(1);
    expect(startButton()!.disabled).toBe(true); // loading while the request is in flight
    await act(async () => { release(created()); });
    await flush();
    expect(api.createSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('authorisation outcomes', () => {
  it('starts the trial only after the server verified the authorisation, then shows plan, start, expiry and what happens next', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription.mockImplementation(async () => {
      // while the server is still verifying, nothing is shown as active
      expect(text()).not.toContain('Your trial is active');
      return { success: true, verified: true, alreadyVerified: false, subscription: sub() };
    });
    await mount();
    await agree();
    api.fetchBillingStatus.mockResolvedValue(trialingStatus());
    await click(startButton());

    expect(api.verifySubscription).toHaveBeenCalledWith(callback);
    expect(container.querySelector('h1')?.textContent).toBe('Your trial is active');
    expect(text()).toContain('Trial active');
    expect(text()).toContain('Monthly, ₹299 per month');
    expect(text()).toContain('Trial started');
    expect(text()).toContain('10 Nov 2026');
    expect(text()).toContain('13 Nov 2026');
    const next = container.querySelector('[data-testid="trial-end-explainer"]')!.textContent!;
    expect(next).toMatch(/first payment of ₹299/);
    expect(next).toMatch(/renews every month at ₹299 until you cancel/);
    expect(next).toMatch(/Settings, then Billing/);
    expect(container.querySelector('input[name="billing-plan"]')).toBeNull();
    await click(byText('button', /^Continue to Iron Log AI/));
    expect(app()).not.toBeNull();
    expect(onboardingLib.markBillingOnboardingDone).toHaveBeenCalledTimes(1);
  });

  it('a redirect or callback alone is not success: if the server refuses the verification, no trial is shown and the plan screen stays', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription.mockRejectedValue(new BillingApiError(400, 'invalid_signature', 'We could not verify that payment.'));
    await mount();
    await agree();
    await click(startButton());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('We could not verify that payment.');
    expect(text()).not.toContain('Your trial is active');
    expect(container.querySelector('input[name="billing-plan"]')).not.toBeNull();
    expect(app()).toBeNull();
  });

  it('cancelled authorisation: says nothing was activated, keeps the plan screen, and the person can still skip', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await agree();
    await click(startButton());
    expect(text()).toContain('Checkout closed');
    expect(text()).toContain('Nothing was activated');
    expect(text()).not.toContain('Your trial is active');
    expect(container.querySelector('h1')?.textContent).toBe('Start your 3-day trial');
    await click(byText('button', 'Skip for now'));
    expect(app()).not.toBeNull();
  });

  it('failed subscription creation shows a clear error and charges nothing', async () => {
    api.createSubscription.mockRejectedValue(new BillingApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.'));
    await mount();
    await agree();
    await click(startButton());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Billing is temporarily unavailable');
    expect(checkout.openSubscriptionCheckout).not.toHaveBeenCalled();
    expect(startButton()!.disabled).toBe(false); // can try again
  });

  it('shows a loading state while the server status loads, and an error with retry and skip if it cannot load', async () => {
    api.fetchBillingStatus.mockRejectedValue(new BillingApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable.'));
    await mount();
    expect(text()).toContain('Billing is unavailable');
    expect(byText('button', 'Try again')).toBeTruthy();
    expect(byText('button', 'Skip for now')).toBeTruthy(); // billing trouble must never block the app
    api.fetchBillingStatus.mockResolvedValue(baseStatus());
    await click(byText('button', 'Try again'));
    expect(container.querySelector('input[name="billing-plan"]')).not.toBeNull();
  });
});

describe('accounts that already have billing state', () => {
  it('active trial: shows it and what happens next, offers no second trial', async () => {
    api.fetchBillingStatus.mockResolvedValue(trialingStatus());
    await mount();
    expect(container.querySelector('h1')?.textContent).toBe('Your trial is active');
    expect(container.querySelector('input[name="billing-plan"]')).toBeNull();
    expect(startButton()).toBeUndefined();
    expect(api.createSubscription).not.toHaveBeenCalled();
    expect(byText('button', 'Skip for now')).toBeUndefined();
    await click(byText('button', /^Continue to/));
    expect(app()).not.toBeNull();
  });

  it('active subscription: shows the plan and offers no trial or new subscription', async () => {
    api.fetchBillingStatus.mockResolvedValue(
      baseStatus({
        trial: { ...baseStatus().trial, eligible: false },
        entitlement: { state: 'active', hasAccess: true, accessEndsAt: null },
        subscription: sub({ status: 'active', paymentStatus: 'paid', planKey: 'annual', amountPaise: 149900, billingPeriod: 'yearly', trialEndAt: null, nextBillingAt: '2027-11-10T00:00:00Z', paidCount: 1 })
      })
    );
    await mount();
    expect(container.querySelector('h1')?.textContent).toBe('Your plan is set up');
    expect(text()).toContain('Annual, ₹1,499 per year');
    expect(container.querySelector('input[name="billing-plan"]')).toBeNull();
    expect(startButton()).toBeUndefined();
  });

  it('trial already used: says so, offers no trial, and describes the immediate full charge accurately', async () => {
    api.fetchBillingStatus.mockResolvedValue(
      baseStatus({ trial: { eligible: false, days: 3, firstChargePreviewAt: null, verificationDebit: { amountPaise: 500, refundedAutomatically: true } }, entitlement: { state: 'trial_expired', hasAccess: false, accessEndsAt: null }, subscription: sub({ status: 'cancelled', paymentStatus: 'authorized' }) })
    );
    await mount();
    expect(container.querySelector('[aria-label="Trial already used"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Choose your plan');
    expect(startButton()!.textContent).toBe('Subscribe, ₹299 per month');
    expect(byText('button', /^Start 3-day trial/)).toBeUndefined();
    const d = container.querySelector('[data-testid="disclosure"]')!.textContent!;
    expect(d).toMatch(/Charged today: ₹299/);
    expect(d).toMatch(/not refunded automatically/);
    api.createSubscription.mockResolvedValue(created({ trialEligible: false, trialDays: 0, firstChargeAt: null, authorization: { amountPaise: 29900, refundable: false } }));
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await agree();
    await click(startButton());
    expect(api.createSubscription).toHaveBeenCalledWith('monthly'); // the server, not the page, decides there is no trial
  });
});

describe('responsive layout', () => {
  it('is a single mobile-first column that widens on desktop, with 44px touch targets and safe-area padding', async () => {
    await mount();
    const main = container.querySelector('main')!;
    expect(main.className).toMatch(/max-w-2xl/);
    expect(main.className).toMatch(/w-full/);
    expect(container.firstElementChild!.className).toMatch(/min-h-dvh/);
    expect((container.firstElementChild as HTMLElement).style.paddingTop).toContain('safe-area-inset-top');
    expect(container.querySelector('fieldset')!.className).toMatch(/sm:grid-cols-2/); // stacked on mobile, side by side on desktop
    expect(byText('button', 'Skip for now')!.className).toMatch(/min-h-\[44px\]/);
    expect(startButton()).toBeTruthy();
  });
});
