#!/usr/bin/env node
/**
 * BT-04C task 7: STAGING verification of supabase/proposed/20261117000000_wearable_consent_ingest_hardening.sql
 *
 * NOT part of the test suite, never run automatically, and it refuses to run against anything but an explicitly confirmed staging
 * project. It talks to Supabase exactly like the browser does (anon key + each test user's own session) so it proves what RLS,
 * grants and the two RPCs allow through PostgREST, which the PGlite tests cannot.
 *
 * Requirements (owner provides; nothing here creates accounts for you):
 *   - A Supabase STAGING project or branch with the proposed migration applied.
 *   - TWO dedicated test accounts (A and B) that contain no real data. Never use real user accounts.
 *
 * Env:
 *   STAGING_CONFIRM=I_HAVE_OWNER_APPROVAL_FOR_STAGING   required
 *   SUPABASE_URL, SUPABASE_ANON_KEY                     the staging project
 *   STAGING_EXPECTED_REF=<project ref>                  must equal the first label of SUPABASE_URL's host (typo guard)
 *   PRODUCTION_REF=<ref>                                optional; the script refuses if it equals the URL's ref
 *   TEST_A_EMAIL, TEST_A_PASSWORD, TEST_B_EMAIL, TEST_B_PASSWORD
 *   STAGING_SERVICE_ROLE_KEY                            optional; only enables the deletion-cascade step (creates and deletes its OWN throwaway user)
 *
 * Usage:  node scripts/staging/verifyWearableMigration.mjs --plan     (prints the steps, makes no request)
 *         node scripts/staging/verifyWearableMigration.mjs            (runs against staging)
 * Everything it writes is tagged with a per-run prefix and removed again at the end (best effort; it reports leftovers).
 */
import { createClient } from '@supabase/supabase-js';

const STEPS = [];
const step = (id, title, fn) => STEPS.push({ id, title, fn });
const RUN = `v7-${Date.now().toString(36)}`;
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.now() - 60 * 60 * 1000;

const sample = (key, ts, o = {}) => ({
  metric: 'heart_rate', value: 120, unit: 'bpm', measured_at: iso(ts), origin: 'live', quality: 'device_reported', dedupe_key: `${RUN}:${key}`, ...o
});
const DEV = (k = 'strap') => ({ device_key: `${RUN}:${k}`, manufacturer: 'Unknown', display_name: 'Staging test strap', ingestion_method: 'direct_ble' });

let A; let B; let anon; let admin;
const denied = (res) => !!res.error; // PostgREST returns an error object for permission-denied / policy / constraint violations

// ---- 0. Preconditions ---------------------------------------------------------------------------------------------------
step('P01', 'Anonymous role cannot call set_my_wearable_consent or ingest_wearable_batch', async () => {
  const c = await anon.rpc('set_my_wearable_consent', { p_categories: [], p_version: 1 });
  const i = await anon.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [] });
  return [denied(c) && denied(i), `consent:${c.error?.code ?? 'none'} ingest:${i.error?.code ?? 'none'}`];
});
step('P02', 'Helper wearable_try_timestamptz is not callable by authenticated', async () => {
  const r = await A.rpc('wearable_try_timestamptz', { p: iso(T0) });
  return [denied(r), r.error?.code ?? 'callable (FAIL)'];
});
step('P03', 'Reset both test accounts to no consent', async () => {
  const a = await A.rpc('set_my_wearable_consent', { p_categories: [], p_version: 1 });
  const b = await B.rpc('set_my_wearable_consent', { p_categories: [], p_version: 1 });
  return [!a.error && !b.error, `${a.error?.message ?? 'ok'} / ${b.error?.message ?? 'ok'}`];
});

