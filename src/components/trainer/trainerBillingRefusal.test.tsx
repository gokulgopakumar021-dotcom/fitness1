import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiTrainerView } from './AiTrainerView';
import { FloatingTrainerWidget } from './FloatingTrainerWidget';
import { DEFAULT_PROFILE } from '../../storage/db';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { BILLING_REFUSAL_EVENT, BILLING_REQUIRED_MESSAGE } from '../../lib/billingGate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The two call sites that used to show a canned coach line whatever the server said. With the entitlement gate on they must say so instead. */
const CANNED = ['Keep up solid intent and proper form!', 'Focus on maintaining a solid core brace', 'Keep proper lifting cadence', "temporarily offline from cloud servers"];
const refusal = () => new Response(JSON.stringify({ success: false, code: 'subscription_required', error: BILLING_REQUIRED_MESSAGE, entitlement: { state: 'trial_expired' } }), { status: 402, headers: { 'Content-Type': 'application/json' } });

let container: HTMLDivElement;
let root: Root;
const events: unknown[] = [];
const onEvent = (e: Event) => events.push((e as CustomEvent).detail);
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };

beforeEach(() => {
  localStorage.clear();
  events.length = 0;
  window.addEventListener(BILLING_REFUSAL_EVENT, onEvent);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => refusal()));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  window.removeEventListener(BILLING_REFUSAL_EVENT, onEvent);
  vi.unstubAllGlobals();
  act(() => root.unmount());
  container.remove();
});

describe('402 from the entitlement gate at the trainer call sites', () => {
  it('Coach quick assist shows the subscription message, not a canned coach reply, and the app-wide prompt is raised', async () => {
    await act(async () => {
      root.render(
        <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
          <FloatingTrainerWidget currentTab="home" onNavigate={vi.fn()} activeSession={null} profile={DEFAULT_PROFILE} />
        </BluetoothGadgetProvider>
      );
    });
    await click(container.querySelector('button[aria-label="Ask Coach Iron"]'));
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Form check cue'));
    expect(container.textContent).toContain(BILLING_REQUIRED_MESSAGE);
    for (const c of CANNED) expect(container.textContent).not.toContain(c);
    expect(events).toEqual([{ kind: 'subscription_required', state: 'trial_expired' }]);
  });

  it('Coach Iron chat shows the subscription message as the reply, not a canned one, and the app-wide prompt is raised', async () => {
    await act(async () => {
      root.render(
        <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
          <AiTrainerView profile={DEFAULT_PROFILE} activeSession={null} onNavigate={vi.fn()} onProfileUpdated={vi.fn()} />
        </BluetoothGadgetProvider>
      );
    });
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Optimal rest time for double progression?'));
    expect(container.textContent).toContain(BILLING_REQUIRED_MESSAGE);
    for (const c of CANNED) expect(container.textContent).not.toContain(c);
    expect(events).toEqual([{ kind: 'subscription_required', state: 'trial_expired' }]);
  });
});
