import React, { useState } from 'react';
import {
  Droplets,
  Plus,
  Minus,
  Check,
  RotateCcw,
  Sparkles,
  Info,
  GlassWater,
  CupSoda,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { UserProfile } from '../../types';
import { calculateHydrationGoal, HydrationGoalResult } from '../../utils/calculations';

export interface WaterIntakeLoggerProps {
  waterMl: number;
  onUpdateWater: (newWaterMl: number) => void;
  profile: UserProfile;
}

export const WaterIntakeLogger: React.FC<WaterIntakeLoggerProps> = ({
  waterMl,
  onUpdateWater,
  profile
}) => {
  const [customAmount, setCustomAmount] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState<boolean>(false);
  const [lastAddedDelta, setLastAddedDelta] = useState<number | null>(null);

  // Calculate personalized hydration goal based on user's weight and activity level / training days
  const hydrationPlan: HydrationGoalResult = calculateHydrationGoal(
    profile.currentWeightKg || 78,
    profile.trainingDaysPerWeek || 4
  );

  const goalMl = hydrationPlan.dailyGoalMl;
  const progressPercent = Math.min(100, Math.round((waterMl / goalMl) * 100));
  const remainingMl = Math.max(0, goalMl - waterMl);
  const isGoalAchieved = waterMl >= goalMl;

  // Handles one-tap increment/decrement
  const handleAddWater = (deltaMl: number) => {
    const updated = Math.max(0, waterMl + deltaMl);
    onUpdateWater(updated);
    setLastAddedDelta(deltaMl);
    setTimeout(() => setLastAddedDelta(null), 1800);
  };

  const handleCustomAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customAmount, 10);
    if (!isNaN(val) && val > 0) {
      handleAddWater(val);
      setCustomAmount('');
      setShowCustomInput(false);
    }
  };

  const handleReset = () => {
    if (waterMl === 0) return;
    if (window.confirm('Reset today\'s logged water intake to 0 ml?')) {
      onUpdateWater(0);
    }
  };

  // Convert to Liters for secondary display
  const currentLiters = (waterMl / 1000).toFixed(2);
  const goalLiters = (goalMl / 1000).toFixed(1);

  const PRESET_AMOUNTS = [
    { label: '+250ml', sub: 'Glass', delta: 250, icon: GlassWater },
    { label: '+500ml', sub: 'Shaker', delta: 500, icon: CupSoda },
    { label: '+750ml', sub: 'Flask', delta: 750, icon: Droplets },
    { label: '+1000ml', sub: '1L Jug', delta: 1000, icon: Sparkles }
  ];

  return (
    <div className="reshape-card p-5 sm:p-6 overflow-hidden border border-[var(--border-card)]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border-card)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
            <Droplets className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] font-bold">
                Hydration Command
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/15 text-sky-400 border border-sky-400/30">
                Target: {goalMl.toLocaleString()} ml ({goalLiters} L)
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight mt-0.5">
              Daily Water Intake &amp; Hydration Target
            </h3>
          </div>
        </div>

        {/* Transient Tactile Feedback Badge or Status */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {lastAddedDelta !== null ? (
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-sky-500 text-white animate-bounce shadow-md">
              {lastAddedDelta > 0 ? `+${lastAddedDelta} ml logged!` : `${lastAddedDelta} ml`}
            </span>
          ) : isGoalAchieved ? (
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Goal Reached!</span>
            </span>
          ) : (
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {remainingMl.toLocaleString()} ml remaining
            </span>
          )}

          {waterMl > 0 && (
            <button
              onClick={handleReset}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--chip-bg)] transition-colors"
              title="Reset today's water to 0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Hydration Progress Gauge & Readout */}
      <div className="py-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-[var(--text-primary)] tabular-nums">
              {waterMl.toLocaleString()}
            </span>
            <span className="text-sm font-mono text-[var(--text-muted)]">
              / {goalMl.toLocaleString()} ml
            </span>
            <span className="text-xs font-mono text-sky-400 font-semibold ml-1">
              ({currentLiters} L)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono text-sky-400 tabular-nums">
              {progressPercent}%
            </span>
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              of daily hydration
            </span>
          </div>
        </div>

        {/* Visual Progress Bar with Milestones */}
        <div className="space-y-1.5">
          <div className="relative w-full bg-[var(--chip-bg)] h-3.5 rounded-full overflow-hidden border border-[var(--border-card)]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isGoalAchieved
                  ? 'bg-gradient-to-r from-sky-500 via-cyan-400 to-[#CEFF00]'
                  : 'bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-400'
              }`}
              style={{ width: `${Math.min(100, (waterMl / goalMl) * 100)}%` }}
            />
          </div>

          {/* Milestones Labels */}
          <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] px-0.5">
            <span>0 ml</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span className={isGoalAchieved ? 'text-emerald-400 font-bold' : ''}>
              100% ({goalMl}ml)
            </span>
          </div>
        </div>

        {/* Formula Rationale Badge */}
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] pt-1">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>
            Goal: <strong>{hydrationPlan.formulaDescription}</strong>
          </span>
        </div>
      </div>

      {/* One-Tap Action Buttons Bar */}
      <div className="pt-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold block mb-2">
          One-Tap Quick Log
        </span>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PRESET_AMOUNTS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.delta}
                type="button"
                onClick={() => handleAddWater(preset.delta)}
                className="touch-press p-2.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-sky-400/40 text-[var(--text-primary)] transition-all flex flex-col items-center justify-center gap-1 group"
              >
                <div className="flex items-center gap-1 text-sky-400 group-hover:scale-110 transition-transform">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-mono font-bold">{preset.label}</span>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {preset.sub}
                </span>
              </button>
            );
          })}

          {/* Quick Undo / Decrement or Custom Toggle */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={waterMl <= 0}
              onClick={() => handleAddWater(-250)}
              className="touch-press flex-1 h-full min-h-[52px] p-2 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-amber-400 transition-colors flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo 250ml"
            >
              <Minus className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono font-semibold">-250ml</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCustomInput(!showCustomInput)}
              className={`touch-press flex-1 h-full min-h-[52px] p-2 rounded-xl border font-mono text-[10px] font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                showCustomInput
                  ? 'bg-sky-500/20 border-sky-400 text-sky-400'
                  : 'bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border-[var(--border-card)] text-[var(--text-secondary)]'
              }`}
              title="Custom water amount"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Custom</span>
            </button>
          </div>
        </div>

        {/* Custom Amount Inline Drawer */}
        {showCustomInput && (
          <form
            onSubmit={handleCustomAdd}
            className="mt-3 p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] flex items-center gap-2 animate-fadeIn"
          >
            <input
              type="number"
              step="50"
              min="10"
              max="5000"
              placeholder="Enter amount (ml)..."
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-card)] text-sm font-mono text-[var(--text-primary)] focus:border-sky-400 outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!customAmount || parseInt(customAmount, 10) <= 0}
              className="px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-mono font-bold text-xs disabled:opacity-40"
            >
              Log ml
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
