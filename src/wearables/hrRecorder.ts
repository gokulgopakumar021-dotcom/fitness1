import type { IngestPayload } from './ingestClient';
import type { OutboxStore, PendingReading } from './outboxStore';
import { INITIAL_SYNC_STATUS, reduceSync, type IngestClientResult, type SyncStatus } from './syncStatus';

export interface RecorderDevice { key: string; name: string }
export interface RecorderOptions {
  send: (p: IngestPayload) => Promise<IngestClientResult>;
  now?: () => number;
  minIntervalMs?: number;
  maxBuffered?: number;
  batchSize?: number;
  onStatus?: (s: SyncStatus) => void;
  /** Optional on-device retry buffer (scoped to the account). Memory-only when omitted. */
  store?: OutboxStore | null;
}
type Pending = PendingReading;

/**
 * Buffers REAL heart-rate readings per workout and sends them through the ingestion API.
 *  - Simulated readings must never reach this class (callers pass real ones only); implausible values are dropped here too.
 *  - Readings are throttled (default one per 5 s) and never invented or interpolated.
 *  - On a transient failure (network, 5xx, rate limit, expired session) the buffer is kept for the next attempt; the oldest are
 *    dropped past the cap. If the server says consent is off, the buffer is discarded and recording stops until reset().
 *  - Retries reuse the same timestamps, so the server's idempotency makes delayed or repeated sends safe.
 * Unsent readings are also mirrored to an account-scoped on-device outbox (when a store is given) so a reload does not lose them.
 *  restore() must only be called once the server has confirmed workout_health_sync consent; the outbox is wiped when consent is off,
 *  when the server says consent is off, on discardAll(), and (by AuthGate) on sign-out or account switch.
 */
export class HrRecorder {
  private buffers = new Map<string, Pending[]>();
  private lastAt = new Map<string, number>();
  private device: RecorderDevice | null = null;
  private inFlight = false;
  private blocked = false;
  status: SyncStatus = INITIAL_SYNC_STATUS;
  constructor(private readonly o: RecorderOptions) {}

  private get now() { return this.o.now ?? Date.now; }
  pending(): number { let n = 0; for (const b of this.buffers.values()) n += b.length; return n; }
  private emit(s: SyncStatus) { this.status = s; this.o.onStatus?.(s); }

  offer(sessionId: string, bpm: number, device: RecorderDevice): boolean {
    if (this.blocked || !sessionId || !Number.isFinite(bpm) || bpm < 20 || bpm > 255) return false;
    const t = this.now();
    if (t - (this.lastAt.get(sessionId) ?? 0) < (this.o.minIntervalMs ?? 5000)) return false;
    this.lastAt.set(sessionId, t);
    this.device = device;
    const buf = this.buffers.get(sessionId) ?? [];
    buf.push({ value: Math.round(bpm), measuredAt: new Date(t).toISOString() });
    const cap = this.o.maxBuffered ?? 1000;
    if (buf.length > cap) buf.splice(0, buf.length - cap);
    this.buffers.set(sessionId, buf);
    this.persist();
    return true;
  }

  private persist() {
    const store = this.o.store;
    if (!store || !this.device) return;
    store.save(this.device, this.buffers);
  }

  /**
   * Loads readings left over from an earlier page load (validated, same account only) and merges them without duplicates.
   * Only call after consent is confirmed. Never overrides a blocked recorder. Original timestamps are kept, so retries are idempotent.
   */
  restore(): number {
    const store = this.o.store;
    if (!store || this.blocked) return 0;
    const saved = store.load(this.now());
    if (!saved) return 0;
    if (!this.device) this.device = saved.device;
    let added = 0;
    for (const [sessionId, items] of saved.buffers) {
      const buf = this.buffers.get(sessionId) ?? [];
      const seen = new Set(buf.map((b) => b.measuredAt));
      for (const it of items) if (!seen.has(it.measuredAt)) { buf.push(it); seen.add(it.measuredAt); added++; }
      buf.sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
      this.buffers.set(sessionId, buf);
    }
    if (added > 0) this.emit({ ...this.status, pending: this.pending() });
    return added;
  }

  /** Sends everything buffered. Safe to call repeatedly; overlapping calls are ignored. */
  async flush(): Promise<void> {
    if (this.inFlight || this.blocked || !this.device || this.pending() === 0) return;
    this.inFlight = true;
    this.emit({ ...this.status, state: 'syncing', pending: this.pending() });
    try {
      for (const [sessionId, buf] of [...this.buffers]) {
        while (buf.length) {
          const chunk = buf.slice(0, this.o.batchSize ?? 100);
          const r = await this.o.send({
            device: { deviceKey: this.device.key, manufacturer: 'Unknown', displayName: this.device.name, ingestionMethod: 'direct_ble' },
            workoutSessionId: sessionId,
            samples: chunk.map((c) => ({ metric: 'heart_rate', value: c.value, unit: 'bpm', measuredAt: c.measuredAt, origin: 'live' as const }))
          });
          if (r.kind === 'ok') { buf.splice(0, chunk.length); this.persist(); } // stored, duplicate or permanently rejected: none of these should be resent
          if (r.kind === 'consent_required') { this.buffers.clear(); this.blocked = true; this.o.store?.clear(); }
          this.emit(reduceSync(this.status, r, new Date(this.now()).toISOString(), this.pending()));
          if (r.kind !== 'ok') return;
        }
        this.buffers.delete(sessionId);
        this.persist();
      }
    } finally { this.inFlight = false; }
  }

  /** Called when consent is (re)granted or the account changes. */
  reset(opts: { discard?: boolean } = {}) { this.blocked = false; if (opts.discard) { this.buffers.clear(); this.lastAt.clear(); this.o.store?.clear(); } }
  /** Stop recording and drop anything unsent (consent turned off or device removed). */
  discardAll() { this.buffers.clear(); this.lastAt.clear(); this.blocked = true; this.o.store?.clear(); }
}
