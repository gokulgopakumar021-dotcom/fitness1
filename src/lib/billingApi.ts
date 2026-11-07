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
  subscription: PublicSubscription;
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
