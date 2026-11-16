import { METRICS, type MetricType } from '../../wearables/types';
import { normalizeSample } from '../../wearables/normalize';
import type { IngestDevice, IngestRow } from './store';

/** Hard limits. The route also has a body-size limit and a per-minute rate limit (endpoints.ts). */
export const MAX_BATCH = 200;
export const MAX_SAMPLE_AGE_MS = 366 * 24 * 3_600_000;

export type RecordStatus = 'accepted' | 'duplicate' | 'rejected' | 'unsupported' | 'invalid';
/** verified: the database confirmed the session exists for this account and the timestamp is inside it. unverified: stored with a session label that could not be confirmed. */
export type SessionVerification = 'verified' | 'unverified';
export interface RecordResult { index: number; status: RecordStatus; reason?: string; verification?: SessionVerification }
export interface DbVerdict { verifiedKeys?: readonly string[]; outsideSessionKeys?: readonly string[] }

export type Prepared =
  | { ok: false; code: 'invalid_device' | 'invalid_batch' | 'batch_too_large' | 'invalid_workout_session'; message: string }
  | { ok: true; device: IngestDevice; workoutSessionId: string | null; rows: IngestRow[]; rowIndex: number[]; results: RecordResult[] };

// Only routes that really exist in a PWA are accepted from a browser. Cloud/aggregator/native data would arrive from a
// server-side adapter, never from the client, so those methods are not accepted here.
const ORIGINS_BY_METHOD = { direct_ble: ['live', 'synchronized'], manual_import: ['manual'] } as const;
const PROVIDER_BY_METHOD = { direct_ble: 'web_bluetooth', manual_import: 'manual' } as const;
const DEVICE_KEY = /^[A-Za-z0-9+/=_:.\- ]{1,200}$/;
const SESSION_ID = /^[A-Za-z0-9_:.\-]{1,128}$/;
/** Same id rule the ingest path applies to workoutSessionId, reused by the read path so both agree. */
export const isValidSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v);
const SOURCE_RECORD = /^[A-Za-z0-9_:.\-]{1,200}$/;

