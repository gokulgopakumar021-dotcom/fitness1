import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './apiFetch';
import { BILLING_REFUSAL_EVENT, type BillingRefusalDetail } from './billingGate';

vi.mock('./supabase', () => ({ getSupabase: () => null }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

function listen() {
  const seen: BillingRefusalDetail[] = [];
  const fn = (e: Event) => seen.push((e as CustomEvent<BillingRefusalDetail>).detail);
  window.addEventListener(BILLING_REFUSAL_EVENT, fn);
  return { seen, stop: () => window.removeEventListener(BILLING_REFUSAL_EVENT, fn) };
}

/** Every AI route that a component calls through apiFetch today (must stay in step with src/server/security/endpoints.ts). */
const AI_CALL_SITE_PATHS = [
  '/api/generate-ai-routine', '/api/extract-plan', '/api/ai-form-analyzer', '/api/ai-plan-overload-tuning', '/api/ai-personal-trainer',
  '/api/ai-warmup-generator', '/api/ai-generate-physique', '/api/ai-physique-analysis', '/api/exercise-coach', '/api/ai-recovery-insights',
  '/api/ai-food-parser', '/api/adaptive-coach/explain'
];

describe('apiFetch announces the entitlement gate', () => {
  let stop = () => {};
  afterEach(() => stop());

  it.each(AI_CALL_SITE_PATHS)('402 subscription_required on %s is announced once and the Response is unchanged', async (path) => {
    const l = listen();
    stop = l.stop;
    const res = await apiFetch(path, { method: 'POST', body: '{}' }, { fetchImpl: async () => json(402, { success: false, code: 'subscription_required', error: 'x', entitlement: { state: 'trial_expired' } }) });
    await flush();
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('subscription_required'); // the caller can still read its own body
    expect(l.seen).toEqual([{ kind: 'subscription_required', state: 'trial_expired' }]);
  });

  it('503 billing_unavailable is announced, other 503s (AI busy) are not', async () => {
    const l = listen();
    stop = l.stop;
    await apiFetch('/api/ai-food-parser', {}, { fetchImpl: async () => json(503, { success: false, code: 'billing_unavailable' }) });
    await apiFetch('/api/ai-food-parser', {}, { fetchImpl: async () => json(503, { success: false, code: 'ai_busy' }) });
    await flush();
    expect(l.seen).toEqual([{ kind: 'billing_unavailable' }]);
  });

  it('does not announce billing endpoints, successes, other errors, non-JSON bodies or third-party URLs', async () => {
    const l = listen();
    stop = l.stop;
    const refusal = { success: false, code: 'subscription_required' };
    await apiFetch('/api/billing/status', {}, { fetchImpl: async () => json(402, refusal) });
    await apiFetch('/api/exercise-coach', {}, { fetchImpl: async () => json(200, { success: true }) });
    await apiFetch('/api/exercise-coach', {}, { fetchImpl: async () => json(429, { code: 'rate_limited' }) });
    await apiFetch('/api/exercise-coach', {}, { fetchImpl: async () => new Response('<html>', { status: 402 }) });
    await apiFetch('https://example.com/other', {}, { fetchImpl: async () => json(402, refusal) });
    await flush();
    expect(l.seen).toEqual([]);
  });

  it('survives a fetch that returns a plain object (existing tests mock fetch that way)', async () => {
    const res = await apiFetch('/api/exercise-coach', {}, { fetchImpl: (async () => ({ status: 402, ok: false })) as unknown as typeof fetch });
    expect(res.status).toBe(402);
  });
});
