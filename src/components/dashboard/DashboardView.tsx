import React, { useState, useEffect } from 'react';
import {
  Flame,
  Dumbbell,
  TrendingUp,
  Apple,
  Activity,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Play,
  Calendar,
  Sparkles,
  Award,
  Zap,
  ChevronRight,
  Bot,
  Bluetooth,
  Eye,
  Trophy,
  Gauge,
  HeartPulse,
  BatteryCharging
} from 'lucide-react';
import {
  BodyMetricEntry,
  DailyNutritionLog,
  ProgressiveOverloadRecommendation,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import {
  calculateBMI,
  calculateWeeklyAverageWeight,
  calculateVolumeLoad,
  formatWeight
} from '../../utils/calculations';
import { NavTab } from '../layout/Navbar';
import { AiRecoveryInsightsPanel } from './AiRecoveryInsightsPanel';
import { GymConsistencyStreakCalendar } from './GymConsistencyStreakCalendar';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from '../trainer/DynamicWarmupModal';
import { DreamPhysiqueModal } from '../trainer/DreamPhysiqueModal';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';

interface DashboardProps {
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  onNavigate: (tab: NavTab) => void;
  onResumeActiveSession: () => void;
  isDemoMode: boolean;
  onLoadDemoData: () => void;
}

export const DashboardView: React.FC<DashboardProps> = ({
  profile,
  activeSession,
  onNavigate,
  onResumeActiveSession,
  isDemoMode,
  onLoadDemoData
}) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [activePlan, setActivePlan] = useState<WorkoutPlan | null>(null);
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [todayNutrition, setTodayNutrition] = useState<DailyNutritionLog | null>(null);
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>([]);
  const [pendingRecommendations, setPendingRecommendations] = useState<
    ProgressiveOverloadRecommendation[]
  >([]);
  const [postureModalExercise, setPostureModalExercise] = useState<string | null>(null);
  const [isWarmupModalOpen, setIsWarmupModalOpen] = useState<boolean>(false);
  const [isDreamPhysiqueOpen, setIsDreamPhysiqueOpen] = useState<boolean>(false);
  const { setIsGadgetModalOpen, isConnected, liveHeartRate } = useBluetoothGadget();

  useEffect(() => {
    const loadedPlans = db.getPlans();
    setPlans(loadedPlans);
    const activeId = db.getActivePlanId();
    const curr = loadedPlans.find((p) => p.id === activeId) || loadedPlans[0] || null;
    setActivePlan(curr);

    const sessions = db.getSessions().filter((s) => s.status === 'completed');
    setRecentSessions(sessions);

    const todayStr = new Date().toISOString().split('T')[0];
    setTodayNutrition(db.getNutritionLogForDate(todayStr));

    setMetrics(db.getBodyMetrics());
    setPendingRecommendations(db.getRecommendations().filter((r) => r.userAction === 'pending'));
  }, []);

  // Onboarding checklist steps
  const hasProfile = Boolean(profile.name && profile.name.trim().length > 0);
  const hasActivePlan = Boolean(activePlan);
  const hasCompletedSession = recentSessions.length > 0;
  const hasLoggedWeight = metrics.length > 0;
  const hasLoggedNutrition = Boolean(todayNutrition && todayNutrition.entries.length > 0);

  const checklistItems = [
    { label: 'Set up athlete profile & biometrics', done: hasProfile, tab: 'settings' as NavTab },
    { label: 'Select or upload active workout plan', done: hasActivePlan, tab: 'plans' as NavTab },
    { label: 'Log your first completed gym session', done: hasCompletedSession, tab: 'workouts' as NavTab },
    { label: 'Log morning body weight & BMI', done: hasLoggedWeight, tab: 'body' as NavTab },
    { label: 'Track daily meals & protein intake', done: hasLoggedNutrition, tab: 'nutrition' as NavTab }
  ];

  const completedChecklistCount = checklistItems.filter((i) => i.done).length;
  const checklistPercent = Math.round((completedChecklistCount / checklistItems.length) * 100);

  // Today nutrition calculations
  const totalCal = todayNutrition
    ? todayNutrition.entries.reduce((acc, curr) => acc + (curr.calories || 0), 0)
    : 0;
  const totalPro = todayNutrition
    ? todayNutrition.entries.reduce((acc, curr) => acc + (curr.protein || 0), 0)
    : 0;
  const calTarget = profile.dailyCalorieTarget || 2600;
  const proTarget = profile.dailyProteinTarget || 165;
  const calorieProgress = Math.min(100, Math.round((totalCal / calTarget) * 100));

  // Body weight calculation
  const currentBMI = calculateBMI(profile.currentWeightKg, profile.heightCm);
  const weeklyAvg = calculateWeeklyAverageWeight(metrics);

  // Weekly consistency (last 7 days sessions count)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sessionsLast7Days = recentSessions.filter((s) => new Date(s.date) >= sevenDaysAgo).length;

  // Total lifetime volume for athletic level progression
  const totalLifetimeVolume = recentSessions.reduce((acc, s) => {
    return acc + calculateVolumeLoad(s.exercises.flatMap((e) => e.sets));
  }, 0);

  // Reshape athletic tier ladder
  const RESHAPE_TIERS = [
    { name: 'Foundational', minVol: 0, maxVol: 25000, color: '#facc15', label: 'Tier I · Bronze' },
    { name: 'Progressive', minVol: 25000, maxVol: 100000, color: '#fb923c', label: 'Tier II · Copper' },
    { name: 'Disciplined', minVol: 100000, maxVol: 500000, color: '#4ade80', label: 'Tier III · Silver' },
    { name: 'Advanced', minVol: 500000, maxVol: 1500000, color: '#38bdf8', label: 'Tier IV · Cyan' },
    { name: 'Elite Master', minVol: 1500000, maxVol: 5000000, color: '#c084fc', label: 'Tier V · Platinum' },
    { name: 'Reshape Titan', minVol: 5000000, maxVol: Infinity, color: '#CEFF00', label: 'Reshape Titan' }
  ];

  let currentLevelIdx = 0;
  for (let i = RESHAPE_TIERS.length - 1; i >= 0; i--) {
    if (totalLifetimeVolume >= RESHAPE_TIERS[i].minVol) {
      currentLevelIdx = i;
      break;
    }
  }
  const currentLevel = RESHAPE_TIERS[currentLevelIdx];
  const nextLevel = RESHAPE_TIERS[currentLevelIdx + 1] || null;
  const levelProgress = nextLevel
    ? Math.min(100, Math.round(((totalLifetimeVolume - currentLevel.minVol) / (nextLevel.minVol - currentLevel.minVol)) * 100))
    : 100;
  const volToNext = nextLevel ? Math.max(0, nextLevel.minVol - totalLifetimeVolume) : 0;

  // Calculated Dynamic Daily Readiness Score (Reshape / WHOOP 4.0 style)
  const readinessScore = Math.min(98, Math.max(72, Math.round(84 + (sessionsLast7Days >= 3 ? 8 : -4) + (checklistPercent > 80 ? 4 : 0))));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* RESHAPE HERO COMMAND HUB */}
      <div className="reshape-card p-6 lg:p-8 overflow-hidden">
        {/* Specular Radial Ambience */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-[#CEFF00]/[0.04] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-sky-500/[0.03] rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-7 border-b border-white/[0.07]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#CEFF00] shadow-[0_0_8px_#CEFF00] animate-pulse" />
              <span className="text-[11px] font-mono tracking-widest text-[#CEFF00] font-bold uppercase">
                ATHLETE PERFORMANCE RADAR
              </span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-nrc font-black italic text-white uppercase tracking-tight">
              {profile.name ? `${profile.name}` : 'ATHLETE DISCIPLINE'}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-xl font-sans leading-relaxed">
              Precision double-overload tracking, AI recovery guidance, and automated nutritional balance.
            </p>
          </div>

          {/* Reshape High-Visibility Hero Action */}
          <div className="flex items-center gap-3 shrink-0">
            {activeSession ? (
              <button
                onClick={onResumeActiveSession}
                className="touch-press px-6 py-3.5 bg-[#CEFF00] hover:bg-[#d8ff1a] text-black font-nrc font-black italic uppercase text-base sm:text-lg rounded-2xl shadow-[0_0_30px_rgba(206,255,0,0.35)] flex items-center justify-center gap-2 transition-all group"
              >
                <Play className="w-5 h-5 fill-black" />
                <span>Resume Workout</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            ) : (
              <button
                onClick={() => onNavigate('workouts')}
                className="touch-press px-7 py-3.5 bg-[#CEFF00] hover:bg-[#d8ff1a] text-black font-nrc font-black italic uppercase text-base sm:text-lg rounded-2xl shadow-[0_0_30px_rgba(206,255,0,0.35)] flex items-center justify-center gap-2.5 transition-all group"
              >
                <Dumbbell className="w-5 h-5 stroke-[2.5]" />
                <span>Start Workout</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            )}
          </div>
        </div>

        {/* Reshape Signature 4-Metric Bento Deck */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6">
          {/* 1. Daily Readiness Dial */}
          <div
            onClick={() => onNavigate('reports')}
            className="reshape-card-interactive p-4 sm:p-5 cursor-pointer flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase font-bold tracking-wider mb-2">
              <span>Readiness</span>
              <HeartPulse className="w-4 h-4 text-[#CEFF00]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-nrc font-black italic text-white tabular-nums">
                {readinessScore}
              </span>
              <span className="text-xs font-mono text-[#CEFF00] font-bold">/ 100</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-2 font-sans flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Optimal training capacity</span>
            </div>
          </div>

          {/* 2. Consistency Target */}
          <div
            onClick={() => onNavigate('reports')}
            className="reshape-card-interactive p-4 sm:p-5 cursor-pointer flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase font-bold tracking-wider mb-2">
              <span>7D Frequency</span>
              <Calendar className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-nrc font-black italic text-white tabular-nums">
                {sessionsLast7Days}
              </span>
              <span className="text-xs font-mono text-zinc-500 font-normal">/ {profile.trainingDaysPerWeek}d target</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-2 font-sans">
              {sessionsLast7Days >= profile.trainingDaysPerWeek ? (
                <span className="text-[#CEFF00] font-semibold">Weekly quota satisfied</span>
              ) : (
                <span>{profile.trainingDaysPerWeek - sessionsLast7Days} sessions to goal</span>
              )}
            </div>
          </div>

          {/* 3. Nutrition & Protein Fuel */}
          <div
            onClick={() => onNavigate('nutrition')}
            className="reshape-card-interactive p-4 sm:p-5 cursor-pointer flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase font-bold tracking-wider mb-2">
              <span>Fuel Targets</span>
              <Apple className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-bold text-white tabular-nums">
                {totalCal}
              </span>
              <span className="text-xs font-mono text-zinc-500 font-normal">/ {calTarget} kcal</span>
            </div>
            <div className="text-[11px] text-sky-300 font-sans mt-2 font-semibold truncate">
              {totalPro}g / {proTarget}g protein ({calorieProgress}%)
            </div>
          </div>

          {/* 4. Body Recomp & BMI */}
          <div
            onClick={() => onNavigate('body')}
            className="reshape-card-interactive p-4 sm:p-5 cursor-pointer flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase font-bold tracking-wider mb-2">
              <span>Body Metrics</span>
              <Activity className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-bold text-white tabular-nums">
                {profile.currentWeightKg}
              </span>
              <span className="text-xs font-mono text-zinc-500 font-normal">{profile.preferredUnit}</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-2 font-sans truncate">
              BMI: <strong className="text-[#CEFF00] font-mono font-bold">{currentBMI}</strong>
              {weeklyAvg && ` · 7d: ${weeklyAvg}`}
            </div>
          </div>
        </div>
      </div>

      {/* RESHAPE ATHLETIC PROGRESSION TIER STRIP */}
      <div className="reshape-card p-5 sm:p-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div
              className="w-3.5 h-3.5 rounded-full shadow-[0_0_10px_currentColor]"
              style={{ backgroundColor: currentLevel.color, color: currentLevel.color }}
            />
            <div>
              <div className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                Volume Prestige Tier
              </div>
              <div className="text-lg font-nrc font-black italic uppercase text-white tracking-wide">
                Level: <span style={{ color: currentLevel.color }}>{currentLevel.label}</span>
              </div>
            </div>
          </div>
          <div className="text-xs font-mono text-zinc-400">
            Total Tonnage: <strong className="text-white font-bold">{totalLifetimeVolume.toLocaleString()} {profile.preferredUnit}</strong>
          </div>
        </div>

        {/* Crisp Linear Progress Bar */}
        <div className="space-y-1.5 pt-1">
          <div className="w-full bg-[#0a0d14] h-2.5 rounded-full overflow-hidden border border-white/[0.06] p-0.5">
            <div
              className="h-full rounded-full transition-all duration-700 shadow-sm"
              style={{
                width: `${levelProgress}%`,
                backgroundColor: currentLevel.color
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>{levelProgress}% towards {nextLevel ? nextLevel.label : 'Maximum Prestige'}</span>
            {nextLevel && (
              <span>{volToNext.toLocaleString()} {profile.preferredUnit} remaining</span>
            )}
          </div>
        </div>
      </div>

      {/* GYM CONSISTENCY STREAK CALENDAR */}
      <GymConsistencyStreakCalendar
        sessions={recentSessions}
        profile={profile}
        onNavigateToWorkouts={() => onNavigate('workouts')}
      />

      {/* AI-POWERED RECOVERY INSIGHTS & REST DAYS */}
      <AiRecoveryInsightsPanel
        profile={profile}
        recentSessions={recentSessions}
        activePlan={activePlan}
        onNavigate={onNavigate}
      />

      {/* ONBOARDING CHECKLIST (IF NOT YET 100%) */}
      {checklistPercent < 100 && (
        <div className="reshape-card p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Calibration Checklist ({checklistPercent}%)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Complete these initial milestones to customize your progressive overload engine.
              </p>
            </div>
            <div className="text-xs font-mono font-bold text-[#CEFF00]">
              {completedChecklistCount} / {checklistItems.length} Done
            </div>
          </div>

          <div className="w-full bg-[#0a0d14] h-2 rounded-full overflow-hidden border border-white/[0.04]">
            <div
              className="bg-[#CEFF00] h-full rounded-full transition-all duration-500"
              style={{ width: `${checklistPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {checklistItems.map((item, idx) => (
              <div
                key={idx}
                onClick={() => onNavigate(item.tab)}
                className={`p-3.5 rounded-2xl border flex items-center justify-between cursor-pointer text-xs transition-colors ${
                  item.done
                    ? 'bg-[#0a0d14]/50 border-white/[0.04] text-zinc-500'
                    : 'bg-[#0e121a] border-white/[0.08] hover:border-[#CEFF00]/40 text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      item.done ? 'bg-[#CEFF00]/20 text-[#CEFF00]' : 'border border-zinc-600'
                    }`}
                  >
                    {item.done && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                  <span className={item.done ? 'line-through text-zinc-500' : 'font-medium'}>
                    {item.label}
                  </span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PROGRESSIVE OVERLOAD ALERTS BANNER (IF PENDING RECOMMENDATIONS) */}
      {pendingRecommendations.length > 0 && (
        <div className="reshape-card p-5 sm:p-6 border-[#CEFF00]/30 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-[#CEFF00] fill-[#CEFF00]" />
              <h3 className="font-bold text-white text-sm sm:text-base">
                Overload Recommendations Calibrated ({pendingRecommendations.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('progression')}
              className="text-xs text-[#CEFF00] hover:underline font-bold font-mono uppercase tracking-wide"
            >
              Review All &rarr;
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pendingRecommendations.slice(0, 2).map((rec) => (
              <div
                key={rec.id}
                onClick={() => onNavigate('progression')}
                className="p-3.5 bg-[#0a0d14] border border-white/[0.07] hover:border-[#CEFF00]/50 rounded-2xl cursor-pointer text-xs transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-200">{rec.exerciseName}</span>
                  <span className="font-mono text-[10px] text-[#CEFF00] font-bold">
                    +{(rec.recommendedWeight - rec.currentWeight).toFixed(1)} {profile.preferredUnit}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-2">{rec.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QUICK LAUNCH RESHAPE BENTO GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Workouts */}
        <div
          onClick={() => onNavigate('workouts')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group"
        >
          <div className="w-11 h-11 rounded-2xl bg-[#CEFF00]/10 border border-[#CEFF00]/25 flex items-center justify-center text-[#CEFF00] group-hover:scale-105 transition-transform">
            <Dumbbell className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-[#CEFF00] transition-colors">
              Session Logger
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Real-time set tracker, target RIR calibration, rest countdown timer, and automatic set completion.
            </p>
          </div>
        </div>

        {/* Progression */}
        <div
          onClick={() => onNavigate('progression')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group"
        >
          <div className="w-11 h-11 rounded-2xl bg-[#CEFF00]/10 border border-[#CEFF00]/25 flex items-center justify-center text-[#CEFF00] group-hover:scale-105 transition-transform">
            <TrendingUp className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-[#CEFF00] transition-colors">
              Double Progression Engine
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Deterministic overload recommendations (Rules A, B, C, D) calculated across all working sets.
            </p>
          </div>
        </div>

        {/* Nutrition */}
        <div
          onClick={() => onNavigate('nutrition')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group"
        >
          <div className="w-11 h-11 rounded-2xl bg-sky-400/10 border border-sky-400/25 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
            <Apple className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-sky-300 transition-colors">
              Macro Food Diary &amp; Barcode
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Live barcode scanning, Open Food Facts normalization, bodybuilding staples, and protein tracking.
            </p>
          </div>
        </div>

        {/* Body Metrics */}
        <div
          onClick={() => onNavigate('body')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group"
        >
          <div className="w-11 h-11 rounded-2xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
            <Activity className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-amber-300 transition-colors">
              Body Composition &amp; BMI
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              7-day smoothed rolling averages, BMI demographic categorizations, and silhouette ratio analysis.
            </p>
          </div>
        </div>

        {/* Coach Iron AI Personal Trainer */}
        <div
          onClick={() => onNavigate('trainer')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group border-[#CEFF00]/25"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-[#CEFF00]/15 border border-[#CEFF00]/30 flex items-center justify-center text-[#CEFF00] group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase text-[#CEFF00] tracking-wider">
              AI Coach
            </span>
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-[#CEFF00] transition-colors">
              Coach Iron · AI Coach
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Interactive consultation, customized 5-minute warm-ups, and physique recomposition blueprints.
            </p>
          </div>
        </div>

        {/* Posture & Form Preview */}
        <div
          onClick={() => setPostureModalExercise('Barbell Back Squat')}
          className="reshape-card-interactive p-5 sm:p-6 cursor-pointer space-y-3 group border-sky-400/25"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-sky-400/15 border border-sky-400/30 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Eye className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase text-sky-400 tracking-wider">
              Biomechanics
            </span>
          </div>
          <div>
            <h4 className="font-bold text-white text-base group-hover:text-sky-300 transition-colors">
              Biomechanics &amp; Posture
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Biomechanical mannequin, joint angle visualization, common failure cues, and safety guidelines.
            </p>
          </div>
        </div>
      </div>

      {/* Posture & Form Preview Modal */}
      {postureModalExercise && (
        <ExercisePostureModal
          exerciseName={postureModalExercise}
          isOpen={Boolean(postureModalExercise)}
          onClose={() => setPostureModalExercise(null)}
          profile={profile}
        />
      )}

      {/* Demo Mode Prompt */}
      {!isDemoMode && recentSessions.length === 0 && (
        <div className="reshape-card-subtle p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-300">
              Want to preview the Reshape experience with populated session history, progression logs, and nutrition metrics?
            </span>
          </div>
          <button
            onClick={onLoadDemoData}
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-amber-300 font-semibold rounded-xl text-xs shrink-0 transition-colors border border-amber-400/30"
          >
            Load Demo Data Preview
          </button>
        </div>
      )}
    </div>
  );
};
