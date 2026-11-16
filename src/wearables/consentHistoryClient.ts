import { apiFetch } from '../lib/apiFetch';
import { isConsentEvent, type ConsentEvent } from './consentHistory';

/**
 * Reads the signed-in account's consent audit trail (read-only; there is no way to edit or delete it from the app).
 * `unavailable` covers the database being unreachable and the proposed migration not being applied yet; the UI says so plainly
 * and never shows an event it did not receive.
 */
export type ConsentHistoryResult =
  | { kind: 'ok'; events: ConsentEvent[]; truncated: boolean }
  | { kind: 'unauthenticated' | 'rate_limited' | 'unavailable' | 'failed' };

export async function fetchConsentHistory(signal?: AbortSignal): Promise<ConsentHistoryResult> {
  let res: Response;
  try {
    res = await apiFetch('/api/wearables/consent-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
  } catch {
    return { kind: 'unavailable' };
  }
  if (res.status === 401) return { kind: 'unauthenticated' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 503) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed' };
  try {
    const j = (await res.json()) as { success?: boolean; events?: unknown; truncated?: unknown };
    // One malformed event means the answer cannot be trusted as a whole: show an error, not a partly invented history.
    if (j.success === true && Array.isArray(j.events) && j.events.every(isConsentEvent)) {
      return { kind: 'ok', events: j.events, truncated: j.truncated === true };
    }
  } catch { /* fall through */ }
  return { kind: 'failed' };
}
