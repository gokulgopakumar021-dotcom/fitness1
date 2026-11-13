import { apiFetch } from './apiFetch';

/**
 * Browser client for /api/billing/*. Everything here is DISPLAY data returned by the server. The browser never decides access,
 * never sends an amount, plan id or user id (only a plan KEY), and never treats the Checkout callback as proof of payment:
 * `verifySubscription` just hands the callback to the server, which checks the signature and asks Razorpay.
 */
export type PlanKey = 'monthly' | 'annual';

export interface BillingPlan {
  key: PlanKey;
  amountPaise: number;
  currency: 'INR';
  billingPeriod: 'monthly' | 'yearly';
  interval: number;
}

export interface PublicSubscription {
  id: string;
  planKey: PlanKey;
  status: 'creating' | 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired';
  paymentStatus: 'none' | 'authorized' | 'paid' | 'retrying' | 'failed' | 'refunded';
  amountPaise: number;
  currency: string;
  billingPeriod: string;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  paidCount: number;
  cancelRequestedAt: string | null;
  cancelAtCycleEnd: boolean;
  cancelledAt: string | null;
  accessEndsAt: string | null;
  createdAt: string;
}

export type EntitlementState =
  | 'none' | 'trialing' | 'active' | 'cancelled_active' | 'payment_pending' | 'payment_failed' | 'trial_expired' | 'cancelled' | (string & {});

export interface BillingStatus {
  enforcement: 'off' | 'shadow' | 'on';
  emailVerified: boolean;
  trial: {
    eligible: boolean;
    days: number;
    firstChargePreviewAt: string | null;
    /** `refundedAutomatically` is a legacy field. It is NOT a verified claim and must not be displayed (Stage 4). */
    verificationDebit: { amountPaise: number; refundedAutomatically: boolean };
  };
  plans: BillingPlan[];
  entitlement: { state: EntitlementState; hasAccess: boolean; accessEndsAt: string | null };
  subscription: PublicSubscription | null;
}

export interface BillingPayment {
  id: string;
  kind: 'authorization' | 'charge';
  status: 'authorized' | 'captured' | 'failed' | 'refunded';
  amountPaise: number;
  amountRefundedPaise: number;
  currency: string;
  method: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  keyId: string;
  planKey: PlanKey;
  amountPaise: number;
  currency: 'INR';
  billingPeriod: string;
  trialEligible: boolean;
  trialDays: number;
  firstChargeAt: string | null;
  authorizationExpiresAt: string | null;
  authorization: { amountPaise: number; refundable: boolean };
  reused: boolean;
}

export interface CheckoutCallback {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export interface VerifyResult {
  verified: boolean;
  alreadyVerified: boolean;
  /** Present (true) only when the callback was a payment-method recovery and Razorpay now reports the subscription active again. */
  recovered?: boolean;
  subscription: PublicSubscription;
}

/** Everything Checkout needs to let a customer update the card on a `pending` or `halted` subscription (Razorpay `subscription_card_change`). */
export interface RecoveryCheckout {
  subscriptionId: string;
  keyId: string;
  planKey: PlanKey;
  amountPaise: number;
  currency: 'INR';
  billingPeriod: string;
  status: 'pending' | 'halted';
  /** Checkout changes a CARD only. UPI and bank-mandate customers use the link Razorpay emails them. */
  cardChangeOnly: boolean;
}

export type DeletionRequires = 'none' | 'cancel_billing' | 'confirm_cancel_paid';
export interface DeletionCheck {
  requires: DeletionRequires;
  subscription: PublicSubscription | null;
  /** End of the period that is already paid, when `requires` is confirm_cancel_paid. */
  accessEndsAt: string | null;
}
export interface PrepareDeletionResult extends DeletionCheck {
  /** True only when Razorpay has confirmed that every subscription has stopped. */
  ready: boolean;
  cancelled: number;
}

export interface CancelResult {
  cancelled: boolean;
  alreadyRequested: boolean;
  subscription: PublicSubscription;
  accessEndsAt: string | null;
}

/** Carries the server's safe, static message and machine code. Never contains secrets or provider payloads. */
export class BillingApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'BillingApiError';
  }
}

const GENERIC = 'Something went wrong with billing. Please try again.';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new BillingApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !body || body.success !== true) {
    throw new BillingApiError(res.status, typeof body?.code === 'string' ? body.code : 'unknown', typeof body?.error === 'string' ? body.error : GENERIC);
  }
  return body as T;
}

const post = <T>(path: string, payload: unknown = {}) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

export const fetchBillingStatus = () => call<BillingStatus & { success: true }>('/api/billing/status');
export const fetchBillingPayments = async (): Promise<BillingPayment[]> => (await call<{ payments: BillingPayment[] }>('/api/billing/payments')).payments;
/** Body is the plan KEY only. The server owns amounts, plan ids and identity. */
export const createSubscription = (planKey: PlanKey) => post<CreateSubscriptionResult & { success: true }>('/api/billing/subscriptions', { planKey });
export const verifySubscription = (cb: CheckoutCallback) =>
  post<VerifyResult & { success: true }>('/api/billing/subscriptions/verify', {
    razorpay_payment_id: cb.razorpay_payment_id,
    razorpay_subscription_id: cb.razorpay_subscription_id,
    razorpay_signature: cb.razorpay_signature
  });
export const cancelSubscription = () => post<CancelResult & { success: true }>('/api/billing/subscriptions/cancel');

/** Re-reads Razorpay on the server; only returns Checkout parameters when the subscription really is pending or halted. */
export const startRecovery = () => post<RecoveryCheckout & { success: true }>('/api/billing/subscriptions/recover');
export const fetchDeletionCheck = () => call<DeletionCheck & { success: true }>('/api/billing/account/deletion-check');
/** `confirmCancelPaidNow` must be true for a paid subscription: it cancels immediately and the current period is not refunded. */
export const prepareDeletion = (confirmCancelPaidNow: boolean) =>
  post<PrepareDeletionResult & { success: true }>('/api/billing/account/prepare-deletion', { confirmCancelPaidNow });
