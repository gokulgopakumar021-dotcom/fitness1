// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Stage 1 (DRAFT migration, not applied to any live database). Runs the REAL `20261106000000_billing_core.sql` in an
 * in-process Postgres with a simulated auth schema and Supabase roles, and checks the access model and the server-side
 * decision functions:
 *  - clients can read only their own subscription/payment rows (and only display columns), can write nothing, and cannot
 *    see trial claims or webhook events at all; anon sees nothing,
 *  - the SECURITY DEFINER functions are executable by service_role only,
 *  - trial eligibility is one-time per email hash and per user, and survives account deletion,
 *  - a second live subscription cannot be created (function and unique index),
 *  - entitlement states come from stored state and the database clock only,
 *  - webhook events are idempotent.
 * NOT covered: Supabase's real auth service / PostgREST / the live project, and true concurrency (PGlite is one connection).
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const PROFILES = read('20261027000000_auth_profiles.sql');
const DELETE_FN = read('20261030000000_delete_own_account.sql');
const BILLING = read('20261106000000_billing_core.sql');
const BILLING_FINAL = read('20261106100000_billing_deletion_refund.sql');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const H_A = 'hash-of-user-a-0123456789abcdef';
const H_B = 'hash-of-user-b-0123456789abcdef';
let pg: PGlite;

type Role = 'anon' | 'authenticated' | 'service_role' | 'postgres';
async function as<T>(role: Role, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
  }
}
const rejects = async (fn: () => Promise<unknown>) => {
  let err: unknown = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the statement to be rejected').not.toBeNull();
  return String((err as Error).message);
};

const begin = (user: string, hash: string, plan = 'monthly', trialDays = 3) =>
  pg
    .query<{ outcome: string; subscription_id: string; status: string; trial_eligible: boolean; trial_end_at: string | null; expire_by: string }>(
      `select * from public.billing_begin_subscription($1::uuid,$2,$3,$4,$5,$6,$7,$8)`,
      [user, hash, plan, `plan_${plan}`, plan === 'annual' ? 'yearly' : 'monthly', plan === 'annual' ? 149900 : 29900, trialDays, 30]
    )
    .then((r) => r.rows[0]);
const entitlement = (user: string, grace = 0) =>
  pg.query<{ state: string; has_access: boolean; access_ends_at: string | null }>('select * from public.billing_get_entitlement($1::uuid,$2)', [user, grace]).then((r) => r.rows[0]);
