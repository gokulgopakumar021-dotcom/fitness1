// Test doubles only. Not imported by any production module (and therefore never bundled into api/index.js).
import { loadBillingConfig, type BillingConfig } from './config';
import { RazorpayError, type CreateSubscriptionParams, type RazorpayGateway, type RzpPayment, type RzpPlan, type RzpSubscription } from './gateway';
import { BillingStoreError, type BillingStore } from './store';
import type { BeginSubscriptionArgs, PaymentRecord, SubscriptionPatch, SubscriptionRow, SubStatus, WebhookGate } from './types';
import { LIVE, TERMINAL } from './types';

export const SECRETS = { keySecret: 'test_key_secret_DO_NOT_LEAK_1234567890', webhookSecret: 'test_webhook_secret_DO_NOT_LEAK_abcdef', serviceRole: 'service_role_DO_NOT_LEAK_zzzzzzzz', pepper: 'pepper_DO_NOT_LEAK_0123456789abcdef' };

export const TEST_ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_abc123XYZ', RAZORPAY_KEY_SECRET: SECRETS.keySecret, RAZORPAY_WEBHOOK_SECRET: SECRETS.webhookSecret,
  RAZORPAY_PLAN_ID_MONTHLY: 'plan_MonthlyTest01', RAZORPAY_PLAN_ID_ANNUAL: 'plan_AnnualTest001',
  BILLING_TRIAL_PEPPER: SECRETS.pepper, SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SECRETS.serviceRole
};
export const testBillingConfig = (over: Record<string, string> = {}): BillingConfig => loadBillingConfig({ ...TEST_ENV, ...over });

export class FakeClock {
  constructor(public t = Date.parse('2026-11-06T10:00:00Z')) {}
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** In-memory model of the Stage 1 SQL contract (one live subscription per user, one trial per email hash / user, event ledger). */
export class FakeStore implements BillingStore {
  subs: SubscriptionRow[] = [];
  payments: Array<PaymentRecord & { id: string }> = [];
  claims = new Map<string, { userId: string | null; subscriptionId: string | null; state: 'reserved' | 'consumed' }>();
  events = new Map<string, { status: string; type: string; code: string | null }>();
  failNext: Record<string, boolean> = {};
  calls: string[] = [];
  constructor(private readonly clock: FakeClock) {}

  private hit(op: string) {
    this.calls.push(op);
    if (this.failNext[op]) { delete this.failNext[op]; throw new BillingStoreError(op, 'XX000'); }
  }
  private iso = (ms: number) => new Date(ms).toISOString();

