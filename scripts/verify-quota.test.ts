// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuotaStoreUnavailableError, type QuotaDecision, type QuotaRequest, type QuotaStore } from '../src/server/security/quota';
import { ENDPOINTS } from '../src/server/security/endpoints';
import { AI_BUCKETS, runVerification } from './verify-quota';

const ROOT = path.resolve(import.meta.dirname, '..');
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = 1_800_000_000;
const jwt = (claims: object) => `${b64({ alg: 'ES256' })}.${b64(claims)}.c2lnbmF0dXJl`;
const GOOD = jwt({ exp: NOW + 3600, role: 'authenticated', sub: 'u' });

/** IL-04: the buckets the live `consume_ai_quota` accepts = the `ai: true` buckets of src/server/security/endpoints.ts. */
const AI_ENDPOINT_BUCKETS = new Set(Object.values(ENDPOINTS).filter((p) => p.ai).map((p) => p.bucket));
const readRoot = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** The list actually baked into the applied migration (a second source, so the script cannot drift from the database). */
const MIGRATION_BUCKETS = new Set(
  [...(readRoot('supabase/migrations/20261103000000_ai_quota_bucket_allowlist.sql').match(/v_allowed constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
);

/** Behaves like the SQL function: refuses unknown buckets (22023, even at limit 0), atomic per bucket, limit 0 never stores. */
class FakeStore implements QuotaStore {
  calls: QuotaRequest[] = [];
  private counts = new Map<string, number>();
  constructor(private readonly onCall?: (r: QuotaRequest) => QuotaDecision | Promise<QuotaDecision>) {}
  async consume(r: QuotaRequest): Promise<QuotaDecision> {
    this.calls.push(r);
    if (!AI_ENDPOINT_BUCKETS.has(r.bucket)) throw new QuotaStoreUnavailableError('rpc_22023');
    if (this.onCall) return this.onCall(r);
    if (r.limit === 0) return { allowed: false, used: 0, limit: 0 };
    const used = this.counts.get(r.bucket) ?? 0;
    if (used >= r.limit) return { allowed: false, used, limit: r.limit };
    this.counts.set(r.bucket, used + 1);
    return { allowed: true, used: used + 1, limit: r.limit };
  }
}
const asAnon = (token: string, ok: QuotaStore['consume'], anonErr: string) => async (r: QuotaRequest) => {
  if (r.accessToken === token) throw new QuotaStoreUnavailableError(anonErr);
  return ok(r);
};

describe('verify:quota (core logic against a fake store; the live run is the owner\'s)', () => {
  it('fails before any network call when the token is expired, not a JWT, or not a user token', async () => {
    for (const bad of [jwt({ exp: NOW - 5, role: 'authenticated' }), 'not-a-jwt', jwt({ exp: NOW + 100, role: 'service_role' }), jwt({ role: 'authenticated' })]) {
      const store = new FakeStore();
      const out = await runVerification({ store, token: bad, consume: true, nowSeconds: () => NOW });
      expect(out).toHaveLength(1);
      expect(out[0].ok).toBe(false);
      expect(store.calls).toHaveLength(0);
    }
  });

  it('read-only mode only ever calls the function with limit 0 (nothing can be written)', async () => {
    const store = new FakeStore();
    const out = await runVerification({ store, token: GOOD, consume: false, nowSeconds: () => NOW });
    expect(out.every((c) => c.ok)).toBe(true);
    expect(store.calls.length).toBeGreaterThan(0);
    expect(store.calls.every((c) => c.limit === 0)).toBe(true);
  });

  it('reports a missing migration with an actionable hint', async () => {
    const store = new FakeStore(() => {
      throw new QuotaStoreUnavailableError('rpc_PGRST202');
    });
    const out = await runVerification({ store, token: GOOD, consume: false, nowSeconds: () => NOW });
    expect(out.at(-1)!.ok).toBe(false);
    expect(out.at(-1)!.detail).toMatch(/migration not applied/);
  });

  it('reports a missing EXECUTE grant', async () => {
    const store = new FakeStore(() => {
      throw new QuotaStoreUnavailableError('rpc_42501');
    });
    const out = await runVerification({ store, token: GOOD, consume: false, nowSeconds: () => NOW });
    expect(out.at(-1)!.detail).toMatch(/EXECUTE is not granted/);
  });

  it('fails when the probe answers something other than allowed=false used=0', async () => {
    const store = new FakeStore(() => ({ allowed: true, used: 1, limit: 0 }));
    const out = await runVerification({ store, token: GOOD, consume: false, nowSeconds: () => NOW });
    expect(out.at(-1)!.ok).toBe(false);
  });

  it('anonymous check: an answered call FAILS; an API refusal passes; a network error is inconclusive (fails)', async () => {
    const ANON = 'sb_publishable_placeholder';
    const base = new FakeStore();
    const answered = await runVerification({ store: base, token: GOOD, anonToken: ANON, consume: false, nowSeconds: () => NOW });
    expect(answered.find((c) => c.name.startsWith('anonymous'))!.ok).toBe(false);

    const refused = new FakeStore(asAnon(ANON, (r) => new FakeStore().consume(r), 'rpc_42501'));
    expect((await runVerification({ store: refused, token: GOOD, anonToken: ANON, consume: false, nowSeconds: () => NOW })).every((c) => c.ok)).toBe(true);

    const flaky = new FakeStore(asAnon(ANON, (r) => new FakeStore().consume(r), 'transport'));
    const out = await runVerification({ store: flaky, token: GOOD, anonToken: ANON, consume: false, nowSeconds: () => NOW });
    const anon = out.find((c) => c.name.startsWith('anonymous'))!;
    expect(anon.ok).toBe(false);
    expect(anon.detail).toMatch(/inconclusive/);
  });

  it('--consume passes for a correct store and FAILS for one that over-allows', async () => {
    const good = await runVerification({ store: new FakeStore(), token: GOOD, consume: true, nowSeconds: () => NOW });
    expect(good).toHaveLength(4); // token, probe, sequential limit, simultaneous limit
    expect(good.every((c) => c.ok)).toBe(true);

    const leaky = new FakeStore((r) => (r.limit === 0 ? { allowed: false, used: 0, limit: 0 } : { allowed: true, used: 1, limit: r.limit }));
    const bad = await runVerification({ store: leaky, token: GOOD, consume: true, nowSeconds: () => NOW });
    expect(bad.filter((c) => !c.ok).length).toBe(2);
  });

  it('uses only real allow-listed AI buckets, in every mode (IL-04: the live function rejects any other name)', async () => {
    expect(AI_ENDPOINT_BUCKETS.size).toBe(15);
    expect(MIGRATION_BUCKETS).toEqual(AI_ENDPOINT_BUCKETS); // sanity: the list parsed from the migration is the endpoints list
    for (const consume of [false, true]) {
      const ANON = 'sb_publishable_placeholder';
      const inner = new FakeStore();
      const store = new FakeStore(asAnon(ANON, (r) => inner.consume(r), 'rpc_42501')); // anonymous refused, signed-in user answered
      const out = await runVerification({ store, token: GOOD, anonToken: ANON, consume, nowSeconds: () => NOW });
      expect(out.every((c) => c.ok)).toBe(true); // the fake refuses unknown buckets like the live function, so this fails on a bad name
      expect(store.calls.length).toBeGreaterThan(0);
      for (const b of new Set(store.calls.map((c) => c.bucket))) {
        expect(AI_ENDPOINT_BUCKETS.has(b), `bucket "${b}" is not an ai:true bucket in endpoints.ts`).toBe(true);
        expect(MIGRATION_BUCKETS.has(b), `bucket "${b}" is not in the live allow-list`).toBe(true);
      }
    }
    expect(AI_BUCKETS.every((b) => AI_ENDPOINT_BUCKETS.has(b))).toBe(true);
  });

  it('--consume uses three different real buckets (probe, sequence, simultaneous) so the checks cannot disturb each other', async () => {
    const store = new FakeStore();
    await runVerification({ store, token: GOOD, consume: true, nowSeconds: () => NOW });
    const withLimit = (n: number) => new Set(store.calls.filter((c) => c.limit === n).map((c) => c.bucket));
    expect(withLimit(0).size).toBe(1);
    expect(withLimit(3).size).toBe(2);
    expect([...withLimit(0)].some((b) => withLimit(3).has(b))).toBe(false);
  });

  it('the script source contains no invented bucket names (no verify-quota-* strings) and docs do not tell the owner to clean them up', () => {
    const noComments = readRoot('scripts/verify-quota.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(noComments).not.toMatch(/verify-quota-/);
    expect(readRoot('docs/security/quota-store.md')).not.toMatch(/verify-quota-/);
  });

  it('an \"unknown bucket\" refusal from the live function is reported with an actionable hint, not as a generic error', async () => {
    const store = new FakeStore(() => {
      throw new QuotaStoreUnavailableError('rpc_22023');
    });
    const out = await runVerification({ store, token: GOOD, consume: false, nowSeconds: () => NOW });
    expect(out.at(-1)!.ok).toBe(false);
    expect(out.at(-1)!.detail).toMatch(/unknown bucket/);
    expect(out.at(-1)!.detail).toMatch(/allow-list/);
  });

  it('--consume run a second time on the same UTC day says why it failed instead of just failing', async () => {
    const store = new FakeStore();
    const first = await runVerification({ store, token: GOOD, consume: true, nowSeconds: () => NOW });
    expect(first.every((c) => c.ok)).toBe(true);
    const second = await runVerification({ store, token: GOOD, consume: true, nowSeconds: () => NOW }); // same store = counters kept
    const failed = second.filter((c) => !c.ok);
    expect(failed).toHaveLength(2);
    for (const c of failed) expect(c.detail).toMatch(/already.*today \(UTC\)/);
  });

  it('never puts the token in any output line', async () => {
    const store = new FakeStore();
    const out = await runVerification({ store, token: GOOD, anonToken: 'sb_publishable_placeholder', consume: true, nowSeconds: () => NOW });
    const text = JSON.stringify(out);
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain(GOOD.split('.')[1]);
    expect(text).not.toContain('sb_publishable_placeholder');
  });
});

describe('verify:quota entry point', () => {
  const run = (env: Record<string, string>, args: string[] = []) =>
    // process.execPath + tsx loader: `node_modules/.bin/tsx` is not directly executable on Windows (spawnSync -> status null).
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-quota.ts', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...env }
    });

  it('exits 2 and names the missing variables (never values) when unconfigured; contacts nothing', () => {
    const r = run({});
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/SUPABASE_URL/);
    expect(r.stderr).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(r.stderr).toMatch(/VERIFY_QUOTA_JWT/);
  });

  it('exits 2 on an unknown argument', () => {
    const r = run({}, ['--delete-everything']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Unknown argument/);
  });

  it('does not echo configured values when it complains', () => {
    const r = run({ SUPABASE_URL: 'https://example-secret-ref.supabase.co', VERIFY_QUOTA_JWT: 'secret-token-value' });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).not.toContain('example-secret-ref');
    expect(r.stdout + r.stderr).not.toContain('secret-token-value');
  });
});

