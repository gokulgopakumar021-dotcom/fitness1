import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { getSupabase } from '../lib/supabase';
import { declareAdult, fetchAgeEligibility, type AgeEligibilityStatus } from '../legal/ageEligibility';

export type AgeEligibilityState = AgeEligibilityStatus | 'loading';

export interface AgeEligibilityValue {
  status: AgeEligibilityState;
  /** Records the declaration for the signed-in user. Resolves true only when the database accepted it. */
  declare: () => Promise<boolean>;
}

/**
 * Default = "unknown" (FAIL CLOSED): anything that needs eligibility and is rendered outside the provider is treated as
 * not eligible. The real provider is mounted in App.tsx around the private app.
 */
export const AgeEligibilityContext = createContext<AgeEligibilityValue>({ status: 'unknown', declare: async () => false });

export const useAgeEligibility = () => useContext(AgeEligibilityContext);

/** Reads the signed-in user's eligibility from the DATABASE. Mounted only inside the authenticated app. */
export const AgeEligibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<AgeEligibilityState>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    const supabase = getSupabase();
    if (!userId || !supabase) {
      setStatus('unavailable');
      return undefined;
    }
    void fetchAgeEligibility(supabase).then((s) => {
      if (active) setStatus(s);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const declare = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return false;
    if (!(await declareAdult(supabase))) return false;
    // Re-read from the database rather than trusting the click.
    const s = await fetchAgeEligibility(supabase);
    setStatus(s);
    return s === 'declared';
  }, []);

  const value = useMemo(() => ({ status, declare }), [status, declare]);
  return <AgeEligibilityContext.Provider value={value}>{children}</AgeEligibilityContext.Provider>;
};
