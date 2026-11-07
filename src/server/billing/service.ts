import { ApiError } from '../security/errors';
import { logger } from '../security/logger';
import type { AuthUser } from '../security/types';
import { VERIFICATION_DEBIT_PAISE, type BillingConfig, type PlanKey } from './config';
import { hashEmail } from './emailHash';
import { RazorpayError, type RazorpayGateway, type RzpPayment, type RzpSubscription } from './gateway';
import { sha256Hex, verifyPaymentSignature, verifyWebhookSignature } from './signature';
import { BillingStoreError, type BillingStore } from './store';
import { LIVE, RAZORPAY_STATUSES, TERMINAL, type PaymentRecord, type PaymentStatus, type SubscriptionPatch, type SubscriptionRow, type SubStatus } from './types';

/** Subscription events this integration documents and handles (Razorpay "Subscription webhook events"). Anything else is recorded as ignored. */
export const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'subscription.authenticated', 'subscription.activated', 'subscription.charged', 'subscription.completed', 'subscription.updated',
  'subscription.pending', 'subscription.halted', 'subscription.cancelled', 'subscription.paused', 'subscription.resumed'
]);

const SUB_ID = /^sub_[A-Za-z0-9]{6,40}$/;
const PAY_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const iso = (unix: number | null | undefined) => (typeof unix === 'number' && Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000).toISOString() : null);
const isTerminal = (s: SubStatus) => (TERMINAL as readonly string[]).includes(s);

export interface BillingServiceDeps {
  config: BillingConfig;
  store: BillingStore;
  gateway: RazorpayGateway;
  now?: () => number;
}

/** Fields safe to show the user. No Razorpay ids, no customer id, no internal flags. */
export function toPublicSubscription(r: SubscriptionRow) {
  return {
    id: r.id, planKey: r.plan_key, status: r.status, paymentStatus: r.payment_status, amountPaise: r.amount_paise, currency: r.currency,
    billingPeriod: r.billing_period, trialStartAt: r.trial_start_at, trialEndAt: r.trial_end_at, currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end, nextBillingAt: r.next_billing_at, paidCount: r.paid_count, cancelRequestedAt: r.cancel_requested_at,
    cancelAtCycleEnd: r.cancel_at_cycle_end, cancelledAt: r.cancelled_at, accessEndsAt: r.access_ends_at, createdAt: r.created_at
  };
}

function derivePaymentStatus(prev: SubscriptionRow, rzp: RzpSubscription): PaymentStatus {
  switch (rzp.status) {
    case 'created': return prev.payment_status === 'none' ? 'none' : prev.payment_status;
    case 'authenticated': return (rzp.paid_count ?? 0) > 0 ? 'paid' : 'authorized';
    case 'active': return (rzp.paid_count ?? 0) > 0 ? 'paid' : 'authorized';
    case 'pending': return 'retrying';
    case 'halted': return 'failed';
    case 'completed': return 'paid';
    default: return prev.payment_status; // cancelled / expired: keep what was last known
  }
}

/** Maps a Razorpay subscription onto our mirror columns. Pure: the caller decides when to write it. */
export function buildSyncPatch(row: SubscriptionRow, rzp: RzpSubscription, nowMs: number): SubscriptionPatch {
  const status = rzp.status as SubStatus;
  const patch: SubscriptionPatch = {
    status,
    payment_status: derivePaymentStatus(row, rzp),
    razorpay_customer_id: rzp.customer_id ?? row.razorpay_customer_id,
    current_period_start: iso(rzp.current_start) ?? row.current_period_start,
    current_period_end: iso(rzp.current_end) ?? row.current_period_end,
    next_billing_at: ['authenticated', 'active', 'pending'].includes(status) ? iso(rzp.charge_at) : null,
    paid_count: Math.max(row.paid_count, typeof rzp.paid_count === 'number' ? rzp.paid_count : 0),
    razorpay_synced_at: new Date(nowMs).toISOString()
  };
  if (rzp.ended_at) patch.ended_at = iso(rzp.ended_at);
  if (status === 'cancelled') {
    patch.cancelled_at = row.cancelled_at ?? new Date(nowMs).toISOString();
    patch.cancel_requested_at = row.cancel_requested_at ?? patch.cancelled_at;
    // A user who cancelled keeps what they were promised: the trial to its end, or the paid period to its end.
    if (!row.access_ends_at) {
      const periodEnd = patch.current_period_end ?? row.current_period_end;
      patch.access_ends_at = (patch.paid_count ?? 0) > 0 ? periodEnd : row.trial_end_at && row.auth_verified_at ? row.trial_end_at : null;
    }
  }
  return patch;
}

