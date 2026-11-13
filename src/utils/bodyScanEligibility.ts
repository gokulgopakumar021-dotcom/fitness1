import { BodyScanConsent } from '../types/bodyScan';
import type { AgeEligibilityState } from '../context/AgeEligibilityContext';

export const BODY_SCAN_MIN_AGE = 18;

export type BodyScanGate =
  | { status: 'blocked_age_unconfirmed' } // the DATABASE does not (yet) hold this account's 18+ declaration, or could not be asked
  | { status: 'blocked_underage' } // profile age is a number below 18; cannot be overridden by a checkbox
  | { status: 'needs_consent' } //    no valid consent record yet (includes the 18+ confirmation)
  | { status: 'ready'; consent: BodyScanConsent };

/**
 * Body Scan is for users 18 and over. Other Iron Log AI features are unaffected.
 *
 * Eligibility is the account's 18+ declaration read from the DATABASE (`eligibility`). It FAILS CLOSED: anything other than
 * 'declared' (still loading, unknown, or the lookup unavailable, e.g. offline) keeps Body Scan shut. Body Scan itself runs
 * on the device and has no server endpoint, so this is the only place it can be enforced in the browser; the AI endpoints it
 * can feed are separately refused by the server (src/server/security/ageGate.ts). The browser is not a trusted enforcement
 * point on its own, which is why those server checks exist.
 *
 * The profile age is only a self-entered number (the default profile ships with a placeholder). It can block (a profile below
 * 18 is a conservative extra stop) but never grants access: an explicit 18+ confirmation in the consent record is always
 * required as well, and the database declaration above is required before either.
 */
export function getBodyScanGate(
  profileAge: number | undefined,
  consent: BodyScanConsent | null,
  eligibility: AgeEligibilityState
): BodyScanGate {
  if (eligibility !== 'declared') return { status: 'blocked_age_unconfirmed' };
  if (typeof profileAge === 'number' && Number.isFinite(profileAge) && profileAge < BODY_SCAN_MIN_AGE) {
    return { status: 'blocked_underage' };
  }
  if (!consent || !consent.ageConfirmed18Plus || !consent.limitsAcknowledged) {
    return { status: 'needs_consent' };
  }
  return { status: 'ready', consent };
}
