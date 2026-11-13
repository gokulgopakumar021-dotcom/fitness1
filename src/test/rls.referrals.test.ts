// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Referral Stage 1 (DRAFT migration, not applied to any live database). Runs the REAL `20261112060254_referral_core.sql`
 * (on top of the real profiles, delete-account and billing migrations) in an in-process Postgres with a simulated auth
 * schema and Supabase roles, and checks:
 *  - RLS/privileges: partners read only their own display columns, customers and anon see nothing, no client can write,
 *    partners cannot change their rate or approve/pay, app_admins/attributions/audit are server-only,
 *  - admin functions: service_role only, and independently re-check the acting user against app_admins,
 *  - attribution: first-touch, immutable, server-validated (unknown/inactive/self-referral/post-billing rejected),
 *  - commission math at 20% (INR 299 -> 59.80, INR 1,499 -> 299.80), no trial/authorization/failed commission,
 *  - refunds (partial, full, repeat, reinstatement, order independence) and chargebacks via the append-only ledger,
 *  - uniqueness (partner code, one accrual per payment, dedupe key) and append-only/immutability triggers,
 *  - payouts bounded by the payable balance, hold period, flagged-attribution hold, void as compensating entry, audit rows,
 *  - the migration is idempotent and leaves existing billing tables/functions untouched.
 * NOT covered: Supabase's real auth service / PostgREST / the live project, and true concurrency (PGlite is one connection).
 */
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const PROFILES = read('20261027051824_auth_profiles.sql');
const DELETE_FN = read('20261030053401_delete_own_account.sql');
const BILLING = read('20261106052859_billing_core.sql');
const BILLING_FINAL = read('20261106071858_billing_deletion_refund.sql');
const REFERRAL = read('20261112060254_referral_core.sql');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const P1U = '22222222-2222-4222-8222-222222222222'; // partner 1's login
const P2U = '33333333-3333-4333-8333-333333333333'; // partner 2's login
const C1 = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'; // customers
const C2 = 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2';
const C3 = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
const C4 = 'c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4';
const NOBODY = '99999999-9999-4999-8999-999999999999';
const H = (n: string) => `hash-${n}-0123456789abcdef`;
let pg: PGlite;
let partner1 = '';
let partner2 = '';

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
const val = async <T>(q: string, params?: unknown[]) => (await pg.query<T>(q, params)).rows;
const svc = <T>(fn: () => Promise<T>) => as('service_role', null, fn);

let seq = 0;
/** Inserts a subscription + payment directly (as the billing server would) and returns the payment uuid. */
async function makePayment(user: string | null, opts: { kind?: string; status?: string; amount?: number; refunded?: number } = {}) {
  seq += 1;
  const amount = opts.amount ?? 29900;
  const status = opts.status ?? 'captured';
  const refunded = opts.refunded ?? 0;
  const sub = (
    await val<{ id: string }>(
      `insert into public.billing_subscriptions (user_id, plan_key, razorpay_plan_id, billing_period, amount_paise, status, razorpay_subscription_id)
       values ($1,'monthly','plan_m','monthly',29900,'completed',$2) returning id`,
      [user, `sub_${seq}_${Math.random()}`]
    )
  )[0].id;
  return (
    await val<{ id: string }>(
      `insert into public.billing_payments (user_id, subscription_id, razorpay_payment_id, kind, status, amount_paise, amount_refunded_paise, refunded_at)
       values ($1,$2,$3,$4,$5,$6,$7, $8) returning id`,
      [user, sub, `pay_${seq}_${Math.random()}`, opts.kind ?? 'charge', status, amount, refunded, status === 'refunded' ? new Date().toISOString() : null]
    )
  )[0].id;
}
const setRefund = (payment: string, refunded: number, status = 'captured') =>
  pg.query(`update public.billing_payments set amount_refunded_paise=$2, status=$3, refunded_at = case when $3='refunded' then now() else null end where id=$1`, [payment, refunded, status]);
const sync = (payment: string, hold = 14) =>
  svc(() => pg.query<{ outcome: string; delta: string }>('select * from public.referral_sync_commission($1::uuid,$2)', [payment, hold])).then((r) => r.rows[0]);
const attribute = (user: string, code: string, hash: string, flags: string[] = []) =>
  svc(() => pg.query<{ outcome: string; attribution_id: string | null }>('select * from public.referral_attribute_user($1::uuid,$2,$3,$4,$5)', [user, code, hash, 'signup', flags])).then((r) => r.rows[0]);
const ledger = (payment: string) =>
  val<{ entry_type: string; amount: string }>(`select entry_type, amount from public.referral_ledger_entries where payment_id=$1 order by created_at, entry_type`, [payment]);
const net = async (payment: string) => Number((await val<{ s: string }>(`select coalesce(sum(amount),0) s from public.referral_ledger_entries where payment_id=$1`, [payment]))[0].s);
const balance = (partner: string) =>
  svc(() => pg.query<{ total: string; payable: string; pending: string; currency: string }>('select * from public.referral_partner_balance($1::uuid)', [partner])).then((r) => r.rows[0]);
