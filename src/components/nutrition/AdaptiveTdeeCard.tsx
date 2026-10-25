import React, { useState } from 'react';
import { BodyMetricEntry, DailyNutritionLog, DynamicExpenditureEstimate, UserProfile } from '../../types';
import { calculateAdaptiveExpenditure } from '../../utils/tdeeEngine';
import { db } from '../../storage/db';

interface AdaptiveTdeeCardProps {
  profile: UserProfile;
  nutritionLogs: DailyNutritionLog[];
  bodyMetrics: BodyMetricEntry[];
  onProfileUpdated?: (updated: UserProfile) => void;
}

export const AdaptiveTdeeCard: React.FC<AdaptiveTdeeCardProps> = ({
  profile,
  nutritionLogs,
  bodyMetrics,
  onProfileUpdated
}) => {
  const [justApplied, setJustApplied] = useState(false);
  const estimate: DynamicExpenditureEstimate = calculateAdaptiveExpenditure(nutritionLogs, bodyMetrics, profile);

  const handleApplyRecommendations = () => {
    const updated: UserProfile = {
      ...profile,
      dailyCalorieTarget: estimate.recommendedCalories,
      dailyProteinTarget: estimate.recommendedProtein,
      dailyCarbsTarget: estimate.recommendedCarbs,
      dailyFatTarget: estimate.recommendedFat
    };

    db.saveProfile(updated);
    if (onProfileUpdated) {
      onProfileUpdated(updated);
    }
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 3000);
  };

  const getAdaptationBadge = (status: string) => {
    if (status === 'accelerated') {
      return { text: 'Elevated Metabolism (Hyper-Adaptive)', color: 'text-volt-adaptive bg-[#CEFF00]/10 border-[#CEFF00]/30' };
    }
    if (status === 'downregulated') {
      return { text: 'Adaptive Thermogenesis (Downregulated)', color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' };
    }
    return { text: 'Metabolically Stable', color: 'text-zinc-400 bg-zinc-800 border-zinc-700' };
  };

  const badge = getAdaptationBadge(estimate.adaptationStatus);

  return (
    <div className="reshape-card p-5 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-4">
        <div>
          <div className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] flex items-center gap-1.5">
            <span>MacroFactor Energy Engine</span>
            <span aria-hidden="true">·</span>
            <span className="text-volt-adaptive font-semibold">Dynamic Expenditure</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Adaptive TDEE & Macro Coach
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold border ${badge.color}`}>
            {badge.text}
          </span>
        </div>
      </div>

      {/* Main Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Dynamic Expenditure Dial */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Dynamic Daily Burn (TDEE)
            </span>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {estimate.confidence.toUpperCase()} CONFIDENCE
            </span>
          </div>

          <div className="my-2">
            <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)] flex items-baseline gap-1.5">
              <span>{estimate.currentTdee.toLocaleString()}</span>
              <span className="text-sm font-semibold text-[var(--text-muted)]">kcal / day</span>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
              <span>Baseline Formula: {estimate.staticTdee} kcal</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className={estimate.difference >= 0 ? 'text-volt-adaptive font-bold' : 'text-amber-400 font-bold'}>
                {estimate.difference >= 0 ? `+${estimate.difference}` : estimate.difference} kcal
              </span>
            </div>
          </div>

          <div className="text-[10px] text-[var(--text-muted)] font-mono pt-2 border-t border-[var(--border-card)]">
            Sampled over {estimate.daysSampled} days of scale weight & intake logs
          </div>
        </div>

        {/* Energy Balance Physics */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Rolling Energy Intake & Scale Shift
            </span>
          </div>

          <div className="space-y-2 my-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-muted)]">Average Daily Intake:</span>
              <span className="font-bold text-[var(--text-primary)]">{estimate.avgDailyIntake} kcal</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-muted)]">Period Weight Shift:</span>
              <span className="font-bold text-[var(--text-primary)]">
                {estimate.rollingWeightDeltaKg > 0 ? `+${estimate.rollingWeightDeltaKg}` : estimate.rollingWeightDeltaKg} kg
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-muted)]">Basal Rate (BMR):</span>
              <span className="font-bold text-[var(--text-primary)]">{estimate.staticBmr} kcal</span>
            </div>
          </div>

          <div className="text-[10px] text-[var(--text-muted)] font-mono pt-2 border-t border-[var(--border-card)]">
            7,700 kcal energy equivalent per 1 kg tissue flux
          </div>
        </div>

        {/* Recommended Calibrated Targets */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Calibrated Goal Target
            </span>
            <span className="text-[10px] font-mono text-volt-adaptive font-bold uppercase">
              {profile.primaryGoal.replace('_', ' ')}
            </span>
          </div>

          <div className="my-1">
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
              {estimate.recommendedCalories} <span className="text-xs text-[var(--text-muted)] font-normal">kcal</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-2 text-center text-xs font-mono">
              <div className="p-1 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                <span className="text-[10px] text-cyan-400 block font-bold">PRO</span>
                <span className="font-bold text-[var(--text-primary)]">{estimate.recommendedProtein}g</span>
              </div>
              <div className="p-1 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                <span className="text-[10px] text-amber-400 block font-bold">CARB</span>
                <span className="font-bold text-[var(--text-primary)]">{estimate.recommendedCarbs}g</span>
              </div>
              <div className="p-1 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                <span className="text-[10px] text-rose-400 block font-bold">FAT</span>
                <span className="font-bold text-[var(--text-primary)]">{estimate.recommendedFat}g</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleApplyRecommendations}
            className={`w-full mt-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              justApplied
                ? 'bg-emerald-500 text-black'
                : 'bg-[#CEFF00] hover:bg-[#b8e600] text-black'
            }`}
          >
            {justApplied ? '✓ Calibrated Targets Applied' : 'Apply Calibrated Targets'}
          </button>
        </div>
      </div>

      {/* Scientific Rationale Callout */}
      <div className="reshape-card-subtle p-4 text-xs leading-relaxed text-[var(--text-secondary)] border-l-2 border-[#CEFF00]">
        <strong className="text-[var(--text-primary)]">Scientific Energy Flux Audit: </strong>
        {estimate.rationale}
      </div>
    </div>
  );
};
