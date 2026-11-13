import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_SCRIPT_URL } from './razorpayCheckout';

type Mod = typeof import('./razorpayCheckout');
let loadCheckoutScript: Mod['loadCheckoutScript'];
let openSubscriptionCheckout: Mod['openSubscriptionCheckout'];

type Opts = Record<string, any>;
let last: { opts: Opts; open: ReturnType<typeof vi.fn> } | null = null;

const installFake = () => {
  (window as any).Razorpay = function (this: any, opts: Opts) {
    const open = vi.fn();
    last = { opts, open };
    this.open = open;
  };
};
const scripts = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT_URL}"]`));

beforeEach(async () => {
  // The loader keeps a module-level in-flight promise; start each test from a fresh module.
  vi.resetModules();
  ({ loadCheckoutScript, openSubscriptionCheckout } = await import('./razorpayCheckout'));
  delete (window as any).Razorpay;
  document.head.innerHTML = '';
  last = null;
});
afterEach(() => {
  delete (window as any).Razorpay;
});

describe('Razorpay Checkout loader', () => {
  it('loads the official script on demand, only once, and only when asked', async () => {
    expect(scripts()).toHaveLength(0); // nothing loaded until billing is used
    const a = loadCheckoutScript();
    const b = loadCheckoutScript();
    expect(scripts()).toHaveLength(1);
    installFake();
    scripts()[0].onload!(new Event('load'));
    await Promise.all([a, b]);
    await loadCheckoutScript(); // already present: no second tag
    expect(scripts()).toHaveLength(1);
  });

  it('rejects when the script fails to load and allows a clean retry', async () => {
    const first = loadCheckoutScript();
    scripts()[0].onerror!(new Event('error'));
    await expect(first).rejects.toThrow(/failed to load/);
    expect(scripts()).toHaveLength(0);
    const second = loadCheckoutScript();
    expect(scripts()).toHaveLength(1);
    installFake();
    scripts()[0].onload!(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });
});

describe('openSubscriptionCheckout', () => {
  const args = { keyId: 'rzp_test_abc', subscriptionId: 'sub_ABC123456', description: 'Monthly plan', email: 'me@example.com', brandName: 'Iron Log AI' };

  it('passes only the public key id and subscription id (never a secret), and resolves with the callback result', async () => {
    installFake();
    const p = openSubscriptionCheckout(args);
    await Promise.resolve();
    await Promise.resolve();
    expect(last!.open).toHaveBeenCalledTimes(1);
    expect(Object.keys(last!.opts).sort()).toEqual(['description', 'handler', 'key', 'modal', 'name', 'prefill', 'subscription_id', 'theme']);
    expect(last!.opts.key).toBe('rzp_test_abc');
    expect(last!.opts.subscription_id).toBe('sub_ABC123456');
    expect(JSON.stringify(last!.opts)).not.toMatch(/secret|signature|amount/i);
    const cb = { razorpay_payment_id: 'pay_X', razorpay_subscription_id: 'sub_ABC123456', razorpay_signature: 'f'.repeat(64) };
    last!.opts.handler(cb);
    await expect(p).resolves.toEqual({ kind: 'callback', response: cb });
  });

  it('resolves "dismissed" when the person closes Checkout, and only the first outcome counts', async () => {
    installFake();
    const p = openSubscriptionCheckout(args);
    await Promise.resolve();
    await Promise.resolve();
    last!.opts.modal.ondismiss();
    last!.opts.handler({ razorpay_payment_id: 'pay_X', razorpay_subscription_id: 's', razorpay_signature: 'x' });
    await expect(p).resolves.toEqual({ kind: 'dismissed' });
  });

  it('omits prefill when there is no email', async () => {
    installFake();
    const p = openSubscriptionCheckout({ ...args, email: null });
    await Promise.resolve();
    await Promise.resolve();
    expect('prefill' in last!.opts).toBe(false);
    last!.opts.modal.ondismiss();
    await p;
  });
});
