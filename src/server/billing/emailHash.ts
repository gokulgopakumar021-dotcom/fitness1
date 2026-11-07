import { hmacSha256Hex } from './signature';

/**
 * Normalises an address so trivial variants map to one trial claim: lower-case, plus-tag removed, and for Gmail the dots
 * in the local part removed (googlemail.com is Gmail). Other providers keep their dots. This is a speed bump, not an
 * identity check: see the accepted residual risk in docs/billing/STAGE1_ARCHITECTURE.md section 11.
 */
export function normalizeEmail(email: string): string | undefined {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1 || e.length > 254) return undefined;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return undefined;
  return `${local}@${domain}`;
}

/** HMAC-SHA256 of the normalised email with the server pepper. The plain address is never stored in billing tables. */
export function hashEmail(email: string, pepper: string): string | undefined {
  const n = normalizeEmail(email);
  return n ? hmacSha256Hex(pepper, `trial-claim:v1:${n}`) : undefined;
}
