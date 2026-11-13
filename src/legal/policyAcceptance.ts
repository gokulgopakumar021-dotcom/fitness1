import type { SupabaseClient } from '@supabase/supabase-js';
import { LEGAL } from './legalConfig';

/**
 * Terms / Privacy acceptance helpers (Stage 2B).
 *
 * - Sign-up: the browser adds `legal_acceptance` to the sign-up metadata. A strict database trigger (migrations
 *   20261112060134 + 20261113043228) rejects sign-ups without the CURRENT versions and copies them into
 *   public.legal_acceptances with the DATABASE clock. The checkbox is only the UI; the database is the enforcement.
 * - Existing users: a one-time notice calls the acknowledge_legal_update() function. Showing the notice records nothing.
 * - Checking "do I need to show the notice" fails SAFE: any error (table not migrated yet, offline, ...) means "unknown",
 *   and unknown never shows the notice and never blocks the app.
 */
export const LEGAL_ACCEPTANCE_METADATA_KEY = 'legal_acceptance';

export interface PolicyVersions {
  termsVersion: string;
  privacyVersion: string;
}

export const currentPolicyVersions = (): PolicyVersions => ({
  termsVersion: LEGAL.termsVersion,
  privacyVersion: LEGAL.privacyVersion
});

/**
 * Metadata sent with sign-up: the versions shown to the user. The server validates them against its own allowlist
 * (public.legal_policy_versions) and stamps the time with the database clock; no client timestamp is sent or trusted.
 */
export function buildSignupAcceptanceMetadata(): Record<string, unknown> {
  const v = currentPolicyVersions();
  return {
    [LEGAL_ACCEPTANCE_METADATA_KEY]: {
      terms_version: v.termsVersion,
      privacy_version: v.privacyVersion
    }
  };
}

export const SIGNUP_ACCEPTANCE_REQUIRED_MESSAGE = 'Please agree to the Terms of Service and acknowledge the Privacy Policy to create an account.';

export function validateLegalAcceptance(accepted: boolean): string | null {
  return accepted ? null : SIGNUP_ACCEPTANCE_REQUIRED_MESSAGE;
}

export type PolicyNoticeStatus = 'current' | 'needs_notice' | 'unknown';

/** Has this signed-in user a recorded acceptance/acknowledgement of exactly the current versions? */
export async function fetchPolicyNoticeStatus(supabase: SupabaseClient, versions: PolicyVersions = currentPolicyVersions()): Promise<PolicyNoticeStatus> {
  try {
    const { data, error } = await supabase
      .from('legal_acceptances')
      .select('id')
      .eq('terms_version', versions.termsVersion)
      .eq('privacy_version', versions.privacyVersion)
      .limit(1);
    if (error || !Array.isArray(data)) return 'unknown';
    return data.length > 0 ? 'current' : 'needs_notice';
  } catch {
    return 'unknown';
  }
}

/** Records that the signed-in user acknowledged the current versions. Never throws. */
export async function acknowledgeCurrentPolicies(supabase: SupabaseClient, versions: PolicyVersions = currentPolicyVersions()): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('acknowledge_legal_update', {
      p_terms_version: versions.termsVersion,
      p_privacy_version: versions.privacyVersion
    });
    return !error;
  } catch {
    return false;
  }
}

/* ---- "Remind me later": hides the notice for this browser tab/session only. Not an acknowledgement. ---- */

export const POLICY_NOTICE_SNOOZE_KEY = 'ironlog_policy_notice_snoozed';

const snoozeValue = (userId: string, v: PolicyVersions) => `${userId}|${v.termsVersion}|${v.privacyVersion}`;

export function isPolicyNoticeSnoozed(userId: string, versions: PolicyVersions = currentPolicyVersions()): boolean {
  try {
    return sessionStorage.getItem(POLICY_NOTICE_SNOOZE_KEY) === snoozeValue(userId, versions);
  } catch {
    return false;
  }
}

export function snoozePolicyNotice(userId: string, versions: PolicyVersions = currentPolicyVersions()): void {
  try {
    sessionStorage.setItem(POLICY_NOTICE_SNOOZE_KEY, snoozeValue(userId, versions));
  } catch {
    /* ignore: worst case the notice shows again */
  }
}