const ageAccruals = (partner: string) => pg.exec(`alter table public.referral_ledger_entries disable trigger referral_ledger_no_update;
  update public.referral_ledger_entries set payable_after = now() - interval '1 day' where partner_id='${partner}' and entry_type='accrual';
  alter table public.referral_ledger_entries enable trigger referral_ledger_no_update;`);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(PROFILES);
  await pg.exec(DELETE_FN);
  await pg.exec(BILLING);
  await pg.exec(BILLING_FINAL);
  const billingBefore = await val<{ d: string }>(
    `select md5(string_agg(proname || pg_get_functiondef(oid), '' order by proname)) d from pg_proc where proname like 'billing\\_%' and pronamespace = 'public'::regnamespace`
  );
  await pg.exec(REFERRAL);
  await pg.exec(REFERRAL); // idempotent: a second run changes nothing and does not fail
  const billingAfter = await val<{ d: string }>(
    `select md5(string_agg(proname || pg_get_functiondef(oid), '' order by proname)) d from pg_proc where proname like 'billing\\_%' and pronamespace = 'public'::regnamespace`
  );
  expect(billingAfter[0].d).toBe(billingBefore[0].d); // existing billing functions untouched
  for (const [id, email] of [
    [ADMIN, 'admin@example.com'], [P1U, 'p1@example.com'], [P2U, 'p2@example.com'], [C1, 'c1@example.com'],
    [C2, 'c2@example.com'], [C3, 'c3@example.com'], [C4, 'c4@example.com'], [NOBODY, 'n@example.com'],
  ])
    await pg.exec(`insert into auth.users (id, email) values ('${id}','${email}')`);
  await pg.exec(`insert into public.app_admins (user_id) values ('${ADMIN}')`); // manual seeding, as documented
  partner1 = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_create_partner($1::uuid,$2::uuid,'alpha1','Alpha Partner',$3) as id`, [ADMIN, P1U, H('p1')]))).rows[0].id;
  partner2 = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_create_partner($1::uuid,$2::uuid,' beta22 ','Beta Partner',$3) as id`, [ADMIN, P2U, H('p2')]))).rows[0].id;
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('schema: RLS enabled, money types, currency', () => {
  it('enables RLS on every referral table and app_admins', async () => {
    const rows = await val<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relkind='r' and (relname like 'referral\\_%' or relname='app_admins') order by relname`
    );
    expect(rows.map((r) => r.relname)).toEqual([
      'app_admins', 'referral_admin_audit', 'referral_attributions', 'referral_ledger_entries', 'referral_partners', 'referral_payouts', 'referral_visit_counters',
    ]);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('stores money as numeric with an explicit INR currency', async () => {
    const cols = await val<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema='public' and table_name in ('referral_ledger_entries','referral_payouts')
          and column_name in ('amount','basis_amount','refund_level')`
    );
    expect(cols.length).toBe(4);
    expect(cols.every((c) => c.data_type === 'numeric')).toBe(true);
    expect(await rejects(() => pg.query(`insert into public.referral_payouts (partner_id, amount, currency, method, external_reference, paid_at, recorded_by) values ('${partner1}',1,'USD','upi','x',now(),'${ADMIN}')`))).toMatch(/currency/);
  });

  it('normalises partner codes and enforces uniqueness and format', async () => {
    expect((await val<{ code: string }>(`select code from public.referral_partners where id='${partner2}'`))[0].code).toBe('BETA22');
    const dup = await rejects(() => svc(() => pg.query(`select public.referral_admin_create_partner($1::uuid,null,'ALPHA1','Dup',null)`, [ADMIN])));
    expect(dup).toMatch(/duplicate|unique/i);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_create_partner($1::uuid,null,'a-b','Bad',null)`, [ADMIN])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_create_partner($1::uuid,null,'abc','Short',null)`, [ADMIN])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_create_partner($1::uuid,null,'RATE1','Bad rate',null,10001)`, [ADMIN])));
  });

  it('defaults new partners to the fixed 20% rate (2000 bps)', async () => {
    expect((await val<{ commission_rate_bps: number }>(`select commission_rate_bps from public.referral_partners where id='${partner1}'`))[0].commission_rate_bps).toBe(2000);
  });
});

describe('RLS: partner isolation and client write denial', () => {
  it('lets a partner read only their own partner row, and only display columns', async () => {
    const own = await as('authenticated', P1U, () => val<{ id: string }>('select id from public.referral_partners'));
    expect(own.map((r) => r.id)).toEqual([partner1]);
    await rejects(() => as('authenticated', P1U, () => pg.query('select email_hash from public.referral_partners')));
    await rejects(() => as('authenticated', P1U, () => pg.query('select payout_note from public.referral_partners')));
    await rejects(() => as('authenticated', P1U, () => pg.query('select created_by from public.referral_partners')));
    await rejects(() => as('authenticated', P1U, () => pg.query('select * from public.referral_partners')));
  });

  it('shows a customer and anon no partner data at all', async () => {
    expect(await as('authenticated', C1, () => val('select id from public.referral_partners'))).toHaveLength(0);
    expect(await as('authenticated', C1, () => val('select id from public.referral_ledger_entries'))).toHaveLength(0);
    expect(await as('authenticated', C1, () => val('select id from public.referral_payouts'))).toHaveLength(0);
    for (const t of ['referral_partners', 'referral_ledger_entries', 'referral_payouts', 'referral_visit_counters', 'referral_attributions', 'referral_admin_audit', 'app_admins'])
      await rejects(() => as('anon', null, () => pg.query(`select 1 from public.${t}`)));
  });

  it('blocks all client access to attributions, audit and app_admins (even for admins, partners, customers)', async () => {
    for (const uid of [ADMIN, P1U, C1])
      for (const t of ['referral_attributions', 'referral_admin_audit', 'app_admins'])
        await rejects(() => as('authenticated', uid, () => pg.query(`select 1 from public.${t}`)));
  });

  it('denies a partner every write: rate, status, code, approvals, payouts, ledger', async () => {
    await rejects(() => as('authenticated', P1U, () => pg.query(`update public.referral_partners set commission_rate_bps=9000 where id='${partner1}'`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`update public.referral_partners set status='active', code='HACK1' where id='${partner1}'`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`insert into public.referral_partners (code, display_name) values ('SELF123','x')`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`insert into public.referral_payouts (partner_id, amount, method, external_reference, paid_at, recorded_by) values ('${partner1}',1,'upi','x',now(),'${P1U}')`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key, reason) values ('${partner1}','manual_adjustment',1000,'k','self credit')`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`update public.referral_ledger_entries set amount = amount * 10`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`delete from public.referral_ledger_entries`)));
    await rejects(() => as('authenticated', P1U, () => pg.query(`insert into public.app_admins (user_id) values ('${P1U}')`)));
    expect((await val<{ commission_rate_bps: number }>(`select commission_rate_bps from public.referral_partners where id='${partner1}'`))[0].commission_rate_bps).toBe(2000);
  });

  it('keeps every referral function away from anon and authenticated callers', async () => {
    const calls = [
      `select public.is_app_admin('${ADMIN}')`,
      `select public.referral_admin_set_partner_rate('${ADMIN}','${partner1}',9000)`,
      `select public.referral_admin_set_partner_status('${ADMIN}','${partner1}','suspended')`,
      `select public.referral_admin_add_adjustment('${ADMIN}','${partner1}',100,'self award')`,
      `select public.referral_admin_record_payout('${ADMIN}','${partner1}',1,'upi','x',now())`,
      `select public.referral_attribute_user('${C1}','ALPHA1','${H('c1')}')`,
      `select public.referral_sync_commission('${C1}')`,
      `select public.referral_apply_chargeback('${C1}','disp_1')`,
      `select public.referral_record_visit('ALPHA1')`,
      `select * from public.referral_partner_balance('${partner1}')`,
    ];
    for (const q of calls) {
      await rejects(() => as('authenticated', P1U, () => pg.query(q)));
      await rejects(() => as('authenticated', ADMIN, () => pg.query(q))); // even a real admin's client session cannot call them
      await rejects(() => as('anon', null, () => pg.query(q)));
    }
    await rejects(() => svc(() => pg.query(`select public.referral_require_admin('${ADMIN}')`)));
    await rejects(() => svc(() => pg.query(`select public.referral_write_audit('${ADMIN}','x','y',null,null,null,null)`)));
  });

  it('gives service_role no direct write on referral tables (writes only through the functions)', async () => {
    await rejects(() => svc(() => pg.query(`insert into public.app_admins (user_id) values ('${C1}')`)));
    await rejects(() => svc(() => pg.query(`update public.referral_partners set commission_rate_bps=1 where id='${partner1}'`)));
    await rejects(() => svc(() => pg.query(`insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key, reason) values ('${partner1}','manual_adjustment',1,'direct','direct insert')`)));
    await rejects(() => svc(() => pg.query(`insert into public.referral_admin_audit (actor_id, action, target_type) values ('${ADMIN}','x','y')`)));
  });
});

