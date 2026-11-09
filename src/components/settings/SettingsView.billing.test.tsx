import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: { email: 'me@example.com' } as { email: string } | null,
  signOut: vi.fn(async () => ({ ok: true })),
  changePassword: vi.fn(),
  signOutOtherDevices: vi.fn(),
  deleteAccount: vi.fn()
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../billing/BillingPanel', () => ({ BillingPanel: () => <div data-testid="billing-panel">billing</div> }));

import { SettingsView } from './SettingsView';
import { ThemeProvider } from '../../context/ThemeContext';
import { DEFAULT_PROFILE } from '../../storage/db';

let container: HTMLDivElement;
let root: Root;
const render = (openCategory?: { id: 'billing'; nonce: number }) =>
  act(() => {
    root.render(
      <ThemeProvider>
        <SettingsView profile={{ ...DEFAULT_PROFILE }} onProfileUpdated={vi.fn()} isDemoMode={false} onLoadDemoData={vi.fn()} onClearDemoData={vi.fn()} openCategory={openCategory} />
      </ThemeProvider>
    );
  });
const navButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('nav button')).find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  localStorage.clear();
  auth.user = { email: 'me@example.com' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Settings: Billing category', () => {
  it('appears in the existing category nav for a signed-in person and opens the billing panel', () => {
    render();
    expect(container.querySelector('[data-testid="billing-panel"]')).toBeNull();
    const b = navButton('Billing');
    expect(b).toBeTruthy();
    act(() => b!.click());
    expect(container.querySelector('[data-testid="billing-panel"]')).toBeTruthy();
    expect(navButton('Billing')!.getAttribute('aria-current')).toBeTruthy();
  });

  it('is hidden when nobody is signed in', () => {
    auth.user = null;
    render();
    expect(navButton('Billing')).toBeUndefined();
  });

  it('keeps the existing categories in their original order, with Billing before Account', () => {
    render();
    const labels = Array.from(container.querySelectorAll('nav button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Profile', 'Training', 'Units', 'Appearance', 'Notifications', 'Privacy & data', 'Billing', 'Account']);
  });

  it('"View plans" can open Billing directly, including when Settings is already on screen', () => {
    render();
    render({ id: 'billing', nonce: 1 });
    expect(container.querySelector('[data-testid="billing-panel"]')).toBeTruthy();
  });
});
