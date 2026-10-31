import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Cb = (event: string, session: unknown) => void;
  const state = {
    listeners: new Set<Cb>(),
    unsubscribe: vi.fn(),
    cfg: { ok: true } as { ok: boolean; message?: string },
    client: null as any
  };
  return state;
});

vi.mock('../../lib/supabase', async (orig) => {
  const real = await orig<typeof import('../../lib/supabase')>();
  return { ...real, getSupabase: () => (h.cfg.ok ? h.client : null), getSupabaseConfigStatus: () => h.cfg };
});

import { AuthProvider, INIT_TIMEOUT_MS } from '../../context/AuthContext';
import { AuthGate } from './AuthGate';
import { SettingsView } from '../settings/SettingsView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { SIGNED_OUT_SCOPE, getStorageScope, scopedKey, setStorageScope } from '../../storage/storageScope';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session = (id: string, name = '', email = `${id.slice(0, 1)}@example.com`) => ({
  user: { id, email, user_metadata: name ? { full_name: name } : {} }
});

let container: HTMLDivElement;
let root: Root;
let mounts = 0;

const Probe: React.FC = () => {
  React.useEffect(() => { mounts++; }, []);
  return <div data-testid="private">PRIVATE:{db.getProfile().name}</div>;
};

const emit = async (event: string, s: unknown) => {
  await act(async () => { h.listeners.forEach((cb) => cb(event, s)); });
};
const mountApp = async (
  children: React.ReactNode = <Probe />,
  initialUnauthScreen: 'home' | 'signin' | 'signup' = 'signin'
) => {
  await act(async () => {
    root.render(
      <AuthProvider>
        <AuthGate initialUnauthScreen={initialUnauthScreen}>{children}</AuthGate>
      </AuthProvider>
    );
  });
};
const text = () => container.textContent ?? '';
const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;
const type = async (label: string, value: string) => {
  const input = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === label);
  const el = container.querySelector(`#${CSS.escape((input as HTMLLabelElement).htmlFor)}`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async () => {
  await act(async () => { q('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};
const click = async (label: string) => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes(label));
  if (!b) throw new Error(`button not found: ${label}`);
  await act(async () => { (b as HTMLButtonElement).click(); });
};

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
  mounts = 0;
  h.listeners.clear();
  h.cfg = { ok: true };
  h.unsubscribe = vi.fn();
  const auth = {
    onAuthStateChange: vi.fn((cb: any) => {
      h.listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => { h.listeners.delete(cb); h.unsubscribe(); } } } };
    }),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    resend: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null }))
  };
  h.client = { auth };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  setStorageScope(null);
});

describe('session gating', () => {
  it('shows no private UI while the session check is pending, then the sign-in screen when signed out', async () => {
    await mountApp();
    expect(q('[aria-busy="true"]')).not.toBeNull();
    expect(q('[data-testid="private"]')).toBeNull();
    await emit('INITIAL_SESSION', null);
    expect(text()).toContain('Welcome back');
    expect(q('[data-testid="private"]')).toBeNull();
  });

  it('restores an existing session on startup and scopes storage to that user before rendering the app', async () => {
    await mountApp();
    await emit('INITIAL_SESSION', session(A, 'Alice'));
    expect(text()).toContain('PRIVATE:Alice'); // profile seeded from account name
    expect(getStorageScope()).toBe(A);
  });

  it('registers exactly one auth listener and unsubscribes it on unmount', async () => {
    await mountApp();
    expect(h.client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.listeners.size).toBe(0);
    root = createRoot(container); // so afterEach can unmount
  });

  it('does not loop forever when initialisation never completes', async () => {
    vi.useFakeTimers();
    await mountApp();
    await act(async () => { vi.advanceTimersByTime(INIT_TIMEOUT_MS + 10); });
    expect(text()).toContain("Couldn't load your session");
    expect(q('[data-testid="private"]')).toBeNull();
  });

  it('shows a setup screen (and no sign-in form) when Supabase is not configured', async () => {
    h.cfg = { ok: false, message: 'Supabase is not configured. Set VITE_SUPABASE_URL' };
    await mountApp();
    expect(text()).toContain('Setup required');
    expect(text()).toContain('VITE_SUPABASE_URL');
    expect(q('[data-testid="private"]')).toBeNull();
  });
});

