import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  client: null as any,
  select: vi.fn(),
  rpc: vi.fn()
}));

vi.mock('../../lib/supabase', () => ({ getSupabase: () => h.client }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));

import { PolicyUpdateNotice } from './PolicyUpdateNotice';
import { LEGAL } from '../../legal/legalConfig';
import { POLICY_NOTICE_SNOOZE_KEY } from '../../legal/policyAcceptance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const mount = async () => { await act(async () => { root.render(<PolicyUpdateNotice />); }); await flush(); };
const notice = () => container.querySelector('[data-testid="policy-update-notice"]');
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

/** Fake of supabase.from('legal_acceptances').select('id').eq().eq().limit(1) */
const fakeClient = () => {
  const chain: any = {};
  chain.select = (...a: unknown[]) => { h.select('select', ...a); return chain; };
  chain.eq = (...a: unknown[]) => { h.select('eq', ...a); return chain; };
  chain.limit = (...a: unknown[]) => { h.select('limit', ...a); return Promise.resolve(h.select.mock.results.length ? (chain.__result as any) : { data: [], error: null }); };
  return { from: (t: string) => { h.select('from', t); return chain; }, rpc: h.rpc, __chain: chain };
};
const setStatus = (result: { data: unknown; error: unknown } | 'throw') => {
  h.client = fakeClient();
  if (result === 'throw') h.client.__chain.limit = () => Promise.reject(new Error('boom'));
  else h.client.__chain.__result = result;
};

beforeEach(() => {
  sessionStorage.clear();
  h.user = { id: 'user-1' };
  h.select.mockReset();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ error: null });
  setStatus({ data: [], error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('PolicyUpdateNotice (existing users)', () => {
  it('asks only for THIS user\'s current versions, and shows when no record exists', async () => {
    await mount();
    expect(notice()).not.toBeNull();
    expect(h.select).toHaveBeenCalledWith('from', 'legal_acceptances');
    expect(h.select).toHaveBeenCalledWith('eq', 'terms_version', LEGAL.termsVersion);
    expect(h.select).toHaveBeenCalledWith('eq', 'privacy_version', LEGAL.privacyVersion);
  });

  it('links to both documents in a new tab', async () => {
    await mount();
    const a = Array.from(notice()!.querySelectorAll('a')).map((x) => [x.getAttribute('href'), x.getAttribute('target')]);
    expect(a).toEqual([['/terms', '_blank'], ['/privacy', '_blank']]);
  });

  it('does NOT show when the current versions are already recorded (new accounts, or already acknowledged)', async () => {
    setStatus({ data: [{ id: 'x' }], error: null });
    await mount();
    expect(notice()).toBeNull();
  });

  it('fails safe: no notice when the check errors, throws, or Supabase is unavailable', async () => {
    setStatus({ data: null, error: { message: 'relation "legal_acceptances" does not exist' } });
    await mount();
    expect(notice()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    setStatus('throw');
    await mount();
    expect(notice()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    h.client = null;
    await mount();
    expect(notice()).toBeNull();
  });

  it('shows nothing when signed out', async () => {
    h.user = null;
    await mount();
    expect(notice()).toBeNull();
    expect(h.select).not.toHaveBeenCalled();
  });

  it('displaying the notice records nothing', async () => {
    await mount();
    expect(notice()).not.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('"I\'ve read the updates" records the current versions server-side and closes the notice', async () => {
    await mount();
    await act(async () => { button('I’ve read the updates').click(); });
    await flush();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('acknowledge_legal_update', { p_terms_version: LEGAL.termsVersion, p_privacy_version: LEGAL.privacyVersion });
    expect(notice()).toBeNull();
  });

  it('keeps the notice and explains when saving fails; nothing is hidden or lost', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'network' } });
    await mount();
    await act(async () => { button('I’ve read the updates').click(); });
    await flush();
    expect(notice()).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not save');
  });

  it('"Remind me later" hides it for the session without recording anything, and it does not return on a refresh', async () => {
    await mount();
    await act(async () => { button('Remind me later').click(); });
    expect(notice()).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(POLICY_NOTICE_SNOOZE_KEY)).toContain('user-1');
    // simulated page refresh in the same tab: remount
    await act(async () => root.unmount());
    root = createRoot(container);
    h.select.mockClear();
    await mount();
    expect(notice()).toBeNull();
    expect(h.select).not.toHaveBeenCalled(); // no further request either
  });

  it('a snooze belongs to one user and one version pair', async () => {
    await mount();
    await act(async () => { button('Remind me later').click(); });
    await act(async () => root.unmount());
    root = createRoot(container);
    h.user = { id: 'user-2' };
    await mount();
    expect(notice()).not.toBeNull();
  });
});
