import { describe, expect, it } from 'vitest';
import { calculateHydrationStreak } from './hydrationStreak';
import { DailyNutritionLog } from '../types';

describe('calculateHydrationStreak', () => {
  const baseLog = (date: string, waterMl: number): DailyNutritionLog => ({
    id: `nutr-${date}`,
    date,
    entries: [],
    waterMl,
    targetCalories: 2500,
    targetProtein: 160,
    targetCarbs: 300,
    targetFat: 60
  });

  it('calculates 0-day streak when no logs meet goal', () => {
    const today = '2026-10-28';
    const logs = [baseLog('2026-10-26', 1000), baseLog('2026-10-27', 1200)];

    const result = calculateHydrationStreak(logs, today, 800, 3000);
    expect(result.currentStreak).toBe(0);
    expect(result.weeklyHitCount).toBe(0);
    expect(result.tier).toBe('none');
  });

  it('calculates active streak when consecutive past days and today hit goal', () => {
    const today = '2026-10-28';
    const logs = [
      baseLog('2026-10-25', 3000),
      baseLog('2026-10-26', 3200),
      baseLog('2026-10-27', 3500)
    ];

    // Today is also hit (3100 >= 3000): 4 consecutive days
    const result = calculateHydrationStreak(logs, today, 3100, 3000);
    expect(result.currentStreak).toBe(4);
    expect(result.weeklyHitCount).toBe(4);
    expect(result.tier).toBe('silver');
  });

  it('retains active streak from yesterday if today is still in progress', () => {
    const today = '2026-10-28';
    const logs = [
      baseLog('2026-10-26', 3100),
      baseLog('2026-10-27', 3200)
    ];

    // Today is morning (500 < 3000): streak of 2 days is still active from yesterday
    const result = calculateHydrationStreak(logs, today, 500, 3000);
    expect(result.currentStreak).toBe(2);
    expect(result.tier).toBe('bronze');
  });

  it('awards diamond tier for 7+ day streak', () => {
    const today = '2026-10-28';
    const logs = [
      baseLog('2026-10-21', 3000),
      baseLog('2026-10-22', 3000),
      baseLog('2026-10-23', 3000),
      baseLog('2026-10-24', 3000),
      baseLog('2026-10-25', 3000),
      baseLog('2026-10-26', 3000),
      baseLog('2026-10-27', 3000)
    ];

    const result = calculateHydrationStreak(logs, today, 3000, 3000);
    expect(result.currentStreak).toBe(8);
    expect(result.tier).toBe('diamond');
    expect(result.tierLabel).toBe('Diamond Master');
  });
});
