import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBillingStatus, type BillingStatus } from '../lib/billingApi';
import { BILLING_REFUSAL_EVENT, requestOpenBilling, type BillingRefusalDetail } from '../lib/billingGate';

/**
 * Premium locks for the UI. This is the app's EXISTING billing entitlement (GET /api/billing/status, the same call the billing
 * screen makes) shared with every screen. It is not a second entitlement system and it grants nothing:
 *   - the server's gate still answers 402/503 on every AI route, whatever this context says;
 *   - nothing here is stored (no browser storage, no flags), so it cannot be edited to unlock a feature.
 *
 * A feature shows as locked only while the server reports `enforcement: 'on'` and `entitlement.hasAccess: false`. While the status
 * is not known yet (first load, or the request failed) nothing is shown as locked: the server still decides on every request.
 *
 * Locks update by themselves: the status is re-read on mount, when the window regains focus, every few minutes, shortly after the
 * reported access end (trial or period expiry), right after a 402 from any AI call, and whenever the billing screen loads a new
 * status (trial started, subscription activated, cancelled, recovered).
 */
export interface PremiumAccess {
  /** True only when billing is enforced and the account has no active trial or paid access. */
  locked: boolean;
  /** No status yet (first load). Not locked while loading. */
  loading: boolean;
  status: BillingStatus | null;
  refresh: () => Promise<void>;
  /** Used by the billing screen so a purchase or cancellation changes the locks at once, without another request. */
  applyStatus: (status: BillingStatus) => void;
}

const NOT_LOCKED: PremiumAccess = { locked: false, loading: false, status: null, refresh: async () => {}, applyStatus: () => {} };
const EntitlementContext = createContext<PremiumAccess>(NOT_LOCKED);

export const POLL_MS = 5 * 60_000;
export const FOCUS_THROTTLE_MS = 15_000;
const EXPIRY_GRACE_MS = 1_000;
const EXPIRY_RETRY_MS = 30_000;
const MAX_TIMER_MS = 2_000_000_000; // setTimeout overflows at 2^31 - 1

interface ProviderProps {
  children: React.ReactNode;
  /** Account id. When it changes the previous account's status is dropped and re-read. */
  userId?: string | null;
  fetchStatus?: () => Promise<BillingStatus>;
  now?: () => number;
}

export const EntitlementProvider: React.FC<ProviderProps> = ({ children, userId = null, fetchStatus = fetchBillingStatus, now = Date.now }) => {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  /** A 402 from the server is proof of "no access" even if the status has not been re-read yet. Cleared by the next status. */
  const [refused, setRefused] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const fetchRef = useRef(fetchStatus);
  fetchRef.current = fetchStatus;
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyStatus = useCallback((s: BillingStatus) => {
    setStatus(s);
    setRefused(false);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!inFlight.current) {
      const gen = generation.current;
      inFlight.current = Promise.resolve()
        .then(() => fetchRef.current())
        .then((s) => {
          if (mounted.current && gen === generation.current) applyStatus(s);
        })
        .catch(() => {
          /* unknown: keep what is shown; the server still decides on every request */
        })
        .finally(() => {
          if (gen === generation.current) inFlight.current = null;
        });
    }
    return inFlight.current;
  }, [applyStatus]);

  // First read, and a fresh start whenever the signed-in account changes.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    setStatus(null);
    setRefused(false);
    void refresh();
  }, [userId, refresh]);

  // Come back to the app, or leave it open: re-read. (Covers a subscription started or ended on another device.)
  useEffect(() => {
    let last = nowRef.current();
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const onReturn = () => {
      if (!visible()) return;
      const t = nowRef.current();
      if (t - last < FOCUS_THROTTLE_MS) return;
      last = t;
      void refresh();
    };
    const poll = window.setInterval(() => {
      if (visible()) void refresh();
    }, POLL_MS);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh]);

  // The server refused an AI call: show the lock now and confirm with a fresh status.
  useEffect(() => {
    const onRefusal = (e: Event) => {
      const detail = (e as CustomEvent<BillingRefusalDetail>).detail;
      if (detail?.kind !== 'subscription_required') return;
      setRefused(true);
      void refresh();
    };
    window.addEventListener(BILLING_REFUSAL_EVENT, onRefusal);
    return () => window.removeEventListener(BILLING_REFUSAL_EVENT, onRefusal);
  }, [refresh]);

  // Access (trial or paid period) is reported to end at a known time: re-read just after it, so the lock appears without a reload.
  const accessEndsAt = status?.entitlement.hasAccess ? status.entitlement.accessEndsAt : null;
  useEffect(() => {
    if (!accessEndsAt) return;
    const end = Date.parse(accessEndsAt);
    if (!Number.isFinite(end)) return;
    const t = nowRef.current();
    const delay = end > t ? Math.min(end - t + EXPIRY_GRACE_MS, MAX_TIMER_MS) : EXPIRY_RETRY_MS;
    const id = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(id);
  }, [accessEndsAt, status, refresh]);

  const locked = refused || (!!status && status.enforcement === 'on' && !status.entitlement.hasAccess);
  const value = useMemo<PremiumAccess>(
    () => ({ locked, loading: status === null && !refused, status, refresh, applyStatus }),
    [locked, status, refused, refresh, applyStatus]
  );
  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
};

/** Outside a provider (tests, isolated screens) nothing is locked: the server remains the only authority. */
export const usePremiumAccess = (): PremiumAccess => useContext(EntitlementContext);

/**
 * `guard(fn)` returns a handler that runs `fn` only while unlocked. While locked it does NOT run `fn` (the feature neither opens nor
 * makes a request) and opens the existing billing screen instead. It reads the lock when the handler runs, never a stale render.
 */
export function usePremiumGate() {
  const { locked } = usePremiumAccess();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const guard = useCallback(
    (fn: () => void) => () => {
      if (lockedRef.current) requestOpenBilling();
      else fn();
    },
    []
  );
  return { locked, guard };
}

/** For a premium modal: if it is open and the account becomes (or already is) locked, close it and open billing. */
export function useCloseWhenLocked(isOpen: boolean, onClose: () => void): void {
  const { locked } = usePremiumAccess();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (isOpen && locked) {
      closeRef.current();
      requestOpenBilling();
    }
  }, [isOpen, locked]);
}
