import { createClient } from '@supabase/supabase-js';
import type { SecurityConfig } from '../security/config';
import type { ConsentRecord } from '../../wearables/consentPolicy';
import type { StoredHrSample } from '../../wearables/workoutHrSummary';
import type { HistorySample } from '../../wearables/coachHistory';
import { CONSENT_HISTORY_LIMIT, toConsentEvents, type ConsentEvent } from '../../wearables/consentHistory';

/** The database could not answer. Callers fail CLOSED for wearable data and never surface the reason to the client. */
export class WearableStoreUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`wearable store unavailable: ${reason}`);
    this.name = 'WearableStoreUnavailableError';
  }
}
/** The database refused the write because the account has not consented. */
export class WearableConsentRequiredError extends Error {
  constructor() { super('consent_required'); this.name = 'WearableConsentRequiredError'; }
}

export interface IngestDevice { deviceKey: string; manufacturer: string; model: string | null; displayName: string | null; ingestionMethod: 'direct_ble' | 'manual_import' }
export interface IngestRow {
  metric: string; value: number; unit: string; measuredAt: string; measuredEndAt: string | null; tzOffsetMin: number | null;
  sourceRecordId: string | null; origin: 'live' | 'synchronized' | 'manual'; quality: string; dedupeKey: string; workoutSessionId: string | null;
}
/**
 * insertedKeys: newly stored. verifiedKeys: stored AND the database confirmed the workout session exists for this account with the
 * timestamp inside it (subset of insertedKeys). outsideSessionKeys: not stored because the cloud-synced session's window excludes them.
 * All three come from the database; nothing about verification is ever sent to it.
 */
export interface IngestOutcome { deviceId: string; insertedKeys: string[]; verifiedKeys: string[]; outsideSessionKeys: string[] }

/**
 * Stored heart-rate samples of ONE workout session. `truncated` is true when more samples exist than the read cap
 * (Supabase's API returns at most 1000 rows per request, so reads are paged up to HR_READ_PAGES pages).
 */
export interface WorkoutHeartRateRead { samples: StoredHrSample[]; truncated: boolean }
/** BT-04C task 4: the account's own consent audit trail, newest first. `truncated` is true when older events exist. */
export interface ConsentHistoryRead { events: ConsentEvent[]; truncated: boolean }
/** BT-04C task 5: recent stored heart-rate readings of the account across workouts (newest first), for the server-built Coach Iron summary. */
export interface RecentHeartRateRead { samples: HistorySample[]; truncated: boolean }
export const HR_READ_PAGE = 1000;
export const RECENT_HR_PAGES = 5;
export const HR_READ_PAGES = 8;

/**
 * All methods take the caller's verified access token: the database derives the owner from that token (auth.uid()),
 * so no user id from the request is ever used to read or write. `userId` is passed only as a redundant filter.
 */
export interface WearableStore {
  readConsent(userId: string, accessToken: string | undefined): Promise<ConsentRecord | null>;
  setConsent(accessToken: string | undefined, categories: string[], version: number): Promise<void>;
  ingest(accessToken: string | undefined, device: IngestDevice, rows: IngestRow[]): Promise<IngestOutcome>;
  /** BT-04C: read-only. Row-level security limits the read to the caller's own rows; user_id is also filtered explicitly. */
  readWorkoutHeartRate(userId: string, accessToken: string | undefined, workoutSessionId: string): Promise<WorkoutHeartRateRead>;
  /** BT-04C task 4: read-only. wearable_consent_events has no client write grant; RLS limits the read to the caller's rows. */
  readConsentHistory(userId: string, accessToken: string | undefined): Promise<ConsentHistoryRead>;
  /** BT-04C task 5: read-only, under the caller's token (RLS). Only labelled workout readings from a real device (origin live/synchronized), since `sinceIso`. */
  readRecentHeartRate(userId: string, accessToken: string | undefined, sinceIso: string): Promise<RecentHeartRateRead>;
}

