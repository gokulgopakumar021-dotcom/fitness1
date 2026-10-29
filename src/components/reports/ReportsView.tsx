import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Calendar,
  Award,
  TrendingUp,
  Activity,
  AlertCircle,
  Dumbbell,
  Apple
} from 'lucide-react';
import {
  BodyMetricEntry,
  DailyNutritionLog,
  UserProfile,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { calculateEpley1RM, calculateVolumeLoad, formatWeight } from '../../utils/calculations';
import { LineChart } from '../common/Charts';
import {
  Badge,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  SectionHeading,
  SegmentedControl
} from '../ui';

interface ReportsViewProps {
  profile: UserProfile;
}

type FilterPeriod = '7d' | '30d' | '90d' | 'all';

export const ReportsView: React.FC<ReportsViewProps> = ({ profile }) => {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<DailyNutritionLog[]>([]);
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>([]);
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('30d');

  useEffect(() => {
    setSessions(db.getSessions().filter((s) => s.status === 'completed'));
    setNutritionLogs(db.getNutritionLogs());
    setMetrics(db.getBodyMetrics());
  }, []);

  const daysBack = useMemo(() => {
    if (filterPeriod === '7d') return 7;
    if (filterPeriod === '30d') return 30;
    if (filterPeriod === '90d') return 90;
    return 365;
  }, [filterPeriod]);

  const cutoffDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getTime() - daysBack * 24 * 3600 * 1000);
  }, [daysBack]);

  // Filtered collections
  const filteredSessions = useMemo(
    () => sessions.filter((s) => new Date(s.date) >= cutoffDate),
    [sessions, cutoffDate]
  );
  const filteredNutrition = useMemo(
    () => nutritionLogs.filter((n) => new Date(n.date) >= cutoffDate),
    [nutritionLogs, cutoffDate]
  );
  const filteredMetrics = useMemo(
    () => metrics.filter((m) => new Date(m.date) >= cutoffDate),
    [metrics, cutoffDate]
  );

  // 1. Total sessions completed
  const totalCompletedSessions = filteredSessions.length;

  // 2. Training Volume Trend
  const volumeBySessionData = useMemo(() => {
    return filteredSessions.map((s) => {
      const workingSets = s.exercises.flatMap((e) =>
        e.sets.filter((st) => st.completed && st.type === 'working')
      );
      const vol = calculateVolumeLoad(workingSets, false);
      return {
        date: s.date,
        value: vol,
        label: `${vol.toLocaleString()} ${profile.preferredUnit}`
      };
    });
  }, [filteredSessions, profile.preferredUnit]);

  const totalFilteredVolume = useMemo(() => {
    return volumeBySessionData.reduce((acc, curr) => acc + curr.value, 0);
  }, [volumeBySessionData]);

  // 3. Nutrition Adherence
  const loggedNutrDays = filteredNutrition.length;
  const avgCalories = useMemo(() => {
    if (loggedNutrDays === 0) return 0;
    const totalCals = filteredNutrition.reduce(
      (sum, n) => sum + n.entries.reduce((eSum, e) => eSum + (e.calories || 0), 0),
      0
    );
    return Math.round(totalCals / loggedNutrDays);
  }, [filteredNutrition, loggedNutrDays]);

  const avgProtein = useMemo(() => {
    if (loggedNutrDays === 0) return 0;
    const totalProt = filteredNutrition.reduce(
      (sum, n) => sum + n.entries.reduce((eSum, e) => eSum + (e.protein || 0), 0),
      0
    );
    return Math.round(totalProt / loggedNutrDays);
  }, [filteredNutrition, loggedNutrDays]);

  // 4. Personal Records Board (calculated across all completed sessions)
  const prList = useMemo(() => {
    const prMap = new Map<string, { maxWeight: number; best1RM: number; date: string }>();
    sessions.forEach((s) => {
      s.exercises.forEach((ex) => {
        ex.sets.forEach((set) => {
          if (!set.completed || set.skipped || set.type !== 'working') return;
          const e1rm = calculateEpley1RM(set.weight, set.reps);
          const existing = prMap.get(ex.name);
          if (!existing) {
            prMap.set(ex.name, { maxWeight: set.weight, best1RM: e1rm, date: s.date });
          } else {
            if (set.weight > existing.maxWeight) existing.maxWeight = set.weight;
            if (e1rm > existing.best1RM) existing.best1RM = e1rm;
          }
        });
      });
    });

    return Array.from(prMap.entries()).map(([name, data]) => ({
      name,
      maxWeight: data.maxWeight,
      best1RM: data.best1RM,
      date: data.date
    }));
  }, [sessions]);

  // 5. Weekly Summary Narrative Generation (based strictly on real recorded data)
  const summary = useMemo(() => {
    if (sessions.length === 0 && metrics.length === 0 && nutritionLogs.length === 0) {
      return {
        hasData: false,
        improved: [],
        stable: [],
        attention: [],
        suggestedActions: [
          'Log your first workout session in the Workouts tab to begin collecting baseline data.',
          'Record your morning body weight in Body Metrics.',
          'Log your meals in Nutrition to establish your calorie and protein adherence.'
        ]
      };
    }

    const improved: string[] = [];
    const stable: string[] = [];
    const attention: string[] = [];
    const suggestedActions: string[] = [];

    // Evaluate sessions consistency
    const targetDays = profile.trainingDaysPerWeek || 4;
    const weeklyRate = (filteredSessions.length / (daysBack / 7)).toFixed(1);

    if (parseFloat(weeklyRate) >= targetDays) {
      improved.push(`Workout frequency: averaging ${weeklyRate} sessions/week (target: ${targetDays}/week).`);
    } else if (parseFloat(weeklyRate) >= targetDays - 1) {
      stable.push(`Workout frequency: steady at ${weeklyRate} sessions/week.`);
    } else if (filteredSessions.length > 0) {
      attention.push(`Training frequency (${weeklyRate}/wk) is below your programmed ${targetDays} days/week.`);
      suggestedActions.push('Schedule gym days in advance to meet weekly split frequency.');
    }

    // Evaluate volume load
    if (volumeBySessionData.length >= 2) {
      const firstHalf = volumeBySessionData.slice(0, Math.floor(volumeBySessionData.length / 2));
      const secondHalf = volumeBySessionData.slice(Math.floor(volumeBySessionData.length / 2));
      const avgVol1 = firstHalf.reduce((a, b) => a + b.value, 0) / (firstHalf.length || 1);
      const avgVol2 = secondHalf.reduce((a, b) => a + b.value, 0) / (secondHalf.length || 1);

      if (avgVol2 > avgVol1 * 1.05) {
        improved.push(
          `Working-set volume load increased by ${((avgVol2 / avgVol1 - 1) * 100).toFixed(1)}% across sessions.`
        );
      } else if (avgVol2 >= avgVol1 * 0.95) {
        stable.push('Training volume load maintained steadily.');
      } else {
        attention.push('Training volume has dipped across recent sessions.');
        suggestedActions.push('Review recovery, sleep duration, and pre-workout carbohydrates.');
      }
    }

    // Evaluate Nutrition
    if (loggedNutrDays > 0) {
      const calDelta = Math.abs(avgCalories - profile.dailyCalorieTarget);
      if (calDelta < 150) {
        improved.push(
          `Caloric adherence: averaging ${avgCalories} kcal/day within 150 kcal of target (${profile.dailyCalorieTarget}).`
        );
      } else {
        stable.push(`Average daily intake: ${avgCalories} kcal/day.`);
      }

      if (avgProtein >= profile.dailyProteinTarget * 0.9) {
        improved.push(`Protein intake: hitting ${avgProtein}g/day (target: ${profile.dailyProteinTarget}g).`);
      } else {
        attention.push(
          `Protein intake averaging ${avgProtein}g/day, which is below the ${profile.dailyProteinTarget}g target.`
        );
        suggestedActions.push('Add a protein-dense snack (whey, Greek yogurt, or chicken breast) to close protein gap.');
      }
    }

    if (suggestedActions.length === 0) {
      suggestedActions.push('Maintain consistent execution of your double progression targets next week.');
    }

    return {
      hasData: true,
      improved,
      stable,
      attention,
      suggestedActions
    };
  }, [
    sessions,
    metrics,
    nutritionLogs,
    filteredSessions,
    volumeBySessionData,
    loggedNutrDays,
    avgCalories,
    avgProtein,
    daysBack,
    profile.dailyCalorieTarget,
    profile.dailyProteinTarget,
    profile.trainingDaysPerWeek
  ]);

  // Weight Trend Data for Filtered Range
  const weightTrendData = useMemo(() => {
    return filteredMetrics.map((m) => ({
      date: m.date,
      value: m.weightKg,
      label: `${m.weightKg} kg`
    }));
  }, [filteredMetrics]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header with Time Filter */}
      <PageHeader
        eyebrow="Performance Analytics · Longitudinal"
        title="Training & Body Reports"
        description="Data-driven audit of your strength progression, volume load, and nutrition adherence."
        actions={
          <div className="w-full sm:w-auto">
            <SegmentedControl
              ariaLabel="Time period"
              options={[
                { value: '7d', label: '7 Days' },
                { value: '30d', label: '30 Days' },
                { value: '90d', label: '90 Days' },
                { value: 'all', label: 'All Time' }
              ]}
              value={filterPeriod}
              onChange={(val) => setFilterPeriod(val as FilterPeriod)}
            />
          </div>
        }
      />

      {/* Top 4 Stat Widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          label="Sessions Completed"
          value={totalCompletedSessions}
          unit="sessions"
          hint="In selected window"
          emphasis={totalCompletedSessions > 0}
          icon={<Dumbbell className="w-4 h-4 text-zinc-500" />}
        />
        <MetricCard
          label="Total Volume Load"
          value={totalFilteredVolume.toLocaleString()}
          unit={profile.preferredUnit}
          hint="Accumulated working sets"
          icon={<TrendingUp className="w-4 h-4 text-zinc-500" />}
        />
        <MetricCard
          label="Daily Calories (Avg)"
          value={avgCalories > 0 ? avgCalories.toString() : '—'}
          unit={avgCalories > 0 ? 'kcal' : undefined}
          hint={`Target: ${profile.dailyCalorieTarget} kcal`}
          icon={<Apple className="w-4 h-4 text-zinc-500" />}
        />
        <MetricCard
          label="Daily Protein (Avg)"
          value={avgProtein > 0 ? `${avgProtein}g` : '—'}
          hint={`Target: ${profile.dailyProteinTarget}g`}
          emphasis={avgProtein >= profile.dailyProteinTarget * 0.9}
          icon={<Activity className="w-4 h-4 text-zinc-500" />}
        />
      </div>

      {/* Verified Training & Adherence Audit */}
      <Card pad="lg" className="space-y-4">
        <SectionHeading
          title="Verified Training & Adherence Audit"
          description="Algorithmic evaluation of your training split consistency, volume overload, and macronutrient targets."
        />

        {!summary.hasData ? (
          <EmptyState
            icon={<BarChart3 className="w-5 h-5 text-zinc-400" />}
            title="No training or metric data recorded yet"
            description="Record workout sessions or log nutrition to generate objective longitudinal analysis."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* What Improved */}
            <div className="p-4 rounded-control bg-surface-2 border border-line space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-label text-zinc-400 font-mono">What Improved</span>
                <Badge tone="accent">Overload</Badge>
              </div>
              {summary.improved.length > 0 ? (
                <ul className="space-y-2 text-sm text-zinc-300">
                  {summary.improved.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-volt-adaptive font-bold shrink-0">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">Collect more sessions to detect positive overload trends.</p>
              )}
            </div>

            {/* What Remained Stable */}
            <div className="p-4 rounded-control bg-surface-2 border border-line space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-label text-zinc-400 font-mono">What Remained Stable</span>
                <Badge tone="info">Baseline</Badge>
              </div>
              {summary.stable.length > 0 ? (
                <ul className="space-y-2 text-sm text-zinc-300">
                  {summary.stable.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-info font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">No stability patterns flagged.</p>
              )}
            </div>

            {/* Needs Attention & Suggested Actions */}
            <div className="p-4 rounded-control bg-surface-2 border border-warning/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-label text-zinc-400 font-mono">Needs Attention</span>
                <Badge tone="warning">Action</Badge>
              </div>
              {summary.attention.length > 0 ? (
                <ul className="space-y-2 text-sm text-zinc-300">
                  {summary.attention.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">No negative recovery or volume deficits detected.</p>
              )}

              {summary.suggestedActions.length > 0 && (
                <div className="pt-3 border-t border-line text-xs space-y-1">
                  <span className="text-label text-zinc-400 block font-mono">Suggested Next Action:</span>
                  <p className="text-zinc-200 font-medium">{summary.suggestedActions[0]}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Charts: Volume Load Over Time & Body Weight */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card pad="md" className="space-y-3">
          <SectionHeading
            title="Session Volume Load Progression"
            description={`Sum of working set load (${profile.preferredUnit}) per completed workout`}
          />
          <LineChart
            data={volumeBySessionData}
            title=""
            unit={profile.preferredUnit}
            accentColor="var(--chart-1)"
            emptyMessage="No completed sessions in this date window"
            responsive
            height={220}
          />
        </Card>

        <Card pad="md" className="space-y-3">
          <SectionHeading
            title="Body Weight Over Time"
            description={
              profile.goalWeightKg
                ? `Target: ${formatWeight(profile.goalWeightKg, profile.preferredUnit)}`
                : 'Scale weigh-ins'
            }
          />
          <LineChart
            data={weightTrendData}
            title=""
            unit={profile.preferredUnit}
            targetLine={profile.goalWeightKg}
            accentColor="var(--chart-2)"
            emptyMessage="No body weight entries recorded in this window"
            responsive
            height={220}
          />
        </Card>
      </div>

      {/* Personal Records (PR) Hall of Fame */}
      <Card pad="lg" className="space-y-4">
        <SectionHeading
          title="Personal Records (PR) Board"
          description="Top load and estimated 1-rep maximum across all recorded working sets."
          action={
            <Badge tone="neutral">
              {prList.length} Exercises Tracked
            </Badge>
          }
        />

        {prList.length === 0 ? (
          <EmptyState
            icon={<Award className="w-5 h-5 text-zinc-400" />}
            title="No personal records recorded"
            description="Complete working sets in your workouts to automatically register personal records."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {prList.map((pr) => (
              <div
                key={pr.name}
                className="p-4 rounded-control bg-surface-2 border border-line hover:border-line-strong transition-colors space-y-3"
              >
                <div className="font-semibold text-white text-sm truncate">{pr.name}</div>
                <div className="flex items-center justify-between font-mono">
                  <div>
                    <span className="text-label text-zinc-400 block">TOP LOAD</span>
                    <span className="text-lg font-bold text-volt-adaptive tabular-nums">
                      {pr.maxWeight} <span className="text-xs text-zinc-400 font-normal">{profile.preferredUnit}</span>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-label text-zinc-400 block">EST. 1RM</span>
                    <span className="text-sm font-bold text-info tabular-nums">
                      {pr.best1RM} <span className="text-xs text-zinc-400 font-normal">{profile.preferredUnit}</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-label font-mono text-zinc-500 pt-2 border-t border-line">
                  <Calendar className="w-3 h-3 text-zinc-500" />
                  <span>Achieved: {pr.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
