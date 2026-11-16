import { useCallback, useEffect, useState } from 'react';
import { loadServerConsent, saveServerConsent, WEARABLE_CONSENT_EVENT } from './consentClient';
import type { WearableConsentCategory } from './consentPolicy';

export type ConsentLoadState = 'loading' | 'ready' | 'unavailable' | 'unauthenticated';

/** Server-verified consent for the signed-in account. Nothing is "on" until the server says so. */
export function useWearableConsent() {
  const [state, setState] = useState<ConsentLoadState>('loading');
  const [categories, setCategories] = useState<ReadonlySet<WearableConsentCategory>>(new Set());
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await loadServerConsent();
    if (r.status === 'ok') { setCategories(new Set(r.categories)); setStale(r.stale); setState('ready'); }
    else if (r.status === 'unauthenticated') { setCategories(new Set()); setState('unauthenticated'); }
    else { setState('unavailable'); }
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) void refresh(); };
    run();
    window.addEventListener(WEARABLE_CONSENT_EVENT, run);
    return () => { alive = false; window.removeEventListener(WEARABLE_CONSENT_EVENT, run); };
  }, [refresh]);

  /** Turns one category on or off by saving the full new set. The screen only changes after the server confirms. */
  const setCategory = useCallback(async (cat: WearableConsentCategory, on: boolean): Promise<boolean> => {
    setBusy(true); setError(null);
    const next = new Set(categories);
    if (on) next.add(cat); else next.delete(cat);
    const r = await saveServerConsent([...next]);
    setBusy(false);
    if (r.status === 'ok') { setCategories(new Set(r.categories)); setStale(false); setState('ready'); return true; }
    setError(r.status === 'unavailable' ? 'Could not reach the server, so nothing was changed. Try again.' : r.status === 'unauthenticated' ? 'Please sign in again.' : 'The change could not be saved.');
    return false;
  }, [categories]);

  return { state, categories, stale, busy, error, setCategory, refresh };
}
