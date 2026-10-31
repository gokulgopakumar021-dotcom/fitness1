import { BodyScanConsent } from '../types/bodyScan';

export const BODY_SCAN_MIN_AGE = 18;

export type BodyScanGate =
  | { status: 'blocked_underage' } // profile age is a number below 18; cannot be overridden by a checkbox
  | { status: 'needs_consent' } //    no valid consent record yet (includes the 18+ confirmation)
  | { status: 'ready'; consent: BodyScanConsent };

/**
 * Body Scan is for users 18 and over. Other IronLog AI features are unaffected.
 *
 * The profile age is only a self-entered number (the default profile ships with
 * a placeholder), so it can block but never grants access: an explicit 18+
 * confirmation in the consent record is always required as well.
 */
export function getBodyScanGate(
  profileAge: number | undefined,
  consent: BodyScanConsent | null
): BodyScanGate {
  if (typeof profileAge === 'number' && Number.isFinite(profileAge) && profileAge < BODY_SCAN_MIN_AGE) {
    return { status: 'blocked_underage' };
  }
  if (!consent || !consent.ageConfirmed18Plus || !consent.limitsAcknowledged) {
    return { status: 'needs_consent' };
  }
  return { status: 'ready', consent };
}
