import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 18+ eligibility helpers (Stage 2D / Stage 2). The whole platform is for adults.
 *
 * This is a SELF-DECLARATION, not verified identity or verified age, and NO date of birth or age is collected.
 * The browser only ever sends a positive declaration; the DATABASE decides whether it is acceptable (strict trigger and
 * Before User Created hook, migration 20261113043241) and stamps it with its own clock. The browser's idea of the
 * user's age (profile.age, localStorage, sessionStorage) is never consulted for eligibility.
 */
export const AGE_DECLARATION_METADATA_KEY = 'age_declaration';
export const MINIMUM_AGE = 18;

export const AGE_CONFIRMATION_REQUIRED_MESSAGE = 'Please confirm that you are 18 years of age or older to create an account.';

/** Sent with sign-up. Only a literal `true` is accepted server-side; the string "true" or any other shape is rejected. */
export function buildSignupAgeMetadata(): Record<string, unknown> {
  return { [AGE_DECLARATION_METADATA_KEY]: { adult_18_plus: true } };
}

export function validateAgeConfirmation(confirmed: boolean): string | null {
  return confirmed ? null : AGE_CONFIRMATION_REQUIRED_MESSAGE;
}

/**
 * declared    : the database has this signed-in user's 18+ declaration
 * unknown     : the lookup worked and there is NO declaration (every account that pre-dates the feature)
 * unavailable : the lookup could not be completed (offline, timeout, migration not applied yet). NEVER treated as eligible
 *               for anything that must be protected (Body Scan, and the server refuses API calls when it cannot tell).
 */
export type AgeEligibilityStatus = 'declared' | 'unknown' | 'unavailable';

const LOOKUP_TIMEOUT_MS = 8_000;

/** Asks the database (caller's own session only). Never throws. */
export async function fetchAgeEligibility(supabase: SupabaseClient): Promise<AgeEligibilityStatus> {
  try {
    const call = supabase.rpc('get_my_age_eligibility');
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), LOOKUP_TIMEOUT_MS));
    const res = await Promise.race([call, timeout]);
    if (res === 'timeout') return 'unavailable';
    if (res.error) return 'unavailable';
    if (res.data === 'declared') return 'declared';
    if (res.data === 'unknown') return 'unknown';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Records the signed-in user's own declaration (existing accounts). Never throws; true only if the database accepted it. */
export async function declareAdult(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('declare_adult_18_plus');
    return !error;
  } catch {
    return false;
  }
}