const sql = (q: string) => pg.exec(q);
const val = async <T>(q: string) => (await pg.query<T>(q)).rows;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; -- Supabase's service_role bypasses RLS
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(PROFILES);
  await pg.exec(DELETE_FN); // original function; the billing migration then redefines it with the billing gate
  await pg.exec(BILLING);
  await pg.exec(BILLING); // idempotent: a second run changes nothing and does not fail
  await pg.exec(BILLING_FINAL);
  await pg.exec(BILLING_FINAL); // also idempotent
  await pg.exec(`insert into auth.users (id, email) values ('${A}','a@example.com'), ('${B}','b@example.com'), ('${C}','c@example.com')`);
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('billing schema: RLS and privileges', () => {
  it('enables RLS on every billing table', async () => {
    const rows = await val<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname like 'billing\\_%' and relkind = 'r' order by relname`
    );
    expect(rows.map((r) => r.relname)).toEqual(['billing_payments', 'billing_subscriptions', 'billing_trial_claims', 'billing_webhook_events']);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('lets users read only their own subscription and payment rows', async () => {
    const a = await begin(A, H_A);
    await begin(B, H_B);
    await sql(`update public.billing_subscriptions set status='authenticated', razorpay_subscription_id='sub_A' where id='${a.subscription_id}'`);
    await sql(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise)
               values ('${A}','${a.subscription_id}','pay_A','authorization','authorized',500)`);
    const seenByA = await as('authenticated', A, () => val<{ user_id: string }>('select user_id from public.billing_subscriptions'));
    const seenByB = await as('authenticated', B, () => val<{ user_id: string }>('select user_id from public.billing_subscriptions'));
    expect(seenByA.map((r) => r.user_id)).toEqual([A]);
    expect(seenByB.map((r) => r.user_id)).toEqual([B]);
    expect(await as('authenticated', B, () => val('select id from public.billing_payments'))).toHaveLength(0);
    expect(await as('authenticated', A, () => val('select id from public.billing_payments'))).toHaveLength(1);
  });

  it('hides Razorpay identifiers and internal columns from clients', async () => {
    await rejects(() => as('authenticated', A, () => pg.query('select razorpay_subscription_id from public.billing_subscriptions')));
    await rejects(() => as('authenticated', A, () => pg.query('select razorpay_customer_id from public.billing_subscriptions')));
    await rejects(() => as('authenticated', A, () => pg.query('select razorpay_payment_id from public.billing_payments')));
    await rejects(() => as('authenticated', A, () => pg.query('select * from public.billing_subscriptions')));
  });

  it('denies clients every write, including self-granting paid status', async () => {
    await rejects(() => as('authenticated', A, () => pg.query(`update public.billing_subscriptions set status='active' where user_id='${A}'`)));
    await rejects(() => as('authenticated', A, () => pg.query(`update public.billing_subscriptions set current_period_end = now() + interval '1 year' where user_id='${A}'`)));
    await rejects(() =>
      as('authenticated', A, () =>
        pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise, status, razorpay_subscription_id)
                  values ('${A}','monthly','plan_x','monthly',100,'active','sub_fake')`)
      )
    );
    await rejects(() => as('authenticated', A, () => pg.query(`delete from public.billing_subscriptions where user_id='${A}'`)));
    await rejects(() => as('authenticated', A, () => pg.query(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise) select '${A}', id, 'pay_fake', 'charge','captured',1 from public.billing_subscriptions limit 1`)));
    const status = await val<{ status: string }>(`select status from public.billing_subscriptions where user_id='${A}'`);
    expect(status[0].status).toBe('authenticated');
  });

  it('gives clients no access to trial claims or webhook events, and anon no access to anything', async () => {
    for (const t of ['billing_trial_claims', 'billing_webhook_events', 'billing_subscriptions', 'billing_payments']) {
      await rejects(() => as('anon', null, () => pg.query(`select 1 from public.${t}`)));
    }
    await rejects(() => as('authenticated', A, () => pg.query('select 1 from public.billing_trial_claims')));
    await rejects(() => as('authenticated', A, () => pg.query('select 1 from public.billing_webhook_events')));
    await rejects(() => as('authenticated', A, () => pg.query(`update public.billing_trial_claims set state='reserved'`)));
  });

  it('makes the billing functions executable by service_role only', async () => {
    for (const call of [
      `select * from public.billing_get_entitlement('${A}', 0)`,
      `select * from public.billing_begin_subscription('${A}','h','monthly','plan_x','monthly',29900,3,30)`,
      `select public.billing_consume_trial_claim('${A}','${A}')`,
      `select public.billing_begin_webhook_event('evt','subscription.charged',null,null,null,null)`,
      `select public.billing_mark_stop_verified('${A}','cancelled')`,
      `select public.billing_assert_account_deletable('${A}')`,
      `select * from public.billing_unrefunded_authorizations(1)`,
      `select * from public.billing_revenue_payments`
    ]) {
      await rejects(() => as('authenticated', A, () => pg.query(call)));
      await rejects(() => as('anon', null, () => pg.query(call)));
    }
    const ok = await as('service_role', null, () => pg.query(`select * from public.billing_get_entitlement('${B}', 0)`));
    expect(ok.rows).toHaveLength(1);
  });

  it('rejects out-of-range data at the table level', async () => {
    const insert = (cols: string) =>
      pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise, ${cols})
                values ('${C}', 'monthly','plan_x','monthly', 29900, ${cols.split(',').map((c) => (c.trim() === 'status' ? "'bogus'" : "'x'")).join(',')})`);
    await rejects(() => insert('status'));
    await rejects(() => pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise) values ('${C}','weekly','p','monthly',100)`));
    await rejects(() => pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise) values ('${C}','monthly','p','monthly',0)`));
    await rejects(() => pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise) values ('${C}','monthly','p','monthly',1500001)`));
  });
});

