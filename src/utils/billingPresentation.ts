import type { BillingPayment, BillingPlan, BillingStatus, PlanKey, PublicSubscription } from '../lib/billingApi';

/**
 * Display-only helpers for the billing screen. Every fact comes from GET /api/billing/status (server-authoritative); nothing
 * here decides access. Dates are shown in the person's locale from server timestamps, "days left" is a rounded-up reading of a
 * server timestamp for display, and no countdown timer ever gates anything.
 */
const DAY_MS = 86_400_000;

export const formatInr = (paise: number): string => {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Whole days left, rounded up, never negative. 0 means it ends today or has ended. */
export const daysRemaining = (endIso: string | null | undefined, nowMs: number): number => {
  if (!endIso) return 0;
  const end = Date.parse(endIso);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - nowMs) / DAY_MS));
};

export const sameLocalDay = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

export const planName = (key: PlanKey | string | null | undefined): string => (key === 'annual' ? 'Annual' : key === 'monthly' ? 'Monthly' : '—');
export const intervalWord = (p: Pick<BillingPlan, 'billingPeriod'>): string => (p.billingPeriod === 'yearly' ? 'year' : 'month');

export type PanelState =
  | 'none'
  | 'trialing'
  | 'active'
  | 'cancelled_active'
  | 'payment_pending'
  | 'payment_failed'
  | 'trial_expired'
  | 'cancelled'
  | 'unfinished';

const SERVER_STATES: readonly PanelState[] = ['trialing', 'active', 'cancelled_active', 'payment_pending', 'payment_failed', 'trial_expired', 'cancelled'];

/**
 * Which screen to show. The entitlement state comes from the server's database-clock decision. A subscription that exists
 * but was never authorised (`created`) has no entitlement, so it is reported as `unfinished` (checkout started, not completed).
 */
export function panelState(status: BillingStatus): PanelState {
  const s: string = status.entitlement.state;
  if ((SERVER_STATES as readonly string[]).includes(s)) return s as PanelState;
  const sub = status.subscription;
  if (sub && (sub.status === 'created' || sub.status === 'creating')) return 'unfinished';
  return 'none';
}

export const STATE_LABEL: Record<PanelState, { label: string; tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  none: { label: 'No subscription', tone: 'neutral' },
  unfinished: { label: 'Not authorised', tone: 'warning' },
  trialing: { label: 'Trial active', tone: 'accent' },
  active: { label: 'Active', tone: 'success' },
  cancelled_active: { label: 'Cancelled, access continues', tone: 'info' },
  payment_pending: { label: 'Payment pending', tone: 'warning' },
  payment_failed: { label: 'Payment failed', tone: 'danger' },
  trial_expired: { label: 'Trial ended', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }
};

export const PAYMENT_STATUS_LABEL: Record<PublicSubscription['paymentStatus'], string> = {
  none: 'No payment yet',
  authorized: 'Authorised, first charge scheduled',
  paid: 'Paid',
  retrying: 'Retrying',
  failed: 'Failed',
  refunded: 'Refunded'
};

/** The date after which this person has no access, from the server's entitlement (falls back to the subscription row). */
export const accessEndDate = (status: BillingStatus): string | null => status.entitlement.accessEndsAt ?? status.subscription?.accessEndsAt ?? null;

export function paymentLabel(p: BillingPayment): { title: string; detail: string } {
  if (p.kind === 'authorization') {
    const refunded = p.status === 'refunded' || (p.amountRefundedPaise > 0 && p.amountRefundedPaise >= p.amountPaise);
    return {
      title: 'Card verification debit',
      detail: refunded ? 'Refunded in full' : p.status === 'failed' ? 'Failed' : 'Not shown as refunded yet. It is not part of your plan price. See the Refund Policy if it is not returned.'
    };
  }
  return { title: 'Subscription charge', detail: p.status === 'captured' ? 'Paid' : p.status === 'refunded' ? 'Refunded' : p.status === 'failed' ? 'Failed' : 'Authorised' };
}

export interface DisclosureInput {
  plan: BillingPlan;
  trialEligible: boolean;
  trialDays: number;
  verificationDebitPaise: number;
  firstChargeAt: string | null;
}

/**
 * The text shown BEFORE Razorpay Checkout opens. Rules (from the approved design): state amount, interval, trial length, first
 * charge date, that Razorpay MAY make the small verification debit and where refunds are explained (it must NOT promise an automatic
 * refund: that is Razorpay's behaviour, it is not verified for this account, and this code issues no refund), automatic renewal
 * until cancelled, and how to cancel. It never calls the trial "free" and never says "no charge".
 */
export function buildDisclosure(i: DisclosureInput): string[] {
  const per = intervalWord(i.plan);
  const price = `${formatInr(i.plan.amountPaise)} per ${per}`;
  if (!i.trialEligible) {
    return [
      `Plan: ${planName(i.plan.key)}, ${price}.`,
      `Charged today: ${formatInr(i.plan.amountPaise)} when you authorise. This is the full plan price and is not refunded automatically.`,
      `It renews every ${per} at ${formatInr(i.plan.amountPaise)} until you cancel.`,
      'You can cancel any time in Settings, then Billing. Access then continues until the end of the period you already paid for.'
    ];
  }
  const when = formatDate(i.firstChargeAt);
  return [
    `Plan: ${planName(i.plan.key)}, ${price}.`,
    `${i.trialDays}-day trial: it starts once Razorpay confirms your payment authorisation, not before.`,
    `Today: Razorpay may make a ${formatInr(i.verificationDebitPaise)} card verification debit. It is not part of your plan price, and refund handling is described in the Refund Policy. For UPI or e-mandate, check the amount shown in Razorpay Checkout before you confirm.`,
    `First charge: ${formatInr(i.plan.amountPaise)} is scheduled for ${when}, when your trial is set to end. This date is set when you start checkout. After that it renews every ${per} at ${formatInr(i.plan.amountPaise)} until you cancel.`,
    `To avoid the first charge, cancel in Settings, then Billing, before ${when}. If you cancel during the trial, future billing stops at once and you keep access until the trial ends.`
  ];
}
