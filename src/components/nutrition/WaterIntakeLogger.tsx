import React, { useState, useEffect, useRef } from 'react';
import { Droplets, Minus, RotateCcw, Info, ArrowRight } from 'lucide-react';
import { UserProfile } from '../../types';
import { db } from '../../storage/db';
import { calculateHydrationGoal, HydrationGoalResult } from '../../utils/calculations';
import { calculateHydrationStreak } from '../../utils/hydrationStreak';
import { HydrationHistoryChart } from './HydrationHistoryChart';
import { HydrationPacingAlert } from './HydrationPacingAlert';
import { WeeklyStreakBadge } from './WeeklyStreakBadge';
import { HydrationCelebrationModal } from './HydrationCelebrationModal';
import { QuickAddPresetBar } from './QuickAddPresetBar';
import { Badge, Button, Card, Input, ProgressBar, SegmentedControl } from '../ui';

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

  // Hydration status: factual progress wording only
  const status: { label: string; tone: 'neutral' | 'info' | 'success' } =
    currentMl === 0
      ? { label: 'Not started', tone: 'neutral' }
      : isGoalAchieved
      ? { label: 'Target reached', tone: 'success' }
      : progressPercent >= 75
      ? { label: 'Almost there', tone: 'info' }
      : { label: 'In progress', tone: 'info' };

  const goalText = unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`;
  const overText = unit === 'oz' ? `${currentOz - goalOz} fl oz` : `${(currentMl - goalMl).toLocaleString()} ml`;
  const remainingText = unit === 'oz' ? `${remainingOz} fl oz` : `${remainingMl.toLocaleString()} ml`;

  return (
    <Card pad="lg" as="section" aria-label="Hydration" className="space-y-5">
      {/* Header: title, goal, unit switch, reset */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-control bg-info/10 border border-info/30 flex items-center justify-center text-info shrink-0">
            <Droplets className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white tracking-tight">Hydration</h2>
            <p className="text-label font-mono text-zinc-500 tabular-nums mt-0.5">
              {unit === 'oz'
                ? `Goal: ${goalOz} fl oz (${goalMl.toLocaleString()} ml)`
                : `Goal: ${goalMl.toLocaleString()} ml (${goalOz} fl oz)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl<WaterUnit>
            ariaLabel="Display unit"
            value={unit}
            onChange={handleUnitChange}
            options={[
              { value: 'oz', label: 'fl oz' },
              { value: 'ml', label: 'ml' }
            ]}
          />
          {currentMl > 0 && (
            <Button
              variant="ghost"
              iconOnly
              onClick={handleReset}
              title="Reset today's water intake to 0"
              aria-label="Reset logged water to 0"
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {/* Weekly streak (existing component) */}
      <WeeklyStreakBadge
        streak={streakResult}
        onTriggerCelebration={() => setShowCelebration(true)}
        isTodayGoalAchieved={isGoalAchieved}
      />

      {/* Progress */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-zinc-400">Logged</p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-3xl font-bold font-mono text-white tabular-nums leading-none">
                {unit === 'oz' ? currentOz : currentMl.toLocaleString()}
              </span>
              <span className="text-sm font-mono text-zinc-500">/ {goalText}</span>
            </div>
            <p className="text-label font-mono text-zinc-500 tabular-nums mt-1">
              {unit === 'oz'
                ? `${currentMl.toLocaleString()} ml (${currentLiters} L)`
                : `${currentOz} fl oz (${currentLiters} L)`}
            </p>
          </div>

          <div className="text-right space-y-1">
            <div className="text-2xl font-bold font-mono text-white tabular-nums leading-none">{progressPercent}%</div>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>

        <ProgressBar
          value={currentMl}
          max={goalMl}
          tone={isGoalAchieved ? 'success' : 'info'}
          label="Daily water progress"
          className="h-2"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span className="tabular-nums" aria-live="polite">
            {isGoalAchieved ? `Target reached (+${overText} over)` : `${remainingText} remaining`}
          </span>
          <span className="flex items-center gap-2">
            {lastAddedDelta && (
              <span role="status" className="font-mono font-semibold text-info tabular-nums">
                +{lastAddedDelta.amount} {lastAddedDelta.unit} ({lastAddedDelta.secondaryText})
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showHydrationTips}
              onClick={() => setShowHydrationTips(!showHydrationTips)}
              icon={<Info className="w-3.5 h-3.5" aria-hidden />}
            >
              {showHydrationTips ? 'Hide calculation' : 'How is this calculated?'}
            </Button>
          </span>
        </div>
      </div>

      {showHydrationTips && (
        <div className="rounded-control border border-line bg-surface-2 p-4 text-xs text-zinc-400 space-y-2">
          <p className="font-semibold text-zinc-200">How your target is calculated</p>
          <p className="leading-relaxed">
            Based on your body weight (<strong className="text-zinc-200">{profile.currentWeightKg || 78} kg</strong>) and training days (
            <strong className="text-zinc-200">{profile.trainingDaysPerWeek || 4} per week</strong>).
          </p>
          <p className="font-mono text-label text-zinc-300 tabular-nums">
            {hydrationPlan.formulaDescription} = <strong>{goalMl.toLocaleString()} ml</strong> / <strong>{goalOz} fl oz</strong> daily
          </p>
        </div>
      )}

      {/* Hourly pacing + reminders (existing component) */}
      <HydrationPacingAlert
        currentWaterMl={currentMl}
        goalMl={goalMl}
        goalOz={goalOz}
        unit={unit}
        selectedDate={activeDate}
        onQuickAddWater={(deltaMl) => handleAddWaterMl(deltaMl)}
      />

      {/* Quick add + custom amount */}
      <div className="space-y-3">
        <QuickAddPresetBar
          activeUnit={unit}
          onQuickAdd={(deltaMl, label) => handleAddWaterMl(deltaMl, label)}
          onPrefillInput={(amt, u) => {
            setCustomAmount(amt.toString());
            setCustomUnit(u);
          }}
        />

        <form
          onSubmit={handleCustomAdd}
          className="rounded-control border border-line bg-surface-2 p-3.5 space-y-3"
          aria-label="Log a custom amount of water"
        >
          <div className="flex flex-wrap items-end gap-3">
            <Input
              wrapperClassName="flex-1 min-w-[9rem]"
              label="Custom amount"
              hint={
                customAmount && parseFloat(customAmount) > 0
                  ? `≈ ${
                      customUnit === 'oz'
                        ? `${Math.round(parseFloat(customAmount) * ML_PER_FL_OZ)} ml`
                        : `${Math.round(parseFloat(customAmount) / ML_PER_FL_OZ)} fl oz`
                    }`
                  : undefined
              }
              type="number"
              inputMode="decimal"
              mono
              step={customUnit === 'oz' ? '1' : '25'}
              min="1"
              max={customUnit === 'oz' ? '250' : '8000'}
              placeholder={customUnit === 'oz' ? 'e.g. 16' : 'e.g. 500'}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
            <SegmentedControl<WaterUnit>
              ariaLabel="Custom amount unit"
              value={customUnit}
              onChange={setCustomUnit}
              options={[
                { value: 'oz', label: 'oz' },
                { value: 'ml', label: 'ml' }
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={!customAmount || parseFloat(customAmount) <= 0}
              icon={<ArrowRight className="w-4 h-4" aria-hidden />}
              className="flex-1 sm:flex-none"
            >
              Log {customAmount ? `${customAmount} ${customUnit}` : 'water'}
            </Button>
            <Button
              variant="secondary"
              iconOnly
              disabled={currentMl <= 0}
              onClick={() => (unit === 'oz' ? handleAddWaterOz(-8) : handleAddWaterMl(-250))}
              title={unit === 'oz' ? 'Undo 8 oz' : 'Undo 250 ml'}
              aria-label={unit === 'oz' ? 'Undo 8 fl oz' : 'Undo 250 ml'}
            >
              <Minus className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </form>
      </div>

      {/* 7-day history (existing component) */}
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

      {/* Goal celebration */}
      <HydrationCelebrationModal
        isOpen={showCelebration}
        onClose={() => setShowCelebration(false)}
        waterMl={currentMl}
        goalMl={goalMl}
        goalOz={goalOz}
        unit={unit}
        streakCount={streakResult.currentStreak}
      />
    </Card>
  );
};
