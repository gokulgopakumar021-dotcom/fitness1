import type { PGlite } from '@electric-sql/pglite';
import { PullCursor, PushArgs, PushResult, RemoteAdapter, RemoteRow, SyncError, SyncKind } from './types';

/** In-memory Storage: one instance = one browser profile (one "device"). */
export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * RemoteAdapter backed by the REAL Stage 1 SQL (push_workout_record / pull_workout_changes) running in PGlite, as the
 * `authenticated` role with auth.uid() = uid, so row-level security applies exactly as in production.
 */
export function createPgRemote(pg: PGlite, uid: string): RemoteAdapter {
  const as = async <T,>(fn: () => Promise<T>): Promise<T> => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated`);
    try { return await fn(); } finally { await pg.exec('reset role'); }
  };
  const toRow = (r: Record<string, unknown>, kind?: SyncKind): RemoteRow => ({
    kind: (r.kind ?? kind) as SyncKind,
    id: r.id as string,
    data: r.data as Record<string, unknown>,
    client_updated_at: iso(r.client_updated_at),
    version: Number(r.version),
    deleted_at: r.deleted_at ? iso(r.deleted_at) : null,
    updated_at: String(r.updated_at_iso),
    device_id: (r.device_id as string | null) ?? null
  });
  const ISO = `to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_iso`;
  return {
    pull: (after: PullCursor | null, limit: number) => as(async () => {
      const r = await pg.query<Record<string, unknown>>(
        `select *, ${ISO} from public.pull_workout_changes($1::timestamptz,$2,$3,$4)`,
        [after?.ts ?? null, after?.kind ?? null, after?.id ?? null, limit]);
      return r.rows.map((x) => toRow(x));
    }),
    push: (a: PushArgs) => as(async (): Promise<PushResult> => {
      const r = await pg.query<Record<string, unknown>>(
        `select *, ${ISO} from public.push_workout_record($1,$2,$3::jsonb,$4::timestamptz,$5,$6,$7)`,
        [a.kind, a.id, JSON.stringify(a.data), a.clientUpdatedAt, a.baseVersion, a.deleted, a.deviceId]);
      const x = r.rows[0];
      return { outcome: x.outcome as 'applied' | 'conflict', row: toRow(x, a.kind) };
    })
  };
}

export interface Faults {
  /** Reject every call with a transient error (device is offline). */
  offline?: boolean;
  /** Succeed the first N pushes, then fail the rest (interrupted sync). */
  failPushesAfter?: number;
  /** The push reaches the server but the response is lost (server wrote it, client saw an error). */
  loseResponseOnPush?: number;
}

export function withFaults(inner: RemoteAdapter, faults: Faults): RemoteAdapter {
  let pushes = 0;
  const down = () => new SyncError('transient', 'Failed to fetch');
  return {
    async pull(c, l) { if (faults.offline) throw down(); return inner.pull(c, l); },
    async push(a) {
      if (faults.offline) throw down();
      pushes++;
      if (faults.failPushesAfter !== undefined && pushes > faults.failPushesAfter) throw down();
      const res = await inner.push(a);
      if (faults.loseResponseOnPush === pushes) throw down();
      return res;
    }
  };
}
