import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Card } from '../ui';
import { SplashScreen } from '../auth/AuthScreens';
import { AccountSecurity } from '../settings/AccountSecurity';
import { useAuth } from '../../context/AuthContext';
import { useAgeEligibility } from '../../context/AgeEligibilityContext';
import { MINIMUM_AGE } from '../../legal/ageEligibility';

/**
 * Blocks the private app until the signed-in account has a recorded 18+ declaration (Stage 2D / Stage 2).
 *
 *  - "declared"    -> the app.
 *  - "unknown"     -> a blocking confirmation screen (every account created before this feature; new sign-ups already carry it).
 *  - "loading"     -> a splash (so the app never flashes for an age-unknown user).
 *  - "unavailable" -> the app, because the lookup itself failed (offline, or the database change is not live yet) and the
 *    offline-first workout features must keep working. This is NOT eligibility: the API refuses protected requests when it
 *    cannot tell (fail closed), and Body Scan stays closed. See docs/legal/AGE_ELIGIBILITY_DESIGN.md.
 *
 * Saying "I am under 18" (or choosing not to confirm) never keeps data silently: the person can sign out, or delete the
 * account and its data, which stays reachable on the server for exactly this reason.
 */
export const AgeEligibilityGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, declare } = useAgeEligibility();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  if (status === 'loading') return <SplashScreen />;
  if (status !== 'unknown') return <>{children}</>;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await declare();
    setBusy(false);
    if (!ok) setError('We could not save that. Check your connection and try again.');
  };

  return (
    <main className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] px-4 py-10 flex justify-center" data-testid="age-eligibility-gate">
      <div className="w-full max-w-lg space-y-6">
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-6 h-6 mt-0.5 shrink-0 text-volt-adaptive" aria-hidden />
            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-white">Please confirm your age</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Iron Log AI is for people aged {MINIMUM_AGE} or over. To keep using your account, confirm that you are {MINIMUM_AGE} years of age or older.
                We only record that you confirmed it. We do not ask for your date of birth.
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!declined && (
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button variant="ghost" onClick={() => setDeclined(true)} disabled={busy} className="min-h-[44px]">
                I am under {MINIMUM_AGE}
              </Button>
              <Button onClick={() => void confirm()} loading={busy} className="min-h-[44px]">
                I am {MINIMUM_AGE} or older
              </Button>
            </div>
          )}
        </Card>

        {declined && (
          <>
            <Card role="alert" className="space-y-3">
              <h2 className="text-base font-semibold text-white">You can’t use Iron Log AI yet</h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Iron Log AI is only available to people aged {MINIMUM_AGE} or over, so we can’t let you in. You can sign out, or delete your account and its data below.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="ghost" onClick={() => void signOut()} className="min-h-[44px]">
                  Sign out
                </Button>
                <Button variant="ghost" onClick={() => setDeclined(false)} className="min-h-[44px]">
                  I made a mistake. I am {MINIMUM_AGE} or older
                </Button>
              </div>
            </Card>
            <AccountSecurity />
          </>
        )}
      </div>
    </main>
  );
};
