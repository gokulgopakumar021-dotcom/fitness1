import { object, oneOf, text, type Validator } from '../security/validation';
import { PLAN_KEYS } from './config';

const RZP_SUB = /^sub_[A-Za-z0-9]{6,40}$/;
const RZP_PAY = /^pay_[A-Za-z0-9]{6,40}$/;
const SIG = /^[A-Fa-f0-9]{64}$/;

const pattern = (re: RegExp, label: string, max: number): Validator<string> => {
  const t = text({ max, required: true });
  return (v, path) => {
    const r = t(v, path);
    if (!r.ok) return r;
    return re.test(r.value as string) ? r : { ok: false, issues: [`${path}: is not a valid ${label}`] };
  };
};

const optionalPattern = (re: RegExp, label: string, max: number): Validator<string> => {
  const t = text({ max, required: false });
  return (v, path) => {
    const r = t(v, path);
    if (!r.ok || r.value === undefined) return r;
    return re.test(r.value as string) ? r : { ok: false, issues: [`${path}: is not a valid ${label}`] };
  };
};

/** Strict optional boolean: anything but true/false (or absent) is rejected, so a string "false" can never read as consent. */
const optionalBool: Validator<boolean> = (v, path) => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, issues: [`${path}: must be true or false`] };
};

/** The browser sends a plan KEY only. Amounts, plan ids and user ids are never accepted from the request. */
export const billingSchemas = {
  createSubscription: object({
    planKey: oneOf(PLAN_KEYS, { required: true }),
    referralCode: optionalPattern(/^[A-Za-z0-9]{4,20}$/, 'referral code', 20),
    fullPriceToken: optionalPattern(/^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{20,100}$/, 'token', 500)
  }),
  verifySubscription: object({
    razorpay_payment_id: pattern(RZP_PAY, 'payment id', 64),
    razorpay_subscription_id: pattern(RZP_SUB, 'subscription id', 64),
    razorpay_signature: pattern(SIG, 'signature', 64)
  }),
  empty: object({}),
  prepareDeletion: object({ confirmCancelPaidNow: optionalBool })
};