  async getEntitlement(userId: string) {
    this.hit('entitlement');
    const live = this.subs.find((s) => s.user_id === userId && (s.status === 'authenticated' || s.status === 'active'));
    const now = this.clock.now();
    if (live?.status === 'authenticated' && live.trial_end_at && Date.parse(live.trial_end_at) > now) return { state: 'trialing', has_access: true, access_ends_at: live.trial_end_at, subscription_id: live.id, plan_key: live.plan_key };
    if (live?.status === 'active' && live.current_period_end && Date.parse(live.current_period_end) > now) return { state: 'active', has_access: true, access_ends_at: live.current_period_end, subscription_id: live.id, plan_key: live.plan_key };
    return { state: 'none', has_access: false, access_ends_at: null, subscription_id: null, plan_key: null };
  }
  async trialClaimAvailable(userId: string, emailHash: string) {
    this.hit('trialClaimAvailable');
    const c = this.claims.get(emailHash);
    if (c && !(c.state === 'reserved' && (c.userId === null || c.userId === userId))) return false;
    return ![...this.claims.values()].some((x) => x.userId === userId && x.state === 'consumed');
  }
  async beginSubscription(a: BeginSubscriptionArgs) {
    this.hit('beginSubscription');
    const live = this.subs.find((s) => s.user_id === a.userId && (LIVE as readonly string[]).includes(s.status));
    if (live) return { outcome: 'existing' as const, subscription_id: live.id, status: live.status, plan_key: live.plan_key, trial_eligible: live.trial_end_at !== null, trial_end_at: live.trial_end_at, expire_by: live.expire_by };
    let eligible = false;
    if (a.trialDays > 0) {
      const c = this.claims.get(a.emailHash);
      const consumedByUser = [...this.claims.values()].some((x) => x.userId === a.userId && x.state === 'consumed');
      if (!consumedByUser && (!c || (c.state === 'reserved' && (c.userId === null || c.userId === a.userId)))) eligible = true;
    }
    const now = this.clock.now();
    const expire = now + a.authWindowMinutes * 60_000;
    const trialEnd = eligible ? expire + a.trialDays * 86_400_000 : null;
    const row: SubscriptionRow = {
      id: uuid(), user_id: a.userId, plan_key: a.planKey, razorpay_plan_id: a.razorpayPlanId, razorpay_subscription_id: null, razorpay_customer_id: null,
      billing_period: a.billingPeriod, billing_interval: 1, amount_paise: a.amountPaise, currency: 'INR', status: 'creating', payment_status: 'none',
      trial_start_at: null, trial_end_at: trialEnd ? this.iso(trialEnd) : null, expire_by: this.iso(expire), auth_verified_at: null, current_period_start: null,
      current_period_end: null, next_billing_at: null, paid_count: 0, total_count: null, cancel_requested_at: null, cancel_at_cycle_end: false, cancelled_at: null,
      ended_at: null, access_ends_at: null, billing_stop_verified_at: null, razorpay_synced_at: null, created_at: this.iso(now), updated_at: this.iso(now)
    };
    this.subs.push(row);
    if (eligible) this.claims.set(a.emailHash, { userId: a.userId, subscriptionId: row.id, state: 'reserved' });
    return { outcome: 'created' as const, subscription_id: row.id, status: 'creating' as SubStatus, plan_key: a.planKey, trial_eligible: eligible, trial_end_at: row.trial_end_at, expire_by: row.expire_by };
  }
  private clone = (r: SubscriptionRow | undefined) => (r ? { ...r } : null);
  async getForUser(userId: string, id: string) { this.hit('getForUser'); return this.clone(this.subs.find((s) => s.id === id && s.user_id === userId)); }
  async getLiveForUser(userId: string) { this.hit('getLiveForUser'); return this.clone(this.subs.find((s) => s.user_id === userId && (LIVE as readonly string[]).includes(s.status))); }
  async getLatestForUser(userId: string) { this.hit('getLatestForUser'); return this.clone([...this.subs].reverse().find((s) => s.user_id === userId)); }
  async getByRazorpayIdForUser(userId: string, rid: string) { this.hit('getByRazorpayIdForUser'); return this.clone(this.subs.find((s) => s.razorpay_subscription_id === rid && s.user_id === userId)); }
  async getByRazorpayId(rid: string) { this.hit('getByRazorpayId'); return this.clone(this.subs.find((s) => s.razorpay_subscription_id === rid)); }
  async getById(id: string) { this.hit('getById'); return this.clone(this.subs.find((s) => s.id === id)); }
  async attachRazorpayId(id: string, userId: string, rid: string, status: SubStatus) {
    this.hit('attachRazorpayId');
    const r = this.subs.find((s) => s.id === id && s.user_id === userId && s.status === 'creating');
    if (!r) throw new BillingStoreError('attach');
    r.razorpay_subscription_id = rid; r.status = status;
  }
  async markCreateFailed(id: string, userId: string) {
    this.hit('markCreateFailed');
    const r = this.subs.find((s) => s.id === id && s.user_id === userId && s.status === 'creating');
    if (r) { r.status = 'expired'; r.ended_at = this.iso(this.clock.now()); }
  }
  async applyPatch(id: string, patch: SubscriptionPatch) { this.hit('applyPatch'); Object.assign(this.subs.find((s) => s.id === id)!, patch); }
  async consumeTrialClaim(userId: string, subId: string) {
    this.hit('consumeTrialClaim');
    for (const c of this.claims.values()) if (c.subscriptionId === subId && c.userId === userId) { c.state = 'consumed'; return true; }
    return false;
  }
  async markStopVerified(id: string, status: 'cancelled' | 'completed' | 'expired') {
    this.hit('markStopVerified');
    if (!(TERMINAL as readonly string[]).includes(status)) throw new BillingStoreError('stop_verified');
    const r = this.subs.find((s) => s.id === id)!; r.billing_stop_verified_at = this.iso(this.clock.now()); return true;
  }
  async recordPayment(p: PaymentRecord) {
    this.hit('recordPayment');
    const ex = this.payments.find((x) => x.razorpayPaymentId === p.razorpayPaymentId);
    if (ex) Object.assign(ex, { status: p.status, amountRefundedPaise: p.amountRefundedPaise, kind: ex.kind }); // kind never rewritten
    else this.payments.push({ ...p, id: uuid() });
  }
  async listPayments(userId: string) {
    this.hit('listPayments');
    return this.payments.filter((p) => p.userId === userId).map((p) => ({ id: p.id, subscription_id: p.subscriptionId, kind: p.kind, status: p.status, amount_paise: p.amountPaise, amount_refunded_paise: p.amountRefundedPaise, currency: 'INR', method: p.method, paid_at: p.paidAt, refunded_at: p.refundedAt, created_at: this.iso(this.clock.now()) }));
  }
  async beginWebhookEvent(a: { eventId: string; eventType: string }): Promise<WebhookGate> {
    this.hit('beginWebhookEvent');
    const ev = this.events.get(a.eventId);
    if (!ev) { this.events.set(a.eventId, { status: 'received', type: a.eventType, code: null }); return 'process'; }
    if (ev.status === 'processed' || ev.status === 'ignored') return 'duplicate';
    if (ev.status === 'failed') { ev.status = 'received'; return 'process'; }
    return 'in_progress';
  }
  async finishWebhookEvent(id: string, status: 'processed' | 'ignored' | 'failed', code: string | null) { this.hit('finishWebhookEvent'); Object.assign(this.events.get(id)!, { status, code }); }
  async listReconcilable(nowIso: string) {
    this.hit('listReconcilable');
    const t = Date.parse(nowIso);
    return this.subs.filter((s) => s.razorpay_subscription_id && (
      (s.status === 'created' && Date.parse(s.created_at) < t - 600_000) ||
      (s.status === 'authenticated' && s.trial_end_at !== null && Date.parse(s.trial_end_at) < t) ||
      s.status === 'pending' ||
      (s.status === 'halted' && s.razorpay_synced_at !== null && Date.parse(s.razorpay_synced_at) < t - 86_400_000) ||
      (s.status === 'active' && s.cancel_at_cycle_end && s.current_period_end !== null && Date.parse(s.current_period_end) < t)
    )).map((s) => ({ ...s }));
  }
  /** Same predicate as billing_assert_account_deletable in the Stage 1 SQL. */
  private blocks(s: SubscriptionRow) {
    return !(s.status === 'expired' && s.razorpay_subscription_id === null) && !((TERMINAL as readonly string[]).includes(s.status) && s.billing_stop_verified_at !== null);
  }
  async listBlockingForUser(userId: string) { this.hit('listBlockingForUser'); return this.subs.filter((s) => s.user_id === userId && this.blocks(s)).map((s) => ({ ...s })); }
  async authorizedWithoutAuthorizationPayment(sinceIso: string, untilIso: string) {
    this.hit('authorizedWithoutAuthorizationPayment');
    return this.subs
      .filter((s) => s.auth_verified_at && s.trial_end_at && s.auth_verified_at >= sinceIso && s.auth_verified_at < untilIso && !this.payments.some((p) => p.subscriptionId === s.id && p.kind === 'authorization'))
      .map((s) => ({ id: s.id, auth_verified_at: s.auth_verified_at as string }));
  }
  /** Mirrors delete_own_account(): refuses (BL001) while anything blocks, otherwise nulls user_id on kept rows (on delete set null). */
  deleteAccount(userId: string): 'deleted' | 'billing_cancellation_required' {
    if (this.subs.some((s) => s.user_id === userId && this.blocks(s))) return 'billing_cancellation_required';
    for (const s of this.subs) if (s.user_id === userId) s.user_id = null;
    for (const p of this.payments) if (p.userId === userId) p.userId = null;
    return 'deleted';
  }
  async unrefundedAuthorizations() { this.hit('unrefundedAuthorizations'); return this.payments.filter((p) => p.kind === 'authorization' && p.status !== 'refunded' && p.status !== 'failed').map((p) => ({ razorpay_payment_id: p.razorpayPaymentId, subscription_id: p.subscriptionId })); }
}

/** Scriptable Razorpay. Subscriptions live in a map the test can mutate to simulate what Razorpay would report. */
export class FakeGateway implements RazorpayGateway {
  subs = new Map<string, RzpSubscription>();
  payments = new Map<string, RzpPayment>();
  plans = new Map<string, RzpPlan>();
  created: CreateSubscriptionParams[] = [];
  cancels: Array<{ id: string; cycleEnd: boolean }> = [];
  fail: Partial<Record<'fetchPlan' | 'createSubscription' | 'fetchSubscription' | 'cancelSubscription' | 'fetchPayment', RazorpayError>> = {};
  private n = 0;
  constructor(cfg: BillingConfig) {
    this.plans.set(cfg.plans.monthly.razorpayPlanId, { id: cfg.plans.monthly.razorpayPlanId, period: 'monthly', interval: 1, item: { amount: cfg.plans.monthly.amountPaise, currency: 'INR' } });
    this.plans.set(cfg.plans.annual.razorpayPlanId, { id: cfg.plans.annual.razorpayPlanId, period: 'yearly', interval: 1, item: { amount: cfg.plans.annual.amountPaise, currency: 'INR' } });
  }
  private maybe(k: keyof FakeGateway['fail']) { const e = this.fail[k]; if (e) throw e; }
  async fetchPlan(id: string) { this.maybe('fetchPlan'); const p = this.plans.get(id); if (!p) throw new RazorpayError('rejected', 400); return p; }
  async createSubscription(p: CreateSubscriptionParams) {
    this.maybe('createSubscription'); this.created.push(p);
    const s: RzpSubscription = { id: `sub_Test${String(++this.n).padStart(8, '0')}`, plan_id: p.plan_id, status: 'created', total_count: p.total_count, paid_count: 0, start_at: p.start_at ?? null, expire_by: p.expire_by };
    this.subs.set(s.id, s); return { ...s };
  }
  async fetchSubscription(id: string) { this.maybe('fetchSubscription'); const s = this.subs.get(id); if (!s) throw new RazorpayError('rejected', 400); return { ...s }; }
  async cancelSubscription(id: string, cycleEnd: boolean) {
    this.maybe('cancelSubscription'); this.cancels.push({ id, cycleEnd });
    const s = this.subs.get(id); if (!s) throw new RazorpayError('rejected', 400);
    if (!cycleEnd) s.status = 'cancelled';
    return { ...s };
  }
  async fetchPayment(id: string) { this.maybe('fetchPayment'); const p = this.payments.get(id); if (!p) throw new RazorpayError('rejected', 400); return { ...p }; }
  /** Simulates the customer completing Checkout. */
  authorize(id: string, paymentId: string, amount: number, over: Partial<RzpPayment> = {}) {
    const s = this.subs.get(id)!; s.status = 'authenticated'; s.customer_id = 'cust_Test0001';
    this.payments.set(paymentId, { id: paymentId, status: 'captured', amount, currency: 'INR', method: 'card', created_at: 1_793_000_000, refund_status: amount === 500 ? 'full' : null, amount_refunded: amount === 500 ? 500 : 0, ...over });
  }
}
