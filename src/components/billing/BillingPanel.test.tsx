import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  fetchBillingStatus: vi.fn(),
  fetchBillingPayments: vi.fn(),
  createSubscription: vi.fn(),
  verifySubscription: vi.fn(),
  cancelSubscription: vi.fn()
}));
vi.mock('../../lib/billingApi', async (orig) => ({ ...(await orig<typeof import('../../lib/billingApi')>()), ...api }));
const checkout = vi.hoisted(() => ({ openSubscriptionCheckout: vi.fn() }));
vi.mock('../../lib/razorpayCheckout', () => checkout);
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { email: 'me@example.com' } }) }));

import { BillingPanel } from './BillingPanel';
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
  trialStartAt: '2026-11-10T00:00:00Z', trialEndAt: '2026-11-13T12:00:00Z', currentPeriodStart: null, currentPeriodEnd: null, nextBillingAt: '2026-11-13T12:00:00Z',
  paidCount: 0, cancelRequestedAt: null, cancelAtCycleEnd: false, cancelledAt: null, accessEndsAt: null, createdAt: '2026-11-10T00:00:00Z', ...over
});
const created = (over: Record<string, unknown> = {}) => ({
  success: true, subscriptionId: 'sub_ABC123456', keyId: 'rzp_test_key', planKey: 'monthly', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly',
  trialEligible: true, trialDays: 3, firstChargeAt: '2026-11-13T12:00:00Z', authorizationExpiresAt: null, authorization: { amountPaise: 500, refundable: true }, reused: false, ...over
});
const callback = { razorpay_payment_id: 'pay_ABC123456', razorpay_subscription_id: 'sub_ABC123456', razorpay_signature: 'a'.repeat(64) };

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
};
/** The retry waits use real (0 ms) timers, so let them run. */
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await flush();
};
const text = () => container.textContent ?? '';
const byText = (sel: string, t: string | RegExp) =>
  Array.from(container.querySelectorAll<HTMLElement>(sel)).find((e) => (typeof t === 'string' ? e.textContent === t : t.test(e.textContent ?? '')));
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const mount = async (props: Partial<React.ComponentProps<typeof BillingPanel>> = {}) => {
  await act(async () => { root.render(<BillingPanel now={() => NOW} verifyDelaysMs={[0, 0]} {...props} />); });
  await flush();
};
const agree = async () => click(container.querySelector('input[type="checkbox"]'));
const startButton = () => byText('button', /^Start 3-day trial|^Subscribe/);

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  checkout.openSubscriptionCheckout.mockReset();
  api.fetchBillingStatus.mockResolvedValue(baseStatus());
  api.fetchBillingPayments.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BillingPanel: subscribing', () => {
  it('shows both server plans and the full pre-authorisation disclosure, never "free" or "no charge"', async () => {
    await mount();
    expect(text()).toContain('₹299 per month');
    expect(text()).toContain('₹1,499 per year');
    const d = container.querySelector('[data-testid="disclosure"]')!.textContent!;
    expect(d).toContain('₹5 card verification debit');
    expect(d).toMatch(/refunds it automatically/);
    expect(d).toContain('13 Nov 2026');
    expect(d).toMatch(/until you cancel/);
    expect(d).toMatch(/Settings, then Billing/);
    expect(text()).not.toMatch(/\bfree\b/i);
    expect(text()).not.toMatch(/no charge/i);
  });

  it('keeps the button disabled until the person agrees, and does not call the server', async () => {
    await mount();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    await click(startButton());
    expect(api.createSubscription).not.toHaveBeenCalled();
    await agree();
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends only the plan key, opens Checkout with the server ids, verifies the callback on the server, then reloads status', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription.mockResolvedValue({ success: true, verified: true, alreadyVerified: false, subscription: sub() });
    await mount();
    await agree();
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'trialing', hasAccess: true, accessEndsAt: '2026-11-13T12:00:00Z' }, subscription: sub() }));
    await click(startButton());

    expect(api.createSubscription).toHaveBeenCalledTimes(1);
    expect(api.createSubscription).toHaveBeenCalledWith('monthly'); // plan KEY only: never an amount, plan id or user id
    expect(checkout.openSubscriptionCheckout).toHaveBeenCalledWith(expect.objectContaining({ keyId: 'rzp_test_key', subscriptionId: 'sub_ABC123456', email: 'me@example.com' }));
    expect(api.verifySubscription).toHaveBeenCalledWith(callback);
    expect(text()).toContain('Authorisation confirmed');
    expect(text()).toContain('Trial active');
    expect(text()).toContain('3 days left');
  });

  it('sends the annual key when the annual plan is chosen', async () => {
    api.createSubscription.mockResolvedValue(created({ planKey: 'annual', amountPaise: 149900, billingPeriod: 'yearly' }));
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await click(container.querySelector('input[value="annual"]'));
    await agree();
    await click(startButton());
    expect(api.createSubscription).toHaveBeenCalledWith('annual');
  });

  it('does not treat the Checkout callback as success: a server refusal shows an error and no success state', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription.mockRejectedValue(new BillingApiError(400, 'invalid_signature', 'We could not verify this payment.'));
    await mount();
    await agree();
    await click(startButton());
    expect(text()).toContain('We could not verify this payment.');
    expect(text()).not.toContain('Authorisation confirmed');
  });

  it('retries verify while Razorpay has not confirmed yet, then succeeds', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription
      .mockRejectedValueOnce(new BillingApiError(409, 'authorization_not_confirmed', 'not yet'))
      .mockResolvedValueOnce({ success: true, verified: true, alreadyVerified: false, subscription: sub() });
    await mount();
    await agree();
    await click(startButton());
    await settle();
    expect(api.verifySubscription).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Authorisation confirmed');
  });

  it('after the retries run out it says it is still confirming and tells the person not to pay again', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'callback', response: callback });
    api.verifySubscription.mockRejectedValue(new BillingApiError(409, 'authorization_not_confirmed', 'not yet'));
    await mount();
    await agree();
    await click(startButton());
    await settle();
    expect(api.verifySubscription).toHaveBeenCalledTimes(3); // first try plus two retries
    expect(text()).toContain('Still confirming with Razorpay');
    expect(text()).toContain('Do not pay again');
    expect(text()).not.toContain('Authorisation confirmed');
  });

  it('closing Checkout shows a neutral message, verifies nothing, and activates nothing', async () => {
    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockResolvedValue({ kind: 'dismissed' });
    await mount();
    await agree();
    await click(startButton());
    expect(text()).toContain('Checkout closed');
    expect(text()).toContain('Nothing was activated');
    expect(api.verifySubscription).not.toHaveBeenCalled();
  });

  it('does not open Checkout when the server\'s first-charge date differs from the one disclosed; it asks again with the new date', async () => {
    api.createSubscription.mockResolvedValue(created({ firstChargeAt: '2026-11-14T12:00:00Z' }));
    await mount();
    await agree();
    await click(startButton());
    expect(checkout.openSubscriptionCheckout).not.toHaveBeenCalled();
    expect(text()).toContain('The first charge date was updated');
    expect(text()).toContain('14 Nov 2026');
    expect((startButton() as HTMLButtonElement).disabled).toBe(true); // must agree again
  });

  it('does not open Checkout when trial eligibility changed under the person (disclosed a trial, server says none)', async () => {
    api.createSubscription.mockResolvedValue(created({ trialEligible: false, trialDays: 0, firstChargeAt: null, authorization: { amountPaise: 29900, refundable: false } }));
    await mount();
    await agree();
    await click(startButton());
    expect(checkout.openSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('shows a server error and an offline/script failure without claiming a charge', async () => {
    api.createSubscription.mockRejectedValueOnce(new BillingApiError(409, 'subscription_exists', 'You already have a subscription.'));
    await mount();
    await agree();
    await click(startButton());
    expect(text()).toContain('You already have a subscription.');

    api.createSubscription.mockResolvedValue(created());
    checkout.openSubscriptionCheckout.mockRejectedValue(new Error('Checkout script failed to load'));
    await click(startButton());
    expect(text()).toContain('You have not been charged');
  });

  it('a person who already used the trial sees the full price as charged today, and no verification debit', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ trial: { eligible: false, days: 3, firstChargePreviewAt: null, verificationDebit: { amountPaise: 500, refundedAutomatically: true } }, entitlement: { state: 'trial_expired', hasAccess: false, accessEndsAt: null }, subscription: sub({ status: 'cancelled' }) }));
    await mount();
    const d = container.querySelector('[data-testid="disclosure"]')!.textContent!;
    expect(d).toContain('Charged today: ₹299');
    expect(d).not.toContain('verification debit');
    expect(text()).toContain('Trial ended');
    expect(startButton()?.textContent).toBe('Subscribe, ₹299 per month');
  });

  it('blocks subscribing and explains why when the email is not verified', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ emailVerified: false }));
    await mount();
    expect(text()).toContain('Verify your email first');
    await agree();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('BillingPanel: dashboard states', () => {
  it('trialing: status, days left, trial end, plan, next billing date and payment status come from the server', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'trialing', hasAccess: true, accessEndsAt: '2026-11-13T12:00:00Z' }, subscription: sub() }));
    await mount();
    expect(text()).toContain('Trial active');
    expect(container.querySelector('[data-testid="trial-days"]')!.textContent).toBe('3 days left');
    expect(text()).toContain('Trial ends');
    expect(text()).toContain('13 Nov 2026');
    expect(text()).toContain('Monthly, ₹299 per month');
    expect(text()).toContain('Next billing date');
    expect(text()).toContain('Authorised, first charge scheduled');
    expect(container.querySelector('input[name="billing-plan"]')).toBeNull(); // no plan picker while subscribed
  });

  it('active: next billing date and paid status', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'active', hasAccess: true, accessEndsAt: '2026-12-13T12:00:00Z' }, subscription: sub({ status: 'active', paymentStatus: 'paid', nextBillingAt: '2026-12-13T12:00:00Z', currentPeriodEnd: '2026-12-13T12:00:00Z', paidCount: 1 }) }));
    await mount();
    expect(text()).toContain('Active');
    expect(text()).toContain('13 Dec 2026');
    expect(text()).toContain('Paid');
  });

  it('cancelled with access left: shows the access end date and offers no cancel button', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'cancelled_active', hasAccess: true, accessEndsAt: '2026-12-13T12:00:00Z' }, subscription: sub({ status: 'active', cancelAtCycleEnd: true, accessEndsAt: '2026-12-13T12:00:00Z' }) }));
    await mount();
    expect(text()).toContain('Access until');
    expect(text()).toContain('13 Dec 2026');
    expect(byText('button', 'Cancel subscription')).toBeUndefined();
  });

  it('payment failed: alert, paid features paused, recovery not pretended, cancel still available, no plan picker', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'payment_failed', hasAccess: false, accessEndsAt: null }, subscription: sub({ status: 'halted', paymentStatus: 'failed' }) }));
    await mount();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('did not go through');
    const update = byText('button', 'Update payment method') as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    expect(text()).toContain('not available yet');
    expect(text()).toContain('Failed');
    expect(byText('button', 'Cancel subscription')).toBeTruthy();
    expect(container.querySelector('input[name="billing-plan"]')).toBeNull();
  });

  it('payment pending: says it is waiting and keeps cancel available', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'payment_pending', hasAccess: false, accessEndsAt: null }, subscription: sub({ status: 'pending', paymentStatus: 'retrying' }) }));
    await mount();
    expect(text()).toContain('Waiting for your payment');
    expect(text()).toContain('Retrying');
  });

  it('a checkout that was started but never authorised is shown as not active and can be continued', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ subscription: sub({ status: 'created', paymentStatus: 'none', trialStartAt: null }) }));
    await mount();
    expect(text()).toContain('finished authorising');
    expect(text()).toContain('Not authorised');
    expect(startButton()).toBeTruthy();
  });

  it('shows an error with retry when status cannot be loaded, then recovers', async () => {
    api.fetchBillingStatus.mockRejectedValueOnce(new BillingApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.'));
    await mount();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Billing is temporarily unavailable');
    await click(byText('button', 'Try again'));
    expect(text()).toContain('No subscription');
  });

  it('billing history: lists payments, shows the verification debit as refunded only when it was, and recovers from a load error', async () => {
    api.fetchBillingPayments.mockResolvedValue([
      { id: 'a', kind: 'authorization', status: 'refunded', amountPaise: 500, amountRefundedPaise: 500, currency: 'INR', method: 'card', paidAt: '2026-11-10T06:00:00Z', createdAt: '2026-11-10T06:00:00Z' },
      { id: 'b', kind: 'charge', status: 'captured', amountPaise: 29900, amountRefundedPaise: 0, currency: 'INR', method: 'card', paidAt: '2026-11-13T06:00:00Z', createdAt: '2026-11-13T06:00:00Z' }
    ]);
    await mount();
    const list = container.querySelector('ul[aria-label="Payments"]')!.textContent!;
    expect(list).toContain('Card verification debit');
    expect(list).toContain('Refunded in full');
    expect(list).toContain('₹5');
    expect(list).toContain('Subscription charge');
    expect(list).toContain('₹299');
  });

  it('billing history error does not hide the rest of the screen and can be retried', async () => {
    api.fetchBillingPayments.mockRejectedValueOnce(new BillingApiError(503, 'billing_unavailable', 'History is down.'));
    await mount();
    expect(text()).toContain('History is down.');
    expect(text()).toContain('No subscription');
    api.fetchBillingPayments.mockResolvedValue([]);
    await click(container.querySelectorAll<HTMLElement>('button')[Array.from(container.querySelectorAll('button')).findIndex((b) => b.textContent === 'Try again')]);
    expect(text()).toContain('No payments yet');
  });
});

