// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCsp, RAZORPAY_FRAME_ORIGINS, RAZORPAY_SCRIPT_ORIGIN } from '../server/security/headers';

/**
 * Static guards for the SERVER side of billing (Stage 6; docs/billing/SECURITY_REVIEW.md). Like billingClientGuards these are text
 * scans, not proofs: they pin the confinement rules the review relies on, so a later change that breaks one fails loudly.
 */
const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : [rel(p)];
  });
}
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const isTest = (f: string) => /\.(test|spec)\.[tj]sx?$/.test(f) || f.startsWith('src/test/') || f.endsWith('/testFakes.ts');
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const source = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))].filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !isTest(f));

describe('service-role and payment-secret confinement (server)', () => {
  it('SUPABASE_SERVICE_ROLE_KEY is read only by the billing config and the video-library ingestion scripts', () => {
    const users = source.filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(strip(read(f))));
    expect(users.sort()).toEqual(['scripts/video-library/batch.ts', 'scripts/video-library/ingest.ts', 'src/server/billing/config.ts']);
  });
  it('only the billing store builds a service-role Supabase client, and only routes.ts and the reconcile script construct the store', () => {
    expect(source.filter((f) => /serviceRoleKey/.test(strip(read(f)))).sort()).toEqual(['src/server/billing/config.ts', 'src/server/billing/store.ts']);
    expect(source.filter((f) => /createSupabaseBillingStore\(/.test(strip(read(f)))).sort()).toEqual(['scripts/billing-reconcile.ts', 'src/server/billing/routes.ts', 'src/server/billing/store.ts']);
  });
  it('the Razorpay SDK is imported only by the gateway and the one-off plan script', () => {
    expect(source.filter((f) => /from 'razorpay'|require\('razorpay'\)/.test(read(f))).sort()).toEqual(['scripts/billing-create-plans.ts', 'src/server/billing/gateway.ts']);
  });
  it('keySecret, webhookSecret and the pepper are not used outside config, gateway, signature, emailHash, service and the plan script', () => {
    const allowed = new Set(['src/server/billing/config.ts', 'src/server/billing/gateway.ts', 'src/server/billing/signature.ts', 'src/server/billing/emailHash.ts', 'src/server/billing/service.ts', 'scripts/billing-create-plans.ts']);
    const users = source.filter((f) => /\b(keySecret|webhookSecret|trialPepper|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|BILLING_TRIAL_PEPPER)\b/.test(strip(read(f))));
    expect(users.filter((f) => !allowed.has(f))).toEqual([]);
  });
  it('no billing server module prints directly or logs a request body, headers, or a configuration object', () => {
    for (const f of source.filter((x) => x.startsWith('src/server/billing/'))) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(/console\./);
      expect(code, f).not.toMatch(/logger\.\w+\([^;]*\b(req\.body|rawBody|req\.headers(?!\[\s*'content-type'\s*\]))/); // the one allowed header is a 40-character content-type
      expect(code, f).not.toMatch(/logger\.\w+\([^;]*\b(keySecret|webhookSecret|serviceRoleKey|trialPepper|signature)\b/);
    }
  });
  it('the committed API bundle embeds no key-shaped literal (secrets come from the environment only)', () => {
    const bundle = read('api/index.js');
    expect(bundle).not.toMatch(/rzp_(test|live)_[A-Za-z0-9]{8,}/);
    expect(bundle).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/);
    expect(bundle).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
  });
  it('.env.example carries no VITE_ variable for any payment or service-role value, and no real-looking key', () => {
    const env = read('.env.example');
    expect(env).not.toMatch(/^\s*#?\s*VITE_[A-Z_]*(RAZORPAY|SECRET|SERVICE_ROLE|PEPPER|WEBHOOK)/m);
    expect(env).not.toMatch(/rzp_(test|live)_[A-Za-z0-9]{8,}/);
  });
});

describe('Content-Security-Policy widening is limited to Razorpay Checkout', () => {
  const csp = buildCsp({ supabaseUrl: 'https://abc.supabase.co' }) as Record<string, string[]>;
  it('Razorpay origins appear only in script-src and frame-src', () => {
    for (const [directive, values] of Object.entries(csp)) {
      const hasRzp = values.some((v) => /razorpay/i.test(v));
      expect(hasRzp, directive).toBe(directive === 'scriptSrc' || directive === 'frameSrc');
    }
    expect(csp.scriptSrc).toContain(RAZORPAY_SCRIPT_ORIGIN);
    expect(csp.frameSrc).toEqual(expect.arrayContaining(RAZORPAY_FRAME_ORIGINS));
  });
  it('no wildcard, unsafe-inline or unsafe-eval was added to any script or frame source', () => {
    for (const d of ['scriptSrc', 'frameSrc']) {
      for (const v of csp[d]) {
        expect(v, d).not.toMatch(/\*|unsafe-inline|^'unsafe-eval'$|^https?:$/); // 'wasm-unsafe-eval' (pre-existing, WASM only) is not 'unsafe-eval'
      }
    }
    expect(csp.scriptSrc.filter((v) => v.startsWith('https://'))).toEqual([RAZORPAY_SCRIPT_ORIGIN]);
    expect(csp.objectSrc).toEqual(["'none'"]);
    expect(csp.frameAncestors).toEqual(["'none'"]);
    expect(csp.formAction).toEqual(["'self'"]);
  });
});

describe('the reconcile workflow cannot leak the service-role key or run on a branch', () => {
  const wf = read('.github/workflows/billing-reconcile.yml');
  const body = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  it('is inert unless the repo variable is set, and only runs from main', () => {
    expect(body).toMatch(/vars\.BILLING_RECONCILE_ENABLED == 'true'/);
    expect(body).toMatch(/github\.ref == 'refs\/heads\/main'/);
  });
  it('reads its secrets from a protected GitHub environment', () => {
    expect(body).toMatch(/^\s+environment:\s*billing-reconcile\s*$/m);
  });
  it('has read-only token permissions and never uses pull_request_target or untrusted-input triggers', () => {
    expect(body).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(body).not.toMatch(/pull_request_target|pull_request:|issue_comment|workflow_run/);
  });
  it('exposes secrets only through the env of the final step, never in a run line, and installs with scripts disabled', () => {
    expect(body).not.toMatch(/run:.*\$\{\{\s*secrets\./);
    expect(body).toMatch(/npm ci --ignore-scripts/);
    const steps = body.split(/\n\s+- (?=uses:|run:)/);
    const withSecrets = steps.filter((s) => /secrets\./.test(s));
    expect(withSecrets).toHaveLength(1);
    expect(withSecrets[0]).toMatch(/billing-reconcile\.ts/);
  });
});
