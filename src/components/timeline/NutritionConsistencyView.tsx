import React, { useState, useMemo } from 'react';
import {
  Target,
  Flame,
  Dumbbell,
  Wheat,
  Droplet,
  Sparkles,
  Info,
  TrendingUp,
  Zap
} from 'lucide-react';
import { DailyNutritionLog, UserProfile } from '../../types';
import { DateRange } from '../../utils/timelineEngine';
import {
  calculateNutritionConsistency,
  NutritionConsistencySummary
} from '../../utils/nutritionConsistencyEngine';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionHeading
} from '../ui';

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
  const getAdherenceTier = (rate: number): { label: string; tone: 'accent' | 'info' | 'warning' | 'danger' } => {
    if (rate >= 85) return { label: 'Elite Consistency', tone: 'accent' };
    if (rate >= 70) return { label: 'High Adherence', tone: 'info' };
    if (rate >= 50) return { label: 'Moderate Adherence', tone: 'warning' };
    return { label: 'Inconsistent Window', tone: 'danger' };
  };

  const tier = getAdherenceTier(adherence.caloriesConsistencyRate);

  return (
    <div className="space-y-6">
      {/* Top Banner & Wizard Target Context */}
      <Card pad="lg" className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-label uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 font-mono">
                <Target className="w-3.5 h-3.5 text-volt-adaptive" />
                <span>Target Compliance Engine</span>
              </span>
              <Badge tone="accent">
                ±10% Tolerance Band
              </Badge>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white mt-1">
              Nutrition Target Consistency
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Evaluates the percentage of recorded days where total calories and macronutrients remained within a ±10% margin of targets established by the Nutrition Goal Wizard.
            </p>
          </div>

          {onOpenWizard && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Sparkles className="w-3.5 h-3.5 text-volt-adaptive" />}
              onClick={onOpenWizard}
            >
              Adjust Wizard Targets
            </Button>
          )}
        </div>

        {/* Active Targets Benchmark Readout */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {/* Calorie Target Band */}
          <div className="p-3.5 rounded-control bg-surface-2 border border-line">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 text-label font-mono uppercase text-zinc-300">
                <Flame className="w-3.5 h-3.5 text-cyan-400" /> Calories
              </span>
              <span className="text-label font-mono text-cyan-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-white mt-1 tabular-nums">
              {targets.calories} <span className="text-xs font-normal text-zinc-500 font-sans">kcal</span>
            </div>
            <div className="text-label font-mono text-zinc-400 mt-1">
              Band: {Math.round(targets.calories * 0.9)} – {Math.round(targets.calories * 1.1)} kcal
            </div>
          </div>

          {/* Protein Target Band */}
          <div className="p-3.5 rounded-control bg-surface-2 border border-line">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 text-label font-mono uppercase text-zinc-300">
                <Dumbbell className="w-3.5 h-3.5 text-volt-adaptive" /> Protein
              </span>
              <span className="text-label font-mono text-volt-adaptive">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-white mt-1 tabular-nums">
              {targets.protein} <span className="text-xs font-normal text-zinc-500 font-sans">g</span>
            </div>
            <div className="text-label font-mono text-zinc-400 mt-1">
              Band: {Math.round(targets.protein * 0.9)} – {Math.round(targets.protein * 1.1)} g
            </div>
          </div>

          {/* Carbs Target Band */}
          <div className="p-3.5 rounded-control bg-surface-2 border border-line">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 text-label font-mono uppercase text-zinc-300">
                <Wheat className="w-3.5 h-3.5 text-amber-400" /> Carbs
              </span>
              <span className="text-label font-mono text-amber-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-white mt-1 tabular-nums">
              {targets.carbs} <span className="text-xs font-normal text-zinc-500 font-sans">g</span>
            </div>
            <div className="text-label font-mono text-zinc-400 mt-1">
              Band: {Math.round(targets.carbs * 0.9)} – {Math.round(targets.carbs * 1.1)} g
            </div>
          </div>

          {/* Fat Target Band */}
          <div className="p-3.5 rounded-control bg-surface-2 border border-line">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 text-label font-mono uppercase text-zinc-300">
                <Droplet className="w-3.5 h-3.5 text-rose-400" /> Fat
              </span>
              <span className="text-label font-mono text-rose-400">±10%</span>
            </div>
            <div className="text-base font-bold font-mono text-white mt-1 tabular-nums">
              {targets.fat} <span className="text-xs font-normal text-zinc-500 font-sans">g</span>
            </div>
            <div className="text-label font-mono text-zinc-400 mt-1">
              Band: {Math.round(targets.fat * 0.9)} – {Math.round(targets.fat * 1.1)} g
            </div>
          </div>
        </div>
      </Card>

      {/* Primary Consistency Score Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Calorie Consistency Hero */}
        <Card pad="md" className="flex flex-col justify-between space-y-3 border-l-4 border-l-accent">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Calorie Target Adherence
            </span>
            <Target className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-white flex items-baseline gap-2 tabular-nums">
              <span>{adherence.caloriesConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-zinc-400">
                ({adherence.caloriesConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={tier.tone}>
                {tier.label}
              </Badge>
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Days within {Math.round(targets.calories * 0.9)} – {Math.round(targets.calories * 1.1)} kcal
          </div>
        </Card>

        {/* Card 2: Protein Target Adherence */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Protein Consistency
            </span>
            <Dumbbell className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-white flex items-baseline gap-2 tabular-nums">
              <span>{adherence.proteinConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-zinc-400">
                ({adherence.proteinConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              Lean Tissue &amp; MPS Threshold
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Days within {Math.round(targets.protein * 0.9)} – {Math.round(targets.protein * 1.1)} g
          </div>
        </Card>

        {/* Card 3: Core Compliance (Cals + Protein) */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Core Target Hit Rate
            </span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-white flex items-baseline gap-2 tabular-nums">
              <span>{adherence.coreConsistencyRate}%</span>
              <span className="text-xs font-mono font-normal text-zinc-400">
                ({adherence.coreConsistentDays}/{coverage.loggedDaysCount} days)
              </span>
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              Both Calories &amp; Protein within ±10%
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Primary body composition drivers
          </div>
        </Card>

        {/* Card 4: Current & Longest Streaks */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Consistency Streaks
            </span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-white flex items-baseline gap-2 tabular-nums">
              <span>{adherence.currentStreakDays}</span>
              <span className="text-xs font-mono font-normal text-zinc-400">days active</span>
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              Best Run: <strong className="text-volt-adaptive">{adherence.longestStreakDays} days</strong>
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Consecutive logged days within ±10%
          </div>
        </Card>
      </div>

      {/* Macronutrient Compliance Matrix */}
      <Card pad="lg" className="space-y-4">
        <SectionHeading
          title="Macro Adherence Rates & Tolerances"
          description={`Logged Coverage: ${coverage.loggedDaysCount} / ${coverage.totalDaysInRange} days (${coverage.coveragePercent}%)`}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 sm:gap-4">
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
              barColor: 'bg-accent'
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
              <div
                key={macro.name}
                className="p-4 rounded-control bg-surface-2 border border-line space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Icon className={`w-4 h-4 ${macro.color}`} /> {macro.name}
                  </span>
                  <span className="text-xs font-mono font-bold text-white tabular-nums">
                    {macro.rate}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-surface-3 rounded-full h-2 overflow-hidden border border-line">
                  <div
                    className={`h-full ${macro.barColor} transition-all duration-300 rounded-full`}
                    style={{ width: `${Math.min(100, Math.max(0, macro.rate))}%` }}
                  />
                </div>

                <div className="space-y-1 text-label font-mono text-zinc-400">
                  <div className="flex justify-between">
                    <span>Target:</span>
                    <span className="text-zinc-200 font-semibold">{macro.target}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>±10% Range:</span>
                    <span className="text-zinc-400">{macro.band}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-line">
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
      </Card>

      {/* Day-by-Day Consistency Breakdown */}
      <Card pad="lg" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Audit Trail
            </span>
            <h3 className="text-base font-bold text-white">
              Daily Recorded Intake vs ±10% Band
            </h3>
          </div>

          {/* Filter Buttons */}
          <div className="flex items-center gap-1 p-1 bg-surface-2 rounded-control border border-line">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'all'
                  ? 'bg-accent text-accent-ink font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              All Days ({coverage.loggedDaysCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('compliant')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'compliant'
                  ? 'bg-accent text-accent-ink font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Within ±10% ({adherence.caloriesConsistentDays})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('non_compliant')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                filterMode === 'non_compliant'
                  ? 'bg-accent text-accent-ink font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Out of Band ({coverage.loggedDaysCount - adherence.caloriesConsistentDays})
            </button>
          </div>
        </div>

        {!hasLoggedDays ? (
          <EmptyState
            icon={<Info className="w-5 h-5 text-zinc-400" />}
            title="No food logs recorded in this period."
            description="Unlogged days are treated as missing observations rather than zero intake. Record daily meals in the Nutrition module to track consistency against your targets."
          />
        ) : displayedDays.length === 0 ? (
          <EmptyState
            icon={<Info className="w-5 h-5 text-zinc-400" />}
            title="No days match the selected filter"
            description={`No days matched the "${filterMode}" filter in this period.`}
          />
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
                  className={`p-4 rounded-control border transition-all ${
                    isCaloriesMet
                      ? 'bg-surface-2/60 border-line hover:border-line-strong'
                      : 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Date and Status Badge */}
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isCaloriesMet ? 'bg-accent' : 'bg-rose-400'
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold font-mono text-white">
                            {day.date}
                          </span>
                          <Badge
                            tone={isCaloriesMet ? 'accent' : 'warning'}
                          >
                            {isCaloriesMet
                              ? 'Within ±10%'
                              : day.calories.status === 'over'
                              ? `Above Target (+${calPercent}%)`
                              : `Below Target (${calPercent}%)`}
                          </Badge>
                        </div>
                        <div className="text-label font-mono text-zinc-400 mt-1">
                          Intake: <strong className="text-white">{day.calories.actual} kcal</strong> / Target{' '}
                          {day.calories.target} kcal ({isPositive ? '+' : ''}{calDelta} kcal)
                        </div>
                      </div>
                    </div>

                    {/* Macro status chips */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Protein Chip */}
                      <span
                        className={`px-2.5 py-1 rounded-control text-xs font-mono flex items-center gap-1.5 border ${
                          day.isProteinConsistent
                            ? 'bg-accent/10 text-volt-adaptive border-accent/30 font-semibold'
                            : 'bg-surface-3 text-zinc-400 border-line'
                        }`}
                        title={`Protein: ${day.protein.actual}g (Target: ${day.protein.target}g, delta: ${day.protein.delta}g)`}
                      >
                        <Dumbbell className="w-3 h-3" />
                        <span>P: {day.protein.actual}g</span>
                        <span className="text-[10px] opacity-80">
                          ({day.protein.percentDelta > 0 ? '+' : ''}{day.protein.percentDelta}%)
                        </span>
                      </span>

                      {/* Carbs Chip */}
                      <span
                        className={`px-2.5 py-1 rounded-control text-xs font-mono flex items-center gap-1.5 border ${
                          day.isCarbsConsistent
                            ? 'bg-amber-400/10 text-amber-400 border-amber-400/30 font-semibold'
                            : 'bg-surface-3 text-zinc-400 border-line'
                        }`}
                        title={`Carbs: ${day.carbs.actual}g (Target: ${day.carbs.target}g, delta: ${day.carbs.delta}g)`}
                      >
                        <Wheat className="w-3 h-3" />
                        <span>C: {day.carbs.actual}g</span>
                        <span className="text-[10px] opacity-80">
                          ({day.carbs.percentDelta > 0 ? '+' : ''}{day.carbs.percentDelta}%)
                        </span>
                      </span>

                      {/* Fat Chip */}
                      <span
                        className={`px-2.5 py-1 rounded-control text-xs font-mono flex items-center gap-1.5 border ${
                          day.isFatConsistent
                            ? 'bg-rose-400/10 text-rose-400 border-rose-400/30 font-semibold'
                            : 'bg-surface-3 text-zinc-400 border-line'
                        }`}
                        title={`Fat: ${day.fat.actual}g (Target: ${day.fat.target}g, delta: ${day.fat.delta}g)`}
                      >
                        <Droplet className="w-3 h-3" />
                        <span>F: {day.fat.actual}g</span>
                        <span className="text-[10px] opacity-80">
                          ({day.fat.percentDelta > 0 ? '+' : ''}{day.fat.percentDelta}%)
                        </span>
                      </span>

                      {/* Toggle Details */}
                      <button
                        type="button"
                        onClick={() => setExpandedDate(isExpanded ? null : day.date)}
                        className="px-2.5 py-1 text-xs font-mono text-zinc-300 hover:text-white rounded-control border border-line bg-surface-3 transition-colors"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Macro Breakdown Drawer */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-control bg-surface-3 border border-line">
                        <div className="text-label text-zinc-400">Calories</div>
                        <div className="text-white font-bold">
                          {day.calories.actual} / {day.calories.target} kcal
                        </div>
                        <div className="text-label text-zinc-500">
                          Band: {day.calories.lowerBound} – {day.calories.upperBound}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-control bg-surface-3 border border-line">
                        <div className="text-label text-zinc-400">Protein</div>
                        <div className="text-white font-bold">
                          {day.protein.actual} / {day.protein.target} g
                        </div>
                        <div className="text-label text-zinc-500">
                          Band: {day.protein.lowerBound} – {day.protein.upperBound}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-control bg-surface-3 border border-line">
                        <div className="text-label text-zinc-400">Carbs</div>
                        <div className="text-white font-bold">
                          {day.carbs.actual} / {day.carbs.target} g
                        </div>
                        <div className="text-label text-zinc-500">
                          Band: {day.carbs.lowerBound} – {day.carbs.upperBound}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-control bg-surface-3 border border-line">
                        <div className="text-label text-zinc-400">Fat</div>
                        <div className="text-white font-bold">
                          {day.fat.actual} / {day.fat.target} g
                        </div>
                        <div className="text-label text-zinc-500">
                          Band: {day.fat.lowerBound} – {day.fat.upperBound}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
