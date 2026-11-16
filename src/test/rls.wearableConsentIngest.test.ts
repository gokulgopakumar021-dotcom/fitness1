// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { METRICS } from '../wearables/types';
import { WEARABLE_CONSENT_CATEGORIES } from '../wearables/consentPolicy';

/**
 * Applies the APPLIED foundation migration, then the PROPOSED BT-04B migration, in an in-process Postgres with a simulated
 * auth schema and Supabase roles. NOT covered: Supabase's auth service, PostgREST, real multi-connection concurrency (PGlite is
 * single-connection, so concurrent calls are serialised), and the live project (nothing here touches it).
 */
const root = resolve(import.meta.dirname, '../..');
const FOUNDATION = readFileSync(resolve(root, 'supabase/migrations/20261115131442_wearable_foundation.sql'), 'utf8');
// The already-applied cloud-sync tables: ingest verifies workout sessions against the caller's own rows here.
const WORKOUT_SYNC = readFileSync(resolve(root, 'supabase/migrations/20261105071106_workout_cloud_sync.sql'), 'utf8');
const PROPOSED = readFileSync(resolve(root, 'supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'service_role' | 'postgres', uid: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
const consent = (uid: string, cats: string[], version = 1) =>
  as('authenticated', uid, () => pg.query(`select public.set_my_wearable_consent(array[${cats.map((c) => `'${c}'`).join(',')}]::text[], ${version})`));
const DEV = JSON.stringify({ device_key: 'k1', manufacturer: 'Polar', model: 'H10', display_name: 'Polar H10', ingestion_method: 'direct_ble' });
const sampleJson = (over: Record<string, unknown> = {}) => ({
  metric: 'heart_rate', value: 140, unit: 'bpm', measured_at: '2026-11-15T10:00:00Z', origin: 'live', quality: 'unverified', dedupe_key: 'web_bluetooth|k1|heart_rate|t:2026-11-15T10:00:00.000Z/', ...over
});
const ingest = (uid: string, samples: unknown[], device = DEV) =>
  as('authenticated', uid, () => pg.query<{ r: { device_id: string; inserted_keys: string[]; verified_keys: string[]; rejected_keys: string[] } }>(`select public.ingest_wearable_batch('${device}'::jsonb, '${JSON.stringify(samples).replace(/'/g, "''")}'::jsonb) as r`));

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await pg.exec(FOUNDATION);
  await pg.exec(WORKOUT_SYNC);
  await pg.exec(PROPOSED);
  await pg.exec('grant all on all tables in schema public to service_role');
  await pg.exec(`insert into auth.users (id, email) values ('${A}','a@example.com'), ('${B}','b@example.com')`);
}, 60000);
afterAll(async () => { await pg.close(); });

