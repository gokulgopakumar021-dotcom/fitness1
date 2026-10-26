import React, { useState } from 'react';
import {
  Flame,
  Target,
  Zap,
  TrendingDown,
  TrendingUp,
  Scale,
  CheckCircle2,
  AlertCircle,
  Sliders,
  ChevronRight,
  Info
} from 'lucide-react';
import { UserProfile } from '../../types';
import { calculateDetailedTDEE } from '../../utils/tdeeEngine';

export interface NutritionGoalGaugeProps {
  currentCalories: number;
  targetCalories: number;
  currentProtein: number;
  targetProtein: number;
  currentCarbs: number;
  targetCarbs: number;
  currentFat: number;
  targetFat: number;
  profile: UserProfile;
  onOpenWizard: () => void;
}

export const NutritionGoalGauge: React.FC<NutritionGoalGaugeProps> = ({
  currentCalories,
  targetCalories,
  currentProtein,
  targetProtein,
  currentCarbs,
  targetCarbs,
  currentFat,
  targetFat,
  profile,
  onOpenWizard
}) => {
  const [gaugeMode, setGaugeMode] = useState<'radial' | 'macro_rings'>('radial');

  // Derive goal parameters
  const goal = profile.primaryGoal;
  const isCut = goal === 'fat_loss';
  const isBulk = goal === 'muscle_gain';
  const isMaintain = !isCut && !isBulk;

  // Calculate maintenance baseline using the athlete's biometrics and body fat %
  const detailedTdee = calculateDetailedTDEE({
    weightKg: profile.currentWeightKg || 78,
    heightCm: profile.heightCm || 178,
    age: profile.age || 26,
    sex: profile.sex || 'male',
    activityLevel: 'moderate',
    bodyFatPercentage: profile.bodyFatPercentage
  });

  const maintenanceTdee = detailedTdee.dailyTdee;
  const goalDeltaKcal = targetCalories - maintenanceTdee;

  // Percentages clamped for visual gauge
  const calPercent = targetCalories > 0 ? Math.round((currentCalories / targetCalories) * 100) : 0;
  const proPercent = targetProtein > 0 ? Math.round((currentProtein / targetProtein) * 100) : 0;
  const carbPercent = targetCarbs > 0 ? Math.round((currentCarbs / targetCarbs) * 100) : 0;
  const fatPercent = targetFat > 0 ? Math.round((currentFat / targetFat) * 100) : 0;

  // Semicircle gauge geometry
  // Semicircle arc: radius 80, cx=100, cy=95.
  // Arc length = Math.PI * 80 ≈ 251.32
  const arcRadius = 78;
  const arcCircumference = Math.PI * arcRadius;
  const clampedCalRatio = Math.min(1.2, currentCalories / Math.max(1, targetCalories));
  const calStrokeOffset = arcCircumference * (1 - Math.min(1, clampedCalRatio));

  // Determine intake zone status relative to target and goal
  const calDelta = currentCalories - targetCalories;
  const calRemaining = targetCalories - currentCalories;
  let statusBadge = {
    label: 'Calibrating Intake',
    color: 'text-volt-adaptive bg-[#CEFF00]/10 border-[#CEFF00]/30',
    description: `${Math.max(0, targetCalories - currentCalories)} kcal remaining to hit your target`
  };

  if (calPercent >= 95 && calPercent <= 105) {
    statusBadge = {
      label: 'Target Zone Aligned',
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      description: 'Intake is within optimal ±5% range of your wizard plan'
    };
  } else if (calPercent > 105) {
    if (isCut) {
      statusBadge = {
        label: 'Surplus Warning (Cut Goal)',
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
        description: `${calDelta} kcal over target — deficit is narrowing`
      };
    } else if (isBulk) {
      statusBadge = {
        label: 'High Surplus Zone',
        color: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
        description: `${calDelta} kcal above bulk target`
      };
    } else {
      statusBadge = {
        label: 'Above Maintenance',
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
        description: `${calDelta} kcal above maintenance target`
      };
    }
  } else {
    statusBadge = {
      label: `${Math.max(0, targetCalories - currentCalories)} kcal Remaining`,
      color: 'text-volt-adaptive bg-[#CEFF00]/10 border-[#CEFF00]/30',
      description: `${calPercent}% of daily budget logged today`
    };
  }

  // Concentric ring radii for Macro Rings mode
  // Protein (outer), Carbs (middle), Fat (inner)
  const ringCenter = 90;
  const proRadius = 70;
  const carbRadius = 52;
  const fatRadius = 34;

  const proCircumference = 2 * Math.PI * proRadius;
  const carbCircumference = 2 * Math.PI * carbRadius;
  const fatCircumference = 2 * Math.PI * fatRadius;

  const proOffset = proCircumference * (1 - Math.min(1, currentProtein / Math.max(1, targetProtein)));
  const carbOffset = carbCircumference * (1 - Math.min(1, currentCarbs / Math.max(1, targetCarbs)));
  const fatOffset = fatCircumference * (1 - Math.min(1, currentFat / Math.max(1, targetFat)));

  return (
    <div className="reshape-card p-5 sm:p-6 overflow-hidden border border-[var(--border-card)]">
      {/* Top Header & Goal Alignment Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border-card)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#CEFF00]/10 border border-[#CEFF00]/30 flex items-center justify-center text-volt-adaptive shrink-0">
            <Target className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] font-bold">
                Goal Progression Gauge
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                  isCut
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30'
                    : isBulk
                    ? 'bg-sky-400/15 text-sky-400 border border-sky-400/30'
                    : 'bg-[#CEFF00]/15 text-volt-adaptive border border-[#CEFF00]/30'
                }`}
              >
                {isCut ? 'Cut · Deficit' : isBulk ? 'Bulk · Surplus' : 'Maintain · Balance'}
              </span>
              {typeof profile.bodyFatPercentage === 'number' && profile.bodyFatPercentage > 0 && (
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                  {profile.bodyFatPercentage}% BF
                </span>
              )}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight mt-0.5">
              Daily Target vs. Metabolic Intake
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Toggle between Radial Arc and Concentric Macro Rings */}
          <div className="bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl p-1 flex items-center text-xs font-mono">
            <button
              type="button"
              onClick={() => setGaugeMode('radial')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                gaugeMode === 'radial'
                  ? 'bg-accent text-accent-ink font-bold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Calorie Dial
            </button>
            <button
              type="button"
              onClick={() => setGaugeMode('macro_rings')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                gaugeMode === 'macro_rings'
                  ? 'bg-accent text-accent-ink font-bold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Macro Rings
            </button>
          </div>

          <button
            onClick={onOpenWizard}
            className="touch-press px-3 py-1.5 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
            title="Calibrate Targets with Nutrition Goal Wizard"
          >
            <Sliders className="w-3.5 h-3.5 text-volt-adaptive" />
            <span className="hidden md:inline">Recalibrate</span>
          </button>
        </div>
      </div>

      {/* Main Gauge & Goal Alignment Presentation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-5">
        {/* Left: SVG Gauge Display */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center p-2">
          {gaugeMode === 'radial' ? (
            /* Semicircle Gauge Dial */
            <div className="relative w-64 h-38 flex flex-col items-center justify-end select-none">
              <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="calorieGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#CEFF00" />
                    <stop offset="70%" stopColor="#a3e635" />
                    <stop offset="100%" stopColor={currentCalories > targetCalories ? '#f59e0b' : '#38bdf8'} />
                  </linearGradient>
                </defs>

                {/* Background Semicircle Track */}
                <path
                  d="M 22 100 A 78 78 0 0 1 178 100"
                  fill="none"
                  stroke="var(--chip-bg)"
                  strokeWidth="14"
                  strokeLinecap="round"
                />

                {/* Target Zone Notch Marker at 100% */}
                <circle cx="178" cy="100" r="3" fill="var(--text-muted)" opacity="0.6" />

                {/* Foreground Animated Progress Arc */}
                <path
                  d="M 22 100 A 78 78 0 0 1 178 100"
                  fill="none"
                  stroke="url(#calorieGaugeGrad)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray={arcCircumference}
                  strokeDashoffset={calStrokeOffset}
                  className="transition-all duration-700 ease-out"
                />
              </svg>

              {/* Central Numerical Readout inside Arc */}
              <div className="absolute bottom-1 flex flex-col items-center text-center">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold font-mono text-[var(--text-primary)] tabular-nums">
                    {currentCalories}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-muted)] font-normal">
                    / {targetCalories}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] font-mono font-bold text-volt-adaptive">
                    {calPercent}% Target
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">·</span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {calRemaining >= 0 ? `${calRemaining} left` : `${Math.abs(calRemaining)} over`}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Concentric Macro Rings (Apple Fitness / Whoop style) */
            <div className="relative w-56 h-56 flex items-center justify-center select-none">
              <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90 overflow-visible">
                {/* Track Rings */}
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={proRadius}
                  fill="none"
                  stroke="var(--chip-bg)"
                  strokeWidth="10"
                />
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={carbRadius}
                  fill="none"
                  stroke="var(--chip-bg)"
                  strokeWidth="10"
                />
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={fatRadius}
                  fill="none"
                  stroke="var(--chip-bg)"
                  strokeWidth="10"
                />

                {/* Protein Ring (Outer - Volt) */}
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={proRadius}
                  fill="none"
                  stroke="#CEFF00"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={proCircumference}
                  strokeDashoffset={proOffset}
                  className="transition-all duration-700 ease-out"
                />

                {/* Carbs Ring (Middle - Sky Cyan) */}
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={carbRadius}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={carbCircumference}
                  strokeDashoffset={carbOffset}
                  className="transition-all duration-700 ease-out"
                />

                {/* Fat Ring (Inner - Amber) */}
                <circle
                  cx={ringCenter}
                  cy={ringCenter}
                  r={fatRadius}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={fatCircumference}
                  strokeDashoffset={fatOffset}
                  className="transition-all duration-700 ease-out"
                />
              </svg>

              {/* Center Ring Data */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                <Flame className="w-5 h-5 text-volt-adaptive mb-0.5" />
                <span className="text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                  {calPercent}%
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Cal Total</span>
              </div>
            </div>
          )}

          {/* Intake Status Pill */}
          <div className="mt-3 flex items-center justify-center">
            <span className={`px-3 py-1 rounded-full text-xs font-mono font-semibold border flex items-center gap-1.5 ${statusBadge.color}`}>
              {calPercent >= 95 && calPercent <= 105 ? (
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
              ) : (
                <Zap className="w-3.5 h-3.5 stroke-[2.5]" />
              )}
              <span>{statusBadge.label}</span>
            </span>
          </div>
        </div>

        {/* Right: Detailed Macro Progress & Wizard Goal Target Benchmarks */}
        <div className="lg:col-span-7 space-y-4">
          {/* Trio of Macronutrient Progress Gauges */}
          <div className="grid grid-cols-3 gap-2.5">
            {/* Protein Card */}
            <div className="reshape-card-subtle p-3 rounded-2xl border border-[var(--border-card)] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-volt-adaptive font-bold">Protein</span>
                <span className="text-[var(--text-muted)]">{proPercent}%</span>
              </div>
              <div className="text-lg font-mono font-bold text-[var(--text-primary)] tabular-nums">
                {currentProtein}g{' '}
                <span className="text-xs font-normal text-[var(--text-muted)]">/ {targetProtein}g</span>
              </div>
              <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
                <div
                  className="bg-[#CEFF00] h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, proPercent)}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                {currentProtein >= targetProtein ? 'Target met!' : `${targetProtein - currentProtein}g left`}
              </div>
            </div>

            {/* Carbohydrates Card */}
            <div className="reshape-card-subtle p-3 rounded-2xl border border-[var(--border-card)] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-sky-400 font-bold">Carbs</span>
                <span className="text-[var(--text-muted)]">{carbPercent}%</span>
              </div>
              <div className="text-lg font-mono font-bold text-[var(--text-primary)] tabular-nums">
                {currentCarbs}g{' '}
                <span className="text-xs font-normal text-[var(--text-muted)]">/ {targetCarbs}g</span>
              </div>
              <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
                <div
                  className="bg-sky-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, carbPercent)}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                {currentCarbs >= targetCarbs ? 'Target met' : `${targetCarbs - currentCarbs}g left`}
              </div>
            </div>

            {/* Fats Card */}
            <div className="reshape-card-subtle p-3 rounded-2xl border border-[var(--border-card)] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-amber-400 font-bold">Fats</span>
                <span className="text-[var(--text-muted)]">{fatPercent}%</span>
              </div>
              <div className="text-lg font-mono font-bold text-[var(--text-primary)] tabular-nums">
                {currentFat}g{' '}
                <span className="text-xs font-normal text-[var(--text-muted)]">/ {targetFat}g</span>
              </div>
              <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
                <div
                  className="bg-amber-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, fatPercent)}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                {currentFat >= targetFat ? 'Floor reached' : `${targetFat - currentFat}g left`}
              </div>
            </div>
          </div>

          {/* Goal Wizard Metabolic Alignment Bar */}
          <div className="p-3.5 rounded-2xl bg-[var(--bg-canvas)] border border-[var(--border-card)] space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-volt-adaptive" />
                <span>Wizard Goal Calibration Benchmarks</span>
              </span>
              <span className="text-[var(--text-secondary)] font-semibold">
                {isCut
                  ? `${Math.abs(goalDeltaKcal)} kcal Deficit Target`
                  : isBulk
                  ? `+${goalDeltaKcal} kcal Surplus Target`
                  : 'Equilibrium Target'}
              </span>
            </div>

            {/* Visual Alignment Spectrum */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                <span>0 kcal</span>
                <span className="text-volt-adaptive font-bold">Target: {targetCalories} kcal</span>
                <span>TDEE: {maintenanceTdee} kcal</span>
              </div>

              {/* Progress bar with target indicator marker */}
              <div className="relative w-full bg-[var(--chip-bg)] h-3 rounded-full overflow-hidden border border-[var(--border-card)]">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 via-[#CEFF00] to-sky-400"
                  style={{
                    width: `${Math.min(100, (currentCalories / Math.max(maintenanceTdee, targetCalories * 1.1)) * 100)}%`
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] pt-0.5">
                <span>Logged: <strong>{currentCalories} kcal</strong></span>
                <span>
                  {currentCalories < targetCalories
                    ? `${targetCalories - currentCalories} kcal under goal`
                    : `${currentCalories - targetCalories} kcal over goal`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
