import type { BodyMetricEntry, PreferredUnit } from '../types';
import { kgToLbs, lbsToKg } from './calculations';

/**
 * Presentation helpers for the Body Metrics screen.
 * Pure functions over `BodyMetricEntry[]` as `db.getBodyMetrics()` returns it. They only pick, filter,
 * compare and format stored values: BMI, the 7-day average and unit conversion still come from
 * `utils/calculations.ts`, and storage rules still live in `db.addOrUpdateBodyMetric`.
 */

export type BodyMetricKey = 'weight' | 'waist' | 'bodyFat';
export type BodyRange = '30d' | '90d' | 'all';

export interface MetricPoint {
  id: string;
  date: string; // YYYY-MM-DD
  /** Stored units: kg for weight, cm for waist, % for body fat. */
  value: number;
}

export const METRIC_LABEL: Record<BodyMetricKey, string> = {
  weight: 'Weight',
  waist: 'Waist',
  bodyFat: 'Body fat'
};

/** Minimum points before a trend line says anything. Fewer than this are shown as plain records. */
export const MIN_POINTS_FOR_TREND = 3;

const isPositiveNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * One metric's recorded values in chronological order. Entries without a usable value for the metric are
 * skipped, never zero-filled, so the series only ever contains dates that really have a record.
 */
export function metricSeries(entries: BodyMetricEntry[], key: BodyMetricKey): MetricPoint[] {
  const pick = (e: BodyMetricEntry): number | undefined =>
    key === 'weight' ? e.weightKg : key === 'waist' ? e.waistCm : e.bodyFatPercentage;
  return entries
    .map((e) => ({ id: e.id, date: e.date, value: pick(e) }))
    .filter((p): p is MetricPoint => isPositiveNumber(p.value) && typeof p.date === 'string' && p.date.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface LatestComparison {
  latest: MetricPoint;
  /** The record immediately before `latest`, or null when there is only one record. */
  previous: MetricPoint | null;
  /** latest minus previous, in stored units. Null when no previous record exists. */
  delta: number | null;
}

export function latestComparison(series: MetricPoint[]): LatestComparison | null {
  if (series.length === 0) return null;
  const latest = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;
  return { latest, previous, delta: previous ? latest.value - previous.value : null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `date` (YYYY-MM-DD) to `now`, by UTC day key, like the rest of the app. Never negative. */
export function daysSince(date: string, now: Date = new Date()): number {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const then = Date.parse(date);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((today - then) / DAY_MS));
}

/** Keeps points whose age in days is within the range. Same rule the Progression screen uses. */
export function filterPointsByRange<T extends { date: string }>(points: T[], range: BodyRange, now: Date = new Date()): T[] {
  if (range === 'all') return points;
  const limit = range === '30d' ? 30 : 90;
  return points.filter((p) => daysSince(p.date, now) <= limit);
}

/** "12 Oct 2026". Fixed to UTC so a YYYY-MM-DD key never shifts a day with the viewer's time zone. */
export function formatEntryDate(date: string): string {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "today", "yesterday" or "N days ago". */
export function describeAge(date: string, now: Date = new Date()): string {
  const d = daysSince(date, now);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Weight in the person's preferred unit, one decimal. Storage stays in kg. */
export function toDisplayWeight(kg: number, unit: PreferredUnit): number {
  return unit === 'lbs' ? kgToLbs(kg) : Number(kg.toFixed(1));
}

/** Inverse of `toDisplayWeight` for form input. */
export function fromDisplayWeight(value: number, unit: PreferredUnit): number {
  return unit === 'lbs' ? lbsToKg(value) : Number(value.toFixed(2));
}

export interface MeasurementDraft {
  date: string;
  /** Raw text from the inputs. Weight is in the person's preferred unit; waist is cm; body fat is %. */
  weight: string;
  waist: string;
  bodyFat: string;
  notes: string;
}

export type MeasurementErrors = Partial<Record<keyof MeasurementDraft, string>>;

/**
 * Field-level validation for the log form. Weight must be a positive number (the rule `handleSaveMetric`
 * always had); waist and body fat are optional but, when given, must be real numbers (a blank is fine,
 * "abc" is not) and body fat must be a percentage below 100.
 */
export function validateMeasurementDraft(draft: MeasurementDraft): MeasurementErrors {
  const errors: MeasurementErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(draft.date))) {
    errors.date = 'Choose a date.';
  }
  const weight = Number(draft.weight);
  if (draft.weight.trim() === '' || !Number.isFinite(weight) || weight <= 0) {
    errors.weight = 'Enter a weight greater than 0.';
  }
  if (draft.waist.trim() !== '') {
    const waist = Number(draft.waist);
    if (!Number.isFinite(waist) || waist <= 0) errors.waist = 'Enter a waist measurement greater than 0, or leave it blank.';
  }
  if (draft.bodyFat.trim() !== '') {
    const bf = Number(draft.bodyFat);
    if (!Number.isFinite(bf) || bf <= 0 || bf >= 100) errors.bodyFat = 'Enter a percentage between 0 and 100, or leave it blank.';
  }
  return errors;
}
