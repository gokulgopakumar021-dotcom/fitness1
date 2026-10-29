import React, { useState } from 'react';
import { CheckCircle2, Sliders, Target } from 'lucide-react';
import { UserProfile } from '../../types';
import { calculateDetailedTDEE } from '../../utils/tdeeEngine';
import { Badge, Button, Card, SegmentedControl } from '../ui';
import { MACRO_META, MacroBar, percentOf } from './MacroBar';

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

type GaugeMode = 'radial' | 'macro_rings';

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
  const [gaugeMode, setGaugeMode] = useState<GaugeMode>('radial');

  // Derive goal parameters
  const goal = profile.primaryGoal;
  const isCut = goal === 'fat_loss';
  const isBulk = goal === 'muscle_gain';

  // Calculate maintenance baseline using the athlete's biometrics and body fat %
  const detailedTdee = calculateDetailedTDEE({
    weightKg: profile.currentWeightKg || 78,
    heightCm: profile.heightCm || 178,
    age: profile.age || 26,
    sex: profile.sex, // no silent 'male' default: a missing sex uses the same neutral estimate as every other path
    activityLevel: 'moderate',
    bodyFatPercentage: profile.bodyFatPercentage
  });

  const maintenanceTdee = detailedTdee.dailyTdee;
  const goalDeltaKcal = targetCalories - maintenanceTdee;

  const hasCalTarget = targetCalories > 0;
  const calPercent = percentOf(currentCalories, targetCalories);
  const calDelta = currentCalories - targetCalories;
  const calRemaining = targetCalories - currentCalories;
  const isOver = hasCalTarget && calPercent > 105;
  const isAligned = hasCalTarget && currentCalories > 0 && calPercent >= 95 && calPercent <= 105;

  // Semicircle gauge geometry (radius 78, arc length = PI * r)
  const arcRadius = 78;
  const arcLength = Math.PI * arcRadius;
  const arcRatio = hasCalTarget ? Math.min(1, Math.max(0, currentCalories / targetCalories)) : 0;
  const arcOffset = arcLength * (1 - arcRatio);
  const arcColor = isOver ? 'var(--warning)' : 'var(--chart-1)';

  // Intake status (only shown when it says something the numbers do not already say)
  let status: { label: string; tone: 'success' | 'warning' | 'info'; description: string } | null = null;
  if (isAligned) {
    status = {
      label: 'On target',
      tone: 'success',
      description: 'Intake is within ±5% of your daily calorie target.'
    };
  } else if (isOver) {
    status = isBulk
      ? { label: 'Above bulk target', tone: 'info', description: `${calDelta} kcal above your bulk target.` }
      : isCut
      ? { label: 'Over target', tone: 'warning', description: `${calDelta} kcal over target, so the deficit is narrowing.` }
      : { label: 'Above maintenance target', tone: 'warning', description: `${calDelta} kcal above your target.` };
  }

  // Concentric ring geometry for Macro Rings mode (protein outer, carbs middle, fat inner)
  const ringCenter = 90;
  const rings = [
    { key: 'protein' as const, r: 70, current: currentProtein, target: targetProtein },
    { key: 'carbs' as const, r: 52, current: currentCarbs, target: targetCarbs },
    { key: 'fat' as const, r: 34, current: currentFat, target: targetFat }
  ].map((ring) => {
    const circumference = 2 * Math.PI * ring.r;
    const ratio = ring.target > 0 ? Math.min(1, Math.max(0, ring.current / ring.target)) : 0;
    return { ...ring, circumference, offset: circumference * (1 - ratio) };
  });

  const goalLabel = isCut ? 'Cut · Deficit' : isBulk ? 'Bulk · Surplus' : 'Maintain · Balance';
  const benchmarkLabel = isCut
    ? `${Math.abs(goalDeltaKcal)} kcal deficit target`
    : isBulk
    ? `+${goalDeltaKcal} kcal surplus target`
    : 'Balanced target';

  const readout = (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold font-mono text-white tabular-nums leading-none">{currentCalories}</span>
        <span className="text-xs font-mono text-zinc-500">/ {targetCalories}</span>
      </div>
      <span className="text-label text-zinc-500 mt-1">kcal</span>
    </div>
  );

  return (
    <Card pad="lg" as="section" aria-label="Daily calorie and macro summary" data-testid="nutrition-summary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-control bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <Target className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white tracking-tight">Daily intake</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <Badge tone="accent">{goalLabel}</Badge>
              {typeof profile.bodyFatPercentage === 'number' && profile.bodyFatPercentage > 0 && (
                <Badge tone="neutral">{profile.bodyFatPercentage}% BF</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl<GaugeMode>
            ariaLabel="Gauge view"
            value={gaugeMode}
            onChange={setGaugeMode}
            options={[
              { value: 'radial', label: 'Calorie Dial' },
              { value: 'macro_rings', label: 'Macro Rings' }
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenWizard}
            title="Calibrate Targets with Nutrition Goal Wizard"
            icon={<Sliders className="w-3.5 h-3.5" aria-hidden />}
          >
            Recalibrate
          </Button>
        </div>
      </div>

      {/* Gauge + macros */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center mt-5">
        <div className="lg:col-span-5 flex flex-col items-center gap-3">
          {gaugeMode === 'radial' ? (
            <div className="relative w-full max-w-[16rem] aspect-[200/115] select-none">
              <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible" role="img" aria-label={`${calPercent}% of calorie target logged`}>
                <path
                  d="M 22 100 A 78 78 0 0 1 178 100"
                  fill="none"
                  stroke="var(--bg-surface-3)"
                  strokeWidth="14"
                  strokeLinecap="round"
                />
                {arcRatio > 0 && (
                  <path
                    d="M 22 100 A 78 78 0 0 1 178 100"
                    fill="none"
                    stroke={arcColor}
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeDasharray={arcLength}
                    strokeDashoffset={arcOffset}
                    className="transition-[stroke-dashoffset] duration-500 ease-out"
                  />
                )}
              </svg>
              <div className="absolute inset-x-0 bottom-0 flex justify-center">{readout}</div>
            </div>
          ) : (
            <div className="relative w-52 h-52 select-none">
              <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90 overflow-visible" role="img" aria-label="Protein, carbs and fat progress rings">
                {rings.map((ring) => (
                  <circle key={`track-${ring.key}`} cx={ringCenter} cy={ringCenter} r={ring.r} fill="none" stroke="var(--bg-surface-3)" strokeWidth="10" />
                ))}
                {rings.map(
                  (ring) =>
                    ring.circumference - ring.offset > 0.5 && (
                      <circle
                        key={ring.key}
                        cx={ringCenter}
                        cy={ringCenter}
                        r={ring.r}
                        fill="none"
                        stroke={MACRO_META[ring.key].color}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={ring.circumference}
                        strokeDashoffset={ring.offset}
                        className="transition-[stroke-dashoffset] duration-500 ease-out"
                      />
                    )
                )}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">{readout}</div>
            </div>
          )}

          {/* One remaining/over line: the single place this number is stated */}
          <p className="text-sm font-medium text-zinc-300 tabular-nums" data-testid="calories-remaining">
            {!hasCalTarget
              ? 'No calorie target set'
              : calRemaining >= 0
              ? `${calRemaining} kcal left`
              : `${Math.abs(calRemaining)} kcal over`}
            {hasCalTarget && <span className="text-zinc-500 font-normal"> · {calPercent}% of target</span>}
          </p>

          {status && (
            <div className="text-center space-y-1">
              <Badge tone={status.tone} icon={status.tone === 'success' ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : undefined}>
                {status.label}
              </Badge>
              <p className="text-label text-zinc-500">{status.description}</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <MacroBar macro="protein" current={currentProtein} target={targetProtein} />
            <MacroBar macro="carbs" current={currentCarbs} target={targetCarbs} />
            <MacroBar macro="fat" current={currentFat} target={targetFat} />
          </div>

          {/* Target vs maintenance (from the same TDEE engine as the wizard) */}
          <div className="rounded-control bg-surface-2 border border-line p-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">{benchmarkLabel}</span>
            <span className="font-mono tabular-nums">
              Target: {targetCalories} kcal · TDEE: {maintenanceTdee} kcal
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};
