import {
  UserProfile,
  LoggedSet,
  WorkoutSession
} from '../types';
import { calculateBMI, calculateEpley1RM, calculateVolumeLoad } from './calculations';
import { extractExerciseHistory, generateProgressionRecommendation } from './progressionEngine';
import {
  sanitizeBarcode,
  parseNutrientValue,
  normalizeOpenFoodFactsProduct,
  calculatePortionNutrients
} from '../services/openFoodFactsService';

export interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

export function runAllAutomatedTests(): TestResult[] {
  const results: TestResult[] = [];

  const mockProfile: UserProfile = {
    name: 'Test Athlete',
    age: 28,
    sex: 'male',
    heightCm: 180,
    currentWeightKg: 80,
    goalWeightKg: 82,
    primaryGoal: 'muscle_gain',
    trainingExperience: 'intermediate',
    trainingDaysPerWeek: 4,
    preferredUnit: 'kg',
    dailyCalorieTarget: 2800,
    dailyProteinTarget: 170,
    dailyCarbsTarget: 330,
    dailyFatTarget: 70,
    trainingSplitName: 'Push Pull Legs',
    trainingPhase: 'hypertrophy',
    defaultTargetRir: 2,
    minBarbellIncrement: 2.5,
    minDumbbellIncrement: 2.0,
    minMachineIncrement: 2.5,
    excludeWarmupFromVolume: true,
    onboardingCompleted: true
  };

  // 1. Test BMI Formula: 80kg at 180cm -> 80 / (1.8 * 1.8) = 24.69
  const actualBMI = calculateBMI(80, 180);
  results.push({
    name: 'BMI Calculation (80kg @ 180cm)',
    passed: actualBMI === 24.69,
    expected: '24.69',
    actual: String(actualBMI),
    details: 'Calculated using weightKg / (heightM ^ 2)'
  });

  // 2. Test Epley 1RM Formula: 100kg x 10 reps -> 100 * (1 + 10/30) = 133.3
  const actual1RM = calculateEpley1RM(100, 10);
  results.push({
    name: 'Epley Estimated 1RM (100kg × 10 reps)',
    passed: actual1RM === 133.3,
    expected: '133.3 kg',
    actual: `${actual1RM} kg`,
    details: 'Calculated using weight * (1 + reps / 30)'
  });

  // 3. Test Working Set Volume Load (excluding warmup)
  const mockSets: LoggedSet[] = [
    { id: '1', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
    { id: '2', setNumber: 2, type: 'working', weight: 80, reps: 8, completed: true, timestamp: '' }, // 640
    { id: '3', setNumber: 3, type: 'working', weight: 80, reps: 8, completed: true, timestamp: '' }, // 640
    { id: '4', setNumber: 4, type: 'working', weight: 80, reps: 7, completed: true, timestamp: '' }, // 560
  ];
  const actualVolume = calculateVolumeLoad(mockSets, true);
  const expectedVolume = 640 + 640 + 560; // 1840
  results.push({
    name: 'Volume Load Calculation (Working Sets Only)',
    passed: actualVolume === expectedVolume,
    expected: `${expectedVolume} kg`,
    actual: `${actualVolume} kg`,
    details: 'Excludes 400kg warmup set, summing only working sets'
  });

  // 4. Test Double Progression Rule A: All sets hit top of rep range (3x12 in 8-12)
  const sessionRuleA: WorkoutSession = {
    id: 's-1',
    dayName: 'Push Day',
    date: '2026-10-01',
    startTime: new Date().toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'e-1',
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        equipment: 'barbell',
        repRange: '8-12',
        targetRir: 2,
        restSeconds: 120,
        sets: [
          { id: '1', setNumber: 1, type: 'working', weight: 60, reps: 12, rir: 2, completed: true, timestamp: '' },
          { id: '2', setNumber: 2, type: 'working', weight: 60, reps: 12, rir: 2, completed: true, timestamp: '' },
          { id: '3', setNumber: 3, type: 'working', weight: 60, reps: 12, rir: 2, completed: true, timestamp: '' }
        ]
      }
    ]
  };
  const historyA = extractExerciseHistory([sessionRuleA], 'Barbell Bench Press');
  const recA = generateProgressionRecommendation(historyA, mockProfile, 'Barbell Bench Press', 'barbell', '8-12', 2);
  results.push({
    name: 'Rule A: Top of Rep Range Satisfied -> Load Increase',
    passed: recA.ruleApplied === 'A_TOP_REPS_ACHIEVED' && recA.recommendedWeight === 62.5,
    expected: 'Rule A (+2.5 kg to 62.5 kg)',
    actual: `${recA.ruleApplied} (${recA.recommendedWeight} kg)`,
    details: 'Double progression increments load when all sets hit 12 reps at target RIR'
  });

  // 5. Test Double Progression Rule B: Reps improved but top not achieved (10, 9, 8 in 8-12)
  const sessionRuleB: WorkoutSession = {
    id: 's-2',
    dayName: 'Push Day',
    date: '2026-10-05',
    startTime: new Date().toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'e-2',
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Chest',
        equipment: 'dumbbell',
        repRange: '8-12',
        targetRir: 2,
        restSeconds: 90,
        sets: [
          { id: '1', setNumber: 1, type: 'working', weight: 24, reps: 10, rir: 2, completed: true, timestamp: '' },
          { id: '2', setNumber: 2, type: 'working', weight: 24, reps: 9, rir: 2, completed: true, timestamp: '' },
          { id: '3', setNumber: 3, type: 'working', weight: 24, reps: 8, rir: 2, completed: true, timestamp: '' }
        ]
      }
    ]
  };
  const historyB = extractExerciseHistory([sessionRuleB], 'Incline Dumbbell Press');
  const recB = generateProgressionRecommendation(historyB, mockProfile, 'Incline Dumbbell Press', 'dumbbell', '8-12', 2);
  results.push({
    name: 'Rule B: Sub-maximal Reps -> Maintain Weight & Accumulate Reps',
    passed: recB.ruleApplied === 'B_REPS_IMPROVED' && recB.recommendedWeight === 24,
    expected: 'Rule B (Hold 24 kg)',
    actual: `${recB.ruleApplied} (${recB.recommendedWeight} kg)`,
    details: 'Weights held steady until all sets achieve 12 reps'
  });

  // 6. Test Double Progression Rule C: Reps declined from previous session at same weight
  const sessionRuleC_prev: WorkoutSession = {
    id: 's-3a',
    dayName: 'Push Day',
    date: '2026-10-01',
    startTime: new Date().toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'e-3a',
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        equipment: 'barbell',
        repRange: '8-10',
        targetRir: 2,
        restSeconds: 120,
        sets: [
          { id: '1', setNumber: 1, type: 'working', weight: 45, reps: 10, completed: true, timestamp: '' },
          { id: '2', setNumber: 2, type: 'working', weight: 45, reps: 9, completed: true, timestamp: '' },
          { id: '3', setNumber: 3, type: 'working', weight: 45, reps: 8, completed: true, timestamp: '' }
        ]
      }
    ]
  };
  const sessionRuleC_curr: WorkoutSession = {
    id: 's-3b',
    dayName: 'Push Day',
    date: '2026-10-08',
    startTime: new Date().toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'e-3b',
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        equipment: 'barbell',
        repRange: '8-10',
        targetRir: 2,
        restSeconds: 120,
        sets: [
          { id: '1', setNumber: 1, type: 'working', weight: 45, reps: 8, completed: true, timestamp: '' },
          { id: '2', setNumber: 2, type: 'working', weight: 45, reps: 7, completed: true, timestamp: '' },
          { id: '3', setNumber: 3, type: 'working', weight: 45, reps: 6, completed: true, timestamp: '' }
        ]
      }
    ]
  };
  const historyC = extractExerciseHistory([sessionRuleC_prev, sessionRuleC_curr], 'Overhead Press');
  const recC = generateProgressionRecommendation(historyC, mockProfile, 'Overhead Press', 'barbell', '8-10', 2);
  results.push({
    name: 'Rule C: Acute Rep Drop -> Repeat Load & Review Rest',
    passed: recC.ruleApplied === 'C_REPS_DECLINED' && recC.recommendedWeight === 45,
    expected: 'Rule C (Repeat 45 kg)',
    actual: `${recC.ruleApplied} (${recC.recommendedWeight} kg)`,
    details: 'Reps dropped from 27 total to 21 total at 45kg; repeats weight and advises technique/rest review'
  });

  // 7. Test Plan-Based Overload Configuration: Top-Set Progression + Custom Increment (+5.0 kg)
  const sessionPlanConfig: WorkoutSession = {
    id: 's-4',
    dayName: 'Leg Day',
    date: '2026-10-10',
    startTime: new Date().toISOString(),
    status: 'completed',
    exercises: [
      {
        id: 'e-4',
        name: 'Barbell Back Squat',
        muscleGroup: 'Quads',
        equipment: 'barbell',
        repRange: '6-10',
        targetRir: 2,
        restSeconds: 150,
        sets: [
          { id: '1', setNumber: 1, type: 'working', weight: 100, reps: 10, rir: 2, completed: true, timestamp: '' }, // Hit top of range (10)
          { id: '2', setNumber: 2, type: 'working', weight: 100, reps: 8, rir: 2, completed: true, timestamp: '' },
          { id: '3', setNumber: 3, type: 'working', weight: 100, reps: 7, rir: 1, completed: true, timestamp: '' }
        ]
      }
    ]
  };
  const historyPlan = extractExerciseHistory([sessionPlanConfig], 'Barbell Back Squat');
  const recPlan = generateProgressionRecommendation(
    historyPlan,
    mockProfile,
    'Barbell Back Squat',
    'barbell',
    '6-10',
    2,
    {
      planId: 'custom-uploaded-plan-1',
      planName: 'Strength & Hypertrophy Plan',
      prescribedRepRange: '6-10',
      progressionStrategy: 'top_set_only',
      customIncrement: 5.0
    }
  );
  results.push({
    name: 'Plan-Based Overload: Top-Set Strategy with Custom +5kg Increment',
    passed: recPlan.recommendedWeight === 105 && recPlan.ruleApplied === 'A_TOP_REPS_ACHIEVED',
    expected: 'Rule A (+5 kg to 105 kg)',
    actual: `${recPlan.ruleApplied} (${recPlan.recommendedWeight} kg)`,
    details: 'Satisfies uploaded plan rule: lead set reached 10 reps, applying custom +5kg jump'
  });

  // 8. Test Barcode Sanitization & Validation
  const dirtyBarcode = '  8888-4900 0010 \n';
  const cleanBarcode = sanitizeBarcode(dirtyBarcode);
  results.push({
    name: 'Barcode Sanitization: Strips whitespace and hyphens',
    passed: cleanBarcode === '888849000010',
    expected: '888849000010',
    actual: cleanBarcode,
    details: 'Sanitizes dirty input e.g. "  8888-4900 0010 \\n" into clean numeric EAN/UPC'
  });

  // 9. Test Open Food Facts Normalization: Distinguish Genuine Zero vs Missing Nutrients
  const mockRawOFF = {
    product_name: 'Pure Zero Protein Shake',
    brands: 'IronFuel',
    serving_size: '1 bottle (330 ml)',
    serving_quantity: 330,
    serving_quantity_unit: 'ml',
    nutriments: {
      'energy-kcal_100g': 45,
      'proteins_100g': 9.0,
      'fat_100g': 0, // Genuine zero fat
      // carbohydrates_100g is intentionally missing (undefined)
      'energy-kcal_serving': 148,
      'proteins_serving': 30.0,
      'fat_serving': 0
    }
  };
  const normalized = normalizeOpenFoodFactsProduct(mockRawOFF, '1234567890123');
  const zeroFatPreserved = normalized.per100g.fat === 0;
  const missingCarbsPreserved = normalized.per100g.carbs === null;
  const liquidDetected = normalized.isLiquid === true && normalized.servingUnit === 'ml';

  results.push({
    name: 'Nutrition Normalization: Missing Nutrients vs Genuine Zero (No False Zeros)',
    passed: zeroFatPreserved && missingCarbsPreserved && liquidDetected,
    expected: 'fat=0, carbs=null, isLiquid=true',
    actual: `fat=${normalized.per100g.fat}, carbs=${normalized.per100g.carbs}, isLiquid=${normalized.isLiquid}`,
    details: 'Protects accuracy: 0g fat stays 0g; unlisted carbs stay null instead of falsely showing 0g'
  });

  // 10. Test Portion Calculation: Per-Serving vs Custom Gram Scaling
  const mockSolidProduct = {
    barcode: '0888849000010',
    name: 'Protein Bar',
    brand: 'Quest',
    servingSizeText: '1 bar (60g)',
    servingQuantity: 60,
    servingUnit: 'g',
    hasServingData: true,
    perServing: { calories: 200, protein: 21, carbs: 22, fat: 7, fiber: 14 },
    per100g: { calories: 333, protein: 35, carbs: 36.7, fat: 11.7, fiber: 23.3 }
  };
  const portion2Bars = calculatePortionNutrients(mockSolidProduct, 'serving', 2);
  const portion150g = calculatePortionNutrients(mockSolidProduct, 'custom_grams', 1, 150);

  const calc2BarsPass = portion2Bars.calories === 400 && portion2Bars.protein === 42;
  const calc150gPass = portion150g.calories === 500 && portion150g.protein === 52.5;

  results.push({
    name: 'Portion Calculations: Accurate Scaling on Servings and Gram Multipliers',
    passed: calc2BarsPass && calc150gPass,
    expected: '2 bars = 400kcal/42g pro; 150g = 500kcal/52.5g pro',
    actual: `2 bars = ${portion2Bars.calories}kcal/${portion2Bars.protein}g pro; 150g = ${portion150g.calories}kcal/${portion150g.protein}g pro`,
    details: 'Verifies exact scaling on discrete servings and continuous gram measurements'
  });

  return results;
}
