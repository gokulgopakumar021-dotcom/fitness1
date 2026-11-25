import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../storage/db';
import { SIGNED_OUT_SCOPE, setStorageScope } from '../../storage/storageScope';
import { AuthScreen, ResetPasswordScreen, SetupErrorScreen, SessionErrorScreen, SplashScreen } from './AuthScreens';
import { LandingPage } from '../home/LandingPage';
import { REFERRAL_ATTEMPT_WAIT_MS, attemptPendingReferral, captureReferralFromUrl, readPendingCreatorCode } from '../../lib/referralSignup';

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
  const emailConfirmed = Boolean(user?.email_confirmed_at);
  const [scopedFor, setScopedFor] = useState<string | null>(null);
  // The user id for which the creator-code attempt has finished (or was not needed). Billing screens render only after it, so a code
  // typed at sign-up is already attributed when checkout loads its status.
  const [referralDoneFor, setReferralDoneFor] = useState<string | null>(null);

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

  // A ?ref=CODE link is remembered only while nobody is signed in, so it can never attach itself to an existing session.
  useEffect(() => {
    if (status === 'unauthenticated') captureReferralFromUrl();
  }, [status]);

  // One attempt per verified session. The server never reveals whether the code was accepted, and nothing here can block the app:
  // a failure or the wait limit just lets the app render, and the code box at checkout remains the fallback.
  useEffect(() => {
    if (!userId) {
      setReferralDoneFor(null);
      return;
    }
    if (!emailConfirmed || !readPendingCreatorCode()) {
      setReferralDoneFor(userId);
      return;
    }
    let live = true;
    const timer = setTimeout(() => { if (live) setReferralDoneFor(userId); }, REFERRAL_ATTEMPT_WAIT_MS);
    void attemptPendingReferral().finally(() => {
      clearTimeout(timer);
      if (live) setReferralDoneFor(userId);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [userId, emailConfirmed]);

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

  if (scopedFor !== userId || referralDoneFor !== userId) return <SplashScreen />;
  return <React.Fragment key={userId}>{children}</React.Fragment>;
};

