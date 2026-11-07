/**
 * Client side of the server's entitlement gate (BILLING_ENFORCEMENT=on). The server answers an AI request with
 *   402 { code: 'subscription_required', entitlement: { state } }   no access
 *   503 { code: 'billing_unavailable' }                              access could not be determined (fails closed)
 * `apiFetch` announces both here, once, for every AI call site, so the person always gets one clear message and a route to the
 * billing screen. The Response itself is passed through untouched, so each call site keeps its own offline fallback.
 * Display only: this never grants or removes anything.
 */
export const BILLING_REFUSAL_EVENT = 'ironlog:billing-refusal';
export const OPEN_BILLING_EVENT = 'ironlog:open-billing';

export const BILLING_REQUIRED_MESSAGE = 'An active trial or subscription is required to use this feature.';
export const BILLING_UNAVAILABLE_MESSAGE = "We couldn't check your subscription just now. Please try again in a moment.";

export type BillingRefusalKind = 'subscription_required' | 'billing_unavailable';
export interface BillingRefusalDetail {
  kind: BillingRefusalKind;
  state?: string;
}

const pathOf = (url: string): string => {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
};

/** Billing's own endpoints report their own errors on the billing screen; only the AI gate is announced globally. */
const isBillingEndpoint = (url: string) => pathOf(url).startsWith('/api/billing/');

/** The server's 402 means "no entitlement". Used by call sites that must not show a canned reply as if the AI had answered. */
export const isSubscriptionRequired = (res: Pick<Response, 'status'>): boolean => res.status === 402;

export function announceBillingRefusal(url: string, res: Response): void {
  if (typeof window === 'undefined' || (res.status !== 402 && res.status !== 503) || isBillingEndpoint(url)) return;
  if (typeof res.clone !== 'function') return;
  let copy: Response;
  try {
    copy = res.clone();
  } catch {
    return;
  }
  void copy
    .json()
    .then((body: any) => {
      const code = body?.code;
      if (code !== 'subscription_required' && code !== 'billing_unavailable') return;
      const detail: BillingRefusalDetail = { kind: code, ...(typeof body?.entitlement?.state === 'string' ? { state: body.entitlement.state } : {}) };
      window.dispatchEvent(new CustomEvent<BillingRefusalDetail>(BILLING_REFUSAL_EVENT, { detail }));
    })
    .catch(() => {
      /* not JSON: nothing to announce */
    });
}

export function requestOpenBilling(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_BILLING_EVENT));
}
