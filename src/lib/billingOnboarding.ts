import type { User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

/**
 * Post-signup billing onboarding: UI routing state only.
 *
 * The flag lives in the account's Supabase `user_metadata`, so it follows the account across devices and survives a refresh.
 * It is set to `pending` at sign-up (AuthContext.signUp) and to `done` when the person finishes or skips onboarding.
 * Accounts created before this feature have no flag, so they are never routed into onboarding.
 *
 * `user_metadata` is writable by the signed-in person, so this flag is NEVER used to grant or deny anything. Access, trial
 * eligibility, prices and trial length are decided by the server (/api/billing/*); at worst, editing this flag shows or skips a
 * screen. Trial history is a server-side record keyed by account and email hash, so it cannot be reset from here.
 */
export const BILLING_ONBOARDING_KEY = 'billing_onboarding';
export type BillingOnboardingFlag = 'pending' | 'done';

/** Metadata attached to the sign-up request. */
export const BILLING_ONBOARDING_PENDING_DATA = { [BILLING_ONBOARDING_KEY]: 'pending' } as const;

export function readOnboardingFlag(user: Pick<User, 'user_metadata'> | null | undefined): BillingOnboardingFlag | null {
  const v = user?.user_metadata?.[BILLING_ONBOARDING_KEY];
  return v === 'pending' || v === 'done' ? v : null;
}

/** Persists "onboarding finished or skipped" for this account. Returns false (never throws) if it could not be saved. */
export async function markBillingOnboardingDone(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.auth.updateUser({ data: { [BILLING_ONBOARDING_KEY]: 'done' } });
    return !error;
  } catch {
    return false;
  }
}
