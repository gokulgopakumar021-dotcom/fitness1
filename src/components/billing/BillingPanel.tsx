import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, ErrorState, LoadingState } from '../ui';
import { SettingsCard } from '../settings/SettingsParts';
import { useAuth } from '../../context/AuthContext';
import { BRAND } from '../../brand';
import {
  BillingApiError, cancelSubscription, createSubscription, fetchBillingPayments, fetchBillingStatus, startRecovery, verifySubscription,
  type BillingPayment, type BillingStatus, type CheckoutCallback, type PlanKey
} from '../../lib/billingApi';
import { openSubscriptionCheckout } from '../../lib/razorpayCheckout';
import { formatDate, formatInr, intervalWord, panelState, planName, sameLocalDay } from '../../utils/billingPresentation';
import { CancelDialog, Disclosure, PaymentFailedNotice, PaymentHistory, PaymentPendingNotice, PlanPicker, SelectedPlanSummary, StatusSummary, TrialUsedNotice } from './BillingParts';

/** Waits between verify attempts when Razorpay has not confirmed the authorisation yet (server answers 409 authorization_not_confirmed). */
export const DEFAULT_VERIFY_DELAYS_MS = [1500, 3000, 5000];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Flow =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'checkout' }
  | { phase: 'verifying' }
  | { phase: 'success'; trialEndAt: string | null; trial: boolean }
  | { phase: 'dismissed' }
  | { phase: 'recovered' }
  | { phase: 'recovery_dismissed' }
  | { phase: 'unconfirmed' }
  | { phase: 'error'; message: string }
  | { phase: 'cancelled'; accessEndsAt: string | null };

interface Props {
  /** Test seam: waits between verify retries. */
  verifyDelaysMs?: number[];
  now?: () => number;
  /**
   * `settings` (default) is the full billing screen. `onboarding` is the same flow shown right after sign-up: it adds a
   * selected-plan summary and a trial-already-used notice, restores the plan of an unfinished attempt after a refresh, and leaves
   * out billing history and cancellation (those stay in Settings). It reuses every endpoint and rule; nothing here decides access.
   */
  variant?: 'settings' | 'onboarding';
  /** Called with every status the server returns, so a host screen can react to the server's decision (display only). */
  onStatusChange?: (status: BillingStatus) => void;
}

