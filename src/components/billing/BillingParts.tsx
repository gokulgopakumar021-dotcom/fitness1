import React from 'react';
import { CalendarClock, CreditCard, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Modal, cn } from '../ui';
import { SettingRow, SettingRows, SettingsCard } from '../settings/SettingsParts';
import type { BillingPayment, BillingPlan, BillingStatus, PlanKey } from '../../lib/billingApi';
import {
  PAYMENT_STATUS_LABEL, STATE_LABEL, accessEndDate, buildDisclosure, daysRemaining, formatDate, formatInr, intervalWord,
  paymentLabel, planName, type PanelState
} from '../../utils/billingPresentation';
import { LegalLinks } from '../legal/LegalLinks';

/** ------------------------------------------------------------------------------------------------ status summary */
export const StatusSummary: React.FC<{ status: BillingStatus; state: PanelState; nowMs: number }> = ({ status, state, nowMs }) => {
  const sub = status.subscription;
  const meta = STATE_LABEL[state];
  const end = accessEndDate(status);
  const days = daysRemaining(state === 'trialing' ? (sub?.trialEndAt ?? end) : end, nowMs);
  const showPlan = sub && state !== 'none' && state !== 'unfinished';
  return (
    <SettingsCard
      title="Subscription"
      description="Your plan, trial and payment status."
      action={<Badge tone={meta.tone}>{meta.label}</Badge>}
    >
      <SettingRows>
        {state === 'trialing' && (
          <>
            <SettingRow label="Trial" description="Counted from when your authorisation was confirmed.">
              <span className="text-sm text-white" data-testid="trial-days">
                {days === 0 ? 'Ends today' : `${days} ${days === 1 ? 'day' : 'days'} left`}
              </span>
            </SettingRow>
            {sub?.trialStartAt && (
              <SettingRow label="Trial started">
                <span className="text-sm text-white">{formatDate(sub.trialStartAt)}</span>
              </SettingRow>
            )}
            <SettingRow label="Trial ends" description="Your first charge is taken on this date unless you cancel first.">
              <span className="text-sm text-white">{formatDate(sub?.trialEndAt ?? end)}</span>
            </SettingRow>
          </>
        )}
        {showPlan && (
          <SettingRow label="Plan">
            <span className="text-sm text-white">
              {planName(sub.planKey)}, {formatInr(sub.amountPaise)} per {sub.billingPeriod === 'yearly' ? 'year' : 'month'}
            </span>
          </SettingRow>
        )}
        {(state === 'trialing' || state === 'active') && !sub?.cancelAtCycleEnd && (
          <SettingRow label="Next billing date" description={state === 'trialing' ? 'First charge' : undefined}>
            <span className="text-sm text-white">{formatDate(sub?.nextBillingAt ?? (state === 'trialing' ? sub?.trialEndAt : null))}</span>
          </SettingRow>
        )}
        {(state === 'cancelled_active' || (state === 'active' && sub?.cancelAtCycleEnd)) && (
          <SettingRow label="Access until" description="Your subscription will not renew.">
            <span className="text-sm text-white">{formatDate(end)}</span>
          </SettingRow>
        )}
        {sub && showPlan && (
          <SettingRow label="Payment status">
            <span className="text-sm text-white">{PAYMENT_STATUS_LABEL[sub.paymentStatus]}</span>
          </SettingRow>
        )}
        {(state === 'none' || state === 'unfinished') && (
          <SettingRow label="Current plan">
            <span className="text-sm text-zinc-300">None</span>
          </SettingRow>
        )}
      </SettingRows>
    </SettingsCard>
  );
};

/** ------------------------------------------------------------------------------------------------ payment failed */
const RECOVERY_NOTE =
  "Updating here changes the card on your subscription through Razorpay's secure checkout. If you pay with UPI or a bank mandate, use the link Razorpay emailed you about the failed payment, or cancel and subscribe again.";

export const PaymentFailedNotice: React.FC<{ onRecover: () => void; recoverBusy: boolean; onCancel: () => void }> = ({ onRecover, recoverBusy, onCancel }) => (
  <Card tone="raised" className="border-danger/30 space-y-3" role="alert" aria-label="Payment failed">
    <div className="flex items-start gap-3">
      <CreditCard className="w-5 h-5 text-danger shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">Your last payment did not go through</p>
        <p className="text-xs text-zinc-400 mt-1">
          Paid features are paused until a payment succeeds. Your workouts and other local data are untouched.
        </p>
      </div>
    </div>
    <div className="flex flex-col sm:flex-row gap-2">
      <Button variant="secondary" onClick={onRecover} loading={recoverBusy} disabled={recoverBusy} aria-describedby="recovery-note">
        Update payment method
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={recoverBusy}>
        Cancel subscription
      </Button>
    </div>
    <p id="recovery-note" className="text-label text-zinc-500">
      {RECOVERY_NOTE}
    </p>
  </Card>
);

