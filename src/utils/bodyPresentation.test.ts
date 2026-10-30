import { describe, expect, it } from 'vitest';
import type { BodyMetricEntry } from '../types';
import {
  daysSince,
  describeAge,
  filterPointsByRange,
  formatEntryDate,
  fromDisplayWeight,
  latestComparison,
  metricSeries,
  toDisplayWeight,
  validateMeasurementDraft
} from './bodyPresentation';

const entry = (date: string, weightKg: number, extra: Partial<BodyMetricEntry> = {}): BodyMetricEntry => ({
  id: `bm-${date}`,
  date,
  weightKg,
  bmi: 24,
  ...extra
});

describe('metricSeries', () => {
  it('returns only real records, in date order, never zero-filled', () => {
    const entries = [
      entry('2026-10-03', 80, { waistCm: 82 }),
      entry('2026-10-01', 81),
      entry('2026-10-02', 80.5, { waistCm: 0 }) // 0 is not a measurement
    ];
    expect(metricSeries(entries, 'weight').map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(metricSeries(entries, 'waist')).toEqual([{ id: 'bm-2026-10-03', date: '2026-10-03', value: 82 }]);
    expect(metricSeries(entries, 'bodyFat')).toEqual([]);
  });
});

describe('latestComparison', () => {
  it('has no delta with a single record', () => {
    const c = latestComparison(metricSeries([entry('2026-10-01', 80)], 'weight'))!;
    expect(c.previous).toBeNull();
    expect(c.delta).toBeNull();
  });
  it('compares the latest record with the one immediately before it', () => {
    const c = latestComparison(metricSeries([entry('2026-10-01', 81), entry('2026-10-05', 80.2)], 'weight'))!;
    expect(c.previous?.date).toBe('2026-10-01');
    expect(c.delta).toBeCloseTo(-0.8);
  });
  it('is null for an empty series', () => {
    expect(latestComparison([])).toBeNull();
  });
});

describe('dates and ranges', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it('counts whole UTC days and describes age', () => {
    expect(daysSince('2026-10-30', now)).toBe(0);
    expect(describeAge('2026-10-30', now)).toBe('today');
    expect(describeAge('2026-10-29', now)).toBe('yesterday');
    expect(describeAge('2026-10-20', now)).toBe('10 days ago');
  });
  it('filters by range using the same day rule as Progression', () => {
    const pts = [{ date: '2026-07-01' }, { date: '2026-09-15' }, { date: '2026-10-20' }];
    expect(filterPointsByRange(pts, '30d', now)).toHaveLength(1);
    expect(filterPointsByRange(pts, '90d', now)).toHaveLength(2);
    expect(filterPointsByRange(pts, 'all', now)).toHaveLength(3);
  });
  it('formats a date key without shifting the day', () => {
    expect(formatEntryDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatEntryDate('not-a-date')).toBe('not-a-date');
  });
});

describe('weight units', () => {
  it('displays kg to one decimal and converts to lbs with the shared helper', () => {
    expect(toDisplayWeight(78.55, 'kg')).toBe(78.5);
    expect(toDisplayWeight(80, 'lbs')).toBe(176.4);
  });
  it('converts form input back to kg for storage', () => {
    expect(fromDisplayWeight(176.4, 'lbs')).toBe(80);
    expect(fromDisplayWeight(80.123, 'kg')).toBe(80.12);
  });
});

describe('validateMeasurementDraft', () => {
  const ok = { date: '2026-10-01', weight: '80', waist: '', bodyFat: '', notes: '' };
  it('accepts a weight-only entry', () => {
    expect(validateMeasurementDraft(ok)).toEqual({});
  });
  it('rejects missing, zero or non-numeric weight', () => {
    expect(validateMeasurementDraft({ ...ok, weight: '' }).weight).toBeTruthy();
    expect(validateMeasurementDraft({ ...ok, weight: '0' }).weight).toBeTruthy();
    expect(validateMeasurementDraft({ ...ok, weight: 'abc' }).weight).toBeTruthy();
  });
  it('rejects a bad date', () => {
    expect(validateMeasurementDraft({ ...ok, date: '' }).date).toBeTruthy();
  });
  it('validates optional fields only when filled in', () => {
    expect(validateMeasurementDraft({ ...ok, waist: '-3' }).waist).toBeTruthy();
    expect(validateMeasurementDraft({ ...ok, bodyFat: '100' }).bodyFat).toBeTruthy();
    expect(validateMeasurementDraft({ ...ok, bodyFat: '14.5', waist: '81.5' })).toEqual({});
  });
});