const safeCode = (c: unknown) => (typeof c === 'string' && /^[A-Za-z0-9_]{1,12}$/.test(c) ? c : 'error');

export class SupabaseWearableStore implements WearableStore {
  private readonly timeoutMs: number;
  constructor(private readonly cfg: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 4_000;
  }

  private client(token: string | undefined) {
    if (!this.cfg.supabaseUrl || !this.cfg.supabaseKey) throw new WearableStoreUnavailableError('not_configured');
    if (!token) throw new WearableStoreUnavailableError('no_token');
    return createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
  }

  private fail(err: { name?: string; message?: string; code?: unknown } | null | undefined): never {
    const name = err?.name ?? '';
    if (err?.message === 'consent_required' || err?.code === 'P0001') throw new WearableConsentRequiredError();
    if (name === 'AbortError' || name === 'TimeoutError' || /abort/i.test(err?.message ?? '')) throw new WearableStoreUnavailableError('timeout');
    throw new WearableStoreUnavailableError(`rpc_${safeCode(err?.code)}`);
  }

  async readConsent(userId: string, token: string | undefined): Promise<ConsentRecord | null> {
    const c = this.client(token);
    try {
      const res = await c.from('wearable_ai_consents').select('version,categories').eq('user_id', userId).abortSignal(AbortSignal.timeout(this.timeoutMs)).maybeSingle();
      if (res.error) this.fail(res.error);
      const d = res.data as { version?: unknown; categories?: unknown } | null;
      if (!d) return null;
      if (typeof d.version !== 'number' || !Array.isArray(d.categories) || !d.categories.every((x) => typeof x === 'string')) throw new WearableStoreUnavailableError('bad_shape');
      return { version: d.version, categories: d.categories as string[] };
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      return this.fail(err as { name?: string });
    }
  }

  async setConsent(token: string | undefined, categories: string[], version: number): Promise<void> {
    const c = this.client(token);
    try {
      const res = await c.rpc('set_my_wearable_consent', { p_categories: categories, p_version: version }).abortSignal(AbortSignal.timeout(this.timeoutMs));
      if (res.error) this.fail(res.error);
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      this.fail(err as { name?: string });
    }
  }