describe('admin authorization is re-validated inside every admin function', () => {
  const nonAdmin = [C1, P1U, NOBODY, '00000000-0000-0000-0000-000000000000'];
  it('rejects a non-admin actor even through service_role', async () => {
    for (const actor of nonAdmin) {
      const msgs = await Promise.all(
        [
          `select public.referral_admin_create_partner('${actor}',null,'EVIL01','Evil',null)`,
          `select public.referral_admin_set_partner_status('${actor}','${partner1}','terminated')`,
          `select public.referral_admin_set_partner_rate('${actor}','${partner1}',10000)`,
          `select public.referral_admin_review_attribution('${actor}','${partner1}','void')`,
          `select public.referral_admin_record_payout('${actor}','${partner1}',1,'upi','x',now())`,
          `select public.referral_admin_void_payout('${actor}','${partner1}','no reason given')`,
          `select public.referral_admin_add_adjustment('${actor}','${partner1}',500,'free money')`,
        ].map((q) => rejects(() => svc(() => pg.query(q))))
      );
      for (const m of msgs) expect(m).toMatch(/administrator privileges required/);
    }
    await rejects(() => svc(() => pg.query(`select public.referral_admin_set_partner_rate(null,'${partner1}',1)`)));
    expect(Number((await val<{ n: string }>(`select count(*) n from public.referral_partners where code='EVIL01'`))[0].n)).toBe(0);
  });

  it('does not treat user_metadata or other claims as an admin signal', async () => {
    await pg.exec(`update auth.users set raw_user_meta_data = '{"role":"admin","is_admin":true}' where id='${C1}'`);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_set_partner_rate('${C1}','${partner1}',9000)`)));
    expect((await svc(() => pg.query<{ a: boolean }>(`select public.is_app_admin('${C1}') a`))).rows[0].a).toBe(false);
    expect((await svc(() => pg.query<{ a: boolean }>(`select public.is_app_admin('${ADMIN}') a`))).rows[0].a).toBe(true);
  });

  it('lets an admin manage partners and writes an audit row for every change', async () => {
    const before = Number((await val<{ n: string }>('select count(*) n from public.referral_admin_audit'))[0].n);
    await svc(() => pg.query(`select public.referral_admin_set_partner_rate($1::uuid,$2::uuid,2500,'req-1')`, [ADMIN, partner2]));
    await svc(() => pg.query(`select public.referral_admin_set_partner_rate($1::uuid,$2::uuid,2000,'req-2')`, [ADMIN, partner2]));
    const audit = await val<{ action: string; before_data: { commission_rate_bps: number }; after_data: { commission_rate_bps: number }; request_id: string; actor_id: string }>(
      `select action, before_data, after_data, request_id, actor_id from public.referral_admin_audit where action='partner.rate' order by created_at desc, request_id desc limit 2`
    );
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actor_id === ADMIN)).toBe(true);
    expect(audit.find((a) => a.request_id === 'req-1')?.after_data.commission_rate_bps).toBe(2500);
    expect(Number((await val<{ n: string }>('select count(*) n from public.referral_admin_audit'))[0].n)).toBe(before + 2);
  });

  it('rolls back the action when it fails (no orphan audit row)', async () => {
    const before = Number((await val<{ n: string }>('select count(*) n from public.referral_admin_audit'))[0].n);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_set_partner_rate($1::uuid,$2::uuid,20000)`, [ADMIN, partner1])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'bogus')`, [ADMIN, partner1])));
    expect(Number((await val<{ n: string }>('select count(*) n from public.referral_admin_audit'))[0].n)).toBe(before);
  });

  it('never lets a terminated partner be reactivated, and never deletes partners', async () => {
    const id = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_create_partner($1::uuid,null,'GONE01','Gone',null) as id`, [ADMIN]))).rows[0].id;
    await svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'terminated')`, [ADMIN, id]));
    expect(await rejects(() => svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'active')`, [ADMIN, id])))).toMatch(/reactivated/);
    expect(await rejects(() => pg.query(`delete from public.referral_partners where id='${id}'`))).toMatch(/not allowed/);
    await rejects(() => pg.query(`update public.referral_partners set code='CHANGED1' where id='${id}'`));
  });
});

