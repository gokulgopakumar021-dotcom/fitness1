import { describe, expect, it, vi } from 'vitest';
import { activeCategories, aiCategoryForMetric, authoriseTrainerBluetooth, sanitizeDeviceName, WEARABLE_CONSENT_VERSION } from './consentPolicy';
import { deriveDeviceState } from './deviceState';
import { HrRecorder } from './hrRecorder';
import type { IngestPayload } from './ingestClient';
import { INITIAL_SYNC_STATUS, reduceSync, type IngestClientResult, type IngestSummary } from './syncStatus';

const sum = (o: Partial<IngestSummary> = {}): IngestSummary => ({ received: 0, accepted: 0, duplicate: 0, rejected: 0, unsupported: 0, invalid: 0, ...o });
const ok = (o: Partial<IngestSummary>): IngestClientResult => ({ kind: 'ok', summary: sum(o), syncedAt: '2026-11-16T10:00:00.000Z' });

describe('consent policy', () => {
  it('no record, stale record and unknown categories authorise nothing', () => {
    expect(activeCategories(null).size).toBe(0);
    expect(activeCategories({ version: WEARABLE_CONSENT_VERSION + 1, categories: ['live_heart_rate'] }).size).toBe(0);
    expect([...activeCategories({ version: WEARABLE_CONSENT_VERSION, categories: ['live_heart_rate', 'ssn', '__proto__'] })]).toEqual(['live_heart_rate']);
  });
  it('live and historical heart rate are separate categories', () => {
    expect(aiCategoryForMetric('heart_rate', 'live')).toBe('live_heart_rate');
    expect(aiCategoryForMetric('heart_rate', 'history')).toBe('historical_heart_rate');
    expect(aiCategoryForMetric('steps', 'live')).toBe('activity_metrics');
    expect(aiCategoryForMetric('nope', 'live')).toBeNull();
  });
  it('sanitizes device names to short plain text', () => {
    expect(sanitizeDeviceName('Polar H10 1A2B3C')).toBe('Polar H10 1A2B3C');
    expect(sanitizeDeviceName('```<script>alert(1)</script>```')).toBe('script alert(1) script');
    expect(sanitizeDeviceName('x'.repeat(200))!.length).toBe(32);
    expect(sanitizeDeviceName('   ')).toBeUndefined();
    expect(sanitizeDeviceName('<>`')).toBeUndefined();
    expect(sanitizeDeviceName(42)).toBeUndefined();
  });
  it('reduces the client object to the three authorised fields', () => {
    const live = new Set(['live_heart_rate'] as const);
    expect(authoriseTrainerBluetooth({ isConnected: true, bpm: 99.6, deviceName: 'H10', extra: { a: 1 } }, live)).toEqual({ isConnected: true, deviceName: 'H10', bpm: 100 });
    expect(authoriseTrainerBluetooth({ isConnected: true, bpm: 99 }, new Set())).toEqual({ isConnected: false });
    expect(authoriseTrainerBluetooth('x', live)).toEqual({ isConnected: false });
    expect(authoriseTrainerBluetooth([], live)).toEqual({ isConnected: false });
  });
});

describe('sync status model', () => {
  const at = '2026-11-16T10:00:01.000Z';
  it('is "synced" only when the backend confirmed with nothing rejected', () => {
    expect(INITIAL_SYNC_STATUS.state).toBe('never');
    expect(reduceSync(INITIAL_SYNC_STATUS, ok({ received: 3, accepted: 3 }), at, 0).state).toBe('synced');
    expect(reduceSync(INITIAL_SYNC_STATUS, ok({ received: 3, duplicate: 3 }), at, 0).state).toBe('synced');
  });
  it('reports partial when some records were rejected and failed when none were stored', () => {
    expect(reduceSync(INITIAL_SYNC_STATUS, ok({ received: 3, accepted: 2, invalid: 1 }), at, 0).state).toBe('partial');
    expect(reduceSync(INITIAL_SYNC_STATUS, ok({ received: 2, rejected: 2 }), at, 0).state).toBe('failed');
  });
  it('maps transport outcomes and never records a success time for them', () => {
    const cases: [IngestClientResult['kind'], string][] = [['auth_expired', 'auth_expired'], ['consent_required', 'permission_revoked'], ['unavailable', 'provider_unavailable'], ['rate_limited', 'provider_unavailable'], ['failed', 'failed']];
    for (const [kind, state] of cases) {
      const s = reduceSync(INITIAL_SYNC_STATUS, { kind } as IngestClientResult, at, 4);
      expect(s).toMatchObject({ state, lastSuccessAt: null, pending: 4 });
    }
  });
});

