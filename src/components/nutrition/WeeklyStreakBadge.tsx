import React, { useState } from 'react';
import { Flame, Trophy, Sparkles, ChevronRight, Check, Droplets, Info } from 'lucide-react';
import { HydrationStreakResult } from '../../utils/hydrationStreak';

export interface WeeklyStreakBadgeProps {
  streak: HydrationStreakResult;
  onTriggerCelebration?: () => void;
  isTodayGoalAchieved: boolean;
}

export const WeeklyStreakBadge: React.FC<WeeklyStreakBadgeProps> = ({
  streak,
  onTriggerCelebration,
  isTodayGoalAchieved
}) => {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="relative">
      <div className="p-3 sm:p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left Side: Flame Icon, Streak Count & Tier */}
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-inner ${
              streak.currentStreak > 0
                ? 'bg-amber-500/15 border-amber-400/30 text-amber-400'
                : 'bg-surface-2 border-line text-zinc-500'
            }`}
          >
            <Flame
              className={`w-5 h-5 ${streak.currentStreak > 0 ? 'fill-amber-400 animate-pulse' : ''}`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                {streak.currentStreak} Day Weekly Streak
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  streak.tier === 'diamond'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30'
                    : streak.tier === 'gold'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-400/30'
                    : streak.tier === 'silver'
                    ? 'bg-zinc-400/15 text-zinc-300 border-zinc-400/30'
                    : streak.tier === 'bronze'
                    ? 'bg-amber-600/15 text-amber-500 border-amber-500/30'
                    : 'bg-surface-2 text-zinc-500 border-line'
                }`}
              >
                {streak.tierIcon} {streak.tierLabel}
              </span>
            </div>

            <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
              Hit daily goal: <strong className="text-white">{streak.weeklyHitCount} of 7 days</strong> this week ({streak.weeklyCompletionRate}% consistency)
            </p>
          </div>
        </div>

        {/* Right Side: 7-Day Dot Tracker & Actions */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* 7-Day Dot Indicator */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
            {streak.recent7Days.map((day) => (
              <div
                key={day.date}
                className="flex flex-col items-center gap-0.5 px-1 py-0.5"
                title={`${day.dayLabel} (${day.date}): ${day.isHit ? 'Target Achieved' : 'Below Target'} (${day.waterMl} ml / ${day.goalMl} ml)`}
              >
                <span
                  className={`text-[9px] font-mono ${
                    day.isToday ? 'text-sky-400 font-bold' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {day.dayLabel.charAt(0)}
                </span>
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                    day.isHit
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : day.isToday
                      ? 'border border-dashed border-sky-400/60 bg-sky-500/10'
                      : 'bg-surface-2 border border-line text-zinc-500'
                  }`}
                >
                  {day.isHit ? (
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  ) : (
                    <div className="w-1 h-1 rounded-full bg-zinc-500" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Celebration Replay Button if goal achieved */}
          {isTodayGoalAchieved && onTriggerCelebration && (
            <button
              type="button"
              onClick={onTriggerCelebration}
              className="px-2.5 py-1.5 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-xs font-mono font-bold transition-all flex items-center gap-1 shadow-sm shrink-0"
              title="Replay Goal Celebration"
            >
              <Sparkles className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden sm:inline">Celebrate!</span>
            </button>
          )}

          {/* Detail Info Toggle */}
          <button
            type="button"
            onClick={() => setShowDetail(!showDetail)}
            className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-white hover:bg-[var(--chip-bg)] transition-colors border border-transparent hover:border-[var(--border-card)]"
            title="View streak details & rules"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Streak Details Drawer */}
      {showDetail && (
        <div className="mt-2 p-3.5 rounded-2xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-xs font-mono space-y-2 animate-fadeIn shadow-lg">
          <div className="flex items-center justify-between text-white font-bold">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Trophy className="w-4 h-4" />
              <span>Hydration Gamification &amp; Streaks</span>
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              All-Time Best: <strong className="text-white">{streak.longestStreak} Days</strong>
            </span>
          </div>

          <p className="text-[11px] text-[var(--text-secondary)] font-sans leading-relaxed">
            Every day you log 100% or more of your calculated fluid target advances your streak. Streaks reset if a calendar day ends under the target without logging.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px]">
            <div className="p-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-card)]">
              <span className="text-amber-600 block font-bold">🥉 Bronze Tier</span>
              <span className="text-[var(--text-muted)]">1 – 2 Days Active</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-card)]">
              <span className="text-zinc-300 block font-bold">🥈 Silver Tier</span>
              <span className="text-[var(--text-muted)]">3 – 4 Days Active</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-card)]">
              <span className="text-amber-400 block font-bold">🥇 Gold Tier</span>
              <span className="text-[var(--text-muted)]">5 – 6 Days Active</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-subtle)] border border-cyan-400/30 bg-cyan-500/10">
              <span className="text-cyan-300 block font-bold">💎 Diamond Tier</span>
              <span className="text-[var(--text-muted)]">7+ Days Perfection</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
