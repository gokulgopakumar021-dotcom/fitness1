import type { SupabaseClient } from '@supabase/supabase-js';
import { PullCursor, PushArgs, PushResult, RemoteAdapter, RemoteRow, SYNC_KINDS, SyncError, SyncKind } from './types';

/**
 * Supabase implementation of RemoteAdapter. Uses ONLY the signed-in user's client (their JWT); there is no
 * service-role key in the browser. Both functions are SECURITY INVOKER, so row-level security scopes every call
 * to auth.uid() on the server regardless of anything this code sends.
 */
interface RpcResponse { data: unknown; error: { code?: string; message?: string } | null; status?: number }

export function classifyRpcError(error: { code?: string; message?: string }, status?: number): SyncError {
  const code = error.code ?? '';
  const msg = error.message || 'Sync request failed.';
  if (code === '28000' || code === '42501' || code === 'PGRST301' || code === 'PGRST303' || status === 401 || status === 403) {
    return new SyncError('auth', 'Your session is not valid for sync. Sign in again.');
  }
  if (status === 408 || status === 429 || (typeof status === 'number' && status >= 500)) return new SyncError('transient', msg);
  if (code === '22023' || code === '23514' || code === '22P02' || code === '23502' || status === 400) {
    return new SyncError('permanent', msg);
  }
  // Fetch-level failures from supabase-js carry no Postgres code (e.g. "TypeError: Failed to fetch").
  return new SyncError('transient', msg);
}

function toRow(raw: Record<string, unknown>, fallbackKind?: SyncKind): RemoteRow {
  const kind = (raw.kind ?? fallbackKind) as SyncKind;
  if (!SYNC_KINDS.includes(kind) || typeof raw.id !== 'string') throw new SyncError('permanent', 'Unexpected sync response.');
  const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? (raw.data as Record<string, unknown>) : {};
  return {
    kind,
    id: raw.id,
    data,
    client_updated_at: String(raw.client_updated_at),
    version: Number(raw.version),
    deleted_at: raw.deleted_at === null || raw.deleted_at === undefined ? null : String(raw.deleted_at),
    updated_at: String(raw.updated_at),
    device_id: raw.device_id === null || raw.device_id === undefined ? null : String(raw.device_id)
  };
}

export function createSupabaseRemote(client: SupabaseClient): RemoteAdapter {
  return {
    async pull(after: PullCursor | null, limit: number): Promise<RemoteRow[]> {
      let res: RpcResponse;
      try {
        res = (await client.rpc('pull_workout_changes', {
          p_after_ts: after?.ts ?? null,
          p_after_kind: after?.kind ?? null,
          p_after_id: after?.id ?? null,
          p_limit: limit
        })) as RpcResponse;
      } catch (e) {
        throw new SyncError('transient', (e as Error)?.message || 'Network error.');
      }
      if (res.error) throw classifyRpcError(res.error, res.status);
      if (!Array.isArray(res.data)) return [];
      return res.data.map((r) => toRow(r as Record<string, unknown>));
    },

    async push(args: PushArgs): Promise<PushResult> {
      let res: RpcResponse;
      try {
        res = (await client.rpc('push_workout_record', {
          p_kind: args.kind,
          p_id: args.id,
          p_data: args.data,
          p_client_updated_at: args.clientUpdatedAt,
          p_base_version: args.baseVersion,
          p_deleted: args.deleted,
          p_device_id: args.deviceId
        })) as RpcResponse;
      } catch (e) {
        throw new SyncError('transient', (e as Error)?.message || 'Network error.');
      }
      if (res.error) throw classifyRpcError(res.error, res.status);
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row || typeof row !== 'object') throw new SyncError('permanent', 'Unexpected sync response.');
      const r = row as Record<string, unknown>;
      const outcome = r.outcome === 'conflict' ? 'conflict' : r.outcome === 'applied' ? 'applied' : null;
      if (!outcome) throw new SyncError('permanent', 'Unexpected sync response.');
      return { outcome, row: toRow(r, args.kind) };
    }
  };
}