describe('attribution: server-authoritative, first-touch, immutable', () => {
  it('attributes a new customer once and never overwrites', async () => {
    const a = await attribute(C1, 'alpha1', H('c1'));
    expect(a.outcome).toBe('attributed');
    const again = await attribute(C1, 'BETA22', H('c1'));
    expect(again.outcome).toBe('existing');
    expect(again.attribution_id).toBe(a.attribution_id);
    const row = (await val<{ partner_id: string; code_used: string }>(`select partner_id, code_used from public.referral_attributions where referred_user_id='${C1}'`))[0];
    expect(row.partner_id).toBe(partner1);
    expect(row.code_used).toBe('ALPHA1');
  });

  it('rejects unknown, suspended and terminated partner codes', async () => {
    expect((await attribute(C2, 'NOSUCH', H('c2'))).outcome).toBe('rejected_unknown_code');
    const id = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_create_partner($1::uuid,null,'SUSP01','Susp',null) as id`, [ADMIN]))).rows[0].id;
    await svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'suspended')`, [ADMIN, id]));
    expect((await attribute(C2, 'SUSP01', H('c2'))).outcome).toBe('rejected_inactive_partner');
    await svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'terminated')`, [ADMIN, id]));
    expect((await attribute(C2, 'SUSP01', H('c2'))).outcome).toBe('rejected_inactive_partner');
    expect((await attribute(C2, '', H('c2'))).outcome).toBe('rejected_unknown_code');
  });

  it('rejects self-referral by user id and by normalised-email hash', async () => {
    expect((await attribute(P1U, 'ALPHA1', H('anything'))).outcome).toBe('rejected_self_referral');
    expect((await attribute(C3, 'ALPHA1', H('p1'))).outcome).toBe('rejected_self_referral');
    expect((await val('select 1 from public.referral_attributions where referred_user_id in ($1,$2)', [P1U, C3]))).toHaveLength(0);
  });

  it('refuses attribution once the customer has any billing row or payment', async () => {
    await makePayment(C4, { kind: 'authorization', status: 'authorized', amount: 500 });
    expect((await attribute(C4, 'ALPHA1', H('c4'))).outcome).toBe('rejected_has_billing');
  });

  it('keeps attribution identity immutable and undeletable, but allows an audited admin review', async () => {
    const id = (await val<{ id: string }>(`select id from public.referral_attributions where referred_user_id='${C1}'`))[0].id;
    await rejects(() => pg.query(`update public.referral_attributions set partner_id='${partner2}' where id='${id}'`));
    await rejects(() => pg.query(`update public.referral_attributions set code_used='BETA22' where id='${id}'`));
    await rejects(() => pg.query(`update public.referral_attributions set referred_user_id='${C2}' where id='${id}'`));
    await rejects(() => pg.query(`update public.referral_attributions set attributed_at = now() + interval '1 day' where id='${id}'`));
    expect(await rejects(() => pg.query(`delete from public.referral_attributions where id='${id}'`))).toMatch(/not allowed/);
    await rejects(() => pg.query('truncate public.referral_attributions'));
    await svc(() => pg.query(`select public.referral_admin_review_attribution($1::uuid,$2::uuid,'active',null,'rev-1')`, [ADMIN, id]));
    const row = (await val<{ reviewed_by: string; status: string }>(`select reviewed_by, status from public.referral_attributions where id='${id}'`))[0];
    expect(row).toMatchObject({ reviewed_by: ADMIN, status: 'active' });
  });

  it('allows only one attribution row per customer (unique constraint)', async () => {
    await rejects(() =>
      pg.query(`insert into public.referral_attributions (referred_user_id, partner_id, code_used) values ('${C1}','${partner2}','BETA22')`)
    );
  });
});

describe('commission accrual: 20% of successfully collected charges only', () => {
  it('accrues INR 59.80 on a 299 charge and 299.80 on a 1,499 charge, once per payment', async () => {
    const p1 = await makePayment(C1, { amount: 29900 });
    expect(await sync(p1)).toMatchObject({ outcome: 'accrued' });
    expect(await net(p1)).toBe(59.8);
    expect(await sync(p1)).toMatchObject({ outcome: 'unchanged' }); // replay
    expect(await sync(p1)).toMatchObject({ outcome: 'unchanged' });
    expect((await ledger(p1)).length).toBe(1);

    const p2 = await makePayment(C1, { amount: 149900 });
    await sync(p2);
    expect(await net(p2)).toBe(299.8);
    const e = (await val<{ basis_amount: string; rate_bps: number; currency: string; amount: string; created_by: string | null }>(
      `select basis_amount, rate_bps, currency, amount, created_by from public.referral_ledger_entries where payment_id='${p2}'`))[0];
    expect(e).toMatchObject({ basis_amount: '1499.00', rate_bps: 2000, currency: 'INR', amount: '299.80', created_by: null });
  });

  it('never pays commission on trial, authorization-only, authorized-only or failed payments', async () => {
    const auth = await makePayment(C1, { kind: 'authorization', status: 'authorized', amount: 500 });
    const authCaptured = await makePayment(C1, { kind: 'authorization', status: 'captured', amount: 500 });
    const authorizedCharge = await makePayment(C1, { kind: 'charge', status: 'authorized', amount: 29900 });
    const failed = await makePayment(C1, { kind: 'charge', status: 'failed', amount: 29900 });
    const zero = await makePayment(C1, { kind: 'charge', status: 'captured', amount: 0 });
    for (const p of [auth, authCaptured, authorizedCharge, failed, zero]) {
      expect((await sync(p)).outcome).toBe('not_eligible');
      expect(await ledger(p)).toHaveLength(0);
    }
    expect((await sync('00000000-0000-4000-8000-000000000000')).outcome).toBe('payment_not_found');
  });

  it('accrues nothing for unattributed customers, inactive partners or deleted-user orphans', async () => {
    const unattributed = await makePayment(C2, {});
    expect((await sync(unattributed)).outcome).toBe('no_attribution');
    const orphan = await makePayment(null, {});
    expect((await sync(orphan)).outcome).toBe('no_user');
  });

  it('snapshots the rate: a later rate change affects future accruals only', async () => {
    const before = await makePayment(C1, { amount: 29900 });
    await sync(before);
    await svc(() => pg.query(`select public.referral_admin_set_partner_rate($1::uuid,$2::uuid,3000)`, [ADMIN, partner1]));
    const after = await makePayment(C1, { amount: 29900 });
    await sync(after);
    expect(await net(before)).toBe(59.8);
    expect(await net(after)).toBe(89.7);
    await sync(before); // replay after the rate change must not re-rate the old payment
    expect(await net(before)).toBe(59.8);
    await svc(() => pg.query(`select public.referral_admin_set_partner_rate($1::uuid,$2::uuid,2000)`, [ADMIN, partner1]));
  });

  it('stops accruing for a suspended partner but keeps existing history', async () => {
    await svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'suspended')`, [ADMIN, partner1]));
    const p = await makePayment(C1, { amount: 29900 });
    expect((await sync(p)).outcome).toBe('partner_inactive');
    await svc(() => pg.query(`select public.referral_admin_set_partner_status($1::uuid,$2::uuid,'active')`, [ADMIN, partner1]));
    expect((await sync(p)).outcome).toBe('accrued');
  });

  it('keeps accruing for the same referred customer on every later payment (lifetime)', async () => {
    const ps = [await makePayment(C1), await makePayment(C1), await makePayment(C1)];
    for (const p of ps) {
      await sync(p);
      expect(await net(p)).toBe(59.8);
    }
  });

  it('enforces one accrual per payment and unique dedupe keys at the database level', async () => {
    const p = await makePayment(C1);
    await sync(p);
    const att = (await val<{ id: string }>(`select id from public.referral_attributions where referred_user_id='${C1}'`))[0].id;
    const ins = (key: string) =>
      pg.query(`insert into public.referral_ledger_entries (partner_id, attribution_id, payment_id, entry_type, amount, basis_amount, rate_bps, dedupe_key, payable_after)
                values ('${partner1}','${att}','${p}','accrual',59.80,299,2000,'${key}',now())`);
    await rejects(() => ins('acc:other-key')); // second accrual for the same payment, different key
    await rejects(() => ins(`acc:${p}`)); // same key
  });

  it('rejects malformed ledger rows (signs, links, missing fields)', async () => {
    const att = (await val<{ id: string }>(`select id from public.referral_attributions where referred_user_id='${C1}'`))[0].id;
    const p = await makePayment(C1);
    const q = (type: string, amount: string, extra = '') =>
      pg.query(`insert into public.referral_ledger_entries (partner_id, attribution_id, payment_id, entry_type, amount, basis_amount, rate_bps, payable_after, dedupe_key ${extra ? ',reason' : ''})
                values ('${partner1}','${att}','${p}','${type}',${amount},299,2000,now(),'bad-${type}-${amount}' ${extra ? `,'${extra}'` : ''})`);
    await rejects(() => q('accrual', '-5')); // negative accrual
    await rejects(() => q('refund_reversal', '5')); // positive reversal
    await rejects(() => q('payout', '-5')); // payout with a payment link / no payout id
    await rejects(() => q('manual_adjustment', '5', 'manual with payment link'));
    await rejects(() => pg.query(`insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key) values ('${partner1}','manual_adjustment',5,'nr')`)); // no reason
    await rejects(() => pg.query(`insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key, reason) values ('${partner1}','bogus',5,'bg','bogus type')`));
    await rejects(() => pg.query(`insert into public.referral_ledger_entries (partner_id, entry_type, amount, dedupe_key, reason, currency) values ('${partner1}','manual_adjustment',5,'cur','usd entry','USD')`));
  });
});

