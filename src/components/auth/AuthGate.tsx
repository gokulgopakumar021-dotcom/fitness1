import React, { useLayoutEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../storage/db';
import { SIGNED_OUT_SCOPE, setStorageScope } from '../../storage/storageScope';
import { AuthScreen, ResetPasswordScreen, SetupErrorScreen, SessionErrorScreen, SplashScreen } from './AuthScreens';
import { LandingPage } from '../home/LandingPage';

export interface AuthGateProps {
  children: React.ReactNode;
  initialUnauthScreen?: 'home' | 'signin' | 'signup';
}

/**
 * Renders the private app only when (a) the session check finished, (b) a user is signed in and (c) local storage is
 * already scoped to that user. When unauthenticated, it presents the Homepage first, with direct actions to open
 * the Sign In and Create Account screens, or return back to the Homepage.
 */
export const AuthGate: React.FC<AuthGateProps> = ({ children, initialUnauthScreen = 'home' }) => {
  const { status, user, fullName, message, retry } = useAuth();
  const userId = status === 'authenticated' && user ? user.id : null;
  const [scopedFor, setScopedFor] = useState<string | null>(null);

  const [unauthScreen, setUnauthScreen] = useState<'home' | 'signin' | 'signup'>(() => {
    if (typeof window !== 'undefined' && window.location?.hash) {
      if (window.location.hash.includes('signin') || window.location.hash.includes('login')) return 'signin';
      if (window.location.hash.includes('signup') || window.location.hash.includes('register')) return 'signup';
    }
    return initialUnauthScreen;
  });

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

  if (status === 'unauthenticated' || !userId) {
    if (unauthScreen === 'home') {
      return (
        <LandingPage
          onGoToSignIn={() => setUnauthScreen('signin')}
          onGoToSignUp={() => setUnauthScreen('signup')}
          onSignIn={() => setUnauthScreen('signin')}
          onSignUp={() => setUnauthScreen('signup')}
        />
      );
    }
    return (
      <AuthScreen
        initialMode={unauthScreen}
        onBackToHome={() => setUnauthScreen('home')}
      />
    );
  }

  if (scopedFor !== userId) return <SplashScreen />;
  return <React.Fragment key={userId}>{children}</React.Fragment>;
};

