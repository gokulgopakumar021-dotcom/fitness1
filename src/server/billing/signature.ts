import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const HEX = /^[0-9a-f]{64}$/i;

export const hmacSha256Hex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Constant-time comparison of two hex digests. Anything that is not a 64-char hex string is rejected without comparing. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX.test(a) || !HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Razorpay Checkout result for a Subscription: hmac_sha256(razorpay_payment_id + "|" + subscription_id, key_secret).
 * `subscriptionId` MUST come from our own database row, never from the browser, so a signature issued for one
 * subscription cannot be replayed against another.
 */
export function verifyPaymentSignature(args: { paymentId: string; subscriptionId: string; signature: string; keySecret: string }): boolean {
  const { paymentId, subscriptionId, signature, keySecret } = args;
  if (!paymentId || !subscriptionId || !keySecret || typeof signature !== 'string') return false;
  return safeEqualHex(hmacSha256Hex(keySecret, `${paymentId}|${subscriptionId}`), signature);
}

/** Webhook: hmac_sha256(raw request body, webhook secret) in X-Razorpay-Signature. `rawBody` must be the exact received bytes. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || !secret || typeof signature !== 'string') return false;
  return safeEqualHex(hmacSha256Hex(secret, rawBody), signature.trim());
}
