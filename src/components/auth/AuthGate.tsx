import React, { useLayoutEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../storage/db';
import { SIGNED_OUT_SCOPE, setStorageScope } from '../../storage/storageScope';
import { AuthScreen, ResetPasswordScreen, SetupErrorScreen, SessionErrorScreen, SplashScreen } from './AuthScreens';

/**
 * Renders the private app only when (a) the session check finished, (b) a user is signed in and (c) local storage is
 * already scoped to that user. Everything else renders an auth screen, so private data is never mounted underneath
 * one. The private tree is keyed by user id, so switching accounts remounts it and drops all in-memory state.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, user, fullName, message, retry } = useAuth();
  const userId = status === 'authenticated' && user ? user.id : null;
  const [scopedFor, setScopedFor] = useState<string | null>(null);

  // Layout effect: runs before paint and before children can mount for the new user.
  useLayoutEffect(() => {
    if (userId) {
      setStorageScope(userId);
      // Seeds this account's local fitness profile only if none exists yet; never overwrites.
      db.initProfileIfAbsent(fullName);
      setScopedFor(userId);
    } else {
      setStorageScope(SIGNED_OUT_SCOPE);
      setScopedFor(null);
    }
    // fullName intentionally omitted: a later metadata change must not re-run profile seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (status === 'loading') return <SplashScreen />;
  if (status === 'unconfigured') return <SetupErrorScreen message={message} />;
  if (status === 'error') return <SessionErrorScreen message={message} onRetry={retry} />;
  if (status === 'recovery') return <ResetPasswordScreen />;
  if (status === 'unauthenticated' || !userId) return <AuthScreen />;
  if (scopedFor !== userId) return <SplashScreen />;
  return <React.Fragment key={userId}>{children}</React.Fragment>;
};
