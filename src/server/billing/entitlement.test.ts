// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate }; } }));

import { createApp } from '../app';
import { VALID } from '../security/aiRequestFixtures';
import { MemoryQuotaStore } from '../security/quota';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { createBillingService } from './service';
import { FakeClock, FakeGateway, FakeStore, testBillingConfig } from './testFakes';

let server: Awaited<ReturnType<typeof listen>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function boot(enforcement: string) {
  const clock = new FakeClock();
  const config = testBillingConfig({ BILLING_ENFORCEMENT: enforcement });
  const store = new FakeStore(clock);
  const service = createBillingService({ config, store, gateway: new FakeGateway(config), now: clock.now });
  const quotaStore = new MemoryQuotaStore();
  const consume = vi.spyOn(quotaStore, 'consume');
  server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), quotaStore, billing: { config, service } }));
  return { store, consume };
}
const hdr = (sub = 'user-a') => ({ authorization: `Bearer ${fakeToken({ sub })}`, 'content-type': 'application/json' });
const ai = () => fetch(server!.base + '/api/generate-plan', { method: 'POST', headers: hdr(), body: JSON.stringify(VALID['POST /generate-plan']) });
const grant = (store: FakeStore) => store.subs.push({ id: 's1', user_id: 'user-a', status: 'authenticated', trial_end_at: new Date(Date.now() + 1e9).toISOString(), plan_key: 'monthly' } as never);

describe('entitlement gate', () => {
  it('off (default): no billing lookup, AI route behaves as before', async () => {
    const { store, consume } = await boot('off');
    const r = await ai();
    expect(r.status).not.toBe(402);
    expect(store.calls).not.toContain('entitlement');
    expect(consume).toHaveBeenCalled();
  });
  it('on: a user without trial or subscription gets 402 and consumes no quota', async () => {
    const { consume } = await boot('on');
    const r = await ai();
    expect(r.status).toBe(402);
    const j = await r.json();
    expect(j).toMatchObject({ code: 'subscription_required', entitlement: { state: 'none' } });
    expect(JSON.stringify(j)).not.toMatch(/sub_|plan_|pay_/);
    expect(consume).not.toHaveBeenCalled();
  });
  it('on: an active trial passes the gate', async () => {
    const { store, consume } = await boot('on');
    grant(store);
    const r = await ai();
    expect(r.status).not.toBe(402);
    expect(consume).toHaveBeenCalled();
  });
  it('on: fails closed with 503 when entitlement cannot be determined', async () => {
    const { store, consume } = await boot('on');
    store.failNext.entitlement = true;
    expect((await ai()).status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
  });
  it('on: non-AI and billing routes are never gated', async () => {
    await boot('on');
    expect((await fetch(server!.base + '/api/billing/status', { headers: hdr() })).status).toBe(200);
    expect((await fetch(server!.base + '/api/health')).status).toBe(200);
  });
  it('shadow: would-be denials are allowed through, even if the lookup fails', async () => {
    const { store } = await boot('shadow');
    expect((await ai()).status).not.toBe(402);
    store.failNext.entitlement = true;
    expect((await (await ai()).json()).code).not.toBe('billing_unavailable'); // the route may 5xx on the mocked model; the gate must not
  });
  it('on: cross-user: user B does not inherit user A\'s trial', async () => {
    const { store } = await boot('on');
    grant(store);
    const r = await fetch(server!.base + '/api/generate-plan', { method: 'POST', headers: hdr('user-b'), body: JSON.stringify(VALID['POST /generate-plan']) });
    expect(r.status).toBe(402);
  });
});