describe('refunds and chargebacks', () => {
  async function accruedPayment(amount = 29900) {
    const p = await makePayment(C1, { amount });
    await sync(p);
    return p;
  }

  it('reverses proportionally on a partial refund, and is idempotent on replay', async () => {
    const p = await accruedPayment(29900);
    await setRefund(p, 10000); // refunded INR 100 -> remaining 199 -> 39.80
    const r1 = await sync(p);
    expect(r1.outcome).toBe('adjusted');
    expect(Number(r1.delta)).toBe(-20);
    expect(await net(p)).toBe(39.8);
    expect(await sync(p)).toMatchObject({ outcome: 'unchanged' });
    expect(await sync(p)).toMatchObject({ outcome: 'unchanged' });
    expect(await net(p)).toBe(39.8);
    expect((await ledger(p)).map((l) => l.entry_type).sort()).toEqual(['accrual', 'refund_reversal']);
  });

  it('lands exactly on zero for a full refund, including a refund seen before the first sync', async () => {
    const p = await accruedPayment(29900);
    await setRefund(p, 29900, 'refunded');
    await sync(p);
    expect(await net(p)).toBe(0);
    await sync(p);
    expect(await net(p)).toBe(0);
    const late = await makePayment(C1, { amount: 149900, status: 'refunded', refunded: 149900 }); // first seen already fully refunded
    expect((await sync(late)).outcome).toBe('adjusted');
    expect(await net(late)).toBe(0);
    expect((await ledger(late)).map((l) => l.entry_type).sort()).toEqual(['accrual', 'refund_reversal']);
  });

  it('is order-independent and handles several partial refunds with the same result', async () => {
    const a = await accruedPayment(29900);
    await setRefund(a, 5000); await sync(a);
    await setRefund(a, 15000); await sync(a);
    await setRefund(a, 29900, 'refunded'); await sync(a);
    const b = await accruedPayment(29900);
    await setRefund(b, 29900, 'refunded'); await sync(b); // jumped straight to the final state
    expect(await net(a)).toBe(0);
    expect(await net(b)).toBe(0);
  });

  it('reinstates commission when a refund level goes back down (failed refund), appending rather than editing', async () => {
    const p = await accruedPayment(29900);
    await setRefund(p, 29900, 'refunded'); await sync(p);
    expect(await net(p)).toBe(0);
    await setRefund(p, 0, 'captured'); // refund failed
    const r2 = await sync(p);
    expect(r2.outcome).toBe('adjusted');
    expect(Number(r2.delta)).toBe(59.8);
    expect(await net(p)).toBe(59.8);
    expect((await ledger(p)).map((l) => l.entry_type).sort()).toEqual(['accrual', 'refund_reinstatement', 'refund_reversal']);
  });

  it('reverses the remaining net once on a lost chargeback and does not reinstate it later', async () => {
    const p = await accruedPayment(29900);
    await setRefund(p, 10000); await sync(p); // net 39.80
    const r = await svc(() => pg.query<{ outcome: string; delta: string }>(`select * from public.referral_apply_chargeback($1::uuid,'disp_1')`, [p]));
    expect(r.rows[0].outcome).toBe('reversed');
    expect(Number(r.rows[0].delta)).toBe(-39.8);
    expect(await net(p)).toBe(0);
    expect((await svc(() => pg.query<{ outcome: string }>(`select * from public.referral_apply_chargeback($1::uuid,'disp_1')`, [p]))).rows[0].outcome).toBe('duplicate');
    await setRefund(p, 0); await sync(p); // refund level drops; chargeback keeps the target at zero
    expect(await net(p)).toBe(0);
    expect((await svc(() => pg.query<{ outcome: string }>(`select * from public.referral_apply_chargeback($1::uuid,'disp_2')`, [p]))).rows[0].outcome).toBe('nothing_to_reverse');
    expect((await svc(() => pg.query<{ outcome: string }>(`select * from public.referral_apply_chargeback($1::uuid,'disp_3')`, ['00000000-0000-4000-8000-000000000000']))).rows[0].outcome).toBe('no_commission');
  });

  it('still reverses a refund after the customer deleted their account (snapshot, not user lookup)', async () => {
    const u = '77777777-7777-4777-8777-777777777777';
    await pg.exec(`insert into auth.users (id, email) values ('${u}','gone@example.com')`);
    expect((await attribute(u, 'ALPHA1', H('gone'))).outcome).toBe('attributed');
    const p = await makePayment(u, { amount: 29900 });
    await sync(p);
    await pg.exec(`delete from auth.users where id='${u}'`); // FK set null on subscriptions/payments/attribution
    expect((await val<{ u: string | null }>(`select referred_user_id u from public.referral_attributions where code_used='ALPHA1' and referred_email_hash='${H('gone')}'`))[0].u).toBeNull();
    await setRefund(p, 29900, 'refunded');
    await sync(p);
    expect(await net(p)).toBe(0);
  });
});

