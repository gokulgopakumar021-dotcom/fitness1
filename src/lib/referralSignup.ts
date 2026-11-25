import { attributeReferral, BillingApiError } from './billingApi';

/**
 * Creator code captured at sign-up (a `?ref=CODE` link or the optional field on the Create account form).
 *
 * The code stays in this browser only, with an expiry, until the person has a verified signed-in session. Then ONE attempt is sent to
 * the server (POST /api/billing/referral/attribute). The server never says whether a code was accepted, so neither does this module:
 * a wrong, unknown or inactive code simply does nothing, and it never blocks sign-up or sign-in. The stored code is cleared after any
 * answer from the server; it is kept only when the attempt could not be made (offline, 5xx, not yet verified), until it expires.
 */
export const REFERRAL_STORAGE_KEY = 'ironlog.pendingCreatorCode';
export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFERRAL_QUERY_PARAM = 'ref';
/** Same rule as the server: uppercase letters and digits, 4 to 20 characters. */
export const CREATOR_CODE_PATTERN = /^[A-Z0-9]{4,20}$/;
/** How long the app waits for the attempt before it carries on (the attempt itself is not cancelled). */
export const REFERRAL_ATTEMPT_WAIT_MS = 4000;

/** Uppercases and keeps letters and digits only. Returns undefined unless the result is a well-formed code. */
export function cleanCreatorCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CREATOR_CODE_PATTERN.test(c) && c.length === raw.trim().length ? c : undefined;
}

/** Field input as typed: uppercase letters and digits only, at most 20 characters. */
export const sanitiseCreatorInput = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

const store = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function storePendingCreatorCode(raw: unknown, nowMs: number = Date.now()): boolean {
  const code = cleanCreatorCode(raw);
  const ls = store();
  if (!code || !ls) return false;
  try {
    ls.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, exp: nowMs + REFERRAL_TTL_MS }));
    return true;
  } catch {
    return false;
  }
}

export function readPendingCreatorCode(nowMs: number = Date.now()): string | undefined {
  const ls = store();
  if (!ls) return undefined;
  try {
    const raw = ls.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { code?: unknown; exp?: unknown };
    if (typeof v.exp !== 'number' || nowMs > v.exp) {
      ls.removeItem(REFERRAL_STORAGE_KEY);
      return undefined;
    }
    const code = cleanCreatorCode(v.code);
    if (!code) ls.removeItem(REFERRAL_STORAGE_KEY);
    return code;
  } catch {
    try { ls.removeItem(REFERRAL_STORAGE_KEY); } catch { /* ignore */ }
    return undefined;
  }
}

export function clearPendingCreatorCode(): void {
  try { store()?.removeItem(REFERRAL_STORAGE_KEY); } catch { /* ignore */ }
}

/** Reads `?ref=CODE` from the current URL and stores it when well formed. Anything else is ignored. The URL is left as it is. */
export function captureReferralFromUrl(search: string = typeof window !== 'undefined' ? window.location.search : '', nowMs: number = Date.now()): void {
  try {
    const raw = new URLSearchParams(search).get(REFERRAL_QUERY_PARAM);
    if (raw !== null) storePendingCreatorCode(raw.trim(), nowMs);
  } catch { /* ignore */ }
}

/**
 * One attempt for the stored code. Never throws. Resolves when the attempt is done. The code is cleared whenever the server answered
 * (success or a 4xx), and kept when the server could not be reached or failed (network, 5xx) or the email is not verified yet.
 */
export async function attemptPendingReferral(): Promise<void> {
  const code = readPendingCreatorCode();
  if (!code) return;
  try {
    await attributeReferral(code);
    clearPendingCreatorCode();
  } catch (e) {
    if (e instanceof BillingApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429 && e.code !== 'email_not_verified') clearPendingCreatorCode();
  }
}
