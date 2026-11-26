// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate }; } }));

import { createApp } from '../app';
import { VALID } from '../security/aiRequestFixtures';
import { ENDPOINTS } from '../security/endpoints';
import { MemoryQuotaStore } from '../security/quota';
import { MemoryRateStore } from '../security/rateLimit';
import { fakeToken, listen, mockVerifier, testConfig } from '../security/testUtils';
import { loadBillingConfig } from './config';
import { createBillingService } from './service';
import { hmacSha256Hex } from './signature';
import { FakeClock, FakeGateway, FakeStore, SECRETS, TEST_ENV, testBillingConfig } from './testFakes';

/**
 * Premium access control, end to end. The question every test answers: "does a request reach the premium (AI) route?"
 *  - A: BILLING_ENFORCEMENT fails closed (unset / empty / invalid = on; only explicit off|shadow relax it).
 *  - B: the REAL default (variable deleted, no billing config injected) never reaches the model.
 *  - C: every AI route refuses direct API calls without entitlement, whatever the client claims.
 *  - D: each billing state decides access through the REAL billing_get_entitlement() SQL (PGlite, real migrations), via real HTTP.
 *  - E: a ₹5 authentication payment or browser callback alone never grants access; only Razorpay-confirmed status does.
 * NOT covered: the live Supabase project, Razorpay itself, and the production Vercel environment.
 */

let server: Awaited<ReturnType<typeof listen>> | undefined;
const savedEnforcement = process.env.BILLING_ENFORCEMENT;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (savedEnforcement === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = savedEnforcement;
  generate.mockReset();
});

const hdr = (sub: string, extra: Record<string, unknown> = {}) => ({ authorization: `Bearer ${fakeToken({ sub, email: `${sub}@example.com`, ...extra })}`, 'content-type': 'application/json' });
const callAi = (sub: string, route = 'POST /generate-plan', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const [method, path] = route.split(' ');
  return fetch(server!.base + '/api' + path, { method, headers: { ...hdr(sub, extra), ...headers }, body: JSON.stringify(VALID[route]) });
};
const AI_ROUTES = Object.entries(ENDPOINTS).filter(([, p]) => p.ai).map(([k]) => k);
/** Reached the route (the mocked model may still make the route itself answer 5xx; what matters is the gate let it through). */
const passedGate = async (r: Response) => {
  if (r.status === 402) return false;
  const j = await r.clone().json().catch(() => ({}));
  return j.code !== 'subscription_required' && j.code !== 'billing_unavailable';
};

// ------------------------------------------------------------------------------------------------------------- A: default
describe('A: BILLING_ENFORCEMENT fails closed', () => {
  it('unset, empty, whitespace and unrecognised values all ENFORCE', () => {
    const base = { ...TEST_ENV };
    expect(loadBillingConfig(base).enforcement).toBe('on');
    for (const raw of ['', '   ', 'enabled', 'true', '1', 'ofF!', 'maybe']) expect(loadBillingConfig({ ...base, BILLING_ENFORCEMENT: raw }).enforcement, JSON.stringify(raw)).toBe('on');
    expect(loadBillingConfig({ ...base, BILLING_ENFORCEMENT: 'enabled' }).problems).toContain('BILLING_ENFORCEMENT must be off, shadow or on.');
  });
  it('only an explicit off or shadow relaxes it (case and spaces tolerated)', () => {
    for (const [raw, want] of [['off', 'off'], [' OFF ', 'off'], ['shadow', 'shadow'], ['Shadow', 'shadow'], ['on', 'on']] as const) {
      expect(loadBillingConfig({ ...TEST_ENV, BILLING_ENFORCEMENT: raw }).enforcement, raw).toBe(want);
    }
  });
  it('plans, prices and trial length are unchanged', () => {
    const c = loadBillingConfig(TEST_ENV);
    expect([c.plans.monthly.amountPaise, c.plans.annual.amountPaise, c.trialDays]).toEqual([39900, 149900, 3]);
  });
});

