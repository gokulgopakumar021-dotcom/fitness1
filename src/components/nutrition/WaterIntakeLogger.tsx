import React, { useState, useEffect, useRef } from 'react';
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
  CheckCircle2,
  Trophy,
  Activity,
  ArrowRight
} from 'lucide-react';
import { UserProfile } from '../../types';
import { db } from '../../storage/db';
import { calculateHydrationGoal, HydrationGoalResult } from '../../utils/calculations';
import { calculateHydrationStreak } from '../../utils/hydrationStreak';
import { HydrationHistoryChart } from './HydrationHistoryChart';
import { HydrationPacingAlert } from './HydrationPacingAlert';
import { WeeklyStreakBadge } from './WeeklyStreakBadge';
import { HydrationCelebrationModal } from './HydrationCelebrationModal';
import { QuickAddPresetBar } from './QuickAddPresetBar';

export type WaterUnit = 'ml' | 'oz';

export interface WaterIntakeLoggerProps {
  waterMl: number;
  onUpdateWater: (newWaterMl: number) => void;
  profile: UserProfile;
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

// 1 US fluid ounce = 29.5735296 ml
const ML_PER_FL_OZ = 29.5735296;

export const WaterIntakeLogger: React.FC<WaterIntakeLoggerProps> = ({
  waterMl,
  onUpdateWater,
  profile,
  selectedDate,
  onSelectDate
}) => {
  const activeDate = selectedDate || new Date().toISOString().split('T')[0];
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);

  // Unit preference (default to imperial 'oz' if profile preferredUnit is lbs, otherwise check localStorage)
  const [unit, setUnit] = useState<WaterUnit>(() => {
    try {
      const saved = localStorage.getItem('ironlog_water_unit');
      if (saved === 'oz' || saved === 'ml') return saved;
      if (profile.preferredUnit === 'lbs') return 'oz';
    } catch {
      // ignore
    }
    return 'oz';
  });

  const [customAmount, setCustomAmount] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<WaterUnit>(unit);
  const [showHydrationTips, setShowHydrationTips] = useState<boolean>(false);
  const [lastAddedDelta, setLastAddedDelta] = useState<{
    amount: number;
    unit: WaterUnit;
    secondaryText: string;
  } | null>(null);

  // Sync unit preference
  const handleUnitChange = (newUnit: WaterUnit) => {
    setUnit(newUnit);
    setCustomUnit(newUnit);
    try {
      localStorage.setItem('ironlog_water_unit', newUnit);
    } catch {
      // ignore
    }
  };

  // Calculate personalized hydration goal based on user's weight and training days
  const hydrationPlan: HydrationGoalResult = calculateHydrationGoal(
    profile.currentWeightKg || 78,
    profile.trainingDaysPerWeek || 4
  );

  const goalMl = hydrationPlan.dailyGoalMl;
  const goalOz = hydrationPlan.dailyGoalOz || Math.round(goalMl / ML_PER_FL_OZ);

  // Current calculations in both units
  const currentMl = Math.max(0, waterMl);
  const currentOz = Math.round(currentMl / ML_PER_FL_OZ);
  const currentLiters = (currentMl / 1000).toFixed(2);

  const progressPercent = Math.min(150, Math.round((currentMl / goalMl) * 100));
  const remainingMl = Math.max(0, goalMl - currentMl);
  const remainingOz = Math.max(0, goalOz - currentOz);
  const isGoalAchieved = currentMl >= goalMl && goalMl > 0;

