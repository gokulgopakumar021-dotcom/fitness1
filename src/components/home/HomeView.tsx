import React, { useMemo, useState } from 'react';
import { CheckCircle2, Dumbbell, Play, RefreshCw } from 'lucide-react';
import type {
  BodyMetricEntry,
  DailyNutritionLog,
  ProgressiveOverloadRecommendation,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import type { NavTab } from '../layout/Navbar';
import { Badge, Button, ErrorState } from '../ui';
import {
  HomeBodyCard,
  HomeCoachCard,
  HomeExploreCard,
  HomeNutritionCard,
  HomeProgressCard,
  HomeWorkoutCard
} from './HomeSections';
import {
  completedOnly,
  completedThisWeek,
  latestSessions,
  recentWeightPrs,
  resolveActivePlan,
  summarizeNutrition,
  todayWorkoutStatus,
  volumeTrend
} from '../../utils/homeSummary';

interface HomeViewProps {
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  onNavigate: (tab: NavTab) => void;
  onResumeActiveSession: () => void;
  isDemoMode: boolean;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
}

interface HomeData {
  activePlan: WorkoutPlan | null;
  completed: WorkoutSession[];
  pendingRecommendations: ProgressiveOverloadRecommendation[];
  todayNutrition: DailyNutritionLog | null;
  latestMetric: BodyMetricEntry | null;
}

const asList = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

/** One synchronous read of the existing local stores. No new queries or calculations live here. */
const loadHomeData = (todayKey: string): HomeData => {
  const plans = asList(db.getPlans());
  const metrics = asList(db.getBodyMetrics());
  return {
    activePlan: resolveActivePlan(plans, db.getActivePlanId()),
    completed: completedOnly(asList(db.getSessions())),
    pendingRecommendations: asList(db.getRecommendations()).filter((r) => r.userAction === 'pending'),
    todayNutrition: db.getNutritionLogForDate(todayKey),
    latestMetric: metrics.length > 0 ? [...metrics].sort((a, b) => b.date.localeCompare(a.date))[0] : null
  };
};

const greetingFor = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

export const HomeView: React.FC<HomeViewProps> = ({
  profile,
  activeSession,
  onNavigate,
  onResumeActiveSession,
  isDemoMode,
  onLoadDemoData,
  onClearDemoData
}) => {
  const todayKey = getCurrentDayKey();
  const [reloadKey, setReloadKey] = useState(0);

  // Re-read when demo data is loaded or cleared from this screen (the parent flips isDemoMode while Home stays mounted).
  const loaded = useMemo<{ data: HomeData } | { error: true }>(() => {
    try {
      return { data: loadHomeData(todayKey) };
    } catch {
      return { error: true };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, isDemoMode, reloadKey]);

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const firstName = profile.name ? profile.name.trim().split(/\s+/)[0] : '';

  const header = (
    <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-400">{dateLabel}</p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight">
          {greetingFor(now.getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h1>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {isDemoMode && <Badge tone="warning">Demo data</Badge>}
        {isDemoMode ? (
          <Button variant="ghost" size="sm" onClick={onClearDemoData}>
            Clear demo data
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onLoadDemoData}>
            Load demo data
          </Button>
        )}
      </div>
    </header>
  );

  if ('error' in loaded) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-8">
        {header}
        <ErrorState
          title="Couldn't load your data"
          description="Your saved workouts and nutrition couldn't be read. Try again."
          action={
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)} icon={<RefreshCw className="w-4 h-4" aria-hidden />}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const { activePlan, completed, pendingRecommendations, todayNutrition, latestMetric } = loaded.data;
  const unit = profile.preferredUnit || 'kg';
  const status = todayWorkoutStatus(activeSession, completed, todayKey);
  const weekSessions = completedThisWeek(completed, todayKey).length;
  const nutrition = summarizeNutrition(todayNutrition, profile);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto pb-8">
      {header}

      {/* Daily overview: today's workout status and weekly consistency. Calories live in the nutrition card only. */}
      <div className="flex flex-wrap items-center gap-2" aria-label="Today at a glance" role="group">
        {status === 'in_progress' && (
          <Badge tone="accent" icon={<Play className="w-3 h-3 fill-current" aria-hidden />}>
            Workout in progress
          </Badge>
        )}
        {status === 'completed' && (
          <Badge tone="success" icon={<CheckCircle2 className="w-3 h-3" aria-hidden />}>
            Workout logged today
          </Badge>
        )}
        {status === 'none' && (
          <Badge tone="neutral" icon={<Dumbbell className="w-3 h-3" aria-hidden />}>
            No workout logged today
          </Badge>
        )}
        {completed.length > 0 && (
          <Badge tone="neutral" className="tabular">
            {weekSessions}
            {profile.trainingDaysPerWeek > 0 ? ` / ${profile.trainingDaysPerWeek}` : ''} sessions this week
          </Badge>
        )}
      </div>

      {/* Mobile: workout first, then nutrition. lg: workout + progress on the left, nutrition tall on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <HomeWorkoutCard
          className="lg:col-span-2"
          activeSession={activeSession}
          activePlan={activePlan}
          completed={completed}
          todayStatus={status}
          onNavigate={onNavigate}
          onResumeActiveSession={onResumeActiveSession}
        />
        <HomeNutritionCard
          className="lg:col-start-3 lg:row-span-2 lg:row-start-1"
          summary={nutrition}
          preferredUnit={unit}
          onNavigate={onNavigate}
        />
        <HomeProgressCard
          className="lg:col-span-2"
          profile={profile}
          completedCount={completed.length}
          weekSessions={weekSessions}
          latest={latestSessions(completed, 3)}
          trend={volumeTrend(completed, 6)}
          prs={recentWeightPrs(completed, todayKey)}
          onNavigate={onNavigate}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        <HomeCoachCard recommendations={pendingRecommendations} unit={unit} onNavigate={onNavigate} />
        <HomeBodyCard profile={profile} latest={latestMetric} onNavigate={onNavigate} />
        <HomeExploreCard onNavigate={onNavigate} />
      </div>
    </div>
  );
};
