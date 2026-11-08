import type { CheckoutCallback } from './billingApi';

/**
 * Razorpay Standard Checkout, loaded ONLY when the person starts a subscription (never on app start, so every other screen is
 * unchanged and the third-party script is never present for people who do not open billing).
 *
 * Options used are the documented Subscriptions ones: `key`, `subscription_id`, `name`, `description`, `handler`, `prefill`,
 * `theme` and `modal.ondismiss`. Only the public Key ID is ever passed; the Key Secret exists only on the server.
 * The `handler` result is NOT proof of payment: the caller must send it to the server, which verifies it.
 */
export const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/** Razorpay's own option takes a hex string; this is the app's dark-theme accent (see docs/design-system.md). */
const CHECKOUT_ACCENT = '#ceff00';

interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (response: CheckoutCallback) => void;
  /** Documented Checkout option: lets the customer change the CARD on an existing subscription (payment recovery). */
  subscription_card_change?: boolean;
  prefill?: { email?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

export function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve() : reject(new Error('Checkout unavailable')));
    script.onerror = () => {
      script.remove();
      reject(new Error('Checkout script failed to load'));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null; // allow a retry after a failed load
    throw err;
  });
  return loading;
}

export type CheckoutOutcome = { kind: 'callback'; response: CheckoutCallback } | { kind: 'dismissed' };

export interface OpenCheckoutArgs {
  keyId: string;
  subscriptionId: string;
  description: string;
  email?: string | null;
  brandName: string;
  /** Payment recovery on a pending/halted subscription: allow changing the card. */
  cardChange?: boolean;
}

/** Resolves once, with whichever happens first: Checkout hands back a result, or the person closes it. */
export async function openSubscriptionCheckout(args: OpenCheckoutArgs): Promise<CheckoutOutcome> {
  await loadCheckoutScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Checkout unavailable');
  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    const settle = (o: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    const rzp = new Razorpay({
      key: args.keyId,
      subscription_id: args.subscriptionId,
      name: args.brandName,
      description: args.description,
      ...(args.cardChange ? { subscription_card_change: true } : {}),
      handler: (response) => settle({ kind: 'callback', response }),
      ...(args.email ? { prefill: { email: args.email } } : {}),
      theme: { color: CHECKOUT_ACCENT },
      modal: { ondismiss: () => settle({ kind: 'dismissed' }) }
    });
    rzp.open();
  });
}
