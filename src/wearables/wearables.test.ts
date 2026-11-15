// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement, parseBatteryLevel } from './heartRate';
import { detectWearableCapabilities, detectPlatform } from './capabilities';
import { normalizeSample, mergeIncoming, resolveDailyTotal, isPersistable, localDate } from './normalize';
import { grantWearableAiConsent, readWearableAiConsent, revokeWearableAiConsent, hasWearableAiConsent } from './consent';
import { buildTrainerBluetoothContext } from './trainerContext';
import { BRAND_COMPATIBILITY } from './compatibility';
import type { RawSampleInput, NormalizedSample } from './types';

const dv = (...b: number[]) => new DataView(new Uint8Array(b).buffer);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const NOW = () => new Date('2026-11-15T12:00:00Z');
const base: RawSampleInput = { deviceId: 'd1', provider: 'ble', manufacturer: 'Polar', ingestionMethod: 'direct_ble', origin: 'live', metric: 'heart_rate', value: 80, unit: 'bpm', measuredAt: '2026-11-15T10:00:00Z' };
const ok = (o: Partial<RawSampleInput> = {}): NormalizedSample => { const r = normalizeSample({ ...base, ...o }, NOW); if (!r.ok) throw new Error(r.errors.join()); return r.sample; };

describe('heart-rate parser (0x2A37)', () => {
  it('parses 8-bit and 16-bit values', () => {
    expect(parseHeartRateMeasurement(dv(0x00, 72))).toMatchObject({ ok: true, value: { bpm: 72 } });
    expect(parseHeartRateMeasurement(dv(0x01, 0x2c, 0x01))).toMatchObject({ ok: true, value: { bpm: 300 } });
  });
  it('contact: unsupported is undefined, not false', () => {
    expect((parseHeartRateMeasurement(dv(0x00, 70)) as any).value.contactDetected).toBeUndefined();
    expect((parseHeartRateMeasurement(dv(0x04, 70)) as any).value.contactDetected).toBe(false);
    expect((parseHeartRateMeasurement(dv(0x06, 70)) as any).value.contactDetected).toBe(true);
  });
  it('energy and RR intervals', () => {
    const r: any = parseHeartRateMeasurement(dv(0x18, 70, 0x10, 0x00, 0x00, 0x04));
    expect(r.value.energyExpendedJoules).toBe(16);
    expect(r.value.rrIntervalsMs).toEqual([1000]);
  });
  it('malformed/empty/truncated never throw and never fabricate', () => {
    expect(parseHeartRateMeasurement(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseHeartRateMeasurement(dv())).toEqual({ ok: false, reason: 'empty' });
    expect(parseHeartRateMeasurement(dv(0x01, 70))).toEqual({ ok: false, reason: 'truncated' });
    expect(parseHeartRateMeasurement(dv(0x08, 70, 1))).toEqual({ ok: false, reason: 'truncated' });
  });
  it('bpm 0 is a missing reading, not zero', () => {
    expect(parseHeartRateMeasurement(dv(0x00, 0))).toEqual({ ok: false, reason: 'no_reading' });
  });
  it('battery: real value only; out of range or absent is unknown', () => {
    expect(parseBatteryLevel(dv(57))).toBe(57);
    expect(parseBatteryLevel(dv(0))).toBe(0);
    expect(parseBatteryLevel(dv(200))).toBeNull();
    expect(parseBatteryLevel(undefined)).toBeNull();
  });
});

describe('browser capability detection', () => {
  const iosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  it('iOS without the API: unavailable, with PWA-install caveat', () => {
    const c = detectWearableCapabilities({ userAgent: iosUa, hasWebBluetooth: false, isSecureContext: true, isStandalonePwa: true });
    expect(c).toMatchObject({ platform: 'ios', directBluetooth: false, reason: 'ios_no_web_bluetooth', backgroundSync: false });
    expect(c.message).toMatch(/Home Screen/);
  });
  it('iPadOS posing as Mac is detected as iOS', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
  });
  it('Android Chrome with API is available but promises no background sync', () => {
    const c = detectWearableCapabilities({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', hasWebBluetooth: true, isSecureContext: true });
    expect(c).toMatchObject({ platform: 'android', directBluetooth: true, backgroundSync: false });
    expect(c.message).toMatch(/only while this page is open/);
  });
  it('insecure context and missing API/environment', () => {
    expect(detectWearableCapabilities({ userAgent: 'x', hasWebBluetooth: true, isSecureContext: false }).reason).toBe('insecure_context');
    expect(detectWearableCapabilities({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130', hasWebBluetooth: false, isSecureContext: true }).reason).toBe('browser_unsupported');
    expect(detectWearableCapabilities(null).directBluetooth).toBe(false);
  });
});

describe('normalization', () => {
  it('accepts a valid sample and canonicalises time to UTC', () => {
    const s = ok({ measuredAt: '2026-11-15T15:30:00+05:30', tzOffsetMin: 330 });
    expect(s.measuredAt).toBe('2026-11-15T10:00:00.000Z');
  });
  it('rejects invalid units, out-of-range, and non-numeric/missing values (never zero-fills)', () => {
    for (const bad of [{ unit: 'kcal' }, { value: 400 }, { value: null }, { value: undefined }, { value: '' }, { value: NaN }, { metric: 'glucose' }] as Partial<RawSampleInput>[])
      expect(normalizeSample({ ...base, ...bad }, NOW).ok).toBe(false);
  });
  it('0 steps is valid only for metrics where 0 is in range; 0 bpm is not', () => {
    expect(normalizeSample({ ...base, metric: 'steps', unit: 'count', value: 0 }, NOW).ok).toBe(true);
    expect(normalizeSample({ ...base, value: 0 }, NOW).ok).toBe(false);
  });
  it('rejects timestamps without timezone, future timestamps, bad offsets, reversed windows', () => {
    expect(normalizeSample({ ...base, measuredAt: '2026-11-15T10:00:00' }, NOW).ok).toBe(false);
    expect(normalizeSample({ ...base, measuredAt: '2026-11-16T10:00:00Z' }, NOW).ok).toBe(false);
    expect(normalizeSample({ ...base, tzOffsetMin: 9999 }, NOW).ok).toBe(false);
    expect(normalizeSample({ ...base, measuredEndAt: '2026-11-15T09:00:00Z' }, NOW).ok).toBe(false);
  });
  it('preserves provenance and defaults quality honestly', () => {
    const s = ok({ origin: 'manual', model: 'H10', sourceRecordId: ' abc ' });
    expect(s).toMatchObject({ manufacturer: 'Polar', model: 'H10', ingestionMethod: 'direct_ble', origin: 'manual', quality: 'user_entered', sourceRecordId: 'abc' });
    expect(ok().quality).toBe('unverified');
  });
  it('HRV RMSSD and SDNN are distinct metrics', () => {
    expect(ok({ metric: 'hrv_rmssd', unit: 'ms', value: 40 }).metric).not.toBe(ok({ metric: 'hrv_sdnn', unit: 'ms', value: 40 }).metric);
  });
  it('timezone-safe local date, with explicit UTC fallback', () => {
    expect(localDate(ok({ measuredAt: '2026-11-14T20:00:00Z', tzOffsetMin: 330 }))).toEqual({ date: '2026-11-15', basis: 'local_offset' });
    expect(localDate(ok({ measuredAt: '2026-11-14T20:00:00Z' }))).toEqual({ date: '2026-11-14', basis: 'utc' });
  });
});

describe('merge / idempotency / ordering', () => {
  const a = ok({ sourceRecordId: 'r1', value: 70 }), b = ok({ sourceRecordId: 'r2', value: 75, measuredAt: '2026-11-15T10:01:00Z' });
  it('re-import is a no-op (idempotent, retry-safe)', () => {
    const r1 = mergeIncoming(new Map(), [a, b]);
    const r2 = mergeIncoming(r1.store, [a, b]);
    expect(r1.inserted).toBe(2);
    expect(r2).toMatchObject({ inserted: 0, duplicates: 2, updated: 0 });
    expect([...r2.store.keys()].sort()).toEqual([...r1.store.keys()].sort());
  });
  it('out-of-order batches converge to the same store', () => {
    const x = mergeIncoming(new Map(), [a, b]).store, y = mergeIncoming(mergeIncoming(new Map(), [b]).store, [a]).store;
    expect([...x.keys()].sort()).toEqual([...y.keys()].sort());
  });
  it('provider revision updates only if newer', () => {
    const rev = ok({ sourceRecordId: 'r1', value: 71, importedAt: '2026-11-15T12:30:00Z' });
    const old = ok({ sourceRecordId: 'r1', value: 69, importedAt: '2026-11-15T00:00:00Z' });
    const s = mergeIncoming(new Map(), [a]).store;
    expect(mergeIncoming(s, [rev]).updated).toBe(1);
    expect(mergeIncoming(s, [old]).updated).toBe(0);
  });
  it('simulated samples are rejected from persistence', () => {
    const sim = ok({ origin: 'simulated', sourceRecordId: 's' });
    expect(isPersistable(sim)).toBe(false);
    expect(mergeIncoming(new Map(), [sim])).toMatchObject({ inserted: 0, rejectedSimulated: 1 });
  });
  it('partial failure: invalid items fail individually, valid ones still import', () => {
    const rs = [base, { ...base, value: 999 }, { ...base, measuredAt: '2026-11-15T10:05:00Z' }].map((i) => normalizeSample(i as RawSampleInput, NOW));
    expect(rs.map((r) => r.ok)).toEqual([true, false, true]);
  });
});

describe('overlapping sources never double count', () => {
  const steps = (deviceId: string, provider: string, value: number, t: string) => ok({ deviceId, provider, metric: 'steps', unit: 'count', value, measuredAt: t, sourceRecordId: `${deviceId}-${t}` });
  const data = [steps('watch', 'garmin', 4000, '2026-11-15T08:00:00Z'), steps('watch', 'garmin', 3000, '2026-11-15T09:00:00Z'), steps('phone', 'health_connect', 6500, '2026-11-15T08:00:00Z')];
  it('sums within a source, picks one by priority, lists the other as an alternate', () => {
    const t = resolveDailyTotal(data, 'steps', '2026-11-15', ['garmin'])!;
    expect(t.value).toBe(7000);
    expect(t.source).toBe('garmin|watch');
    expect(t.alternates).toEqual([{ source: 'health_connect|phone', value: 6500 }]);
  });
  it('no data stays null, not 0; non-cumulative metrics are refused', () => {
    expect(resolveDailyTotal(data, 'steps', '2026-11-14', [])).toBeNull();
    expect(() => resolveDailyTotal(data, 'heart_rate', '2026-11-15', [])).toThrow();
  });
});

describe('AI consent and trainer context', () => {
  it('is off by default; grant/revoke round-trips; stale versions ignored', () => {
    const st = mem();
    expect(readWearableAiConsent(st)).toBeNull();
    expect(hasWearableAiConsent('live_heart_rate', st)).toBe(false);
    expect(grantWearableAiConsent([], st)).toBeNull();
    grantWearableAiConsent(['live_heart_rate'], st);
    expect(hasWearableAiConsent('live_heart_rate', st)).toBe(true);
    expect(hasWearableAiConsent('activity_metrics', st)).toBe(false);
    revokeWearableAiConsent(st);
    expect(hasWearableAiConsent('live_heart_rate', st)).toBe(false);
    st.setItem('ironlog_wearable_ai_consent_v1', JSON.stringify({ version: 0, categories: ['live_heart_rate'], grantedAt: 'x' }));
    expect(readWearableAiConsent(st)).toBeNull();
    st.setItem('ironlog_wearable_ai_consent_v1', '{not json');
    expect(readWearableAiConsent(st)).toBeNull();
  });
  const live = { isConnected: true, isSimulated: false, deviceName: 'H10', bpm: 120 };
  it('without consent the AI is told nothing, not even the device', () => {
    expect(buildTrainerBluetoothContext(live, () => false)).toEqual({ isConnected: false });
  });
  it('simulated data is never sent, even with consent', () => {
    expect(buildTrainerBluetoothContext({ ...live, isSimulated: true }, () => true)).toEqual({ isConnected: false });
  });
  it('with consent: real bpm only; missing bpm is omitted, not 0', () => {
    expect(buildTrainerBluetoothContext(live, () => true)).toEqual({ isConnected: true, deviceName: 'H10', bpm: 120 });
    expect(buildTrainerBluetoothContext({ ...live, bpm: null }, () => true)).toEqual({ isConnected: true, deviceName: 'H10' });
  });
});

describe('compatibility data', () => {
  it('no brand may be Verified/Implemented without a hardware/code record at BT-04', () => {
    for (const b of BRAND_COMPATIBILITY) for (const v of Object.values(b.routes)) expect(['verified', 'implemented']).not.toContain(v);
  });
  it('covers every brand named in the brief', () => {
    const names = BRAND_COMPATIBILITY.map((b) => b.brand);
    for (const n of ['Apple Watch', 'Samsung Galaxy Watch', 'Garmin', 'Fitbit', 'Google Pixel Watch', 'Amazfit / Zepp', 'Xiaomi / Mi Fitness', 'Huawei', 'Polar', 'Suunto', 'COROS', 'Noise', 'boAt', 'Fire-Boltt', 'Fastrack', 'WHOOP', 'Oura']) expect(names).toContain(n);
  });
});