/** A renewal failed and Razorpay is still retrying (state `pending`): a card can be updated now so the next attempt can succeed. */
export const PaymentPendingNotice: React.FC<{ recoverable: boolean; recoverBusy: boolean; onRecover: () => void }> = ({ recoverable, recoverBusy, onRecover }) => (
  <Card tone="raised" className="border-warning/30 space-y-3" role="status">
    <div>
      <p className="text-sm font-semibold text-white">Waiting for your payment</p>
      <p className="text-xs text-zinc-400 mt-1">Razorpay is retrying your latest payment. Paid features resume as soon as it succeeds.</p>
    </div>
    {recoverable && (
      <>
        <Button variant="secondary" onClick={onRecover} loading={recoverBusy} disabled={recoverBusy} aria-describedby="pending-recovery-note">
          Update payment method
        </Button>
        <p id="pending-recovery-note" className="text-label text-zinc-500">
          {RECOVERY_NOTE}
        </p>
      </>
    )}
  </Card>
);

/** ------------------------------------------------------------------------------------------------ plan picker + disclosure */
export const PlanPicker: React.FC<{ plans: BillingPlan[]; value: PlanKey; onChange: (k: PlanKey) => void; disabled?: boolean }> = ({ plans, value, onChange, disabled }) => {
  const monthly = plans.find((p) => p.key === 'monthly');
  const annual = plans.find((p) => p.key === 'annual');
  const saving = monthly && annual && annual.amountPaise < monthly.amountPaise * 12 ? monthly.amountPaise * 12 - annual.amountPaise : 0;
  return (
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 min-w-0">
      <legend className="sr-only">Choose a plan</legend>
      {plans.map((p) => {
        const selected = p.key === value;
        return (
          <label
            key={p.key}
            className={cn(
              'flex items-start gap-3 rounded-card border p-4 cursor-pointer transition-colors min-h-[44px] focus-within:ring-2 focus-within:ring-accent',
              selected ? 'border-accent/60 bg-surface-2' : 'border-line bg-surface hover:border-line-strong'
            )}
          >
            <input type="radio" name="billing-plan" value={p.key} checked={selected} onChange={() => onChange(p.key)} className="mt-1 accent-[var(--chart-1)]" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">{planName(p.key)}</span>
              <span className="block text-sm text-zinc-300">
                {formatInr(p.amountPaise)} per {intervalWord(p)}
              </span>
              {p.key === 'annual' && saving > 0 && <span className="block text-label text-volt-adaptive mt-1">Saves {formatInr(saving)} a year compared with monthly</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
};

export const Disclosure: React.FC<{
  plan: BillingPlan;
  trialEligible: boolean;
  trialDays: number;
  verificationDebitPaise: number;
  firstChargeAt: string | null;
  agreed: boolean;
  onAgree: (v: boolean) => void;
  correctedDate?: boolean;
}> = ({ plan, trialEligible, trialDays, verificationDebitPaise, firstChargeAt, agreed, onAgree, correctedDate }) => {
  const lines = buildDisclosure({ plan, trialEligible, trialDays, verificationDebitPaise, firstChargeAt });
  return (
    <Card tone="raised" className="space-y-3" aria-label="Billing details">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-volt-adaptive" aria-hidden />
        <h4 className="text-sm font-semibold text-white">Before you continue</h4>
      </div>
      {correctedDate && (
        <p role="status" className="text-xs text-warning">
          The first charge date was updated. Please review it and confirm again.
        </p>
      )}
      <ul className="space-y-2 text-sm text-zinc-300 list-disc pl-5" data-testid="disclosure">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="text-xs text-zinc-400 space-y-1" data-testid="disclosure-legal-links">
        <p>Before you continue, please read:</p>
        <LegalLinks keys={['terms', 'refund-policy', 'cancellation-policy']} aria-label="Terms and billing policies" />
      </div>
      <label className="flex items-start gap-3 text-sm text-zinc-200 cursor-pointer min-h-[44px]">
        <input type="checkbox" checked={agreed} onChange={(e) => onAgree(e.target.checked)} className="mt-1 accent-[var(--chart-1)]" />
        <span>I have read the above and I agree to these recurring billing terms.</span>
      </label>
    </Card>
  );
};

/** ------------------------------------------------------------------------------------------------ cancel dialog */
export const CancelDialog: React.FC<{
  open: boolean;
  state: PanelState;
  status: BillingStatus;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ open, state, status, busy, error, onClose, onConfirm }) => {
  const sub = status.subscription;
  const body = (() => {
    if (state === 'trialing') {
      const d = formatDate(sub?.trialEndAt ?? accessEndDate(status));
      return `Future billing stops now, so the first charge of ${formatInr(sub?.amountPaise ?? 0)} will not be taken. You keep access until your trial ends on ${d}.`;
    }
    if (state === 'active') {
      const d = formatDate(sub?.currentPeriodEnd ?? accessEndDate(status));
      return `Your subscription will not renew. You keep full access until the end of the period you already paid for, ${d}.`;
    }
    return 'Billing stops now and no further payment attempts will be made.';
  })();
  return (
    <Modal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Cancel subscription?"
      description="Please confirm. This can't be undone from here."
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep subscription
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            Cancel subscription
          </Button>
        </div>
      }
    >
      <p className="text-sm text-zinc-300">{body}</p>
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
};

/** ------------------------------------------------------------------------------------------------ history */
export const PaymentHistory: React.FC<{ payments: BillingPayment[] | null; error: string | null; onRetry: () => void }> = ({ payments, error, onRetry }) => (
  <SettingsCard title="Billing history" description="Charges and card verification debits on your subscription.">
    {error ? (
      <div role="alert" className="text-sm text-danger flex flex-col sm:flex-row sm:items-center gap-2">
        <span>{error}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    ) : payments === null ? (
      <p role="status" className="text-sm text-zinc-400">
        Loading history…
      </p>
    ) : payments.length === 0 ? (
      <EmptyState icon={<CalendarClock className="w-5 h-5" />} title="No payments yet" description="Payments will appear here after you subscribe." />
    ) : (
      <ul className="divide-y divide-line" aria-label="Payments">
        {payments.map((p) => {
          const l = paymentLabel(p);
          return (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white">{l.title}</p>
                <p className="text-label text-zinc-500">
                  {formatDate(p.paidAt ?? p.createdAt)} · {l.detail}
                </p>
              </div>
              <span className="text-sm font-mono text-white shrink-0">{formatInr(p.amountPaise)}</span>
            </li>
          );
        })}
      </ul>
    )}
  </SettingsCard>
);

/** ------------------------------------------------------------------------------------------------ onboarding extras */
/** The plan that Checkout will be opened for, restated next to the button. Display only: the server sets the real amount. */
export const SelectedPlanSummary: React.FC<{ plan: BillingPlan; trialEligible: boolean; trialDays: number }> = ({ plan, trialEligible, trialDays }) => (
  <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5" data-testid="selected-plan">
    <div className="min-w-0">
      <p className="text-label text-zinc-500">Selected plan</p>
      <p className="text-sm font-semibold text-white">
        {planName(plan.key)}, {formatInr(plan.amountPaise)} per {intervalWord(plan)}
      </p>
    </div>
    <span className="text-label text-zinc-400 text-right shrink-0">{trialEligible ? `${trialDays}-day trial first` : 'Charged on authorising'}</span>
  </div>
);

/** Shown when the server says this account (or its email) has already had its one trial. */
export const TrialUsedNotice: React.FC<{ trialDays: number }> = ({ trialDays }) => (
  <Card tone="raised" className="border-warning/30" role="status" aria-label="Trial already used">
    <p className="text-sm font-semibold text-white">Your {trialDays}-day trial has already been used</p>
    <p className="text-xs text-zinc-400 mt-1">
      Each account gets one trial, so a new one is not available. You can still subscribe below: you are charged the full plan price when you authorise, and
      it is not refunded automatically. Or skip this step and keep using the basic app.
    </p>
  </Card>
);

/** What happens at the end of a running trial and how recurring billing works. Wording comes from the server's own subscription data. */
export const TrialEndExplainer: React.FC<{ status: BillingStatus }> = ({ status }) => {
  const sub = status.subscription;
  if (!sub) return null;
  const per = sub.billingPeriod === 'yearly' ? 'year' : 'month';
  const price = formatInr(sub.amountPaise);
  const ends = formatDate(sub.trialEndAt ?? accessEndDate(status));
  return (
    <Card tone="raised" className="space-y-3" aria-label="What happens next" data-testid="trial-end-explainer">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-volt-adaptive" aria-hidden />
        <h4 className="text-sm font-semibold text-white">What happens next</h4>
      </div>
      <ul className="space-y-2 text-sm text-zinc-300 list-disc pl-5">
        <li>Your trial runs until {ends}. Everything you have access to now stays available until then.</li>
        <li>
          On {ends} your first payment of {price} is taken from the payment method you authorised, then it renews every {per} at {price} until you cancel.
        </li>
        <li>To avoid the first payment, cancel in Settings, then Billing, before {ends}. Future billing stops at once and you keep access until the trial ends.</li>
      </ul>
    </Card>
  );
};
