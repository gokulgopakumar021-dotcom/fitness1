import { describe, it, expect } from 'vitest';
import {
  calculateBMI,
  getBMICategory,
  calculateWeeklyAverageWeight,
  kgToLbs,
  lbsToKg,
  formatWeight,
  calculateBodyComposition
} from '../utils/calculations';

describe('Body Scan & Composition Calculation Logic', () => {
  describe('BMI Calculation & Demographic Guidelines', () => {
    it('calculates BMI accurately given weight (kg) and height (cm)', () => {
      // 80kg at 180cm -> 80 / (1.8 * 1.8) = 24.6913... -> 24.69
      expect(calculateBMI(80, 180)).toBe(24.69);
      // 95kg at 175cm -> 95 / (1.75 * 1.75) = 31.02
      expect(calculateBMI(95, 175)).toBe(31.02);
    });

    it('returns 0 for non-positive height or weight', () => {
      expect(calculateBMI(0, 180)).toBe(0);
      expect(calculateBMI(80, 0)).toBe(0);
      expect(calculateBMI(-70, 170)).toBe(0);
    });

    it('assigns correct BMI category and athlete disclaimer', () => {
      const normal = getBMICategory(23.5);
      expect(normal.category).toBe('Normal range');

      const overweight = getBMICategory(27.8);
      expect(overweight.category).toBe('Overweight');
      expect(overweight.disclaimer).toContain('strength athletes with high muscle mass');

      const obesity = getBMICategory(32.0);
      expect(obesity.category).toBe('Obesity classification');
      expect(obesity.disclaimer).toContain('visceral adiposity from muscular skeletal mass');

      const underweight = getBMICategory(17.5);
      expect(underweight.category).toBe('Underweight');
    });
  });

  describe('Weight Trend & 7-Day Rolling Average', () => {
    const mockEntries = [
      { date: '2026-10-01', weightKg: 82.0 },
      { date: '2026-10-02', weightKg: 82.5 },
      { date: '2026-10-03', weightKg: 81.8 },
      { date: '2026-10-04', weightKg: 83.0 }, // transient glycogen/water spike
      { date: '2026-10-05', weightKg: 82.2 },
      { date: '2026-10-06', weightKg: 82.0 },
      { date: '2026-10-07', weightKg: 81.9 }
    ];

    it('smooths transient spikes using the 7-day rolling window', () => {
      const rollingAvg = calculateWeeklyAverageWeight(mockEntries, '2026-10-07');
      // Sum = 82 + 82.5 + 81.8 + 83.0 + 82.2 + 82.0 + 81.9 = 575.4
      // Avg = 575.4 / 7 = 82.20
      expect(rollingAvg).toBe(82.2);
    });

    it('returns null for empty entries', () => {
      expect(calculateWeeklyAverageWeight([])).toBeNull();
    });
  });

  describe('Unit Conversions', () => {
    it('converts kg to lbs accurately (1 kg = 2.20462 lbs)', () => {
      expect(kgToLbs(80)).toBe(176.4);
      expect(kgToLbs(100)).toBe(220.5);
    });

    it('converts lbs to kg accurately', () => {
      expect(lbsToKg(176.4)).toBe(80.0);
    });

    it('formats weight with chosen unit label', () => {
      expect(formatWeight(82.5, 'kg')).toBe('82.5 kg');
      expect(formatWeight(82.5, 'lbs')).toBe('181.9 lbs');
    });
  });

  describe('Body Composition & Silhouette Silhouette Ratios', () => {
    it('calculates lean mass and fat mass based on body fat percentage', () => {
      // 80kg at 15% body fat -> fat mass = 12.0 kg, lean mass = 68.0 kg
      const comp = calculateBodyComposition(80, 15, 180, 80);
      expect(comp.fatMassKg).toBe(12.0);
      expect(comp.leanMassKg).toBe(68.0);
    });

    it('calculates Waist-to-Height ratio and risk category', () => {
      // 80cm waist at 180cm height -> ratio = 0.44 (<0.5 = optimal)
      const optimal = calculateBodyComposition(80, 15, 180, 80);
      expect(optimal.waistToHeightRatio).toBe(0.44);
      expect(optimal.waistRiskCategory).toBe('optimal');

      // 95cm waist at 170cm height -> ratio = 0.56 (0.5 - 0.6 = moderate)
      const moderate = calculateBodyComposition(85, 22, 170, 95);
      expect(moderate.waistToHeightRatio).toBe(0.56);
      expect(moderate.waistRiskCategory).toBe('moderate');

      // 110cm waist at 170cm height -> ratio = 0.65 (>0.6 = elevated)
      const elevated = calculateBodyComposition(105, 30, 170, 110);
      expect(elevated.waistToHeightRatio).toBe(0.65);
      expect(elevated.waistRiskCategory).toBe('elevated');
    });
  });
});