describe('device state', () => {
  const base = { live: true, directBluetooth: true, sync: 'never' as const, workoutSyncConsent: true };
  it('derives each state', () => {
    expect(deriveDeviceState(base)).toBe('connected');
    expect(deriveDeviceState({ ...base, live: false })).toBe('disconnected');
    expect(deriveDeviceState({ ...base, live: false, directBluetooth: false })).toBe('unsupported_browser');
    expect(deriveDeviceState({ ...base, sync: 'syncing' })).toBe('syncing');
    expect(deriveDeviceState({ ...base, sync: 'failed' })).toBe('sync_failed');
    expect(deriveDeviceState({ ...base, sync: 'provider_unavailable' })).toBe('sync_failed');
    expect(deriveDeviceState({ ...base, sync: 'auth_expired' })).toBe('auth_expired');
    expect(deriveDeviceState({ ...base, workoutSyncConsent: false })).toBe('permission_required');
    expect(deriveDeviceState({ ...base, sync: 'permission_revoked' })).toBe('permission_required');
  });
});

describe('HrRecorder', () => {
  const dev = { key: 'dev-1', name: 'Polar H10' };
  function make(results: IngestClientResult[] = [], opts: { cap?: number } = {}) {
    let t = Date.parse('2026-11-16T10:00:00.000Z');
    const sent: IngestPayload[] = [];
    const queue = [...results];
    const rec = new HrRecorder({ now: () => t, maxBuffered: opts.cap, send: async (p) => { sent.push(structuredClone(p)); return queue.shift() ?? ok({ received: p.samples.length, accepted: p.samples.length }); } });
    return { rec, sent, tick: (ms: number) => { t += ms; } };
  }
  it('throttles to one reading per interval, drops implausible values and never invents data', () => {
    const { rec, tick } = make();
    expect(rec.offer('s1', 140, dev)).toBe(true);
    tick(1000); expect(rec.offer('s1', 141, dev)).toBe(false);
    tick(5000); expect(rec.offer('s1', 999, dev)).toBe(false);
    expect(rec.offer('s1', NaN, dev)).toBe(false);
    expect(rec.offer('', 140, dev)).toBe(false);
    expect(rec.pending()).toBe(1);
  });
  it('sends real readings with the workout id, then clears them on confirmation', async () => {
    const { rec, sent, tick } = make();
    rec.offer('s1', 140, dev); tick(5000); rec.offer('s1', 150, dev);
    await rec.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ workoutSessionId: 's1', device: { deviceKey: 'dev-1', ingestionMethod: 'direct_ble' } });
    expect(sent[0].samples.map((s) => [s.metric, s.value, s.unit, s.origin])).toEqual([['heart_rate', 140, 'bpm', 'live'], ['heart_rate', 150, 'bpm', 'live']]);
    expect(rec.pending()).toBe(0);
    expect(rec.status.state).toBe('synced');
    await rec.flush();
    expect(sent).toHaveLength(1);
  });
  it('keeps readings across an interrupted connection and resends the SAME timestamps (idempotent delayed sync)', async () => {
    const { rec, sent, tick } = make([{ kind: 'unavailable' }, { kind: 'rate_limited' }]);
    rec.offer('s1', 140, dev); tick(5000); rec.offer('s1', 142, dev);
    await rec.flush();
    expect(rec.pending()).toBe(2);
    expect(rec.status.state).toBe('provider_unavailable');
    tick(120_000);
    await rec.flush(); // still limited
    expect(rec.pending()).toBe(2);
    await rec.flush(); // succeeds
    expect(rec.pending()).toBe(0);
    expect(sent[2].samples).toEqual(sent[0].samples);
    expect(rec.status.state).toBe('synced');
  });
  it('keeps a transient auth failure for retry', async () => {
    const { rec } = make([{ kind: 'auth_expired' }]);
    rec.offer('s1', 140, dev);
    await rec.flush();
    expect(rec.pending()).toBe(1);
    expect(rec.status.state).toBe('auth_expired');
  });
  it('discards everything and stops recording when the server says consent is off', async () => {
    const { rec, sent, tick } = make([{ kind: 'consent_required' }]);
    rec.offer('s1', 140, dev);
    await rec.flush();
    expect(rec.pending()).toBe(0);
    expect(rec.status.state).toBe('permission_revoked');
    tick(10_000);
    expect(rec.offer('s1', 150, dev)).toBe(false);
    await rec.flush();
    expect(sent).toHaveLength(1);
    rec.reset();
    expect(rec.offer('s1', 150, dev)).toBe(true);
  });
  it('keeps workouts apart and never mixes sessions in one request', async () => {
    const { rec, sent, tick } = make();
    rec.offer('A', 130, dev); tick(5000); rec.offer('B', 150, dev);
    await rec.flush();
    expect(sent.map((p) => [p.workoutSessionId, p.samples.map((s) => s.value)])).toEqual([['A', [130]], ['B', [150]]]);
  });
  it('caps memory by dropping the oldest readings, and sends in batches', async () => {
    const small = make([], { cap: 3 });
    for (let i = 0; i < 5; i++) { small.rec.offer('s', 100 + i, dev); small.tick(5000); }
    expect(small.rec.pending()).toBe(3);
    await small.rec.flush();
    expect(small.sent[0].samples.map((s) => s.value)).toEqual([102, 103, 104]);
    const big = make();
    for (let i = 0; i < 230; i++) { big.rec.offer('s', 100 + (i % 50), dev); big.tick(5000); }
    await big.rec.flush();
    expect(big.sent.map((p) => p.samples.length)).toEqual([100, 100, 30]);
  });
  it('ignores a second flush while one is in flight', async () => {
    let release: (r: IngestClientResult) => void = () => {};
    const send = vi.fn(() => new Promise<IngestClientResult>((r) => { release = r; }));
    const rec = new HrRecorder({ send, now: () => 1_000_000 });
    rec.offer('s', 140, dev);
    const p1 = rec.flush(); void rec.flush();
    expect(send).toHaveBeenCalledTimes(1);
    release(ok({ received: 1, accepted: 1 }));
    await p1;
  });
});

