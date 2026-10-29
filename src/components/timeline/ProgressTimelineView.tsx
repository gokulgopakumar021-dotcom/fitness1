import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  TrendingUp,
  Dumbbell,
  Apple,
  Activity,
  Moon,
  Info,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle2,
  Scan,
  ShieldCheck,
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
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading
} from '../ui';

interface ProgressTimelineViewProps {
  profile: UserProfile;
  isDemoMode?: boolean;
  onProfileUpdated?: (p: UserProfile) => void;
}

type TimelineCategory =
  | 'overview'
  | 'body'
  | 'workouts'
  | 'nutrition'
  | 'consistency'
  | 'recovery'
  | 'audit';

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
  const filteredMetrics = useMemo(
    () => getFilteredBodyMetrics(metrics, dateRange, unit),
    [metrics, dateRange, unit]
  );
  const completedWorkouts = useMemo(
    () => getFilteredCompletedWorkouts(sessions, dateRange),
    [sessions, dateRange]
  );
  const recordedExerciseNames = useMemo(() => getRecordedExerciseNames(sessions), [sessions]);

  // Exercise progression for selected exercise
  const exerciseProgression = useMemo(() => {
    if (!selectedExercise) return [];
    return getExerciseProgressionHistory(sessions, selectedExercise, dateRange, unit);
  }, [sessions, selectedExercise, dateRange, unit]);

  // Nutrition days
  const filteredNutrition = useMemo(
    () => getFilteredNutritionDays(nutritionLogs, dateRange),
    [nutritionLogs, dateRange]
  );

  // Sleep days
  const filteredSleep = useMemo(
    () => getFilteredSleepLogs(sleepLogs, dateRange),
    [sleepLogs, dateRange]
  );

  // Format comparison pill
  const renderComparisonPill = (
    change?: number,
    percent?: number,
    unitLabel: string = '',
    reverseGood: boolean = false
  ) => {
    if (change === undefined) {
      return (
        <span className="text-label font-mono text-zinc-500 flex items-center gap-1">
          <Minus className="w-3 h-3" /> No prior baseline
        </span>
      );
    }

    if (change === 0) {
      return (
        <span className="text-label font-mono text-zinc-400 flex items-center gap-1">
          <Minus className="w-3 h-3" /> Unchanged (0 {unitLabel})
        </span>
      );
    }

    const isPositive = change > 0;
    const isGood = reverseGood ? !isPositive : isPositive;
    const colorClass = isGood ? 'text-volt-adaptive' : 'text-warning';
    const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

    return (
      <span className={`text-label font-mono font-bold flex items-center gap-0.5 tabular-nums ${colorClass}`}>
        <Icon className="w-3.5 h-3.5" />
        <span>
          {isPositive ? '+' : ''}
          {change} {unitLabel}
        </span>
        {percent !== undefined && (
          <span className="opacity-80 ml-1">
            ({isPositive ? '+' : ''}
            {percent}%)
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header & Context */}
      <PageHeader
        eyebrow={`Historical Ground Truth · Progress Timeline${isDemoMode ? ' · [Demo Records Active]' : ''}`}
        title="Long-Term Fitness Progression"
        description="Empirical training history, body mass trends, and nutritional compliance tracked over time."
        actions={
          <Badge tone="neutral" icon={<ShieldCheck className="w-3.5 h-3.5 text-volt-adaptive" />}>
            Recorded Data Only · No Fabricated Points
          </Badge>
        }
      />

      {/* Time Range Selector & Comparison Controls */}
      <Card pad="md" className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Preset Buttons */}
          <div className="flex items-center flex-wrap gap-1 p-1 bg-surface-2 rounded-control border border-line">
            {(['7d', '30d', '90d', '6m', '1y', 'all', 'custom'] as TimeRangePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRangePreset(preset)}
                className={`min-h-[36px] px-3.5 py-1 text-xs font-mono font-semibold rounded-lg transition-colors ${
                  rangePreset === preset
                    ? 'bg-accent text-accent-ink font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white'
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
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={showComparison}
              onChange={(e) => setShowComparison(e.target.checked)}
              className="accent-lime-500 rounded cursor-pointer w-4 h-4"
            />
            <span className="font-medium">Compare to preceding period</span>
          </label>
        </div>

        {/* Custom Range Picker Drawer */}
        {rangePreset === 'custom' && (
          <div className="pt-3 border-t border-line flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 font-mono">From:</span>
              <input
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-surface-2 border border-line rounded-control text-white focus:outline-none focus:border-line-strong"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 font-mono">To:</span>
              <input
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-surface-2 border border-line rounded-control text-white focus:outline-none focus:border-line-strong"
              />
            </div>
            <span className="text-label text-zinc-500 italic">
              Future dates are excluded from historical analysis.
            </span>
          </div>
        )}

        {/* Active Range & Comparison Date Readout */}
        <div className="flex flex-wrap items-center justify-between text-xs font-mono text-zinc-400 pt-1">
          <div>
            Active Window: <strong className="text-white">{dateRange.startDate}</strong> to{' '}
            <strong className="text-white">{dateRange.endDate}</strong> ({overview.totalDaysInRange} days)
          </div>
          {comparisonRange && (
            <div>
              Preceding Baseline: <strong className="text-zinc-300">{comparisonRange.startDate}</strong> to{' '}
              <strong className="text-zinc-300">{comparisonRange.endDate}</strong>
            </div>
          )}
        </div>
      </Card>

      {/* Executive Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Body Weight */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Body Mass Trend
            </span>
            <Activity className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            {overview.latestWeight ? (
              <>
                <div className="text-2xl font-bold font-mono text-white tabular-nums">
                  {overview.latestWeight.weightDisplay}{' '}
                  <span className="text-xs text-zinc-400 font-normal">{unit}</span>
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
              <div className="text-xs text-zinc-500 italic py-1">
                No weigh-ins in this period
              </div>
            )}
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            {overview.weightMeasurementsCount === 1
              ? 'Single weigh-in recorded (need 2+ for trend)'
              : `${overview.weightMeasurementsCount} weigh-ins recorded`}
          </div>
        </Card>

        {/* Card 2: Completed Workouts */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Training Sessions
            </span>
            <Dumbbell className="w-4 h-4 text-cyan-400" />
          </div>

          <div>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {overview.completedWorkoutsCount}{' '}
              <span className="text-xs text-zinc-400 font-normal">sessions</span>
            </div>
            <div className="mt-1">
              {renderComparisonPill(
                overview.completedWorkoutsComparison?.absoluteChange,
                overview.completedWorkoutsComparison?.percentChange,
                'workouts'
              )}
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Pacing: ~{overview.workoutFrequencyPerWeek} workouts / week
          </div>
        </Card>

        {/* Card 3: Total Tonnage Lifted */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Volume Load Lifted
            </span>
            <TrendingUp className="w-4 h-4 text-volt-adaptive" />
          </div>

          <div>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {overview.totalTonnageLifted.toLocaleString()}{' '}
              <span className="text-xs text-zinc-400 font-normal">{unit}</span>
            </div>
            <div className="mt-1">
              {renderComparisonPill(
                overview.tonnageComparison?.absoluteChange,
                overview.tonnageComparison?.percentChange,
                unit
              )}
            </div>
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            Sum of completed working sets
          </div>
        </Card>

        {/* Card 4: Daily Nutrition Average */}
        <Card pad="md" className="flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
              Avg Daily Intake
            </span>
            <Apple className="w-4 h-4 text-amber-400" />
          </div>

          <div>
            {overview.avgDailyCalories !== undefined ? (
              <>
                <div className="text-2xl font-bold font-mono text-white tabular-nums">
                  {overview.avgDailyCalories}{' '}
                  <span className="text-xs text-zinc-400 font-normal">kcal / day</span>
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
              <div className="text-xs text-zinc-500 italic py-1">
                No food logged in window
              </div>
            )}
          </div>

          <div className="text-label font-mono text-zinc-500 pt-2 border-t border-line">
            {overview.nutritionLoggedDaysCount > 0
              ? `Avg over ${overview.nutritionLoggedDaysCount} logged days`
              : 'Zero logged food entries'}
          </div>
        </Card>
      </div>

      {/* Category Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-line overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'overview' as TimelineCategory, label: 'Consolidated View', icon: Activity },
          { id: 'body' as TimelineCategory, label: 'Body Metrics', icon: Activity },
          { id: 'workouts' as TimelineCategory, label: 'Workouts & Strength', icon: Dumbbell },
          { id: 'nutrition' as TimelineCategory, label: 'Nutrition Trends', icon: Apple },
          { id: 'consistency' as TimelineCategory, label: 'Nutrition Consistency', icon: Target },
          { id: 'recovery' as TimelineCategory, label: 'Sleep & Recovery', icon: Moon },
          { id: 'audit' as TimelineCategory, label: 'Data Audit & Body Scan', icon: ShieldCheck }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors border-b-2 -mb-[1px] min-h-[44px] ${
                isActive
                  ? 'border-accent text-volt-adaptive'
                  : 'border-transparent text-zinc-400 hover:text-white'
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Body Weight Trend Chart */}
            <Card pad="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
                    Direct Anthropometry
                  </span>
                  <h3 className="text-base font-bold text-white">Body Weight Trend</h3>
                </div>
                {profile.goalWeightKg && (
                  <Badge tone="neutral">
                    Target: {formatWeight(profile.goalWeightKg, unit)}
                  </Badge>
                )}
              </div>

              {filteredMetrics.length === 0 ? (
                <EmptyState
                  icon={<Activity className="w-5 h-5 text-zinc-400" />}
                  title="No body weight measurements recorded"
                  description="Log scale weight in the Body Metrics tab to populate this trendline."
                />
              ) : filteredMetrics.length === 1 ? (
                <div className="p-6 rounded-control bg-surface-2 text-center space-y-2 border border-line">
                  <div className="text-3xl font-bold font-mono text-white tabular-nums">
                    {filteredMetrics[0].weightDisplay} {unit}
                  </div>
                  <div className="text-xs text-zinc-400">
                    Single recorded observation on {filteredMetrics[0].date}.
                  </div>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
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
                  targetLine={
                    profile.goalWeightKg
                      ? unit === 'lbs'
                        ? kgToLbs(profile.goalWeightKg)
                        : profile.goalWeightKg
                      : undefined
                  }
                  targetLabel={`Goal: ${profile.goalWeightKg ? formatWeight(profile.goalWeightKg, unit) : ''}`}
                  accentColor="var(--chart-1)"
                  responsive
                  height={220}
                />
              )}
            </Card>

            {/* Workout Frequency & Sessions */}
            <Card pad="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
                    Training Adherence
                  </span>
                  <h3 className="text-base font-bold text-white">Completed Sessions History</h3>
                </div>
                <Badge tone="accent">
                  {completedWorkouts.length} Completed
                </Badge>
              </div>

              {completedWorkouts.length === 0 ? (
                <EmptyState
                  icon={<Dumbbell className="w-5 h-5 text-zinc-400" />}
                  title="No completed workouts in date range"
                  description="In-progress and abandoned workouts are strictly excluded from history."
                />
              ) : (
                <div className="space-y-3">
                  <BarChart
                    data={completedWorkouts.slice(-10).map((s) => {
                      const vol = (s.exercises || []).reduce(
                        (sum, ex) => sum + calculateVolumeLoad(ex.sets || [], true),
                        0
                      );
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
                  <div className="text-label font-mono text-zinc-500 text-right">
                    Showing last 10 completed sessions in period
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Quick Highlight of Nutrition & Sleep */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Nutrition Intake */}
            <Card pad="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
                    Daily Fuel Averages
                  </span>
                  <h3 className="text-base font-bold text-white">Caloric Consistency</h3>
                </div>
                {profile.dailyCalorieTarget && (
                  <Badge tone="neutral">
                    Target: {profile.dailyCalorieTarget} kcal
                  </Badge>
                )}
              </div>

              {filteredNutrition.length === 0 ? (
                <EmptyState
                  icon={<Apple className="w-5 h-5 text-zinc-400" />}
                  title="No daily nutrition logs found"
                  description="Log meals in the Nutrition tab to visualize caloric intake across time."
                />
              ) : (
                <LineChart
                  data={filteredNutrition.map((d) => ({
                    date: d.date,
                    value: d.calories
                  }))}
                  unit="kcal"
                  targetLine={profile.dailyCalorieTarget || undefined}
                  targetLabel="Target"
                  accentColor="var(--chart-3)"
                  responsive
                  height={200}
                />
              )}
            </Card>

            {/* Sleep & Rest */}
            <Card pad="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
                    Recovery Foundation
                  </span>
                  <h3 className="text-base font-bold text-white">Sleep Duration History</h3>
                </div>
                <Badge tone="neutral">
                  {filteredSleep.length} Nights Logged
                </Badge>
              </div>

              {filteredSleep.length === 0 ? (
                <EmptyState
                  icon={<Moon className="w-5 h-5 text-zinc-400" />}
                  title="No sleep logs recorded in this period"
                  description="Nightly sleep duration can be recorded via the Sleep Logger."
                />
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
            </Card>
          </div>
        </div>
      )}

      {/* Tab 2: Body Metrics Detailed View */}
      {activeCategory === 'body' && (
        <Card pad="lg" className="space-y-5">
          <SectionHeading
            title="Recorded Body Composition"
            description="Scale and tape measurements over time."
            action={
              <Badge tone="neutral">
                Unit: {unit.toUpperCase()}
              </Badge>
            }
          />

          {/* Weight Line Chart */}
          {filteredMetrics.length > 1 ? (
            <div className="space-y-2">
              <LineChart
                data={filteredMetrics.map((m) => ({
                  date: m.date,
                  value: m.weightDisplay
                }))}
                unit={unit}
                targetLine={
                  profile.goalWeightKg
                    ? unit === 'lbs'
                      ? kgToLbs(profile.goalWeightKg)
                      : profile.goalWeightKg
                    : undefined
                }
                targetLabel={`Target (${unit})`}
                accentColor="var(--chart-1)"
                responsive
                height={240}
              />
            </div>
          ) : filteredMetrics.length === 1 ? (
            <div className="py-8 text-center text-xs text-zinc-400 rounded-control bg-surface-2 border border-line">
              Single measurement of {filteredMetrics[0].weightDisplay} {unit} recorded on{' '}
              {filteredMetrics[0].date}. Add more entries to visualize a line trend.
            </div>
          ) : (
            <EmptyState
              icon={<Activity className="w-5 h-5 text-zinc-400" />}
              title="No body metrics recorded"
              description="No measurements recorded in the selected date window."
            />
          )}

          {/* Detailed Table of Recorded Measurements */}
          {filteredMetrics.length > 0 && (
            <div className="space-y-2 pt-4">
              <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Historical Log Entries ({filteredMetrics.length})
              </h4>
              <div className="overflow-x-auto rounded-control border border-line">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-surface-2 border-b border-line text-label uppercase text-zinc-400">
                    <tr>
                      <th className="py-3 px-3.5">Date</th>
                      <th className="py-3 px-3.5">Weight ({unit})</th>
                      <th className="py-3 px-3.5">Waist (cm)</th>
                      <th className="py-3 px-3.5">Body Fat (%)</th>
                      <th className="py-3 px-3.5">BMI</th>
                      <th className="py-3 px-3.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredMetrics.map((m, idx) => (
                      <tr key={idx} className="hover:bg-surface-2/60 transition-colors">
                        <td className="py-2.5 px-3.5 text-white font-bold">{m.date}</td>
                        <td className="py-2.5 px-3.5 text-volt-adaptive">{m.weightDisplay}</td>
                        <td className="py-2.5 px-3.5 text-zinc-300">
                          {m.waistCm !== undefined ? `${m.waistCm} cm` : '—'}
                        </td>
                        <td className="py-2.5 px-3.5 text-zinc-300">
                          {m.bodyFatPercentage !== undefined ? `${m.bodyFatPercentage}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3.5 text-zinc-300">{m.bmi}</td>
                        <td className="py-2.5 px-3.5 text-zinc-400 italic truncate max-w-[180px]">
                          {m.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab 3: Workouts & Strength Progression Detailed View */}
      {activeCategory === 'workouts' && (
        <Card pad="lg" className="space-y-5">
          {/* Exercise Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
            <div>
              <span className="text-label font-mono uppercase tracking-wider text-zinc-400">
                Exercise Progression Engine
              </span>
              <h3 className="text-lg font-bold text-white">Movement Strength Curves</h3>
            </div>

            {recordedExerciseNames.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-mono">Exercise:</span>
                <select
                  value={selectedExercise}
                  onChange={(e) => setSelectedExercise(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono font-semibold bg-surface-2 border border-line text-white rounded-control focus:outline-none focus:border-line-strong min-h-[38px]"
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
            <EmptyState
              icon={<Dumbbell className="w-5 h-5 text-zinc-400" />}
              title="No completed workout sessions found"
              description="Log and complete sets in the Workouts tab to begin recording exercise history."
            />
          ) : exerciseProgression.length === 0 ? (
            <EmptyState
              icon={<Dumbbell className="w-5 h-5 text-zinc-400" />}
              title={`No working sets for "${selectedExercise}"`}
              description="No completed sets in this date window. Try expanding the time range or selecting another movement."
            />
          ) : (
            <div className="space-y-6">
              {/* 1RM & Weight Chart */}
              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <span className="text-zinc-400">
                    Estimated 1RM (Epley Formula) &amp; Best Working Weight
                  </span>
                  <span className="text-volt-adaptive font-bold tabular-nums">
                    Latest e1RM: {exerciseProgression[exerciseProgression.length - 1].estimated1RMDisplay}{' '}
                    {unit}
                  </span>
                </div>

                <LineChart
                  data={exerciseProgression.map((p) => ({
                    date: p.date,
                    value: p.estimated1RMDisplay,
                    secondaryValue: p.bestWeightDisplay
                  }))}
                  unit={unit}
                  accentColor="var(--chart-1)"
                  secondaryLineName={`Working Weight (${unit})`}
                  responsive
                  height={220}
                />
                <div className="flex items-center justify-end gap-4 text-label font-mono text-zinc-400 mt-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent"></span> Estimated 1RM
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-sky-400"></span> Best Working Weight
                  </span>
                </div>
              </div>

              {/* Session Table for Movement */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Recorded Sessions for {selectedExercise} ({exerciseProgression.length})
                </h4>
                <div className="overflow-x-auto rounded-control border border-line">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-surface-2 border-b border-line text-label uppercase text-zinc-400">
                      <tr>
                        <th className="py-3 px-3.5">Date</th>
                        <th className="py-3 px-3.5">Best Weight ({unit})</th>
                        <th className="py-3 px-3.5">Best Reps</th>
                        <th className="py-3 px-3.5">Estimated 1RM ({unit})</th>
                        <th className="py-3 px-3.5">Working Sets</th>
                        <th className="py-3 px-3.5">Total Volume ({unit})</th>
                        <th className="py-3 px-3.5">Sets Breakdown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {exerciseProgression.map((row, idx) => (
                        <tr key={idx} className="hover:bg-surface-2/60 transition-colors">
                          <td className="py-2.5 px-3.5 text-white font-bold">{row.date}</td>
                          <td className="py-2.5 px-3.5 text-volt-adaptive">{row.bestWeightDisplay}</td>
                          <td className="py-2.5 px-3.5 text-zinc-300">{row.bestReps} reps</td>
                          <td className="py-2.5 px-3.5 text-cyan-400 font-bold">
                            {row.estimated1RMDisplay}
                          </td>
                          <td className="py-2.5 px-3.5 text-zinc-300">{row.workingSetsCount}</td>
                          <td className="py-2.5 px-3.5 text-zinc-300">
                            {unit === 'lbs' ? Math.round(kgToLbs(row.totalVolume)) : row.totalVolume}
                          </td>
                          <td className="py-2.5 px-3.5 text-zinc-400 truncate max-w-[200px]">
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
        </Card>
      )}

      {/* Tab 4: Nutrition Trends Detailed View */}
      {activeCategory === 'nutrition' && (
        <Card pad="lg" className="space-y-5">
          <SectionHeading
            title="Nutrition Intake & Coverage"
            description="Dietary records and macronutrient intake over time."
            action={
              <Badge tone="accent">
                Logged: {overview.nutritionLoggedDaysCount} / {overview.totalDaysInRange} days
              </Badge>
            }
          />

          {filteredNutrition.length === 0 ? (
            <EmptyState
              icon={<Apple className="w-5 h-5 text-zinc-400" />}
              title="No food entries logged"
              description="Record daily meals in the Nutrition tab to populate intake trends."
            />
          ) : (
            <div className="space-y-6">
              {/* Calorie Trend Chart */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
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
                  accentColor="var(--chart-2)"
                  responsive
                  height={220}
                />
              </div>

              {/* Macro Distribution Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Daily Macronutrient Breakdown ({filteredNutrition.length} recorded days)
                </h4>
                <div className="overflow-x-auto rounded-control border border-line">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-surface-2 border-b border-line text-label uppercase text-zinc-400">
                      <tr>
                        <th className="py-3 px-3.5">Date</th>
                        <th className="py-3 px-3.5">Calories</th>
                        <th className="py-3 px-3.5">Protein (g)</th>
                        <th className="py-3 px-3.5">Carbs (g)</th>
                        <th className="py-3 px-3.5">Fat (g)</th>
                        <th className="py-3 px-3.5">Water (ml)</th>
                        <th className="py-3 px-3.5">Items Logged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredNutrition.map((d, idx) => (
                        <tr key={idx} className="hover:bg-surface-2/60 transition-colors">
                          <td className="py-2.5 px-3.5 text-white font-bold">{d.date}</td>
                          <td className="py-2.5 px-3.5 text-cyan-400 font-bold">{d.calories} kcal</td>
                          <td className="py-2.5 px-3.5 text-volt-adaptive">{d.protein}g</td>
                          <td className="py-2.5 px-3.5 text-amber-400">{d.carbs}g</td>
                          <td className="py-2.5 px-3.5 text-rose-400">{d.fat}g</td>
                          <td className="py-2.5 px-3.5 text-zinc-300">
                            {d.waterMl > 0 ? `${d.waterMl} ml` : '—'}
                          </td>
                          <td className="py-2.5 px-3.5 text-zinc-400">{d.entriesCount} items</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-label text-zinc-500 italic pt-1">
                  Note: Unlogged days are not assumed to be zero calorie intake and are excluded from averages to prevent artificial depression of intake stats.
                </p>
              </div>

              {/* Direct Link to Nutrition Consistency Analysis */}
              <div className="p-4 rounded-control bg-surface-2 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-control bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
                    <Target className="w-5 h-5 text-volt-adaptive" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">
                      Evaluate Nutrition Consistency (±10% Target Band)
                    </h4>
                    <p className="text-xs text-zinc-400">
                      Calculate what percentage of recorded days your calories and macros remained within a 10% variance of wizard targets.
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActiveCategory('consistency')}
                >
                  View Consistency Analysis →
                </Button>
              </div>
            </div>
          )}
        </Card>
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
        <Card pad="lg" className="space-y-5">
          <SectionHeading
            title="Sleep Architecture History"
            description="Circadian and recovery tracking."
            action={
              <Badge tone="accent">
                Average: {overview.avgSleepHours ?? '—'} hrs
              </Badge>
            }
          />

          {filteredSleep.length === 0 ? (
            <EmptyState
              icon={<Moon className="w-5 h-5 text-zinc-400" />}
              title="No sleep logs found"
              description="Nightly sleep duration can be recorded via the Sleep Logger in the dashboard."
            />
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
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
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Sleep Logs ({filteredSleep.length} recorded nights)
                </h4>
                <div className="overflow-x-auto rounded-control border border-line">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-surface-2 border-b border-line text-label uppercase text-zinc-400">
                      <tr>
                        <th className="py-3 px-3.5">Date</th>
                        <th className="py-3 px-3.5">Duration (Hours)</th>
                        <th className="py-3 px-3.5">Quality (%)</th>
                        <th className="py-3 px-3.5">Resting HR (BPM)</th>
                        <th className="py-3 px-3.5">HRV (ms)</th>
                        <th className="py-3 px-3.5">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredSleep.map((s, idx) => (
                        <tr key={idx} className="hover:bg-surface-2/60 transition-colors">
                          <td className="py-2.5 px-3.5 text-white font-bold">{s.date}</td>
                          <td className="py-2.5 px-3.5 text-volt-adaptive font-bold">
                            {s.hoursSlept} hrs
                          </td>
                          <td className="py-2.5 px-3.5 text-zinc-300">{s.quality}%</td>
                          <td className="py-2.5 px-3.5 text-zinc-300">{s.restingHeartRate ?? '—'}</td>
                          <td className="py-2.5 px-3.5 text-zinc-300">{s.hrvMs ?? '—'}</td>
                          <td className="py-2.5 px-3.5 text-zinc-400 italic truncate max-w-[200px]">
                            {s.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab 7: Audit & Strict Body Scan Gate Disclosures */}
      {activeCategory === 'audit' && (
        <Card pad="lg" className="space-y-6">
          <SectionHeading
            title="Data Governance, Privacy & Validation Gates"
            description="Architectural principles upholding truthful progress representation."
          />

          {/* Strict Body Scan Disclosure Gate */}
          <div className="p-4 sm:p-5 rounded-control bg-surface-2 border-l-4 border-l-warning border-line space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scan className="w-4 h-4 text-warning" />
                <span className="text-xs font-bold font-mono uppercase tracking-wider text-white">
                  Body Scan Validation Gate (Experimental Inferences)
                </span>
              </div>
              <Badge tone="warning">
                Unvalidated Estimation
              </Badge>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Optical pose scans processed on-device (via MediaPipe landmark detection) are strictly experimental. Because optical silhouette estimates are sensitive to camera distance, posture, clothing, and ambient lighting, they have <strong>not been independently validated as clinical anthropometry</strong>.
            </p>

            <div className="p-3 bg-surface-3 rounded-control text-xs font-mono text-zinc-400 space-y-1 border border-line">
              <div>
                Total on-device scans stored:{' '}
                <strong className="text-white">{bodyScanCount} scans</strong>
              </div>
              <div>
                Integration policy: <strong>Excluded from official physical progress calculations</strong>
              </div>
            </div>
          </div>

          {/* Ground Truth Hierarchy */}
          <div className="space-y-3 text-xs leading-relaxed text-zinc-300">
            <h4 className="font-bold text-white uppercase text-label tracking-wider font-mono">
              Ground Truth Hierarchy
            </h4>
            <ul className="space-y-2 list-disc pl-5">
              <li>
                <strong className="text-white">Direct Physical Measurements (Tier 1):</strong> Scale weight and tape measurements recorded directly by the user are authoritative ground truth. Missing dates are never filled with artificial guesses.
              </li>
              <li>
                <strong className="text-white">Completed Workout Sessions (Tier 1):</strong> Only sessions marked as completed are included in tonnage, frequency, and progressive overload calculations. Warmup sets, skipped sets, and abandoned sessions are excluded.
              </li>
              <li>
                <strong className="text-white">Logged Nutrition Days (Tier 1):</strong> Daily averages are computed strictly over days containing valid food entries. Unlogged days are treated as missing observations rather than zero intake.
              </li>
              <li>
                <strong className="text-white">Data Privacy & Local Storage:</strong> All training history and biometric measurements remain strictly stored in local browser persistence. No personal fitness data is transmitted to third-party tracking services.
              </li>
            </ul>
          </div>
        </Card>
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
