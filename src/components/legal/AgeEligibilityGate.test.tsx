import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(async () => ({ ok: true })),
  user: { id: 'u-1' } as { id: string } | null
}));

vi.mock('../../lib/supabase', () => ({ getSupabase: () => ({ rpc: h.rpc }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: h.user, signOut: h.signOut }) }));
vi.mock('../settings/AccountSecurity', () => ({ AccountSecurity: () => <div data-testid="account-security">DELETE ACCOUNT PANEL</div> }));
vi.mock('../auth/AuthScreens', () => ({ SplashScreen: () => <div data-testid="splash">SPLASH</div> }));

import { AgeEligibilityContext, AgeEligibilityProvider, type AgeEligibilityValue } from '../../context/AgeEligibilityContext';
import { AgeEligibilityGate } from './AgeEligibilityGate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const q = (sel: string) => container.querySelector(sel);
const btn = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const click = async (el: HTMLElement) => act(async () => { el.click(); });
const flush = async () => act(async () => { await Promise.resolve(); });

const withValue = async (value: AgeEligibilityValue) => {
  await act(async () => {
    root.render(
      <AgeEligibilityContext.Provider value={value}>
        <AgeEligibilityGate>
          <div data-testid="app">PRIVATE APP</div>
        </AgeEligibilityGate>
      </AgeEligibilityContext.Provider>
    );
  });
};

beforeEach(() => {
  h.rpc.mockReset();
  h.signOut.mockClear();
  h.user = { id: 'u-1' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AgeEligibilityGate', () => {
  it('shows a splash, never the app, while the database answer is pending', async () => {
    await withValue({ status: 'loading', declare: async () => true });
    expect(q('[data-testid="splash"]')).not.toBeNull();
    expect(q('[data-testid="app"]')).toBeNull();
  });

  it('opens the app for a declared adult', async () => {
    await withValue({ status: 'declared', declare: async () => true });
    expect(q('[data-testid="app"]')).not.toBeNull();
    expect(q('[data-testid="age-eligibility-gate"]')).toBeNull();
  });

  it('keeps the offline-first app usable when the lookup itself is unavailable (the server still fails closed)', async () => {
    await withValue({ status: 'unavailable', declare: async () => true });
    expect(q('[data-testid="app"]')).not.toBeNull();
  });

  it('BLOCKS an age-unknown account: the private app is not rendered at all', async () => {
    await withValue({ status: 'unknown', declare: async () => true });
    expect(q('[data-testid="age-eligibility-gate"]')).not.toBeNull();
    expect(q('[data-testid="app"]')).toBeNull();
    expect(text()).toContain('Please confirm your age');
    expect(text()).toContain('We do not ask for your date of birth');
    expect(container.querySelector('input[type="date"], input[type="number"]')).toBeNull();
  });

  it('records the confirmation through the database and lets the person in only when it succeeds', async () => {
    const declare = vi.fn(async () => true);
    await withValue({ status: 'unknown', declare });
    await click(btn('I am 18 or older'));
    expect(declare).toHaveBeenCalledTimes(1);
    expect(q('[role="alert"]')).toBeNull();
  });

  it('stays blocked and explains when the database refused or the network failed', async () => {
    await withValue({ status: 'unknown', declare: async () => false });
    await click(btn('I am 18 or older'));
    expect(text()).toContain('We could not save that');
    expect(q('[data-testid="app"]')).toBeNull();
  });

  it('"I am under 18" offers sign-out and account deletion, and never grants access or records anything', async () => {
    const declare = vi.fn(async () => true);
    await withValue({ status: 'unknown', declare });
    await click(btn('I am under 18'));
    expect(declare).not.toHaveBeenCalled();
    expect(text()).toContain('You can’t use Iron Log AI yet');
    expect(q('[data-testid="account-security"]')).not.toBeNull();
    expect(q('[data-testid="app"]')).toBeNull();
    await click(btn('Sign out'));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('can be reversed by an honest correction ("I made a mistake")', async () => {
    await withValue({ status: 'unknown', declare: async () => true });
    await click(btn('I am under 18'));
    await click(btn('I made a mistake'));
    expect(btn('I am 18 or older')).toBeTruthy();
    expect(q('[data-testid="account-security"]')).toBeNull();
  });
});

describe('AgeEligibilityProvider (reads the database, nothing else)', () => {
  const render = async () => {
    let seen!: AgeEligibilityValue;
    const Spy: React.FC = () => {
      seen = React.useContext(AgeEligibilityContext);
      return null;
    };
    await act(async () => { root.render(<AgeEligibilityProvider><Spy /></AgeEligibilityProvider>); });
    await flush();
    return () => seen;
  };

  it('starts as "loading", then reports what the database says', async () => {
    h.rpc.mockResolvedValue({ data: 'unknown', error: null });
    const seen = await render();
    expect(seen().status).toBe('unknown');
    expect(h.rpc).toHaveBeenCalledWith('get_my_age_eligibility');
  });

  it('after declare() it RE-READS the database instead of trusting the click', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'declare_adult_18_plus') return { error: null };
      return { data: declared ? 'declared' : 'unknown', error: null };
    });
    let declared = false;
    const seen = await render();
    expect(seen().status).toBe('unknown');
    declared = true;
    let ok = false;
    await act(async () => { ok = await seen().declare(); });
    expect(ok).toBe(true);
    expect(seen().status).toBe('declared');
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(['get_my_age_eligibility', 'declare_adult_18_plus', 'get_my_age_eligibility']);
  });

  it('declare() is false and the status stays "unknown" if the database did not record it', async () => {
    h.rpc.mockImplementation(async (fn: string) => (fn === 'declare_adult_18_plus' ? { error: { message: 'denied' } } : { data: 'unknown', error: null }));
    const seen = await render();
    let ok = true;
    await act(async () => { ok = await seen().declare(); });
    expect(ok).toBe(false);
    expect(seen().status).toBe('unknown');
  });

  it('a failing lookup is "unavailable", never "declared"', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const seen = await render();
    expect(seen().status).toBe('unavailable');
  });

  it('is "unavailable" without a signed-in user', async () => {
    h.user = null;
    const seen = await render();
    expect(seen().status).toBe('unavailable');
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('the default context (no provider) is FAIL CLOSED: "unknown"', () => {
    let seen: AgeEligibilityValue | undefined;
    const Spy: React.FC = () => { seen = React.useContext(AgeEligibilityContext); return null; };
    act(() => { root.render(<Spy />); });
    expect(seen!.status).toBe('unknown');
  });
});
