// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: vi.fn() }; } }));

import { createApp } from '../app';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { createBillingService } from './service';
import { hmacSha256Hex } from './signature';
import { FakeClock, FakeGateway, FakeStore, SECRETS, testBillingConfig } from './testFakes';

let server: Awaited<ReturnType<typeof listen>>;
let store: FakeStore;
let gateway: FakeGateway;

function boot(opts: { configured?: boolean } = {}) {
  const clock = new FakeClock();
  const config = testBillingConfig();
  store = new FakeStore(clock);
  gateway = new FakeGateway(config);
  const service = createBillingService({ config, store, gateway, now: clock.now });
  const billing = opts.configured === false ? { config: testBillingConfig({ RAZORPAY_KEY_SECRET: '' }) } : { service };
  return createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing });
}
const auth = (sub: string, extra: Record<string, unknown> = {}) => ({ authorization: `Bearer ${fakeToken({ sub, email: `${sub}@example.com`, ...extra })}`, 'content-type': 'application/json' });
const post = (path: string, headers: Record<string, string>, body: unknown) => fetch(server.base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(async () => { server = await listen(boot()); });
afterEach(async () => { await server.close(); });

describe('JWT-protected billing routes', () => {
  it('every billing route requires a verified Supabase token', async () => {
    for (const [m, p] of [['GET', '/api/billing/status'], ['GET', '/api/billing/payments'], ['POST', '/api/billing/subscriptions'], ['POST', '/api/billing/subscriptions/verify'], ['POST', '/api/billing/subscriptions/cancel']]) {
      const r = await fetch(server.base + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
      expect(r.status, `${m} ${p}`).toBe(401);
    }
    const bad = await fetch(server.base + '/api/billing/status', { headers: { authorization: `Bearer ${fakeToken({ bad: true })}` } });
    expect(bad.status).toBe(401);
  });
  it('status returns plans from server configuration', async () => {
    const r = await fetch(server.base + '/api/billing/status', { headers: auth('user-a') });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.plans.map((p: { amountPaise: number }) => p.amountPaise)).toEqual([29900, 149900]);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('create accepts a plan key only: unknown plans and client-supplied amounts/ids are ignored or rejected', async () => {
    expect((await post('/api/billing/subscriptions', auth('user-a'), { planKey: 'lifetime' })).status).toBe(400);
    expect((await post('/api/billing/subscriptions', auth('user-a'), {})).status).toBe(400);
    const r = await post('/api/billing/subscriptions', auth('user-a'), { planKey: 'monthly', amount: 1, amountPaise: 1, planId: 'plan_Evil', userId: 'user-b', total_count: 1 });
    expect(r.status).toBe(200);
    expect(gateway.created[0]).toMatchObject({ plan_id: 'plan_MonthlyTest01', total_count: 120 });
    expect(gateway.created[0].notes.user_id).toBe('user-a');
    expect(store.subs[0].user_id).toBe('user-a');
    expect(store.subs[0].amount_paise).toBe(29900);
  });
  it('the unverified-email check applies even when the platform does not require verified email', async () => {
    const r = await post('/api/billing/subscriptions', auth('user-a', { verified: false }), { planKey: 'monthly' });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('email_not_verified');
    expect(gateway.created).toHaveLength(0);
  });
  it('cross-user: user B cannot verify, cancel or list user A\'s billing', async () => {
    const created = await (await post('/api/billing/subscriptions', auth('user-a'), { planKey: 'monthly' })).json();
    const id = created.subscriptionId as string;
    gateway.authorize(id, 'pay_Auth00001', 500);
    const sig = hmacSha256Hex(SECRETS.keySecret, `pay_Auth00001|${id}`);
    const v = await post('/api/billing/subscriptions/verify', auth('user-b'), { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig });
    expect(v.status).toBe(404);
    expect((await post('/api/billing/subscriptions/cancel', auth('user-b'), {})).status).toBe(404);
    expect((await (await fetch(server.base + '/api/billing/payments', { headers: auth('user-b') })).json()).payments).toEqual([]);
    expect(store.subs[0].status).toBe('created');
    // the owner can
    const ok = await post('/api/billing/subscriptions/verify', auth('user-a'), { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig });
    expect(ok.status).toBe(200);
  });
  it('verify rejects malformed ids and signatures at validation', async () => {
    const r = await post('/api/billing/subscriptions/verify', auth('user-a'), { razorpay_payment_id: 'x', razorpay_subscription_id: 'y', razorpay_signature: 'z' });
    expect(r.status).toBe(400);
  });
  it('create is rate limited per user', async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await post('/api/billing/subscriptions', auth('user-c'), { planKey: 'monthly' })).status;
    expect(last).toBe(429);
  });
  it('no response from any billing route contains a secret', async () => {
    const texts: string[] = [];
    for (const p of ['/api/billing/status', '/api/billing/payments']) texts.push(await (await fetch(server.base + p, { headers: auth('user-a') })).text());
    texts.push(await (await post('/api/billing/subscriptions', auth('user-a'), { planKey: 'monthly' })).text());
    texts.push(await (await post('/api/billing/subscriptions/verify', auth('user-a'), { razorpay_payment_id: 'pay_Zzzzzz01', razorpay_subscription_id: 'sub_Zzzzzz01', razorpay_signature: 'a'.repeat(64) })).text());
    for (const t of texts) for (const s of Object.values(SECRETS)) expect(t).not.toContain(s);
  });
  it('existing non-billing routes are unaffected', async () => {
    const r = await fetch(server.base + '/api/health');
    expect(r.status).toBe(200);
  });
});

describe('billing not configured', () => {
  it('JWT routes answer a safe 503 and the webhook never processes anything', async () => {
    await server.close();
    server = await listen(boot({ configured: false }));
    const r = await fetch(server.base + '/api/billing/status', { headers: auth('user-a') });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe('billing_unavailable');
    const w = await post('/api/billing/webhook', { 'content-type': 'application/json', 'x-razorpay-signature': 'a'.repeat(64), 'x-razorpay-event-id': 'evt_1' }, '{"event":"x"}');
    expect(w.status).toBe(503);
  });
});

describe('POST /api/billing/webhook (raw body, no JWT)', () => {
  const raw = '{"entity":"event",  "event":"subscription.charged","created_at":1793000000,"payload":{"subscription":{"entity":{"id":"sub_Unknown0001"}}}}\n';
  const hdr = (signature: string, id = 'evt_http_1') => ({ 'content-type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': id });

  it('accepts a correctly signed body over the exact bytes, without a Supabase token', async () => {
    const r = await post('/api/billing/webhook', hdr(hmacSha256Hex(SECRETS.webhookSecret, raw)), raw);
    expect(r.status).toBe(200);
    expect(store.events.get('evt_http_1')!.status).toBe('ignored'); // unknown subscription: acknowledged, not retried
  });
  it('rejects a bad or missing signature with 400 and writes nothing', async () => {
    expect((await post('/api/billing/webhook', hdr('b'.repeat(64)), raw)).status).toBe(400);
    expect((await post('/api/billing/webhook', { 'content-type': 'application/json', 'x-razorpay-event-id': 'evt_2' }, raw)).status).toBe(400);
    expect(store.events.size).toBe(0);
  });
  it('a signature computed over re-serialised JSON does not verify (raw bytes are what count)', async () => {
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect((await post('/api/billing/webhook', hdr(hmacSha256Hex(SECRETS.webhookSecret, reserialised)), raw)).status).toBe(400);
  });
  it('a non-JSON content type cannot be verified and fails closed', async () => {
    const r = await post('/api/billing/webhook', { ...hdr(hmacSha256Hex(SECRETS.webhookSecret, raw)), 'content-type': 'text/plain' }, raw);
    expect(r.status).toBe(400);
  });
  it('duplicate deliveries are acknowledged', async () => {
    const h = hdr(hmacSha256Hex(SECRETS.webhookSecret, raw), 'evt_dup');
    await post('/api/billing/webhook', h, raw);
    const again = await post('/api/billing/webhook', h, raw);
    expect(again.status).toBe(200);
    expect((await again.json()).result).toBe('duplicate');
  });
  it('is rate limited per IP', async () => {
    await server.close();
    const clock = new FakeClock();
    const config = testBillingConfig();
    const st = new FakeStore(clock);
    const app = createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing: { service: createBillingService({ config, store: st, gateway: new FakeGateway(config), now: clock.now }) } });
    server = await listen(app);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await post('/api/billing/webhook', hdr('c'.repeat(64), `evt_${i}`), raw)).status;
    expect(last).toBe(429);
  });
  it('GET on the webhook path is not a webhook: it needs authentication like any other /api route', async () => {
    expect((await fetch(server.base + '/api/billing/webhook')).status).toBe(401);
  });
  it('does not weaken JSON parsing for other routes: invalid JSON elsewhere still 400s, valid JSON still parses', async () => {
    expect((await post('/api/billing/subscriptions', auth('user-a'), '{bad')).status).toBe(400);
    expect((await post('/api/billing/subscriptions', auth('user-a'), { planKey: 'annual' })).status).toBe(200);
  });
});
