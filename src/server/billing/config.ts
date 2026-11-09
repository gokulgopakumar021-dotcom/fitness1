// Billing configuration. Server only: nothing here may be imported by src/components, src/views or any VITE_* path.
// Problems are returned as static text naming settings, never values, so they are safe to log.
export type Env = Record<string, string | undefined>;
export type PlanKey = 'monthly' | 'annual';
export const PLAN_KEYS: readonly PlanKey[] = ['monthly', 'annual'] as const;
export type EnforcementMode = 'off' | 'shadow' | 'on';

export interface PlanConfig {
  key: PlanKey;
  razorpayPlanId: string;
  amountPaise: number;
  /** Razorpay plan `period` value, also stored in billing_subscriptions.billing_period. */
  period: 'monthly' | 'yearly';
  interval: number;
  totalCount: number;
}

export interface BillingConfig {
  /** True when every setting needed to talk to Razorpay and the billing database is present and valid. */
  configured: boolean;
  problems: string[];
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  trialPepper?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  plans: Record<PlanKey, PlanConfig>;
  trialDays: number;
  authWindowMinutes: number;
  pendingGraceHours: number;
  enforcement: EnforcementMode;
  /** Per Razorpay API call. The official SDK sets no timeout of its own. */
  requestTimeoutMs: number;
}

/** Razorpay documents the token authentication amount for a future-start subscription as INR 5 (auto-refunded). */
export const VERIFICATION_DEBIT_PAISE = 500;
export const MAX_RECURRING_PAISE = 1_500_000;

const PLAN_ID = /^plan_[A-Za-z0-9]{6,40}$/;
const int = (v: string | undefined, d: number) => (v === undefined || v.trim() === '' ? d : Number(v.trim()));
const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

export function loadBillingConfig(env: Env = process.env): BillingConfig {
  const problems: string[] = [];
  const clean = (v: string | undefined) => (v ?? '').trim() || undefined;

  const keyId = clean(env.RAZORPAY_KEY_ID);
  const keySecret = clean(env.RAZORPAY_KEY_SECRET);
  const webhookSecret = clean(env.RAZORPAY_WEBHOOK_SECRET);
  const trialPepper = clean(env.BILLING_TRIAL_PEPPER);
  const supabaseUrl = clean(env.SUPABASE_URL) ?? clean(env.VITE_SUPABASE_URL);
  const serviceRoleKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!keyId) problems.push('RAZORPAY_KEY_ID is not set.');
  else if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) problems.push('RAZORPAY_KEY_ID has an unexpected format.');
  // Test Mode only for this project phase. Live keys need an explicit, separate opt-in.
  else if (keyId.startsWith('rzp_live_') && env.BILLING_ALLOW_LIVE_KEYS !== 'true') problems.push('A live Razorpay key was supplied but BILLING_ALLOW_LIVE_KEYS is not "true".');
  if (!keySecret) problems.push('RAZORPAY_KEY_SECRET is not set.');
  if (!webhookSecret) problems.push('RAZORPAY_WEBHOOK_SECRET is not set.');
  if (!trialPepper || trialPepper.length < 16) problems.push('BILLING_TRIAL_PEPPER must be set to a secret of at least 16 characters.');
  if (!supabaseUrl) problems.push('SUPABASE_URL (or VITE_SUPABASE_URL) is not set.');
  if (!serviceRoleKey) problems.push('SUPABASE_SERVICE_ROLE_KEY is not set.');

  const mk = (key: PlanKey, idVar: string, priceVar: string, defPrice: number, countVar: string, defCount: number, period: 'monthly' | 'yearly'): PlanConfig => {
    const razorpayPlanId = clean(env[idVar]) ?? '';
    const amountPaise = int(env[priceVar], defPrice);
    const totalCount = int(env[countVar], defCount);
    if (!PLAN_ID.test(razorpayPlanId)) problems.push(`${idVar} must be a Razorpay plan id (plan_...).`);
    if (!inRange(amountPaise, 100, MAX_RECURRING_PAISE)) problems.push(`${priceVar} must be an integer number of paise between 100 and ${MAX_RECURRING_PAISE}.`);
    if (!inRange(totalCount, 1, 1200)) problems.push(`${countVar} must be an integer between 1 and 1200.`);
    return { key, razorpayPlanId, amountPaise, period, interval: 1, totalCount };
  };
  const plans = {
    monthly: mk('monthly', 'RAZORPAY_PLAN_ID_MONTHLY', 'BILLING_PRICE_MONTHLY_PAISE', 29_900, 'BILLING_TOTAL_COUNT_MONTHLY', 120, 'monthly'),
    annual: mk('annual', 'RAZORPAY_PLAN_ID_ANNUAL', 'BILLING_PRICE_ANNUAL_PAISE', 149_900, 'BILLING_TOTAL_COUNT_ANNUAL', 10, 'yearly')
  };

  const trialDays = int(env.BILLING_TRIAL_DAYS, 3);
  const authWindowMinutes = int(env.BILLING_AUTH_WINDOW_MINUTES, 30);
  const pendingGraceHours = int(env.BILLING_PENDING_GRACE_HOURS, 0);
  const requestTimeoutMs = int(env.BILLING_RAZORPAY_TIMEOUT_MS, 15_000);
  if (!inRange(trialDays, 0, 30)) problems.push('BILLING_TRIAL_DAYS must be an integer between 0 and 30.');
  if (!inRange(authWindowMinutes, 20, 1440)) problems.push('BILLING_AUTH_WINDOW_MINUTES must be an integer between 20 and 1440.');
  if (!inRange(pendingGraceHours, 0, 168)) problems.push('BILLING_PENDING_GRACE_HOURS must be an integer between 0 and 168.');
  if (!inRange(requestTimeoutMs, 1000, 60_000)) problems.push('BILLING_RAZORPAY_TIMEOUT_MS must be between 1000 and 60000.');

  const rawEnforcement = (clean(env.BILLING_ENFORCEMENT) ?? 'off').toLowerCase(); // tolerate "ON"/"On"; anything else is reported, never guessed
  let enforcement: EnforcementMode = 'off';
  if (rawEnforcement === 'off' || rawEnforcement === 'shadow' || rawEnforcement === 'on') enforcement = rawEnforcement;
  else problems.push('BILLING_ENFORCEMENT must be off, shadow or on.');

  return {
    configured: problems.length === 0,
    problems,
    keyId,
    keySecret,
    webhookSecret,
    trialPepper,
    supabaseUrl,
    serviceRoleKey,
    plans,
    trialDays,
    authWindowMinutes,
    pendingGraceHours,
    enforcement,
    requestTimeoutMs
  };
}
