import { describe, it, expect } from 'vitest';
import {
  calculateMacroBreakdown
} from '../utils/calculations';
import {
  sanitizeBarcode,
  parseNutrientValue,
  normalizeOpenFoodFactsProduct,
  calculatePortionNutrients
} from '../services/openFoodFactsService';
import { ScannedFoodProduct } from '../types';

describe('Nutrition & Macro Calculation Logic', () => {
  describe('Macro Breakdown & Caloric Math', () => {
    it('calculates calories from protein, carbs, and fat correctly (4-4-9 rule)', () => {
      // 150g protein (600 kcal), 200g carbs (800 kcal), 50g fat (450 kcal) -> Total = 1850 kcal
      const breakdown = calculateMacroBreakdown(150, 200, 50);
      expect(breakdown.proteinCalories).toBe(600);
      expect(breakdown.carbsCalories).toBe(800);
      expect(breakdown.fatCalories).toBe(450);
      expect(breakdown.totalCalculatedCalories).toBe(1850);
    });

    it('calculates exact percentage distributions', () => {
      // 100g protein (400 kcal = 40%), 100g carbs (400 kcal = 40%), 22.2g fat (~200 kcal = 20%) -> Total = 1000 kcal
      const breakdown = calculateMacroBreakdown(100, 100, 22.22);
      expect(breakdown.totalCalculatedCalories).toBe(1000);
      expect(breakdown.proteinPercentage).toBe(40);
      expect(breakdown.carbsPercentage).toBe(40);
      expect(breakdown.fatPercentage).toBe(20);
    });

    it('handles zero or negative inputs cleanly', () => {
      const breakdown = calculateMacroBreakdown(0, 0, 0);
      expect(breakdown.totalCalculatedCalories).toBe(0);
      expect(breakdown.proteinPercentage).toBe(0);
      expect(breakdown.carbsPercentage).toBe(0);
      expect(breakdown.fatPercentage).toBe(0);
    });
  });

  describe('Barcode Sanitization', () => {
    it('strips non-alphanumeric characters, hyphens, and whitespace', () => {
      expect(sanitizeBarcode('  0888-4900 0010 \n')).toBe('088849000010');
      expect(sanitizeBarcode('400-8400-4010-2')).toBe('400840040102');
      expect(sanitizeBarcode('')).toBe('');
    });
  });

  describe('Nutrient Value Parsing', () => {
    it('distinguishes explicit zero from unlisted/missing values', () => {
      expect(parseNutrientValue(0)).toBe(0);
      expect(parseNutrientValue('0')).toBe(0);
      expect(parseNutrientValue(undefined)).toBeNull();
      expect(parseNutrientValue(null)).toBeNull();
      expect(parseNutrientValue('')).toBeNull();
      expect(parseNutrientValue('not-a-number')).toBeNull();
    });

    it('rounds positive floats to 1 decimal place', () => {
      expect(parseNutrientValue(12.345)).toBe(12.3);
      expect(parseNutrientValue('33.89')).toBe(33.9);
    });
  });

  describe('Open Food Facts Product Normalization', () => {
    it('accurately normalizes solid products and preserves 0 fat vs missing carbs', () => {
      const rawMock = {
        product_name: 'Core Power Elite',
        brands: 'Fairlife',
        serving_size: '1 bottle (414 ml)',
        serving_quantity: 414,
        serving_quantity_unit: 'ml',
        nutriments: {
          'energy-kcal_100g': 56,
          'proteins_100g': 10.1,
          'fat_100g': 0.8,
          'fiber_100g': 0,
          // carbohydrates intentionally omitted
          'energy-kcal_serving': 230,
          'proteins_serving': 42.0,
          'fat_serving': 3.5,
          'carbohydrates_serving': 8.0,
          'fiber_serving': 0
        }
      };

      const normalized = normalizeOpenFoodFactsProduct(rawMock, '0041271030013');
      expect(normalized.name).toBe('Core Power Elite');
      expect(normalized.brand).toBe('Fairlife');
      expect(normalized.isLiquid).toBe(true);
      expect(normalized.per100g.protein).toBe(10.1);
      expect(normalized.per100g.carbs).toBeNull(); // Missing must stay null, NOT false 0
      expect(normalized.per100g.fiber).toBe(0); // Explicit zero must stay 0
      expect(normalized.perServing.protein).toBe(42.0);
    });

    it('converts energy in kJ to kcal when energy-kcal is missing', () => {
      const rawKjMock = {
        product_name: 'Imported Greek Yogurt',
        nutriments: {
          energy_100g: 418.4, // ~100 kcal (418.4 * 0.239006 = 100)
          proteins_100g: 10
        }
      };

      const normalized = normalizeOpenFoodFactsProduct(rawKjMock, '5201000100010');
      expect(normalized.per100g.calories).toBe(100);
      expect(normalized.per100g.protein).toBe(10);
    });
  });

  describe('Portion Calculations & Scaling', () => {
    const testProduct: ScannedFoodProduct = {
      barcode: '1234567890123',
      name: 'High Protein Oats',
      brand: 'Rolled Essentials',
      hasServingData: true,
      servingSizeText: '1 pouch (50g)',
      servingQuantity: 50,
      servingUnit: 'g',
      perServing: {
        calories: 190,
        protein: 10,
        carbs: 32,
        fat: 3,
        fiber: 5
      },
      per100g: {
        calories: 380,
        protein: 20,
        carbs: 64,
        fat: 6,
        fiber: 10
      },
      isLiquid: false,
      categories: ['cereals']
    };

    it('calculates 1 serving accurately', () => {
      const p1 = calculatePortionNutrients(testProduct, 'serving', 1);
      expect(p1.calories).toBe(190);
      expect(p1.protein).toBe(10);
      expect(p1.carbs).toBe(32);
      expect(p1.fat).toBe(3);
    });

    it('calculates multi-serving portions accurately', () => {
      const p2 = calculatePortionNutrients(testProduct, 'serving', 2.5);
      expect(p2.calories).toBe(Math.round(190 * 2.5)); // 475
      expect(p2.protein).toBe(25);
      expect(p2.carbs).toBe(80);
      expect(p2.fat).toBe(7.5);
    });

    it('calculates custom gram weights using per100g base', () => {
      // 75g portion -> 0.75 ratio of 100g
      const p75g = calculatePortionNutrients(testProduct, 'custom_grams', 1, 75);
      expect(p75g.calories).toBe(Math.round(380 * 0.75)); // 285
      expect(p75g.protein).toBe(15);
      expect(p75g.carbs).toBe(48);
      expect(p75g.fat).toBe(4.5);
    });
  });
});
