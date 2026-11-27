import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ from: [] as string[], signed: [] as string[], client: null as any }));
vi.mock('../../lib/supabase', async (orig) => {
  const real = await orig<typeof import('../../lib/supabase')>();
  return { ...real, getSupabase: () => h.client };
});
vi.mock('../../context/AuthContext', async (orig) => {
  const real = await orig<typeof import('../../context/AuthContext')>();
  return { ...real, useAuth: () => ({ status: 'authenticated' }) };
});

import { ExerciseVideoSection } from './ExerciseVideoSection';
import { EntitlementProvider } from '../../context/EntitlementContext';
import { OPEN_BILLING_EVENT } from '../../lib/billingGate';
import type { BillingStatus } from '../../lib/billingApi';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statusOf = (hasAccess: boolean): BillingStatus => ({
  enforcement: 'on', emailVerified: true,
  trial: { eligible: true, days: 3, firstChargePreviewAt: null, verificationDebit: { amountPaise: 500, refundedAutomatically: true } },
  plans: [], entitlement: { state: hasAccess ? 'trialing' : 'none', hasAccess, accessEndsAt: null }, subscription: null
});

let container: HTMLDivElement;
let root: Root;
let billingOpened: number;
const onBilling = () => { billingOpened++; };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const toggle = () => container.querySelector('button[aria-controls="exercise-video-panel"]') as HTMLButtonElement;

/** The app loads the entitlement at startup, long before any modal can open, so load it first and then show the UI. */
const render = async (hasAccess: boolean, ui: React.ReactElement) => {
  const withProvider = (child: React.ReactNode) => (
    <EntitlementProvider userId="u" fetchStatus={async () => statusOf(hasAccess)}>{child}</EntitlementProvider>
  );
  await act(async () => root.render(withProvider(null)));
  await flush();
  await act(async () => root.render(withProvider(ui)));
  await flush();
};

beforeEach(() => {
  h.from = []; h.signed = []; billingOpened = 0;
  const builder: any = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (res: any) => Promise.resolve({ data: [], error: null }).then(res) : () => builder) });
  h.client = { from: (t: string) => { h.from.push(t); return builder; }, storage: { from: () => ({ createSignedUrl: async (k: string) => { h.signed.push(k); return { data: { signedUrl: 'https://x/v.mp4' }, error: null }; } }) } };
  window.addEventListener(OPEN_BILLING_EVENT, onBilling);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  window.removeEventListener(OPEN_BILLING_EVENT, onBilling);
  await act(async () => root.unmount());
  container.remove();
});

describe('exercise video section (Video Library content inside the form modal)', () => {
  it('locked: shows Premium, a tap opens billing and the host closes; no catalog read, no signed URL', async () => {
    const onLocked = vi.fn();
    await render(false, <ExerciseVideoSection exerciseName="Barbell Back Squat" onLocked={onLocked} />);
    expect(container.textContent).toContain('Premium');
    await act(async () => toggle().click());
    await flush();
    expect(billingOpened).toBe(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#exercise-video-panel')).toBeNull();
    expect(h.from).toEqual([]);
    expect(h.signed).toEqual([]);
  });

  it('locked and opened by default ("Watch video"): closes the host, opens billing, requests nothing', async () => {
    const onLocked = vi.fn();
    await render(false, <ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen onLocked={onLocked} />);
    expect(onLocked).toHaveBeenCalled();
    expect(billingOpened).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('#exercise-video-panel')).toBeNull();
    expect(h.from).toEqual([]);
  });

  it('entitled: no lock, the section opens and reads the catalog as before', async () => {
    await render(true, <ExerciseVideoSection exerciseName="Barbell Back Squat" />);
    expect(container.textContent).not.toContain('Premium');
    await act(async () => toggle().click());
    await flush();
    expect(billingOpened).toBe(0);
    expect(container.querySelector('#exercise-video-panel')).not.toBeNull();
    expect(h.from.length).toBeGreaterThan(0);
  });
});