/**
 * The fake above is only a model of the SQL. This block runs the script's real logic against the REAL migrations
 * (original quota migration + IL-04 allow-list) in an in-process Postgres, through a QuotaStore that calls
 * `consume_ai_quota` as `authenticated` / `anon` like PostgREST does. It is still not the live project.
 */
describe('verify:quota against the real migrations (PGlite; not the live project)', () => {
  const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ANON = 'sb_publishable_placeholder';
  let pg: PGlite;
  let chain: Promise<unknown> = Promise.resolve();

  /** One query at a time with its own role, so the 8 "simultaneous" calls cannot interleave `set role` and the query. */
  const store: QuotaStore = {
    consume: (r) => {
      const run = async (): Promise<QuotaDecision> => {
        const anon = r.accessToken === ANON;
        await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${anon ? '' : U}', false); set role ${anon ? 'anon' : 'authenticated'}`);
        try {
          const { rows } = await pg.query<{ allowed: boolean; used: number }>('select * from public.consume_ai_quota($1, $2)', [r.bucket, r.limit]);
          return { allowed: rows[0].allowed, used: rows[0].used, limit: r.limit };
        } catch (e) {
          throw new QuotaStoreUnavailableError(`rpc_${(e as { code?: string }).code ?? 'error'}`);
        } finally {
          await pg.exec('reset role');
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    }
  };
  const rows = async () => (await pg.query<{ bucket: string; used: number }>('select bucket, used from public.ai_usage_counters order by bucket')).rows;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
      insert into auth.users values ('${U}');
    `);
    await pg.exec(readRoot('supabase/migrations/20261031000000_ai_usage_quota.sql'));
    await pg.exec(readRoot('supabase/migrations/20261103000000_ai_quota_bucket_allowlist.sql'));
  }, 60_000); // PGlite boot + migrations: ~3-4 s alone, >10 s when the full suite saturates the CPU
  afterAll(() => pg.close());

  it('the bucket names the script used before this change really are refused by the migrated function, even at limit 0', async () => {
    for (const old of ['verify-quota-probe', 'verify-quota-seq-ab12cd34', 'verify-quota-par-ab12cd34']) {
      const r = await store.consume({ userId: 'x', bucket: old, limit: 0, day: '2026-11-03', accessToken: GOOD }).catch((e) => e);
      expect(r).toBeInstanceOf(QuotaStoreUnavailableError);
      expect((r as QuotaStoreUnavailableError).reason).toBe('rpc_22023');
    }
    expect(await rows()).toEqual([]);
  });

  it('read-only mode passes (including the anonymous refusal) and writes no row', async () => {
    const out = await runVerification({ store, token: GOOD, anonToken: ANON, consume: false, nowSeconds: () => NOW });
    expect(out).toHaveLength(3); // token, limit-0 probe, anonymous refused
    expect(out.every((c) => c.ok), JSON.stringify(out)).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it('--consume passes, leaves exactly two rows at used = 3 in two different real buckets, and a same-day rerun says why it fails', async () => {
    const out = await runVerification({ store, token: GOOD, anonToken: ANON, consume: true, nowSeconds: () => NOW });
    expect(out.every((c) => c.ok), JSON.stringify(out)).toBe(true);
    const left = await rows();
    expect(left).toHaveLength(2);
    expect(left.every((r) => r.used === 3 && AI_ENDPOINT_BUCKETS.has(r.bucket))).toBe(true);

    const again = await runVerification({ store, token: GOOD, consume: true, nowSeconds: () => NOW });
    const failed = again.filter((c) => !c.ok);
    expect(failed).toHaveLength(2);
    expect(failed.every((c) => /already.*today \(UTC\)/.test(c.detail))).toBe(true);
    expect(await rows()).toHaveLength(2); // nothing new was created
  });
});