  // Track celebration state and trigger when crossing goal
  const prevAchievedRef = useRef<boolean>(currentMl >= goalMl && currentMl > 0);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (!prevAchievedRef.current && currentMl >= goalMl && currentMl > 0) {
      setShowCelebration(true);
    }
    prevAchievedRef.current = currentMl >= goalMl && currentMl > 0;
  }, [currentMl, goalMl]);

  // Calculate rolling weekly streak and tier
  const streakResult = calculateHydrationStreak(
    db.getNutritionLogs(),
    activeDate,
    currentMl,
    goalMl
  );

  // Handles adding water via delta
  const handleAddWaterMl = (deltaMl: number, displayLabel?: string) => {
    const updated = Math.max(0, currentMl + deltaMl);
    onUpdateWater(updated);

    if (deltaMl !== 0) {
      if (unit === 'oz') {
        const deltaOz = Math.round(deltaMl / ML_PER_FL_OZ);
        setLastAddedDelta({
          amount: deltaOz,
          unit: 'oz',
          secondaryText: `${deltaMl > 0 ? '+' : ''}${deltaMl} ml`
        });
      } else {
        setLastAddedDelta({
          amount: deltaMl,
          unit: 'ml',
          secondaryText: `${deltaMl > 0 ? '+' : ''}${Math.round(deltaMl / ML_PER_FL_OZ)} oz`
        });
      }
      setTimeout(() => setLastAddedDelta(null), 2200);
    }
  };

  const handleAddWaterOz = (deltaOz: number) => {
    const deltaMl = Math.round(deltaOz * ML_PER_FL_OZ);
    handleAddWaterMl(deltaMl);
  };

  const handleCustomAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(customAmount);
    if (!isNaN(val) && val > 0) {
      if (customUnit === 'oz') {
        handleAddWaterOz(val);
      } else {
        handleAddWaterMl(Math.round(val));
      }
      setCustomAmount('');
    }
  };

  const handleReset = () => {
    if (currentMl === 0) return;
    if (window.confirm("Reset today's logged water intake to 0?")) {
      onUpdateWater(0);
    }
  };

  // Hydration status evaluation
  const getHydrationStatus = () => {
    if (currentMl === 0) {
      return {
        label: 'Ready to Hydrate',
        color: 'text-sky-400',
        bg: 'bg-sky-500/10 border-sky-400/20',
        desc: 'Begin your day with 16 oz / 500 ml to kickstart cellular hydration and metabolism.'
      };
    }
    if (progressPercent < 35) {
      return {
        label: 'Hydration Underway',
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10 border-cyan-400/20',
        desc: 'Steady sips maintain blood volume, joint lubrication, and muscular power.'
      };
    }
    if (progressPercent < 75) {
      return {
        label: 'Optimal Pace',
        color: 'text-blue-400',
        bg: 'bg-blue-500/10 border-blue-400/20',
        desc: 'Over halfway! Sustained water intake keeps intracellular volume primed for lifting.'
      };
    }
    if (progressPercent < 100) {
      return {
        label: 'Target Within Reach',
        color: 'text-sky-300',
        bg: 'bg-sky-400/15 border-sky-400/30',
        desc: 'Just a few more glasses to finish off your daily sports hydration baseline.'
      };
    }
    return {
      label: 'Target Achieved',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/15 border-emerald-500/30',
      desc: 'Outstanding discipline! Daily athletic hydration target fully satisfied.'
    };
  };

  const status = getHydrationStatus();

  return (
    <div className="reshape-card p-5 sm:p-6 overflow-hidden border border-[var(--border-card)] space-y-5">
      {/* Top Header with Unit Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border-card)]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0 shadow-inner">
            <Droplets className="w-6 h-6 stroke-[2.3] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] font-bold">
                Hydration Tracker
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/15 text-sky-400 border border-sky-400/30">
                {unit === 'oz'
                  ? `Goal: ${goalOz} fl oz (${goalMl.toLocaleString()} ml)`
                  : `Goal: ${goalMl.toLocaleString()} ml (${goalOz} fl oz)`}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight mt-0.5">
              Daily Water Intake &amp; Fluid Balance
            </h3>
          </div>
        </div>

        {/* Controls: Unit Toggle & Reset */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Unit Switcher: Ounces (oz) vs Milliliters (ml) */}
          <div className="inline-flex p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] text-xs font-mono font-bold">
            <button
              type="button"
              onClick={() => handleUnitChange('oz')}
              className={`px-3 py-1 rounded-lg transition-all ${
                unit === 'oz'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              fl oz
            </button>
            <button
              type="button"
              onClick={() => handleUnitChange('ml')}
              className={`px-3 py-1 rounded-lg transition-all ${
                unit === 'ml'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              ml
            </button>
          </div>

          {currentMl > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--chip-bg)] transition-colors border border-transparent hover:border-rose-400/20"
              title="Reset today's water intake to 0"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* GAMIFICATION LAYER: WEEKLY STREAK BADGE & 7-DAY PROGRESS */}
      <WeeklyStreakBadge
        streak={streakResult}
        onTriggerCelebration={() => setShowCelebration(true)}
        isTodayGoalAchieved={isGoalAchieved}
      />

      {/* Main Hydration Progress Hero & Metric Display */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Left Side: Numerical Readout & Progress Breakdown */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-0.5">
                Total Logged Today
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-[var(--text-primary)] tabular-nums tracking-tight">
                  {unit === 'oz' ? currentOz : currentMl.toLocaleString()}
                </span>
                <span className="text-sm font-mono text-[var(--text-muted)] font-bold">
                  / {unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}
                </span>
                {/* Secondary Unit Subtext */}
                <span className="text-xs font-mono font-semibold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-400/20">
                  {unit === 'oz'
                    ? `${currentMl.toLocaleString()} ml (${currentLiters} L)`
                    : `${currentOz} fl oz (${currentLiters} L)`}
                </span>
              </div>
            </div>

            {/* Percentage Badge */}
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-sky-400 tabular-nums">
                  {progressPercent}%
                </span>
                {isGoalAchieved && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 stroke-[2.5]" />
                )}
              </div>
              <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                {isGoalAchieved
                  ? `Goal achieved! (+${unit === 'oz' ? currentOz - goalOz + ' oz' : (currentMl - goalMl).toLocaleString() + ' ml'})`
                  : `${unit === 'oz' ? remainingOz + ' fl oz' : remainingMl.toLocaleString() + ' ml'} remaining`}
              </span>
            </div>
          </div>

          {/* Visual Progress Bar with Fluid Liquid Gradient */}
          <div className="space-y-1.5 pt-1">
            <div className="relative w-full bg-[var(--chip-bg)] h-4 rounded-full overflow-hidden border border-[var(--border-card)] shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-700 relative ${
                  isGoalAchieved
                    ? 'bg-gradient-to-r from-sky-500 via-cyan-400 to-[#CEFF00]'
                    : 'bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-400'
                }`}
                style={{ width: `${Math.min(100, (currentMl / goalMl) * 100)}%` }}
              >
                {/* Shimmer effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
              </div>
            </div>

            {/* Milestones Indicator Labels */}
            <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] px-1">
              <span>0 {unit === 'oz' ? 'oz' : 'ml'}</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span
                className={`flex items-center gap-1 ${
                  isGoalAchieved ? 'text-emerald-400 font-bold' : ''
                }`}
              >
                {isGoalAchieved && <Check className="w-3 h-3 stroke-[3]" />}
                100% ({unit === 'oz' ? `${goalOz} oz` : `${goalMl} ml`})
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Hydration Status Coach Card */}
        <div className={`lg:col-span-5 p-3.5 sm:p-4 rounded-2xl border ${status.bg} space-y-1.5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full animate-ping ${isGoalAchieved ? 'bg-emerald-400' : 'bg-sky-400'}`} />
              <span className={`text-xs font-mono font-bold uppercase tracking-wider ${status.color}`}>
                {status.label}
              </span>
            </div>
            {lastAddedDelta && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-500 text-white animate-bounce shadow">
                +{lastAddedDelta.amount} {lastAddedDelta.unit} ({lastAddedDelta.secondaryText})
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
            {status.desc}
          </p>
          <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>Hydration Target: <strong>{unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}</strong></span>
            </span>
            <button
              type="button"
              onClick={() => setShowHydrationTips(!showHydrationTips)}
              className="text-sky-400 hover:underline flex items-center gap-0.5"
            >
              <span>{showHydrationTips ? 'Hide info' : 'Calculation'}</span>
              <Info className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Personalized Formula Calculation Drawer (if opened) */}
      {showHydrationTips && (
        <div className="p-4 rounded-2xl bg-[var(--bg-subtle)] border border-sky-400/20 text-xs text-[var(--text-secondary)] space-y-2 animate-fadeIn font-mono">
          <div className="flex items-center gap-2 text-sky-400 font-bold">
            <Info className="w-4 h-4 shrink-0" />
            <span>Sports Medicine Hydration Formula</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed font-sans">
            Your hydration target is individualized to your body mass (<strong>{profile.currentWeightKg || 78} kg</strong>) and training load (<strong>{profile.trainingDaysPerWeek || 4} sessions/week</strong>):
          </p>
          <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-[11px] text-[var(--text-primary)]">
            {hydrationPlan.formulaDescription} = <strong>{goalMl.toLocaleString()} ml</strong> / <strong>{goalOz} fl oz</strong> daily.
          </div>
          <p className="text-[11px] text-[var(--text-muted)] font-sans">
            Athletes in heavy compound training or taking Creatine Monohydrate should aim to hit or surpass this intake for optimal muscle volumization and thermoregulation.
          </p>
        </div>
      )}

      {/* HOURLY PACING GAUGE, VISUAL ALERTS & PUSH NOTIFICATION SCHEDULER */}
      <HydrationPacingAlert
        currentWaterMl={currentMl}
        goalMl={goalMl}
        goalOz={goalOz}
        unit={unit}
        selectedDate={activeDate}
        onQuickAddWater={(deltaMl) => handleAddWaterMl(deltaMl)}
      />

      {/* QUICK ADD PRESET BAR (8oz, 16oz, 500ml, 24oz, 750ml, 1L) ABOVE HYDRATION ENTRY INPUT */}
      <div className="pt-1 space-y-3">
        <QuickAddPresetBar
          activeUnit={unit}
          onQuickAdd={(deltaMl, label) => handleAddWaterMl(deltaMl, label)}
          onPrefillInput={(amt, u) => {
            setCustomAmount(amt.toString());
            setCustomUnit(u);
          }}
        />

        {/* HYDRATION NUMERIC ENTRY INPUT */}
        <div className="p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-2.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <span>Hydration Entry Input</span>
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Fine-tune amount or type custom volume
            </span>
          </div>

          <form
            onSubmit={handleCustomAdd}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <input
                  type="number"
                  step={customUnit === 'oz' ? '1' : '25'}
                  min="1"
                  max={customUnit === 'oz' ? '250' : '8000'}
                  placeholder={customUnit === 'oz' ? 'e.g. 16 (fl oz)' : 'e.g. 500 (ml)'}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full pl-3 pr-12 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-sm font-mono text-[var(--text-primary)] focus:border-sky-400 outline-none"
                />
                <span className="absolute right-3 top-3 text-xs font-mono text-[var(--text-muted)] uppercase">
                  {customUnit}
                </span>
              </div>

              {/* Toggle unit inside entry input */}
              <div className="flex items-center p-1 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-xs font-mono font-bold">
                <button
                  type="button"
                  onClick={() => setCustomUnit('oz')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    customUnit === 'oz' ? 'bg-sky-500 text-white' : 'text-[var(--text-muted)] hover:text-white'
                  }`}
                >
                  oz
                </button>
                <button
                  type="button"
                  onClick={() => setCustomUnit('ml')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    customUnit === 'ml' ? 'bg-sky-500 text-white' : 'text-[var(--text-muted)] hover:text-white'
                  }`}
                >
                  ml
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {customAmount && parseFloat(customAmount) > 0 && (
                <span className="text-[11px] font-mono text-sky-400 hidden md:inline">
                  ≈ {customUnit === 'oz'
                    ? `${Math.round(parseFloat(customAmount) * ML_PER_FL_OZ)} ml`
                    : `${Math.round(parseFloat(customAmount) / ML_PER_FL_OZ)} fl oz`}
                </span>
              )}

              <button
                type="submit"
                disabled={!customAmount || parseFloat(customAmount) <= 0}
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-mono font-bold text-xs disabled:opacity-40 transition-colors shadow-sm flex items-center justify-center gap-1.5 shrink-0"
              >
                <span>Log {customAmount ? `${customAmount} ${customUnit}` : 'Water'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              {/* Quick Undo Button */}
              <button
                type="button"
                disabled={currentMl <= 0}
                onClick={() => (unit === 'oz' ? handleAddWaterOz(-8) : handleAddWaterMl(-250))}
                className="p-2.5 rounded-xl bg-[var(--bg-canvas)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-muted)] hover:text-amber-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                title={unit === 'oz' ? 'Undo 8 oz' : 'Undo 250 ml'}
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 7-DAY HYDRATION HISTORY BAR CHART (RECHARTS) */}
      <HydrationHistoryChart
        key={`${activeDate}-${historyRefreshKey}-${currentMl}`}
        selectedDate={activeDate}
        currentWaterMl={currentMl}
        goalMl={goalMl}
        goalOz={goalOz}
        unit={unit}
        profile={profile}
        onSelectDate={onSelectDate}
        onRefreshHistory={() => setHistoryRefreshKey((k) => k + 1)}
      />

      {/* GAMIFICATION CELEBRATION MODAL (FRAMER MOTION) */}
      <HydrationCelebrationModal
        isOpen={showCelebration}
        onClose={() => setShowCelebration(false)}
        waterMl={currentMl}
        goalMl={goalMl}
        goalOz={goalOz}
        unit={unit}
        streakCount={streakResult.currentStreak}
      />
    </div>
  );
};
