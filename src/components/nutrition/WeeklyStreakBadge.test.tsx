import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyStreakBadge } from './WeeklyStreakBadge';
import { HydrationStreakResult } from '../../utils/hydrationStreak';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mockStreak: HydrationStreakResult = {
  currentStreak: 5,
  longestStreak: 8,
  weeklyHitCount: 5,
  weeklyCompletionRate: 71,
  tier: 'gold',
  tierLabel: 'Gold Hydrator',
  tierColor: 'text-amber-400',
  tierIcon: '🥇',
  recent7Days: [
    { date: '2026-10-22', dayLabel: 'Thu', isHit: true, waterMl: 3000, goalMl: 3000, isToday: false },
    { date: '2026-10-23', dayLabel: 'Fri', isHit: true, waterMl: 3200, goalMl: 3000, isToday: false },
    { date: '2026-10-24', dayLabel: 'Sat', isHit: false, waterMl: 2200, goalMl: 3000, isToday: false },
    { date: '2026-10-25', dayLabel: 'Sun', isHit: false, waterMl: 2000, goalMl: 3000, isToday: false },
    { date: '2026-10-26', dayLabel: 'Mon', isHit: true, waterMl: 3000, goalMl: 3000, isToday: false },
    { date: '2026-10-27', dayLabel: 'Tue', isHit: true, waterMl: 3400, goalMl: 3000, isToday: false },
    { date: '2026-10-28', dayLabel: 'Today', isHit: true, waterMl: 3100, goalMl: 3000, isToday: true }
  ]
};

describe('WeeklyStreakBadge', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders streak count, tier, and hit count', async () => {
    await act(async () => {
      root.render(
        <WeeklyStreakBadge
          streak={mockStreak}
          isTodayGoalAchieved={true}
        />
      );
    });

    expect(container.textContent).toContain('5 Day Weekly Streak');
    expect(container.textContent).toContain('Gold Hydrator');
    expect(container.textContent).toContain('5 of 7 days');
  });

  it('renders celebration button and triggers callback when today goal is achieved', async () => {
    const onCelebrate = vi.fn();

    await act(async () => {
      root.render(
        <WeeklyStreakBadge
          streak={mockStreak}
          onTriggerCelebration={onCelebrate}
          isTodayGoalAchieved={true}
        />
      );
    });

    const celebrateBtn = container.querySelector('button[title*="Celebration"]');
    expect(celebrateBtn).toBeTruthy();

    await act(async () => {
      (celebrateBtn as HTMLButtonElement).click();
    });

    expect(onCelebrate).toHaveBeenCalled();
  });
});