describe('sign in', () => {
  beforeEach(async () => { await mountApp(); await emit('INITIAL_SESSION', null); });

  it('rejects empty fields without calling Supabase', async () => {
    await submit();
    expect(text()).toContain('Enter your email address.');
    expect(h.client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows a generic message on bad credentials (no account-existence leak)', async () => {
    h.client.auth.signInWithPassword.mockResolvedValueOnce({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
    await type('Email', 'who@example.com');
    await type('Password', 'wrongpass1');
    await submit();
    expect(q('[role="alert"]')!.textContent).toBe('Incorrect email or password.');
  });

  it('signs in successfully and opens the app once the session event arrives', async () => {
    await type('Email', ' Me@Example.com ');
    await type('Password', 'goodpass1');
    await submit();
    expect(h.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'goodpass1' });
    await emit('SIGNED_IN', session(A, 'Me'));
    expect(text()).toContain('PRIVATE:Me');
  });

  it('offers to resend verification when the email is not confirmed', async () => {
    h.client.auth.signInWithPassword.mockResolvedValueOnce({ error: { code: 'email_not_confirmed' } });
    await type('Email', 'me@example.com');
    await type('Password', 'goodpass1');
    await submit();
    expect(text()).toContain('verify your email');
    await click('Resend verification email');
    expect(h.client.auth.resend).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    let release!: (v: unknown) => void;
    h.client.auth.signInWithPassword.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await type('Email', 'me@example.com');
    await type('Password', 'goodpass1');
    await submit();
    await submit();
    await submit();
    expect(h.client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(q<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => release({ error: null }));
  });
});

describe('sign up', () => {
  beforeEach(async () => { await mountApp(); await emit('INITIAL_SESSION', null); await click('Create account'); });

  it('validates required fields, email, password strength and confirmation', async () => {
    await submit();
    expect(text()).toContain('Enter your full name.');
    expect(text()).toContain('Enter your email address.');
    await type('Full name', 'Al');
    await type('Email', 'al@example.com');
    await type('Password', 'weak');
    await type('Confirm password', 'other');
    await submit();
    expect(text()).toContain('Use at least 8 characters.');
    expect(text()).toContain('Passwords do not match.');
    expect(h.client.auth.signUp).not.toHaveBeenCalled();
  });

  it('sends the name as signup metadata and shows the verification screen when no session exists', async () => {
    await type('Full name', 'Al Lifter');
    await type('Email', 'al@example.com');
    await type('Password', 'goodpass1');
    await type('Confirm password', 'goodpass1');
    await submit();
    const arg = h.client.auth.signUp.mock.calls[0][0];
    expect(arg.options.data).toEqual({ full_name: 'Al Lifter' });
    expect(arg.options.emailRedirectTo).toMatch(/\/$/);
    expect(text()).toContain('Check your email');
    expect(q('[data-testid="private"]')).toBeNull();
  });

  it('prevents duplicate sign-up submissions', async () => {
    let release!: (v: unknown) => void;
    h.client.auth.signUp.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await type('Full name', 'Al');
    await type('Email', 'al@example.com');
    await type('Password', 'goodpass1');
    await type('Confirm password', 'goodpass1');
    await submit();
    await submit();
    expect(h.client.auth.signUp).toHaveBeenCalledTimes(1);
    await act(async () => release({ data: { session: null }, error: null }));
  });
});

describe('password reset', () => {
  it('requests the reset email with the configured redirect and shows a non-revealing confirmation', async () => {
    await mountApp();
    await emit('INITIAL_SESSION', null);
    await click('Forgot password?');
    await type('Email', 'Me@Example.com');
    await submit();
    expect(h.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('me@example.com', { redirectTo: expect.stringMatching(/\/$/) });
    expect(text()).toContain('If an account exists');
  });

  it('handles the recovery callback: only the new-password form shows, then the app opens after updating', async () => {
    await mountApp();
    await emit('INITIAL_SESSION', null);
    await emit('PASSWORD_RECOVERY', session(A, 'Me'));
    expect(text()).toContain('Choose a new password');
    expect(q('[data-testid="private"]')).toBeNull(); // a recovery session must not open the app yet
    await emit('SIGNED_IN', session(A, 'Me')); // follow-up event must not skip the form
    expect(text()).toContain('Choose a new password');

    await type('New password', 'newpass123');
    await type('Confirm new password', 'different1');
    await submit();
    expect(text()).toContain('Passwords do not match.');
    expect(h.client.auth.updateUser).not.toHaveBeenCalled();

    await type('Confirm new password', 'newpass123');
    await submit();
    expect(h.client.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(text()).toContain('PRIVATE:Me');
  });

  it('shows a friendly message for an expired email link in the URL', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired');
    await mountApp();
    await emit('INITIAL_SESSION', null);
    expect(text()).toContain('expired or was already used');
    expect(window.location.hash).toBe('');
  });
});

describe('sign out, account switching and stale state', () => {
  it('signs out from Settings, returns to the sign-in screen and keeps the user\'s data', async () => {
    await mountApp(
      <SettingsView profile={{ ...DEFAULT_PROFILE }} onProfileUpdated={() => {}} isDemoMode={false} onLoadDemoData={() => {}} onClearDemoData={() => {}} />
    );
    await emit('INITIAL_SESSION', session(A, 'Alice'));
    expect(text()).toContain('Signed in as');
    db.saveSessions([{ id: 's', dayName: 'd', date: '2026-10-01', exercises: [], status: 'completed', startTime: '', notes: '' } as never]);

    await click('Sign out');
    expect(h.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await emit('SIGNED_OUT', null);
    expect(text()).toContain('Welcome back');
    expect(text()).not.toContain('Athlete Profile');
    expect(getStorageScope()).toBe(SIGNED_OUT_SCOPE);

    // data is still there for the next sign-in of the same account
    expect(localStorage.getItem(`ironlog_sessions_v1::u:${A}`)).not.toBeNull();
    await emit('SIGNED_IN', session(A, 'Alice'));
    expect(db.getSessions()).toHaveLength(1);
  });

  it('shows no stale data after switching accounts, and remounts the private tree', async () => {
    await mountApp();
    await emit('INITIAL_SESSION', session(A, 'Alice'));
    expect(text()).toContain('PRIVATE:Alice');
    expect(mounts).toBe(1);

    await emit('SIGNED_IN', session(B, 'Bob'));
    expect(text()).toContain('PRIVATE:Bob');
    expect(text()).not.toContain('Alice');
    expect(mounts).toBe(2);
    expect(getStorageScope()).toBe(B);
  });

  it('logging in does not overwrite an existing profile or convert sex: unspecified', async () => {
    setStorageScope(A);
    localStorage.setItem(scopedKey('ironlog_profile_v1'), JSON.stringify({ ...DEFAULT_PROFILE, name: 'Keep Me', sex: 'unspecified', age: 52 }));
    setStorageScope(null);
    await mountApp();
    await emit('INITIAL_SESSION', session(A, 'Account Name'));
    expect(text()).toContain('PRIVATE:Keep Me');
    expect(db.getProfile()).toMatchObject({ sex: 'unspecified', age: 52 });
  });

  it('does not expose existing unscoped (pre-account) data to a signed-in user', async () => {
    db.saveProfile({ ...DEFAULT_PROFILE, name: 'Legacy Person' });
    await mountApp();
    await emit('INITIAL_SESSION', session(A, 'Alice'));
    expect(text()).not.toContain('Legacy Person');
    expect(localStorage.getItem('ironlog_profile_v1')).toContain('Legacy Person'); // preserved, not deleted
  });

  it('removes the private app when the token refresh fails and the SDK signs the user out', async () => {
    await mountApp();
    await emit('INITIAL_SESSION', session(A, 'Alice'));
    await emit('SIGNED_OUT', null);
    expect(q('[data-testid="private"]')).toBeNull();
    expect(text()).toContain('Welcome back');
  });
});

describe('homepage before sign in and sign up', () => {
  it('defaults to rendering the homepage before auth screens when unauthenticated', async () => {
    // Mount without initialUnauthScreen override so it exercises default 'home'
    await act(async () => {
      root.render(
        <AuthProvider>
          <AuthGate>
            <Probe />
          </AuthGate>
        </AuthProvider>
      );
    });
    await emit('INITIAL_SESSION', null);

    // Verifies homepage content is rendered first
    expect(text()).toContain('IRONLOG AI');
    expect(text()).not.toMatch(/v2\.4/);
    expect(text()).toContain('Train Smarter.');
    expect(text()).toContain('EVERYTHING YOU NEED TO TRAIN SMARTER');
    expect(q('[data-testid="private"]')).toBeNull();
  });

  it('navigates from homepage to sign in and allows returning to homepage', async () => {
    await act(async () => {
      root.render(
        <AuthProvider>
          <AuthGate>
            <Probe />
          </AuthGate>
        </AuthProvider>
      );
    });
    await emit('INITIAL_SESSION', null);

    // Click Sign In on the homepage
    await click('Sign in');
    expect(text()).toContain('Welcome back');
    expect(text()).toContain('Sign in to your IronLog AI account');

    // Click Back to Homepage
    await click('Back to Homepage');
    expect(text()).toContain('Train Smarter.');
    expect(text()).toContain('EVERYTHING YOU NEED TO TRAIN SMARTER');
  });

  it('navigates from homepage to sign up and allows returning to homepage', async () => {
    await act(async () => {
      root.render(
        <AuthProvider>
          <AuthGate>
            <Probe />
          </AuthGate>
        </AuthProvider>
      );
    });
    await emit('INITIAL_SESSION', null);

    // Click Create account on the homepage
    await click('Create account');
    expect(text()).toContain('Create your account');
    expect(text()).toContain('Track training, nutrition and progress');

    // Click Back to Homepage
    await click('Back to Homepage');
    expect(text()).toContain('Train Smarter.');
    expect(text()).toContain('EVERYTHING YOU NEED TO TRAIN SMARTER');
  });
});

