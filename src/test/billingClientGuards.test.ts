// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guards for the billing client (Stage 4). Text scans, not proofs: they catch the regressions that matter most
 * (a payment secret in client code, Checkout loaded outside the billing flow, an AI call site bypassing apiFetch).
 */
const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const isTest = (r: string) => /\.(test|spec)\.[tj]sx?$/.test(r) || r.startsWith('src/test/');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) ? [rel(p)] : [];
  });
}
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const client = files(join(ROOT, 'src')).filter((f) => !f.startsWith('src/server/') && !isTest(f));

describe('billing client guards', () => {
  it('no payment or database secret is referenced from client code or a VITE_ variable', () => {
    for (const f of client) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(/RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY|BILLING_TRIAL_PEPPER/);
      expect(code, f).not.toMatch(/VITE_[A-Z_]*(RAZORPAY|SECRET|SERVICE_ROLE|PEPPER)/);
    }
    expect(read('index.html')).not.toMatch(/razorpay/i);
  });

  it('the Checkout script URL appears in exactly one client module, so it only loads through the billing flow', () => {
    const users = client.filter((f) => /checkout\.razorpay\.com/.test(read(f)));
    expect(users).toEqual(['src/lib/razorpayCheckout.ts']);
    const importers = client.filter((f) => /razorpayCheckout/.test(read(f)) && f !== 'src/lib/razorpayCheckout.ts');
    expect(importers).toEqual(['src/components/billing/BillingPanel.tsx']);
  });

  it('every AI call site goes through apiFetch (so a 402/503 from the entitlement gate is announced), none uses raw fetch on /api', () => {
    const offenders = client.filter((f) => f !== 'src/lib/apiFetch.ts' && /\bfetch\(\s*[`'"]\/api\//.test(strip(read(f))));
    expect(offenders).toEqual([]);
    const sites = client.filter((f) => /apiFetch\(\s*[`'"]\/api\/(?!billing)/.test(strip(read(f))));
    expect(sites.length).toBeGreaterThanOrEqual(13); // the 12 AI components/clients plus the barcode lookup
  });

  it('call sites that would otherwise show a canned reply handle 402 explicitly', () => {
    for (const f of ['src/components/trainer/FloatingTrainerWidget.tsx', 'src/components/trainer/AiTrainerView.tsx']) {
      const code = read(f);
      expect(code, f).toMatch(/isSubscriptionRequired\(response\)/);
      expect(code, f).toContain('BILLING_REQUIRED_MESSAGE');
    }
  });

  it('billing wire calls send a plan key only and use no client-side amounts', () => {
    const api = strip(read('src/lib/billingApi.ts'));
    expect(api).toMatch(/createSubscription = \(planKey: PlanKey\) => post<[^>]*>\('\/api\/billing\/subscriptions', \{ planKey \}\)/);
    expect(api).not.toMatch(/amount_paise|amountPaise:\s*\w+\s*[,}]\s*\)/);
  });

  it('the app default is unchanged: nothing in the client reads or sets BILLING_ENFORCEMENT', () => {
    for (const f of client) expect(strip(read(f)), f).not.toContain('BILLING_ENFORCEMENT');
  });
});