// ---- 1. Ingest without consent / direct writes ---------------------------------------------------------------------------
step('I01', 'Ingest RPC refuses a user with no workout_health_sync consent', async () => {
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('nc1', T0)] });
  const { count } = await A.from('wearable_samples').select('*', { count: 'exact', head: true }).like('dedupe_key', `${RUN}:%`);
  return [denied(r) && /consent_required/.test(r.error?.message ?? '') && count === 0, `${r.error?.message ?? 'no error (FAIL)'} stored:${count}`];
});
step('I02', 'Direct INSERT into wearable_samples / wearable_devices is denied for authenticated', async () => {
  const dev = await A.from('wearable_devices').insert({ device_key: `${RUN}:direct`, manufacturer: 'x', ingestion_method: 'direct_ble' });
  const smp = await A.from('wearable_samples').insert({ device_id: '00000000-0000-0000-0000-000000000000', metric: 'heart_rate', value: 100, unit: 'bpm', measured_at: iso(T0), origin: 'live', dedupe_key: `${RUN}:direct` });
  return [denied(dev) && denied(smp), `devices:${dev.error?.code ?? 'ok(FAIL)'} samples:${smp.error?.code ?? 'ok(FAIL)'}`];
});
step('I03', 'Direct INSERT into wearable_connections and provider credentials is denied', async () => {
  const c = await A.from('wearable_connections').insert({ provider: 'x', ingestion_method: 'cloud_api' });
  const k = await A.from('wearable_provider_credentials').insert({ connection_id: '00000000-0000-0000-0000-000000000000', secret_ref: 'x' });
  return [denied(c) && denied(k), `connections:${c.error?.code ?? 'ok(FAIL)'} credentials:${k.error?.code ?? 'ok(FAIL)'}`];
});

// ---- 2. Consent RPC, audit trail, isolation -----------------------------------------------------------------------------
step('C01', 'Direct write to wearable_ai_consents is denied (insert, update, delete)', async () => {
  const i = await A.from('wearable_ai_consents').insert({ user_id: (await A.auth.getUser()).data.user.id, version: 1, categories: ['live_heart_rate'] });
  const u = await A.from('wearable_ai_consents').update({ categories: ['live_heart_rate'] }).neq('version', -1).select();
  const d = await A.from('wearable_ai_consents').delete().neq('version', -1).select();
  return [denied(i) && (denied(u) || (u.data ?? []).length === 0) && (denied(d) || (d.data ?? []).length === 0), `i:${i.error?.code ?? 'ok(FAIL)'} u:${u.error?.code ?? u.data?.length} d:${d.error?.code ?? d.data?.length}`];
});
step('C02', 'RPC rejects unknown categories and bad versions', async () => {
  const bad = await A.rpc('set_my_wearable_consent', { p_categories: ['everything'], p_version: 1 });
  const ver = await A.rpc('set_my_wearable_consent', { p_categories: ['live_heart_rate'], p_version: 0 });
  return [denied(bad) && denied(ver), `${bad.error?.code ?? 'ok(FAIL)'} / ${ver.error?.code ?? 'ok(FAIL)'}`];
});
step('C03', 'A grants live_heart_rate + workout_health_sync: row and two granted audit events', async () => {
  const r = await A.rpc('set_my_wearable_consent', { p_categories: ['live_heart_rate', 'workout_health_sync'], p_version: 1 });
  const row = await A.from('wearable_ai_consents').select('categories,version').maybeSingle();
  const ev = await A.from('wearable_consent_events').select('category,action,consent_version');
  const granted = (ev.data ?? []).filter((e) => e.action === 'granted').map((e) => e.category).sort();
  const ok = !r.error && row.data?.version === 1 && [...(row.data?.categories ?? [])].sort().join() === 'live_heart_rate,workout_health_sync' && granted.join() === 'live_heart_rate,workout_health_sync';
  return [ok, `row:${JSON.stringify(row.data)} granted:${granted}`];
});
step('C04', 'Account isolation: B sees none of A\'s consent row or audit events', async () => {
  const row = await B.from('wearable_ai_consents').select('*');
  const ev = await B.from('wearable_consent_events').select('*');
  return [!row.error && !ev.error && row.data.length === 0 && ev.data.length === 0, `rows:${row.data?.length} events:${ev.data?.length}`];
});
step('C05', 'Audit table is append-only for clients (insert, update, delete denied)', async () => {
  const uid = (await A.auth.getUser()).data.user.id;
  const i = await A.from('wearable_consent_events').insert({ user_id: uid, category: 'live_heart_rate', action: 'granted', consent_version: 1 });
  const u = await A.from('wearable_consent_events').update({ action: 'revoked' }).neq('id', -1).select();
  const d = await A.from('wearable_consent_events').delete().neq('id', -1).select();
  const stillThere = await A.from('wearable_consent_events').select('id', { count: 'exact', head: true });
  return [denied(i) && (denied(u) || u.data.length === 0) && (denied(d) || d.data.length === 0) && stillThere.count >= 2, `i:${i.error?.code ?? 'ok(FAIL)'} u:${u.error?.code ?? u.data?.length} d:${d.error?.code ?? d.data?.length} count:${stillThere.count}`];
});
step('C06', 'Revoking one category writes a revoked event and leaves the other granted', async () => {
  const r = await A.rpc('set_my_wearable_consent', { p_categories: ['workout_health_sync'], p_version: 1 });
  const row = await A.from('wearable_ai_consents').select('categories').maybeSingle();
  const ev = await A.from('wearable_consent_events').select('category,action').eq('action', 'revoked');
  return [!r.error && row.data?.categories?.join() === 'workout_health_sync' && (ev.data ?? []).some((e) => e.category === 'live_heart_rate'), `cats:${row.data?.categories} revoked:${JSON.stringify(ev.data)}`];
});
step('C07', 'A new consent version re-grants every category (old version never counts)', async () => {
  const before = (await A.from('wearable_consent_events').select('id', { count: 'exact', head: true })).count;
  const r = await A.rpc('set_my_wearable_consent', { p_categories: ['workout_health_sync'], p_version: 2 });
  const after = (await A.from('wearable_consent_events').select('id', { count: 'exact', head: true })).count;
  const back = await A.rpc('set_my_wearable_consent', { p_categories: ['workout_health_sync'], p_version: 1 });
  return [!r.error && !back.error && after > before, `events ${before} -> ${after}`];
});
step('C08', 'B grants workout_health_sync (needed for isolation steps)', async () => {
  const r = await B.rpc('set_my_wearable_consent', { p_categories: ['workout_health_sync'], p_version: 1 });
  return [!r.error, r.error?.message ?? 'ok'];
});

