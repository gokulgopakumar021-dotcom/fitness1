import { DailyNutritionLog } from '../types';

export interface HydrationStreakResult {
  currentStreak: number;
  longestStreak: number;
  weeklyHitCount: number; // 0 to 7
  weeklyCompletionRate: number; // 0 to 100%
  tier: 'none' | 'bronze' | 'silver' | 'gold' | 'diamond';
  tierLabel: string;
  tierColor: string;
  tierIcon: string;
  recent7Days: {
    date: string;
    dayLabel: string;
    isHit: boolean;
    waterMl: number;
    goalMl: number;
    isToday: boolean;
  }[];
}

export function calculateHydrationStreak(
  logs: DailyNutritionLog[],
  todayStr: string,
  currentTodayWaterMl: number,
  dailyGoalMl: number
): HydrationStreakResult {
  const goal = dailyGoalMl > 0 ? dailyGoalMl : 2500;

  // Build a lookup map of date -> waterMl
  const map = new Map<string, number>();
  logs.forEach((l) => {
    map.set(l.date, l.waterMl || 0);
  });
  // Overlay current today's live water
  map.set(todayStr, currentTodayWaterMl);

  // 1. Calculate Recent 7 Days (rolling 7 days ending today)
  const recent7Days = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDate = new Date(todayStr + 'T12:00:00');

  let weeklyHitCount = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const water = map.get(dateKey) || 0;
    const isHit = water >= goal;
    if (isHit) weeklyHitCount++;

    recent7Days.push({
      date: dateKey,
      dayLabel: dateKey === todayStr ? 'Today' : dayNames[d.getDay()],
      isHit,
      waterMl: water,
      goalMl: goal,
      isToday: dateKey === todayStr
    });
  }

  // 2. Calculate Current Consecutive Streak ending today or yesterday
  let currentStreak = 0;
  const isTodayHit = currentTodayWaterMl >= goal;

  let checkDate = new Date(todayDate);
  if (!isTodayHit) {
    // If today is not hit yet, check if streak from yesterday is active
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Count backwards
  while (true) {
    const dateKey = checkDate.toISOString().split('T')[0];
    const water = map.get(dateKey) || 0;
    if (water >= goal) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // 3. Calculate Longest Streak
  // Sort all unique logged dates chronologically
  const allDates = Array.from(map.keys()).sort();
  let longestStreak = currentStreak;
  let running = 0;

  for (let i = 0; i < allDates.length; i++) {
    const dateStr = allDates[i];
    const water = map.get(dateStr) || 0;
    if (water >= goal) {
      if (running === 0) {
        running = 1;
      } else {
        // Check if previous date is strictly consecutive (1 day prior)
        const prevDate = new Date(allDates[i - 1] + 'T12:00:00');
        const currDate = new Date(dateStr + 'T12:00:00');
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          running++;
        } else {
          running = 1;
        }
      }
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }
  }

  // 4. Streak Tiers
  let tier: 'none' | 'bronze' | 'silver' | 'gold' | 'diamond' = 'none';
  let tierLabel = 'Starting Streak';
  let tierColor = 'text-[var(--text-muted)]';
  let tierIcon = '💧';

  if (currentStreak >= 7) {
    tier = 'diamond';
    tierLabel = 'Diamond Master';
    tierColor = 'text-cyan-300';
    tierIcon = '💎';
  } else if (currentStreak >= 5) {
    tier = 'gold';
    tierLabel = 'Gold Hydrator';
    tierColor = 'text-amber-400';
    tierIcon = '🥇';
  } else if (currentStreak >= 3) {
    tier = 'silver';
    tierLabel = 'Silver Hydrator';
    tierColor = 'text-slate-300';
    tierIcon = '🥈';
  } else if (currentStreak >= 1) {
    tier = 'bronze';
    tierLabel = 'Bronze Hydrator';
    tierColor = 'text-amber-600';
    tierIcon = '🥉';
  }

  const weeklyCompletionRate = Math.round((weeklyHitCount / 7) * 100);

  return {
    currentStreak,
    longestStreak,
    weeklyHitCount,
    weeklyCompletionRate,
    tier,
    tierLabel,
    tierColor,
    tierIcon,
    recent7Days
  };
}