describe('billing_begin_subscription: trial eligibility and duplicate prevention', () => {
  it('offers the trial once, with a window that keeps the full trial length', async () => {
    const r = await begin(C, 'hash-of-user-c-0123456789abcdef');
    expect(r.outcome).toBe('created');
    expect(r.status).toBe('creating');
    expect(r.trial_eligible).toBe(true);
    const gap = (new Date(r.trial_end_at!).getTime() - new Date(r.expire_by).getTime()) / 86_400_000;
    expect(gap).toBeCloseTo(3, 5);
  });

  it('returns the existing live subscription instead of creating a second one', async () => {
    const first = await val<{ id: string }>(`select id from public.billing_subscriptions where user_id='${C}'`);
    const again = await begin(C, 'hash-of-user-c-0123456789abcdef');
    expect(again.outcome).toBe('existing');
    expect(again.subscription_id).toBe(first[0].id);
    const n = await val<{ n: number }>(`select count(*)::int as n from public.billing_subscriptions where user_id='${C}'`);
    expect(n[0].n).toBe(1);
  });

  it('enforces one live subscription per user at the index level too', async () => {
    const msg = await rejects(() =>
      pg.query(`insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise)
                values ('${C}','annual','plan_y','yearly',149900)`)
    );
    expect(msg).toMatch(/billing_subscriptions_one_live_per_user|duplicate key/);
  });

  it('refuses a second trial to the same email hash and to the same user under another email', async () => {
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await sql(`insert into auth.users (id, email) values ('${D}','d@example.com')`);
    // Same email hash as user A, who consumed a trial below.
    const a = await val<{ id: string }>(`select id from public.billing_subscriptions where user_id='${A}'`);
    await as('service_role', null, () => pg.query('select public.billing_consume_trial_claim($1::uuid,$2::uuid)', [A, a[0].id]));
    await sql(`update public.billing_subscriptions set status='cancelled' where user_id='${A}'`);
    const reuse = await begin(D, H_A);
    expect(reuse.outcome).toBe('created');
    expect(reuse.trial_eligible).toBe(false);
    expect(reuse.trial_end_at).toBeNull();
    // User A comes back with a different email hash.
    await sql(`update public.billing_subscriptions set status='cancelled', razorpay_subscription_id='sub_D' where user_id='${D}'`);
    const again = await begin(A, 'a-new-email-hash-0123456789abcdef');
    expect(again.trial_eligible).toBe(false);
  });

  it('keeps the consumed claim after the account is deleted (no trial reset by re-signup)', async () => {
    const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await sql(`insert into auth.users (id, email) values ('${E}','e@example.com')`);
    const r = await begin(E, 'hash-of-user-e-0123456789abcdef');
    await sql(`update public.billing_subscriptions set status='authenticated', razorpay_subscription_id='sub_E' where id='${r.subscription_id}'`);
    await pg.query('select public.billing_consume_trial_claim($1::uuid,$2::uuid)', [E, r.subscription_id]);
    await sql(`delete from auth.users where id='${E}'`);
    const claim = await val<{ state: string; user_id: string | null }>(`select state, user_id from public.billing_trial_claims where email_hash='hash-of-user-e-0123456789abcdef'`);
    expect(claim).toEqual([{ state: 'consumed', user_id: null }]);
    const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await sql(`insert into auth.users (id, email) values ('${F}','e@example.com')`);
    expect((await begin(F, 'hash-of-user-e-0123456789abcdef')).trial_eligible).toBe(false);
  });

  it('lets a user retry an abandoned (reserved, never authenticated) trial', async () => {
    const G = '99999999-9999-4999-8999-999999999999';
    await sql(`insert into auth.users (id, email) values ('${G}','g@example.com')`);
    const first = await begin(G, 'hash-of-user-g-0123456789abcdef');
    await sql(`update public.billing_subscriptions set status='expired', razorpay_subscription_id='sub_G' where id='${first.subscription_id}'`);
    const retry = await begin(G, 'hash-of-user-g-0123456789abcdef');
    expect(retry.outcome).toBe('created');
    expect(retry.trial_eligible).toBe(true);
  });

  it('validates arguments', async () => {
    await rejects(() => begin(B, H_B, 'monthly', 31));
    await rejects(() => pg.query(`select * from public.billing_begin_subscription('${B}','h','monthly','plan_x','monthly',29900,3,1)`));
    await rejects(() => pg.query(`select * from public.billing_begin_subscription(null,'h','monthly','plan_x','monthly',29900,3,30)`));
  });
});

