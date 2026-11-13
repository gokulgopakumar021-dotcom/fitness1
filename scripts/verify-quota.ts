/**
 * Opt-in check of the LIVE Supabase daily-quota setup, run by the owner on their own machine. Never part of the server
 * start-up and never run by tests against a real project.
 *
 *   npm run verify:quota                 read-only probe (writes nothing)
 *   npm run verify:quota -- --consume    additionally consumes two REAL AI buckets of the test user (writes 2 counter rows)
 *
 * It drives the SAME `SupabaseQuotaStore` class the server uses, so it checks the real code path:
 * publishable key + the caller's JWT -> PostgREST -> `public.consume_ai_quota`.
 *
 * Inputs (environment variables only; values are never printed):
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)
 *   VERIFY_QUOTA_JWT                          a test user's access token, OR
 *   VERIFY_QUOTA_EMAIL + VERIFY_QUOTA_PASSWORD  a dedicated test account; the script signs in itself and keeps the
 *                                             token in memory (this creates an auth session for that account).
 *
 * Since the IL-04 migration (20261103061647_ai_quota_bucket_allowlist.sql) the live function accepts ONLY the buckets
 * of the `ai: true` endpoints in src/server/security/endpoints.ts and raises 22023 `unknown bucket` for anything else,
 * so this script takes its buckets from that same list and invents none.
 *
 * The default probe calls `consume_ai_quota(<real bucket>, 0)`. With a limit of 0 the function validates the bucket and
 * then returns before it touches the table, so it proves existence, EXECUTE permission for `authenticated`, auth.uid()
 * resolution, the allow-list and the reply shape without consuming anything. `--consume` uses two further real buckets
 * (limit 3) and leaves two counter rows (used = 3) for the test user for the rest of that UTC day, so it can be run once
 * per UTC day per test account and the account must be a dedicated one. The rows are removed by the function's own
 * 7-day housekeeping; see docs/security/quota-store.md.
 *
 * Exit code: 0 all checks passed, 1 a check failed, 2 bad usage or configuration.
 */
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ENDPOINTS } from '../src/server/security/endpoints';
import { QuotaStoreUnavailableError, SupabaseQuotaStore, type QuotaStore } from '../src/server/security/quota';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyOptions {
  store: QuotaStore;
  /** Access token of the test user. */
  token: string;
  /** Publishable key used as a bearer, i.e. an anonymous caller. Skipped when absent. */
  anonToken?: string;
  consume: boolean;
  nowSeconds?: () => number;
}

const HINTS: Record<string, string> = {
  rpc_PGRST202: 'function not found in the API schema cache: migration not applied to this project, or the schema cache has not reloaded',
  rpc_42883: 'function does not exist: migration not applied',
  rpc_42501: 'permission denied: EXECUTE is not granted to `authenticated`',
  rpc_22023: 'the function refused the arguments or the bucket ("unknown bucket"): this script and the live allow-list disagree, compare endpoints.ts with the applied migration',
  rpc_28000: 'the function did not see an authenticated user (auth.uid() is null)',
  rpc_PGRST301: 'the API rejected the JWT (expired, wrong project, or bad signature)',
  rpc_PGRST303: 'the API rejected the JWT',
  timeout: 'no answer within the store timeout',
  transport: 'could not reach the API (network, DNS or wrong SUPABASE_URL)',
  bad_shape: 'the function answered with an unexpected shape'
};
const describeReason = (reason: string) => (HINTS[reason] ? `${reason}: ${HINTS[reason]}` : reason);

/** Decodes the JWT payload locally to check shape and expiry. Claims are never printed. */
function inspectJwt(token: string, nowSeconds: number): { ok: boolean; detail: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, detail: 'not a JWT (expected three dot-separated parts)' };
  let payload: { exp?: unknown; role?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, detail: 'payload is not valid JSON' };
  }
  if (typeof payload.exp !== 'number') return { ok: false, detail: 'no numeric exp claim' };
  if (payload.exp <= nowSeconds) return { ok: false, detail: 'token is expired; sign in again for a fresh one' };
  if (payload.role !== undefined && payload.role !== 'authenticated') return { ok: false, detail: 'role claim is not "authenticated" (not a signed-in user token)' };
  return { ok: true, detail: `valid shape, expires in ${Math.round((payload.exp - nowSeconds) / 60)} min` };
}

/**
 * The only buckets this script may use: the `ai: true` buckets of the real endpoints, in the order they are declared.
 * The live function rejects every other name (IL-04). The first is used for the limit-0 probes, the next two for --consume.
 */
export const AI_BUCKETS: readonly string[] = Object.values(ENDPOINTS).filter((p) => p.ai).map((p) => p.bucket);
const [PROBE_BUCKET, SEQ_BUCKET, PAR_BUCKET] = AI_BUCKETS;

