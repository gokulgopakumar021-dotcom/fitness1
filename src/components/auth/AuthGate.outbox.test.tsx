import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTBOX_BASE_KEY } from '../../wearables/outboxStore';
import { getStorageScope, setStorageScope } from '../../storage/storageScope';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let auth: { status: string; user: { id: string } | null } = { status: 'unauthenticated', user: null };

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ ...auth, fullName: '', message: '', retry: () => undefined })
}));
vi.mock('../../storage/db', () => ({ db: { initProfileIfAbsent: () => undefined } }));
vi.mock('../home/LandingPage', () => ({ LandingPage: () => <div>landing</div> }));
vi.mock('./AuthScreens', () => ({
  AuthScreen: () => <div>auth</div>, ResetPasswordScreen: () => null, SetupErrorScreen: () => null, SessionErrorScreen: () => null, SplashScreen: () => <div>splash</div>
}));

import { AuthGate } from './AuthGate';

const keyFor = (s: string) => `${OUTBOX_BASE_KEY}::u:${s}`;
const signIn = (id: string) => { auth = { status: 'authenticated', user: { id } }; };
const gate = () => <AuthGate><div>app</div></AuthGate>;
let root: Root | null = null;
let host: HTMLElement | null = null;
const mount = () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => { root!.render(gate()); }); };
const refresh = () => act(() => { root!.render(gate()); });
const signOut = () => { auth = { status: 'unauthenticated', user: null }; };

describe('AuthGate and the wearable outbox', () => {
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); setStorageScope(null); signOut(); });
  afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; host = null; setStorageScope(null); localStorage.clear(); });

  it('keeps the signed-in user\'s outbox across a reload (null -> signed-out -> same user)', () => {
    localStorage.setItem(keyFor(A), 'pending');
    mount();
    signIn(A);
    refresh();
    expect(getStorageScope()).toBe(A);
    expect(localStorage.getItem(keyFor(A))).toBe('pending');
  });

  it('sign-out discards the outgoing account\'s outbox only', () => {
    signIn(A);
    mount();
    localStorage.setItem(keyFor(A), 'a'); localStorage.setItem(keyFor(B), 'b');
    signOut();
    refresh();
    expect(localStorage.getItem(keyFor(A))).toBeNull();
    expect(localStorage.getItem(keyFor(B))).toBe('b');
  });

  it('switching directly from account A to B discards A\'s outbox and never exposes it to B', () => {
    signIn(A);
    mount();
    localStorage.setItem(keyFor(A), 'a');
    signIn(B);
    refresh();
    expect(getStorageScope()).toBe(B);
    expect(localStorage.getItem(keyFor(A))).toBeNull();
  });
});
