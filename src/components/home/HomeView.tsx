import React, { useMemo } from 'react';
import {
  Flame,
  Dumbbell,
  TrendingUp,
  Apple,
  Activity,
  Bot,
  FileSpreadsheet,
  History,
  ShieldCheck,
  Play,
  ArrowRight,
  Zap,
  Target,
  CheckCircle2,
  Scale,
  Calendar,
  ChevronRight
} from 'lucide-react';
import {
  UserProfile,
  WorkoutSession,
  WorkoutPlan,
  DailyNutritionLog,
  BodyMetricEntry,
  ProgressiveOverloadRecommendation
} from '../../types';
import { db } from '../../storage/db';
import { NavTab } from '../layout/Navbar';
import { formatWeight, kgToLbs, calculateVolumeLoad } from '../../utils/calculations';
import { calculateMacroVariance } from '../../utils/nutritionConsistencyEngine';

interface HomeViewProps {
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  onNavigate: (tab: NavTab) => void;
  onResumeActiveSession: () => void;
  isDemoMode: boolean;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  profile,
  activeSession,
  onNavigate,
  onResumeActiveSession,
  isDemoMode,
  onLoadDemoData,
  onClearDemoData
}) => {
  const unit = profile.preferredUnit || 'kg';
  const todayKey = new Date().toISOString().split('T')[0];

  // Load live DB snapshot for HUD metrics
  const activePlan: WorkoutPlan | null = useMemo(() => {
    const plans = db.getPlans();
    const activeId = db.getActivePlanId();
    if (activeId) {
      const found = plans.find((p) => p.id === activeId);
      if (found) return found;
    }
    return plans.find((p) => p.isActive) || plans[0] || null;
  }, []);
  const allSessions: WorkoutSession[] = useMemo(() => db.getSessions(), []);
  const completedSessions = useMemo(
    () => allSessions.filter((s) => s.status === 'completed'),
    [allSessions]
  );
  const recommendations: ProgressiveOverloadRecommendation[] = useMemo(
    () => db.getRecommendations(),
    []
  );
  const pendingRecommendations = useMemo(
    () => recommendations.filter((r) => r.userAction === 'pending'),
    [recommendations]
  );
  const todayNutrition: DailyNutritionLog = useMemo(
    () => db.getNutritionLogForDate(todayKey),
    [todayKey]
  );
  const bodyMetrics: BodyMetricEntry[] = useMemo(() => db.getBodyMetrics(), []);

  // Compute live intake and macro variance for today
  const todayCalories = useMemo(() => {
    return (todayNutrition.entries || []).reduce(
      (sum, e) => sum + (Number(e.calories) || 0),
      0
    );
  }, [todayNutrition]);

  const todayProtein = useMemo(() => {
    return (todayNutrition.entries || []).reduce(
      (sum, e) => sum + (Number(e.protein) || 0),
      0
    );
  }, [todayNutrition]);

  const calorieTarget = todayNutrition.targetCalories > 0
    ? todayNutrition.targetCalories
    : profile.dailyCalorieTarget || 2200;

  const proteinTarget = todayNutrition.targetProtein > 0
    ? todayNutrition.targetProtein
    : profile.dailyProteinTarget || 160;

  const calVariance = useMemo(
    () => calculateMacroVariance(todayCalories, calorieTarget),
    [todayCalories, calorieTarget]
  );

  // Completed workouts this week
  const workoutsThisWeek = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setHours(0, 0, 0, 0);
    const startKey = startOfWeek.toISOString().split('T')[0];

    return completedSessions.filter((s) => s.date >= startKey);
  }, [completedSessions]);

  // Latest completed session
  const latestSession = useMemo(() => {
    if (completedSessions.length === 0) return null;
    return [...completedSessions].sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [completedSessions]);

  // Latest recorded weight
  const latestMetric = useMemo(() => {
    if (bodyMetrics.length === 0) return null;
    return [...bodyMetrics].sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [bodyMetrics]);

  // Time of day greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* 1. Header & System Status */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--border-card)] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] tracking-wider uppercase mb-1">
            <span>{formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span className="text-volt-adaptive font-semibold">Reshape OS v2.4</span>
            <span aria-hidden="true">·</span>
            <span>Local Ground Truth</span>
            {isDemoMode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-400 font-bold">[Demo Profile Active]</span>
              </>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--text-primary)]">
            {greeting}, {profile.name ? profile.name.split(' ')[0] : 'Athlete'}.
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-2xl leading-relaxed">
            Welcome to <strong className="text-[var(--text-primary)]">Iron Log</strong>. Your private, local-first fitness operating system designed for disciplined progressive overload, auto-regulated recovery, and empirical progress.
          </p>
        </div>

        {/* Demo Data Quick Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {isDemoMode ? (
            <button
              type="button"
              onClick={onClearDemoData}
              className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-muted)] hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              Clear Demo Records
            </button>
          ) : (
            <button
              type="button"
              onClick={onLoadDemoData}
              className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg bg-[var(--chip-bg)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-volt-adaptive hover:border-volt-adaptive/40 transition-colors"
            >
              Load Demo Athlete
            </button>
          )}
        </div>
      </div>

      {/* 2. Active Session Banner (if running) */}
      {activeSession && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#CEFF00]/15 via-volt-adaptive/5 to-transparent border border-volt-adaptive/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#CEFF00] text-black flex items-center justify-center shrink-0 font-bold shadow-md animate-pulse">
              <Play className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-volt-adaptive font-bold flex items-center gap-1.5">
                <span>Workout In Progress</span>
                <span aria-hidden="true">·</span>
                <span>Active Stopwatch</span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                {activeSession.exercises.length > 0
                  ? `Training Session · ${activeSession.exercises.length} Exercises Recorded`
                  : 'Active Workout Session'}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onResumeActiveSession}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#CEFF00] text-black font-mono font-bold text-xs uppercase tracking-wider hover:bg-[#CEFF00]/90 transition-transform active:scale-95 shadow-md shrink-0"
          >
            <span>Resume Session Tracker</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 3. Daily Command Deck (Quick Action Launchpad) */}
      <div className="reshape-card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-volt-adaptive" />
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[var(--text-primary)]">
              Quick Action Command Deck
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            1-Tap Destination Controls
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => onNavigate('workouts')}
            className="p-3.5 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/50 hover:bg-volt-adaptive/5 transition-all text-left group flex flex-col justify-between space-y-3"
          >
            <div className="w-8 h-8 rounded-lg bg-volt-adaptive/10 border border-volt-adaptive/30 flex items-center justify-center text-volt-adaptive group-hover:scale-105 transition-transform">
              <Dumbbell className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-volt-adaptive transition-colors">
                Log Workout
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Sets, reps & plate math
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('nutrition')}
            className="p-3.5 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-cyan-400/50 hover:bg-cyan-400/5 transition-all text-left group flex flex-col justify-between space-y-3"
          >
            <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
              <Apple className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-cyan-400 transition-colors">
                Log Fuel
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Calories, macros & water
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('progression')}
            className="p-3.5 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-[#CEFF00]/50 hover:bg-[#CEFF00]/5 transition-all text-left group flex flex-col justify-between space-y-3"
          >
            <div className="w-8 h-8 rounded-lg bg-[#CEFF00]/10 border border-[#CEFF00]/30 flex items-center justify-center text-volt-adaptive group-hover:scale-105 transition-transform">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-volt-adaptive transition-colors">
                Overload Engine
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {pendingRecommendations.length > 0
                  ? `${pendingRecommendations.length} jumps pending`
                  : 'Target weight jumps'}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('timeline')}
            className="p-3.5 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-amber-400/50 hover:bg-amber-400/5 transition-all text-left group flex flex-col justify-between space-y-3"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-amber-400 transition-colors">
                Timeline & Trends
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Long-term progress & consistency
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('trainer')}
            className="p-3.5 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-purple-400/50 hover:bg-purple-400/5 transition-all text-left group flex flex-col justify-between space-y-3 col-span-2 sm:col-span-1"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-400/10 border border-purple-400/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-purple-400 transition-colors">
                Adaptive Coach
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Video form check & guidance
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 4. Live Daily HUD Bento (3 Key Pillars) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pillar 1: Training Routine & Readiness */}
        <div className="reshape-card p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Dumbbell className="w-3.5 h-3.5 text-volt-adaptive" />
                <span>Training Program</span>
              </span>
              <span className="text-[11px] font-mono text-volt-adaptive font-bold">
                {workoutsThisWeek.length} / {profile.trainingDaysPerWeek || 4} days
              </span>
            </div>

            <h3 className="text-lg font-bold text-[var(--text-primary)]">
              {activePlan ? activePlan.name : profile.trainingSplitName || 'Active Routine'}
            </h3>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Phase: <strong className="text-[var(--text-primary)] font-mono uppercase">{profile.trainingPhase || 'Hypertrophy'}</strong>.
              Auto-regulated target RIR: <strong className="text-volt-adaptive font-mono">{profile.defaultTargetRir ?? 2}</strong>.
            </p>
          </div>

          <div className="pt-3 border-t border-[var(--border-card)] flex items-center justify-between">
            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              {completedSessions.length} all-time sessions
            </div>
            <button
              type="button"
              onClick={() => onNavigate('workouts')}
              className="text-xs font-mono font-bold text-volt-adaptive hover:underline inline-flex items-center gap-1"
            >
              <span>Workout Center</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pillar 2: Fuel & Macro Target Compliance */}
        <div className="reshape-card p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Apple className="w-3.5 h-3.5 text-cyan-400" />
                <span>Today's Nutrition</span>
              </span>
              <span className="text-[10px] font-mono font-bold text-cyan-400">
                ±10% Target Band
              </span>
            </div>

            <div>
              <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {todayCalories} <span className="text-xs font-normal text-[var(--text-muted)]">/ {calorieTarget} kcal</span>
              </div>
              <div className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                Protein: <strong className="text-volt-adaptive">{todayProtein}g</strong> / {proteinTarget}g target
              </div>
            </div>

            {/* Target band status */}
            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              {todayCalories === 0 ? (
                <span>No meals recorded yet today</span>
              ) : calVariance.isWithinTenPercent ? (
                <span className="text-volt-adaptive flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Within optimal ±10% target band
                </span>
              ) : calVariance.status === 'over' ? (
                <span className="text-amber-400">
                  +{calVariance.percentDelta}% above target
                </span>
              ) : (
                <span className="text-sky-400">
                  {calVariance.percentDelta}% below target
                </span>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-card)] flex items-center justify-between">
            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              Water: {todayNutrition.waterMl || 0} ml
            </div>
            <button
              type="button"
              onClick={() => onNavigate('nutrition')}
              className="text-xs font-mono font-bold text-cyan-400 hover:underline inline-flex items-center gap-1"
            >
              <span>Nutrition Diary</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pillar 3: Body Composition & Anthropometry */}
        <div className="reshape-card p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>Body Composition</span>
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Unit: {unit.toUpperCase()}
              </span>
            </div>

            <div>
              <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {latestMetric
                  ? (unit === 'lbs' ? Math.round(kgToLbs(latestMetric.weightKg) * 10) / 10 : latestMetric.weightKg)
                  : (unit === 'lbs' ? Math.round(kgToLbs(profile.currentWeightKg) * 10) / 10 : profile.currentWeightKg)}{' '}
                <span className="text-xs font-normal text-[var(--text-muted)]">{unit}</span>
              </div>
              <div className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                Goal:{' '}
                <strong className="text-[var(--text-primary)]">
                  {formatWeight(profile.goalWeightKg, unit)}
                </strong>{' '}
                · Goal: <span className="uppercase text-[11px]">{profile.primaryGoal.replace('_', ' ')}</span>
              </div>
            </div>

            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              {latestMetric ? `Latest weigh-in: ${latestMetric.date}` : 'Initial baseline registered'}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-card)] flex items-center justify-between">
            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              {bodyMetrics.length} weigh-ins logged
            </div>
            <button
              type="button"
              onClick={() => onNavigate('body')}
              className="text-xs font-mono font-bold text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              <span>Body Metrics</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 5. Core Operating System Capabilities Launchpad */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-card)] pb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <span>Operating System Modules</span>
              <span aria-hidden="true">·</span>
              <span className="text-volt-adaptive">All Capabilities</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Fitness OS Engine Directory
            </h2>
          </div>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Ground Truth Persistence Across Modules
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Module 1: Workout Session Tracker */}
          <div
            onClick={() => onNavigate('workouts')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-volt-adaptive/10 border border-volt-adaptive/30 flex items-center justify-center text-volt-adaptive group-hover:scale-105 transition-transform">
                <Dumbbell className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-volt-adaptive">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-volt-adaptive transition-colors">
                Workout Session Tracker
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Live working set recording, barbell plate calculator, warm-up ramp, and rest stopwatch.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              {completedSessions.length} completed sessions
            </div>
          </div>

          {/* Module 2: Progressive Overload Engine */}
          <div
            onClick={() => onNavigate('progression')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-cyan-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-cyan-400 transition-colors">
                Overload Recommendation Engine
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Algorithmic weight and rep increments based on performance, target RIR, and equipment constraints.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              {pendingRecommendations.length} pending recommendations
            </div>
          </div>

          {/* Module 3: Nutrition Goal Wizard & Diary */}
          <div
            onClick={() => onNavigate('nutrition')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <Apple className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-amber-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-amber-400 transition-colors">
                Nutrition Goal Wizard & TDEE
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Katch-McArdle LBM formula, Cut/Maintain/Bulk pace selector, and one-tap water logger.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              Target: {calorieTarget} kcal ({proteinTarget}g P)
            </div>
          </div>

          {/* Module 4: Progress Timeline & Consistency */}
          <div
            onClick={() => onNavigate('timeline')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-[#CEFF00]/10 border border-[#CEFF00]/30 flex items-center justify-center text-volt-adaptive group-hover:scale-105 transition-transform">
                <History className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-volt-adaptive">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-volt-adaptive transition-colors">
                Long-Term Progress Timeline
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Multi-period trend analysis, exercise strength curves, and ±10% macro consistency view.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              Ground truth historical records
            </div>
          </div>

          {/* Module 5: Muscle Recovery & Fatigue Heatmap */}
          <div
            onClick={() => onNavigate('dashboard')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-rose-400/10 border border-rose-400/30 flex items-center justify-center text-rose-400 group-hover:scale-105 transition-transform">
                <Flame className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-rose-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-rose-400 transition-colors">
                Muscle Fatigue Heatmap & Scorecard
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Anatomical fatigue dissipation model tracking fresh, recovering, and exhausted muscular tiers.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              Interactive 3D anatomical model
            </div>
          </div>

          {/* Module 6: AI Trainer & Video Form Check */}
          <div
            onClick={() => onNavigate('trainer')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-purple-400/10 border border-purple-400/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                <Bot className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-purple-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-purple-400 transition-colors">
                AI Coach & Video Form Library
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Adaptive coaching reviews, exercise technique clips, and dynamic warm-up prescription.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              Integrated biomechanics library
            </div>
          </div>

          {/* Module 7: Body Anthropometry & Tape Records */}
          <div
            onClick={() => onNavigate('body')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-sky-400/10 border border-sky-400/30 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                <Scale className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-sky-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-sky-400 transition-colors">
                Body Metrics & Silhouette Scanner
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Direct scale weight logging, waist circumference, and experimental on-device optical scanner.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              {bodyMetrics.length} recorded measurements
            </div>
          </div>

          {/* Module 8: Routine Plans & Spreadsheet Import */}
          <div
            onClick={() => onNavigate('plans')}
            className="p-4 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-volt-adaptive/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-emerald-400">
                Jump →
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-emerald-400 transition-colors">
                Routines & Spreadsheet Importer
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Structured split builder, starter routines (PPL, Upper/Lower), and custom spreadsheet parsing.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border-card)]">
              Active split: {activePlan?.name || 'Custom'}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Recent Historical Activity & Milestones */}
      <div className="reshape-card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-volt-adaptive" />
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-[var(--text-primary)]">
              Latest Recorded Ground Truth
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('timeline')}
            className="text-xs font-mono font-bold text-volt-adaptive hover:underline inline-flex items-center gap-1"
          >
            <span>Full History</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {latestSession ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] space-y-1">
              <div className="text-[10px] uppercase text-[var(--text-muted)]">Last Training Session</div>
              <div className="text-[var(--text-primary)] font-bold text-sm">{latestSession.date}</div>
              <div className="text-[var(--text-secondary)]">
                {latestSession.exercises.length} movements completed
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] space-y-1">
              <div className="text-[10px] uppercase text-[var(--text-muted)]">Session Volume Load</div>
              <div className="text-volt-adaptive font-bold text-sm">
                {Math.round(
                  (latestSession.exercises || []).reduce(
                    (sum, ex) => sum + calculateVolumeLoad(ex.sets || [], true),
                    0
                  )
                ).toLocaleString()}{' '}
                {unit}
              </div>
              <div className="text-[var(--text-secondary)]">Sum of working sets</div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--chip-bg)] border border-[var(--border-card)] space-y-1">
              <div className="text-[10px] uppercase text-[var(--text-muted)]">Active Progression</div>
              <div className="text-cyan-400 font-bold text-sm">
                {pendingRecommendations.length} Recommendations
              </div>
              <div className="text-[var(--text-secondary)]">Auto-calculated next weights</div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-[var(--text-muted)] reshape-card-subtle space-y-2">
            <p>No workout sessions logged yet.</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Click <strong className="text-volt-adaptive">"Log Workout"</strong> above to record your first working sets.
            </p>
          </div>
        )}
      </div>

      {/* 7. Data Integrity & Ground Truth Commitment Banner */}
      <div className="p-5 rounded-2xl bg-[var(--chip-bg)]/60 border border-[var(--border-card)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-volt-adaptive/10 border border-volt-adaptive/30 flex items-center justify-center shrink-0 text-volt-adaptive mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[var(--text-primary)]">
              Local-First Ground Truth Commitment
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-2xl leading-relaxed">
              Iron Log never generates synthetic progress or falsifies missing logs. All biometric data, workout records, and nutritional logs remain strictly on your local device.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className="px-4 py-2 text-xs font-mono font-bold rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-volt-adaptive transition-colors shrink-0"
        >
          Athlete Settings & Units →
        </button>
      </div>
    </div>
  );
};
