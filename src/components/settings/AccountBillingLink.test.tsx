import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ user: { email: 'me@example.com' }, changePassword: vi.fn(), signOutOtherDevices: vi.fn(), deleteAccount: vi.fn(), signOut: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../storage/resetAll', () => ({ eraseAccountLocalData: vi.fn(async () => {}) }));
vi.mock('../../lib/billingApi', async (orig) => ({ ...(await orig<typeof import('../../lib/billingApi')>()), fetchDeletionCheck: vi.fn(), prepareDeletion: vi.fn() }));

import { AccountSecurity } from './AccountSecurity';
import { OPEN_BILLING_EVENT } from '../../lib/billingGate';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Account settings: route to billing', () => {
  it('has a Manage billing button that asks the app to open Settings, then Billing', async () => {
    await act(async () => root.render(<AccountSecurity />));
    const opened = vi.fn();
    window.addEventListener(OPEN_BILLING_EVENT, opened);
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Manage billing')!;
    expect(btn).toBeTruthy();
    await act(async () => btn.click());
    window.removeEventListener(OPEN_BILLING_EVENT, opened);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