const req = (bucket: string, limit: number, accessToken: string) => ({
  userId: 'verify-quota',
  bucket,
  limit,
  day: new Date().toISOString().slice(0, 10),
  accessToken
});

export async function runVerification(opts: VerifyOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const now = (opts.nowSeconds ?? (() => Date.now() / 1000))();

  const jwt = inspectJwt(opts.token, now);
  push('test user token looks valid', jwt.ok, jwt.detail);
  if (!jwt.ok) return checks;

  try {
    const d = await opts.store.consume(req(PROBE_BUCKET, 0, opts.token));
    const ok = d.allowed === false && d.used === 0;
    push('function reachable and executable by `authenticated` (limit-0 probe, writes nothing)', ok, ok ? 'answered allowed=false used=0' : `unexpected answer allowed=${d.allowed} used=${d.used}`);
    if (!ok) return checks;
  } catch (e) {
    push('function reachable and executable by `authenticated` (limit-0 probe, writes nothing)', false, e instanceof QuotaStoreUnavailableError ? describeReason(e.reason) : 'unexpected error');
    return checks;
  }

  if (opts.anonToken) {
    try {
      await opts.store.consume(req(PROBE_BUCKET, 0, opts.anonToken));
      push('anonymous caller is refused', false, 'an anonymous call was ANSWERED; EXECUTE must not be granted to anon/PUBLIC');
    } catch (e) {
      // A refusal only counts if the API itself answered; a timeout or network error proves nothing about permissions.
      const answered = e instanceof QuotaStoreUnavailableError && !['transport', 'timeout', 'not_configured', 'no_token'].includes(e.reason);
      push('anonymous caller is refused', answered, e instanceof QuotaStoreUnavailableError ? `${answered ? 'refused' : 'inconclusive'} (${describeReason(e.reason)})` : 'unexpected error');
    }
  }

  if (opts.consume) {
    try {
      const seqBucket = SEQ_BUCKET;
      const seq = [];
      for (let i = 0; i < 4; i++) seq.push(await opts.store.consume(req(seqBucket, 3, opts.token)));
      const okSeq = seq.map((d) => `${d.allowed}:${d.used}`).join(',') === 'true:1,true:2,true:3,false:3';
      const seqDetail = seq.map((d) => `${d.allowed ? 'allow' : 'deny'}(${d.used})`).join(' ');
      push('limit 3: three calls allowed, the fourth refused with the counter held at 3', okSeq, !okSeq && !seq[0].allowed ? `${seqDetail}; the counter was already at its limit, so --consume was probably already run today (UTC) for this account: wait for 00:00 UTC or use another dedicated test account` : seqDetail);

      const parBucket = PAR_BUCKET;
      const par = await Promise.all(Array.from({ length: 8 }, () => opts.store.consume(req(parBucket, 3, opts.token))));
      const allowed = par.filter((d) => d.allowed).length;
      push('8 simultaneous requests against limit 3: exactly 3 allowed', allowed === 3, `${allowed} allowed, ${par.length - allowed} refused${allowed === 0 ? '; the counter was already at its limit, so --consume was probably already run today (UTC) for this account' : ''}`);
    } catch (e) {
      push('consumption sequence', false, e instanceof QuotaStoreUnavailableError ? describeReason(e.reason) : 'unexpected error');
    }
  }
  return checks;
}

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--consume');
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}. Usage: npm run verify:quota [-- --consume]`);
    return 2;
  }
  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
  const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  let token = env('VERIFY_QUOTA_JWT');
  const email = env('VERIFY_QUOTA_EMAIL');
  const password = process.env.VERIFY_QUOTA_PASSWORD;
  if (!token && !(email && password)) missing.push('VERIFY_QUOTA_JWT (or VERIFY_QUOTA_EMAIL + VERIFY_QUOTA_PASSWORD)');
  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}. See docs/security/quota-store.md. Nothing was contacted.`);
    return 2;
  }

  if (!token) {
    const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.signInWithPassword({ email: email!, password: password! });
    if (error || !data.session) {
      console.error(`Sign-in with VERIFY_QUOTA_EMAIL failed (status ${error?.status ?? 'unknown'}). Check the account exists and email sign-in is enabled.`);
      return 2;
    }
    token = data.session.access_token;
  }

  const consume = args.includes('--consume');
  console.log(consume ? 'Mode: probe + consume (writes two real-bucket counter rows for the test user, used = 3 each)' : 'Mode: read-only probe (nothing is written)');
  const checks = await runVerification({ store: new SupabaseQuotaStore({ supabaseUrl: url, supabaseKey: key }, { timeoutMs: 10_000 }), token: token!, anonToken: key, consume });
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED.` : '\nAll checks passed.');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.error('verify:quota failed unexpectedly.');
      process.exit(1);
    }
  );
}