describe('BillingPanel: cancelling', () => {
  const trialing = () => baseStatus({ entitlement: { state: 'trialing', hasAccess: true, accessEndsAt: '2026-11-13T12:00:00Z' }, subscription: sub() });

  it('asks for confirmation first and states the access end date; "Keep subscription" cancels nothing', async () => {
    api.fetchBillingStatus.mockResolvedValue(trialing());
    await mount();
    await click(byText('button', 'Cancel subscription'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('first charge of ₹299 will not be taken');
    expect(dialog.textContent).toContain('13 Nov 2026');
    expect(api.cancelSubscription).not.toHaveBeenCalled();
    await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Keep subscription'));
    expect(api.cancelSubscription).not.toHaveBeenCalled();
  });

  it('confirming cancels on the server, shows the access end date, and refreshes status', async () => {
    api.fetchBillingStatus.mockResolvedValue(trialing());
    api.cancelSubscription.mockResolvedValue({ success: true, cancelled: true, alreadyRequested: false, subscription: sub({ status: 'cancelled' }), accessEndsAt: '2026-11-13T12:00:00Z' });
    await mount();
    await click(byText('button', 'Cancel subscription'));
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'cancelled_active', hasAccess: true, accessEndsAt: '2026-11-13T12:00:00Z' }, subscription: sub({ status: 'cancelled', accessEndsAt: '2026-11-13T12:00:00Z' }) }));
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Cancel subscription');
    await click(confirm);
    expect(api.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Subscription cancelled');
    expect(text()).toContain('You keep access until 13 Nov 2026');
    expect(text()).toContain('Cancelled, access continues');
  });

  it('shows a cancel failure inside the dialog and leaves the subscription in place', async () => {
    api.fetchBillingStatus.mockResolvedValue(trialing());
    api.cancelSubscription.mockRejectedValue(new BillingApiError(502, 'billing_upstream_error', 'The payment provider is temporarily unavailable. Please try again shortly.'));
    await mount();
    await click(byText('button', 'Cancel subscription'));
    await click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Cancel subscription'));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('temporarily unavailable');
    expect(text()).toContain('Trial active');
  });

  it('a paid subscription says it will not renew and that access continues to the end of the paid period', async () => {
    api.fetchBillingStatus.mockResolvedValue(baseStatus({ entitlement: { state: 'active', hasAccess: true, accessEndsAt: '2026-12-13T12:00:00Z' }, subscription: sub({ status: 'active', paymentStatus: 'paid', currentPeriodEnd: '2026-12-13T12:00:00Z', nextBillingAt: '2026-12-13T12:00:00Z' }) }));
    await mount();
    await click(byText('button', 'Cancel subscription'));
    const body = document.querySelector('[role="dialog"]')!.textContent!;
    expect(body).toContain('will not renew');
    expect(body).toContain('13 Dec 2026');
  });
});

describe('BillingPanel: mobile layout and accessibility contract (class and semantics checks; jsdom has no layout engine)', () => {
  it('stacks on phones and goes two-column from sm, with a labelled radio group and a labelled consent checkbox', async () => {
    await mount();
    const group = container.querySelector('fieldset')!;
    expect(group.className).toContain('grid');
    expect(group.className).toContain('sm:grid-cols-2');
    expect(group.querySelector('legend')!.textContent).toBe('Choose a plan');
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r.closest('label')!.className).toContain('min-h-[44px]')); // touch target
    expect(container.querySelector('input[type="checkbox"]')!.closest('label')!.textContent).toMatch(/I have read the above/);
    expect(container.innerHTML).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/); // nothing that forces horizontal scroll on a phone
  });
});
