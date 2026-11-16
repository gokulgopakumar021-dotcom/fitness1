/** Reusable sync status model. "Synced" is only ever produced from a confirmed backend response. */
export type SyncState = 'never' | 'syncing' | 'synced' | 'partial' | 'failed' | 'auth_expired' | 'permission_revoked' | 'provider_unavailable';

export interface IngestSummary { received: number; accepted: number; duplicate: number; rejected: number; unsupported: number; invalid: number }
export type IngestClientResult =
  | { kind: 'ok'; summary: IngestSummary; syncedAt: string }
  | { kind: 'auth_expired' | 'consent_required' | 'unavailable' | 'rate_limited' | 'failed' };

export interface SyncStatus { state: SyncState; lastSuccessAt: string | null; lastAttemptAt: string | null; pending: number; summary: IngestSummary | null }

export const INITIAL_SYNC_STATUS: SyncStatus = { state: 'never', lastSuccessAt: null, lastAttemptAt: null, pending: 0, summary: null };

export const SYNC_MESSAGES: Record<SyncState, string> = {
  never: 'Nothing has been synchronized yet.',
  syncing: 'Synchronizing heart-rate readings…',
  synced: 'All readings were saved to your account.',
  partial: 'Some readings were saved; others were rejected (invalid, or outside the workout time window).',
  failed: 'Synchronization failed. Unsent readings are kept and will be retried.',
  auth_expired: 'Your session expired. Sign in again to continue syncing.',
  permission_revoked: 'Workout health-data sync is turned off, so readings are not being saved.',
  provider_unavailable: 'The service is temporarily unavailable. Unsent readings are kept and will be retried.'
};

export function reduceSync(prev: SyncStatus, r: IngestClientResult, nowIso: string, pending: number): SyncStatus {
  const base = { ...prev, lastAttemptAt: nowIso, pending };
  switch (r.kind) {
    case 'ok': {
      const s = r.summary;
      const stored = s.accepted + s.duplicate;
      const bad = s.rejected + s.invalid + s.unsupported;
      if (stored === 0 && bad > 0) return { ...base, state: 'failed', summary: s };
      return { ...base, state: bad > 0 ? 'partial' : 'synced', lastSuccessAt: r.syncedAt, summary: s };
    }
    case 'auth_expired': return { ...base, state: 'auth_expired' };
    case 'consent_required': return { ...base, state: 'permission_revoked' };
    case 'unavailable': case 'rate_limited': return { ...base, state: 'provider_unavailable' };
    default: return { ...base, state: 'failed' };
  }
}
