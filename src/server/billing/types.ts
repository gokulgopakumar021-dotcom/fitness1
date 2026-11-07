import type { PlanKey } from './config';

export type SubStatus = 'creating' | 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired';
export type PaymentStatus = 'none' | 'authorized' | 'paid' | 'retrying' | 'failed' | 'refunded';
export const TERMINAL: readonly SubStatus[] = ['cancelled', 'completed', 'expired'];
export const RAZORPAY_STATUSES: readonly string[] = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'];
export const LIVE: readonly SubStatus[] = ['creating', 'created', 'authenticated', 'active', 'pending', 'halted'];

/** Full server-side row (service role). Never returned to the browser as is: see `toPublicSubscription`. */
export interface SubscriptionRow {
  id: string;
  user_id: string | null;
  plan_key: PlanKey;
  razorpay_plan_id: string;
  razorpay_subscription_id: string | null;
  razorpay_customer_id: string | null;
  billing_period: string;
  billing_interval: number;
  amount_paise: number;
  currency: string;
  status: SubStatus;
  payment_status: PaymentStatus;
  trial_start_at: string | null;
  trial_end_at: string | null;
  expire_by: string | null;
  auth_verified_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  paid_count: number;
  total_count: number | null;
  cancel_requested_at: string | null;
  cancel_at_cycle_end: boolean;
  cancelled_at: string | null;
  ended_at: string | null;
  access_ends_at: string | null;
  billing_stop_verified_at: string | null;
  razorpay_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns a mirror update may change. Deliberately excludes id, user_id and every Razorpay id except customer. */
export type SubscriptionPatch = Partial<
  Pick<
    SubscriptionRow,
    | 'status' | 'payment_status' | 'razorpay_customer_id' | 'trial_start_at' | 'auth_verified_at' | 'current_period_start'
    | 'current_period_end' | 'next_billing_at' | 'paid_count' | 'total_count' | 'cancel_requested_at' | 'cancel_at_cycle_end'
    | 'cancelled_at' | 'ended_at' | 'access_ends_at' | 'razorpay_synced_at'
  >
>;

export interface PaymentRecord {
  userId: string;
  subscriptionId: string;
  razorpayPaymentId: string;
  razorpayInvoiceId: string | null;
  kind: 'authorization' | 'charge';
  status: 'authorized' | 'captured' | 'failed' | 'refunded';
  amountPaise: number;
  amountRefundedPaise: number;
  method: string | null;
  errorCode: string | null;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface PaymentRow {
  id: string;
  subscription_id: string;
  kind: 'authorization' | 'charge';
  status: 'authorized' | 'captured' | 'failed' | 'refunded';
  amount_paise: number;
  amount_refunded_paise?: number | null;
  currency: string;
  method: string | null;
  paid_at: string | null;
  refunded_at?: string | null;
  created_at: string;
}

export interface Entitlement {
  state: string;
  has_access: boolean;
  access_ends_at: string | null;
  subscription_id: string | null;
  plan_key: string | null;
}

export interface BeginSubscriptionResult {
  outcome: 'created' | 'existing';
  subscription_id: string;
  status: SubStatus;
  plan_key: PlanKey;
  trial_eligible: boolean;
  trial_end_at: string | null;
  expire_by: string | null;
}

export interface BeginSubscriptionArgs {
  userId: string;
  emailHash: string;
  planKey: PlanKey;
  razorpayPlanId: string;
  billingPeriod: string;
  amountPaise: number;
  trialDays: number;
  authWindowMinutes: number;
}

export interface WebhookEventArgs {
  eventId: string;
  eventType: string;
  razorpaySubscriptionId: string | null;
  razorpayPaymentId: string | null;
  payloadSha256: string;
  eventCreatedAt: string | null;
}
export type WebhookGate = 'process' | 'duplicate' | 'in_progress';
export type WebhookOutcome = 'processed' | 'ignored' | 'failed';