/** Printable label only: no markup, quotes or control characters. */
export function cleanLabel(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFKC').replace(/[^\p{L}\p{N} ._()\-+/]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : null;
}
const reasonOf = (errors: string[]) => errors[0].replace(/["'`<>]/g, '').slice(0, 120);

/**
 * Never trusts: user ids, ownership fields, client `quality`/"verified" claims, arbitrary metrics/units, or provenance.
 * Quality is derived here (`unverified` for BLE, `user_entered` for manual); the provider label is set here.
 */
export function prepareBatch(body: Record<string, unknown>, now: () => Date = () => new Date()): Prepared {
  const d = body.device as Record<string, unknown> | undefined;
  const method = d?.ingestionMethod;
  if (!d || typeof d !== 'object' || (method !== 'direct_ble' && method !== 'manual_import')) {
    return { ok: false, code: 'invalid_device', message: 'device.ingestionMethod must be direct_ble or manual_import.' };
  }
  const deviceKey = typeof d.deviceKey === 'string' && DEVICE_KEY.test(d.deviceKey) ? d.deviceKey.trim() : null;
  const manufacturer = cleanLabel(d.manufacturer, 100);
  if (!deviceKey || !manufacturer) return { ok: false, code: 'invalid_device', message: 'device.deviceKey and device.manufacturer are required.' };
  const device: IngestDevice = { deviceKey, manufacturer, model: cleanLabel(d.model, 100), displayName: cleanLabel(d.displayName, 100), ingestionMethod: method };

  const samples = body.samples;
  if (!Array.isArray(samples) || samples.length === 0) return { ok: false, code: 'invalid_batch', message: 'samples must be a non-empty array.' };
  if (samples.length > MAX_BATCH) return { ok: false, code: 'batch_too_large', message: `A batch holds at most ${MAX_BATCH} samples.` };

  let workoutSessionId: string | null = null;
  if (body.workoutSessionId != null) {
    if (typeof body.workoutSessionId !== 'string' || !SESSION_ID.test(body.workoutSessionId)) return { ok: false, code: 'invalid_workout_session', message: 'workoutSessionId is not a valid id.' };
    workoutSessionId = body.workoutSessionId;
  }

  const results: RecordResult[] = [];
  const rows: IngestRow[] = [];
  const rowIndex: number[] = [];
  const nowMs = now().getTime();

  samples.forEach((raw, index) => {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return void results.push({ index, status: 'invalid', reason: 'not an object' });
    if (typeof r.metric !== 'string' || !Object.hasOwn(METRICS, r.metric)) return void results.push({ index, status: 'unsupported', reason: 'metric not supported' });
    if (r.origin === 'simulated') return void results.push({ index, status: 'rejected', reason: 'simulated data is never stored' });
    if (typeof r.origin !== 'string' || !(ORIGINS_BY_METHOD[method] as readonly string[]).includes(r.origin)) {
      return void results.push({ index, status: 'rejected', reason: 'origin not allowed for this ingestion method' });
    }
    const sourceRecordId = typeof r.sourceRecordId === 'string' && SOURCE_RECORD.test(r.sourceRecordId) ? r.sourceRecordId : null;
    const n = normalizeSample({
      deviceId: deviceKey, provider: PROVIDER_BY_METHOD[method], manufacturer, model: device.model, ingestionMethod: method,
      origin: r.origin as 'live' | 'synchronized' | 'manual', metric: r.metric, value: r.value, unit: typeof r.unit === 'string' ? r.unit : '',
      measuredAt: typeof r.measuredAt === 'string' ? r.measuredAt : '', measuredEndAt: typeof r.measuredEndAt === 'string' ? r.measuredEndAt : null,
      tzOffsetMin: typeof r.tzOffsetMin === 'number' ? r.tzOffsetMin : null, sourceRecordId,
      quality: method === 'manual_import' ? 'user_entered' : 'unverified'
    }, now);
    if (!n.ok) return void results.push({ index, status: 'invalid', reason: reasonOf(n.errors) });
    const s = n.sample;
    if (Date.parse(s.measuredAt) < nowMs - MAX_SAMPLE_AGE_MS) return void results.push({ index, status: 'invalid', reason: 'measuredAt is too old' });
    rows.push({
      metric: s.metric as MetricType, value: s.value, unit: s.unit, measuredAt: s.measuredAt, measuredEndAt: s.measuredEndAt, tzOffsetMin: s.tzOffsetMin,
      sourceRecordId: s.sourceRecordId, origin: s.origin as IngestRow['origin'], quality: s.quality, dedupeKey: s.dedupeKey, workoutSessionId
    });
    rowIndex.push(index);
  });

  return { ok: true, device, workoutSessionId, rows, rowIndex, results };
}

/**
 * Merges the database's answer into per-record outcomes. A key the database did not insert (or a repeat inside the batch) is a duplicate,
 * unless the database refused it because it lies outside the workout's window. Verification comes only from `verdict` (the database).
 */
export function finalizeResults(p: Extract<Prepared, { ok: true }>, insertedKeys: readonly string[], verdict: DbVerdict = {}): RecordResult[] {
  const inserted = new Set(insertedKeys);
  const verified = new Set(verdict.verifiedKeys ?? []);
  const outside = new Set(verdict.outsideSessionKeys ?? []);
  const seen = new Set<string>();
  const out = [...p.results];
  p.rows.forEach((row, i) => {
    const index = p.rowIndex[i];
    if (outside.has(row.dedupeKey) && !inserted.has(row.dedupeKey)) {
      seen.add(row.dedupeKey);
      return void out.push({ index, status: 'rejected', reason: 'outside_session_window' });
    }
    const first = inserted.has(row.dedupeKey) && !seen.has(row.dedupeKey);
    seen.add(row.dedupeKey);
    if (!first) return void out.push({ index, status: 'duplicate' });
    out.push(p.workoutSessionId ? { index, status: 'accepted', verification: verified.has(row.dedupeKey) ? 'verified' : 'unverified' } : { index, status: 'accepted' });
  });
  return out.sort((a, b) => a.index - b.index);
}

export function summarize(results: RecordResult[]) {
  const s = { received: results.length, accepted: 0, duplicate: 0, rejected: 0, unsupported: 0, invalid: 0 };
  for (const r of results) s[r.status]++;
  return s;
}
