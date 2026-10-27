import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  TrendingUp,
  Dumbbell,
  Apple,
  Activity,
  Moon,
  ChevronDown,
  Info,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle2,
  Scan,
  ShieldCheck,
  Filter,
  Target
} from 'lucide-react';
import {
  BodyMetricEntry,
  DailyNutritionLog,
  DailySleepLog,
  UserProfile,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import {
  TimeRangePreset,
  DateRange,
  resolveDateRange,
  getPreviousComparisonRange,
  buildTimelineOverview,
  getFilteredBodyMetrics,
  getFilteredCompletedWorkouts,
  getExerciseProgressionHistory,
  getRecordedExerciseNames,
  getFilteredNutritionDays,
  getFilteredSleepLogs
} from '../../utils/timelineEngine';
import { formatWeight, kgToLbs, calculateVolumeLoad } from '../../utils/calculations';
import { LineChart, BarChart } from '../common/Charts';
import { listScans } from '../../storage/bodyScanStore';
import { NutritionConsistencyView } from './NutritionConsistencyView';
import { NutritionGoalWizard } from '../nutrition/NutritionGoalWizard';

interface ProgressTimelineViewProps {
  profile: UserProfile;
  isDemoMode?: boolean;
  onProfileUpdated?: (p: UserProfile) => void;
}

type TimelineCategory = 'overview' | 'body' | 'workouts' | 'nutrition' | 'consistency' | 'recovery' | 'audit';

export const ProgressTimelineView: React.FC<ProgressTimelineViewProps> = ({
  profile,
  isDemoMode = false,
  onProfileUpdated
}) => {
  // State for date range and preset
  const [rangePreset, setRangePreset] = useState<TimeRangePreset>('30d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showComparison, setShowComparison] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<TimelineCategory>('overview');
  const [showWizard, setShowWizard] = useState<boolean>(false);
  const [currentProfile, setCurrentProfile] = useState<UserProfile>(profile);

  useEffect(() => {
    setCurrentProfile(profile);
  }, [profile]);

  // Raw data from DB
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<DailyNutritionLog[]>([]);
  const [sleepLogs, setSleepLogs] = useState<DailySleepLog[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [bodyScanCount, setBodyScanCount] = useState<number>(0);

  // Load all recorded history once on mount and when demo mode changes
  useEffect(() => {
    const loadedMetrics = db.getBodyMetrics();
    const loadedSessions = db.getSessions();
    const loadedNutrition = db.getNutritionLogs();
    const loadedSleep = db.getSleepLogs();

    setMetrics(loadedMetrics);
    setSessions(loadedSessions);
    setNutritionLogs(loadedNutrition);
    setSleepLogs(loadedSleep);

    // Initial default exercise selection from completed sessions
    const exerciseNames = getRecordedExerciseNames(loadedSessions);
    if (exerciseNames.length > 0) {
      setSelectedExercise(exerciseNames[0]);
    }

    // Check Body Scan store asynchronously
    listScans()
      .then((scans) => setBodyScanCount(scans.length))
      .catch(() => setBodyScanCount(0));
  }, [isDemoMode]);

  // Compute active date range
  const dateRange: DateRange = useMemo(() => {
    return resolveDateRange(rangePreset, customStartDate, customEndDate);
  }, [rangePreset, customStartDate, customEndDate]);

  const comparisonRange = useMemo(() => {
    return showComparison ? getPreviousComparisonRange(dateRange) : undefined;
  }, [dateRange, showComparison]);

  // Build overview summary
  const overview = useMemo(() => {
    return buildTimelineOverview(
      dateRange,
      metrics,
      sessions,
      nutritionLogs,
      sleepLogs,
      profile,
      showComparison
    );
  }, [dateRange, metrics, sessions, nutritionLogs, sleepLogs, profile, showComparison]);

  // Filtered dataset views for charts
  const unit = profile.preferredUnit || 'kg';
  const filteredMetrics = useMemo(() => getFilteredBodyMetrics(metrics, dateRange, unit), [metrics, dateRange, unit]);
  const completedWorkouts = useMemo(() => getFilteredCompletedWorkouts(sessions, dateRange), [sessions, dateRange]);
  const recordedExerciseNames = useMemo(() => getRecordedExerciseNames(sessions), [sessions]);

  // Exercise progression for selected exercise
  const exerciseProgression = useMemo(() => {
    if (!selectedExercise) return [];
    return getExerciseProgressionHistory(sessions, selectedExercise, dateRange, unit);
  }, [sessions, selectedExercise, dateRange, unit]);

  // Nutrition days
  const filteredNutrition = useMemo(() => getFilteredNutritionDays(nutritionLogs, dateRange), [nutritionLogs, dateRange]);

  // Sleep days
  const filteredSleep = useMemo(() => getFilteredSleepLogs(sleepLogs, dateRange), [sleepLogs, dateRange]);

  // Format comparison pill
  const renderComparisonPill = (
    change?: number,
    percent?: number,
    unitLabel: string = '',
    reverseGood: boolean = false
  ) => {
    if (change === undefined) {
      return (
        <span className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
          <Minus className="w-3 h-3" /> No prior baseline
        </span>
      );
    }

    if (change === 0) {
      return (
        <span className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
          <Minus className="w-3 h-3" /> Unchanged (0 {unitLabel})
        </span>
      );
    }

    const isPositive = change > 0;
    // For weight loss, decrease might be good, or for volume increase is good
    const isGood = reverseGood ? !isPositive : isPositive;
    const colorClass = isGood ? 'text-volt-adaptive' : 'text-amber-400';
    const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

    return (
      <span className={`text-[11px] font-mono font-bold flex items-center gap-0.5 ${colorClass}`}>
        <Icon className="w-3.5 h-3.5" />
        <span>
          {isPositive ? '+' : ''}
          {change} {unitLabel}
        </span>
        {percent !== undefined && (
          <span className="opacity-80 ml-1">
            ({isPositive ? '+' : ''}{percent}%)
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-4">
        <div>
          <div className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] flex items-center gap-1.5">
            <span>Historical Ground Truth</span>
            <span aria-hidden="true">·</span>
            <span className="text-volt-adaptive font-semibold">Progress Timeline</span>
            {isDemoMode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-400 font-semibold">[Demo Records Active]</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Long-Term Fitness Progression
          </h1>
        </div>

        {/* Informative data honesty badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--chip-bg)] border border-[var(--border-card)] text-xs text-[var(--text-secondary)]">
          <ShieldCheck className="w-4 h-4 text-volt-adaptive shrink-0" />
          <span>Recorded Data Only · No Fabricated Points</span>
        </div>
      </div>

      {/* Time Range Selector & Comparison Controls */}
      <div className="reshape-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Preset Buttons */}
          <div className="flex items-center flex-wrap gap-1.5 p-1 bg-[var(--chip-bg)] rounded-xl border border-[var(--border-card)]">
            {(['7d', '30d', '90d', '6m', '1y', 'all', 'custom'] as TimeRangePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRangePreset(preset)}
                className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-all ${
                  rangePreset === preset
                    ? 'bg-[#CEFF00] text-black font-bold shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {preset === '7d' && '7 Days'}
                {preset === '30d' && '30 Days'}
                {preset === '90d' && '90 Days'}
                {preset === '6m' && '6 Months'}
                {preset === '1y' && '1 Year'}
                {preset === 'all' && 'All History'}
                {preset === 'custom' && 'Custom'}
              </button>
            ))}
          </div>

          {/* Comparison Checkbox */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showComparison}
              onChange={(e) => setShowComparison(e.target.checked)}
              className="accent-[#CEFF00] rounded cursor-pointer w-4 h-4"
            />
            <span className="font-medium">Compare to preceding period</span>
          </label>
        </div>

        {/* Custom Range Picker Drawer */}
        {rangePreset === 'custom' && (
          <div className="pt-3 border-t border-[var(--border-card)] flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)] font-mono">From:</span>
              <input
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[#CEFF00]"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)] font-mono">To:</span>
              <input
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[#CEFF00]"
              />
            </div>
            <span className="text-[11px] text-[var(--text-muted)] italic">
              Future dates are excluded from historical analysis.
            </span>
          </div>
        )}

        {/* Active Range & Comparison Date Readout */}
        <div className="flex flex-wrap items-center justify-between text-xs font-mono text-[var(--text-muted)] pt-1">
          <div>
            Active Window: <strong className="text-[var(--text-primary)]">{dateRange.startDate}</strong> to{' '}
            <strong className="text-[var(--text-primary)]">{dateRange.endDate}</strong> ({overview.totalDaysInRange} days)
          </div>
          {comparisonRange && (
            <div>
              Preceding Baseline: <strong className="text-[var(--text-secondary)]">{comparisonRange.startDate}</strong> to{' '}
              <strong className="text-[var(--text-secondary)]">{comparisonRange.endDate}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Executive Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Body Weight */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Body Mass Trend
            </span>
            <Activity className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            {overview.latestWeight ? (
              <>
                <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                  {overview.latestWeight.weightDisplay} <span className="text-xs text-[var(--text-muted)] font-normal">{unit}</span>
                </div>
                <div className="mt-1">
                  {renderComparisonPill(
                    overview.weightComparison?.absoluteChange,
                    overview.weightComparison?.percentChange,
                    unit
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-[var(--text-muted)] italic py-1">
                No weigh-ins in this period
              </div>
            )}
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            {overview.weightMeasurementsCount === 1
              ? 'Single weigh-in recorded (need 2+ for trend)'
              : `${overview.weightMeasurementsCount} weigh-ins recorded`}
          </div>
        </div>

        {/* Card 2: Completed Workouts */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Training Sessions
            </span>
            <Dumbbell className="w-4 h-4 text-cyan-400" />
          </div>

          <div>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
              {overview.completedWorkoutsCount} <span className="text-xs text-[var(--text-muted)] font-normal">sessions</span>
            </div>
            <div className="mt-1">
              {renderComparisonPill(
                overview.completedWorkoutsComparison?.absoluteChange,
                overview.completedWorkoutsComparison?.percentChange,
                'workouts'
              )}
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Pacing: ~{overview.workoutFrequencyPerWeek} workouts / week
          </div>
        </div>

        {/* Card 3: Total Tonnage Lifted */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Volume Load Lifted
            </span>
            <TrendingUp className="w-4 h-4 text-[#CEFF00]" />
          </div>

          <div>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
              {overview.totalTonnageLifted.toLocaleString()}{' '}
              <span className="text-xs text-[var(--text-muted)] font-normal">{unit}</span>
            </div>
            <div className="mt-1">
              {renderComparisonPill(
                overview.tonnageComparison?.absoluteChange,
                overview.tonnageComparison?.percentChange,
                unit
              )}
            </div>
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            Sum of completed working sets
          </div>
        </div>

        {/* Card 4: Daily Nutrition Average */}
        <div className="reshape-card-subtle p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Avg Daily Intake
            </span>
            <Apple className="w-4 h-4 text-amber-400" />
          </div>

          <div>
            {overview.avgDailyCalories !== undefined ? (
              <>
                <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                  {overview.avgDailyCalories} <span className="text-xs text-[var(--text-muted)] font-normal">kcal / day</span>
                </div>
                <div className="mt-1">
                  {renderComparisonPill(
                    overview.caloriesComparison?.absoluteChange,
                    overview.caloriesComparison?.percentChange,
                    'kcal'
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-[var(--text-muted)] italic py-1">
                No food logged in window
              </div>
            )}
          </div>

          <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
            {overview.nutritionLoggedDaysCount > 0
              ? `Avg over ${overview.nutritionLoggedDaysCount} logged days (unlogged days excluded)`
              : 'Zero logged food entries'}
          </div>
        </div>
      </div>

      {/* Category Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border-card)] overflow-x-auto pb-1">
        {[
          { id: 'overview' as TimelineCategory, label: 'Consolidated View', icon: Activity },
          { id: 'body' as TimelineCategory, label: 'Body Metrics', icon: Activity },
          { id: 'workouts' as TimelineCategory, label: 'Workouts & Strength', icon: Dumbbell },
          { id: 'nutrition' as TimelineCategory, label: 'Nutrition Trends', icon: Apple },
          { id: 'consistency' as TimelineCategory, label: 'Nutrition Consistency', icon: Target },
          { id: 'recovery' as TimelineCategory, label: 'Sleep & Recovery', icon: Moon },
          { id: 'audit' as TimelineCategory, label: 'Data Audit & Body Scan', icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors border-b-2 -mb-[1px] ${
                isActive
                  ? 'border-[#CEFF00] text-volt-adaptive'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview Consolidated View */}
      {activeCategory === 'overview' && (
        <div className="space-y-6">
          {/* Weight & Consistency Dual Bento */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Body Weight Trend Chart */}
            <div className="reshape-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Direct Anthropometry
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Body Weight Trend</h3>
                </div>
                {profile.goalWeightKg && (
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    Target: {formatWeight(profile.goalWeightKg, unit)}
                  </span>
                )}
              </div>

              {filteredMetrics.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                  <p>No body weight measurements recorded in this window.</p>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    Log scale weight in the Body Metrics tab to populate this trendline.
                  </p>
                </div>
              ) : filteredMetrics.length === 1 ? (
                <div className="p-6 reshape-card-subtle text-center space-y-2">
                  <div className="text-3xl font-bold font-mono text-[var(--text-primary)]">
                    {filteredMetrics[0].weightDisplay} {unit}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    Single recorded observation on {filteredMetrics[0].date}.
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                    At least two measurements across different dates are required before an empirical trendline can be plotted.
                  </p>
                </div>
              ) : (
                <LineChart
                  data={filteredMetrics.map((m) => ({
                    date: m.date,
                    value: m.weightDisplay
                  }))}
                  unit={unit}
                  targetLine={profile.goalWeightKg ? (unit === 'lbs' ? kgToLbs(profile.goalWeightKg) : profile.goalWeightKg) : undefined}
                  targetLabel={`Goal: ${profile.goalWeightKg ? formatWeight(profile.goalWeightKg, unit) : ''}`}
                  accentColor="#CEFF00"
                  height={220}
                />
              )}
            </div>

            {/* Workout Frequency & Sessions */}
            <div className="reshape-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Training Adherence
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Completed Sessions History</h3>
                </div>
                <span className="text-xs font-mono text-volt-adaptive font-bold">
                  {completedWorkouts.length} Completed
                </span>
              </div>

              {completedWorkouts.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                  <p>No completed workouts found in the selected date range.</p>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    In-progress and abandoned workouts are strictly excluded from history.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <BarChart
                    data={completedWorkouts.slice(-10).map((s) => {
                      const vol = (s.exercises || []).reduce((sum, ex) => sum + calculateVolumeLoad(ex.sets || [], true), 0);
                      const displayVol = unit === 'lbs' ? Math.round(kgToLbs(vol)) : Math.round(vol);
                      return {
                        label: s.date.slice(5),
                        value: displayVol
                      };
                    })}
                    unit={unit}
                    title={`Session Volume Load (${unit})`}
                    height={180}
                  />
                  <div className="text-[10px] font-mono text-[var(--text-muted)] text-right">
                    Showing last 10 completed sessions in period
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Highlight of Nutrition & Sleep */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Nutrition Intake */}
            <div className="reshape-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Daily Fuel Averages
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Caloric Consistency</h3>
                </div>
                {profile.dailyCalorieTarget && (
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    Target: {profile.dailyCalorieTarget} kcal
                  </span>
                )}
              </div>

              {filteredNutrition.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                  <p>No daily nutrition logs found in this period.</p>
                </div>
              ) : (
                <LineChart
                  data={filteredNutrition.map((d) => ({
                    date: d.date,
                    value: d.calories
                  }))}
                  unit="kcal"
                  targetLine={profile.dailyCalorieTarget || undefined}
                  targetLabel="Target"
                  accentColor="#38bdf8"
                  height={200}
                />
              )}
            </div>

            {/* Sleep & Rest */}
            <div className="reshape-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Recovery Foundation
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Sleep Duration History</h3>
                </div>
                <span className="text-xs font-mono text-[var(--text-muted)]">
                  {filteredSleep.length} Nights Logged
                </span>
              </div>

              {filteredSleep.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                  <p>No sleep logs recorded in this period.</p>
                </div>
              ) : (
                <BarChart
                  data={filteredSleep.slice(-10).map((s) => ({
                    label: s.date.slice(5),
                    value: s.hoursSlept
                  }))}
                  unit="hrs"
                  height={180}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Body Metrics Detailed View */}
      {activeCategory === 'body' && (
        <div className="space-y-6">
          <div className="reshape-card p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-card)] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Scale & Tape Measurements
                </span>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Recorded Body Composition</h3>
              </div>
              <div className="text-xs font-mono text-[var(--text-muted)]">
                Preferred Unit: <strong className="text-[var(--text-primary)]">{unit.toUpperCase()}</strong>
              </div>
            </div>

            {/* Weight Line Chart */}
            {filteredMetrics.length > 1 ? (
              <div className="space-y-2">
                <LineChart
                  data={filteredMetrics.map((m) => ({
                    date: m.date,
                    value: m.weightDisplay
                  }))}
                  unit={unit}
                  targetLine={profile.goalWeightKg ? (unit === 'lbs' ? kgToLbs(profile.goalWeightKg) : profile.goalWeightKg) : undefined}
                  targetLabel={`Target (${unit})`}
                  accentColor="#CEFF00"
                  height={240}
                />
              </div>
            ) : filteredMetrics.length === 1 ? (
              <div className="py-8 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                Single measurement of {filteredMetrics[0].weightDisplay} {unit} recorded on {filteredMetrics[0].date}. Add more entries to visualize a line trend.
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                No body metrics recorded in the selected date window.
              </div>
            )}

            {/* Detailed Table of Recorded Measurements */}
            {filteredMetrics.length > 0 && (
              <div className="space-y-2 pt-4">
                <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Historical Log Entries ({filteredMetrics.length})
                </h4>
                <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[var(--chip-bg)] border-b border-[var(--border-card)] text-[10px] uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Weight ({unit})</th>
                        <th className="py-2.5 px-3">Waist (cm)</th>
                        <th className="py-2.5 px-3">Body Fat (%)</th>
                        <th className="py-2.5 px-3">BMI</th>
                        <th className="py-2.5 px-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-card)]">
                      {filteredMetrics.map((m, idx) => (
                        <tr key={idx} className="hover:bg-[var(--chip-bg)]/40 transition-colors">
                          <td className="py-2 px-3 text-[var(--text-primary)] font-bold">{m.date}</td>
                          <td className="py-2 px-3 text-volt-adaptive">{m.weightDisplay}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{m.waistCm !== undefined ? `${m.waistCm} cm` : '—'}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{m.bodyFatPercentage !== undefined ? `${m.bodyFatPercentage}%` : '—'}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{m.bmi}</td>
                          <td className="py-2 px-3 text-[var(--text-muted)] italic truncate max-w-[180px]">{m.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Workouts & Strength Progression Detailed View */}
      {activeCategory === 'workouts' && (
        <div className="space-y-6">
          <div className="reshape-card p-5 space-y-5">
            {/* Exercise Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Exercise Progression Engine
                </span>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Movement Strength Curves</h3>
              </div>

              {recordedExerciseNames.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] font-mono">Exercise:</span>
                  <select
                    value={selectedExercise}
                    onChange={(e) => setSelectedExercise(e.target.value)}
                    className="px-3 py-1.5 text-xs font-mono font-semibold bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-primary)] rounded-lg focus:outline-none focus:border-[#CEFF00]"
                  >
                    {recordedExerciseNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {recordedExerciseNames.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                No completed workout sessions found. Log and complete sets in the Workouts tab to begin recording exercise history.
              </div>
            ) : exerciseProgression.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                No completed working sets for "{selectedExercise}" in this date window. Try expanding the time range or selecting another movement.
              </div>
            ) : (
              <div className="space-y-6">
                {/* 1RM & Weight Chart */}
                <div>
                  <div className="flex items-center justify-between text-xs font-mono mb-2">
                    <span className="text-[var(--text-secondary)]">
                      Estimated 1RM (Epley Formula) & Best Working Weight
                    </span>
                    <span className="text-volt-adaptive font-bold">
                      Latest e1RM: {exerciseProgression[exerciseProgression.length - 1].estimated1RMDisplay} {unit}
                    </span>
                  </div>

                  <LineChart
                    data={exerciseProgression.map((p) => ({
                      date: p.date,
                      value: p.estimated1RMDisplay,
                      secondaryValue: p.bestWeightDisplay
                    }))}
                    unit={unit}
                    accentColor="#CEFF00"
                    secondaryLineName={`Working Weight (${unit})`}
                    height={220}
                  />
                  <div className="flex items-center justify-end gap-4 text-[10px] font-mono text-[var(--text-muted)] mt-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#CEFF00]"></span> Estimated 1RM
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-0.5 bg-sky-400"></span> Best Working Weight
                    </span>
                  </div>
                </div>

                {/* Session Table for Movement */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    Recorded Sessions for {selectedExercise} ({exerciseProgression.length})
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--chip-bg)] border-b border-[var(--border-card)] text-[10px] uppercase text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Best Weight ({unit})</th>
                          <th className="py-2.5 px-3">Best Reps</th>
                          <th className="py-2.5 px-3">Estimated 1RM ({unit})</th>
                          <th className="py-2.5 px-3">Working Sets</th>
                          <th className="py-2.5 px-3">Total Volume ({unit})</th>
                          <th className="py-2.5 px-3">Sets Breakdown</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-card)]">
                        {exerciseProgression.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[var(--chip-bg)]/40 transition-colors">
                            <td className="py-2 px-3 text-[var(--text-primary)] font-bold">{row.date}</td>
                            <td className="py-2 px-3 text-volt-adaptive">{row.bestWeightDisplay}</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{row.bestReps} reps</td>
                            <td className="py-2 px-3 text-cyan-400 font-bold">{row.estimated1RMDisplay}</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{row.workingSetsCount}</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">
                              {unit === 'lbs' ? Math.round(kgToLbs(row.totalVolume)) : row.totalVolume}
                            </td>
                            <td className="py-2 px-3 text-[var(--text-muted)] truncate max-w-[200px]">
                              {row.setsSummary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Nutrition Trends Detailed View */}
      {activeCategory === 'nutrition' && (
        <div className="space-y-6">
          <div className="reshape-card p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-card)] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Dietary Ground Truth
                </span>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Nutrition Intake & Coverage</h3>
              </div>
              <div className="text-xs font-mono text-[var(--text-muted)]">
                Logged Coverage:{' '}
                <strong className="text-volt-adaptive">
                  {overview.nutritionLoggedDaysCount} / {overview.totalDaysInRange} days
                </strong>
              </div>
            </div>

            {filteredNutrition.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                No food entries logged in this period.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Calorie Trend Chart */}
                <div>
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Daily Calorie Logs vs Target
                  </h4>
                  <LineChart
                    data={filteredNutrition.map((d) => ({
                      date: d.date,
                      value: d.calories
                    }))}
                    unit="kcal"
                    targetLine={profile.dailyCalorieTarget || undefined}
                    targetLabel={`Target (${profile.dailyCalorieTarget || 0} kcal)`}
                    accentColor="#38bdf8"
                    height={220}
                  />
                </div>

                {/* Macro Distribution Table */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    Daily Macronutrient Breakdown ({filteredNutrition.length} recorded days)
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--chip-bg)] border-b border-[var(--border-card)] text-[10px] uppercase text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Calories</th>
                          <th className="py-2.5 px-3">Protein (g)</th>
                          <th className="py-2.5 px-3">Carbs (g)</th>
                          <th className="py-2.5 px-3">Fat (g)</th>
                          <th className="py-2.5 px-3">Water (ml)</th>
                          <th className="py-2.5 px-3">Items Logged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-card)]">
                        {filteredNutrition.map((d, idx) => (
                          <tr key={idx} className="hover:bg-[var(--chip-bg)]/40 transition-colors">
                            <td className="py-2 px-3 text-[var(--text-primary)] font-bold">{d.date}</td>
                            <td className="py-2 px-3 text-cyan-400 font-bold">{d.calories} kcal</td>
                            <td className="py-2 px-3 text-volt-adaptive">{d.protein}g</td>
                            <td className="py-2 px-3 text-amber-400">{d.carbs}g</td>
                            <td className="py-2 px-3 text-rose-400">{d.fat}g</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{d.waterMl > 0 ? `${d.waterMl} ml` : '—'}</td>
                            <td className="py-2 px-3 text-[var(--text-muted)]">{d.entriesCount} items</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] italic pt-1">
                    Note: Unlogged days are not assumed to be zero calorie intake and are excluded from averages to prevent artificial depression of intake stats.
                  </p>
                </div>

                {/* Direct Link to Nutrition Consistency Analysis */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-[var(--chip-bg)] to-[var(--bg-canvas)] border border-[var(--border-card)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-volt-adaptive/10 border border-volt-adaptive/30 flex items-center justify-center shrink-0">
                      <Target className="w-5 h-5 text-volt-adaptive" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        Evaluate Nutrition Consistency (±10% Target Band)
                      </h4>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        Calculate what percentage of recorded days your calories and macros remained within a 10% variance of wizard targets.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('consistency')}
                    className="px-3.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#CEFF00] text-black hover:bg-[#CEFF00]/90 transition-colors shrink-0 shadow-sm"
                  >
                    View Consistency Analysis →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Nutrition Consistency Detailed View */}
      {activeCategory === 'consistency' && (
        <NutritionConsistencyView
          logs={nutritionLogs}
          profile={currentProfile}
          dateRange={dateRange}
          onOpenWizard={() => setShowWizard(true)}
        />
      )}

      {/* Tab 6: Sleep & Recovery Detailed View */}
      {activeCategory === 'recovery' && (
        <div className="space-y-6">
          <div className="reshape-card p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-card)] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Circadian & Biometrics
                </span>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Sleep Architecture History</h3>
              </div>
              <div className="text-xs font-mono text-[var(--text-muted)]">
                Average Duration: <strong className="text-volt-adaptive">{overview.avgSleepHours ?? '—'} hrs</strong>
              </div>
            </div>

            {filteredSleep.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] reshape-card-subtle">
                No sleep logs found in this period. Nightly sleep duration can be recorded via the Sleep Logger in the dashboard.
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Recorded Sleep Duration (Hours)
                  </h4>
                  <BarChart
                    data={filteredSleep.map((s) => ({
                      label: s.date.slice(5),
                      value: s.hoursSlept
                    }))}
                    unit="hrs"
                    target={8.0}
                    height={200}
                  />
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    Sleep Logs ({filteredSleep.length} recorded nights)
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--chip-bg)] border-b border-[var(--border-card)] text-[10px] uppercase text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Duration (Hours)</th>
                          <th className="py-2.5 px-3">Quality (%)</th>
                          <th className="py-2.5 px-3">Resting HR (BPM)</th>
                          <th className="py-2.5 px-3">HRV (ms)</th>
                          <th className="py-2.5 px-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-card)]">
                        {filteredSleep.map((s, idx) => (
                          <tr key={idx} className="hover:bg-[var(--chip-bg)]/40 transition-colors">
                            <td className="py-2 px-3 text-[var(--text-primary)] font-bold">{s.date}</td>
                            <td className="py-2 px-3 text-volt-adaptive font-bold">{s.hoursSlept} hrs</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{s.quality}%</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{s.restingHeartRate ?? '—'}</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">{s.hrvMs ?? '—'}</td>
                            <td className="py-2 px-3 text-[var(--text-muted)] italic truncate max-w-[200px]">{s.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Audit & Strict Body Scan Gate Disclosures */}
      {activeCategory === 'audit' && (
        <div className="space-y-6">
          <div className="reshape-card p-5 lg:p-6 space-y-6">
            <div className="flex items-center gap-3 border-b border-[var(--border-card)] pb-4">
              <div className="w-10 h-10 rounded-xl bg-volt-adaptive/10 border border-volt-adaptive/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-volt-adaptive" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  Data Governance, Privacy & Validation Gates
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Architectural principles upholding truthful progress representation.
                </p>
              </div>
            </div>

            {/* Strict Body Scan Disclosure Gate */}
            <div className="reshape-card-subtle p-5 space-y-3 border-l-4 border-amber-400">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scan className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold font-mono uppercase tracking-wider text-[var(--text-primary)]">
                    Body Scan Validation Gate (Experimental Inferences)
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-400/10 text-amber-400 border border-amber-400/30">
                  Unvalidated Estimation
                </span>
              </div>

              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Optical pose scans processed on-device (via MediaPipe landmark detection) are strictly experimental. Because optical silhouette estimates are sensitive to camera distance, posture, clothing, and ambient lighting, they have <strong>not been independently validated as clinical anthropometry</strong>.
              </p>

              <div className="p-3 bg-[var(--bg-canvas)] rounded-lg text-xs font-mono text-[var(--text-muted)] space-y-1">
                <div>Total on-device scans stored: <strong className="text-[var(--text-primary)]">{bodyScanCount} scans</strong></div>
                <div>Integration policy: <strong>Excluded from official physical progress calculations</strong></div>
              </div>
            </div>

            {/* Ground Truth Hierarchy */}
            <div className="space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              <h4 className="font-bold text-[var(--text-primary)] uppercase text-[11px] tracking-wider">
                Ground Truth Hierarchy
              </h4>
              <ul className="space-y-2 list-disc pl-5">
                <li>
                  <strong className="text-[var(--text-primary)]">Direct Physical Measurements (Tier 1):</strong> Scale weight and tape measurements recorded directly by the user are authoritative ground truth. Missing dates are never filled with artificial guesses.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Completed Workout Sessions (Tier 1):</strong> Only sessions marked as completed are included in tonnage, frequency, and progressive overload calculations. Warmup sets, skipped sets, and abandoned sessions are excluded.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Logged Nutrition Days (Tier 1):</strong> Daily averages are computed strictly over days containing valid food entries. Unlogged days are treated as missing observations rather than zero intake.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Data Privacy & Local Storage:</strong> All training history and biometric measurements remain strictly stored in local browser persistence. No personal fitness data is transmitted to third-party tracking services.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Target Wizard Modal from Consistency View */}
      {showWizard && (
        <NutritionGoalWizard
          isOpen={showWizard}
          onClose={() => setShowWizard(false)}
          profile={currentProfile}
          onTargetsUpdated={(updatedProfile, updatedLog) => {
            setCurrentProfile(updatedProfile);
            if (onProfileUpdated) {
              onProfileUpdated(updatedProfile);
            }
            if (updatedLog) {
              setNutritionLogs(db.getNutritionLogs());
            }
          }}
        />
      )}
    </div>
  );
};