describe('billing_get_entitlement: server-authoritative state', () => {
  const U = '77777777-7777-4777-8777-777777777777';
  const set = (cols: string) => sql(`update public.billing_subscriptions set ${cols} where user_id='${U}'`);
  beforeAll(async () => {
    await sql(`insert into auth.users (id, email) values ('${U}','u@example.com')`);
    await begin(U, 'hash-of-user-u-0123456789abcdef');
    await set(`razorpay_subscription_id='sub_U'`);
  });

  it('grants nothing before Razorpay confirms authorization', async () => {
    for (const status of ['creating', 'created']) {
      await set(`status='${status}'`);
      expect(await entitlement(U)).toMatchObject({ state: 'none', has_access: false });
    }
  });

  it('grants a trial only while the database clock is before trial_end_at', async () => {
    await set(`status='authenticated', trial_start_at = now() - interval '1 day', trial_end_at = now() + interval '2 days'`);
    expect(await entitlement(U)).toMatchObject({ state: 'trialing', has_access: true });
    await set(`trial_start_at = now() - interval '4 days', trial_end_at = now() - interval '1 day'`);
    expect(await entitlement(U)).toMatchObject({ state: 'payment_pending', has_access: false });
  });

  it('grants paid access only for a Razorpay-confirmed active period', async () => {
    await set(`status='active', paid_count=1, current_period_start = now() - interval '1 day', current_period_end = now() + interval '29 days'`);
    expect(await entitlement(U)).toMatchObject({ state: 'active', has_access: true });
    await set(`current_period_end = now() - interval '1 minute'`);
    expect(await entitlement(U)).toMatchObject({ state: 'payment_pending', has_access: false });
  });

  it('keeps access through the paid period after cancellation, then ends it', async () => {
    await set(`status='active', current_period_end = now() + interval '10 days', cancel_requested_at = now(), cancel_at_cycle_end = true, access_ends_at = now() + interval '10 days'`);
    expect(await entitlement(U)).toMatchObject({ state: 'cancelled_active', has_access: true });
    await set(`status='cancelled', cancelled_at = now(), ended_at = now()`);
    expect(await entitlement(U)).toMatchObject({ state: 'cancelled_active', has_access: true });
    await set(`access_ends_at = now() - interval '1 second', current_period_end = now() - interval '1 second'`);
    expect(await entitlement(U)).toMatchObject({ state: 'cancelled', has_access: false });
  });

  it('reports an expired trial when cancelled before any payment', async () => {
    await set(`status='cancelled', paid_count=0, access_ends_at = now() - interval '1 hour'`);
    expect(await entitlement(U)).toMatchObject({ state: 'trial_expired', has_access: false });
  });

  it('denies access on pending and halted payments (grace is opt-in, default off)', async () => {
    await set(`status='pending', paid_count=1, access_ends_at = null, current_period_end = now() - interval '1 hour'`);
    expect(await entitlement(U)).toMatchObject({ state: 'payment_pending', has_access: false });
    expect(await entitlement(U, 48)).toMatchObject({ state: 'payment_pending', has_access: true });
    expect(await entitlement(U, 0)).toMatchObject({ has_access: false });
    await set(`status='halted'`);
    expect(await entitlement(U, 48)).toMatchObject({ state: 'payment_failed', has_access: false });
  });

  it('reports completed subscriptions as expired', async () => {
    await set(`status='completed'`);
    expect(await entitlement(U)).toMatchObject({ state: 'expired', has_access: false });
  });

  it('ignores another user and rejects a null user id', async () => {
    expect(await entitlement('12121212-1212-4212-8212-121212121212')).toMatchObject({ state: 'none', has_access: false });
    await rejects(() => pg.query('select * from public.billing_get_entitlement(null, 0)'));
  });
});