describe('proposed migration', () => {
  it('re-applies cleanly (idempotent)', async () => {
    await expect(pg.exec(PROPOSED)).resolves.toBeDefined();
  });
  it('leaves the applied foundation file untouched in behaviour: RLS on, anon has nothing, credentials unreachable', async () => {
    for (const t of ['wearable_connections', 'wearable_devices', 'wearable_samples', 'wearable_ai_consents', 'wearable_provider_credentials', 'wearable_consent_events']) {
      expect((await pg.query<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid='public.${t}'::regclass`)).rows[0].r).toBe(true);
      expect((await pg.query(`select 1 from information_schema.role_table_grants where table_name='${t}' and grantee='anon'`)).rows).toHaveLength(0);
    }
    await expect(as('authenticated', A, () => pg.query('select * from public.wearable_provider_credentials'))).rejects.toThrow(/permission denied/);
  });
  it('its category list in SQL equals the TypeScript list (drift guard)', () => {
    for (const c of WEARABLE_CONSENT_CATEGORIES) expect(PROPOSED).toContain(`'${c}'`);
    const sqlCats = new Set([...PROPOSED.matchAll(/'(live_heart_rate|historical_heart_rate|workout_health_sync|sleep_and_recovery_metrics|activity_metrics)'/g)].map((m) => m[1]));
    expect([...sqlCats].sort()).toEqual([...WEARABLE_CONSENT_CATEGORIES].sort());
  });
});

describe('consent: state, audit, isolation, revocation', () => {
  it('is empty by default and clients cannot write consent or audit rows directly', async () => {
    expect((await as('authenticated', A, () => pg.query('select * from public.wearable_ai_consents'))).rows).toHaveLength(0);
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_ai_consents (user_id, version, categories) values ('${A}', 1, array['live_heart_rate'])`))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_consent_events (user_id, category, action, consent_version) values ('${A}','live_heart_rate','granted',1)`))).rejects.toThrow(/permission denied/);
  });
  it('grants per category and writes one audit row per category', async () => {
    await consent(A, ['live_heart_rate', 'workout_health_sync']);
    const row = (await as('authenticated', A, () => pg.query<{ categories: string[]; version: number }>('select categories, version from public.wearable_ai_consents'))).rows[0];
    expect(row.categories.sort()).toEqual(['live_heart_rate', 'workout_health_sync']);
    const ev = (await as('authenticated', A, () => pg.query<{ category: string; action: string }>('select category, action from public.wearable_consent_events order by id'))).rows;
    expect(ev.map((e) => `${e.category}:${e.action}`).sort()).toEqual(['live_heart_rate:granted', 'workout_health_sync:granted']);
  });
  it('revoking one category removes only that category and logs it; revoking all deletes the row but keeps the history', async () => {
    await consent(A, ['workout_health_sync']);
    expect((await as('authenticated', A, () => pg.query<{ categories: string[] }>('select categories from public.wearable_ai_consents'))).rows[0].categories).toEqual(['workout_health_sync']);
    await consent(A, []);
    expect((await as('authenticated', A, () => pg.query('select * from public.wearable_ai_consents'))).rows).toHaveLength(0);
    const ev = (await as('authenticated', A, () => pg.query<{ category: string; action: string }>('select category, action from public.wearable_consent_events'))).rows;
    expect(ev.filter((e) => e.action === 'revoked').map((e) => e.category).sort()).toEqual(['live_heart_rate', 'workout_health_sync']);
    expect(ev.filter((e) => e.action === 'granted')).toHaveLength(2);
  });
  it('re-consent after a version change is a fresh grant of every category', async () => {
    await consent(A, ['live_heart_rate'], 1);
    const before = (await pg.query<{ n: number }>(`select count(*)::int n from public.wearable_consent_events where user_id='${A}' and action='granted'`)).rows[0].n;
    await consent(A, ['live_heart_rate'], 2);
    const after = (await pg.query<{ n: number }>(`select count(*)::int n from public.wearable_consent_events where user_id='${A}' and action='granted'`)).rows[0].n;
    expect(after).toBe(before + 1);
    expect((await as('authenticated', A, () => pg.query<{ version: number }>('select version from public.wearable_ai_consents'))).rows[0].version).toBe(2);
    await consent(A, []);
  });
  it('rejects invalid categories, anonymous callers and a missing identity', async () => {
    await expect(consent(A, ['everything'])).rejects.toThrow(/invalid consent category/);
    await expect(as('authenticated', null, () => pg.query(`select public.set_my_wearable_consent(array['live_heart_rate'], 1)`))).rejects.toThrow(/not authenticated/);
    await expect(as('anon', null, () => pg.query(`select public.set_my_wearable_consent(array['live_heart_rate'], 1)`))).rejects.toThrow(/permission denied/);
  });
  it('isolates accounts: B cannot read A\'s consent or audit trail, and A\'s call cannot change B', async () => {
    await consent(A, ['live_heart_rate']);
    await consent(B, ['activity_metrics']);
    const bSees = (await as('authenticated', B, () => pg.query<{ user_id: string }>('select user_id from public.wearable_ai_consents'))).rows;
    expect(bSees.map((r) => r.user_id)).toEqual([B]);
    const bEvents = (await as('authenticated', B, () => pg.query<{ user_id: string }>('select user_id from public.wearable_consent_events'))).rows;
    expect(new Set(bEvents.map((e) => e.user_id))).toEqual(new Set([B]));
    await consent(A, []);
    expect((await as('authenticated', B, () => pg.query<{ categories: string[] }>('select categories from public.wearable_ai_consents'))).rows[0].categories).toEqual(['activity_metrics']);
    await consent(B, []);
  });
});

describe('ingestion RPC', () => {
  it('is the only write path: authenticated cannot insert devices or samples directly any more', async () => {
    await expect(as('authenticated', A, () => pg.query(`insert into public.wearable_devices (user_id, device_key, manufacturer, ingestion_method) values ('${A}','x','Polar','direct_ble')`))).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, () => pg.query(`select public.ingest_wearable_batch('{}'::jsonb, '[]'::jsonb)`))).rejects.toThrow(/permission denied/);
  });
  it('refuses without workout_health_sync consent (other categories do not count), and without identity', async () => {
    await expect(ingest(A, [sampleJson()])).rejects.toThrow(/consent_required/);
    await consent(A, ['live_heart_rate', 'historical_heart_rate', 'activity_metrics', 'sleep_and_recovery_metrics']);
    await expect(ingest(A, [sampleJson()])).rejects.toThrow(/consent_required/);
    await expect(as('authenticated', null, () => pg.query(`select public.ingest_wearable_batch('${DEV}'::jsonb, '[]'::jsonb)`))).rejects.toThrow(/not authenticated/);
  });
  it('inserts for the caller only, returns inserted keys, and is idempotent', async () => {
    await consent(A, ['workout_health_sync']);
    const first = (await ingest(A, [sampleJson()])).rows[0].r;
    expect(first.inserted_keys).toEqual([sampleJson().dedupe_key]);
    const again = (await ingest(A, [sampleJson()])).rows[0].r;
    expect(again.inserted_keys).toEqual([]);
    expect(again.device_id).toBe(first.device_id);
    const rows = (await pg.query<{ user_id: string; n: number }>(`select user_id, count(*)::int n from public.wearable_samples group by user_id`)).rows;
    expect(rows).toEqual([{ user_id: A, n: 1 }]);
  });
  it('handles repeats inside one batch and concurrent identical calls (serialised in PGlite) with exactly one row', async () => {
    const s = sampleJson({ measured_at: '2026-11-15T10:05:00Z', dedupe_key: 'dup-key-1' });
    const inside = (await ingest(A, [s, s])).rows[0].r.inserted_keys;
    expect(inside).toEqual(['dup-key-1']);
    const s2 = sampleJson({ measured_at: '2026-11-15T10:06:00Z', dedupe_key: 'dup-key-2' });
    const rs = await Promise.all([1, 2, 3, 4].map(() => ingest(A, [s2])));
    expect(rs.reduce((n, r) => n + r.rows[0].r.inserted_keys.length, 0)).toBe(1);
  });
  it('keeps accounts apart: B with the same dedupe_key stores its own row and cannot read A\'s', async () => {
    await consent(B, ['workout_health_sync']);
    const r = (await ingest(B, [sampleJson()])).rows[0].r;
    expect(r.inserted_keys).toEqual([sampleJson().dedupe_key]);
    const seen = (await as('authenticated', B, () => pg.query<{ user_id: string }>('select user_id from public.wearable_samples'))).rows;
    expect(new Set(seen.map((x) => x.user_id))).toEqual(new Set([B]));
    await expect(as('authenticated', B, () => pg.query(`delete from public.wearable_samples where user_id = '${A}' returning id`))).resolves.toMatchObject({ rows: [] });
  });
  it('stores the workout label, and refuses an over-long one', async () => {
    await ingest(A, [sampleJson({ dedupe_key: 'w1', measured_at: '2026-11-15T11:00:00Z', workout_session_id: 'sess-1' })]);
    expect((await pg.query<{ w: string }>(`select workout_session_id w from public.wearable_samples where dedupe_key='w1'`)).rows[0].w).toBe('sess-1');
    await expect(ingest(A, [sampleJson({ dedupe_key: 'w2', workout_session_id: 'x'.repeat(129) })])).rejects.toThrow(/check/i);
  });
  it('can never store simulated data (no legal origin), nor a metric/unit mismatch', async () => {
    await expect(ingest(A, [sampleJson({ dedupe_key: 's1', origin: 'simulated' })])).rejects.toThrow(/check/i);
    await expect(ingest(A, [sampleJson({ dedupe_key: 's2', unit: 'ms' })])).rejects.toThrow(/check/i);
  });
  it('the SQL plausibility range equals METRICS in types.ts for every metric (drift guard)', async () => {
    let i = 0;
    for (const [metric, spec] of Object.entries(METRICS)) {
      const at = (value: number) => sampleJson({ metric, unit: spec.unit, value, dedupe_key: `range-${metric}-${i++}`, measured_at: '2026-11-14T10:00:00Z' });
      await expect(ingest(A, [at(spec.min)])).resolves.toBeDefined();
      await expect(ingest(A, [at(spec.max)])).resolves.toBeDefined();
      await expect(ingest(A, [at(spec.min - 1)])).rejects.toThrow(/check/i);
      await expect(ingest(A, [at(spec.max + 1)])).rejects.toThrow(/check/i);
    }
  });
  it('refuses a batch above 500 records at the database too', async () => {
    const many = Array.from({ length: 501 }, (_, k) => sampleJson({ dedupe_key: `big-${k}` }));
    await expect(ingest(A, many)).rejects.toThrow(/invalid batch/);
  });
  it('removes everything for an account when the account is deleted', async () => {
    await pg.exec(`delete from auth.users where id = '${B}'`);
    for (const t of ['wearable_samples', 'wearable_devices', 'wearable_ai_consents', 'wearable_consent_events']) {
      expect((await pg.query(`select 1 from public.${t} where user_id = '${B}'`)).rows).toHaveLength(0);
    }
  });
});

describe('BT-04C: workout session verification (derived by the database, never claimed by the client)', () => {
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const iso = (ms: number) => new Date(ms).toISOString();
  const START = Date.parse('2026-11-14T10:00:00Z');
  const END = Date.parse('2026-11-14T11:00:00Z');
  const key = (n: string) => `ver-${n}`;
  const smp = (n: string, atMs: number, sid: string | null, over: Record<string, unknown> = {}) =>
    sampleJson({ dedupe_key: key(n), measured_at: iso(atMs), ...(sid ? { workout_session_id: sid } : {}), ...over });
  const stored = async (n: string) =>
    (await pg.query<{ v: boolean | null; w: string | null }>(`select workout_session_verified v, workout_session_id w from public.wearable_samples where dedupe_key='${key(n)}'`)).rows;
  const putSession = (uid: string, id: string, data: Record<string, unknown>, table = 'workout_sessions', deleted = false) =>
    pg.exec(`insert into public.${table} (user_id, id, data, deleted_at) values ('${uid}','${id}','${JSON.stringify(data)}'::jsonb, ${deleted ? 'now()' : 'null'})`);

  beforeAll(async () => {
    await pg.exec(`insert into auth.users (id, email) values ('${C}','c@example.com'), ('${D}','d@example.com')`);
    await consent(C, ['workout_health_sync']);
    await consent(D, ['workout_health_sync']);
    await putSession(C, 'done-1', { id: 'done-1', status: 'completed', date: '2026-11-14', startTime: iso(START), endTime: iso(END) });
    await putSession(D, 'other-users-session', { id: 'other-users-session', status: 'completed', date: '2026-11-14', startTime: iso(START), endTime: iso(END) });
    await putSession(C, 'gone-1', { status: 'completed', startTime: iso(START), endTime: iso(END) }, 'workout_sessions', true);
    await putSession(C, 'badtime-1', { status: 'completed', startTime: 'garbage', endTime: iso(END) });
    await putSession(C, 'noend-1', { status: 'completed', startTime: iso(START) });
    await putSession(C, 'live-1', { status: 'in_progress', startTime: iso(Date.now() - 20 * 60_000) }, 'workout_active_sessions');
  });

  it('verifies a sample inside a cloud-synced session of the same account', async () => {
    const r = (await ingest(C, [smp('in', START + 30 * 60_000, 'done-1')])).rows[0].r;
    expect(r.inserted_keys).toEqual([key('in')]);
    expect(r.verified_keys).toEqual([key('in')]);
    expect(r.rejected_keys).toEqual([]);
    expect(await stored('in')).toEqual([{ v: true, w: 'done-1' }]);
  });
  it('allows 5 minutes of clock skew at either end and refuses beyond it (not stored)', async () => {
    const r = (await ingest(C, [smp('early-ok', START - 4 * 60_000, 'done-1'), smp('late-ok', END + 4 * 60_000, 'done-1'),
      smp('early-bad', START - 10 * 60_000, 'done-1'), smp('late-bad', END + 10 * 60_000, 'done-1')])).rows[0].r;
    expect(r.verified_keys.sort()).toEqual([key('early-ok'), key('late-ok')].sort());
    expect(r.rejected_keys.sort()).toEqual([key('early-bad'), key('late-bad')].sort());
    expect(r.inserted_keys).not.toContain(key('early-bad'));
    expect(await stored('early-bad')).toHaveLength(0);
    expect(await stored('late-bad')).toHaveLength(0);
  });
  it('a session that is not cloud-synced is stored but labelled UNVERIFIED', async () => {
    const r = (await ingest(C, [smp('nosync', START, 'never-synced-1')])).rows[0].r;
    expect(r.inserted_keys).toEqual([key('nosync')]);
    expect(r.verified_keys).toEqual([]);
    expect(await stored('nosync')).toEqual([{ v: false, w: 'never-synced-1' }]);
  });
  it('another account\'s session id never verifies (cross-user): stored unverified, never rejected, never linked', async () => {
    const r = (await ingest(C, [smp('xuser', START + 10 * 60_000, 'other-users-session')])).rows[0].r;
    expect(r.verified_keys).toEqual([]);
    expect(r.rejected_keys).toEqual([]);
    expect(await stored('xuser')).toEqual([{ v: false, w: 'other-users-session' }]);
    // and the owner of that session verifies normally
    const d = (await ingest(D, [smp('xuser-d', START + 10 * 60_000, 'other-users-session', { dedupe_key: 'ver-xuser-d' })])).rows[0].r;
    expect(d.verified_keys).toEqual(['ver-xuser-d']);
  });
  it('a deleted (tombstoned) session, an undeterminable window and a session with no end all stay unverified', async () => {
    const r = (await ingest(C, [smp('gone', START + 5 * 60_000, 'gone-1'), smp('badtime', START + 5 * 60_000, 'badtime-1'), smp('noend', START + 5 * 60_000, 'noend-1')])).rows[0].r;
    expect(r.verified_keys).toEqual([]);
    expect(r.rejected_keys).toEqual([]);
    for (const n of ['gone', 'badtime', 'noend']) expect(await stored(n)).toEqual([{ v: false, w: n === 'gone' ? 'gone-1' : n === 'badtime' ? 'badtime-1' : 'noend-1' }]);
  });
  it('an in-progress session (active table) verifies from its start until now, and refuses the future and before the start', async () => {
    const now = Date.now();
    const r = (await ingest(C, [smp('live-ok', now - 5 * 60_000, 'live-1'), smp('live-before', now - 40 * 60_000, 'live-1'), smp('live-future', now + 30 * 60_000, 'live-1')])).rows[0].r;
    expect(r.verified_keys).toEqual([key('live-ok')]);
    expect(r.rejected_keys.sort()).toEqual([key('live-before'), key('live-future')].sort());
  });
  it('a sample with no session label has a null verification', async () => {
    await ingest(C, [smp('nolabel', START, null)]);
    expect(await stored('nolabel')).toEqual([{ v: null, w: null }]);
  });
  it('ignores a client-supplied verification flag', async () => {
    await ingest(C, [smp('claim', START, 'never-synced-2', { workout_session_verified: true, verified: true })]);
    expect(await stored('claim')).toEqual([{ v: false, w: 'never-synced-2' }]);
  });
  it('a delayed re-send is a duplicate and does not silently upgrade an unverified label', async () => {
    await putSession(C, 'late-sync-1', { status: 'completed', startTime: iso(START), endTime: iso(END) });
    const r = (await ingest(C, [smp('nosync', START, 'late-sync-1')])).rows[0].r;
    expect(r.inserted_keys).toEqual([]);
    expect(await stored('nosync')).toEqual([{ v: false, w: 'never-synced-1' }]);
  });
  it('clients still cannot set the column or write samples directly', async () => {
    await expect(as('authenticated', C, () => pg.query(`insert into public.wearable_samples (user_id, device_id, metric, value, unit, measured_at, origin, quality, dedupe_key, workout_session_verified)
      select '${C}', id, 'heart_rate', 100, 'bpm', now(), 'live', 'unverified', 'direct-1', true from public.wearable_devices limit 1`))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', C, () => pg.query(`update public.wearable_samples set workout_session_verified = true where dedupe_key = '${key('nosync')}'`))).rejects.toThrow(/permission denied/);
  });
  it('the helper function is not callable by clients', async () => {
    await expect(as('authenticated', C, () => pg.query(`select public.wearable_try_timestamptz('2026-11-14T10:00:00Z')`))).rejects.toThrow(/permission denied/);
  });
});

describe('BT-04C task 3: reading stored workout heart rate (the exact PostgREST read shape the server uses)', () => {
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const START = Date.parse('2026-11-14T10:00:00Z');
  const k = (n: string) => `hrread-${n}`;
  const smp = (n: string, atMs: number, sid: string, over: Record<string, unknown> = {}) =>
    sampleJson({ dedupe_key: k(n), measured_at: new Date(atMs).toISOString(), workout_session_id: sid, ...over });
  // The server's filters, plus a test-only prefix on dedupe_key so rows stored by the earlier describe blocks do not collide with the
  // exact-list assertions below. The prefix only narrows the result, so it cannot hide a leak of this block's own rows.
  const READ = (asUser: string, forUser: string, sid: string) => `select value, measured_at, workout_session_verified from public.wearable_samples
    where user_id = '${forUser}' and workout_session_id = '${sid}' and metric = 'heart_rate' and dedupe_key like 'hrread-%' order by measured_at asc, id asc`;
  const read = (asUser: string, forUser: string, sid: string) => as('authenticated', asUser, () => pg.query<{ value: number; workout_session_verified: boolean | null }>(READ(asUser, forUser, sid)));

  beforeAll(async () => {
    await ingest(C, [smp('c1', START + 10 * 60_000, 'done-1', { value: 120 }), smp('c2', START + 20 * 60_000, 'done-1', { value: 140 }), smp('c3', START + 15 * 60_000, 'local-only-hr', { value: 130 })]);
    await ingest(D, [smp('d1', START + 10 * 60_000, 'other-users-session', { value: 99 })]);
  });

  it('returns the account\'s own readings in time order with the database\'s verification flag', async () => {
    const own = await read(C, C, 'done-1');
    expect(own.rows.map((r) => r.value)).toEqual([120, 140]);
    expect(own.rows.every((r) => r.workout_session_verified === true)).toBe(true);
    const local = await read(C, C, 'local-only-hr');
    expect(local.rows).toEqual([expect.objectContaining({ value: 130, workout_session_verified: false })]);
  });
  it('lets another account read nothing of it, even when it asks for this user_id and session id explicitly', async () => {
    expect((await read(D, C, 'done-1')).rows).toHaveLength(0);
    expect((await read(D, C, 'local-only-hr')).rows).toHaveLength(0);
    expect((await read(C, D, 'other-users-session')).rows).toHaveLength(0);
  });
  it('does not let the same session id join across accounts (D has no readings under C\'s session id)', async () => {
    expect((await read(D, D, 'done-1')).rows).toHaveLength(0);
    expect((await read(D, D, 'other-users-session')).rows.map((r) => r.value)).toEqual([99]);
  });
  it('is not readable by anon', async () => {
    await expect(as('anon', null, () => pg.query(READ('', C, 'done-1')))).rejects.toThrow(/permission denied/);
  });
  it('reading does not need any consent category: it works for an account whose consent was revoked afterwards', async () => {
    await consent(D, []); // revoke everything
    expect((await read(D, D, 'other-users-session')).rows.map((r) => r.value)).toEqual([99]);
    await expect(ingest(D, [smp('d2', START + 12 * 60_000, 'other-users-session')])).rejects.toThrow(/consent_required/);
  });
});

/* ------------------------------------------------------------------ BT-04C task 4: consent history (read) */
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
// The exact query SupabaseWearableStore.readConsentHistory sends (columns, filter, order, limit).
const HISTORY = (uid: string) => `select category, action, consent_version, created_at from public.wearable_consent_events where user_id = '${uid}' order by created_at desc, id desc limit 101`;
const history = (as_: string, uid: string) => as('authenticated', as_, () => pg.query<{ category: string; action: string; consent_version: number; created_at: string }>(HISTORY(uid)));

describe('consent history (wearable_consent_events): read-only audit trail', () => {
  beforeAll(async () => { await pg.exec(`insert into auth.users (id, email) values ('${E}','e@example.com'), ('${F}','f@example.com')`); });

  it('is empty for an account that never changed consent', async () => {
    expect((await history(E, E)).rows).toHaveLength(0);
  });
  it('returns the account\'s own events newest first, with a deterministic order inside one transaction timestamp', async () => {
    await consent(E, ['live_heart_rate', 'workout_health_sync']);
    await consent(E, ['workout_health_sync']);
    const rows = (await history(E, E)).rows;
    expect(rows[0]).toMatchObject({ category: 'live_heart_rate', action: 'revoked', consent_version: 1 });
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((r) => r.action)).toEqual(['granted', 'granted']);
    // Newest first, never out of order.
    const times = rows.map((r) => Date.parse(r.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Same query again gives the same order (id breaks ties).
    expect((await history(E, E)).rows).toEqual(rows);
  });
  it('keeps the history after everything is revoked (revoking adds a row; nothing is erased)', async () => {
    const before = (await history(E, E)).rows.length;
    await consent(E, []);
    const after = (await history(E, E)).rows;
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ category: 'workout_health_sync', action: 'revoked' });
    expect((await as('authenticated', E, () => pg.query('select * from public.wearable_ai_consents'))).rows).toHaveLength(0);
  });
  it('isolates accounts: filtering on another user id returns nothing, and an unfiltered read shows only the caller\'s rows', async () => {
    await consent(F, ['activity_metrics']);
    expect((await history(E, F)).rows).toHaveLength(0);
    expect((await history(F, E)).rows).toHaveLength(0);
    const own = (await as('authenticated', F, () => pg.query<{ user_id: string }>('select user_id from public.wearable_consent_events'))).rows;
    expect(new Set(own.map((r) => r.user_id))).toEqual(new Set([F]));
    expect((await history(F, F)).rows.map((r) => `${r.category}:${r.action}`)).toEqual(['activity_metrics:granted']);
    await consent(F, []);
  });
  it('cannot be edited or deleted by an account (no update, delete or truncate grant), and an attempt changes nothing', async () => {
    const before = (await history(E, E)).rows;
    await expect(as('authenticated', E, () => pg.query(`update public.wearable_consent_events set action = 'granted' where user_id = '${E}'`))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', E, () => pg.query(`delete from public.wearable_consent_events where user_id = '${E}'`))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', E, () => pg.query('truncate public.wearable_consent_events'))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', E, () => pg.query(`insert into public.wearable_consent_events (user_id, category, action, consent_version) values ('${E}','live_heart_rate','granted',1)`))).rejects.toThrow(/permission denied/);
    expect((await history(E, E)).rows).toEqual(before);
  });
  it('grants authenticated SELECT only, has exactly one policy (select own), and is closed to anon', async () => {
    const g = (await pg.query<{ p: string }>(`select privilege_type p from information_schema.role_table_grants where table_name='wearable_consent_events' and grantee='authenticated' order by 1`)).rows.map((r) => r.p);
    expect(g).toEqual(['SELECT']);
    const pol = (await pg.query<{ cmd: string }>(`select cmd from pg_policies where tablename='wearable_consent_events'`)).rows;
    expect(pol.map((p) => p.cmd)).toEqual(['SELECT']);
    await expect(as('anon', null, () => pg.query(HISTORY(E)))).rejects.toThrow(/permission denied/);
  });
  it('a caller with no identity sees nothing', async () => {
    expect((await as('authenticated', null, () => pg.query(HISTORY(E)))).rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ BT-04C task 5: stored history read for Coach Iron */
describe('recent heart-rate read (the server-built Coach Iron summary)', () => {
  const G = '99999999-9999-4999-8999-999999999999';
  const H = '88888888-8888-4888-8888-888888888888';
  const DAY = 86_400_000;
  const k = (n: string) => `chist-${n}`;
  const at = (ms: number) => new Date(Date.now() - ms).toISOString();
  const smp = (n: string, agoMs: number, sid: string | null, over: Record<string, unknown> = {}) =>
    sampleJson({ dedupe_key: k(n), measured_at: at(agoMs), ...(sid ? { workout_session_id: sid } : {}), ...over });
  // The exact filters SupabaseWearableStore.readRecentHeartRate sends, plus a test-only dedupe_key prefix so earlier describe blocks'
  // rows cannot collide with the exact-list assertions (the prefix only narrows the result).
  const RECENT = (forUser: string, sinceMs: number) => `select value, measured_at, workout_session_id from public.wearable_samples
    where user_id = '${forUser}' and metric = 'heart_rate' and origin in ('live','synchronized') and workout_session_id is not null
    and measured_at >= '${at(sinceMs)}' and dedupe_key like 'chist-%' order by measured_at desc, id desc limit 1000`;
  const recent = (asUser: string, forUser: string, sinceMs = 30 * DAY) =>
    as('authenticated', asUser, () => pg.query<{ value: number; measured_at: string; workout_session_id: string }>(RECENT(forUser, sinceMs)));

  beforeAll(async () => {
    await pg.exec(`insert into auth.users (id, email) values ('${G}','g@example.com'), ('${H}','h@example.com')`);
    await consent(G, ['workout_health_sync']);
    await consent(H, ['workout_health_sync']);
    await ingest(G, [
      smp('g1', 2 * DAY, 's1', { value: 130 }),
      smp('g2', 2 * DAY - 30_000, 's1', { value: 141, origin: 'synchronized' }),
      smp('g3', 2 * DAY - 60_000, 's1', { value: 150, origin: 'manual', quality: 'user_entered' }),
      smp('g4', 3 * DAY, null, { value: 160 }),
      smp('g5', 45 * DAY, 's-old', { value: 170 }),
      smp('g6', 2 * DAY - 90_000, 's1', { metric: 'resting_heart_rate', value: 55 }),
      smp('g7', 1 * DAY, 's2', { value: 120 })
    ]);
    await ingest(H, [smp('h1', 2 * DAY, 's1', { value: 99 })]);
  });

  it('returns only the account\'s own labelled heart-rate readings from a real device, inside the window, newest first', async () => {
    const rows = (await recent(G, G)).rows;
    expect(rows.map((r) => r.value)).toEqual([120, 141, 130]);
    expect(rows.map((r) => r.workout_session_id)).toEqual(['s2', 's1', 's1']);
  });
  it('leaves out manual entries, unlabelled readings, other metrics and anything older than the window', async () => {
    const values = (await recent(G, G)).rows.map((r) => r.value);
    for (const excluded of [150, 160, 170, 55]) expect(values).not.toContain(excluded);
    expect((await recent(G, G, 60 * DAY)).rows.map((r) => r.value)).toContain(170);
  });
  it('isolates accounts: a forged user id filter returns nothing, and an unfiltered read shows only the caller\'s rows', async () => {
    expect((await recent(G, H)).rows).toHaveLength(0);
    expect((await recent(H, G)).rows).toHaveLength(0);
    expect((await recent(H, H)).rows.map((r) => r.value)).toEqual([99]);
    const own = (await as('authenticated', H, () => pg.query<{ user_id: string }>(`select user_id from public.wearable_samples where dedupe_key like 'chist-%'`))).rows;
    expect(new Set(own.map((r) => r.user_id))).toEqual(new Set([H]));
  });
  it('is not readable by anon or by a caller with no identity', async () => {
    await expect(as('anon', null, () => pg.query(RECENT(G, 30 * DAY)))).rejects.toThrow(/permission denied/);
    expect((await as('authenticated', null, () => pg.query(RECENT(G, 30 * DAY)))).rows).toHaveLength(0);
  });
  it('reading needs no consent row: stored readings stay readable after consent is revoked (the AI gate is in the API, not here)', async () => {
    await consent(G, []);
    expect((await recent(G, G)).rows).toHaveLength(3);
  });
});
