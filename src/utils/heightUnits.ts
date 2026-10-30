import type { HeightUnit } from '../types';

const CM_PER_INCH = 2.54;

/** Same limits the Nutrition Goal Wizard enforces (tdeeEngine INPUT_BOUNDS.heightCm). */
export const HEIGHT_BOUNDS_CM = { min: 100, max: 230 } as const;

export const resolveHeightUnit = (u: HeightUnit | undefined): HeightUnit => (u === 'ft_in' ? 'ft_in' : 'cm');

/** Converts to whole feet + inches (inches rounded to the nearest 0.1 and carried into feet at 12). */
export function cmToFtIn(cm: number): { feet: number; inches: number } {
  if (!Number.isFinite(cm) || cm <= 0) return { feet: 0, inches: 0 };
  const totalInches = Math.round((cm / CM_PER_INCH) * 10) / 10;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 10) / 10;
  if (inches >= 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export function ftInToCm(feet: number, inches: number): number {
  const f = Number.isFinite(feet) ? feet : 0;
  const i = Number.isFinite(inches) ? inches : 0;
  return Math.round((f * 12 + i) * CM_PER_INCH * 10) / 10;
}

export function validateHeightCm(cm: number): string | null {
  if (!Number.isFinite(cm) || cm < HEIGHT_BOUNDS_CM.min || cm > HEIGHT_BOUNDS_CM.max) {
    return `Enter a height between ${HEIGHT_BOUNDS_CM.min} and ${HEIGHT_BOUNDS_CM.max} cm (about 3'4" to 7'7").`;
  }
  return null;
}

export function formatHeight(cm: number, unit: HeightUnit | undefined): string {
  if (!Number.isFinite(cm) || cm <= 0) return '—';
  if (resolveHeightUnit(unit) === 'ft_in') {
    const { feet, inches } = cmToFtIn(cm);
    return `${feet}'${Number.isInteger(inches) ? inches : inches.toFixed(1)}"`;
  }
  return `${Math.round(cm * 10) / 10} cm`;
}
