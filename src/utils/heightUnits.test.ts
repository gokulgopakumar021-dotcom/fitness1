import { describe, expect, it } from 'vitest';
import { cmToFtIn, formatHeight, ftInToCm, HEIGHT_BOUNDS_CM, resolveHeightUnit, validateHeightCm } from './heightUnits';

describe('heightUnits', () => {
  it('converts cm to feet and inches', () => {
    expect(cmToFtIn(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(cmToFtIn(170)).toEqual({ feet: 5, inches: 6.9 });
  });

  it('never returns 12 inches: it carries into feet', () => {
    // 182.7 cm = 71.93 in -> rounds to 71.9; 182.8 cm = 71.97 -> 72.0 in = 6 ft 0 in
    expect(cmToFtIn(182.8)).toEqual({ feet: 6, inches: 0 });
  });

  it('converts feet and inches to cm, to one decimal', () => {
    expect(ftInToCm(6, 0)).toBe(182.9);
    expect(ftInToCm(5, 10)).toBe(177.8);
  });

  it('is stable on a round trip to within rounding', () => {
    for (const cm of [150, 160.5, 178, 185.4, 200]) {
      const { feet, inches } = cmToFtIn(cm);
      expect(Math.abs(ftInToCm(feet, inches) - cm)).toBeLessThan(0.3);
    }
  });

  it('guards non-finite and non-positive input', () => {
    expect(cmToFtIn(NaN)).toEqual({ feet: 0, inches: 0 });
    expect(cmToFtIn(-5)).toEqual({ feet: 0, inches: 0 });
    expect(ftInToCm(NaN, NaN)).toBe(0);
  });

  it('validates against the same bounds as the nutrition wizard', () => {
    expect(validateHeightCm(HEIGHT_BOUNDS_CM.min)).toBeNull();
    expect(validateHeightCm(HEIGHT_BOUNDS_CM.max)).toBeNull();
    expect(validateHeightCm(99)).not.toBeNull();
    expect(validateHeightCm(231)).not.toBeNull();
    expect(validateHeightCm(NaN)).not.toBeNull();
  });

  it('formats in the chosen unit and defaults to cm', () => {
    expect(formatHeight(178, 'cm')).toBe('178 cm');
    expect(formatHeight(178, undefined)).toBe('178 cm');
    expect(formatHeight(177.8, 'ft_in')).toBe(`5'10"`);
    expect(formatHeight(0, 'cm')).toBe('—');
    expect(resolveHeightUnit('bogus' as never)).toBe('cm');
  });
});