export const BillingPanel: React.FC<Props> = ({ verifyDelaysMs = DEFAULT_VERIFY_DELAYS_MS, now = Date.now, variant = 'settings', onStatusChange }) => {
  const onboarding = variant === 'onboarding';
  const { user } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payments, setPayments] = useState<BillingPayment[] | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState<PlanKey>('monthly');
  const [agreed, setAgreed] = useState(false);
  const [flow, setFlow] = useState<Flow>({ phase: 'idle' });
  /** Set when the server's exact first-charge date differs from the date that was disclosed: re-disclose before Checkout. */
  const [correctedDate, setCorrectedDate] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Synchronous in-flight lock: state updates are async, so two clicks in the same tick could both pass a `busy` check. */
  const submitting = useRef(false);
  const seededPlan = useRef(false);
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadPayments = useCallback(async () => {
    setPaymentsError(null);
    try {
      const p = await fetchBillingPayments();
      if (mounted.current) setPayments(p);
    } catch (e) {
      if (mounted.current) setPaymentsError(e instanceof BillingApiError ? e.message : 'Could not load billing history.');
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<BillingStatus | null> => {
    try {
      const s = await fetchBillingStatus();
      if (!mounted.current) return null;
      setStatus(s);
      setLoadError(null);
      return s;
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof BillingApiError ? e.message : 'Could not load your subscription.');
      return null;
    }
  }, []);

  const reloadAll = useCallback(async () => {
    // Onboarding does not show billing history, so it does not request it.
    await Promise.all([loadStatus(), onboarding ? Promise.resolve() : loadPayments()]);
  }, [loadStatus, loadPayments, onboarding]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    if (!status) return;
    statusCallback.current?.(status);
    // After a refresh in the middle of onboarding, the server still holds the plan of the unfinished attempt: show that one again.
    if (onboarding && !seededPlan.current) {
      seededPlan.current = true;
      const s = status.subscription;
      if (s && (s.status === 'created' || s.status === 'creating') && status.plans.some((p) => p.key === s.planKey)) setPlanKey(s.planKey);
    }
  }, [status, onboarding]);

  if (!status) {
    return loadError ? (
      <ErrorState
        title="Billing is unavailable"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void loadStatus()}>
            Try again
          </Button>
        }
      />
    ) : (
      <LoadingState label="Loading your subscription…" />
    );
  }

  const state = panelState(status);
  const plan = status.plans.find((p) => p.key === planKey) ?? status.plans[0];
  const canSubscribe = state === 'none' || state === 'unfinished' || state === 'trial_expired' || state === 'cancelled';
  const sub = status.subscription;
  const canCancel =
    state === 'trialing' || state === 'payment_pending' || state === 'payment_failed' || (state === 'active' && !sub?.cancelAtCycleEnd);
  const busy = flow.phase === 'creating' || flow.phase === 'checkout' || flow.phase === 'verifying';
  const disclosedTrial = status.trial.eligible;
  const disclosedDate = correctedDate ?? status.trial.firstChargePreviewAt;

  const verifyWithRetry = async (cb: CheckoutCallback, mode: 'authorize' | 'recover' = 'authorize') => {
    setFlow({ phase: 'verifying' });
    for (let attempt = 0; attempt <= verifyDelaysMs.length; attempt++) {
      try {
        const r = await verifySubscription(cb);
        if (!mounted.current) return;
        await reloadAll();
        if (!mounted.current) return;
        if (mode === 'recover') setFlow({ phase: 'recovered' });
        else setFlow({ phase: 'success', trialEndAt: r.subscription.trialEndAt, trial: !!r.subscription.trialEndAt });
        return;
      } catch (e) {
        const notYet = e instanceof BillingApiError && e.code === 'authorization_not_confirmed';
        if (notYet && attempt < verifyDelaysMs.length) {
          await sleep(verifyDelaysMs[attempt]);
          if (!mounted.current) return;
          continue;
        }
        if (!mounted.current) return;
        if (notYet) {
          await reloadAll();
          if (mounted.current) setFlow({ phase: 'unconfirmed' });
          return;
        }
        setFlow({ phase: 'error', message: e instanceof BillingApiError ? e.message : mode === 'recover' ? 'We could not confirm your payment update.' : 'We could not confirm your payment authorisation.' });
        return;
      }
    }
  };

  /**
   * Payment recovery (state pending or halted). The server re-reads Razorpay and only hands back Checkout parameters if the
   * subscription really needs a payment update. Checkout then lets the customer change the card; as always, its callback is only
   * a hint and the server checks it and asks Razorpay before the status changes.
   */
  const recoverPayment = async () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    setFlow({ phase: 'creating' });
    try {
      const rec = await startRecovery();
      if (!mounted.current) return;
      setFlow({ phase: 'checkout' });
      const outcome = await openSubscriptionCheckout({
        keyId: rec.keyId,
        subscriptionId: rec.subscriptionId,
        description: `Update payment method, ${planName(rec.planKey)} plan`,
        email: user?.email ?? null,
        brandName: BRAND.proseName,
        cardChange: true
      });
      if (!mounted.current) return;
      if (outcome.kind === 'dismissed') {
        setFlow({ phase: 'recovery_dismissed' });
        await loadStatus();
        return;
      }
      await verifyWithRetry(outcome.response, 'recover');
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof BillingApiError && e.code === 'recovery_not_available') await reloadAll(); // it already healed (e.g. from Razorpay's emailed link)
      setFlow({
        phase: 'error',
        message: e instanceof BillingApiError ? e.message : 'Secure checkout could not be opened. Check your connection and try again. Nothing was changed.'
      });
    } finally {
      submitting.current = false;
    }
  };

  const startCheckout = async () => {
    if (!plan || !agreed || busy || submitting.current) return;
    submitting.current = true;
    setFlow({ phase: 'creating' });
    try {
      const created = await createSubscription(plan.key);
      if (!mounted.current) return;
      // What the server actually set up must match what was just disclosed. If anything differs, show the corrected terms and
      // ask again instead of opening Checkout on terms the person has not seen.
      const moved =
        created.trialEligible !== disclosedTrial ||
        created.amountPaise !== plan.amountPaise ||
        (created.trialEligible && !sameLocalDay(created.firstChargeAt, disclosedDate));
      if (moved) {
        setCorrectedDate(created.firstChargeAt);
        setAgreed(false);
        setFlow({ phase: 'idle' });
        await loadStatus();
        return;
      }
      setFlow({ phase: 'checkout' });
      const outcome = await openSubscriptionCheckout({
        keyId: created.keyId,
        subscriptionId: created.subscriptionId,
        description: `${planName(created.planKey)} plan, ${formatInr(created.amountPaise)} per ${created.billingPeriod === 'yearly' ? 'year' : 'month'}`,
        email: user?.email ?? null,
        brandName: BRAND.proseName
      });
      if (!mounted.current) return;
      if (outcome.kind === 'dismissed') {
        setFlow({ phase: 'dismissed' });
        await loadStatus();
        return;
      }
      // The callback is only a hint. The server checks the signature and asks Razorpay before anything is granted.
      await verifyWithRetry(outcome.response);
    } catch (e) {
      if (!mounted.current) return;
      const msg =
        e instanceof BillingApiError
          ? e.message
          : 'Secure checkout could not be opened. Check your connection and try again. You have not been charged.';
      setFlow({ phase: 'error', message: msg });
    } finally {
      submitting.current = false;
    }
  };

  const confirmCancel = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const r = await cancelSubscription();
      if (!mounted.current) return;
      setCancelOpen(false);
      setFlow({ phase: 'cancelled', accessEndsAt: r.accessEndsAt });
      await reloadAll();
    } catch (e) {
      if (mounted.current) setCancelError(e instanceof BillingApiError ? e.message : 'Could not cancel your subscription. Please try again.');
    } finally {
      if (mounted.current) setCancelBusy(false);
    }
  };

  const verificationDebit = status.trial.verificationDebit.amountPaise;

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="space-y-3">
        {flow.phase === 'verifying' && <LoadingState label="Confirming your authorisation with Razorpay…" className="py-3" />}
        {flow.phase === 'success' && (
          <Card tone="accent" role="status">
            <p className="text-sm font-semibold text-white">Authorisation confirmed</p>
            <p className="text-xs text-zinc-400 mt-1">
              {flow.trial ? `Your trial is active until ${formatDate(flow.trialEndAt)}.` : 'Your subscription is active.'}
            </p>
          </Card>
        )}
        {flow.phase === 'cancelled' && (
          <Card tone="raised" role="status">
            <p className="text-sm font-semibold text-white">Subscription cancelled</p>
            <p className="text-xs text-zinc-400 mt-1">
              {flow.accessEndsAt ? `You keep access until ${formatDate(flow.accessEndsAt)}. You will not be billed again.` : 'You will not be billed again.'}
            </p>
          </Card>
        )}
        {flow.phase === 'recovered' && (
          <Card tone="accent" role="status">
            <p className="text-sm font-semibold text-white">Payment method updated</p>
            <p className="text-xs text-zinc-400 mt-1">Razorpay has confirmed your subscription is active again.</p>
          </Card>
        )}
        {flow.phase === 'recovery_dismissed' && (
          <Card tone="raised" role="status">
            <p className="text-sm font-semibold text-white">Checkout closed</p>
            <p className="text-xs text-zinc-400 mt-1">Nothing was changed. You can update your payment method whenever you are ready.</p>
          </Card>
        )}
        {flow.phase === 'dismissed' && (
          <Card tone="raised" role="status">
            <p className="text-sm font-semibold text-white">Checkout closed</p>
            <p className="text-xs text-zinc-400 mt-1">Nothing was activated. You can start again whenever you are ready.</p>
          </Card>
        )}
        {flow.phase === 'unconfirmed' && (
          <Card tone="raised" role="status" className="space-y-2">
            <p className="text-sm font-semibold text-white">Still confirming with Razorpay</p>
            <p className="text-xs text-zinc-400">This can take a minute. Your status updates once Razorpay confirms it. Do not pay again.</p>
            <Button size="sm" variant="secondary" onClick={() => void reloadAll()}>
              Check again
            </Button>
          </Card>
        )}
        {flow.phase === 'error' && (
          <Card tone="raised" className="border-danger/30" role="alert">
            <p className="text-sm font-semibold text-white">Something went wrong</p>
            <p className="text-xs text-zinc-400 mt-1">{flow.message}</p>
          </Card>
        )}
      </div>

      {!status.emailVerified && canSubscribe && (
        <Card tone="raised" className="border-warning/30" role="alert">
          <p className="text-sm font-semibold text-white">Verify your email first</p>
          <p className="text-xs text-zinc-400 mt-1">Please verify your email address before starting a subscription. Check your inbox for the confirmation link.</p>
        </Card>
      )}

      <StatusSummary status={status} state={state} nowMs={now()} />

      {onboarding && canSubscribe && status.emailVerified && status.trial.days > 0 && !status.trial.eligible && <TrialUsedNotice trialDays={status.trial.days} />}

      {state === 'payment_failed' && <PaymentFailedNotice onRecover={() => void recoverPayment()} recoverBusy={busy} onCancel={() => setCancelOpen(true)} />}

      {state === 'payment_pending' && <PaymentPendingNotice recoverable={sub?.status === 'pending'} recoverBusy={busy} onRecover={() => void recoverPayment()} />}

      {state === 'unfinished' && (
        <Card tone="raised" role="status">
          <p className="text-sm font-semibold text-white">You haven't finished authorising payment</p>
          <p className="text-xs text-zinc-400 mt-1">Nothing is active yet. Choose a plan below to continue.</p>
        </Card>
      )}

      {canSubscribe && plan && (
        <SettingsCard
          title={state === 'trial_expired' || state === 'cancelled' ? 'Subscribe again' : 'Choose a plan'}
          description={status.trial.eligible ? `Includes a ${status.trial.days}-day trial. Review the billing details before you continue.` : 'Review the billing details before you continue.'}
        >
          <PlanPicker plans={status.plans} value={planKey} onChange={(k) => { setPlanKey(k); setAgreed(false); setCorrectedDate(null); }} disabled={busy} />
          <Disclosure
            plan={plan}
            trialEligible={status.trial.eligible}
            trialDays={status.trial.days}
            verificationDebitPaise={verificationDebit}
            firstChargeAt={disclosedDate}
            agreed={agreed}
            onAgree={setAgreed}
            correctedDate={correctedDate !== null}
          />
          {onboarding && <SelectedPlanSummary plan={plan} trialEligible={status.trial.eligible} trialDays={status.trial.days} />}
          <Button
            fullWidth
            onClick={() => void startCheckout()}
            disabled={!agreed || !status.emailVerified || busy}
            loading={flow.phase === 'creating' || flow.phase === 'checkout'}
          >
            {status.trial.eligible ? `Start ${status.trial.days}-day trial` : `Subscribe, ${formatInr(plan.amountPaise)} per ${intervalWord(plan)}`}
          </Button>
          <p className="text-label text-zinc-500">Payments are handled by Razorpay. Your card details never reach IronLog.</p>
        </SettingsCard>
      )}

      {canCancel && !onboarding && (
        <SettingsCard title="Manage subscription">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">
              {state === 'trialing' ? 'Cancel before your trial ends to avoid the first charge.' : 'Stop future billing. You keep the access you have already paid for.'}
            </p>
            <Button variant="danger" onClick={() => { setCancelError(null); setCancelOpen(true); }}>
              Cancel subscription
            </Button>
          </div>
        </SettingsCard>
      )}

      {!onboarding && <PaymentHistory payments={payments} error={paymentsError} onRetry={() => void loadPayments()} />}

      <CancelDialog open={cancelOpen} state={state} status={status} busy={cancelBusy} error={cancelError} onClose={() => setCancelOpen(false)} onConfirm={() => void confirmCancel()} />
    </div>
  );
};
