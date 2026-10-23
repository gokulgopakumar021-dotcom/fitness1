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
  Eye
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

  // Body weight calculation
  const currentBMI = calculateBMI(profile.currentWeightKg, profile.heightCm);
  const weeklyAvg = calculateWeeklyAverageWeight(metrics);

  // Weekly consistency (last 7 days sessions count)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sessionsLast7Days = recentSessions.filter((s) => new Date(s.date) >= sevenDaysAgo).length;

  // Total lifetime volume for Nike Run Club level progression
  const totalLifetimeVolume = recentSessions.reduce((acc, s) => {
    return acc + calculateVolumeLoad(s.exercises.flatMap((e) => e.sets));
  }, 0);

  // Nike Run Club iconic color levels
  const NRC_LEVELS = [
    { name: 'Yellow Level', minVol: 0, maxVol: 25000, color: '#facc15', label: 'Yellow Level' },
    { name: 'Orange Level', minVol: 25000, maxVol: 100000, color: '#fb923c', label: 'Orange Level' },
    { name: 'Green Level', minVol: 100000, maxVol: 500000, color: '#4ade80', label: 'Green Level' },
    { name: 'Blue Level', minVol: 500000, maxVol: 1500000, color: '#38bdf8', label: 'Blue Level' },
    { name: 'Purple Level', minVol: 1500000, maxVol: 5000000, color: '#c084fc', label: 'Purple Level' },
    { name: 'Black Level', minVol: 5000000, maxVol: 10000000, color: '#e4e4e7', label: 'Black Level' },
    { name: 'Volt Level', minVol: 10000000, maxVol: Infinity, color: '#CEFF00', label: 'Volt Elite' }
  ];

  let currentLevelIdx = 0;
  for (let i = NRC_LEVELS.length - 1; i >= 0; i--) {
    if (totalLifetimeVolume >= NRC_LEVELS[i].minVol) {
      currentLevelIdx = i;
      break;
    }
  }
  const currentLevel = NRC_LEVELS[currentLevelIdx];
  const nextLevel = NRC_LEVELS[currentLevelIdx + 1] || null;
  const levelProgress = nextLevel
    ? Math.min(100, Math.round(((totalLifetimeVolume - currentLevel.minVol) / (nextLevel.minVol - currentLevel.minVol)) * 100))
    : 100;
  const volToNext = nextLevel ? Math.max(0, nextLevel.minVol - totalLifetimeVolume) : 0;

  return (
    <div className="space-y-7 max-w-5xl mx-auto">
      {/* HERO / WELCOME COMMAND CARD - APPLE & NIKE FITNESS AESTHETIC */}
      <div className="relative rounded-3xl bg-gradient-to-br from-[#0c0f16] via-[#07090d] to-[#040507] border border-white/[0.08] p-5 sm:p-7 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl overflow-hidden">
        {/* Subtle radial ambient glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-lime-400/[0.06] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-sky-400/[0.04] rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5 pb-6 border-b border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-bold tracking-widest uppercase mb-1.5">
              <Flame className="w-4 h-4 fill-lime-400" />
              <span>Personal Fitness Operating System</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
              {profile.name ? `Welcome back, ${profile.name}` : 'Welcome to IRON LOG'}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-xl leading-relaxed">
              Real-time progressive overload, biomechanical posture intelligence, and streak discipline.
            </p>
          </div>

          {/* Primary Action Button - Nike / Apple Fitness High Impact Style */}
          {activeSession ? (
            <button
              onClick={onResumeActiveSession}
              className="touch-press px-6 py-4 bg-gradient-to-r from-lime-400 to-lime-300 hover:from-lime-300 hover:to-lime-400 text-black font-black text-sm rounded-2xl shadow-[0_0_30px_rgba(163,230,53,0.35)] flex items-center justify-center gap-2 transition-all shrink-0 group"
            >
              <Play className="w-4 h-4 fill-black" />
              <span>Resume Active Workout &rarr;</span>
            </button>
          ) : (
            <button
              onClick={() => onNavigate('workouts')}
              className="touch-press px-7 py-4 bg-gradient-to-r from-lime-400 to-lime-300 hover:from-lime-300 hover:to-lime-400 text-black font-black text-sm rounded-2xl shadow-[0_0_30px_rgba(163,230,53,0.35)] flex items-center justify-center gap-2.5 transition-all shrink-0 group"
            >
              <Dumbbell className="w-4 h-4 stroke-[3]" />
              <span>Start Today&apos;s Workout &rarr;</span>
            </button>
          )}
        </div>

        {/* 4 Primary High-Level Stat Widgets - Apple Fitness Glass Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-6">
          {/* Consistency */}
          <div
            onClick={() => onNavigate('reports')}
            className="group p-4 bg-zinc-950/60 border border-white/[0.05] hover:border-lime-400/40 rounded-2xl cursor-pointer transition-all hover:bg-zinc-900/40 shadow-sm"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono mb-1.5 uppercase font-bold tracking-wider">
              <span>7D Consistency</span>
              <Calendar className="w-3.5 h-3.5 text-lime-400" />
            </div>
            <div className="text-2xl font-mono font-black text-white">
              {sessionsLast7Days}{' '}
              <span className="text-xs text-zinc-500 font-normal font-mono">/ {profile.trainingDaysPerWeek}d</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 font-sans">
              {sessionsLast7Days >= profile.trainingDaysPerWeek ? (
                <span className="text-lime-400 font-bold">Target achieved</span>
              ) : (
                <span>Sessions logged</span>
              )}
            </div>
          </div>

          {/* Active Routine */}
          <div
            onClick={() => onNavigate('plans')}
            className="group p-4 bg-zinc-950/60 border border-white/[0.05] hover:border-white/20 rounded-2xl cursor-pointer transition-all hover:bg-zinc-900/40 shadow-sm"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono mb-1.5 uppercase font-bold tracking-wider">
              <span>Active Routine</span>
              <Dumbbell className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="text-sm font-bold text-white truncate mt-1">
              {activePlan ? activePlan.name : 'Select Plan'}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 font-sans">
              {activePlan ? `${activePlan.days.length} training days` : 'Tap to customize'}
            </div>
          </div>

          {/* Calories & Protein */}
          <div
            onClick={() => onNavigate('nutrition')}
            className="group p-4 bg-zinc-950/60 border border-white/[0.05] hover:border-sky-400/40 rounded-2xl cursor-pointer transition-all hover:bg-zinc-900/40 shadow-sm"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono mb-1.5 uppercase font-bold tracking-wider">
              <span>Today Macros</span>
              <Apple className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="text-xl font-mono font-black text-white">
              {totalCal}{' '}
              <span className="text-xs text-zinc-500 font-normal font-mono">/ {calTarget} kcal</span>
            </div>
            <div className="text-[11px] text-sky-300 font-sans mt-0.5 font-semibold">
              {totalPro}g / {proTarget}g protein
            </div>
          </div>

          {/* Body Weight & BMI */}
          <div
            onClick={() => onNavigate('body')}
            className="group p-4 bg-zinc-950/60 border border-white/[0.05] hover:border-amber-400/40 rounded-2xl cursor-pointer transition-all hover:bg-zinc-900/40 shadow-sm"
          >
            <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono mb-1.5 uppercase font-bold tracking-wider">
              <span>Weight &middot; BMI</span>
              <Activity className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-2xl font-mono font-black text-white">
              {profile.currentWeightKg}{' '}
              <span className="text-xs text-zinc-500 font-normal font-mono">{profile.preferredUnit}</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5 font-sans">
              BMI: <strong className="text-lime-400 font-mono font-bold">{currentBMI}</strong>
              {weeklyAvg && ` · 7d: ${weeklyAvg}`}
            </div>
          </div>
        </div>
      </div>

      {/* GYM CONSISTENCY STREAK CALENDAR (APPLE FITNESS 3-RING & INTERACTIVE HEATMAP) */}
      <GymConsistencyStreakCalendar
        sessions={recentSessions}
        profile={profile}
        onNavigateToWorkouts={() => onNavigate('workouts')}
      />

      {/* AI-POWERED RECOVERY INSIGHTS & OPTIMAL REST DAYS PANEL */}
      <AiRecoveryInsightsPanel
        profile={profile}
        recentSessions={recentSessions}
        activePlan={activePlan}
        onNavigate={onNavigate}
      />

      {/* ONBOARDING CHECKLIST (IF NOT YET 100%) */}
      {checklistPercent < 100 && (
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
            <div>
              <h3 className="font-bold text-zinc-100 text-sm sm:text-base">
                Onboarding &amp; Setup Progress ({checklistPercent}%)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Complete these initial milestones to customize your progression engine.
              </p>
            </div>
            <div className="text-xs font-mono font-bold text-lime-400">
              {completedChecklistCount} / {checklistItems.length} Completed
            </div>
          </div>

          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-lime-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${checklistPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {checklistItems.map((item, idx) => (
              <div
                key={idx}
                onClick={() => onNavigate(item.tab)}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer text-xs transition-colors ${
                  item.done
                    ? 'bg-zinc-900/40 border-zinc-800/60 text-zinc-400'
                    : 'bg-zinc-900/90 border-zinc-800 hover:border-lime-500/50 text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      item.done ? 'bg-lime-500/20 text-lime-400' : 'border border-zinc-600'
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
        <div className="bg-[#0e141a] border-2 border-lime-500/40 rounded-2xl p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-lime-400 fill-lime-400" />
              <h3 className="font-bold text-zinc-100 text-sm sm:text-base">
                Progressive Overload Alerts Ready ({pendingRecommendations.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('progression')}
              className="text-xs text-lime-400 hover:underline font-semibold"
            >
              Review All &rarr;
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pendingRecommendations.slice(0, 2).map((rec) => (
              <div
                key={rec.id}
                onClick={() => onNavigate('progression')}
                className="p-3.5 bg-zinc-900/80 border border-zinc-800 hover:border-lime-400/50 rounded-xl cursor-pointer text-xs transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-200">{rec.exerciseName}</span>
                  <span className="font-mono text-[10px] text-lime-400 bg-lime-400/10 px-1.5 py-0.5 rounded">
                    +{(rec.recommendedWeight - rec.currentWeight).toFixed(1)} {profile.preferredUnit}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-2">{rec.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QUICK LAUNCH GRID FOR CORE MODULES - APPLE & NIKE FITNESS BENTO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {/* Workouts */}
        <div
          onClick={() => onNavigate('workouts')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-lime-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-lime-400/10 border border-lime-400/25 flex items-center justify-center text-lime-400 group-hover:scale-105 transition-transform">
            <Dumbbell className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-lime-300 transition-colors">
              Workout Session Logger
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Log weights, reps, RIR, live rest timer, and auto-save sets during your workout.
            </p>
          </div>
        </div>

        {/* Progression */}
        <div
          onClick={() => onNavigate('progression')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-lime-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-lime-400/10 border border-lime-400/25 flex items-center justify-center text-lime-400 group-hover:scale-105 transition-transform">
            <TrendingUp className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-lime-300 transition-colors">
              Double Progression Engine
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Algorithmic overload recommendations based on actual logged working sets.
            </p>
          </div>
        </div>

        {/* Nutrition */}
        <div
          onClick={() => onNavigate('nutrition')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-sky-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-sky-400/10 border border-sky-400/25 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
            <Apple className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-sky-300 transition-colors">
              Daily Macro Food Diary
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Search bodybuilding staple foods, log calories, protein quotas, and water intake.
            </p>
          </div>
        </div>

        {/* Body Metrics */}
        <div
          onClick={() => onNavigate('body')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-amber-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
            <Activity className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-amber-300 transition-colors">
              Body Weight &amp; BMI
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Scientific screening BMI and 7-day smoothed rolling averages for recomp.
            </p>
          </div>
        </div>

        {/* Plans & Uploads */}
        <div
          onClick={() => onNavigate('plans')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-purple-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-purple-400/10 border border-purple-400/25 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
            <Award className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-purple-300 transition-colors">
              Plans &amp; PDF Uploads
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Upload workout plans, extract routines with AI or CSV, and manage splits.
            </p>
          </div>
        </div>

        {/* Reports & Analytics */}
        <div
          onClick={() => onNavigate('reports')}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-lime-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="w-11 h-11 rounded-2xl bg-lime-400/10 border border-lime-400/25 flex items-center justify-center text-lime-400 group-hover:scale-105 transition-transform">
            <Zap className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-lime-300 transition-colors">
              Reports &amp; PR Board
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              All-time PRs, estimated 1RM, volume trends, and consistency audits.
            </p>
          </div>
        </div>

        {/* Coach Iron AI Personal Trainer */}
        <div
          onClick={() => onNavigate('trainer')}
          className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-lime-400/[0.08] via-zinc-950/80 to-zinc-950 border border-lime-400/40 hover:border-lime-400 rounded-2xl cursor-pointer transition-all duration-300 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-lime-400/20 border border-lime-400/40 flex items-center justify-center text-lime-400 group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase text-lime-400 tracking-wider">
              AI Coach
            </span>
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-lime-300 transition-colors">
              Coach Iron &middot; AI Personal Trainer
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Chat coaching, 5-min warm-ups, dream body blueprints, and overload advice.
            </p>
          </div>
        </div>

        {/* Exercise Form & Posture Visualizer */}
        <div
          onClick={() => setPostureModalExercise('Barbell Back Squat')}
          className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-sky-400/[0.08] via-zinc-950/80 to-zinc-950 border border-sky-400/40 hover:border-sky-400 rounded-2xl cursor-pointer transition-all duration-300 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-sky-400/20 border border-sky-400/40 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Eye className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase text-sky-400 tracking-wider">
              Interactive Form
            </span>
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-sky-300 transition-colors">
              Workout Form &amp; Posture Preview
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Biomechanical mannequin, joint angles, common pitfalls, and red-flag fixes.
            </p>
          </div>
        </div>

        {/* Bluetooth Fitness Gadgets Hub */}
        <div
          onClick={() => setIsGadgetModalOpen(true)}
          className="p-5 sm:p-6 rounded-3xl bg-zinc-950/60 border border-white/[0.06] hover:border-sky-400/50 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-zinc-900/40 hover:-translate-y-0.5 space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-sky-400/10 border border-sky-400/25 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Bluetooth className={`w-5 h-5 ${isConnected ? 'text-sky-400 animate-pulse' : ''}`} />
            </div>
            {isConnected && (
              <span className="text-[10px] font-mono font-bold uppercase text-emerald-400 tracking-wider">
                {liveHeartRate ? `${liveHeartRate} BPM` : 'Linked'}
              </span>
            )}
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base group-hover:text-sky-300 transition-colors">
              Bluetooth Fitness Gadgets
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Connect heart rate chest straps, smart bands, and monitor live recovery pacing.
            </p>
          </div>
        </div>
      </div>

      {/* Posture & Form Preview Modal from Dashboard */}
      {postureModalExercise && (
        <ExercisePostureModal
          exerciseName={postureModalExercise}
          isOpen={Boolean(postureModalExercise)}
          onClose={() => setPostureModalExercise(null)}
          profile={profile}
        />
      )}

      {/* Demo Mode Prompt if brand new user */}
      {!isDemoMode && recentSessions.length === 0 && (
        <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-300">
              Want to preview IRON LOG with sample workouts, progression charts, and nutrition records?
            </span>
          </div>
          <button
            onClick={onLoadDemoData}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-semibold rounded-xl text-xs shrink-0 transition-colors"
          >
            Load Demo Data Preview
          </button>
        </div>
      )}
    </div>
  );
};