// ---- 3. Ingest, idempotency, validation ---------------------------------------------------------------------------------
step('I04', 'Ingest stores samples for the CALLER (owner derived from auth.uid), unlabelled session = null verified', async () => {
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('a1', T0), sample('a2', T0 + 5000)] });
  const rows = await A.from('wearable_samples').select('user_id,workout_session_verified,origin').like('dedupe_key', `${RUN}:a%`);
  const uid = (await A.auth.getUser()).data.user.id;
  return [!r.error && r.data.inserted_keys.length === 2 && rows.data.length === 2 && rows.data.every((x) => x.user_id === uid && x.workout_session_verified === null), `inserted:${r.data?.inserted_keys?.length} ${r.error?.message ?? ''}`];
});
step('I05', 'Resending the same samples is idempotent (no new rows, no error)', async () => {
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('a1', T0), sample('a2', T0 + 5000)] });
  const { count } = await A.from('wearable_samples').select('*', { count: 'exact', head: true }).like('dedupe_key', `${RUN}:a%`);
  return [!r.error && r.data.inserted_keys.length === 0 && count === 2, `inserted:${r.data?.inserted_keys?.length} total:${count}`];
});
step('I06', 'Concurrent identical batches create each row once', async () => {
  const batch = [sample('race1', T0 + 9000), sample('race2', T0 + 9500)];
  const rs = await Promise.all([1, 2, 3, 4].map(() => A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: batch })));
  const { count } = await A.from('wearable_samples').select('*', { count: 'exact', head: true }).like('dedupe_key', `${RUN}:race%`);
  const insertedTotal = rs.reduce((n, r) => n + (r.data?.inserted_keys?.length ?? 0), 0);
  return [count === 2 && insertedTotal === 2, `rows:${count} reportedInserted:${insertedTotal} errors:${rs.filter((r) => r.error).length}`];
});
step('I07', 'Same dedupe_key from B is B\'s own row; A\'s data is untouched', async () => {
  const r = await B.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('a1', T0, { value: 77 })] });
  const a = await A.from('wearable_samples').select('value').eq('dedupe_key', `${RUN}:a1`).single();
  const b = await B.from('wearable_samples').select('value').eq('dedupe_key', `${RUN}:a1`).single();
  return [!r.error && a.data?.value === 120 && b.data?.value === 77, `A:${a.data?.value} B:${b.data?.value} ${r.error?.message ?? ''}`];
});
step('I08', 'Cross-user read/delete: B sees none of A\'s samples/devices and cannot delete them', async () => {
  const s = await B.from('wearable_samples').select('id').like('dedupe_key', `${RUN}:a2`);
  const dv = await B.from('wearable_devices').select('id').eq('device_key', `${RUN}:strap`);
  const del = await B.from('wearable_samples').delete().like('dedupe_key', `${RUN}:a2`).select();
  const still = await A.from('wearable_samples').select('id').eq('dedupe_key', `${RUN}:a2`);
  return [s.data?.length === 0 && dv.data?.length === 1 /* B's own device row only */ && (del.data ?? []).length === 0 && still.data?.length === 1, `Bsamples:${s.data?.length} Bdel:${del.data?.length} Astill:${still.data?.length}`];
});
step('I09', 'Simulated origin cannot be stored', async () => {
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('sim', T0, { origin: 'simulated' })] });
  const { count } = await A.from('wearable_samples').select('*', { count: 'exact', head: true }).eq('dedupe_key', `${RUN}:sim`);
  return [denied(r) && count === 0, r.error?.code ?? 'accepted (FAIL)'];
});
step('I10', 'Implausible value, wrong unit and unknown metric are rejected (nothing stored)', async () => {
  const bad = [sample('bad1', T0, { value: 300 }), sample('bad2', T0, { unit: 'kcal' }), sample('bad3', T0, { metric: 'blood_sugar' })];
  const rs = await Promise.all(bad.map((s) => A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [s] })));
  const { count } = await A.from('wearable_samples').select('*', { count: 'exact', head: true }).like('dedupe_key', `${RUN}:bad%`);
  return [rs.every(denied) && count === 0, rs.map((r) => r.error?.code ?? 'ok(FAIL)').join(',')];
});
step('I11', 'Batches over 500 are rejected', async () => {
  const many = Array.from({ length: 501 }, (_, i) => sample(`big${i}`, T0 + i));
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: many });
  return [denied(r), r.error?.code ?? 'accepted (FAIL)'];
});

