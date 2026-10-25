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
import { Badge, Button, Card, PageHeader, ProgressBar, SectionHeading } from '../ui';
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

  const quickLaunch: {
    key: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    onClick: () => void;
    badge?: React.ReactNode;
    featured?: boolean;
  }[] = [
    {
      key: 'workouts',
      title: 'Session Logger',
      description: 'Real-time set tracker, target RIR calibration, rest countdown timer, and automatic set completion.',
      icon: <Dumbbell className="w-5 h-5" />,
      onClick: () => onNavigate('workouts')
    },
    {
      key: 'progression',
      title: 'Double Progression Engine',
      description: 'Deterministic overload recommendations (Rules A, B, C, D) calculated across all working sets.',
      icon: <TrendingUp className="w-5 h-5" />,
      onClick: () => onNavigate('progression')
    },
    {
      key: 'nutrition',
      title: 'Macro Food Diary & Barcode',
      description: 'Live barcode scanning, Open Food Facts normalization, bodybuilding staples, and protein tracking.',
      icon: <Apple className="w-5 h-5" />,
      onClick: () => onNavigate('nutrition')
    },
    {
      key: 'body',
      title: 'Body Composition & BMI',
      description: '7-day smoothed rolling averages, BMI demographic categorizations, and silhouette ratio analysis.',
      icon: <Activity className="w-5 h-5" />,
      onClick: () => onNavigate('body')
    },
    {
      key: 'trainer',
      title: 'Coach Iron · AI Coach',
      description: 'Interactive consultation, customized 5-minute warm-ups, and physique recomposition blueprints.',
      icon: <Bot className="w-5 h-5" />,
      onClick: () => onNavigate('trainer'),
      badge: <Badge tone="accent">AI coach</Badge>,
      featured: true
    },
    {
      key: 'posture',
      title: 'Biomechanics & Posture',
      description: 'Biomechanical mannequin, joint angle visualization, common failure cues, and safety guidelines.',
      icon: <Eye className="w-5 h-5" />,
      onClick: () => setPostureModalExercise('Barbell Back Squat'),
      badge: <Badge tone="info">Biomechanics</Badge>
    }
  ];

  const tileBase =
    'text-left w-full rounded-2xl border bg-surface hover:bg-surface-2 transition-colors p-4 sm:p-5 border-line hover:border-line-strong';

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Athlete performance radar"
        title={profile.name ? profile.name : 'Athlete discipline'}
        description="Precision double-overload tracking, AI recovery guidance, and automated nutritional balance."
        actions={
          activeSession ? (
            <Button size="lg" onClick={onResumeActiveSession} icon={<Play className="w-4 h-4 fill-current" />}>
              Resume workout
            </Button>
          ) : (
            <Button size="lg" onClick={() => onNavigate('workouts')} icon={<Dumbbell className="w-4 h-4" />}>
              Start workout
            </Button>
          )
        }
      />

      {/* KEY METRICS */}
      <section aria-label="Key metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button type="button" onClick={() => onNavigate('reports')} className={`${tileBase} space-y-2`}>
          <div className="flex items-center justify-between text-[var(--text-secondary)]">
            <span className="text-xs font-medium">Readiness</span>
            <HeartPulse className="w-4 h-4 text-volt-adaptive" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular">{readinessScore}</span>
            <span className="text-xs text-[var(--text-muted)] tabular">/ 100</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)]">Estimate from recent training</div>
        </button>

        <button type="button" onClick={() => onNavigate('reports')} className={`${tileBase} space-y-2`}>
          <div className="flex items-center justify-between text-[var(--text-secondary)]">
            <span className="text-xs font-medium">7-day frequency</span>
            <Calendar className="w-4 h-4 text-[var(--text-muted)]" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular">{sessionsLast7Days}</span>
            <span className="text-xs text-[var(--text-muted)] tabular">/ {profile.trainingDaysPerWeek} days</span>
          </div>
          <div className="text-xs">
            {sessionsLast7Days >= profile.trainingDaysPerWeek ? (
              <span className="text-volt-adaptive font-semibold">Weekly quota satisfied</span>
            ) : (
              <span className="text-[var(--text-secondary)]">
                {profile.trainingDaysPerWeek - sessionsLast7Days} sessions to goal
              </span>
            )}
          </div>
        </button>

        <button type="button" onClick={() => onNavigate('nutrition')} className={`${tileBase} space-y-2`}>
          <div className="flex items-center justify-between text-[var(--text-secondary)]">
            <span className="text-xs font-medium">Fuel targets</span>
            <Apple className="w-4 h-4 text-[var(--text-muted)]" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular">{totalCal}</span>
            <span className="text-xs text-[var(--text-muted)] tabular truncate">/ {calTarget} kcal</span>
          </div>
          <ProgressBar value={totalCal} max={calTarget} label="Calories today" />
          <div className="text-xs text-[var(--text-secondary)] tabular">
            {totalPro}g / {proTarget}g protein ({calorieProgress}%)
          </div>
        </button>

        <button type="button" onClick={() => onNavigate('body')} className={`${tileBase} space-y-2`}>
          <div className="flex items-center justify-between text-[var(--text-secondary)]">
            <span className="text-xs font-medium">Body metrics</span>
            <Activity className="w-4 h-4 text-[var(--text-muted)]" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular">{profile.currentWeightKg}</span>
            <span className="text-xs text-[var(--text-muted)]">{profile.preferredUnit}</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] tabular">
            BMI <span className="text-[var(--text-primary)] font-semibold">{currentBMI}</span>
            {weeklyAvg && ` · 7d avg ${weeklyAvg}`}
          </div>
        </button>
      </section>

      {/* VOLUME PRESTIGE TIER */}
      <Card as="section" aria-label="Volume prestige tier" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: currentLevel.color }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--text-secondary)]">Volume prestige tier</p>
              <p className="text-lg font-bold tracking-tight text-[var(--text-primary)] truncate">
                {currentLevel.label}
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-secondary)] tabular">
            Total tonnage:{' '}
            <strong className="text-[var(--text-primary)] font-semibold">
              {totalLifetimeVolume.toLocaleString()} {profile.preferredUnit}
            </strong>
          </p>
        </div>
        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-label="Progress to next tier"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={levelProgress}
            className="h-2 w-full rounded-full bg-surface-3 overflow-hidden"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${levelProgress}%`, backgroundColor: currentLevel.color }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)] tabular">
            <span>
              {levelProgress}% towards {nextLevel ? nextLevel.label : 'maximum prestige'}
            </span>
            {nextLevel && (
              <span>
                {volToNext.toLocaleString()} {profile.preferredUnit} remaining
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* PROGRESSIVE OVERLOAD ALERTS (most actionable) */}
      {pendingRecommendations.length > 0 && (
        <Card tone="accent" as="section" aria-label="Progressive overload alerts" className="space-y-3">
          <SectionHeading
            className="mb-0"
            title={`Overload recommendations (${pendingRecommendations.length})`}
            description="Ready to review based on your recent sessions."
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate('progression')} icon={<ArrowRight className="w-3.5 h-3.5" />}>
                Review all
              </Button>
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pendingRecommendations.slice(0, 2).map((rec) => (
              <button
                type="button"
                key={rec.id}
                onClick={() => onNavigate('progression')}
                className="text-left p-3.5 bg-surface-2 border border-line hover:border-accent/40 rounded-xl transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{rec.exerciseName}</span>
                  <Badge tone="accent" className="tabular shrink-0">
                    +{(rec.recommendedWeight - rec.currentWeight).toFixed(1)} {profile.preferredUnit}
                  </Badge>
                </div>
                <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{rec.explanation}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* CONSISTENCY CALENDAR */}
      <GymConsistencyStreakCalendar
        sessions={recentSessions}
        profile={profile}
        onNavigateToWorkouts={() => onNavigate('workouts')}
      />

      {/* RECOVERY INSIGHTS */}
      <AiRecoveryInsightsPanel
        profile={profile}
        recentSessions={recentSessions}
        activePlan={activePlan}
        onNavigate={onNavigate}
      />

      {/* SETUP CHECKLIST (until complete) */}
      {checklistPercent < 100 && (
        <Card as="section" aria-label="Calibration checklist" className="space-y-4">
          <SectionHeading
            className="mb-0"
            title={`Calibration checklist · ${checklistPercent}%`}
            description="Complete these initial milestones to customize your progressive overload engine."
            action={
              <span className="text-xs font-medium text-[var(--text-secondary)] tabular">
                {completedChecklistCount} / {checklistItems.length}
              </span>
            }
          />
          <ProgressBar value={checklistPercent} label="Calibration progress" />
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {checklistItems.map((item, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.tab)}
                  className={`w-full min-h-[48px] px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left text-sm transition-colors ${
                    item.done
                      ? 'bg-surface border-line text-[var(--text-muted)]'
                      : 'bg-surface-2 border-line-strong hover:border-accent/40 text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        item.done ? 'bg-accent/15 text-volt-adaptive' : 'border border-[var(--text-muted)]'
                      }`}
                      aria-hidden
                    >
                      {item.done && <CheckCircle2 className="w-4 h-4" />}
                    </span>
                    <span className={item.done ? 'line-through' : 'font-medium'}>{item.label}</span>
                    <span className="sr-only">{item.done ? '(done)' : '(to do)'}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* EXPLORE */}
      <section aria-label="Explore Iron Log">
        <SectionHeading title="Explore" description="Jump into any part of your training system." />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickLaunch.map((q) => (
            <button
              type="button"
              key={q.key}
              onClick={q.onClick}
              className={`${tileBase} group flex items-start gap-3 sm:flex-col sm:gap-3 ${
                q.featured ? 'border-accent/30 hover:border-accent/60' : ''
              }`}
            >
              <div className="flex items-center justify-between sm:w-full shrink-0">
                <span
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                    q.featured
                      ? 'bg-accent/10 border-accent/30 text-volt-adaptive'
                      : 'bg-surface-2 border-line text-[var(--text-secondary)] group-hover:text-volt-adaptive transition-colors'
                  }`}
                  aria-hidden
                >
                  {q.icon}
                </span>
                <span className="hidden sm:block">{q.badge}</span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{q.title}</h3>
                  <span className="sm:hidden">{q.badge}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{q.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Posture & Form Preview Modal */}
      {postureModalExercise && (
        <ExercisePostureModal
          exerciseName={postureModalExercise}
          isOpen={Boolean(postureModalExercise)}
          onClose={() => setPostureModalExercise(null)}
          profile={profile}
        />
      )}

      {/* Demo mode prompt */}
      {!isDemoMode && recentSessions.length === 0 && (
        <Card tone="ghost" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
            <Sparkles className="w-4 h-4 text-warning shrink-0" aria-hidden />
            <span>
              Want to preview Iron Log with populated session history, progression logs, and nutrition metrics?
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onLoadDemoData} className="shrink-0">
            Load demo data
          </Button>
        </Card>
      )}
    </div>
  );
};
