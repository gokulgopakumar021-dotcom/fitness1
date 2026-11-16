/**
 * Heart-rate zone helpers (BT-04C).
 *
 * Zones are percentages of a maximum heart rate. A maximum is only ever known from:
 *   1. a value the user entered ("user"), or
 *   2. the generic 220 - age formula computed from a real, plausible age ("age_estimate").
 * With neither, there is NO maximum and therefore NO zone. Nothing here guesses an age.
 * Output is a training estimate, not a medical measurement.
 */

export const MIN_VALID_AGE = 10;
export const MAX_VALID_AGE = 100;
export const MIN_USER_MAX_HR = 120;
export const MAX_USER_MAX_HR = 230;

export type MaxHrSource = 'user' | 'age_estimate';

export interface MaxHeartRate {
  bpm: number;
  source: MaxHrSource;
}

function isPlausibleAge(age: unknown): age is number {
  return typeof age === 'number' && Number.isFinite(age) && age >= MIN_VALID_AGE && age <= MAX_VALID_AGE;
}

/** Whole bpm within the accepted range, else null. */
export function validateUserMaxHr(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= MIN_USER_MAX_HR && rounded <= MAX_USER_MAX_HR ? rounded : null;
}

/** User value wins; otherwise 220 - age for a plausible age; otherwise null (no zone). */
export function resolveMaxHeartRate(input: { age?: unknown; userMaxHr?: unknown }): MaxHeartRate | null {
  const user = validateUserMaxHr(input.userMaxHr);
  if (user !== null) return { bpm: user, source: 'user' };
  if (isPlausibleAge(input.age)) return { bpm: 220 - Math.round(input.age), source: 'age_estimate' };
  return null;
}

/** Zone number 1-5 for a bpm against a known maximum, or null when bpm or maximum is unusable. */
export function zoneNumberForBpm(bpm: unknown, maxHr: number | null | undefined): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) return null;
  if (typeof maxHr !== 'number' || !Number.isFinite(maxHr) || maxHr <= 0) return null;
  const pct = (bpm / maxHr) * 100;
  if (pct < 60) return 1;
  if (pct < 70) return 2;
  if (pct < 80) return 3;
  if (pct < 90) return 4;
  return 5;
}

export function describeMaxHrSource(source: MaxHrSource): string {
  return source === 'user' ? 'Your max HR' : 'Estimated (220 − age)';
}
