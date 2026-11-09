import Razorpay from 'razorpay';
import type { BillingConfig } from './config';

/** Only the fields this integration reads. Names are the ones Razorpay documents for the Subscription and Payment entities. */
export interface RzpSubscription {
  id: string;
  plan_id?: string;
  status: string;
  customer_id?: string | null;
  start_at?: number | null;
  end_at?: number | null;
  ended_at?: number | null;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  expire_by?: number | null;
  paid_count?: number;
  total_count?: number;
  remaining_count?: number | string;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: number | string | null;
  notes?: Record<string, unknown> | unknown[];
}
export interface RzpPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  method?: string | null;
  invoice_id?: string | null;
  refund_status?: string | null;
  amount_refunded?: number;
  error_code?: string | null;
  captured?: boolean;
  created_at?: number;
}
export interface RzpPlan {
  id: string;
  period: string;
  interval: number;
  item: { amount: number; currency: string };
}
export interface CreateSubscriptionParams {
  plan_id: string;
  total_count: number;
  /** Unix seconds, in the future. Omitted for an immediate start. */
  start_at?: number;
  /** Unix seconds: last moment the customer may authorize. */
  expire_by: number;
  customer_notify: 0 | 1;
  notes: Record<string, string>;
}

export interface RazorpayGateway {
  fetchPlan(planId: string): Promise<RzpPlan>;
  createSubscription(params: CreateSubscriptionParams): Promise<RzpSubscription>;
  fetchSubscription(id: string): Promise<RzpSubscription>;
  cancelSubscription(id: string, cancelAtCycleEnd: boolean): Promise<RzpSubscription>;
  fetchPayment(id: string): Promise<RzpPayment>;
}

export type GatewayFailure = 'auth' | 'rejected' | 'rate_limited' | 'timeout' | 'upstream' | 'invalid_response' | 'network';

/** Failure from Razorpay. `message` is static; the upstream description is kept in `upstreamCode` only (a short code, never free text). */
export class RazorpayError extends Error {
  constructor(
    public readonly kind: GatewayFailure,
    public readonly httpStatus: number | undefined,
    public readonly upstreamCode?: string,
    public readonly retryable = false
  ) {
    super(`Razorpay request failed (${kind}).`);
    this.name = 'RazorpayError';
  }
}

const SAFE_CODE = /^[A-Z_]{3,64}$/;

/** The SDK rejects with `{ statusCode, error: { code, description, ... } }` (axios error shape is hidden). Never forward `description`. */
export function toRazorpayError(err: unknown): RazorpayError {
  if (err instanceof RazorpayError) return err;
  const e = err as { statusCode?: unknown; error?: { code?: unknown }; code?: unknown; name?: unknown } | null;
  const status = typeof e?.statusCode === 'number' ? e.statusCode : undefined;
  const rawCode = typeof e?.error?.code === 'string' ? e.error.code : undefined;
  const upstreamCode = rawCode && SAFE_CODE.test(rawCode) ? rawCode : undefined;
  if (status === 401 || status === 403) return new RazorpayError('auth', status, upstreamCode);
  if (status === 429) return new RazorpayError('rate_limited', status, upstreamCode, true);
  if (status !== undefined && status >= 500) return new RazorpayError('upstream', status, upstreamCode, true);
  if (status !== undefined && status >= 400) return new RazorpayError('rejected', status, upstreamCode);
  if (status === undefined) return new RazorpayError('network', undefined, undefined, true);
  return new RazorpayError('upstream', status, upstreamCode, true);
}

/** The SDK sets no request timeout, so every call is raced against one. A timed-out call is abandoned, not cancelled. */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RazorpayError('timeout', undefined, undefined, true)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function expectEntity<T extends { id: string }>(v: unknown, prefix: string): T {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id.startsWith(prefix)) throw new RazorpayError('invalid_response', undefined);
  return v as unknown as T;
}

/** Real gateway over the official `razorpay` SDK. The key secret is read once here and never leaves this closure. */
export function createRazorpayGateway(config: Pick<BillingConfig, 'keyId' | 'keySecret' | 'requestTimeoutMs'>): RazorpayGateway {
  if (!config.keyId || !config.keySecret) throw new Error('Razorpay credentials are not configured.');
  const sdk = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret }) as unknown as {
    plans: { fetch(id: string): Promise<unknown> };
    subscriptions: {
      create(p: Record<string, unknown>): Promise<unknown>;
      fetch(id: string): Promise<unknown>;
      cancel(id: string, cancelAtCycleEnd?: boolean): Promise<unknown>;
    };
    payments: { fetch(id: string): Promise<unknown> };
  };
  const call = async <T>(work: () => Promise<unknown>, check: (v: unknown) => T): Promise<T> => {
    try {
      return check(await withTimeout(work(), config.requestTimeoutMs));
    } catch (err) {
      throw toRazorpayError(err);
    }
  };
  return {
    fetchPlan: (id) => call(() => sdk.plans.fetch(id), (v) => expectEntity<RzpPlan>(v, 'plan_')),
    createSubscription: (p) => call(() => sdk.subscriptions.create({ ...p }), (v) => expectEntity<RzpSubscription>(v, 'sub_')),
    fetchSubscription: (id) => call(() => sdk.subscriptions.fetch(id), (v) => expectEntity<RzpSubscription>(v, 'sub_')),
    // The SDK maps its second argument to `cancel_at_cycle_end` (1 = at the end of the billing cycle, 0 = now).
    cancelSubscription: (id, cycleEnd) => call(() => sdk.subscriptions.cancel(id, cycleEnd), (v) => expectEntity<RzpSubscription>(v, 'sub_')),
    fetchPayment: (id) => call(() => sdk.payments.fetch(id), (v) => expectEntity<RzpPayment>(v, 'pay_'))
  };
}
