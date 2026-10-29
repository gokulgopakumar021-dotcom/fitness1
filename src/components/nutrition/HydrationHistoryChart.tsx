import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
  CartesianGrid
} from 'recharts';
import {
  Calendar,
  TrendingUp,
  Droplets,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Info,
  ChevronRight,
  BarChart3,
  Award,
  RefreshCw
} from 'lucide-react';
import { db } from '../../storage/db';
import { UserProfile } from '../../types';
import { WaterUnit } from './WaterIntakeLogger';

// 1 US fluid ounce = 29.5735296 ml
const ML_PER_FL_OZ = 29.5735296;

export interface HydrationHistoryChartProps {
  selectedDate: string;
  currentWaterMl: number;
  goalMl: number;
  goalOz: number;
  unit: WaterUnit;
  profile?: UserProfile;
  onSelectDate?: (date: string) => void;
  onRefreshHistory?: () => void;
}

export interface HydrationDayPoint {
  date: string;
  dayName: string;
  shortDate: string;
  displayLabel: string;
  fullDateLabel: string;
  waterMl: number;
  waterOz: number;
  waterDisplay: number;
  goalDisplay: number;
  percentOfGoal: number;
  isGoalMet: boolean;
  isSelected: boolean;
  isToday: boolean;
}

// Custom Tooltip for Recharts
const CustomHydrationTooltip = ({
  active,
  payload,
  unit,
  goalOz,
  goalMl
}: {
  active?: boolean;
  payload?: any[];
  unit: WaterUnit;
  goalOz: number;
  goalMl: number;
}) => {
  if (!active || !payload || !payload.length) return null;

  const data: HydrationDayPoint = payload[0].payload;
  const isGoal = data.isGoalMet;
  const varianceOz = data.waterOz - goalOz;
  const varianceMl = data.waterMl - goalMl;

  return (
    <div className="bg-surface border border-line-strong rounded-control p-3.5 shadow-lg min-w-[200px] text-xs font-mono space-y-2 pointer-events-none z-50">
      <div className="flex items-center justify-between gap-3 pb-1.5 border-b border-line">
        <div>
          <span className="font-bold text-white text-sm block">
            {data.dayName}, {data.shortDate}
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            {data.isToday ? 'Today' : data.date}
          </span>
        </div>
        {data.isSelected && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-400/40">
            Selected
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--text-muted)]">Intake:</span>
          <div className="text-right">
            <span className="text-base font-extrabold text-sky-400 tabular-nums">
              {unit === 'oz' ? `${data.waterOz} fl oz` : `${data.waterMl.toLocaleString()} ml`}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] block">
              ≈ {unit === 'oz' ? `${data.waterMl.toLocaleString()} ml` : `${data.waterOz} fl oz`} (
              {(data.waterMl / 1000).toFixed(2)} L)
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] pt-1">
          <span className="text-[var(--text-muted)]">Profile Target:</span>
          <span className="text-emerald-400 font-bold">
            {unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--text-muted)]">Progress:</span>
          <span
            className={`font-bold tabular-nums ${isGoal ? 'text-emerald-400' : 'text-sky-300'}`}
          >
            {data.percentOfGoal}%
          </span>
        </div>
      </div>

      <div
        className={`pt-1.5 border-t border-white/10 flex items-center gap-1.5 text-[11px] font-bold ${
          isGoal ? 'text-emerald-400' : 'text-sky-400'
        }`}
      >
        {isGoal ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              Target met ({varianceOz >= 0 ? `+${unit === 'oz' ? varianceOz + ' oz' : varianceMl + ' ml'}` : ''})
            </span>
          </>
        ) : (
          <>
            <Droplets className="w-3.5 h-3.5" />
            <span>
              {unit === 'oz' ? `${Math.abs(varianceOz)} fl oz` : `${Math.abs(varianceMl)} ml`} to reach goal
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export const HydrationHistoryChart: React.FC<HydrationHistoryChartProps> = ({
  selectedDate,
  currentWaterMl,
  goalMl,
  goalOz,
  unit,
  profile,
  onSelectDate,
  onRefreshHistory
}) => {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [isPopulatingSample, setIsPopulatingSample] = useState(false);

  const todayKey = new Date().toISOString().split('T')[0];

  // Build the 7-day window ending at selectedDate or today
  // If selectedDate is in the past, center or end around selectedDate so user sees context
  const days: HydrationDayPoint[] = [];
  const referenceDate = new Date(selectedDate + 'T12:00:00');

  for (let i = 6; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    // Determine water intake: if it's the currently viewed selectedDate, use currentWaterMl
    let dayWaterMl = 0;
    if (dateStr === selectedDate) {
      dayWaterMl = currentWaterMl;
    } else {
      const storedLog = db.getNutritionLogForDate(dateStr);
      dayWaterMl = storedLog?.waterMl || 0;
    }

    const dayWaterOz = Math.round(dayWaterMl / ML_PER_FL_OZ);
    const waterDisplay = unit === 'oz' ? dayWaterOz : dayWaterMl;
    const goalDisplay = unit === 'oz' ? goalOz : goalMl;
    const percentOfGoal = goalMl > 0 ? Math.round((dayWaterMl / goalMl) * 100) : 0;
    const isGoalMet = dayWaterMl >= goalMl && goalMl > 0;
    const isSelected = dateStr === selectedDate;
    const isToday = dateStr === todayKey;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = isToday ? 'Today' : dayNames[d.getDay()];
    const shortDate = `${d.getMonth() + 1}/${d.getDate()}`;
    const displayLabel = isToday ? 'Today' : `${dayNames[d.getDay()]} ${d.getDate()}`;

    days.push({
      date: dateStr,
      dayName,
      shortDate,
      displayLabel,
      fullDateLabel: d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      waterMl: dayWaterMl,
      waterOz: dayWaterOz,
      waterDisplay,
      goalDisplay,
      percentOfGoal,
      isGoalMet,
      isSelected,
      isToday
    });
  }

  // 7-day aggregates
  const total7DayMl = days.reduce((acc, d) => acc + d.waterMl, 0);
  const total7DayOz = Math.round(total7DayMl / ML_PER_FL_OZ);
  const avgDayMl = Math.round(total7DayMl / 7);
  const avgDayOz = Math.round(avgDayMl / ML_PER_FL_OZ);
  const daysGoalAchieved = days.filter((d) => d.isGoalMet).length;
  const bestDay = days.reduce((max, d) => (d.waterMl > max.waterMl ? d : max), days[0]);

  // Check if past days are completely unlogged (e.g., all 6 previous days = 0)
  const pastUnloggedCount = days.filter((d) => !d.isSelected && d.waterMl === 0).length;
  const canShowSampleHelper = pastUnloggedCount >= 4;

  // Handle quick sample history seeding for demo / exploration
  const handleSeedSampleHistory = () => {
    setIsPopulatingSample(true);
    // Seed realistic hydration variance for past 6 days
    const factors = [0.85, 1.1, 0.95, 1.05, 0.8, 1.0];
    days.forEach((day, index) => {
      if (day.date !== selectedDate && day.waterMl === 0) {
        const factor = factors[index % factors.length];
        const sampleMl = Math.round((goalMl || 3000) * factor);
        const log = db.getNutritionLogForDate(day.date);
        db.saveNutritionLogForDate({
          ...log,
          waterMl: sampleMl
        });
      }
    });
    setTimeout(() => {
      setIsPopulatingSample(false);
      onRefreshHistory?.();
    }, 250);
  };

  // Determine bar fill color
  const getBarFill = (entry: HydrationDayPoint) => {
    if (entry.isSelected) {
      return entry.isGoalMet ? 'var(--success)' : 'var(--chart-2)';
    }
    if (entry.waterDisplay === 0) {
      return 'var(--bg-surface-3)'; // empty days
    }
    if (entry.isGoalMet) {
      return 'var(--success)';
    }
    return 'var(--chart-2)';
  };

  const weightKg = profile?.currentWeightKg || 78;
  const trainingDays = profile?.trainingDaysPerWeek || 4;
  const activeGoal = unit === 'oz' ? goalOz : goalMl;
  const maxIntake = Math.max(...days.map((d) => d.waterDisplay), activeGoal);
  const yAxisMax = Math.ceil(Math.max(maxIntake, activeGoal) * 1.25);

  return (
    <div className="mt-6 pt-5 border-t border-[var(--border-card)] space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>Last 7 Days Hydration History</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-400/20">
                {unit === 'oz' ? 'Fluid Ounces (fl oz)' : 'Milliliters (ml)'}
              </span>
            </h4>
            <p className="text-[11px] font-mono text-[var(--text-muted)]">
              Target line indicates your recommended intake of{' '}
              <span className="text-emerald-400 font-bold">
                {unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}
              </span>{' '}
              based on profile settings ({weightKg} kg · {trainingDays} training days/wk)
            </p>
          </div>
        </div>

        {/* Quick Sample Seeder if history is sparse */}
        {canShowSampleHelper && (
          <button
            type="button"
            onClick={handleSeedSampleHistory}
            disabled={isPopulatingSample}
            className="self-start sm:self-auto px-2.5 py-1 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-sky-400/30 text-sky-400 hover:text-sky-300 text-xs font-mono font-medium transition-colors flex items-center gap-1.5 shadow-sm"
            title="Populate past week with realistic athlete hydration logs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isPopulatingSample ? 'Simulating...' : 'Seed Sample Week'}</span>
          </button>
        )}
      </div>

      {/* 7-Day Metric Summary Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-0.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            7-Day Daily Avg
          </span>
          <div className="text-base font-mono font-bold text-[var(--text-primary)] tabular-nums">
            {unit === 'oz' ? `${avgDayOz} oz` : `${avgDayMl.toLocaleString()} ml`}
          </div>
          <span className="text-[10px] font-mono text-sky-400 block">
            {goalMl > 0 ? `${Math.round((avgDayMl / goalMl) * 100)}% of goal` : ''}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-emerald-500/30 space-y-0.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Profile Target Line
          </span>
          <div className="text-base font-mono font-bold text-emerald-400 tabular-nums">
            {unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}
          </div>
          <span className="text-[10px] font-mono text-[var(--text-muted)] block">
            {weightKg} kg · {trainingDays} sessions/wk
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-0.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Goal Hit Rate
          </span>
          <div className="text-base font-mono font-bold text-emerald-400 tabular-nums">
            {daysGoalAchieved} / 7 days
          </div>
          <span className="text-[10px] font-mono text-[var(--text-muted)] block">
            {Math.round((daysGoalAchieved / 7) * 100)}% consistency
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-0.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Peak Intake
          </span>
          <div className="text-base font-mono font-bold text-volt-adaptive tabular-nums">
            {unit === 'oz' ? `${bestDay.waterOz} oz` : `${bestDay.waterMl.toLocaleString()} ml`}
          </div>
          <span className="text-[10px] font-mono text-[var(--text-muted)] block">
            {bestDay.dayName} ({bestDay.shortDate})
          </span>
        </div>
      </div>

      {/* The Recharts Bar Chart Container */}
      <div className="p-3 sm:p-4 rounded-2xl bg-[var(--bg-canvas)] border border-[var(--border-card)] space-y-2">
        <div className="flex flex-wrap items-center justify-between text-xs font-mono text-[var(--text-muted)] px-1 gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />
              <span>Intake</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
              <span>Goal Met (≥100%)</span>
            </span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] shadow-sm">
              <span className="w-4 h-0.5 bg-emerald-400 inline-block border-t-2 border-dashed border-emerald-300" />
              <span>Profile Target Line: {activeGoal} {unit}</span>
            </span>
          </div>

          <span className="text-[11px] text-[var(--text-muted)] hidden md:inline">
            Tap any bar to inspect or log that day
          </span>
        </div>

        <div className="w-full h-56 sm:h-64 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={days}
              margin={{ top: 22, right: 10, left: -14, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />
              <XAxis
                dataKey="displayLabel"
                stroke="var(--chart-axis)"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
              />
              <YAxis
                stroke="var(--chart-axis)"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                domain={[0, yAxisMax]}
                tickFormatter={(val) => (unit === 'oz' ? `${val}` : `${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}`)}
              />
              <Tooltip
                content={
                  <CustomHydrationTooltip
                    unit={unit}
                    goalOz={goalOz}
                    goalMl={goalMl}
                  />
                }
                cursor={{ fill: 'var(--chart-grid)' }}
              />
              {/* Daily Target Reference Line showing recommended intake based on profile settings */}
              <ReferenceLine
                y={activeGoal}
                stroke="var(--success)"
                strokeDasharray="6 3"
                strokeWidth={2}
                ifOverflow="extendDomain"
                label={{
                  value: `🎯 Target: ${activeGoal} ${unit} (Profile Goal)`,
                  position: 'insideTopRight',
                  fill: 'var(--success)',
                  fontSize: 10,
                  fontWeight: 700,
                  offset: 8
                }}
              />
              <Bar
                dataKey="waterDisplay"
                radius={[5, 5, 0, 0]}
                maxBarSize={40}
                className="cursor-pointer"
              >
                {days.map((entry) => (
                  <Cell
                    key={entry.date}
                    fill={getBarFill(entry)}
                    stroke={entry.isSelected ? 'var(--chart-2)' : 'transparent'}
                    fillOpacity={entry.isSelected || entry.waterDisplay === 0 ? 1 : 0.65}
                    strokeWidth={entry.isSelected ? 2 : 0}
                    className="transition-all duration-300 hover:opacity-85 cursor-pointer"
                    onClick={() => {
                      if (onSelectDate) {
                        onSelectDate(entry.date);
                      }
                    }}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Selected Day Quick Inspector */}
        <div className="pt-2 border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">Active Diary Date:</span>
            <span className="font-bold text-[var(--text-primary)]">
              {days.find((d) => d.isSelected)?.fullDateLabel || selectedDate}
            </span>
            {selectedDate === todayKey && (
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-sky-500/20 text-sky-400 font-bold">
                Today
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[var(--text-muted)]">
              Intake:{' '}
              <strong className="text-sky-400">
                {unit === 'oz'
                  ? `${Math.round(currentWaterMl / ML_PER_FL_OZ)} fl oz`
                  : `${currentWaterMl.toLocaleString()} ml`}
              </strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Target:{' '}
              <strong className="text-white">
                {unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
