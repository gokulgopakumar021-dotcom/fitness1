import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntitlementProvider, FOCUS_THROTTLE_MS, POLL_MS, usePremiumAccess, usePremiumGate, type PremiumAccess } from './EntitlementContext';
import { BILLING_REFUSAL_EVENT, OPEN_BILLING_EVENT } from '../lib/billingGate';
import type { BillingStatus } from '../lib/billingApi';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse('2026-11-26T10:00:00Z');
const status = (over: Partial<BillingStatus['entitlement']> = {}, enforcement: BillingStatus['enforcement'] = 'on'): BillingStatus => ({
  enforcement,
  emailVerified: true,
  trial: { eligible: true, days: 3, firstChargePreviewAt: null, verificationDebit: { amountPaise: 500, refundedAutomatically: true } },
  plans: [],
  entitlement: { state: 'none', hasAccess: false, accessEndsAt: null, ...over },
  subscription: null
});
const NO_ACCESS = () => status();
const TRIALING = (endsInMs = 3 * 86_400_000) => status({ state: 'trialing', hasAccess: true, accessEndsAt: new Date(Date.now() + endsInMs).toISOString() });
const ACTIVE = (endsInMs = 30 * 86_400_000) => status({ state: 'active', hasAccess: true, accessEndsAt: new Date(Date.now() + endsInMs).toISOString() });

let container: HTMLDivElement;
let root: Root;
let ctx: PremiumAccess;
let gate: ReturnType<typeof usePremiumGate>;
const Probe: React.FC = () => {
  ctx = usePremiumAccess();
  gate = usePremiumGate();
  return <span data-testid="p">{ctx.locked ? 'locked' : 'open'}</span>;
};
const text = () => container.querySelector('[data-testid="p"]')?.textContent;
const mount = async (fetchStatus: () => Promise<BillingStatus>, userId: string | null = 'u1') => {
  await act(async () => root.render(<EntitlementProvider userId={userId} fetchStatus={fetchStatus}><Probe /></EntitlementProvider>));
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('premium lock state from the existing billing status', () => {
  it('is not locked before the status is known, and when it cannot be read (the server still decides)', async () => {
    let release!: (s: BillingStatus) => void;
    await mount(() => new Promise<BillingStatus>((r) => { release = r; }));
    expect(text()).toBe('open');
    expect(ctx.loading).toBe(true);
    await act(async () => release(NO_ACCESS()));
    expect(text()).toBe('locked');
    expect(ctx.loading).toBe(false);

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(() => Promise.reject(new Error('offline')));
    expect(text()).toBe('open');
  });

  it.each([
    ['no access, enforced', status(), 'locked'],
    ['trialing', status({ state: 'trialing', hasAccess: true }), 'open'],
    ['active subscription', status({ state: 'active', hasAccess: true }), 'open'],
    ['cancelled but paid period remains', status({ state: 'cancelled_active', hasAccess: true }), 'open'],
    ['trial expired', status({ state: 'trial_expired', hasAccess: false }), 'locked'],
    ['payment failed', status({ state: 'payment_failed', hasAccess: false }), 'locked'],
    ['cancelled and ended', status({ state: 'cancelled', hasAccess: false }), 'locked'],
    ['no access but enforcement off (server allows)', status({}, 'off'), 'open'],
    ['no access but enforcement shadow (server allows)', status({}, 'shadow'), 'open']
  ])('%s -> %s', async (_name, s, expected) => {
    await mount(async () => s as BillingStatus);
    expect(text()).toBe(expected);
  });
});

describe('locks update by themselves', () => {
  it('unlocks when a trial starts (billing screen applies the new status)', async () => {
    await mount(async () => NO_ACCESS());
    expect(text()).toBe('locked');
    await act(async () => ctx.applyStatus(TRIALING()));
    expect(text()).toBe('open');
  });

  it('locks again when the trial expires, with no reload: re-reads shortly after the reported access end', async () => {
    const fetchStatus = vi.fn<() => Promise<BillingStatus>>().mockResolvedValueOnce(TRIALING(60_000)).mockResolvedValue(status({ state: 'trial_expired', hasAccess: false }));
    await mount(fetchStatus);
    expect(text()).toBe('open');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await advance(59_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await advance(2_500);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(text()).toBe('locked');
  });

  it('unlocks when a subscription becomes active (focus re-read) and locks when it expires', async () => {
    const fetchStatus = vi.fn<() => Promise<BillingStatus>>().mockResolvedValueOnce(NO_ACCESS()).mockResolvedValueOnce(ACTIVE(120_000)).mockResolvedValue(status({ state: 'cancelled', hasAccess: false }));
    await mount(fetchStatus);
    expect(text()).toBe('locked');
    await advance(FOCUS_THROTTLE_MS + 1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(text()).toBe('open');
    await advance(122_000);
    expect(text()).toBe('locked');
  });

  it('polls in the background and throttles focus re-reads', async () => {
    const fetchStatus = vi.fn<() => Promise<BillingStatus>>().mockResolvedValue(NO_ACCESS());
    await mount(fetchStatus);
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
    expect(fetchStatus).toHaveBeenCalledTimes(1); // throttled right after mount
    await advance(POLL_MS + 10);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('a 402 from any AI call shows the lock at once, even if the status still said access, and survives a failed re-read', async () => {
    const fetchStatus = vi.fn<() => Promise<BillingStatus>>().mockResolvedValueOnce(ACTIVE()).mockRejectedValue(new Error('offline'));
    await mount(fetchStatus);
    expect(text()).toBe('open');
    await act(async () => { window.dispatchEvent(new CustomEvent(BILLING_REFUSAL_EVENT, { detail: { kind: 'subscription_required', state: 'none' } })); });
    expect(text()).toBe('locked');
    // a 503 (billing unavailable) is not "no access"
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(async () => ACTIVE());
    await act(async () => { window.dispatchEvent(new CustomEvent(BILLING_REFUSAL_EVENT, { detail: { kind: 'billing_unavailable' } })); });
    expect(text()).toBe('open');
  });

  it('drops the previous account status when the signed-in account changes', async () => {
    const fetchStatus = vi.fn<() => Promise<BillingStatus>>().mockResolvedValueOnce(ACTIVE()).mockResolvedValue(NO_ACCESS());
    await mount(fetchStatus, 'a');
    expect(text()).toBe('open');
    await mount(fetchStatus, 'b');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(text()).toBe('locked');
  });
});

describe('guard', () => {
  it('runs the action while unlocked', async () => {
    await mount(async () => ACTIVE());
    const fn = vi.fn();
    const opened = vi.fn();
    window.addEventListener(OPEN_BILLING_EVENT, opened);
    gate.guard(fn)();
    window.removeEventListener(OPEN_BILLING_EVENT, opened);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('does not run the action while locked and opens the existing billing flow instead', async () => {
    await mount(async () => NO_ACCESS());
    const fn = vi.fn();
    const opened = vi.fn();
    window.addEventListener(OPEN_BILLING_EVENT, opened);
    gate.guard(fn)();
    window.removeEventListener(OPEN_BILLING_EVENT, opened);
    expect(fn).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('outside a provider nothing is locked', async () => {
    await act(async () => root.render(<Probe />));
    expect(text()).toBe('open');
  });
});
