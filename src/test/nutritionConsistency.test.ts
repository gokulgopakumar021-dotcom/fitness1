import { describe, it, expect } from 'vitest';
import {
  calculateMacroVariance,
  calculateNutritionConsistency
} from '../utils/nutritionConsistencyEngine';
import { DailyNutritionLog, UserProfile } from '../types';
import { DateRange } from '../utils/timelineEngine';

describe('nutritionConsistencyEngine', () => {
  describe('calculateMacroVariance', () => {
    it('accurately identifies values exactly on target', () => {
      const result = calculateMacroVariance(2000, 2000);
      expect(result.actual).toBe(2000);
      expect(result.target).toBe(2000);
      expect(result.delta).toBe(0);
      expect(result.percentDelta).toBe(0);
      expect(result.isWithinTenPercent).toBe(true);
      expect(result.status).toBe('within');
      expect(result.lowerBound).toBe(1800);
      expect(result.upperBound).toBe(2200);
    });

    it('identifies lower boundary (0.90 * target) as within 10%', () => {
      const result = calculateMacroVariance(1800, 2000);
      expect(result.isWithinTenPercent).toBe(true);
      expect(result.status).toBe('within');
      expect(result.percentDelta).toBe(-10);
    });

    it('identifies upper boundary (1.10 * target) as within 10%', () => {
      const result = calculateMacroVariance(2200, 2000);
      expect(result.isWithinTenPercent).toBe(true);
      expect(result.status).toBe('within');
      expect(result.percentDelta).toBe(10);
    });

    it('identifies under target beyond -10%', () => {
      const result = calculateMacroVariance(1750, 2000);
      expect(result.isWithinTenPercent).toBe(false);
      expect(result.status).toBe('under');
      expect(result.percentDelta).toBe(-12.5);
    });

    it('identifies over target beyond +10%', () => {
      const result = calculateMacroVariance(2300, 2000);
      expect(result.isWithinTenPercent).toBe(false);
      expect(result.status).toBe('over');
      expect(result.percentDelta).toBe(15);
    });

    it('handles zero target safely without NaN or division by zero', () => {
      const result = calculateMacroVariance(500, 0);
      expect(result.isWithinTenPercent).toBe(false);
      expect(result.percentDelta).toBe(0);
      expect(result.target).toBe(0);
    });
  });

  describe('calculateNutritionConsistency', () => {
    const mockProfile: UserProfile = {
      name: 'Test Athlete',
      age: 28,
      sex: 'male',
      heightCm: 180,
      currentWeightKg: 80,
      goalWeightKg: 78,
      primaryGoal: 'fat_loss',
      trainingExperience: 'intermediate',
      trainingDaysPerWeek: 4,
      preferredUnit: 'kg',
      dailyCalorieTarget: 2200,
      dailyProteinTarget: 175,
      dailyCarbsTarget: 220,
      dailyFatTarget: 65,
      trainingSplitName: 'Upper / Lower',
      trainingPhase: 'adaptation',
      defaultTargetRir: 2,
      minBarbellIncrement: 2.5,
      minDumbbellIncrement: 2.0,
      minMachineIncrement: 2.5,
      excludeWarmupFromVolume: true,
      onboardingCompleted: true
    };

    const range: DateRange = {
      startDate: '2026-03-01',
      endDate: '2026-03-07'
    };

    it('handles completely empty logs gracefully', () => {
      const result = calculateNutritionConsistency([], mockProfile, range);

      expect(result.coverage.totalDaysInRange).toBe(7);
      expect(result.coverage.loggedDaysCount).toBe(0);
      expect(result.coverage.coveragePercent).toBe(0);
      expect(result.adherence.caloriesConsistentDays).toBe(0);
      expect(result.adherence.caloriesConsistencyRate).toBe(0);
      expect(result.adherence.overallConsistencyRate).toBe(0);
      expect(result.dailyRecords.length).toBe(7);
      expect(result.dailyRecords[0].isLogged).toBe(false);
    });

    it('computes 100% adherence when all logged days are within +-10%', () => {
      const logs: DailyNutritionLog[] = [
        {
          id: 'log-1',
          date: '2026-03-01',
          targetCalories: 2200,
          targetProtein: 175,
          targetCarbs: 220,
          targetFat: 65,
          waterMl: 2500,
          entries: [
            {
              id: 'e1',
              name: 'Chicken and Rice',
              mealCategory: 'lunch',
              quantity: 1,
              servingUnit: 'portion',
              calories: 2200, // exact
              protein: 175,   // exact
              carbs: 220,     // exact
              fat: 65         // exact
            }
          ]
        },
        {
          id: 'log-2',
          date: '2026-03-02',
          targetCalories: 2200,
          targetProtein: 175,
          targetCarbs: 220,
          targetFat: 65,
          waterMl: 2200,
          entries: [
            {
              id: 'e2',
              name: 'Salmon Bowl',
              mealCategory: 'dinner',
              quantity: 1,
              servingUnit: 'portion',
              calories: 2150, // -2.3% (within 10%)
              protein: 170,   // -2.9% (within 10%)
              carbs: 215,     // -2.3% (within 10%)
              fat: 68         // +4.6% (within 10%)
            }
          ]
        }
      ];

      const result = calculateNutritionConsistency(logs, mockProfile, range);

      expect(result.coverage.loggedDaysCount).toBe(2);
      expect(result.coverage.totalDaysInRange).toBe(7);
      expect(result.adherence.caloriesConsistentDays).toBe(2);
      expect(result.adherence.caloriesConsistencyRate).toBe(100);
      expect(result.adherence.proteinConsistencyRate).toBe(100);
      expect(result.adherence.carbsConsistencyRate).toBe(100);
      expect(result.adherence.fatConsistencyRate).toBe(100);
      expect(result.adherence.fullConsistencyRate).toBe(100);
      expect(result.adherence.coreConsistencyRate).toBe(100);
      expect(result.adherence.overallConsistencyRate).toBe(100);
      expect(result.adherence.currentStreakDays).toBe(2);
      expect(result.adherence.longestStreakDays).toBe(2);
    });

    it('correctly calculates adherence when some metrics exceed +-10%', () => {
      const logs: DailyNutritionLog[] = [
        {
          id: 'log-1',
          date: '2026-03-01',
          targetCalories: 2200,
          targetProtein: 175,
          targetCarbs: 220,
          targetFat: 65,
          waterMl: 2500,
          entries: [
            {
              id: 'e1',
              name: 'Day 1 compliant',
              mealCategory: 'lunch',
              quantity: 1,
              servingUnit: 'portion',
              calories: 2200,
              protein: 175,
              carbs: 220,
              fat: 65
            }
          ]
        },
        {
          id: 'log-2',
          date: '2026-03-02',
          targetCalories: 2200,
          targetProtein: 175,
          targetCarbs: 220,
          targetFat: 65,
          waterMl: 2000,
          entries: [
            {
              id: 'e2',
              name: 'Cheat meal day - high cal and fat',
              mealCategory: 'dinner',
              quantity: 1,
              servingUnit: 'portion',
              calories: 3000, // +36.4% (Over)
              protein: 175,   // within
              carbs: 220,     // within
              fat: 120        // +84.6% (Over)
            }
          ]
        }
      ];

      const result = calculateNutritionConsistency(logs, mockProfile, range);

      expect(result.coverage.loggedDaysCount).toBe(2);
      // Day 1 met calories, Day 2 missed calories -> 1 / 2 = 50%
      expect(result.adherence.caloriesConsistentDays).toBe(1);
      expect(result.adherence.caloriesConsistencyRate).toBe(50);

      // Both days met protein -> 2 / 2 = 100%
      expect(result.adherence.proteinConsistentDays).toBe(2);
      expect(result.adherence.proteinConsistencyRate).toBe(100);

      // Both days met carbs -> 2 / 2 = 100%
      expect(result.adherence.carbsConsistentDays).toBe(2);
      expect(result.adherence.carbsConsistencyRate).toBe(100);

      // Only Day 1 met fat -> 1 / 2 = 50%
      expect(result.adherence.fatConsistentDays).toBe(1);
      expect(result.adherence.fatConsistencyRate).toBe(50);

      // Full consistency (all 4): Day 1 yes, Day 2 no -> 50%
      expect(result.adherence.fullyConsistentDays).toBe(1);
      expect(result.adherence.fullConsistencyRate).toBe(50);
    });

    it('falls back to UserProfile targets when DailyNutritionLog targets are zero', () => {
      const logs: DailyNutritionLog[] = [
        {
          id: 'log-1',
          date: '2026-03-01',
          targetCalories: 0, // Fallback to profile (2200)
          targetProtein: 0,  // Fallback to profile (175)
          targetCarbs: 0,
          targetFat: 0,
          waterMl: 2000,
          entries: [
            {
              id: 'e1',
              name: 'Lunch',
              mealCategory: 'lunch',
              quantity: 1,
              servingUnit: 'portion',
              calories: 2250, // within 10% of 2200
              protein: 170,   // within 10% of 175
              carbs: 215,
              fat: 60
            }
          ]
        }
      ];

      const result = calculateNutritionConsistency(logs, mockProfile, range);
      const dayRecord = result.dailyRecords.find((r) => r.date === '2026-03-01');

      expect(dayRecord).toBeDefined();
      expect(dayRecord?.calories.target).toBe(2200);
      expect(dayRecord?.calories.isWithinTenPercent).toBe(true);
      expect(dayRecord?.protein.target).toBe(175);
      expect(dayRecord?.protein.isWithinTenPercent).toBe(true);
    });
  });
});
