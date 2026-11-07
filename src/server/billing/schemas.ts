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

/** The browser sends a plan KEY only. Amounts, plan ids and user ids are never accepted from the request. */
export const billingSchemas = {
  createSubscription: object({ planKey: oneOf(PLAN_KEYS, { required: true }) }),
  verifySubscription: object({
    razorpay_payment_id: pattern(RZP_PAY, 'payment id', 64),
    razorpay_subscription_id: pattern(RZP_SUB, 'subscription id', 64),
    razorpay_signature: pattern(SIG, 'signature', 64)
  }),
  empty: object({})
};
