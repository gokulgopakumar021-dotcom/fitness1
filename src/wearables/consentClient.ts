import { apiFetch } from '../lib/apiFetch';
import { isWearableConsentCategory, type WearableConsentCategory } from './consentPolicy';
import { grantWearableAiConsent, revokeWearableAiConsent } from './consent';

export type ConsentResult =
  | { status: 'ok'; categories: WearableConsentCategory[]; stale: boolean }
  | { status: 'unauthenticated' | 'unavailable' | 'error' };

/** Fired after any server-confirmed consent change so every mounted piece (dashboard, sync controller) re-reads. */
export const WEARABLE_CONSENT_EVENT = 'ironlog-wearable-consent-changed';

async function parse(res: Response): Promise<ConsentResult> {
  if (res.status === 401) return { status: 'unauthenticated' };
  if (res.status === 503) return { status: 'unavailable' };
  if (!res.ok) return { status: 'error' };
  try {
    const j = (await res.json()) as { success?: boolean; categories?: unknown; stale?: unknown };
    if (!j.success || !Array.isArray(j.categories)) return { status: 'error' };
    return { status: 'ok', categories: j.categories.filter(isWearableConsentCategory), stale: j.stale === true };
  } catch { return { status: 'error' }; }
}

/** The cache follows the server, and only after the server answered. If the server cannot be reached the cache is left alone. */
function mirror(r: ConsentResult) {
  if (r.status !== 'ok') return;
  if (r.categories.length) grantWearableAiConsent(r.categories); else revokeWearableAiConsent();
}

export async function loadServerConsent(): Promise<ConsentResult> {
  try { const r = await parse(await apiFetch('/api/wearables/consent')); mirror(r); return r; } catch { return { status: 'unavailable' }; }
}

/** Replaces the whole consent set (an empty list revokes everything). */
export async function saveServerConsent(categories: WearableConsentCategory[]): Promise<ConsentResult> {
  try {
    const r = await parse(await apiFetch('/api/wearables/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories }) }));
    mirror(r);
    if (r.status === 'ok' && typeof window !== 'undefined') window.dispatchEvent(new Event(WEARABLE_CONSENT_EVENT));
    return r;
  } catch { return { status: 'unavailable' }; }
}
