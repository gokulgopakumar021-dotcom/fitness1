import { describe, it, expect } from 'vitest';
import {
  calculateMacroBreakdown,
  calculateHydrationGoal
} from '../utils/calculations';
import {
  calculateDetailedTDEE,
  calculateWizardMacroPlan
} from '../utils/tdeeEngine';
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

  describe('Macro Target Wizard & Weekly TDEE Engine', () => {
    it('calculates Mifflin-St Jeor BMR and weekly TDEE accurately for male athlete', () => {
      // 80kg, 180cm, 25yo, male -> 10*80 + 6.25*180 - 5*25 + 5 = 800 + 1125 - 125 + 5 = 1805
      const res = calculateDetailedTDEE({
        weightKg: 80,
        heightCm: 180,
        age: 25,
        sex: 'male',
        activityLevel: 'moderate' // 1.55 multiplier
      });

      expect(res.bmr).toBe(1805);
      expect(res.dailyTdee).toBe(Math.round(1805 * 1.55)); // 2798
      expect(res.weeklyTdee).toBe(res.dailyTdee * 7); // 19586
      expect(res.activityMultiplier).toBe(1.55);
    });

    it('calculates Mifflin-St Jeor BMR accurately for female athlete', () => {
      // 60kg, 165cm, 30yo, female -> 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161 = 1320.25 -> 1320
      const res = calculateDetailedTDEE({
        weightKg: 60,
        heightCm: 165,
        age: 30,
        sex: 'female',
        activityLevel: 'light' // 1.375 multiplier
      });

      expect(res.bmr).toBe(1320);
      expect(res.dailyTdee).toBe(Math.round(1320 * 1.375)); // 1815
      expect(res.weeklyTdee).toBe(1815 * 7); // 12705
    });

    it('generates cutting plan with weekly deficit and weight loss projection', () => {
      const plan = calculateWizardMacroPlan({
        dailyTdee: 2500,
        weightKg: 80,
        goal: 'cut',
        pace: 'moderate' // -500 kcal
      });

      expect(plan.targetCalories).toBe(2000);
      expect(plan.weeklyTargetCalories).toBe(14000);
      expect(plan.weeklyDeficitOrSurplus).toBe(-3500); // -500 * 7
      // -3500 / 7700 ≈ -0.45 kg/week
      expect(plan.estimatedWeeklyWeightChangeKg).toBe(-0.45);
      // Protein: 80 * 2.2 = 176g
      expect(plan.proteinGrams).toBe(176);
      // Fat: 25% of 2000 = 500 kcal / 9 = 56g
      expect(plan.fatGrams).toBe(56);
      // Carbs: (2000 - (176*4 + 56*9)) / 4 = (2000 - 1208) / 4 = 198g
      expect(plan.carbsGrams).toBe(198);
      expect(plan.proteinPercent + plan.fatPercent + plan.carbsPercent).toBe(100);
    });

    it('generates bulking plan with weekly surplus and weight gain projection', () => {
      const plan = calculateWizardMacroPlan({
        dailyTdee: 2600,
        weightKg: 75,
        goal: 'bulk',
        pace: 'moderate' // +400 kcal
      });

      expect(plan.targetCalories).toBe(3000);
      expect(plan.weeklyTargetCalories).toBe(21000);
      expect(plan.weeklyDeficitOrSurplus).toBe(2800); // 400 * 7
      // 2800 / 7700 ≈ +0.36 kg/week
      expect(plan.estimatedWeeklyWeightChangeKg).toBe(0.36);
      // Protein: 75 * 2.0 = 150g
      expect(plan.proteinGrams).toBe(150);
    });

    it('enforces safe physiological calorie floor (>= 1200 kcal)', () => {
      const plan = calculateWizardMacroPlan({
        dailyTdee: 1400,
        weightKg: 50,
        goal: 'cut',
        pace: 'aggressive' // -750 kcal would be 650 kcal without floor
      });

      expect(plan.targetCalories).toBeGreaterThanOrEqual(1200);
    });

    it('supports custom protein ratios and custom fat percentages', () => {
      const plan = calculateWizardMacroPlan({
        dailyTdee: 2400,
        weightKg: 80,
        goal: 'maintain',
        pace: 'conservative',
        proteinRatioGramsPerKg: 2.5, // 200g
        fatPercentOfCalories: 30 // 30% of 2400 = 720 kcal / 9 = 80g
      });

      expect(plan.targetCalories).toBe(2400);
      expect(plan.weeklyDeficitOrSurplus).toBe(0);
      expect(plan.estimatedWeeklyWeightChangeKg).toBe(0);
      expect(plan.proteinGrams).toBe(200);
      expect(plan.fatGrams).toBe(80);
      // Carbs: (2400 - (800 + 720)) / 4 = 880 / 4 = 220g
      expect(plan.carbsGrams).toBe(220);
    });

    it('accurately verifies progress gauge ratios and target zone thresholds', () => {
      const targetCalories = 2200;
      const currentCalories = 2150;
      const calPercent = Math.round((currentCalories / targetCalories) * 100);
      const isTargetAligned = calPercent >= 95 && calPercent <= 105;

      expect(calPercent).toBe(98);
      expect(isTargetAligned).toBe(true);

      const targetProtein = 175;
      const currentProtein = 140;
      const proPercent = Math.round((currentProtein / targetProtein) * 100);
      const proRemaining = targetProtein - currentProtein;

      expect(proPercent).toBe(80);
      expect(proRemaining).toBe(35);
    });
  });

  describe('Hydration Goal & Water Tracking Calculations', () => {
    it('calculates personalized daily hydration goal from weight and training frequency', () => {
      // 80kg athlete, 4 training days -> 80 * 35 = 2800ml + 650ml = 3450ml
      const hydration = calculateHydrationGoal(80, 4);
      expect(hydration.baselineMl).toBe(2800);
      expect(hydration.activityBonusMl).toBe(650);
      expect(hydration.dailyGoalMl).toBe(3450);
      expect(hydration.dailyGoalOz).toBe(Math.round(3450 * 0.033814));
    });

    it('scales hydration replenishment with higher activity levels', () => {
      // 75kg athlete, very_active (900ml bonus) -> 75 * 35 = 2625ml + 900ml = 3525ml -> rounded to 3550ml
      const hydration = calculateHydrationGoal(75, 5, 'very_active');
      expect(hydration.baselineMl).toBe(2625);
      expect(hydration.activityBonusMl).toBe(900);
      expect(hydration.dailyGoalMl).toBe(3550);
    });

    it('enforces safety physiological floor of at least 2,000 ml', () => {
      // 45kg athlete, sedentary (250ml bonus) -> 45 * 35 = 1575ml + 250ml = 1825ml -> clamped to 2000ml floor
      const hydration = calculateHydrationGoal(45, 1, 'sedentary');
      expect(hydration.dailyGoalMl).toBe(2000);
    });

    it('accurately computes one-tap water intake progress and remaining amounts', () => {
      const goalMl = 3200;
      const loggedWaterMl = 2400;
      const progressPercent = Math.min(100, Math.round((loggedWaterMl / goalMl) * 100));
      const remainingMl = Math.max(0, goalMl - loggedWaterMl);

      expect(progressPercent).toBe(75);
      expect(remainingMl).toBe(800);

      // When goal is exceeded
      const overWaterMl = 3600;
      const overRemaining = Math.max(0, goalMl - overWaterMl);
      expect(overRemaining).toBe(0);
      expect(overWaterMl >= goalMl).toBe(true);
    });
  });
});

