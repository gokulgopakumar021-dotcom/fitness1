// @vitest-environment node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuotaStoreUnavailableError, type QuotaDecision, type QuotaRequest, type QuotaStore } from '../src/server/security/quota';
import { runVerification } from './verify-quota';

const ROOT = path.resolve(import.meta.dirname, '..');
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = 1_800_000_000;
const jwt = (claims: object) => `${b64({ alg: 'ES256' })}.${b64(claims)}.c2lnbmF0dXJl`;
const GOOD = jwt({ exp: NOW + 3600, role: 'authenticated', sub: 'u' });

/** Behaves like the SQL function: atomic per bucket, limit 0 never stores. */
class FakeStore implements QuotaStore {
  calls: QuotaRequest[] = [];
  private counts = new Map<string, number>();
  constructor(private readonly onCall?: (r: QuotaRequest) => QuotaDecision | Promise<QuotaDecision>) {}
  async consume(r: QuotaRequest): Promise<QuotaDecision> {
    this.calls.push(r);
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

  it('uses unique throw-away buckets for consumption and never the real feature buckets', async () => {
    const store = new FakeStore();
    await runVerification({ store, token: GOOD, consume: true, nowSeconds: () => NOW });
    const buckets = new Set(store.calls.map((c) => c.bucket));
    expect([...buckets].every((b) => b.startsWith('verify-quota-'))).toBe(true);
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
    spawnSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['scripts/verify-quota.ts', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }
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