import { estimateActiveKcalPerMinute } from './energy';
describe('heart-rate energy estimate', () => {
  it('needs real age, weight and sex: never defaults or guesses', () => {
    const full = { bpm: 140, age: 30, weightKg: 70 };
    expect(estimateActiveKcalPerMinute({ ...full, sex: 'male' })).toBeCloseTo((-55.0969 + 0.6309 * 140 + 0.1988 * 70 + 0.2017 * 30) / 4.184, 6);
    expect(estimateActiveKcalPerMinute({ ...full, sex: 'female' })).toBeCloseTo((-20.4022 + 0.4472 * 140 - 0.1263 * 70 + 0.074 * 30) / 4.184, 6);
    for (const missing of [{ age: undefined }, { age: 0 }, { weightKg: null }, { weightKg: 0 }, { sex: 'unspecified' }, { sex: 'other' }, { sex: undefined }]) {
      expect(estimateActiveKcalPerMinute({ ...full, sex: 'male', ...missing } as never)).toBeNull();
    }
    expect(estimateActiveKcalPerMinute({ bpm: 80, age: 30, weightKg: 70, sex: 'male' })).toBeNull();
    expect(estimateActiveKcalPerMinute({ bpm: 300, age: 30, weightKg: 70, sex: 'male' })).toBeNull();
  });
});