// ---- 4. Server-side workout-session verification -------------------------------------------------------------------------
step('S01', 'Setup: A cloud-syncs a completed session (own workout_sessions row)', async () => {
  const r = await A.from('workout_sessions').upsert({ id: `${RUN}:sess`, data: { status: 'completed', startTime: iso(T0), endTime: iso(T0 + 30 * 60_000), date: iso(T0).slice(0, 10) } });
  return [!r.error, r.error?.message ?? 'ok'];
});
step('S02', 'Inside the window = verified; outside = not stored (rejected_keys); unsynced label = stored unverified', async () => {
  const sid = `${RUN}:sess`;
  const r = await A.rpc('ingest_wearable_batch', {
    p_device: DEV(), p_samples: [
      sample('in', T0 + 10 * 60_000, { workout_session_id: sid }),
      sample('out', T0 + 45 * 60_000, { workout_session_id: sid }) /* session ends at +30 min; window allows +5 min of skew */,
      sample('unsynced', T0 + 60_000, { workout_session_id: `${RUN}:nope` })
    ]
  });
  const rows = await A.from('wearable_samples').select('dedupe_key,workout_session_verified').like('dedupe_key', `${RUN}:%`).in('dedupe_key', [`${RUN}:in`, `${RUN}:out`, `${RUN}:unsynced`]);
  const by = Object.fromEntries((rows.data ?? []).map((x) => [x.dedupe_key.slice(RUN.length + 1), x.workout_session_verified]));
  return [!r.error && by.in === true && by.unsynced === false && !('out' in by) && r.data.rejected_keys.includes(`${RUN}:out`), JSON.stringify(by) + ` rejected:${JSON.stringify(r.data?.rejected_keys)}`];
});
step('S03', 'A client-supplied workout_session_verified is ignored', async () => {
  const r = await A.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('claim', T0 + 70_000, { workout_session_id: `${RUN}:nope`, workout_session_verified: true })] });
  const row = await A.from('wearable_samples').select('workout_session_verified').eq('dedupe_key', `${RUN}:claim`).maybeSingle();
  return [!r.error && row.data?.workout_session_verified === false, `stored:${row.data?.workout_session_verified} ${r.error?.message ?? ''}`];
});
step('S04', 'B labelling A\'s session id gets unverified (sessions never link across accounts)', async () => {
  const r = await B.rpc('ingest_wearable_batch', { p_device: DEV(), p_samples: [sample('bx', T0 + 10 * 60_000, { workout_session_id: `${RUN}:sess` })] });
  const row = await B.from('wearable_samples').select('workout_session_verified').eq('dedupe_key', `${RUN}:bx`).maybeSingle();
  return [!r.error && row.data?.workout_session_verified === false, `stored:${row.data?.workout_session_verified}`];
});
step('R01', 'Workout-HR read shape (own session, RLS): A gets its verified row; B sees only its own labelled row', async () => {
  const a = await A.from('wearable_samples').select('measured_at,value,workout_session_verified').eq('workout_session_id', `${RUN}:sess`).eq('metric', 'heart_rate');
  const b = await B.from('wearable_samples').select('measured_at').eq('workout_session_id', `${RUN}:sess`);
  // B's own 'bx' row carries the same label, so B legitimately sees exactly 1 row (its own); A's verified row must never appear for B.
  return [!a.error && a.data.length === 1 && a.data[0].workout_session_verified === true && b.data.length === 1, `A:${a.data?.length} B:${b.data?.length}`];
});

