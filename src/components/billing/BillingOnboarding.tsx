import React, { useState } from 'react';
import { ArrowRight, CircleDollarSign, Rocket, ShieldCheck } from 'lucide-react';
import { BrandLogo, Button, Card } from '../ui';
import { BRAND } from '../../brand';
import type { BillingStatus } from '../../lib/billingApi';
import { panelState } from '../../utils/billingPresentation';
import { BillingPanel } from './BillingPanel';
import { TrialEndExplainer } from './BillingParts';

interface Props {
  /** Called when the person continues to the app or skips. The host records that onboarding is over; it never grants anything. */
  onFinish: () => void;
  /** Test seams passed through to the billing flow. */
  verifyDelaysMs?: number[];
  now?: () => number;
}

/**
 * Shown once, right after a new account signs in: choose a plan, then start the trial through Razorpay authorisation.
 *
 * This screen only hosts the existing billing flow (BillingPanel, variant "onboarding"): the same endpoints, server-side plan
 * validation, Razorpay Checkout and server-side verification. It decides nothing itself. The trial starts when the SERVER has
 * confirmed the authorisation with Razorpay, and what is shown below is read back from the server's status after that.
 * Skipping is always possible and leaves the basic app available; the plan screen stays reachable in Settings, then Billing.
 */
export const BillingOnboarding: React.FC<Props> = ({ onFinish, verifyDelaysMs, now }) => {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const state = status ? panelState(status) : null;
  // The server already holds a trial or subscription for this account (just authorised, a refresh afterwards, or a returning user).
  const hasPlan = state === 'trialing' || state === 'active' || state === 'cancelled_active' || state === 'payment_pending' || state === 'payment_failed';
  const trialRunning = state === 'trialing';

  const heading = hasPlan
    ? trialRunning
      ? 'Your trial is active'
      : 'Your plan is set up'
    : status?.trial.eligible
      ? `Start your ${status.trial.days}-day trial`
      : 'Choose your plan';

  return (
    <div
      className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans px-4 sm:px-6 pb-10"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
    >
      <main className="mx-auto w-full max-w-2xl space-y-5" aria-labelledby="billing-onboarding-title">
        <div className="flex items-center justify-between gap-3">
          <BrandLogo variant="lockup" eager className="h-10 sm:h-12" />
          {!hasPlan && (
            <Button variant="ghost" size="sm" onClick={onFinish} className="min-h-[44px]">
              Skip for now
            </Button>
          )}
        </div>

        <header className="space-y-2">
          <p className="text-label text-zinc-500">Welcome to {BRAND.proseName}</p>
          <h1 id="billing-onboarding-title" className="text-2xl sm:text-3xl font-bold text-zinc-100">
            {heading}
          </h1>
          <p className="text-sm text-zinc-400">
            {hasPlan
              ? 'Here is what is set up on your account and what happens next.'
              : 'Pick a plan, then authorise payment with Razorpay. Your trial starts only after Razorpay confirms the authorisation.'}
          </p>
        </header>

        {!hasPlan && (
          <Card tone="raised" className="space-y-3" aria-label="How the trial works">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-volt-adaptive" aria-hidden />
              <h2 className="text-sm font-semibold text-white">How it works</h2>
            </div>
            <ol className="space-y-2 text-sm text-zinc-300 list-decimal pl-5">
              <li>Choose Monthly or Annual below. The plan price is set by our server, not by this page.</li>
              <li>
                Authorise payment in Razorpay&apos;s secure checkout. Razorpay may make a small card verification debit, shown as ₹5. It is not part of the plan price, and refund
                handling is described in the Refund Policy. UPI and bank mandates show their own amount in checkout.
              </li>
              <li>Once Razorpay confirms, the trial starts. The first plan charge is taken when the trial ends, and the plan then renews until you cancel.</li>
            </ol>
          </Card>
        )}

        <BillingPanel variant="onboarding" onStatusChange={setStatus} verifyDelaysMs={verifyDelaysMs} now={now} />

        {hasPlan && (
          <>
            {trialRunning && status && <TrialEndExplainer status={status} />}
            <Button fullWidth onClick={onFinish} icon={<Rocket className="w-4 h-4" aria-hidden />} className="min-h-[44px]">
              Continue to {BRAND.proseName}
            </Button>
            <p className="text-label text-zinc-500 text-center">Manage or cancel any time in Settings, then Billing.</p>
          </>
        )}

        {!hasPlan && status && (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={onFinish} icon={<ArrowRight className="w-4 h-4" aria-hidden />} className="min-h-[44px]">
              Continue without a plan
            </Button>
            <p className="text-label text-zinc-500 text-center flex items-start gap-1.5">
              <CircleDollarSign className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
              <span>You can use the basic app now. Some AI features may need a trial or subscription. Start one any time in Settings, then Billing.</span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
