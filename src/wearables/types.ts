/**
 * BT-04 — normalized wearable data vocabulary. Pure types + constants; no I/O.
 * Principle: adapters translate provider data INTO this shape; nothing downstream knows brand names.
 * Missing is never zero: an absent measurement is simply not a sample.
 */

export type IngestionMethod = 'direct_ble' | 'cloud_api' | 'aggregator' | 'native_health_store' | 'manual_import';

/** How the value reached us. `simulated` data must never be persisted or sent to an AI provider. */
export type DataOrigin = 'live' | 'synchronized' | 'manual' | 'simulated';

export type QualityStatus = 'device_reported' | 'user_entered' | 'derived' | 'unverified';

export type MetricType =
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv_rmssd'
  | 'hrv_sdnn'
  | 'steps'
  | 'active_energy'
  | 'total_energy'
  | 'distance'
  | 'workout_duration'
  | 'sleep_duration'
  | 'blood_oxygen'
  | 'respiratory_rate';

export type Unit = 'bpm' | 'ms' | 'count' | 'kcal' | 'm' | 's' | 'percent' | 'breaths_per_min';

export interface MetricSpec {
  unit: Unit;
  /** Inclusive plausibility range. Values outside are rejected, never clamped. */
  min: number;
  max: number;
  /** Cumulative metrics are summed WITHIN one source and never ACROSS sources. */
  cumulative: boolean;
}

export const METRICS: Record<MetricType, MetricSpec> = {
  heart_rate: { unit: 'bpm', min: 20, max: 255, cumulative: false },
  resting_heart_rate: { unit: 'bpm', min: 20, max: 200, cumulative: false },
  // RMSSD and SDNN are different statistics; providers must not be mixed under one type.
  hrv_rmssd: { unit: 'ms', min: 0, max: 400, cumulative: false },
  hrv_sdnn: { unit: 'ms', min: 0, max: 400, cumulative: false },
  steps: { unit: 'count', min: 0, max: 200_000, cumulative: true },
  active_energy: { unit: 'kcal', min: 0, max: 20_000, cumulative: true },
  total_energy: { unit: 'kcal', min: 0, max: 30_000, cumulative: true },
  distance: { unit: 'm', min: 0, max: 500_000, cumulative: true },
  workout_duration: { unit: 's', min: 1, max: 86_400, cumulative: true },
  sleep_duration: { unit: 's', min: 1, max: 86_400, cumulative: true },
  blood_oxygen: { unit: 'percent', min: 50, max: 100, cumulative: false },
  respiratory_rate: { unit: 'breaths_per_min', min: 3, max: 70, cumulative: false },
};

export interface RawSampleInput {
  deviceId: string;
  provider: string;
  manufacturer: string;
  model?: string | null;
  ingestionMethod: IngestionMethod;
  origin: DataOrigin;
  metric: string;
  value: unknown;
  unit: string;
  /** ISO-8601 with offset or Z. Start of the measurement window. */
  measuredAt: string;
  /** Optional end of window for interval metrics. */
  measuredEndAt?: string | null;
  /** Minutes east of UTC at the measurement location, when the source reports it. */
  tzOffsetMin?: number | null;
  /** Provider's own record id; the strongest dedupe signal. */
  sourceRecordId?: string | null;
  quality?: QualityStatus;
  importedAt?: string;
}

export interface NormalizedSample {
  deviceId: string;
  provider: string;
  manufacturer: string;
  model: string | null;
  ingestionMethod: IngestionMethod;
  origin: DataOrigin;
  metric: MetricType;
  value: number;
  unit: Unit;
  measuredAt: string; // canonical UTC ISO
  measuredEndAt: string | null;
  tzOffsetMin: number | null;
  sourceRecordId: string | null;
  quality: QualityStatus;
  importedAt: string;
  dedupeKey: string;
}

/** Compatibility states from the BT-04 brief. Nothing may be 'verified' without a dated hardware record. */
export type CompatibilityState = 'untested' | 'documented' | 'implemented' | 'verified' | 'degraded' | 'unsupported';
