import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingRefusalNotice } from './BillingRefusalNotice';
import { BILLING_REFUSAL_EVENT, BILLING_REQUIRED_MESSAGE, BILLING_UNAVAILABLE_MESSAGE, type BillingRefusalDetail } from '../../lib/billingGate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onOpenBilling = vi.fn();
const fire = (detail: BillingRefusalDetail) => act(() => { window.dispatchEvent(new CustomEvent(BILLING_REFUSAL_EVENT, { detail })); });

beforeEach(() => {
  onOpenBilling.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<BillingRefusalNotice onOpenBilling={onOpenBilling} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BillingRefusalNotice', () => {
  it('renders nothing until the server refuses an AI request', () => {
    expect(container.textContent).toBe('');
  });
  it('402: shows the clear message and routes to billing, then closes', () => {
    fire({ kind: 'subscription_required', state: 'trial_expired' });
    expect(container.querySelector('[role="status"]')!.textContent).toContain(BILLING_REQUIRED_MESSAGE);
    act(() => { Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'View plans')!.click(); });
    expect(onOpenBilling).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
  });
  it('503 billing_unavailable: says it could not check, offers no plans button', () => {
    fire({ kind: 'billing_unavailable' });
    expect(container.textContent).toContain(BILLING_UNAVAILABLE_MESSAGE);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'View plans')).toBe(false);
  });
  it('can be dismissed with an accessible button', () => {
    fire({ kind: 'subscription_required' });
    act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click(); });
    expect(container.textContent).toBe('');
  });
});
