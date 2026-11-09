import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { markBillingOnboardingDone, readOnboardingFlag } from '../../lib/billingOnboarding';
import { BillingOnboarding } from './BillingOnboarding';

/**
 * Routes a newly registered account to plan selection before the app, exactly while its onboarding flag is `pending`.
 *
 * - Existing accounts have no flag, so nothing changes for them and no billing request is made on their behalf.
 * - The flag is on the account (Supabase user metadata), so a refresh, a logout/login or another device lands in the same place.
 *   Onboarding is only over once the person continues or skips, never because of a Checkout redirect.
 * - Skipping/continuing opens the app straight away; saving the flag happens in the background. If saving fails, the screen
 *   offers itself again next time and can be skipped again. Nobody is locked out and nothing is charged by this step.
 * - It never grants access: the trial, plan and entitlement all come from the server.
 */
export const BillingOnboardingGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [finishedFor, setFinishedFor] = useState<string | null>(null);

  const pending = !!user && readOnboardingFlag(user) === 'pending' && finishedFor !== user.id;
  if (!user || !pending) return <>{children}</>;

  return (
    <BillingOnboarding
      onFinish={() => {
        setFinishedFor(user.id);
        void markBillingOnboardingDone();
      }}
    />
  );
};
