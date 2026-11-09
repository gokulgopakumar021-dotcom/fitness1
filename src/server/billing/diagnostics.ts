// Server-side failure classification for billing. Nothing here is ever sent to a client: the client always receives the same safe,
// static 503 body. These values exist so the matching log line (which carries the request id) says WHICH condition produced it.
// Every field is a static label, a number, a setting NAME, a SQLSTATE or a short upstream code; never a value, secret or free text.
import { ApiError } from '../security/errors';
import { RazorpayError } from './gateway';
import { BillingStoreError } from './store';

export type BillingUnavailableReason = 'config' | 'razorpay_auth' | 'database';
export type FailureDetail = Record<string, string | number | string[] | undefined>;

/** The 503 `billing_unavailable` response. Identical on the wire to the plain ApiError it replaces; `reason` and `detail` stay server-side. */
export class BillingUnavailableError extends ApiError {
  constructor(
    public readonly reason: BillingUnavailableReason,
    public readonly detail: FailureDetail = {}
  ) {
    super(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.', { 'Retry-After': '10' });
    this.name = 'BillingUnavailableError';
  }
}

/** Distinguishes configuration, Razorpay and database failures for logging. Returns only safe, static fields. */
export function describeBillingFailure(err: unknown): FailureDetail {
  if (err instanceof BillingUnavailableError) return { reason: err.reason, ...err.detail };
  if (err instanceof RazorpayError) return { reason: `razorpay_${err.kind}`, httpStatus: err.httpStatus, upstreamCode: err.upstreamCode };
  if (err instanceof BillingStoreError) return { reason: 'database', op: err.op, sqlstate: err.sqlstate };
  return { reason: 'unexpected', errName: err instanceof Error ? err.name : typeof err };
}