  async ingest(token: string | undefined, device: IngestDevice, rows: IngestRow[]): Promise<IngestOutcome> {
    const c = this.client(token);
    const p_device = { device_key: device.deviceKey, manufacturer: device.manufacturer, model: device.model, display_name: device.displayName, ingestion_method: device.ingestionMethod };
    const p_samples = rows.map((r) => ({
      metric: r.metric, value: r.value, unit: r.unit, measured_at: r.measuredAt, measured_end_at: r.measuredEndAt, tz_offset_min: r.tzOffsetMin,
      source_record_id: r.sourceRecordId, origin: r.origin, quality: r.quality, dedupe_key: r.dedupeKey, workout_session_id: r.workoutSessionId
    }));
    try {
      const res = await c.rpc('ingest_wearable_batch', { p_device, p_samples }).abortSignal(AbortSignal.timeout(this.timeoutMs * 2));
      if (res.error) this.fail(res.error);
      const d = res.data as { device_id?: unknown; inserted_keys?: unknown; verified_keys?: unknown; rejected_keys?: unknown } | null;
      if (!d || typeof d.device_id !== 'string' || !Array.isArray(d.inserted_keys)) throw new WearableStoreUnavailableError('bad_shape');
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []);
      // A missing list means "no confirmation": verification is never assumed.
      return { deviceId: d.device_id, insertedKeys: strings(d.inserted_keys), verifiedKeys: strings(d.verified_keys), outsideSessionKeys: strings(d.rejected_keys) };
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      return this.fail(err as { name?: string });
    }
  }
  async readWorkoutHeartRate(userId: string, token: string | undefined, workoutSessionId: string): Promise<WorkoutHeartRateRead> {
    const c = this.client(token);
    const samples: StoredHrSample[] = [];
    try {
      for (let page = 0; page < HR_READ_PAGES; page++) {
        const from = page * HR_READ_PAGE;
        const res = await c.from('wearable_samples')
          .select('value,measured_at,workout_session_verified')
          .eq('user_id', userId).eq('workout_session_id', workoutSessionId).eq('metric', 'heart_rate')
          .order('measured_at', { ascending: true }).order('id', { ascending: true })
          .range(from, from + HR_READ_PAGE - 1)
          .abortSignal(AbortSignal.timeout(this.timeoutMs));
        if (res.error) this.fail(res.error);
        const rows = res.data as { value?: unknown; measured_at?: unknown; workout_session_verified?: unknown }[] | null;
        if (!Array.isArray(rows)) throw new WearableStoreUnavailableError('bad_shape');
        for (const r of rows) {
          // A row that is not the expected shape is skipped, never repaired or guessed.
          if (typeof r.value !== 'number' || typeof r.measured_at !== 'string') continue;
          samples.push({ bpm: r.value, measuredAt: r.measured_at, verified: typeof r.workout_session_verified === 'boolean' ? r.workout_session_verified : null });
        }
        if (rows.length < HR_READ_PAGE) return { samples, truncated: false };
      }
      // Every page was full: there may be more. Say so instead of presenting a partial read as complete.
      return { samples, truncated: true };
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      return this.fail(err as { name?: string });
    }
  }

  async readConsentHistory(userId: string, token: string | undefined): Promise<ConsentHistoryRead> {
    const c = this.client(token);
    try {
      // One more than the limit, so "older events exist" is known without a second request.
      const res = await c.from('wearable_consent_events')
        .select('category,action,consent_version,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(CONSENT_HISTORY_LIMIT + 1)
        .abortSignal(AbortSignal.timeout(this.timeoutMs));
      if (res.error) this.fail(res.error);
      if (!Array.isArray(res.data)) throw new WearableStoreUnavailableError('bad_shape');
      return toConsentEvents(res.data);
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      return this.fail(err as { name?: string });
    }
  }

  async readRecentHeartRate(userId: string, token: string | undefined, sinceIso: string): Promise<RecentHeartRateRead> {
    const c = this.client(token);
    const samples: HistorySample[] = [];
    // One overall budget, so a slow database cannot stall a chat reply for pages x timeout.
    const deadline = Date.now() + this.timeoutMs * 2;
    try {
      for (let page = 0; page < RECENT_HR_PAGES; page++) {
        const left = deadline - Date.now();
        if (left <= 0) throw new WearableStoreUnavailableError('timeout');
        const from = page * HR_READ_PAGE;
        const res = await c.from('wearable_samples')
          .select('value,measured_at,workout_session_id')
          .eq('user_id', userId).eq('metric', 'heart_rate')
          .in('origin', ['live', 'synchronized'])
          .not('workout_session_id', 'is', null)
          .gte('measured_at', sinceIso)
          .order('measured_at', { ascending: false }).order('id', { ascending: false })
          .range(from, from + HR_READ_PAGE - 1)
          .abortSignal(AbortSignal.timeout(Math.min(this.timeoutMs, left)));
        if (res.error) this.fail(res.error);
        const rows = res.data as { value?: unknown; measured_at?: unknown; workout_session_id?: unknown }[] | null;
        if (!Array.isArray(rows)) throw new WearableStoreUnavailableError('bad_shape');
        for (const r of rows) {
          // A row that is not the expected shape is skipped, never repaired or guessed.
          if (typeof r.value !== 'number' || typeof r.measured_at !== 'string' || typeof r.workout_session_id !== 'string') continue;
          samples.push({ bpm: r.value, measuredAt: r.measured_at, sessionId: r.workout_session_id });
        }
        if (rows.length < HR_READ_PAGE) return { samples, truncated: false };
      }
      return { samples, truncated: true };
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError || err instanceof WearableConsentRequiredError) throw err;
      return this.fail(err as { name?: string });
    }
  }
}
