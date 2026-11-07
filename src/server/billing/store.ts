import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BillingConfig } from './config';
import type {
  BeginSubscriptionArgs, BeginSubscriptionResult, Entitlement, PaymentRecord, PaymentRow, SubscriptionPatch, SubscriptionRow,
  SubStatus, WebhookEventArgs, WebhookGate, WebhookOutcome
} from './types';

/** Thrown for any database failure. The message is static: PostgREST errors can carry table, column and constraint names. */
export class BillingStoreError extends Error {
  constructor(
    public readonly op: string,
    /** Postgres SQLSTATE when the database supplied one (for example 23505 unique violation). */
    public readonly sqlstate?: string
  ) {
    super(`Billing database operation failed (${op}).`);
    this.name = 'BillingStoreError';
  }
}

/**
 * Everything the billing service needs from the database. The ONLY implementation that touches Supabase uses the
 * service-role key. Because service role bypasses RLS, every method that takes a user id filters on it, and the
 * methods without one (`getByRazorpayId`, `applyPatch`, ...) are reachable only from signature-verified or
 * Razorpay-confirmed code paths in service.ts.
 */
export interface BillingStore {
  getEntitlement(userId: string, graceHours: number): Promise<Entitlement>;
  trialClaimAvailable(userId: string, emailHash: string): Promise<boolean>;
  beginSubscription(args: BeginSubscriptionArgs): Promise<BeginSubscriptionResult>;
  getForUser(userId: string, id: string): Promise<SubscriptionRow | null>;
  getLiveForUser(userId: string): Promise<SubscriptionRow | null>;
  getLatestForUser(userId: string): Promise<SubscriptionRow | null>;
  getByRazorpayIdForUser(userId: string, razorpayId: string): Promise<SubscriptionRow | null>;
  getByRazorpayId(razorpayId: string): Promise<SubscriptionRow | null>;
  /** Internal id only (taken from our own database, e.g. billing_unrefunded_authorizations), never from a request. */
  getById(id: string): Promise<SubscriptionRow | null>;
  attachRazorpayId(id: string, userId: string, razorpayId: string, status: SubStatus): Promise<void>;
  markCreateFailed(id: string, userId: string): Promise<void>;
  applyPatch(id: string, patch: SubscriptionPatch): Promise<void>;
  consumeTrialClaim(userId: string, subscriptionId: string): Promise<boolean>;
  markStopVerified(subscriptionId: string, observedStatus: 'cancelled' | 'completed' | 'expired'): Promise<boolean>;
  recordPayment(p: PaymentRecord): Promise<void>;
  listPayments(userId: string, limit: number): Promise<PaymentRow[]>;
  beginWebhookEvent(a: WebhookEventArgs): Promise<WebhookGate>;
  finishWebhookEvent(eventId: string, status: WebhookOutcome, errorCode: string | null): Promise<void>;
  listReconcilable(nowIso: string, limit: number): Promise<SubscriptionRow[]>;
  unrefundedAuthorizations(olderThanMinutes: number): Promise<Array<{ razorpay_payment_id: string; subscription_id: string }>>;
}

type Db = SupabaseClient;

