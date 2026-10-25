import { describe, it, expect } from 'vitest';
import {
  calculateEpley1RM,
  calculateVolumeLoad,
  parseRepRange
} from '../utils/calculations';
import {
  extractExerciseHistory,
  generateProgressionRecommendation
} from '../utils/progressionEngine';
import { LoggedSet, UserProfile, WorkoutSession } from '../types';

describe('Workout & Progressive Overload Logic', () => {
  const baseProfile: UserProfile = {
    name: 'Athlete One',
    age: 26,
    sex: 'male',
    heightCm: 182,
    currentWeightKg: 82,
    goalWeightKg: 85,
    primaryGoal: 'muscle_gain',
    trainingExperience: 'intermediate',
    trainingDaysPerWeek: 4,
    preferredUnit: 'kg',
    dailyCalorieTarget: 2900,
    dailyProteinTarget: 175,
    dailyCarbsTarget: 340,
    dailyFatTarget: 75,
    trainingSplitName: 'Upper Lower',
    trainingPhase: 'hypertrophy',
    defaultTargetRir: 2,
    minBarbellIncrement: 2.5,
    minDumbbellIncrement: 2.0,
    minMachineIncrement: 2.5,
    excludeWarmupFromVolume: true,
    onboardingCompleted: true
  };

  describe('Epley 1RM Calculation', () => {
    it('calculates 1RM accurately for standard multi-rep sets', () => {
      // 100kg * (1 + 10/30) = 133.3 kg
      const result = calculateEpley1RM(100, 10);
      expect(result).toBe(133.3);
    });

    it('returns exact weight for a 1-rep true maximum', () => {
      const result = calculateEpley1RM(140, 1);
      expect(result).toBe(140);
    });

    it('handles zero or negative reps safely by returning 0', () => {
      expect(calculateEpley1RM(100, 0)).toBe(0);
      expect(calculateEpley1RM(0, 5)).toBe(0);
      expect(calculateEpley1RM(-50, 5)).toBe(0);
    });
  });

  describe('Volume Load Calculation', () => {
    const sets: LoggedSet[] = [
      { id: '1', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
      { id: '2', setNumber: 2, type: 'working', weight: 80, reps: 8, completed: true, timestamp: '' }, // 640
      { id: '3', setNumber: 3, type: 'working', weight: 80, reps: 8, completed: true, timestamp: '' }, // 640
      { id: '4', setNumber: 4, type: 'working', weight: 80, reps: 7, completed: true, timestamp: '' }, // 560
      { id: '5', setNumber: 5, type: 'working', weight: 80, reps: 6, completed: false, skipped: true, timestamp: '' } // skipped
    ];

    it('sums only completed working sets when excludeWarmup is true', () => {
      const vol = calculateVolumeLoad(sets, true);
      expect(vol).toBe(640 + 640 + 560); // 1840
    });

    it('includes warmup sets when excludeWarmup is false', () => {
      const vol = calculateVolumeLoad(sets, false);
      expect(vol).toBe(400 + 640 + 640 + 560); // 2240
    });

    it('ignores skipped or uncompleted sets', () => {
      const uncompletedOnly: LoggedSet[] = [
        { id: '1', setNumber: 1, type: 'working', weight: 100, reps: 5, completed: false, timestamp: '' }
      ];
      expect(calculateVolumeLoad(uncompletedOnly, true)).toBe(0);
    });
  });

  describe('Rep Range Parsing', () => {
    it('parses range strings like "8-12"', () => {
      expect(parseRepRange('8-12')).toEqual({ min: 8, max: 12 });
      expect(parseRepRange(' 6 - 10 ')).toEqual({ min: 6, max: 10 });
    });

    it('parses single number strings like "5"', () => {
      expect(parseRepRange('5')).toEqual({ min: 5, max: 5 });
    });

    it('provides sensible fallback for invalid strings', () => {
      expect(parseRepRange('')).toEqual({ min: 8, max: 12 });
      expect(parseRepRange('invalid')).toEqual({ min: 8, max: 12 });
    });
  });

  describe('Double Progression Overload Engine', () => {
    it('Rule A: increments load when all sets hit top of rep range at target RIR', () => {
      const sessionA: WorkoutSession = {
        id: 'sess-a',
        dayName: 'Upper Day',
        date: '2026-10-01',
        startTime: '2026-10-01T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'ex-1',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 's1', setNumber: 1, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' },
              { id: 's2', setNumber: 2, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' },
              { id: 's3', setNumber: 3, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' }
            ]
          }
        ]
      };

      const history = extractExerciseHistory([sessionA], 'Barbell Bench Press');
      const rec = generateProgressionRecommendation(history, baseProfile, 'Barbell Bench Press', 'barbell', '8-12', 2);

      expect(rec.ruleApplied).toBe('A_TOP_REPS_ACHIEVED');
      expect(rec.recommendedWeight).toBe(82.5); // 80 + 2.5 kg barbell increment
      expect(rec.recommendedRepTarget).toBe('8 reps'); // resets back to bottom of range
    });

    it('Rule B: keeps weight steady and recommends adding reps when top not achieved', () => {
      const sessionB: WorkoutSession = {
        id: 'sess-b',
        dayName: 'Upper Day',
        date: '2026-10-05',
        startTime: '2026-10-05T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'ex-2',
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            equipment: 'dumbbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 90,
            sets: [
              { id: 's1', setNumber: 1, type: 'working', weight: 26, reps: 11, rir: 2, completed: true, timestamp: '' },
              { id: 's2', setNumber: 2, type: 'working', weight: 26, reps: 10, rir: 2, completed: true, timestamp: '' },
              { id: 's3', setNumber: 3, type: 'working', weight: 26, reps: 8, rir: 1, completed: true, timestamp: '' }
            ]
          }
        ]
      };

      const history = extractExerciseHistory([sessionB], 'Incline Dumbbell Press');
      const rec = generateProgressionRecommendation(history, baseProfile, 'Incline Dumbbell Press', 'dumbbell', '8-12', 2);

      expect(rec.ruleApplied).toBe('B_REPS_IMPROVED');
      expect(rec.recommendedWeight).toBe(26); // Maintain load
      expect(rec.recommendedRepTarget).toBe('9 reps'); // Lowest was 8, targets +1
    });

    it('Rule C: advises repeating load when acute rep drop occurs at same weight', () => {
      const sessionPrev: WorkoutSession = {
        id: 'sess-c1',
        dayName: 'Shoulders',
        date: '2026-10-01',
        startTime: '2026-10-01T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'ex-3',
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            equipment: 'barbell',
            repRange: '8-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 's1', setNumber: 1, type: 'working', weight: 50, reps: 10, completed: true, timestamp: '' },
              { id: 's2', setNumber: 2, type: 'working', weight: 50, reps: 9, completed: true, timestamp: '' },
              { id: 's3', setNumber: 3, type: 'working', weight: 50, reps: 9, completed: true, timestamp: '' }
            ] // total = 28 reps
          }
        ]
      };

      const sessionCurr: WorkoutSession = {
        id: 'sess-c2',
        dayName: 'Shoulders',
        date: '2026-10-08',
        startTime: '2026-10-08T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'ex-3',
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            equipment: 'barbell',
            repRange: '8-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 's1', setNumber: 1, type: 'working', weight: 50, reps: 8, completed: true, timestamp: '' },
              { id: 's2', setNumber: 2, type: 'working', weight: 50, reps: 7, completed: true, timestamp: '' },
              { id: 's3', setNumber: 3, type: 'working', weight: 50, reps: 6, completed: true, timestamp: '' }
            ] // total = 21 reps (< 28 - 2)
          }
        ]
      };

      const history = extractExerciseHistory([sessionPrev, sessionCurr], 'Overhead Press');
      const rec = generateProgressionRecommendation(history, baseProfile, 'Overhead Press', 'barbell', '8-10', 2);

      expect(rec.ruleApplied).toBe('C_REPS_DECLINED');
      expect(rec.recommendedWeight).toBe(50);
    });

    it('supports plan-based custom overload strategies (top_set_only with custom +5kg jump)', () => {
      const sessionTopSet: WorkoutSession = {
        id: 'sess-plan',
        dayName: 'Leg Day',
        date: '2026-10-10',
        startTime: '2026-10-10T10:00:00Z',
        status: 'completed',
        exercises: [
          {
            id: 'ex-squat',
            name: 'Barbell Back Squat',
            muscleGroup: 'Quads',
            equipment: 'barbell',
            repRange: '6-10',
            targetRir: 2,
            restSeconds: 180,
            sets: [
              { id: 's1', setNumber: 1, type: 'working', weight: 120, reps: 10, rir: 2, completed: true, timestamp: '' }, // Hit top of range
              { id: 's2', setNumber: 2, type: 'working', weight: 120, reps: 8, rir: 2, completed: true, timestamp: '' },
              { id: 's3', setNumber: 3, type: 'working', weight: 120, reps: 7, rir: 1, completed: true, timestamp: '' }
            ]
          }
        ]
      };

      const history = extractExerciseHistory([sessionTopSet], 'Barbell Back Squat');
      const rec = generateProgressionRecommendation(
        history,
        baseProfile,
        'Barbell Back Squat',
        'barbell',
        '6-10',
        2,
        {
          planId: 'powerbuilding-v1',
          planName: 'Powerbuilding Block',
          prescribedRepRange: '6-10',
          progressionStrategy: 'top_set_only',
          customIncrement: 5.0
        }
      );

      expect(rec.ruleApplied).toBe('A_TOP_REPS_ACHIEVED');
      expect(rec.recommendedWeight).toBe(125); // 120 + 5.0
    });
  });
});
