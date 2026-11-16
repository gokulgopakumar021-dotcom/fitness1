import { apiFetch } from '../lib/apiFetch';
import type { IngestClientResult, IngestSummary } from './syncStatus';

export interface IngestPayload {
  device: { deviceKey: string; manufacturer: string; model?: string; displayName?: string; ingestionMethod: 'direct_ble' | 'manual_import' };
  workoutSessionId?: string;
  samples: { metric: string; value: number; unit: string; measuredAt: string; origin: 'live' | 'synchronized' | 'manual' }[];
}

const isSummary = (s: unknown): s is IngestSummary =>
  !!s && typeof s === 'object' && ['received', 'accepted', 'duplicate', 'rejected', 'unsupported', 'invalid'].every((k) => typeof (s as Record<string, unknown>)[k] === 'number');

export async function sendIngest(payload: IngestPayload): Promise<IngestClientResult> {
  let res: Response;
  try { res = await apiFetch('/api/wearables/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch { return { kind: 'unavailable' }; }
  if (res.status === 401) return { kind: 'auth_expired' };
  if (res.status === 403) return { kind: 'consent_required' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 503) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed' };
  try {
    const j = (await res.json()) as { success?: boolean; summary?: unknown; syncedAt?: unknown };
    if (j.success === true && isSummary(j.summary) && typeof j.syncedAt === 'string') return { kind: 'ok', summary: j.summary, syncedAt: j.syncedAt };
  } catch { /* fall through */ }
  return { kind: 'failed' };
}