function paymentRecord(row: SubscriptionRow, p: RzpPayment, kind: 'authorization' | 'charge', nowMs: number): PaymentRecord | null {
  const refunded = p.refund_status === 'full' || p.status === 'refunded' || (typeof p.amount_refunded === 'number' && p.amount_refunded >= p.amount && p.amount > 0);
  let status: PaymentRecord['status'];
  if (refunded) status = 'refunded';
  else if (p.status === 'captured') status = 'captured';
  else if (p.status === 'authorized') status = 'authorized';
  else if (p.status === 'failed') status = 'failed';
  else return null; // 'created' and anything unknown: never recorded as a payment
  if (p.currency !== 'INR' || !Number.isInteger(p.amount) || p.amount < 0 || !row.user_id) return null;
  return {
    userId: row.user_id, subscriptionId: row.id, razorpayPaymentId: p.id, razorpayInvoiceId: p.invoice_id ?? null, kind, status, amountPaise: p.amount,
    amountRefundedPaise: refunded ? Math.max(p.amount_refunded ?? 0, p.amount) : (p.amount_refunded ?? 0), method: p.method ?? null,
    errorCode: p.status === 'failed' ? (p.error_code ?? 'failed') : null,
    paidAt: status === 'captured' || status === 'refunded' ? (iso(p.created_at) ?? new Date(nowMs).toISOString()) : null,
    refundedAt: refunded ? new Date(nowMs).toISOString() : null
  };
}

const unavailable = () => new ApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.', { 'Retry-After': '10' });

/** Converts gateway and database failures into safe ApiErrors; everything else passes through. */
export function toApiError(err: unknown, context: string): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof RazorpayError) {
    logger.error('billing_razorpay_error', { context, kind: err.kind, httpStatus: err.httpStatus, upstreamCode: err.upstreamCode });
    if (err.kind === 'auth') return unavailable(); // our credentials are wrong: not the user's problem and not for the user to see
    if (err.kind === 'timeout') return new ApiError(504, 'billing_timeout', 'The payment provider took too long to respond. Please try again.', { 'Retry-After': '5' });
    if (err.kind === 'rejected') return new ApiError(409, 'billing_rejected', 'The payment provider could not complete this request.');
    return new ApiError(502, 'billing_upstream_error', 'The payment provider is temporarily unavailable. Please try again shortly.', { 'Retry-After': '10' });
  }
  if (err instanceof BillingStoreError) {
    logger.error('billing_store_error', { context, op: err.op, sqlstate: err.sqlstate });
    return new ApiError(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.', { 'Retry-After': '10' });
  }
  logger.error('billing_unexpected_error', { context, errName: err instanceof Error ? err.name : typeof err });
  return new ApiError(500, 'internal_error', 'Something went wrong. Please try again.');
}

export interface CreateResult {
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
  /** What Razorpay charges at authorization. For a trial: the documented INR 5 verification debit, refunded automatically. Otherwise the full plan amount, not refunded. */
  authorization: { amountPaise: number; refundable: boolean };
  reused: boolean;
}

