import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  ShieldCheck,
  AlertCircle,
  Calendar,
  Flame,
  Dumbbell,
  RefreshCw,
  CheckCircle2,
  BedDouble,
  ChevronRight,
  Info,
  HeartPulse,
  TrendingUp,
  Activity,
  Layers,
  Clock
} from 'lucide-react';
import {
  MuscleGroupRecovery,
  SystemicRecoveryData,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { calculateLocalRecoveryInsights } from '../../utils/recoveryAnalytics';
import { NavTab } from '../layout/Navbar';

interface AiRecoveryInsightsPanelProps {
  profile: UserProfile;
  recentSessions: WorkoutSession[];
  activePlan: WorkoutPlan | null;
  onNavigate: (tab: NavTab) => void;
}

export const AiRecoveryInsightsPanel: React.FC<AiRecoveryInsightsPanelProps> = ({
  profile,
  recentSessions,
  activePlan,
  onNavigate
}) => {
  const [recoveryData, setRecoveryData] = useState<SystemicRecoveryData | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState<boolean>(false);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'fatigued' | 'fresh'>('all');

  // Compute baseline local recovery analytics immediately
  useEffect(() => {
    const initial = calculateLocalRecoveryInsights(recentSessions, profile, activePlan);
    setRecoveryData(initial);
  }, [recentSessions, profile, activePlan]);

  const handleRunAiAnalysis = async () => {
    setIsLoadingAi(true);
    setAiError(null);

    try {
      const response = await fetch('/api/ai-recovery-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions: recentSessions,
          profile,
          activePlan
        })
      });

      const data = await response.json();

      if (data.success && data.recovery) {
        // Merge with local fallback if any fields are missing
        const aiRecovery = data.recovery;
        setRecoveryData((prev) => ({
          systemicFatigueScore: aiRecovery.systemicFatigueScore ?? prev?.systemicFatigueScore ?? 35,
          systemicFatigueLevel: aiRecovery.systemicFatigueLevel ?? prev?.systemicFatigueLevel ?? 'Optimal',
          overallReadiness: aiRecovery.overallReadiness ?? prev?.overallReadiness ?? 82,
          headline: aiRecovery.headline || prev?.headline || 'Recovery status synchronized',
          muscleRecovery: (aiRecovery.muscleRecovery && aiRecovery.muscleRecovery.length > 0)
            ? aiRecovery.muscleRecovery
            : prev?.muscleRecovery || [],
          optimalRestDays: {
            recommendedRestDays: aiRecovery.optimalRestDays?.recommendedRestDays || prev?.optimalRestDays.recommendedRestDays || ['Sunday'],
            isRestRecommendedToday: aiRecovery.optimalRestDays?.isRestRecommendedToday ?? prev?.optimalRestDays.isRestRecommendedToday ?? false,
            todayAdvice: aiRecovery.optimalRestDays?.todayAdvice || prev?.optimalRestDays.todayAdvice || 'Ready to train.',
            rationale: aiRecovery.optimalRestDays?.rationale || prev?.optimalRestDays.rationale || ''
          },
          suggestedNextWorkout: aiRecovery.suggestedNextWorkout || prev?.suggestedNextWorkout,
          recoveryTips: aiRecovery.recoveryTips || prev?.recoveryTips || [],
          lastCalculated: new Date().toISOString()
        }));
        setIsAiGenerated(true);
      } else {
        setAiError(data.error || 'Could not fetch AI recovery insights. Using biomechanical heuristic.');
      }
    } catch (err: any) {
      console.warn('AI Recovery API offline or failed, using local model:', err);
      setAiError('Gemini API is unavailable. Displaying local sports-science recovery calculation.');
    } finally {
      setIsLoadingAi(false);
    }
  };

  if (!recoveryData) return null;

  const {
    systemicFatigueScore,
    systemicFatigueLevel,
    overallReadiness,
    headline,
    muscleRecovery,
    optimalRestDays,
    suggestedNextWorkout,
    recoveryTips
  } = recoveryData;

  const isRestDayToday = optimalRestDays.isRestRecommendedToday;

  // Filter muscle groups
  const filteredMuscles = muscleRecovery.filter((m) => {
    if (filterMode === 'fatigued') return m.status !== 'fresh';
    if (filterMode === 'fresh') return m.status === 'fresh';
    return true;
  });

  const getStatusColor = (status: MuscleGroupRecovery['status']) => {
    switch (status) {
      case 'fresh':
        return 'text-lime-400 bg-lime-400/10 border-lime-400/30';
      case 'recovering':
        return 'text-sky-400 bg-sky-400/10 border-sky-400/30';
      case 'fatigued':
        return 'text-rose-400 bg-rose-400/10 border-rose-400/30';
    }
  };

  const getProgressBarColor = (status: MuscleGroupRecovery['status']) => {
    switch (status) {
      case 'fresh':
        return 'bg-lime-400';
      case 'recovering':
        return 'bg-sky-400';
      case 'fatigued':
        return 'bg-rose-400';
    }
  };

  const getBatteryIcon = (percentage: number) => {
    if (percentage >= 80) return <BatteryFull className="w-4 h-4 text-lime-400" />;
    if (percentage >= 50) return <BatteryMedium className="w-4 h-4 text-sky-400" />;
    return <BatteryLow className="w-4 h-4 text-rose-400" />;
  };

  return (
    <div className="rounded-3xl bg-[#08090c] border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl p-5 sm:p-7 space-y-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-lime-400/15 border border-lime-400/30 flex items-center justify-center text-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.15)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
              <span>Muscle Recovery &amp; Rest Day Insights</span>
              {isAiGenerated && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-lime-400/15 border border-lime-400/30 text-lime-300 font-bold uppercase tracking-wider">
                  Gemini AI Active
                </span>
              )}
            </h2>
          </div>
          <p className="text-xs text-zinc-400">
            Biomechanical recovery tracking analyzing {recentSessions.length} logged sessions to detect muscle fatigue patterns and schedule optimal rest.
          </p>
        </div>

        <button
          onClick={handleRunAiAnalysis}
          disabled={isLoadingAi}
          className="touch-press px-5 py-3 bg-gradient-to-r from-lime-400 to-lime-300 hover:from-lime-300 hover:to-lime-400 text-black font-black text-xs rounded-2xl shadow-[0_0_20px_rgba(163,230,53,0.25)] flex items-center justify-center gap-2 transition-all disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAi ? 'animate-spin' : ''}`} />
          <span>{isLoadingAi ? 'Analyzing Recovery...' : 'Run AI Recovery Analysis'}</span>
        </button>
      </div>

      {aiError && (
        <div className="p-3 bg-zinc-900/90 border border-amber-500/30 rounded-2xl flex items-center gap-2 text-xs text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{aiError}</span>
        </div>
      )}

      {/* TOP STATS: READINESS GAUGE & REST DAY RECOMMENDATION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Systemic Readiness & Fatigue Gauge */}
        <div className="p-4 bg-zinc-950/60 border border-white/[0.05] rounded-2xl space-y-3">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono font-semibold">
            <span className="flex items-center gap-1.5">
              <HeartPulse className="w-4 h-4 text-lime-400" />
              OVERALL READINESS
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
              overallReadiness >= 80
                ? 'text-lime-400 bg-lime-400/10'
                : overallReadiness >= 55
                ? 'text-sky-400 bg-sky-400/10'
                : 'text-rose-400 bg-rose-400/10'
            }`}>
              {overallReadiness}%
            </span>
          </div>

          <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                overallReadiness >= 80 ? 'bg-lime-400' : overallReadiness >= 55 ? 'bg-sky-400' : 'bg-rose-400'
              }`}
              style={{ width: `${overallReadiness}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>CNS Fatigue: <strong className="text-zinc-200">{systemicFatigueLevel} ({systemicFatigueScore}/100)</strong></span>
            <span>Trend: <strong className="text-lime-400">Optimal</strong></span>
          </div>
        </div>

        {/* REST DAY ADVICE CARD (KEY FEATURE) */}
        <div className={`p-4 rounded-2xl border space-y-2 md:col-span-2 ${
          isRestDayToday
            ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
            : 'bg-zinc-950/60 border-white/[0.05] text-zinc-200'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isRestDayToday ? (
                <BedDouble className="w-4 h-4 text-amber-400 animate-pulse" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-lime-400" />
              )}
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                Optimal Rest Day Strategy
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400">Target Rest Days:</span>
              <div className="flex items-center gap-1 font-mono text-xs">
                {optimalRestDays.recommendedRestDays.map((day) => (
                  <span
                    key={day}
                    className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/80 text-zinc-200 text-[10px] font-bold"
                  >
                    {day}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs leading-relaxed font-sans text-zinc-300">
            {optimalRestDays.todayAdvice}
          </p>

          <p className="text-[11px] text-zinc-400 leading-normal border-t border-zinc-800/60 pt-2 font-mono">
            {optimalRestDays.rationale}
          </p>
        </div>
      </div>

      {/* SUGGESTED NEXT WORKOUT ACCORDING TO RECOVERY */}
      {suggestedNextWorkout && (
        <div className="p-4 bg-gradient-to-r from-zinc-900/90 via-zinc-900/60 to-zinc-950 border border-lime-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Dumbbell className="w-3.5 h-3.5 text-lime-400" />
              <span className="text-[11px] font-mono text-lime-400 uppercase font-bold tracking-wider">
                Recommended Next Routine
              </span>
            </div>
            <div className="text-sm font-bold text-zinc-100">
              {suggestedNextWorkout.splitDay}
            </div>
            <p className="text-[11px] text-zinc-400">
              {suggestedNextWorkout.reasoning}
            </p>
          </div>

          <button
            onClick={() => onNavigate('workouts')}
            className="touch-press px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-lime-400 font-bold rounded-lg border border-zinc-700 transition-colors flex items-center gap-1.5 self-start sm:self-auto shrink-0 text-xs"
          >
            <span>Log This Session</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MUSCLE GROUP RECOVERY CARDS */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-400" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
              Muscle Group Recovery Status ({filteredMuscles.length} Groups)
            </h3>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterMode === 'all' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({muscleRecovery.length})
            </button>
            <button
              onClick={() => setFilterMode('fatigued')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterMode === 'fatigued' ? 'bg-zinc-800 text-amber-300 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Fatigued / Recovering ({muscleRecovery.filter((m) => m.status !== 'fresh').length})
            </button>
            <button
              onClick={() => setFilterMode('fresh')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterMode === 'fresh' ? 'bg-zinc-800 text-lime-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Fresh ({muscleRecovery.filter((m) => m.status === 'fresh').length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredMuscles.map((muscle) => {
            const isSelected = selectedMuscle === muscle.muscleGroup;
            return (
              <div
                key={muscle.muscleGroup}
                onClick={() => setSelectedMuscle(isSelected ? null : muscle.muscleGroup)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-900 border-lime-400/60 shadow-lg'
                    : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/80'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getBatteryIcon(muscle.recoveryPercentage)}
                    <span className="font-bold text-zinc-200 text-xs sm:text-sm">
                      {muscle.muscleGroup}
                    </span>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${getStatusColor(muscle.status)}`}>
                    {muscle.status} &middot; {muscle.recoveryPercentage}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-zinc-800/80 h-2 rounded-full overflow-hidden my-2">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getProgressBarColor(muscle.status)}`}
                    style={{ width: `${muscle.recoveryPercentage}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    {muscle.hoursSinceLastTrained !== undefined
                      ? `${muscle.hoursSinceLastTrained}h ago`
                      : 'Not trained recently'}
                  </span>
                  <span>
                    {muscle.recoveryHoursRemaining > 0
                      ? `~${muscle.recoveryHoursRemaining}h to full`
                      : 'Fully Recovered'}
                  </span>
                </div>

                {/* Expanded details when clicked */}
                {isSelected && (
                  <div className="mt-3 pt-2.5 border-t border-zinc-800 text-[11px] space-y-1.5 animate-in fade-in duration-150">
                    <div className="text-zinc-400 flex items-center justify-between">
                      <span>7-Day Volume:</span>
                      <strong className="text-zinc-200 font-mono">{muscle.totalSetsLast7Days} working sets</strong>
                    </div>
                    {muscle.exercisesTrained.length > 0 && (
                      <div className="text-zinc-400">
                        <span>Contributing Movements: </span>
                        <span className="text-zinc-300 font-medium">
                          {muscle.exercisesTrained.join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-zinc-400 italic">
                      {muscle.status === 'fresh'
                        ? 'Muscle fibers fully regenerated. Ready for high-load overload stimulus.'
                        : muscle.status === 'recovering'
                        ? 'Hypertrophy protein remodeling in progress. Allow designated rest interval before heavy re-loading.'
                        : 'Significant microtrauma and fatigue. High DOMS likelihood; postpone direct loading.'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RECOVERY EVIDENCE & ACTIONABLE TIPS */}
      <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl space-y-2">
        <div className="flex items-center gap-2 text-zinc-400 text-xs font-mono font-bold uppercase">
          <Activity className="w-3.5 h-3.5 text-lime-400" />
          <span>Evidence-Based Recovery Protocol</span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
          {recoveryTips.map((tip, idx) => (
            <li
              key={idx}
              className="p-2.5 bg-zinc-950/60 border border-zinc-800/80 rounded-lg text-[11px] text-zinc-300 leading-relaxed flex items-start gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-lime-400 shrink-0 mt-0.5" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