// ---- 5. Credentials ------------------------------------------------------------------------------------------------------
step('K01', 'wearable_provider_credentials: anon and authenticated can neither read nor write', async () => {
  const a = await anon.from('wearable_provider_credentials').select('*');
  const u = await A.from('wearable_provider_credentials').select('*');
  const w = await A.from('wearable_provider_credentials').delete().neq('secret_ref', '').select();
  const closed = (r) => !!r.error || (r.data ?? []).length === 0;
  return [closed(a) && closed(u) && closed(w), `anon:${a.error?.code ?? a.data?.length} auth:${u.error?.code ?? u.data?.length}`];
});

// ---- 6. Optional: deletion cascade (needs the staging service-role key; uses its own throwaway user) -----------------------
step('D01', 'Deleting a user cascades to devices, samples, consent, audit events (OPTIONAL: needs STAGING_SERVICE_ROLE_KEY)', async () => {
  if (!admin) return ['skip', 'STAGING_SERVICE_ROLE_KEY not set'];
  const email = `${RUN}-cascade@example.invalid`; const password = `${RUN}-Aa1!${Math.random().toString(36).slice(2)}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) return [false, created.error.message];
  const uid = created.data.user.id;
  try {
    const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await c.auth.signInWithPassword({ email, password });
    if (si.error) return [false, si.error.message];
    await c.rpc('set_my_wearable_consent', { p_categories: ['workout_health_sync'], p_version: 1 });
    await c.rpc('ingest_wearable_batch', { p_device: DEV('casc'), p_samples: [sample('casc1', T0)] });
    const before = await Promise.all(['wearable_samples', 'wearable_devices', 'wearable_ai_consents', 'wearable_consent_events'].map((t) => admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)));
    const del = await admin.auth.admin.deleteUser(uid);
    const after = await Promise.all(['wearable_samples', 'wearable_devices', 'wearable_ai_consents', 'wearable_consent_events'].map((t) => admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)));
    const b = before.map((x) => x.count); const a = after.map((x) => x.count);
    return [!del.error && b.every((n) => n >= 1) && a.every((n) => n === 0), `before:${b} after:${a}`];
  } catch (e) { await admin.auth.admin.deleteUser(uid).catch(() => {}); return [false, String(e?.message ?? e)]; }
});

// ---- Cleanup -------------------------------------------------------------------------------------------------------------
async function cleanup() {
  const left = [];
  for (const [name, c] of [['A', A], ['B', B]]) {
    await c.from('wearable_samples').delete().like('dedupe_key', `${RUN}:%`);
    await c.from('wearable_devices').delete().like('device_key', `${RUN}:%`);
    await c.from('workout_sessions').delete().like('id', `${RUN}:%`);
    await c.rpc('set_my_wearable_consent', { p_categories: [], p_version: 1 });
    const s = await c.from('wearable_samples').select('*', { count: 'exact', head: true }).like('dedupe_key', `${RUN}:%`);
    if (s.count) left.push(`${name}: ${s.count} samples`);
  }
  return left;
}

// ---- Runner --------------------------------------------------------------------------------------------------------------
async function main() {
  if (process.argv.includes('--plan')) {
    for (const s of STEPS) console.log(`${s.id}  ${s.title}`);
    console.log(`\n${STEPS.length} steps. No request was made.`);
    return 0;
  }
  const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STAGING_EXPECTED_REF', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
  const missing = need.filter((k) => !process.env[k]);
  if (process.env.STAGING_CONFIRM !== 'I_HAVE_OWNER_APPROVAL_FOR_STAGING') { console.error('Refusing to run: STAGING_CONFIRM is not set to the approval phrase.'); return 2; }
  if (missing.length) { console.error(`Refusing to run: missing ${missing.join(', ')}`); return 2; }
  const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  if (ref !== process.env.STAGING_EXPECTED_REF) { console.error('Refusing to run: SUPABASE_URL does not match STAGING_EXPECTED_REF.'); return 2; }
  if (process.env.PRODUCTION_REF && ref === process.env.PRODUCTION_REF) { console.error('Refusing to run: this is the production project.'); return 2; }
  if (process.env.TEST_A_EMAIL === process.env.TEST_B_EMAIL) { console.error('Refusing to run: test accounts A and B must differ.'); return 2; }

  const mk = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = mk(); A = mk(); B = mk();
  if (process.env.STAGING_SERVICE_ROLE_KEY) admin = createClient(process.env.SUPABASE_URL, process.env.STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [c, e, p] of [[A, 'TEST_A_EMAIL', 'TEST_A_PASSWORD'], [B, 'TEST_B_EMAIL', 'TEST_B_PASSWORD']]) {
    const r = await c.auth.signInWithPassword({ email: process.env[e], password: process.env[p] });
    if (r.error) { console.error(`Sign-in failed for ${e}: ${r.error.message}`); return 2; }
  }
  console.log(`Run ${RUN} against ${ref}\n`);
  const results = [];
  for (const s of STEPS) {
    let out;
    try { out = await s.fn(); } catch (e) { out = [false, `threw: ${e?.message ?? e}`]; }
    const status = out[0] === 'skip' ? 'SKIP' : out[0] ? 'PASS' : 'FAIL';
    results.push({ id: s.id, status });
    console.log(`${status}  ${s.id}  ${s.title}\n      ${out[1]}`);
  }
  const left = await cleanup();
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${fails} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped.`);
  console.log(left.length ? `Cleanup left rows: ${left.join('; ')}` : 'Cleanup: nothing left under this run prefix.');
  return fails ? 1 : 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e?.message ?? e); process.exit(2); });