describe('billing_begin_webhook_event: idempotency', () => {
  const begin_ = (id: string) =>
    pg.query<{ r: string }>(`select public.billing_begin_webhook_event($1,'subscription.charged','sub_1','pay_1','abc',now()) as r`, [id]).then((x) => x.rows[0].r);

  it('processes a first delivery once and reports duplicates afterwards', async () => {
    expect(await begin_('evt_1')).toBe('process');
    expect(await begin_('evt_1')).toBe('in_progress');
    await sql(`update public.billing_webhook_events set status='processed', processed_at=now() where razorpay_event_id='evt_1'`);
    expect(await begin_('evt_1')).toBe('duplicate');
    await sql(`update public.billing_webhook_events set status='ignored' where razorpay_event_id='evt_1'`);
    expect(await begin_('evt_1')).toBe('duplicate');
  });

  it('lets a failed or stale delivery be processed again and counts the attempt', async () => {
    expect(await begin_('evt_2')).toBe('process');
    await sql(`update public.billing_webhook_events set status='failed', error_code='db' where razorpay_event_id='evt_2'`);
    expect(await begin_('evt_2')).toBe('process');
    await sql(`update public.billing_webhook_events set received_at = now() - interval '5 minutes' where razorpay_event_id='evt_2'`);
    expect(await begin_('evt_2')).toBe('process');
    const row = await val<{ attempts: number; status: string }>(`select attempts, status from public.billing_webhook_events where razorpay_event_id='evt_2'`);
    expect(row[0]).toEqual({ attempts: 3, status: 'received' });
  });

  it('rejects an empty event id', async () => {
    await rejects(() => begin_(''));
  });

  it('deduplicates payments on the Razorpay payment id', async () => {
    const sub = await val<{ id: string }>(`select id from public.billing_subscriptions where user_id='${B}'`);
    const ins = () =>
      pg.query(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise)
                values ('${B}','${sub[0].id}','pay_dup','charge','captured',29900)`);
    await ins();
    await rejects(ins);
  });
});

// --- Account deletion safeguards, refund tracking and revenue (final Stage 1 design) ---------------------------------
const addUser = (id: string, email: string) => sql(`insert into auth.users (id, email) values ('${id}','${email}')`);
const deleteOwn = (uid: string) => as('authenticated', uid, () => pg.query('select public.delete_own_account()'));
const userExists = async (id: string) => (await val(`select 1 from auth.users where id='${id}'`)).length === 1;
const stopVerified = (subId: string, status: string) =>
  as('service_role', null, () => pg.query('select public.billing_mark_stop_verified($1::uuid,$2)', [subId, status]));
async function subscribe(uid: string, hash: string, status: string, rzp: string | null = `sub_${uid.slice(0, 4)}`) {
  const r = await begin(uid, hash);
  await sql(`update public.billing_subscriptions set status='${status}', razorpay_subscription_id=${rzp ? `'${rzp}'` : 'null'},
    trial_start_at=now(), current_period_end = now() + interval '30 days' where id='${r.subscription_id}'`);
  return r.subscription_id;
}

describe('account deletion safeguards', () => {
  it('still deletes an account that has no billing rows', async () => {
    const U = '10000000-0000-4000-8000-000000000001';
    await addUser(U, 'u1@example.com');
    await deleteOwn(U);
    expect(await userExists(U)).toBe(false);
  });

  it('refuses deletion while a subscription could still bill, in every live state', async () => {
    const live = ['creating', 'created', 'authenticated', 'active', 'pending', 'halted'];
    for (const [i, status] of live.entries()) {
      const U = `20000000-0000-4000-8000-00000000000${i}`;
      await addUser(U, `live${i}@example.com`);
      await subscribe(U, `hash-live-${i}-0123456789abcdef`, status, status === 'creating' ? null : `sub_live_${i}`);
      const msg = await rejects(() => deleteOwn(U));
      expect(msg, status).toContain('billing_cancellation_required');
      expect(await userExists(U), status).toBe(true);
    }
  });

  it('refuses deletion for a cycle-end cancellation that is still active until the period ends', async () => {
    const U = '30000000-0000-4000-8000-000000000001';
    await addUser(U, 'u3@example.com');
    const id = await subscribe(U, 'hash-cycle-end-0123456789abcdef', 'active', 'sub_cycle');
    await sql(`update public.billing_subscriptions set cancel_requested_at=now(), cancel_at_cycle_end=true where id='${id}'`);
    await rejects(() => deleteOwn(U));
    expect(await userExists(U)).toBe(true);
  });

  it('refuses deletion when the cancel is recorded but Razorpay has not verified the stop (delayed webhook)', async () => {
    const U = '40000000-0000-4000-8000-000000000001';
    await addUser(U, 'u4@example.com');
    await subscribe(U, 'hash-unverified-0123456789abcdef', 'cancelled', 'sub_unverified');
    expect(await rejects(() => deleteOwn(U))).toContain('billing_cancellation_required');
  });

  it('allows deletion once the server has verified a terminal status with Razorpay, and keeps the audit rows', async () => {
    const U = '50000000-0000-4000-8000-000000000001';
    await addUser(U, 'u5@example.com');
    const id = await subscribe(U, 'hash-verified-0123456789abcdef', 'authenticated', 'sub_verified');
    await rejects(() => deleteOwn(U));
    expect((await stopVerified(id, 'cancelled')).rows).toEqual([{ billing_mark_stop_verified: true }]);
    await deleteOwn(U);
    expect(await userExists(U)).toBe(false);
    const kept = await val<{ user_id: string | null; status: string }>(`select user_id, status from public.billing_subscriptions where razorpay_subscription_id='sub_verified'`);
    expect(kept).toEqual([{ user_id: null, status: 'cancelled' }]);
  });

  it('lets an expired row that never reached Razorpay be deleted (no mandate exists)', async () => {
    const U = '60000000-0000-4000-8000-000000000001';
    await addUser(U, 'u6@example.com');
    await subscribe(U, 'hash-never-sent-0123456789abcdef', 'expired', null);
    await deleteOwn(U);
    expect(await userExists(U)).toBe(false);
  });

  it('keeps an unverified subscription matchable by its Razorpay id after the account is gone (orphan handling)', async () => {
    const U = '70000000-0000-4000-8000-000000000001';
    await addUser(U, 'u7@example.com');
    await subscribe(U, 'hash-orphan-0123456789abcdef', 'expired', 'sub_orphan');
    await sql(`delete from auth.users where id='${U}'`); // simulates deletion that bypassed the gate (e.g. admin)
    const orphans = await val<{ razorpay_subscription_id: string }>(
      `select razorpay_subscription_id from public.billing_subscriptions where user_id is null and billing_stop_verified_at is null and razorpay_subscription_id='sub_orphan'`
    );
    expect(orphans).toHaveLength(1);
  });

  it('only accepts terminal Razorpay statuses when verifying a stop', async () => {
    const id = (await val<{ id: string }>(`select id from public.billing_subscriptions limit 1`))[0].id;
    await rejects(() => stopVerified(id, 'active'));
    await rejects(() => stopVerified(id, 'authenticated'));
    // the table itself refuses a stop verification on a non-terminal row
    const live = (await val<{ id: string }>(`select id from public.billing_subscriptions where status in ('active','authenticated','pending','halted') limit 1`))[0].id;
    await rejects(() => sql(`update public.billing_subscriptions set billing_stop_verified_at=now() where id='${live}'`));
  });

  it('serialises with subscription creation (shared advisory lock) and the unauthenticated call is rejected', async () => {
    expect(await rejects(() => as('anon', null, () => pg.query('select public.delete_own_account()')))).toBeTruthy();
    expect(await rejects(() => as('authenticated', null, () => pg.query('select public.delete_own_account()')))).toContain('Not authenticated');
  });

  it('keeps delete_own_account executable by signed-in users only', async () => {
    const acl = await val<{ grantee: string }>(
      `select grantee::regrole::text as grantee from aclexplode((select proacl from pg_proc where proname='delete_own_account'))`
    );
    expect(acl.map((r) => r.grantee).sort()).toContain('authenticated');
    expect(acl.map((r) => r.grantee)).not.toContain('anon');
    expect(acl.map((r) => r.grantee)).not.toContain('-');
  });
});

describe('INR 5 authorization payment: refund tracking and revenue', () => {
  const U = '80000000-0000-4000-8000-000000000001';
  let subId = '';
  beforeAll(async () => {
    await addUser(U, 'u8@example.com');
    subId = await subscribe(U, 'hash-refund-0123456789abcdef', 'authenticated', 'sub_refund');
  });

  it('excludes authorization payments from revenue, whatever their status, and counts captured charges', async () => {
    await sql(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise, amount_refunded_paise, refunded_at)
      values ('${U}','${subId}','pay_auth_refunded','authorization','refunded',500,500,now()),
             ('${U}','${subId}','pay_auth_captured','authorization','captured',500,0,null),
             ('${U}','${subId}','pay_charge_ok','charge','captured',29900,0,null),
             ('${U}','${subId}','pay_charge_failed','charge','failed',29900,0,null)`);
    const rows = await as('service_role', null, () => val<{ razorpay_payment_id: string }>('select razorpay_payment_id from public.billing_revenue_payments order by 1'));
    const ids = rows.map((r) => r.razorpay_payment_id);
    expect(ids).toContain('pay_charge_ok');
    expect(ids).not.toContain('pay_auth_refunded');
    expect(ids).not.toContain('pay_auth_captured');
    expect(ids).not.toContain('pay_charge_failed');
  });

  it('keeps the revenue view away from clients', async () => {
    await rejects(() => as('authenticated', U, () => pg.query('select * from public.billing_revenue_payments')));
  });

  it('flags authorization payments that Razorpay has not refunded after the window, and clears them once refunded', async () => {
    await sql(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise, created_at)
      values ('${U}','${subId}','pay_auth_stuck','authorization','authorized',500, now() - interval '2 days'),
             ('${U}','${subId}','pay_auth_recent','authorization','authorized',500, now())`);
    const flagged = () =>
      as('service_role', null, () => val<{ razorpay_payment_id: string }>('select razorpay_payment_id from public.billing_unrefunded_authorizations(1440)')).then((r) => r.map((x) => x.razorpay_payment_id));
    await sql(`update public.billing_payments set created_at = now() - interval '2 days' where razorpay_payment_id='pay_auth_captured'`);
    const before = await flagged();
    expect(before).toContain('pay_auth_stuck');
    expect(before).toContain('pay_auth_captured'); // captured but never marked refunded is also surfaced
    expect(before).not.toContain('pay_auth_recent');
    expect(before).not.toContain('pay_auth_refunded');
    await sql(`update public.billing_payments set status='refunded', amount_refunded_paise=500, refunded_at=now() where razorpay_payment_id='pay_auth_stuck'`);
    expect(await flagged()).not.toContain('pay_auth_stuck');
  });

  it('rejects inconsistent refund data', async () => {
    const ins = (cols: string) =>
      pg.query(`insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise, ${cols.split('|')[0]}) values ('${U}','${subId}','pay_bad_${Math.random()}','authorization','${cols.split('|')[2]}',500,${cols.split('|')[1]})`);
    await rejects(() => ins('amount_refunded_paise|600|authorized')); // refunded more than paid
    await rejects(() => ins('amount_refunded_paise|0|refunded')); // 'refunded' without refunded_at
  });

  it('shows users their own refund state but still no Razorpay payment id', async () => {
    const mine = await as('authenticated', U, () => val<{ kind: string; refunded_at: string | null }>(`select kind, refunded_at from public.billing_payments where kind='authorization' and status='refunded'`));
    expect(mine.length).toBeGreaterThan(0);
    await rejects(() => as('authenticated', U, () => pg.query('select razorpay_payment_id from public.billing_payments')));
  });
});
