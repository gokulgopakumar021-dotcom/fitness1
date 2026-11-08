import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: { email: 'me@example.com' } as { email: string } | null,
  changePassword: vi.fn(),
  signOutOtherDevices: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn()
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
const erase = vi.hoisted(() => ({ eraseAccountLocalData: vi.fn(async () => {}) }));
vi.mock('../../storage/resetAll', () => erase);
const api = vi.hoisted(() => ({ fetchDeletionCheck: vi.fn(), prepareDeletion: vi.fn() }));
vi.mock('../../lib/billingApi', async (orig) => ({ ...(await orig<typeof import('../../lib/billingApi')>()), ...api }));

import { AccountSecurity } from './AccountSecurity';
import { BillingApiError, type PublicSubscription } from '../../lib/billingApi';

let container: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const byText = (sel: string, text: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === text) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => (el as HTMLElement).click()); await flush(); };
async function type(label: string, value: string) {
  const l = Array.from(document.querySelectorAll('label')).find((e) => e.textContent?.includes(label));
  const input = (l?.querySelector('input') ?? (l?.htmlFor ? document.getElementById(l.htmlFor) : null)) as HTMLInputElement;
  expect(input).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const sub = (over: Partial<PublicSubscription> = {}): PublicSubscription => ({
  id: 's1', planKey: 'monthly', status: 'active', paymentStatus: 'paid', amountPaise: 29900, currency: 'INR', billingPeriod: 'monthly', trialStartAt: null, trialEndAt: null,
  currentPeriodStart: null, currentPeriodEnd: '2026-12-13T12:00:00Z', nextBillingAt: null, paidCount: 1, cancelRequestedAt: null, cancelAtCycleEnd: false, cancelledAt: null,
  accessEndsAt: null, createdAt: '2026-11-01T00:00:00Z', ...over
});
const open = async () => {
  await act(async () => root.render(<AccountSecurity />));
  await click(byText('button', 'Delete account…'));
};
const fill = async () => { await type('Your password', 'right'); await type('Type DELETE', 'DELETE'); };
const del = () => byText('button', 'Delete my account') as HTMLButtonElement;
const body = () => document.body.textContent ?? '';

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  auth.user = { email: 'me@example.com' };
  auth.deleteAccount.mockReset();
  auth.signOut.mockReset();
  erase.eraseAccountLocalData.mockClear();
  api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'none', subscription: null, accessEndsAt: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('account deletion with billing', () => {
  it('no subscription: nothing extra is shown, and deletion is exactly the old call with no billing step', async () => {
    auth.deleteAccount.mockResolvedValue({ ok: true });
    await open();
    expect(document.querySelector('[role="note"]')).toBeNull();
    await fill();
    await click(del());
    expect(auth.deleteAccount).toHaveBeenCalledWith('right');
    expect(api.prepareDeletion).not.toHaveBeenCalled();
  });

  it('billing preview unavailable (not configured, offline): deletion still proceeds and the database gate stays the safety net', async () => {
    api.fetchDeletionCheck.mockRejectedValue(new BillingApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable.'));
    auth.deleteAccount.mockResolvedValue({ ok: true });
    await open();
    expect(body()).not.toContain('Billing is temporarily unavailable');
    await fill();
    await click(del());
    expect(auth.deleteAccount).toHaveBeenCalledWith('right');
  });

  it('trial / unpaid subscription: tells the person it is cancelled first, needs no extra confirmation, and runs the billing step before deletion', async () => {
    api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'cancel_billing', subscription: sub({ status: 'authenticated' }), accessEndsAt: null });
    api.prepareDeletion.mockResolvedValue({ success: true, ready: true, requires: 'none', cancelled: 1, subscription: null, accessEndsAt: null });
    let stop: (() => Promise<{ ok: boolean }>) | undefined;
    auth.deleteAccount.mockImplementation(async (_pw: string, before?: () => Promise<{ ok: boolean }>) => { stop = before; return before ? before() : { ok: true }; });
    await open();
    expect(body()).toContain('Deleting your account cancels it first');
    await fill();
    expect(del().disabled).toBe(false);
    await click(del());
    expect(stop).toBeTypeOf('function');
    expect(api.prepareDeletion).toHaveBeenCalledWith(false);
    expect(erase.eraseAccountLocalData).toHaveBeenCalled();
  });

  it('paid subscription: states the no-refund consequence, keeps Delete disabled until confirmed, and sends the confirmation to the server', async () => {
    api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'confirm_cancel_paid', subscription: sub(), accessEndsAt: '2026-12-13T12:00:00Z' });
    api.prepareDeletion.mockResolvedValue({ success: true, ready: true, requires: 'none', cancelled: 1, subscription: null, accessEndsAt: null });
    auth.deleteAccount.mockImplementation(async (_pw: string, before?: () => Promise<{ ok: boolean }>) => (before ? before() : { ok: true }));
    await open();
    expect(body()).toContain('13 Dec 2026');
    expect(body()).toMatch(/cancels it immediately/);
    expect(body()).toMatch(/not refunded/);
    await fill();
    expect(del().disabled).toBe(true); // password and word are not enough
    await click(document.querySelector('[role="note"] input[type="checkbox"]'));
    expect(del().disabled).toBe(false);
    await click(del());
    expect(api.prepareDeletion).toHaveBeenCalledWith(true);
    expect(erase.eraseAccountLocalData).toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('if Razorpay cannot confirm the stop, nothing is deleted or erased and the server message is shown', async () => {
    api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'cancel_billing', subscription: sub({ status: 'authenticated' }), accessEndsAt: null });
    api.prepareDeletion.mockRejectedValue(new BillingApiError(409, 'cancellation_not_confirmed', 'We could not confirm that your subscription has stopped. Please try again in a moment.'));
    auth.deleteAccount.mockImplementation(async (_pw: string, before?: () => Promise<{ ok: boolean; error?: string }>) => (before ? before() : { ok: true }));
    await open();
    await fill();
    await click(del());
    expect(body()).toContain('could not confirm that your subscription has stopped');
    expect(body()).toContain('Nothing was removed');
    expect(erase.eraseAccountLocalData).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('a network failure in the billing step is a safe message and deletes nothing', async () => {
    api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'cancel_billing', subscription: sub({ status: 'authenticated' }), accessEndsAt: null });
    api.prepareDeletion.mockRejectedValue(new Error('boom'));
    auth.deleteAccount.mockImplementation(async (_pw: string, before?: () => Promise<{ ok: boolean; error?: string }>) => (before ? before() : { ok: true }));
    await open();
    await fill();
    await click(del());
    expect(body()).toContain('could not stop your subscription');
    expect(body()).not.toContain('boom');
    expect(erase.eraseAccountLocalData).not.toHaveBeenCalled();
  });

  it('when the database gate refuses (a subscription appeared meanwhile), nothing is erased and the requirement is re-read', async () => {
    auth.deleteAccount.mockResolvedValue({ ok: false, code: 'billing_cancellation_required', error: 'Your subscription has to be stopped before your account can be deleted. Nothing was removed. Please try again.' });
    await open();
    api.fetchDeletionCheck.mockClear();
    api.fetchDeletionCheck.mockResolvedValue({ success: true, requires: 'confirm_cancel_paid', subscription: sub(), accessEndsAt: '2026-12-13T12:00:00Z' });
    await fill();
    await click(del());
    expect(body()).toContain('has to be stopped');
    expect(api.fetchDeletionCheck).toHaveBeenCalled();
    expect(body()).toMatch(/not refunded/); // now shows the paid confirmation
    expect(erase.eraseAccountLocalData).not.toHaveBeenCalled();
  });
});