export function createBillingService(deps: BillingServiceDeps) {
  const { config, store, gateway } = deps;
  const clock = deps.now ?? Date.now;
  const planChecked = new Map<string, number>();

  const requireConfigured = () => {
    if (!config.configured || !config.keyId || !config.keySecret || !config.trialPepper) {
      logger.error('billing_not_configured', { problems: config.problems });
      throw unavailable();
    }
  };
  const requireVerifiedEmail = (user: AuthUser): string => {
    if (!user.emailVerified || !user.email) throw new ApiError(403, 'email_not_verified', 'Please verify your email address before starting a subscription.');
    return user.email;
  };

  /** The Razorpay plan must be exactly what our configuration says. Checked before every checkout (cached for 10 minutes). */
  async function assertPlanMatches(planKey: PlanKey) {
    const plan = config.plans[planKey];
    const cachedAt = planChecked.get(plan.razorpayPlanId);
    if (cachedAt && clock() - cachedAt < 600_000) return;
    const rp = await gateway.fetchPlan(plan.razorpayPlanId);
    if (rp.item.amount !== plan.amountPaise || rp.item.currency !== 'INR' || rp.period !== plan.period || rp.interval !== plan.interval) {
      logger.error('billing_plan_mismatch', { planKey });
      throw new ApiError(503, 'plan_mismatch', 'This plan is temporarily unavailable.');
    }
    planChecked.set(plan.razorpayPlanId, clock());
  }

  function checkoutResult(row: { id: string }, rzpId: string, planKey: PlanKey, trialEligible: boolean, trialEndAt: string | null, expireBy: string | null, reused: boolean): CreateResult {
    const plan = config.plans[planKey];
    return {
      subscriptionId: rzpId, keyId: config.keyId as string, planKey, amountPaise: plan.amountPaise, currency: 'INR', billingPeriod: plan.period,
      trialEligible, trialDays: trialEligible ? config.trialDays : 0, firstChargeAt: trialEndAt, authorizationExpiresAt: expireBy,
      authorization: trialEligible ? { amountPaise: VERIFICATION_DEBIT_PAISE, refundable: true } : { amountPaise: plan.amountPaise, refundable: false }, reused
    };
  }

  async function createSubscription(user: AuthUser, planKey: PlanKey): Promise<CreateResult> {
    requireConfigured();
    const email = requireVerifiedEmail(user);
    const plan = config.plans[planKey];
    if (!plan) throw new ApiError(400, 'invalid_plan', 'Unknown plan.');
    const emailHash = hashEmail(email, config.trialPepper as string);
    if (!emailHash) throw new ApiError(400, 'invalid_email', 'Your account email cannot be used for billing.');

    try {
      await assertPlanMatches(planKey);
      for (let attempt = 0; attempt < 2; attempt++) {
        const begin = await store.beginSubscription({
          userId: user.id, emailHash, planKey, razorpayPlanId: plan.razorpayPlanId, billingPeriod: plan.period, amountPaise: plan.amountPaise,
          trialDays: config.trialDays, authWindowMinutes: config.authWindowMinutes
        });

        if (begin.outcome === 'existing') {
          const row = await store.getForUser(user.id, begin.subscription_id);
          if (!row) throw new BillingStoreError('existing_row');
          const stale = !row.expire_by || Date.parse(row.expire_by) < clock() + 60_000;
          if (row.status === 'creating' && !row.razorpay_subscription_id) {
            // An earlier attempt died before Razorpay was called. Retire it and start clean (once).
            await store.markCreateFailed(row.id, user.id);
            continue;
          }
          if (row.status === 'created' && row.razorpay_subscription_id) {
            const live = await gateway.fetchSubscription(row.razorpay_subscription_id);
            if (live.status === 'created' && !stale && row.plan_key === planKey) {
              return checkoutResult(row, row.razorpay_subscription_id, planKey, row.trial_end_at !== null, row.trial_end_at, row.expire_by, true);
            }
            if (live.status === 'created') {
              // Unauthorized and either stale or for another plan: cancel it at Razorpay, and only proceed once Razorpay says it is stopped.
              const cancelled = await gateway.cancelSubscription(row.razorpay_subscription_id, false);
              if (cancelled.status !== 'cancelled' && cancelled.status !== 'expired') throw new ApiError(409, 'subscription_exists', 'You already have a subscription in progress.');
              await store.applyPatch(row.id, buildSyncPatch(row, cancelled, clock()));
              await store.markStopVerified(row.id, cancelled.status as 'cancelled' | 'expired');
              continue;
            }
            // Razorpay moved on (authenticated, expired, ...): record the truth and re-evaluate.
            await applyAndMaybeAuthorize(row, live);
            continue;
          }
          throw new ApiError(409, 'subscription_exists', 'You already have a subscription.');
        }

        // outcome 'created': an intent row exists and has the trial dates fixed by the database clock.
        const row = await store.getForUser(user.id, begin.subscription_id);
        if (!row) throw new BillingStoreError('new_row');
        const trial = begin.trial_eligible && !!begin.trial_end_at;
        let rzp: RzpSubscription;
        try {
          rzp = await gateway.createSubscription({
            plan_id: plan.razorpayPlanId, total_count: plan.totalCount,
            ...(trial ? { start_at: Math.floor(Date.parse(begin.trial_end_at as string) / 1000) } : {}),
            expire_by: Math.floor(Date.parse(begin.expire_by as string) / 1000), customer_notify: 1,
            notes: { user_id: user.id, plan_key: planKey, billing_row: row.id }
          });
        } catch (err) {
          await store.markCreateFailed(row.id, user.id).catch(() => undefined);
          throw err;
        }
        if (rzp.status !== 'created') {
          await tryCancelOrphan(rzp.id);
          await store.markCreateFailed(row.id, user.id).catch(() => undefined);
          throw new ApiError(502, 'billing_upstream_error', 'The payment provider returned an unexpected response. Please try again.');
        }
        try {
          await store.attachRazorpayId(row.id, user.id, rzp.id, 'created');
        } catch (err) {
          // Razorpay has a subscription we cannot link. Stop it so it can never be authorized into an unowned mandate.
          await tryCancelOrphan(rzp.id);
          await store.markCreateFailed(row.id, user.id).catch(() => undefined);
          throw err;
        }
        return checkoutResult(row, rzp.id, planKey, trial, begin.trial_end_at, begin.expire_by, false);
      }
      throw new ApiError(409, 'subscription_in_progress', 'Another subscription attempt is in progress. Please try again in a moment.');
    } catch (err) {
      throw toApiError(err, 'create_subscription');
    }
  }

  async function tryCancelOrphan(rzpId: string) {
    try {
      await gateway.cancelSubscription(rzpId, false);
    } catch (err) {
      logger.error('billing_orphan_cancel_failed', { kind: err instanceof RazorpayError ? err.kind : 'unknown' });
    }
  }

  /**
   * Writes Razorpay's view onto the row. If this is the moment authorization is confirmed (the row was not yet authorized and
   * Razorpay now says authenticated or active), also stamps trial_start_at and consumes the trial claim. Never called with data
   * that did not come from a Razorpay fetch or API response.
   */
  async function applyAndMaybeAuthorize(row: SubscriptionRow, rzp: RzpSubscription, paymentId?: string): Promise<SubscriptionRow> {
    if (!RAZORPAY_STATUSES.includes(rzp.status)) {
      logger.error('billing_unknown_status', { status: String(rzp.status).slice(0, 32) });
      throw new ApiError(502, 'billing_upstream_error', 'The payment provider returned an unexpected state.');
    }
    if (isTerminal(row.status) && rzp.status !== row.status) {
      logger.error('billing_terminal_regression_refused', { from: row.status, to: String(rzp.status).slice(0, 32) });
      return row;
    }
    const nowMs = clock();
    const patch = buildSyncPatch(row, rzp, nowMs);
    const authorizedNow = !row.auth_verified_at && (rzp.status === 'authenticated' || rzp.status === 'active');
    if (authorizedNow) {
      const trialEnd = row.trial_end_at ? Date.parse(row.trial_end_at) : undefined;
      patch.auth_verified_at = new Date(nowMs).toISOString();
      if (trialEnd !== undefined && nowMs < trialEnd) patch.trial_start_at = new Date(nowMs).toISOString();
    }
    if (paymentId && row.user_id) {
      const pay = await gateway.fetchPayment(paymentId);
      const rec = paymentRecord(row, pay, row.trial_end_at ? 'authorization' : 'charge', nowMs);
      if (rec) await store.recordPayment(rec);
    }
    await store.applyPatch(row.id, patch);
    if (authorizedNow && row.user_id && row.trial_end_at) await store.consumeTrialClaim(row.user_id, row.id);
    if (isTerminal(rzp.status as SubStatus)) await store.markStopVerified(row.id, rzp.status as 'cancelled' | 'completed' | 'expired');
    return { ...row, ...patch } as SubscriptionRow;
  }

  async function verifyAuthorization(user: AuthUser, body: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) {
    requireConfigured();
    try {
      // Ownership first: the row is looked up by BOTH the verified user id and the Razorpay id. Someone else's id looks the same as an unknown one.
      const row = await store.getByRazorpayIdForUser(user.id, body.razorpay_subscription_id);
      if (!row || !row.razorpay_subscription_id) throw new ApiError(404, 'subscription_not_found', 'Subscription not found.');
      const okSig = verifyPaymentSignature({ paymentId: body.razorpay_payment_id, subscriptionId: row.razorpay_subscription_id, signature: body.razorpay_signature, keySecret: config.keySecret as string });
      if (!okSig) {
        logger.warn('billing_invalid_payment_signature', { userId: user.id, subscriptionRow: row.id });
        throw new ApiError(400, 'invalid_signature', 'Payment verification failed.');
      }
      if (!PAY_ID.test(body.razorpay_payment_id)) throw new ApiError(400, 'invalid_signature', 'Payment verification failed.');
      if (row.auth_verified_at) return { verified: true, alreadyVerified: true, subscription: toPublicSubscription(row) };

      // A valid signature proves the customer paid something for THIS subscription. It does not grant access: Razorpay must say so too.
      const rzp = await gateway.fetchSubscription(row.razorpay_subscription_id);
      if (rzp.status !== 'authenticated' && rzp.status !== 'active') {
        throw new ApiError(409, 'authorization_not_confirmed', 'Razorpay has not confirmed this authorization yet. Please try again in a moment.');
      }
      const updated = await applyAndMaybeAuthorize(row, rzp, body.razorpay_payment_id);
      return { verified: true, alreadyVerified: false, subscription: toPublicSubscription(updated) };
    } catch (err) {
      throw toApiError(err, 'verify_authorization');
    }
  }

  async function cancel(user: AuthUser) {
    requireConfigured();
    try {
      let row = await store.getLiveForUser(user.id);
      if (!row) throw new ApiError(404, 'no_active_subscription', 'You have no subscription to cancel.');
      // Decide from Razorpay's current state, not our mirror: a trial may have just converted to a paid cycle (or just failed) and
      // the webhook may not have been processed yet. Cancelling "immediately" a subscription that is really paid, or "at cycle end"
      // one that is not in a cycle (which Razorpay rejects), would both be wrong.
      if (row.razorpay_subscription_id) row = await reconcileRow(row);
      if (!(LIVE as readonly string[]).includes(row.status)) {
        return { cancelled: true, alreadyRequested: true, subscription: toPublicSubscription(row), accessEndsAt: row.access_ends_at };
      }
      if (row.status === 'active' && row.cancel_at_cycle_end) return { cancelled: true, alreadyRequested: true, subscription: toPublicSubscription(row), accessEndsAt: row.access_ends_at };
      if (!row.razorpay_subscription_id) {
        // Never reached Razorpay: nothing to stop there.
        await store.markCreateFailed(row.id, user.id);
        return { cancelled: true, alreadyRequested: false, subscription: toPublicSubscription({ ...row, status: 'expired' }), accessEndsAt: null };
      }
      const cycleEnd = row.status === 'active';
      const nowIso = new Date(clock()).toISOString();
      const resp = await gateway.cancelSubscription(row.razorpay_subscription_id, cycleEnd);
      if (!RAZORPAY_STATUSES.includes(resp.status)) throw new ApiError(502, 'billing_upstream_error', 'The payment provider returned an unexpected state.');

      const patch = buildSyncPatch(row, resp, clock());
      patch.cancel_requested_at = row.cancel_requested_at ?? nowIso;
      if (resp.status === 'cancelled') {
        // Immediate cancel. A trial keeps its promised end; an unpaid pending/halted row has no access to keep.
        patch.access_ends_at = row.status === 'authenticated' && row.trial_end_at ? row.trial_end_at : row.status === 'active' ? (patch.current_period_end ?? null) : nowIso;
      } else if (cycleEnd) {
        patch.cancel_at_cycle_end = true;
        patch.access_ends_at = patch.current_period_end ?? row.current_period_end;
      }
      await store.applyPatch(row.id, patch);
      if (isTerminal(resp.status as SubStatus)) await store.markStopVerified(row.id, resp.status as 'cancelled' | 'completed' | 'expired');
      const merged = { ...row, ...patch } as SubscriptionRow;
      return { cancelled: true, alreadyRequested: false, subscription: toPublicSubscription(merged), accessEndsAt: merged.access_ends_at };
    } catch (err) {
      throw toApiError(err, 'cancel');
    }
  }

  /** Re-fetches one subscription from Razorpay and mirrors it. Used by status reads, the webhook handler and the reconciler. */
  async function reconcileRow(row: SubscriptionRow): Promise<SubscriptionRow> {
    if (!row.razorpay_subscription_id) return row;
    const rzp = await gateway.fetchSubscription(row.razorpay_subscription_id);
    return applyAndMaybeAuthorize(row, rzp);
  }

  const needsReconcile = (r: SubscriptionRow): boolean => {
    const t = clock();
    if (!r.razorpay_subscription_id || isTerminal(r.status)) return false;
    const synced = r.razorpay_synced_at ? Date.parse(r.razorpay_synced_at) : 0;
    if (t - synced < 60_000) return false; // at most once a minute per row
    if (r.status === 'created') return !!r.expire_by && Date.parse(r.expire_by) < t;
    if (r.status === 'authenticated') return !!r.trial_end_at && Date.parse(r.trial_end_at) < t;
    if (r.status === 'pending') return true;
    if (r.status === 'active' && r.cancel_at_cycle_end) return !!r.current_period_end && Date.parse(r.current_period_end) < t;
    return false;
  };

  async function getStatus(user: AuthUser) {
    requireConfigured();
    try {
      let latest = await store.getLatestForUser(user.id);
      if (latest && needsReconcile(latest)) {
        try {
          latest = await reconcileRow(latest);
        } catch (err) {
          logger.warn('billing_status_reconcile_failed', { userId: user.id, kind: err instanceof RazorpayError ? err.kind : 'other' }); // stale data beats a failed page
        }
      }
      const entitlement = await store.getEntitlement(user.id, config.pendingGraceHours);
      let trialEligible = false;
      const hash = user.emailVerified && user.email && config.trialDays > 0 ? hashEmail(user.email, config.trialPepper as string) : undefined;
      if (hash) trialEligible = await store.trialClaimAvailable(user.id, hash);
      const t = clock();
      const firstChargePreview = new Date(t + (config.authWindowMinutes + config.trialDays * 1440) * 60_000).toISOString();
      return {
        enforcement: config.enforcement,
        emailVerified: user.emailVerified,
        trial: { eligible: trialEligible, days: config.trialDays, firstChargePreviewAt: trialEligible ? firstChargePreview : null, verificationDebit: { amountPaise: VERIFICATION_DEBIT_PAISE, refundedAutomatically: true } },
        plans: (['monthly', 'annual'] as const).map((k) => ({ key: k, amountPaise: config.plans[k].amountPaise, currency: 'INR', billingPeriod: config.plans[k].period, interval: config.plans[k].interval })),
        entitlement: { state: entitlement.state, hasAccess: entitlement.has_access, accessEndsAt: entitlement.access_ends_at },
        subscription: latest ? toPublicSubscription(latest) : null
      };
    } catch (err) {
      throw toApiError(err, 'status');
    }
  }

  async function listPayments(user: AuthUser) {
    try {
      const rows = await store.listPayments(user.id, 50);
      return rows.map((p) => ({ id: p.id, kind: p.kind, status: p.status, amountPaise: p.amount_paise, amountRefundedPaise: p.amount_refunded_paise ?? 0, currency: p.currency, method: p.method, paidAt: p.paid_at, createdAt: p.created_at }));
    } catch (err) {
      throw toApiError(err, 'payments');
    }
  }

  // ------------------------------------------------------------------------------------------------------------ webhook

  type WebhookResult = { status: number; body: { received: boolean; result: string } };

  /**
   * `rawBody` is the exact byte sequence Razorpay sent. Order matters: signature -> event id -> parse -> idempotency gate -> work.
   * Nothing touches the database before the signature is verified.
   */
  async function handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): Promise<WebhookResult> {
    if (!config.webhookSecret) {
      logger.error('billing_webhook_not_configured', {});
      return { status: 503, body: { received: false, result: 'not_configured' } };
    }
    if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) return { status: 400, body: { received: false, result: 'invalid_signature' } };
    if (!eventId || eventId.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(eventId)) return { status: 400, body: { received: false, result: 'missing_event_id' } };

    let evt: { event?: unknown; created_at?: unknown; payload?: { subscription?: { entity?: { id?: unknown } }; payment?: { entity?: { id?: unknown } } } };
    try {
      evt = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, body: { received: false, result: 'invalid_json' } };
    }
    const type = typeof evt?.event === 'string' ? evt.event.slice(0, 64) : '';
    if (!type) return { status: 400, body: { received: false, result: 'invalid_event' } };
    const subId = typeof evt.payload?.subscription?.entity?.id === 'string' && SUB_ID.test(evt.payload.subscription.entity.id) ? evt.payload.subscription.entity.id : null;
    const payId = typeof evt.payload?.payment?.entity?.id === 'string' && PAY_ID.test(evt.payload.payment.entity.id) ? evt.payload.payment.entity.id : null;

    let gate;
    try {
      gate = await store.beginWebhookEvent({ eventId, eventType: type, razorpaySubscriptionId: subId, razorpayPaymentId: payId, payloadSha256: sha256Hex(rawBody), eventCreatedAt: iso(typeof evt.created_at === 'number' ? evt.created_at : null) });
    } catch (err) {
      toApiError(err, 'webhook_begin');
      return { status: 500, body: { received: false, result: 'store_unavailable' } }; // Razorpay retries
    }
    if (gate === 'duplicate') return { status: 200, body: { received: true, result: 'duplicate' } };
    if (gate === 'in_progress') return { status: 409, body: { received: false, result: 'in_progress' } };

    const finish = async (outcome: 'processed' | 'ignored' | 'failed', code: string | null) => {
      try {
        await store.finishWebhookEvent(eventId, outcome, code);
      } catch (err) {
        logger.error('billing_webhook_finish_failed', { op: err instanceof BillingStoreError ? err.op : 'unknown' });
      }
    };

    if (!HANDLED_EVENTS.has(type) || !subId) {
      await finish('ignored', !subId ? 'no_subscription' : 'unhandled_event');
      return { status: 200, body: { received: true, result: 'ignored' } };
    }

    try {
      const row = await store.getByRazorpayId(subId);
      if (!row) {
        // Not ours (another product on the same Razorpay account), or the event beat our own bookkeeping; the reconciler heals the latter.
        await finish('ignored', 'unknown_subscription');
        return { status: 200, body: { received: true, result: 'ignored' } };
      }
      if (row.user_id === null && !row.billing_stop_verified_at) {
        // Orphan: its owner deleted their account while billing could still run. Stop it at Razorpay, then record what Razorpay says.
        const stopped = await gateway.cancelSubscription(subId, false);
        if (RAZORPAY_STATUSES.includes(stopped.status) && isTerminal(stopped.status as SubStatus)) {
          await store.applyPatch(row.id, buildSyncPatch(row, stopped, clock()));
          await store.markStopVerified(row.id, stopped.status as 'cancelled' | 'completed' | 'expired');
        }
        logger.warn('billing_orphan_subscription_cancelled', { subscriptionRow: row.id, status: String(stopped.status).slice(0, 32) });
        await finish('processed', 'orphan_cancelled');
        return { status: 200, body: { received: true, result: 'orphan_cancelled' } };
      }
      // The event is a hint: fetch the current truth and write that, so duplicates and reordering converge.
      const rzp = await gateway.fetchSubscription(subId);
      const synced = await applyAndMaybeAuthorize(row, rzp);
      if (payId && type === 'subscription.charged' && synced.user_id) {
        const pay = await gateway.fetchPayment(payId);
        const rec = paymentRecord(synced, pay, 'charge', clock());
        if (rec) await store.recordPayment(rec);
      }
      await finish('processed', null);
      return { status: 200, body: { received: true, result: 'processed' } };
    } catch (err) {
      const e = toApiError(err, 'webhook_process');
      await finish('failed', e.code);
      return { status: 500, body: { received: false, result: 'failed' } }; // Razorpay retries
    }
  }

  // ------------------------------------------------------------------------------------------------------- reconciler

  /** Batch run (scripts/billing-reconcile.ts, later a scheduled job): heals lost webhooks and checks the INR 5 authorization refunds. */
  async function reconcileBatch(limit = 50) {
    const out = { checked: 0, updated: 0, failed: 0, unrefunded: 0 };
    const rows = await store.listReconcilable(new Date(clock()).toISOString(), limit);
    for (const r of rows) {
      out.checked++;
      try {
        await reconcileRow(r);
        out.updated++;
      } catch (err) {
        out.failed++;
        logger.warn('billing_reconcile_failed', { subscriptionRow: r.id, kind: err instanceof RazorpayError ? err.kind : 'other' });
      }
    }
    for (const a of await store.unrefundedAuthorizations(1440)) {
      try {
        const pay = await gateway.fetchPayment(a.razorpay_payment_id);
        const row = await store.getById(a.subscription_id);
        const rec = row ? paymentRecord(row, pay, 'authorization', clock()) : null;
        if (rec) await store.recordPayment(rec);
        if (!rec || rec.status !== 'refunded') {
          out.unrefunded++;
          logger.error('billing_authorization_not_refunded', { paymentRow: a.subscription_id, razorpayStatus: pay.status, refundStatus: pay.refund_status ?? null });
        }
      } catch (err) {
        out.failed++;
        logger.warn('billing_refund_check_failed', { kind: err instanceof RazorpayError ? err.kind : 'other' });
      }
    }
    return out;
  }
  async function checkEntitlement(userId: string) {
    const e = await store.getEntitlement(userId, config.pendingGraceHours);
    return { state: e.state, hasAccess: e.has_access };
  }

  return { checkEntitlement, createSubscription, verifyAuthorization, cancel, getStatus, listPayments, handleWebhook, reconcileRow, reconcileBatch };
}
export type BillingService = ReturnType<typeof createBillingService>;