// ------------------------------------------------------------------------------------------------------------- B: real default
describe('B: the real default, with no billing config injected', () => {
  const boot = () => listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), quotaStore: new MemoryQuotaStore() }));

  it.each([['unset', undefined], ['empty', ''], ['invalid', 'banana']])('%s: premium routes are refused and the model is never called', async (_n, value) => {
    if (value === undefined) delete process.env.BILLING_ENFORCEMENT;
    else process.env.BILLING_ENFORCEMENT = value;
    server = await boot();
    const r = await callAi('user-a');
    expect([402, 503]).toContain(r.status); // billing is not configured here, so the gate fails closed with 503
    expect(await passedGate(r)).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(['off', 'shadow'])('explicit %s still lets development reach the route', async (value) => {
    process.env.BILLING_ENFORCEMENT = value;
    server = await boot();
    expect(await passedGate(await callAi('user-a'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------- C: direct API
describe('C: direct API access without a premium entitlement', () => {
  it('every AI route (including exercise-coach, ai-food-parser and both Dream Physique routes) answers 402 and consumes no quota', async () => {
    expect(AI_ROUTES).toEqual(expect.arrayContaining(['POST /exercise-coach', 'POST /ai-food-parser', 'POST /ai-generate-physique', 'POST /ai-physique-analysis', 'POST /ai-personal-trainer']));
    const clock = new FakeClock();
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'on' });
    const service = createBillingService({ config, store: new FakeStore(clock), gateway: new FakeGateway(config), now: clock.now });
    const quotaStore = new MemoryQuotaStore();
    const consume = vi.spyOn(quotaStore, 'consume');
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), quotaStore, billing: { config, service } }));
    for (const route of AI_ROUTES) {
      const r = await callAi('user-a', route);
      expect(r.status, route).toBe(402);
      expect(await r.json(), route).toMatchObject({ code: 'subscription_required', entitlement: { state: 'none' } });
    }
    expect(generate).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
  it('nothing the client sends (token metadata, headers) grants premium', async () => {
    const clock = new FakeClock();
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'on' });
    const service = createBillingService({ config, store: new FakeStore(clock), gateway: new FakeGateway(config), now: clock.now });
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing: { config, service } }));
    const claims = {
      user_metadata: { plan: 'annual', premium: true, subscription_status: 'active', trial_started: true, trialing: true },
      app_metadata: { role: 'premium', subscription: 'active', entitlement: { hasAccess: true } },
      premium: true, subscriptionStatus: 'active'
    };
    const r = await callAi('user-a', 'POST /ai-personal-trainer', claims, { 'x-subscription-status': 'active', 'x-premium': 'true', 'x-entitlement': 'trialing' });
    expect(r.status).toBe(402);
    expect(generate).not.toHaveBeenCalled();
  });
  it('billing routes and health stay reachable so a locked-out user can subscribe or recover', async () => {
    const clock = new FakeClock();
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'on' });
    const service = createBillingService({ config, store: new FakeStore(clock), gateway: new FakeGateway(config), now: clock.now });
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), billing: { config, service } }));
    expect((await fetch(server.base + '/api/billing/status', { headers: hdr('user-a') })).status).toBe(200);
    expect((await fetch(server.base + '/api/health')).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------------------- D: states via REAL SQL
const dir = resolve(import.meta.dirname, '../../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
let pg: PGlite;
let n = 0;

/** A store whose entitlement decision is the real billing_get_entitlement() SQL; everything else is the in-memory fake. */
class SqlEntitlementStore extends FakeStore {
  async getEntitlement(userId: string, graceHours = 0) {
    const r = await pg.query('select * from public.billing_get_entitlement($1::uuid,$2)', [userId, graceHours]);
    return r.rows[0] as never;
  }
}

async function seedUser(setup: string | null, opts: { amount?: number; authPayment?: boolean } = {}) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  await pg.exec(`insert into auth.users (id, email) values ('${id}','u${n}@example.com')`);
  if (setup !== null) {
    const b = await pg.query<{ subscription_id: string }>(`select * from public.billing_begin_subscription($1::uuid,$2,'monthly','plan_monthly','monthly',$3,3,30)`, [id, `hash-user-${n}-0123456789abcdef`, opts.amount ?? 39900]);
    const sid = b.rows[0].subscription_id;
    await pg.exec(`update public.billing_subscriptions set razorpay_subscription_id='sub_T${n}', ${setup} where id='${sid}'`);
    if (opts.authPayment) {
      await pg.exec(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise) values ('${id}','${sid}','pay_T${n}','authorization','captured',500)`);
    }
  }
  return id;
}

describe('D: each billing state, decided by the real SQL, enforced over HTTP', () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const f of ['20261027051824_auth_profiles.sql', '20261030053401_delete_own_account.sql', '20261106052859_billing_core.sql', '20261106071858_billing_deletion_refund.sql']) await pg.exec(read(f));
  }, 60000);
  afterAll(async () => { await pg?.close(); });

  const bootSql = async () => {
    const clock = new FakeClock();
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'on' });
    const service = createBillingService({ config, store: new SqlEntitlementStore(clock), gateway: new FakeGateway(config), now: clock.now });
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), quotaStore: new MemoryQuotaStore(), billing: { config, service } }));
  };

  const FUTURE = `now() + interval '2 days'`;
  const PAST = `now() - interval '1 day'`;
  type Row = [name: string, setup: string | null, allowed: boolean, state: string, opts?: { authPayment?: boolean }];
  const rows: Row[] = [
    ['new account: no trial, no payment', null, false, 'none'],
    ['subscription created but checkout never completed', `status='created'`, false, 'none'],
    ['₹5 authentication payment recorded, subscription not authenticated by Razorpay', `status='created'`, false, 'none', { authPayment: true }],
    ['trial successfully started (Razorpay authenticated, trial running)', `status='authenticated', trial_start_at = now() - interval '1 hour', trial_end_at = ${FUTURE}`, true, 'trialing'],
    ['expired trial, never paid', `status='authenticated', trial_start_at = now() - interval '4 days', trial_end_at = ${PAST}`, false, 'payment_pending'],
    ['trial cancelled before first payment', `status='cancelled', paid_count=0, access_ends_at = ${PAST}`, false, 'trial_expired'],
    ['paid and active', `status='active', paid_count=1, current_period_start = ${PAST}, current_period_end = now() + interval '29 days'`, true, 'active'],
    ['paid period over, renewal not confirmed', `status='active', paid_count=1, current_period_end = now() - interval '1 minute'`, false, 'payment_pending'],
    ['renewal payment pending (no grace configured)', `status='pending', paid_count=1, current_period_end = now() - interval '1 hour'`, false, 'payment_pending'],
    ['failed payment (halted)', `status='halted', paid_count=1`, false, 'payment_failed'],
    ['cancelled but paid through a future date', `status='cancelled', paid_count=1, cancelled_at = now(), access_ends_at = now() + interval '10 days'`, true, 'cancelled_active'],
    ['active with cancellation requested, still inside paid period', `status='active', paid_count=1, current_period_end = now() + interval '10 days', cancel_requested_at = now(), cancel_at_cycle_end = true, access_ends_at = now() + interval '10 days'`, true, 'cancelled_active'],
    ['cancelled, paid period over', `status='cancelled', paid_count=1, cancelled_at = now(), access_ends_at = now() - interval '1 second', current_period_end = now() - interval '1 second'`, false, 'cancelled'],
    ['completed subscription', `status='completed', paid_count=10`, false, 'expired']
  ];

  it.each(rows)('%s', async (_name, setup, allowed, state, opts) => {
    await bootSql();
    const user = await seedUser(setup, opts);
    for (const route of ['POST /ai-personal-trainer', 'POST /ai-food-parser', 'POST /exercise-coach']) {
      const r = await callAi(user, route);
      if (allowed) expect(await passedGate(r), `${route} should pass for ${state}`).toBe(true);
      else {
        expect(r.status, `${route} should be refused for ${state}`).toBe(402);
        expect(await r.json()).toMatchObject({ code: 'subscription_required', entitlement: { state } });
      }
    }
    if (!allowed) expect(generate).not.toHaveBeenCalled();
  });

  it('existing subscriber recovery: access returns only when Razorpay confirms a new paid period; the stored (grandfathered) price is untouched', async () => {
    await bootSql();
    const user = await seedUser(`status='pending', paid_count=3, current_period_end = now() - interval '1 hour'`, { amount: 29900 });
    expect((await callAi(user)).status).toBe(402);
    expect((await fetch(server!.base + '/api/billing/status', { headers: hdr(user) })).status).toBe(200); // billing stays reachable while locked out
    await pg.exec(`update public.billing_subscriptions set status='active', paid_count=4, current_period_end = now() + interval '30 days' where user_id='${user}'`); // what a verified Razorpay charge does
    expect(await passedGate(await callAi(user))).toBe(true);
    const row = (await pg.query<{ amount_paise: number; plan_key: string }>(`select amount_paise, plan_key from public.billing_subscriptions where user_id='${user}'`)).rows[0];
    expect(row).toMatchObject({ amount_paise: 29900, plan_key: 'monthly' });
  });

  it('one user\'s paid subscription never unlocks another user', async () => {
    await bootSql();
    await seedUser(`status='active', paid_count=1, current_period_end = now() + interval '29 days'`);
    const other = await seedUser(null);
    expect((await callAi(other)).status).toBe(402);
  });
});

// ------------------------------------------------------------------------------------------------------------- E: ₹5 authentication payment / browser callback
describe('E: the authentication payment or browser callback alone never grants premium', () => {
  it('only Razorpay-confirmed authenticated status starts the trial and unlocks access', async () => {
    const clock = new FakeClock();
    const config = testBillingConfig({ BILLING_ENFORCEMENT: 'on' });
    const store = new FakeStore(clock);
    const gateway = new FakeGateway(config);
    const service = createBillingService({ config, store, gateway, now: clock.now });
    server = await listen(createApp({ config: testConfig(), verifyToken: mockVerifier, rateStore: new MemoryRateStore(), quotaStore: new MemoryQuotaStore(), billing: { config, service } }));
    const post = (path: string, body: unknown) => fetch(server!.base + path, { method: 'POST', headers: hdr('user-a'), body: JSON.stringify(body) });

    // Account exists, plan chosen, checkout opened: nothing is unlocked.
    const created = await (await post('/api/billing/subscriptions', { planKey: 'monthly' })).json();
    const id = created.subscriptionId as string;
    expect(created.authorization).toMatchObject({ amountPaise: 500 });
    expect((await callAi('user-a')).status).toBe(402);

    // Forged callback: rejected, nothing unlocked.
    const forged = await post('/api/billing/subscriptions/verify', { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: 'a'.repeat(64) });
    expect(forged.status).toBe(400);
    expect((await callAi('user-a')).status).toBe(402);

    // Genuinely signed callback, but Razorpay has NOT confirmed the authorization: still nothing.
    const sig = hmacSha256Hex(SECRETS.keySecret, `pay_Auth00001|${id}`);
    const early = await post('/api/billing/subscriptions/verify', { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig });
    expect(early.status).toBe(409);
    expect((await callAi('user-a')).status).toBe(402);

    // Razorpay confirms the authorization (the ₹5 authentication payment succeeded): the server starts the trial, and only now premium unlocks.
    gateway.authorize(id, 'pay_Auth00001', 500);
    const ok = await post('/api/billing/subscriptions/verify', { razorpay_payment_id: 'pay_Auth00001', razorpay_subscription_id: id, razorpay_signature: sig });
    expect(ok.status).toBe(200);
    expect(store.subs[0].status).toBe('authenticated');
    expect(await passedGate(await callAi('user-a'))).toBe(true);

    // Trial runs out without a charge: access ends.
    clock.advance(4 * 24 * 3600 * 1000);
    expect((await callAi('user-a')).status).toBe(402);
  });
});
