import { beforeEach, describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ client: null as null | { auth: { updateUser: ReturnType<typeof vi.fn> } } }));
vi.mock('./supabase', () => ({ getSupabase: () => sb.client }));

import { BILLING_ONBOARDING_PENDING_DATA, markBillingOnboardingDone, readOnboardingFlag } from './billingOnboarding';

describe('billing onboarding flag', () => {
  beforeEach(() => {
    sb.client = { auth: { updateUser: vi.fn(async () => ({ error: null })) } };
  });

  it('new sign-ups are tagged pending; only pending/done are ever read back', () => {
    expect(BILLING_ONBOARDING_PENDING_DATA).toEqual({ billing_onboarding: 'pending' });
    expect(readOnboardingFlag({ user_metadata: { billing_onboarding: 'pending' } })).toBe('pending');
    expect(readOnboardingFlag({ user_metadata: { billing_onboarding: 'done' } })).toBe('done');
    expect(readOnboardingFlag({ user_metadata: {} })).toBeNull(); // accounts that existed before this feature
    expect(readOnboardingFlag({ user_metadata: { billing_onboarding: 'anything-else' } })).toBeNull();
    expect(readOnboardingFlag(null)).toBeNull();
  });

  it('marks done by writing only the flag', async () => {
    expect(await markBillingOnboardingDone()).toBe(true);
    expect(sb.client!.auth.updateUser).toHaveBeenCalledWith({ data: { billing_onboarding: 'done' } });
  });

  it('reports failure instead of throwing', async () => {
    sb.client!.auth.updateUser.mockResolvedValueOnce({ error: { message: 'x' } });
    expect(await markBillingOnboardingDone()).toBe(false);
    sb.client!.auth.updateUser.mockRejectedValueOnce(new Error('offline'));
    expect(await markBillingOnboardingDone()).toBe(false);
    sb.client = null;
    expect(await markBillingOnboardingDone()).toBe(false);
  });
});
