import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getAuthRedirectUrl, getSupabase, getSupabaseConfigStatus } from '../lib/supabase';
import { friendlyAuthError, normalizeEmail } from '../utils/authValidation';

export type AuthStatus =
  | 'loading' // session check not finished: private UI must not render
  | 'unconfigured' // Supabase env missing/invalid
  | 'error' // initialisation failed or timed out
  | 'unauthenticated'
  | 'recovery' // arrived via a password-reset link: only the new-password form is allowed
  | 'authenticated';

export interface AuthResult { ok: boolean; error?: string }
export interface SignUpResult extends AuthResult { needsVerification?: boolean }

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Account display name from sign-up metadata (account data, not fitness-profile data). */
  fullName: string;
  message: string | null; // config / init error text
  callbackError: string | null; // e.g. expired email link
  clearCallbackError: () => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (fullName: string, email: string, password: string) => Promise<SignUpResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  /** Signed-in password change. Re-checks the current password first. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  /** Ends every OTHER session of this account (this browser stays signed in). */
  signOutOtherDevices: () => Promise<AuthResult>;
  /** Re-checks the password, then deletes the cloud account via the delete_own_account() function. Does NOT touch local data. */
  deleteAccount: (password: string) => Promise<AuthResult>;
  retry: () => void;
}

const noop = async (): Promise<AuthResult> => ({ ok: false, error: 'Authentication is not available.' });

const AuthContext = createContext<AuthContextValue>({
  status: 'unauthenticated',
  user: null,
  fullName: '',
  message: null,
  callbackError: null,
  clearCallbackError: () => {},
  signIn: noop,
  signUp: noop,
  resendVerification: noop,
  requestPasswordReset: noop,
  updatePassword: noop,
  signOut: noop,
  changePassword: noop,
  signOutOtherDevices: noop,
  deleteAccount: noop,
  retry: () => {}
});

export const INIT_TIMEOUT_MS = 10000;

/** Reads (and strips) an error Supabase put in the callback URL, e.g. an expired or reused email link. */
function takeCallbackError(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = hash.get('error_code') || params.get('error_code');
  const hasError = hash.get('error') || params.get('error');
  if (!code && !hasError) return null;
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    /* ignore */
  }
  return code === 'otp_expired'
    ? 'That email link has expired or was already used. Request a new one.'
    : 'That email link is invalid. Request a new one, and open it in the same browser you used to ask for it.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(() => takeCallbackError());
  const [attempt, setAttempt] = useState(0);
  const recoveryRef = useRef(false);

  // The ONE auth listener. Cleaned up on unmount / retry.
  useEffect(() => {
    const cfg = getSupabaseConfigStatus();
    const supabase = getSupabase();
    if (!cfg.ok || !supabase) {
      setStatus('unconfigured');
      setMessage(cfg.ok ? 'Supabase client could not be created.' : cfg.message);
      return;
    }

    let active = true;
    let settled = false;
    setStatus('loading');
    setMessage(null);

    const timer = setTimeout(() => {
      if (active && !settled) {
        setStatus('error');
        setMessage('Could not check your session. Check your connection and try again.');
      }
    }, INIT_TIMEOUT_MS);

    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        settled = true;
        clearTimeout(timer);
        // Only synchronous state updates in here: awaiting other Supabase calls inside this callback can deadlock.
        if (event === 'PASSWORD_RECOVERY') recoveryRef.current = true;
        if (event === 'SIGNED_OUT') recoveryRef.current = false;
        const next = session?.user ?? null;
        setUser(next);
        if (!next) setStatus('unauthenticated');
        else setStatus(recoveryRef.current ? 'recovery' : 'authenticated');
      });
      return () => {
        active = false;
        clearTimeout(timer);
        data.subscription.unsubscribe();
      };
    } catch {
      clearTimeout(timer);
      setStatus('error');
      setMessage('Authentication failed to initialise. Please try again.');
      return undefined;
    }
  }, [attempt]);

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const signUp = useCallback<AuthContextValue['signUp']>(async (fullName, email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: getAuthRedirectUrl() }
      });
      if (error) return { ok: false, error: friendlyAuthError(error) };
      // With "Confirm email" enabled there is no session yet. An already-registered address also returns no session
      // (by design, to avoid revealing which emails exist), so both cases show the same "check your email" screen.
      return { ok: true, needsVerification: !data.session };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const resendVerification = useCallback<AuthContextValue['resendVerification']>(async (email) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: normalizeEmail(email),
        options: { emailRedirectTo: getAuthRedirectUrl() }
      });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(async (email) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: getAuthRedirectUrl()
      });
      // Rate-limit errors are shown; everything else reads as success so account existence isn't revealed.
      if (error && (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit' || error.status === 429)) {
        return { ok: false, error: friendlyAuthError(error) };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(async (password) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { ok: false, error: friendlyAuthError(error) };
      recoveryRef.current = false;
      setStatus((s) => (s === 'recovery' ? 'authenticated' : s));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const signOut = useCallback<AuthContextValue['signOut']>(async () => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      // 'local' ends this browser's session only. Fitness data is deliberately left in place.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) return { ok: false, error: friendlyAuthError(error) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  /** Confirms the person at the keyboard knows the account password before a sensitive change. */
  const verifyPassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      const supabase = getSupabase();
      const email = user?.email;
      if (!supabase || !email) return { ok: false, error: 'Authentication is not available.' };
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error ? { ok: false, error: 'That password is not correct.' } : { ok: true };
      } catch (e) {
        return { ok: false, error: friendlyAuthError(e as Error) };
      }
    },
    [user]
  );

  const changePassword = useCallback<AuthContextValue['changePassword']>(
    async (currentPassword, newPassword) => {
      const verified = await verifyPassword(currentPassword);
      if (!verified.ok) return verified;
      return updatePassword(newPassword);
    },
    [verifyPassword, updatePassword]
  );

  const signOutOtherDevices = useCallback<AuthContextValue['signOutOtherDevices']>(async () => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e as Error) };
    }
  }, []);

  const deleteAccount = useCallback<AuthContextValue['deleteAccount']>(
    async (password) => {
      const supabase = getSupabase();
      if (!supabase) return { ok: false, error: 'Authentication is not configured.' };
      const verified = await verifyPassword(password);
      if (!verified.ok) return verified;
      try {
        const { error } = await supabase.rpc('delete_own_account');
        if (error) {
          return {
            ok: false,
            error: 'Your account could not be deleted. Nothing was removed. Check your connection and try again.'
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Your account could not be deleted. Nothing was removed. Check your connection and try again.' };
      }
    },
    [verifyPassword]
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const clearCallbackError = useCallback(() => setCallbackError(null), []);

  const fullName = useMemo(() => {
    const v = user?.user_metadata?.full_name;
    return typeof v === 'string' ? v.trim() : '';
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status, user, fullName, message, callbackError, clearCallbackError,
      signIn, signUp, resendVerification, requestPasswordReset, updatePassword, signOut,
      changePassword, signOutOtherDevices, deleteAccount, retry
    }),
    [status, user, fullName, message, callbackError, clearCallbackError, signIn, signUp, resendVerification, requestPasswordReset, updatePassword, signOut,
      changePassword, signOutOtherDevices, deleteAccount, retry]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