describe('payouts, hold period and balance', () => {
  let p3: string;
  it('treats fresh accruals as pending, not payable, and refuses to pay them', async () => {
    const pay = await makePayment(C1, { amount: 29900 });
    await sync(pay); // default 14-day hold
    const b = await balance(partner1);
    expect(Number(b.total)).toBeGreaterThan(0);
    expect(Number(b.payable)).toBe(0);
    expect(Number(b.pending)).toBe(Number(b.total));
    expect(b.currency).toBe('INR');
    expect(await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,1,'upi','UPI-1',now())`, [ADMIN, partner1])))).toMatch(/exceeds payable/);
  });

  it('pays only up to the payable balance, atomically records payout + negative ledger entry + audit', async () => {
    await ageAccruals(partner1);
    const before = await balance(partner1);
    expect(Number(before.payable)).toBe(Number(before.total));
    const amount = Number(before.payable);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,$3,'upi','UPI-X',now())`, [ADMIN, partner1, amount + 0.01])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,0,'upi','UPI-X',now())`, [ADMIN, partner1])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,1.005,'upi','UPI-X',now())`, [ADMIN, partner1])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,1,'crypto','UPI-X',now())`, [ADMIN, partner1])));
    const payoutId = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_record_payout($1::uuid,$2::uuid,$3,'upi','UPI-100',now(),'req-pay') as id`, [ADMIN, partner1, 100]))).rows[0].id;
    const after = await balance(partner1);
    expect(Number(after.payable)).toBeCloseTo(amount - 100, 2);
    const entry = (await val<{ amount: string; entry_type: string; payout_id: string }>(`select amount, entry_type, payout_id from public.referral_ledger_entries where payout_id='${payoutId}'`))[0];
    expect(entry).toMatchObject({ amount: '-100.00', entry_type: 'payout' });
    expect(Number((await val<{ n: string }>(`select count(*) n from public.referral_admin_audit where action='payout.record' and request_id='req-pay' and actor_id='${ADMIN}'`))[0].n)).toBe(1);
    p3 = payoutId;
  });

  it('voids a payout with a compensating entry, once, leaving the payout row untouched', async () => {
    const before = await balance(partner1);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_void_payout($1::uuid,$2::uuid,'x')`, [ADMIN, p3]))); // reason too short
    await svc(() => pg.query(`select public.referral_admin_void_payout($1::uuid,$2::uuid,'paid in error')`, [ADMIN, p3]));
    expect(Number((await balance(partner1)).payable)).toBeCloseTo(Number(before.payable) + 100, 2);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_void_payout($1::uuid,$2::uuid,'paid in error again')`, [ADMIN, p3])));
    expect((await val<{ amount: string }>(`select amount from public.referral_payouts where id='${p3}'`))[0].amount).toBe('100.00');
  });

  it('lets a reversal after payout carry forward as a negative balance (clawback)', async () => {
    const fresh = await makePayment(C1, { amount: 29900 });
    await sync(fresh, 0); // no hold
    const paid = Number((await balance(partner1)).payable);
    await svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,$3,'bank_transfer','NEFT-1',now())`, [ADMIN, partner1, paid]));
    expect(Number((await balance(partner1)).payable)).toBe(0);
    await setRefund(fresh, 29900, 'refunded');
    await sync(fresh, 0);
    expect(Number((await balance(partner1)).payable)).toBeCloseTo(-59.8, 2);
    await rejects(() => svc(() => pg.query(`select public.referral_admin_record_payout($1::uuid,$2::uuid,1,'upi','UPI-NEG',now())`, [ADMIN, partner1])));
    await svc(() => pg.query(`select public.referral_admin_add_adjustment($1::uuid,$2::uuid,59.80,'clawback settled offline')`, [ADMIN, partner1]));
    expect(Number((await balance(partner1)).payable)).toBeCloseTo(0, 2);
  });

  it('records signed manual adjustments with a required reason and an audit row', async () => {
    await rejects(() => svc(() => pg.query(`select public.referral_admin_add_adjustment($1::uuid,$2::uuid,0,'zero adjust')`, [ADMIN, partner2])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_add_adjustment($1::uuid,$2::uuid,10,'')`, [ADMIN, partner2])));
    await rejects(() => svc(() => pg.query(`select public.referral_admin_add_adjustment($1::uuid,$2::uuid,10.123,'bad scale')`, [ADMIN, partner2])));
    const id = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_add_adjustment($1::uuid,$2::uuid,25.5,'goodwill bonus') as id`, [ADMIN, partner2]))).rows[0].id;
    expect(Number((await balance(partner2)).payable)).toBe(25.5);
    expect(Number((await val<{ n: string }>(`select count(*) n from public.referral_admin_audit where target_id='${id}' and action='adjustment.add'`))[0].n)).toBe(1);
  });

  it('holds flagged attributions out of the payable balance until an admin reviews them', async () => {
    const u = '88888888-8888-4888-8888-888888888888';
    await pg.exec(`insert into auth.users (id, email) values ('${u}','flag@example.com')`);
    const att = await attribute(u, 'BETA22', H('flag'), ['contact_match']);
    const pay = await makePayment(u, { amount: 29900 });
    await sync(pay, 0);
    const held = await balance(partner2);
    expect(Number(held.pending)).toBeCloseTo(59.8, 2);
    await svc(() => pg.query(`select public.referral_admin_review_attribution($1::uuid,$2::uuid,'active',null)`, [ADMIN, att.attribution_id]));
    expect(Number((await balance(partner2)).pending)).toBe(0);
    await svc(() => pg.query(`select public.referral_admin_review_attribution($1::uuid,$2::uuid,'void',null)`, [ADMIN, att.attribution_id]));
    expect(Number((await balance(partner2)).payable)).toBeCloseTo(25.5, 2); // voided attribution's commission is not payable
  });

  it('isolates partners: each sees only their own ledger entries, payouts and visit counters (no payment ids)', async () => {
    await svc(() => pg.query(`select public.referral_record_visit('alpha1')`));
    await svc(() => pg.query(`select public.referral_record_visit('BETA22')`));
    const own = await as('authenticated', P1U, () => val<{ partner_id: string }>('select partner_id from public.referral_ledger_entries'));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.partner_id === partner1)).toBe(true);
    const other = await as('authenticated', P2U, () => val<{ partner_id: string }>('select partner_id from public.referral_ledger_entries'));
    expect(other.every((r) => r.partner_id === partner2)).toBe(true);
    expect(await as('authenticated', P1U, () => val('select id from public.referral_payouts where partner_id = $1', [partner2]))).toHaveLength(0);
    expect((await as('authenticated', P1U, () => val<{ partner_id: string }>('select partner_id from public.referral_visit_counters'))).every((r) => r.partner_id === partner1)).toBe(true);
    for (const col of ['payment_id', 'attribution_id', 'dedupe_key', 'reason', 'created_by'])
      await rejects(() => as('authenticated', P1U, () => pg.query(`select ${col} from public.referral_ledger_entries`)));
    await rejects(() => as('authenticated', P1U, () => pg.query('select external_reference from public.referral_payouts')));
    await rejects(() => as('authenticated', P1U, () => pg.query('select recorded_by from public.referral_payouts')));
    expect(await as('authenticated', C1, () => val('select day from public.referral_visit_counters'))).toHaveLength(0);
  });

  it('shows a partner nothing once their login is gone (user_id null never matches)', async () => {
    const id = (await svc(() => pg.query<{ id: string }>(`select public.referral_admin_create_partner($1::uuid,null,'NOUSER1','No login',null) as id`, [ADMIN]))).rows[0].id;
    expect(await as('authenticated', C1, () => val('select id from public.referral_partners where id = $1', [id]))).toHaveLength(0);
  });
});

describe('append-only financial history', () => {
  it('rejects UPDATE, DELETE and TRUNCATE on ledger, payouts and audit, even for the table owner', async () => {
    for (const t of ['referral_ledger_entries', 'referral_payouts', 'referral_admin_audit']) {
      expect(await rejects(() => pg.query(`update public.${t} set ${t === 'referral_admin_audit' ? 'action' : t === 'referral_payouts' ? 'method' : 'reason'} = 'x'`).then(() => pg.query(`select 1`)))).toMatch(/append-only|not allowed|check|violat/i);
      await rejects(() => pg.query(`delete from public.${t}`));
      await rejects(() => pg.query(`truncate public.${t}`));
    }
  });

  it('blocks silent mutation of an existing ledger entry', async () => {
    const id = (await val<{ id: string }>(`select id from public.referral_ledger_entries where entry_type='accrual' limit 1`))[0].id;
    expect(await rejects(() => pg.query(`update public.referral_ledger_entries set amount = 999 where id='${id}'`))).toMatch(/append-only/);
    expect(await rejects(() => pg.query(`delete from public.referral_ledger_entries where id='${id}'`))).toMatch(/append-only/);
  });

  it('prevents deleting a payment or partner that has commission history', async () => {
    const id = (await val<{ id: string }>(`select payment_id id from public.referral_ledger_entries where entry_type='accrual' limit 1`))[0].id;
    await rejects(() => pg.query(`delete from public.billing_payments where id='${id}'`));
    await rejects(() => pg.query(`delete from public.referral_partners where id='${partner1}'`));
  });
});

describe('visit counters', () => {
  it('counts anonymous visits per partner per day, ignoring unknown and inactive codes', async () => {
    expect((await svc(() => pg.query<{ r: boolean }>(`select public.referral_record_visit('ALPHA1') r`))).rows[0].r).toBe(true);
    expect((await svc(() => pg.query<{ r: boolean }>(`select public.referral_record_visit('NOPE123') r`))).rows[0].r).toBe(false);
    const v = (await val<{ visits: string }>(`select sum(visits) visits from public.referral_visit_counters where partner_id='${partner1}'`))[0].visits;
    expect(Number(v)).toBeGreaterThanOrEqual(2);
    await rejects(() => pg.query(`update public.referral_visit_counters set visits = -1`));
  });
});
