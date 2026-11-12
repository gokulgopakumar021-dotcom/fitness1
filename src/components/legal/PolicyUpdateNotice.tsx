import React, { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { getSupabase } from '../../lib/supabase';
import { LEGAL_ROUTES } from '../../legal/routes';
import {
  acknowledgeCurrentPolicies,
  currentPolicyVersions,
  fetchPolicyNoticeStatus,
  isPolicyNoticeSnoozed,
  snoozePolicyNotice
} from '../../legal/policyAcceptance';

/**
 * One-time, non-blocking notice for signed-in users whose account has no recorded acceptance or acknowledgement of the
 * CURRENT Terms and Privacy Policy versions (every account created before this feature, and everyone after a version bump).
 *
 *  - Displaying it records nothing. Only pressing "I've read the updates" records an acknowledgement (server-side).
 *  - "Remind me later" hides it for this browser session only, so it does not return on every page load or refresh.
 *  - It never blocks, signs out or resets anything. If the check cannot run (offline, table not migrated), nothing shows.
 *  - It reads only the signed-in user's own rows; it is mounted inside the authenticated app only.
 */
export const PolicyUpdateNotice: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setVisible(false);
    setError(null);
    const supabase = getSupabase();
    if (!userId || !supabase || isPolicyNoticeSnoozed(userId)) return undefined;
    void fetchPolicyNoticeStatus(supabase).then((status) => {
      if (active && status === 'needs_notice') setVisible(true);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (!visible || !userId) return null;

  const acknowledge = async () => {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    const ok = await acknowledgeCurrentPolicies(supabase, currentPolicyVersions());
    setBusy(false);
    if (ok) setVisible(false);
    else setError('We could not save that. Check your connection and try again, or choose Remind me later.');
  };

  const later = () => {
    snoozePolicyNotice(userId);
    setVisible(false);
  };

  return (
    <section
      aria-label="Policy update"
      data-testid="policy-update-notice"
      className="w-full border-b border-line bg-surface-2 px-4 sm:px-6 lg:px-8 py-3"
    >
      <div className="mx-auto max-w-7xl flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <ScrollText className="w-5 h-5 mt-0.5 shrink-0 text-volt-adaptive" aria-hidden />
          <div className="min-w-0 text-sm text-zinc-300">
            <p className="font-semibold text-zinc-100">We’ve updated our Terms of Service and Privacy Policy.</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Please read them:{' '}
              <a href={LEGAL_ROUTES.terms.path} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-volt-adaptive">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href={LEGAL_ROUTES.privacy.path} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-volt-adaptive">
                Privacy Policy
              </a>
              . Seeing this notice does not change anything for you. Choosing “I’ve read the updates” records that you have seen them.
            </p>
            {error && (
              <p role="alert" className="text-xs text-danger mt-1">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={later} disabled={busy} className="min-h-[44px]">
            Remind me later
          </Button>
          <Button size="sm" onClick={() => void acknowledge()} loading={busy} className="min-h-[44px]">
            I’ve read the updates
          </Button>
        </div>
      </div>
    </section>
  );
};
