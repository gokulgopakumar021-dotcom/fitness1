import React, { useEffect, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { Button } from '../ui';
import {
  BILLING_REFUSAL_EVENT, BILLING_REQUIRED_MESSAGE, BILLING_UNAVAILABLE_MESSAGE, type BillingRefusalDetail
} from '../../lib/billingGate';

/**
 * One app-wide message for the server's entitlement gate (402 subscription_required, 503 billing_unavailable), raised by
 * `apiFetch` for every AI call site. Sits above the mobile nav, never blocks the screen, and the call site keeps its own
 * offline fallback. Mounted once, in the signed-in shell.
 */
export const BillingRefusalNotice: React.FC<{ onOpenBilling: () => void }> = ({ onOpenBilling }) => {
  const [detail, setDetail] = useState<BillingRefusalDetail | null>(null);

  useEffect(() => {
    const on = (e: Event) => setDetail((e as CustomEvent<BillingRefusalDetail>).detail);
    window.addEventListener(BILLING_REFUSAL_EVENT, on);
    return () => window.removeEventListener(BILLING_REFUSAL_EVENT, on);
  }, []);

  if (!detail) return null;
  const required = detail.kind === 'subscription_required';
  return (
    <div className="fixed inset-x-0 z-50 px-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-auto lg:right-6 lg:max-w-sm pointer-events-none">
      <div role="status" className="pointer-events-auto flex items-start gap-3 rounded-card border border-line-strong bg-surface-3 p-3">
        <Lock className="w-4 h-4 text-volt-adaptive shrink-0 mt-1" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-white">{required ? BILLING_REQUIRED_MESSAGE : BILLING_UNAVAILABLE_MESSAGE}</p>
          {required && (
            <Button
              size="sm"
              onClick={() => {
                setDetail(null);
                onOpenBilling();
              }}
            >
              View plans
            </Button>
          )}
        </div>
        <Button iconOnly size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setDetail(null)}>
          <X className="w-4 h-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
};
