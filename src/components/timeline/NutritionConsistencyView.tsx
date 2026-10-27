import React, { useState, useMemo } from 'react';
import {
  Target,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
  Dumbbell,
  Wheat,
  Droplet,
  Calendar,
  Sparkles,
  Info,
  Filter,
  ShieldCheck,
  TrendingUp,
  Zap
} from 'lucide-react';
import { DailyNutritionLog, UserProfile } from '../../types';
import { DateRange } from '../../utils/timelineEngine';
import {
  calculateNutritionConsistency,
  NutritionConsistencySummary,
  DayNutritionConsistency
} from '../../utils/nutritionConsistencyEngine';

interface NutritionConsistencyViewProps {
  logs: DailyNutritionLog[];
  profile: UserProfile;
  dateRange: DateRange;
  onOpenWizard?: () => void;
}

type DailyFilterOption = 'all' | 'compliant' | 'non_compliant';

export const NutritionConsistencyView: React.FC<NutritionConsistencyViewProps> = ({
  logs,
  profile,
  dateRange,
  onOpenWizard
}) => {
  const [filterMode, setFilterMode] = useState<DailyFilterOption>('all');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const summary: NutritionConsistencySummary = useMemo(() => {
    return calculateNutritionConsistency(logs, profile, dateRange);
  }, [logs, profile, dateRange]);

  const { adherence, coverage, targets, dailyRecords } = summary;

  // Filter daily records for display: only logged days or matching filter
  const displayedDays = useMemo(() => {
    return dailyRecords.filter((day) => {
      if (!day.isLogged) return false;
      if (filterMode === 'compliant') return day.isCaloriesConsistent;
      if (filterMode === 'non_compliant') return !day.isCaloriesConsistent;
      return true;
    });
  }, [dailyRecords, filterMode]);

  const hasLoggedDays = coverage.loggedDaysCount > 0;

  // Rating badge based on calorie consistency
  const getAdherenceTier = (rate: number) => {
    if (rate >= 85) return { label: 'Elite Consistency', color: 'text-volt-adaptive', bg: 'bg-[#CEFF00]/10 border-[#CEFF00]/30' };
    if (rate >= 70) return { label: 'High Adherence', color: 'text-cyan-400', bg: 'bg-cyan-400/10 border-cyan-400/30' };
    if (rate >= 50) return { label: 'Moderate Adherence', color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' };
    return { label: 'Inconsistent Window', color: 'text-rose-400', bg: 'bg-rose-400/10 border-rose-400/30' };
  };

  const tier = getAdherenceTier(adherence.caloriesConsistencyRate);

  return (
    <div className="space-y-6">
      {/* Top Banner & Wizard Target Context */}
      <div className="reshape-card p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--border-card)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-volt-adaptive" />
                <span>Target Compliance Engine</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-volt-adaptive/10 text-volt-adaptive border border-volt-adaptive/30 font-bold">
                ±10% Tolerance Band
              </span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)] mt-1">
              Nutrition Target Consistency
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Evaluates the percentage of recorded days where total calories and macronutrients remained within a ±10% margin of targets established by the Nutrition Goal Wizard.
            </p>
          </div>

          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-bold rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-volt-adaptive transition-colors shrink-0 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5 text-volt-adaptive" />
              <span>Adjust Wizard Targets</span>
            </button>
          )}
        </div>

        {/* Active Targets Benchmark Readout */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {/* Calorie Target Band */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1 text-[11px] font-mono uppercase">
                <Flame className="w-3.5 h-3.5 text-cyan-400" /> Calories
              </span>
              <span className="text-[10px] font-mono text-cyan-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-[var(--text-primary)] mt-1">
              {targets.calories} <span className="text-[11px] font-normal text-[var(--text-muted)]">kcal</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
              Band: {Math.round(targets.calories * 0.9)} – {Math.round(targets.calories * 1.1)} kcal
            </div>
          </div>

          {/* Protein Target Band */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1 text-[11px] font-mono uppercase">
                <Dumbbell className="w-3.5 h-3.5 text-volt-adaptive" /> Protein
              </span>
              <span className="text-[10px] font-mono text-volt-adaptive">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-[var(--text-primary)] mt-1">
              {targets.protein} <span className="text-[11px] font-normal text-[var(--text-muted)]">g</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
              Band: {Math.round(targets.protein * 0.9)} – {Math.round(targets.protein * 1.1)} g
            </div>
          </div>

          {/* Carbs Target Band */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1 text-[11px] font-mono uppercase">
                <Wheat className="w-3.5 h-3.5 text-amber-400" /> Carbs
              </span>
              <span className="text-[10px] font-mono text-amber-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-[var(--text-primary)] mt-1">
              {targets.carbs} <span className="text-[11px] font-normal text-[var(--text-muted)]">g</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
              Band: {Math.round(targets.carbs * 0.9)} – {Math.round(targets.carbs * 1.1)} g
            </div>
          </div>

          {/* Fat Target Band */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1 text-[11px] font-mono uppercase">
                <Droplet className="w-3.5 h-3.5 text-rose-400" /> Fat
              </span>
              <span className="text-[10px] font-mono text-rose-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-[var(--text-primary)] mt-1">
              {targets.fat} <span className="text-[11px] font-normal text-[var(--text-muted)]">g</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
              Band: {Math.round(targets.fat * 0.9)} – {Math.round(targets.fat * 1.1)} g
            </div>
          </div>
        </div>
      </div>

      {/* Primary Consistency Score Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Calorie Consistency Hero */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3 border-l-4 border-[#CEFF00]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Calorie Target Adherence
            </span>
            <Target className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)] flex items-baseline gap-2">
              <span>{adherence.caloriesConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-[var(--text-muted)]">
                ({adherence.caloriesConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${tier.bg} ${tier.color}`}>
                {tier.label}
              </span>
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Days within {Math.round(targets.calories * 0.9)} – {Math.round(targets.calories * 1.1)} kcal
          </div>
        </div>

        {/* Card 2: Protein Target Adherence */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Protein Consistency
            </span>
            <Dumbbell className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)] flex items-baseline gap-2">
              <span>{adherence.proteinConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-[var(--text-muted)]">
                ({adherence.proteinConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)] mt-1">
              Lean Tissue & MPS Threshold
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Days within {Math.round(targets.protein * 0.9)} – {Math.round(targets.protein * 1.1)} g
          </div>
        </div>

        {/* Card 3: Core Compliance (Cals + Protein) */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Core Target Hit Rate
            </span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)] flex items-baseline gap-2">
              <span>{adherence.coreConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-[var(--text-muted)]">
                ({adherence.coreConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)] mt-1">
              Both Calories & Protein within ±10%
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Primary body composition drivers
          </div>
        </div>

        {/* Card 4: Current & Longest Streaks */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Consistency Streaks
            </span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)] flex items-baseline gap-2">
              <span>{adherence.currentStreakDays}</span>
              <span className="text-xs font-mono font-normal text-[var(--text-muted)]">days active</span>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)] mt-1">
              Best Run: <strong className="text-volt-adaptive">{adherence.longestStreakDays} days</strong>
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Consecutive logged days within ±10%
          </div>
        </div>
      </div>

      {/* Macronutrient Compliance Matrix */}
      <div className="reshape-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-card)] pb-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Detailed Breakdown
            </span>
            <h3 className="text-base font-bold text-[var(--text-primary)]">
              Macro Adherence Rates & Tolerances
            </h3>
          </div>
          <div className="text-xs font-mono text-[var(--text-muted)]">
            Logged Coverage:{' '}
            <strong className="text-volt-adaptive">
              {coverage.loggedDaysCount} / {coverage.totalDaysInRange} days ({coverage.coveragePercent}%)
            </strong>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            {
              name: 'Calories',
              icon: Flame,
              color: 'text-cyan-400',
              rate: adherence.caloriesConsistencyRate,
              consistentDays: adherence.caloriesConsistentDays,
              target: `${targets.calories} kcal`,
              band: `${Math.round(targets.calories * 0.9)} – ${Math.round(targets.calories * 1.1)} kcal`,
              barColor: 'bg-cyan-400'
            },
            {
              name: 'Protein',
              icon: Dumbbell,
              color: 'text-volt-adaptive',
              rate: adherence.proteinConsistencyRate,
              consistentDays: adherence.proteinConsistentDays,
              target: `${targets.protein} g`,
              band: `${Math.round(targets.protein * 0.9)} – ${Math.round(targets.protein * 1.1)} g`,
              barColor: 'bg-[#CEFF00]'
            },
            {
              name: 'Carbohydrates',
              icon: Wheat,
              color: 'text-amber-400',
              rate: adherence.carbsConsistencyRate,
              consistentDays: adherence.carbsConsistentDays,
              target: `${targets.carbs} g`,
              band: `${Math.round(targets.carbs * 0.9)} – ${Math.round(targets.carbs * 1.1)} g`,
              barColor: 'bg-amber-400'
            },
            {
              name: 'Fats',
              icon: Droplet,
              color: 'text-rose-400',
              rate: adherence.fatConsistencyRate,
              consistentDays: adherence.fatConsistentDays,
              target: `${targets.fat} g`,
              band: `${Math.round(targets.fat * 0.9)} – ${Math.round(targets.fat * 1.1)} g`,
              barColor: 'bg-rose-400'
            }
          ].map((macro) => {
            const Icon = macro.icon;
            return (
              <div key={macro.name} className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                    <Icon className={`w-4 h-4 ${macro.color}`} /> {macro.name}
                  </span>
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {macro.rate}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-[var(--bg-canvas)] rounded-full h-2 overflow-hidden border border-[var(--border-card)]">
                  <div
                    className={`h-full ${macro.barColor} transition-all duration-300 rounded-full`}
                    style={{ width: `${Math.min(100, Math.max(0, macro.rate))}%` }}
                  />
                </div>

                <div className="space-y-1 text-[11px] font-mono text-[var(--text-muted)]">
                  <div className="flex justify-between">
                    <span>Target:</span>
                    <span className="text-[var(--text-primary)] font-semibold">{macro.target}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>±10% Range:</span>
                    <span className="text-[var(--text-secondary)]">{macro.band}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-[var(--border-card)]">
                    <span>Met Target:</span>
                    <span className="text-volt-adaptive font-bold">
                      {macro.consistentDays} of {coverage.loggedDaysCount} days
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day-by-Day Consistency Breakdown */}
      <div className="reshape-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Audit Trail
            </span>
            <h3 className="text-base font-bold text-[var(--text-primary)]">
              Daily Recorded Intake vs ±10% Band
            </h3>
          </div>

          {/* Filter Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-[var(--chip-bg)] rounded-xl border border-[var(--border-card)]">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'all'
                  ? 'bg-[#CEFF00] text-black font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              All Days ({coverage.loggedDaysCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('compliant')}
              className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'compliant'
                  ? 'bg-[#CEFF00] text-black font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Within ±10% ({adherence.caloriesConsistentDays})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('non_compliant')}
              className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'non_compliant'
                  ? 'bg-[#CEFF00] text-black font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Out of Band ({coverage.loggedDaysCount - adherence.caloriesConsistentDays})
            </button>
          </div>
        </div>

        {!hasLoggedDays ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle space-y-2">
            <Info className="w-6 h-6 text-volt-adaptive mx-auto opacity-80" />
            <p className="font-semibold text-[var(--text-secondary)]">No food logs recorded in this period.</p>
            <p className="text-[11px] max-w-sm mx-auto">
              Unlogged days are treated as missing observations rather than zero intake. Record daily meals in the Nutrition module to track consistency against your targets.
            </p>
          </div>
        ) : displayedDays.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
            No days match the selected "{filterMode}" filter.
          </div>
        ) : (
          <div className="space-y-3">
            {displayedDays.map((day) => {
              const isCaloriesMet = day.isCaloriesConsistent;
              const isExpanded = expandedDate === day.date;
              const calDelta = day.calories.delta;
              const calPercent = day.calories.percentDelta;
              const isPositive = calDelta > 0;

              return (
                <div
                  key={day.date}
                  className={`p-4 rounded-xl border transition-all ${
                    isCaloriesMet
                      ? 'bg-[var(--chip-bg)]/30 border-[var(--border-card)] hover:border-volt-adaptive/40'
                      : 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Date and Status Badge */}
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                        backgroundColor: isCaloriesMet ? '#CEFF00' : '#fb7185'
                      }} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold font-mono text-[var(--text-primary)]">
                            {day.date}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                              isCaloriesMet
                                ? 'bg-[#CEFF00]/10 text-volt-adaptive border-[#CEFF00]/30'
                                : day.calories.status === 'over'
                                ? 'bg-amber-400/10 text-amber-400 border-amber-400/30'
                                : 'bg-sky-400/10 text-sky-400 border-sky-400/30'
                            }`}
                          >
                            {isCaloriesMet
                              ? 'Within ±10%'
                              : day.calories.status === 'over'
                              ? `Above Target (+${calPercent}%)`
                              : `Below Target (${calPercent}%)`}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                          Intake: <strong className="text-[var(--text-primary)]">{day.calories.actual} kcal</strong> / Target {day.calories.target} kcal
                          {' '}({isPositive ? '+' : ''}{calDelta} kcal)
                        </div>
                      </div>
                    </div>

                    {/* Macro status chips */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Protein Chip */}
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 border ${
                          day.isProteinConsistent
                            ? 'bg-volt-adaptive/10 text-volt-adaptive border-volt-adaptive/30 font-semibold'
                            : 'bg-[var(--bg-canvas)] text-[var(--text-muted)] border-[var(--border-card)]'
                        }`}
                        title={`Protein: ${day.protein.actual}g (Target: ${day.protein.target}g, delta: ${day.protein.delta}g)`}
                      >
                        <Dumbbell className="w-3 h-3" />
                        <span>P: {day.protein.actual}g</span>
                        <span className="text-[10px] opacity-80">({day.protein.percentDelta > 0 ? '+' : ''}{day.protein.percentDelta}%)</span>
                      </span>

                      {/* Carbs Chip */}
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 border ${
                          day.isCarbsConsistent
                            ? 'bg-amber-400/10 text-amber-400 border-amber-400/30 font-semibold'
                            : 'bg-[var(--bg-canvas)] text-[var(--text-muted)] border-[var(--border-card)]'
                        }`}
                        title={`Carbs: ${day.carbs.actual}g (Target: ${day.carbs.target}g, delta: ${day.carbs.delta}g)`}
                      >
                        <Wheat className="w-3 h-3" />
                        <span>C: {day.carbs.actual}g</span>
                        <span className="text-[10px] opacity-80">({day.carbs.percentDelta > 0 ? '+' : ''}{day.carbs.percentDelta}%)</span>
                      </span>

                      {/* Fat Chip */}
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 border ${
                          day.isFatConsistent
                            ? 'bg-rose-400/10 text-rose-400 border-rose-400/30 font-semibold'
                            : 'bg-[var(--bg-canvas)] text-[var(--text-muted)] border-[var(--border-card)]'
                        }`}
                        title={`Fat: ${day.fat.actual}g (Target: ${day.fat.target}g, delta: ${day.fat.delta}g)`}
                      >
                        <Droplet className="w-3 h-3" />
                        <span>F: {day.fat.actual}g</span>
                        <span className="text-[10px] opacity-80">({day.fat.percentDelta > 0 ? '+' : ''}{day.fat.percentDelta}%)</span>
                      </span>

                      {/* Toggle Details */}
                      <button
                        type="button"
                        onClick={() => setExpandedDate(isExpanded ? null : day.date)}
                        className="px-2 py-1 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded border border-[var(--border-card)] bg-[var(--bg-canvas)]"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Macro Breakdown Drawer */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-card)] grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                        <div className="text-[10px] text-[var(--text-muted)]">Calories</div>
                        <div className="text-[var(--text-primary)] font-bold">{day.calories.actual} / {day.calories.target} kcal</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Band: {day.calories.lowerBound} – {day.calories.upperBound}</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                        <div className="text-[10px] text-[var(--text-muted)]">Protein</div>
                        <div className="text-[var(--text-primary)] font-bold">{day.protein.actual} / {day.protein.target} g</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Band: {day.protein.lowerBound} – {day.protein.upperBound}</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                        <div className="text-[10px] text-[var(--text-muted)]">Carbs</div>
                        <div className="text-[var(--text-primary)] font-bold">{day.carbs.actual} / {day.carbs.target} g</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Band: {day.carbs.lowerBound} – {day.carbs.upperBound}</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                        <div className="text-[10px] text-[var(--text-muted)]">Fat</div>
                        <div className="text-[var(--text-primary)] font-bold">{day.fat.actual} / {day.fat.target} g</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Band: {day.fat.lowerBound} – {day.fat.upperBound}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
