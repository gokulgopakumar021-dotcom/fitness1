import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeMaxHrSource,
  resolveMaxHeartRate,
  validateUserMaxHr,
  zoneNumberForBpm
} from './heartRateZones';
import { readUserMaxHr, writeUserMaxHr } from './maxHrStore';
import { calculateHeartRateZone } from '../types/bluetooth';
import { setStorageScope } from '../storage/storageScope';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('resolveMaxHeartRate (no guessed age)', () => {
  it('returns null with no age and no user value', () => {
    expect(resolveMaxHeartRate({})).toBeNull();
  });
  it.each([0, -5, NaN, Infinity, 9, 101, '30', null, undefined])('ignores implausible age %p', (age) => {
    expect(resolveMaxHeartRate({ age })).toBeNull();
  });
  it('estimates 220 - age from a plausible age and labels it', () => {
    const r = resolveMaxHeartRate({ age: 40 });
    expect(r).toEqual({ bpm: 180, source: 'age_estimate' });
    expect(describeMaxHrSource(r!.source)).toMatch(/Estimated/);
  });
  it('user value overrides age', () => {
    expect(resolveMaxHeartRate({ age: 40, userMaxHr: 195 })).toEqual({ bpm: 195, source: 'user' });
  });
  it('invalid user value falls back to age, then to null', () => {
    expect(resolveMaxHeartRate({ age: 40, userMaxHr: 50 })).toEqual({ bpm: 180, source: 'age_estimate' });
    expect(resolveMaxHeartRate({ userMaxHr: 500 })).toBeNull();
  });
});

describe('validateUserMaxHr', () => {
  it('accepts the range edges and rounds', () => {
    expect(validateUserMaxHr(120)).toBe(120);
    expect(validateUserMaxHr(230)).toBe(230);
    expect(validateUserMaxHr(187.4)).toBe(187);
  });
  it.each([119, 231, NaN, '190', null, undefined])('rejects %p', (v) => {
    expect(validateUserMaxHr(v)).toBeNull();
  });
});

describe('zones', () => {
  it('no zone without a maximum or with a bad bpm', () => {
    expect(zoneNumberForBpm(120, null)).toBeNull();
    expect(zoneNumberForBpm(0, 190)).toBeNull();
    expect(zoneNumberForBpm(NaN, 190)).toBeNull();
    expect(calculateHeartRateZone(120, null)).toBeNull();
  });
  it('boundaries against max 200', () => {
    expect(zoneNumberForBpm(119, 200)).toBe(1);
    expect(zoneNumberForBpm(120, 200)).toBe(2);
    expect(zoneNumberForBpm(140, 200)).toBe(3);
    expect(zoneNumberForBpm(160, 200)).toBe(4);
    expect(zoneNumberForBpm(180, 200)).toBe(5);
    expect(calculateHeartRateZone(150, 200)?.zone).toBe(3);
  });
});

describe('max HR store is per-account', () => {
  beforeEach(() => { localStorage.clear(); setStorageScope(A); });
  it('round-trips and isolates accounts', () => {
    expect(writeUserMaxHr(188)).toBe(188);
    expect(readUserMaxHr()).toBe(188);
    setStorageScope(B);
    expect(readUserMaxHr()).toBeNull();
    setStorageScope(A);
    expect(readUserMaxHr()).toBe(188);
  });
  it('rejects invalid values without overwriting, and clears with null', () => {
    writeUserMaxHr(190);
    expect(writeUserMaxHr(999)).toBe(190);
    expect(readUserMaxHr()).toBe(190);
    expect(writeUserMaxHr(null)).toBeNull();
    expect(readUserMaxHr()).toBeNull();
  });
  it('ignores a tampered stored value', () => {
    const key = Object.keys(localStorage)[0];
    writeUserMaxHr(190);
    const k = Object.keys(localStorage).find((x) => x.includes('ironlog_user_max_hr'))!;
    localStorage.setItem(k, 'abc');
    expect(readUserMaxHr()).toBeNull();
    void key;
  });
});
