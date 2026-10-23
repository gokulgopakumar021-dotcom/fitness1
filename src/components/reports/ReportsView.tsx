import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Calendar,
  Flame,
  Award,
  TrendingUp,
  Activity,
  CheckCircle,
  AlertCircle,
  ArrowUpRight,
  Filter,
  Dumbbell,
  Apple
} from 'lucide-react';
import {
  BodyMetricEntry,
  DailyNutritionLog,
  PersonalRecord,
  UserProfile,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { calculateEpley1RM, calculateVolumeLoad, formatWeight } from '../../utils/calculations';
import { LineChart, BarChart } from '../common/Charts';

interface ReportsViewProps {
  profile: UserProfile;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ profile }) => {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<DailyNutritionLog[]>([]);
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>([]);
  const [filterPeriod, setFilterPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    setSessions(db.getSessions().filter((s) => s.status === 'completed'));
    setNutritionLogs(db.getNutritionLogs());
    setMetrics(db.getBodyMetrics());
  }, []);

  const now = new Date();
  const getDaysBack = () => {
    if (filterPeriod === '7d') return 7;
    if (filterPeriod === '30d') return 30;
    if (filterPeriod === '90d') return 90;
    return 365;
  };

  const daysBack = getDaysBack();
  const cutoffDate = new Date(now.getTime() - daysBack * 24 * 3600 * 1000);

  // Filtered collections
  const filteredSessions = sessions.filter((s) => new Date(s.date) >= cutoffDate);
  const filteredNutrition = nutritionLogs.filter((n) => new Date(n.date) >= cutoffDate);
  const filteredMetrics = metrics.filter((m) => new Date(m.date) >= cutoffDate);

  // 1. Total sessions completed
  const totalCompletedSessions = filteredSessions.length;

  // 2. Training Volume Trend
  const volumeBySessionData = filteredSessions.map((s) => {
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

  const totalFilteredVolume = volumeBySessionData.reduce((acc, curr) => acc + curr.value, 0);

  // 3. Nutrition Adherence
  const loggedNutrDays = filteredNutrition.length;
  const avgCalories =
    loggedNutrDays > 0
      ? Math.round(
          filteredNutrition.reduce(
            (sum, n) => sum + n.entries.reduce((eSum, e) => eSum + (e.calories || 0), 0),
            0
          ) / loggedNutrDays
        )
      : 0;

  const avgProtein =
    loggedNutrDays > 0
      ? Math.round(
          filteredNutrition.reduce(
            (sum, n) => sum + n.entries.reduce((eSum, e) => eSum + (e.protein || 0), 0),
            0
          ) / loggedNutrDays
        )
      : 0;

  // 4. Personal Records Board
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

  const prList = Array.from(prMap.entries()).map(([name, data]) => ({
    name,
    maxWeight: data.maxWeight,
    best1RM: data.best1RM,
    date: data.date
  }));

  // 5. Weekly Summary Narrative Generation (based strictly on real recorded data)
  const generateObjectiveSummary = () => {
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
        improved.push(`Working-set volume load increased by ${((avgVol2 / avgVol1 - 1) * 100).toFixed(1)}% across sessions.`);
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
        improved.push(`Caloric adherence: averaging ${avgCalories} kcal/day within 150 kcal of target (${profile.dailyCalorieTarget}).`);
      } else {
        stable.push(`Average daily intake: ${avgCalories} kcal/day.`);
      }

      if (avgProtein >= profile.dailyProteinTarget * 0.9) {
        improved.push(`Protein intake: hitting ${avgProtein}g/day (target: ${profile.dailyProteinTarget}g).`);
      } else {
        attention.push(`Protein intake averaging ${avgProtein}g/day, which is below the ${profile.dailyProteinTarget}g target.`);
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
  };

  const summary = generateObjectiveSummary();

  // Weight Trend Data for Filtered Range
  const weightTrendData = filteredMetrics.map((m) => ({
    date: m.date,
    value: m.weightKg,
    label: `${m.weightKg} kg`
  }));

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
              <BarChart3 className="w-4 h-4" />
              <span>Performance Analytics</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-bold text-zinc-100">
              Training &amp; Body Reports
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Data-driven audit of your strength progression, volume load, and nutrition adherence.
            </p>
          </div>

          {/* Time Filter Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-lg self-start sm:self-auto">
            <button
              onClick={() => setFilterPeriod('7d')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterPeriod === '7d' ? 'bg-zinc-800 text-lime-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setFilterPeriod('30d')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterPeriod === '30d' ? 'bg-zinc-800 text-lime-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => setFilterPeriod('90d')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterPeriod === '90d' ? 'bg-zinc-800 text-lime-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              90 Days
            </button>
            <button
              onClick={() => setFilterPeriod('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterPeriod === 'all' ? 'bg-zinc-800 text-lime-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All Time
            </button>
          </div>
        </div>

        {/* Top 4 Stat Widgets */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Sessions Completed
            </span>
            <div className="text-2xl font-mono font-extrabold text-lime-400">
              {totalCompletedSessions}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">In selected window</div>
          </div>

          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Total Volume Load
            </span>
            <div className="text-2xl font-mono font-extrabold text-zinc-100">
              {totalFilteredVolume.toLocaleString()}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">{profile.preferredUnit} accumulated</div>
          </div>

          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Daily Calories (Avg)
            </span>
            <div className="text-2xl font-mono font-extrabold text-sky-400">
              {avgCalories > 0 ? `${avgCalories}` : '—'}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">
              Target: {profile.dailyCalorieTarget} kcal
            </div>
          </div>

          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Daily Protein (Avg)
            </span>
            <div className="text-2xl font-mono font-extrabold text-lime-400">
              {avgProtein > 0 ? `${avgProtein}g` : '—'}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">
              Target: {profile.dailyProteinTarget}g
            </div>
          </div>
        </div>
      </div>

      {/* WEEKLY AUDIT / PROGRESSION SUMMARY */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-zinc-800/80">
          <CheckCircle className="w-4 h-4 text-lime-400" />
          <h3 className="font-bold text-zinc-100 text-base">
            Verified Training &amp; Adherence Audit
          </h3>
        </div>

        {!summary.hasData ? (
          <div className="text-xs text-zinc-500 py-3">
            No training or metric data recorded yet. Record sessions to generate objective analysis.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* What Improved */}
            <div className="p-4 bg-zinc-900/50 border border-lime-500/30 rounded-xl space-y-2">
              <span className="text-[11px] font-mono font-bold text-lime-400 uppercase tracking-wider block">
                What Improved
              </span>
              {summary.improved.length > 0 ? (
                <ul className="space-y-1.5 text-zinc-300">
                  {summary.improved.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-lime-400">&bull;</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500">Collect more sessions to detect positive overload trends.</p>
              )}
            </div>

            {/* What Remained Stable */}
            <div className="p-4 bg-zinc-900/50 border border-zinc-800/80 rounded-xl space-y-2">
              <span className="text-[11px] font-mono font-bold text-sky-400 uppercase tracking-wider block">
                What Remained Stable
              </span>
              {summary.stable.length > 0 ? (
                <ul className="space-y-1.5 text-zinc-300">
                  {summary.stable.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-sky-400">&bull;</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500">No stability patterns flagged.</p>
              )}
            </div>

            {/* Needs Attention & Suggested Actions */}
            <div className="p-4 bg-zinc-900/50 border border-amber-500/30 rounded-xl space-y-2">
              <span className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider block">
                Needs Attention
              </span>
              {summary.attention.length > 0 ? (
                <ul className="space-y-1.5 text-zinc-300">
                  {summary.attention.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-amber-400">&bull;</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500">No negative recovery or volume deficits detected.</p>
              )}
              {summary.suggestedActions.length > 0 && (
                <div className="pt-2 border-t border-zinc-800 text-zinc-400 font-medium">
                  <span className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">
                    Suggested Next Action:
                  </span>
                  <p>{summary.suggestedActions[0]}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CHARTS: Volume Load Over Time & Body Weight */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl">
          <LineChart
            data={volumeBySessionData}
            title="Session Volume Load Progression"
            unit={profile.preferredUnit}
            accentColor="#a3e635"
            emptyMessage="No completed sessions in this date window"
          />
        </div>

        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl">
          <LineChart
            data={weightTrendData}
            title="Body Weight Over Time"
            unit={profile.preferredUnit}
            targetLine={profile.goalWeightKg}
            accentColor="#38bdf8"
            emptyMessage="No body weight entries recorded in this window"
          />
        </div>
      </div>

      {/* PERSONAL RECORDS (PR) HALL OF FAME */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-lime-400" />
            <h3 className="font-bold text-zinc-100 text-base">
              Personal Records (PR) Board
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-500">{prList.length} Exercises Tracked</span>
        </div>

        {prList.length === 0 ? (
          <div className="py-6 text-center text-zinc-500 text-xs">
            Complete working sets in your workouts to automatically register personal records.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {prList.map((pr) => (
              <div
                key={pr.name}
                className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1.5"
              >
                <div className="font-bold text-zinc-200 text-xs truncate">{pr.name}</div>
                <div className="flex items-center justify-between font-mono">
                  <div>
                    <span className="text-[10px] text-zinc-500 block">TOP LOAD</span>
                    <span className="text-base font-extrabold text-lime-400">
                      {pr.maxWeight} {profile.preferredUnit}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-zinc-500 block">EST. 1RM</span>
                    <span className="text-sm font-bold text-sky-400">
                      {pr.best1RM} {profile.preferredUnit}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-zinc-500 pt-1 border-t border-zinc-800/60">
                  Achieved: {pr.date}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
