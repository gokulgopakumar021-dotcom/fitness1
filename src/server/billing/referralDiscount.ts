// Creator-referral discount helpers. Server only. No state of its own: eligibility is derived from existing tables
// (referral_attributions + billing_payments) and the full-price acceptance token is stateless and single-use by construction.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanKey } from './config';

/** 20% off the first paid monthly charge. The real discount is applied by Razorpay's offer; this is only for display and checks. */
export const REFERRAL_DISCOUNT_BPS = 2000;
export const REFERRAL_TOKEN_TTL_MS = 10 * 60_000;
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

export const discountedFirstChargePaise = (planAmountPaise: number) => planAmountPaise - Math.round((planAmountPaise * REFERRAL_DISCOUNT_BPS) / 10_000);

export const normaliseReferralCode = (raw: string | undefined): string | undefined => {
  const c = (raw ?? '').trim().toUpperCase();
  return c === '' ? undefined : c;
};

export interface FullPriceBinding {
  userId: string;
  planKey: PlanKey;
  amountPaise: number;
  /** The id of the user's newest billing row when the token was issued ('none' if there is none). Creating any new row changes it, which is what makes the token single-use. */
  latestRowId: string | 'none';
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (secret: string, payload: string) => createHmac('sha256', `${secret}:referral-full-price-v1`).update(payload).digest('base64url');
const body = (b: FullPriceBinding, exp: number) => [b.userId, b.planKey, b.amountPaise, b.latestRowId, exp].join('|');

export function issueFullPriceToken(secret: string, b: FullPriceBinding, nowMs: number): string {
  const payload = body(b, nowMs + REFERRAL_TOKEN_TTL_MS);
  return `${b64(payload)}.${sign(secret, payload)}`;
}

export function verifyFullPriceToken(secret: string, token: string, expected: FullPriceBinding, nowMs: number): boolean {
  const [p, sig] = token.split('.');
  if (!p || !sig || token.split('.').length !== 2) return false;
  let payload: string;
  try {
    payload = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const parts = payload.split('|');
  const exp = Number(parts[4]);
  if (parts.length !== 5 || !Number.isFinite(exp) || nowMs > exp) return false;
  return parts.slice(0, 4).join('|') === body(expected, exp).split('|').slice(0, 4).join('|');
}