export function createSupabaseBillingStore(config: Pick<BillingConfig, 'supabaseUrl' | 'serviceRoleKey'>, client?: Db): BillingStore {
  if (!client && (!config.supabaseUrl || !config.serviceRoleKey)) throw new Error('Billing database is not configured.');
  const db: Db =
    client ??
    createClient(config.supabaseUrl as string, config.serviceRoleKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

  const fail = (op: string, error: { code?: string } | null | undefined): never => {
    throw new BillingStoreError(op, typeof error?.code === 'string' ? error.code : undefined);
  };
  const one = async (op: string, q: PromiseLike<{ data: unknown; error: { code?: string } | null }>) => {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (Array.isArray(data) ? data[0] : data) ?? null;
  };
  const rpcOne = async <T>(op: string, fn: string, args: Record<string, unknown>): Promise<T | null> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) fail(op, error);
    return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null;
  };

  const LIVE_LIST = '(creating,created,authenticated,active,pending,halted)';

  return {
    async getEntitlement(userId, graceHours) {
      const r = await rpcOne<Entitlement>('entitlement', 'billing_get_entitlement', { p_user_id: userId, p_pending_grace_hours: graceHours });
      if (!r) throw new BillingStoreError('entitlement');
      return r;
    },

    async trialClaimAvailable(userId, emailHash) {
      const byHash = (await one('claim_by_hash', db.from('billing_trial_claims').select('state,user_id').eq('email_hash', emailHash).limit(1))) as { state: string; user_id: string | null } | null;
      if (byHash && !(byHash.state === 'reserved' && (byHash.user_id === null || byHash.user_id === userId))) return false;
      const consumed = await one('claim_by_user', db.from('billing_trial_claims').select('email_hash').eq('user_id', userId).eq('state', 'consumed').limit(1));
      return consumed === null;
    },

    async beginSubscription(a) {
      const r = await rpcOne<BeginSubscriptionResult>('begin_subscription', 'billing_begin_subscription', {
        p_user_id: a.userId, p_email_hash: a.emailHash, p_plan_key: a.planKey, p_razorpay_plan_id: a.razorpayPlanId,
        p_billing_period: a.billingPeriod, p_amount_paise: a.amountPaise, p_trial_days: a.trialDays, p_authorization_window_minutes: a.authWindowMinutes
      });
      if (!r) throw new BillingStoreError('begin_subscription');
      return r;
    },

    async getForUser(userId, id) {
      return (await one('get_for_user', db.from('billing_subscriptions').select('*').eq('id', id).eq('user_id', userId).limit(1))) as SubscriptionRow | null;
    },
    async getLiveForUser(userId) {
      return (await one('get_live', db.from('billing_subscriptions').select('*').eq('user_id', userId).filter('status', 'in', LIVE_LIST).limit(1))) as SubscriptionRow | null;
    },
    async getLatestForUser(userId) {
      return (await one('get_latest', db.from('billing_subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1))) as SubscriptionRow | null;
    },
    async getByRazorpayIdForUser(userId, razorpayId) {
      return (await one('get_by_rzp_user', db.from('billing_subscriptions').select('*').eq('razorpay_subscription_id', razorpayId).eq('user_id', userId).limit(1))) as SubscriptionRow | null;
    },
    async getByRazorpayId(razorpayId) {
      return (await one('get_by_rzp', db.from('billing_subscriptions').select('*').eq('razorpay_subscription_id', razorpayId).limit(1))) as SubscriptionRow | null;
    },

    async getById(id) {
      return (await one('get_by_id', db.from('billing_subscriptions').select('*').eq('id', id).limit(1))) as SubscriptionRow | null;
    },

    async attachRazorpayId(id, userId, razorpayId, status) {
      // Only an intent row we created ('creating') can receive its Razorpay id, and only for its owner.
      const r = await one('attach', db.from('billing_subscriptions').update({ razorpay_subscription_id: razorpayId, status, razorpay_synced_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).eq('status', 'creating').select('id'));
      if (!r) throw new BillingStoreError('attach');
    },
    async markCreateFailed(id, userId) {
      await one('create_failed', db.from('billing_subscriptions').update({ status: 'expired', ended_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).eq('status', 'creating').select('id'));
    },
    async applyPatch(id, patch) {
      await one('patch', db.from('billing_subscriptions').update(patch).eq('id', id).select('id'));
    },

    async consumeTrialClaim(userId, subscriptionId) {
      return (await rpcOne<boolean>('consume_claim', 'billing_consume_trial_claim', { p_user_id: userId, p_subscription_id: subscriptionId })) === true;
    },
    async markStopVerified(subscriptionId, observedStatus) {
      return (await rpcOne<boolean>('stop_verified', 'billing_mark_stop_verified', { p_subscription_id: subscriptionId, p_observed_status: observedStatus })) === true;
    },

    async recordPayment(p) {
      // Insert once; later calls update status fields only, so a row's `kind` (authorization vs charge) is never rewritten.
      const row = {
        user_id: p.userId, subscription_id: p.subscriptionId, razorpay_payment_id: p.razorpayPaymentId, razorpay_invoice_id: p.razorpayInvoiceId,
        kind: p.kind, status: p.status, amount_paise: p.amountPaise, amount_refunded_paise: p.amountRefundedPaise, currency: 'INR',
        method: p.method?.slice(0, 32) ?? null, error_code: p.errorCode?.slice(0, 64) ?? null, paid_at: p.paidAt, refunded_at: p.refundedAt
      };
      const ins = await db.from('billing_payments').upsert(row, { onConflict: 'razorpay_payment_id', ignoreDuplicates: true });
      if (ins.error) fail('payment_insert', ins.error);
      const upd = await db.from('billing_payments')
        .update({ status: p.status, amount_refunded_paise: p.amountRefundedPaise, error_code: row.error_code, paid_at: p.paidAt, refunded_at: p.refundedAt, updated_at: new Date().toISOString() })
        .eq('razorpay_payment_id', p.razorpayPaymentId).eq('subscription_id', p.subscriptionId);
      if (upd.error) fail('payment_update', upd.error);
    },
    async listPayments(userId, limit) {
      const { data, error } = await db.from('billing_payments').select('id,subscription_id,kind,status,amount_paise,amount_refunded_paise,currency,method,paid_at,refunded_at,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
      if (error) fail('list_payments', error);
      return (data ?? []) as PaymentRow[];
    },

    async beginWebhookEvent(a) {
      const r = await rpcOne<WebhookGate>('webhook_begin', 'billing_begin_webhook_event', {
        p_event_id: a.eventId, p_event_type: a.eventType, p_razorpay_subscription_id: a.razorpaySubscriptionId, p_razorpay_payment_id: a.razorpayPaymentId,
        p_payload_sha256: a.payloadSha256, p_event_created_at: a.eventCreatedAt
      });
      if (r !== 'process' && r !== 'duplicate' && r !== 'in_progress') throw new BillingStoreError('webhook_begin');
      return r;
    },
    async finishWebhookEvent(eventId, status, errorCode) {
      const { error } = await db.from('billing_webhook_events').update({ status, error_code: errorCode?.slice(0, 64) ?? null, processed_at: new Date().toISOString() }).eq('razorpay_event_id', eventId);
      if (error) fail('webhook_finish', error);
    },

    async listReconcilable(nowIso, limit) {
      // created past expire_by; authenticated past trial end; pending/halted; created or authenticated rows older than 10 min
      // (a lost callback). Bounded so one run cannot scan the table.
      const tenMin = new Date(Date.parse(nowIso) - 10 * 60_000).toISOString();
      const { data, error } = await db.from('billing_subscriptions').select('*')
        .not('razorpay_subscription_id', 'is', null)
        .or(`and(status.eq.created,created_at.lt.${tenMin}),and(status.eq.authenticated,trial_end_at.lt.${nowIso}),status.eq.pending,and(status.eq.active,cancel_at_cycle_end.eq.true,current_period_end.lt.${nowIso})`)
        .order('razorpay_synced_at', { ascending: true, nullsFirst: true }).limit(limit);
      if (error) fail('list_reconcilable', error);
      return (data ?? []) as SubscriptionRow[];
    },
    async unrefundedAuthorizations(olderThanMinutes) {
      const r = await db.rpc('billing_unrefunded_authorizations', { p_older_than_minutes: olderThanMinutes });
      if (r.error) fail('unrefunded', r.error);
      return (r.data ?? []) as Array<{ razorpay_payment_id: string; subscription_id: string }>;
    }
  };
}
