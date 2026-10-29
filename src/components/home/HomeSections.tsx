import React from 'react';
import {
  Apple,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Droplets,
  Dumbbell,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Play,
  Scale,
  Settings,
  TrendingUp,
  Trophy,
  Video,
  BarChart3
} from 'lucide-react';
import type {
  BodyMetricEntry,
  ProgressiveOverloadRecommendation,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import type { NavTab } from '../layout/Navbar';
import { Badge, Button, Card, EmptyState, ProgressBar, SectionHeading } from '../ui';
import { BarChart } from '../common/Charts';
import { MacroBar, percentOf } from '../nutrition/MacroBar';
import { formatWeight, kgToLbs } from '../../utils/calculations';
import { formatDelta } from '../../utils/progressionPresentation';
import {
  completedSetCount,
  formatWater,
  lastDoneByDay,
  sessionVolume,
  type NutritionSummary,
  type RecentPr,
  type TodayWorkoutStatus,
  type VolumePoint
} from '../../utils/homeSummary';

type Navigate = (tab: NavTab) => void;

/** "2026-10-20" -> "Oct 20" without a timezone shift (the string is already a plain calendar day). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (key: string): string => {
  const [, m, d] = key.split('-').map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : key;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* B. Primary workout card                                             */
/* ------------------------------------------------------------------ */

interface WorkoutCardProps {
  activeSession: WorkoutSession | null;
  activePlan: WorkoutPlan | null;
  completed: WorkoutSession[];
  todayStatus: TodayWorkoutStatus;
  onNavigate: Navigate;
  onResumeActiveSession: () => void;
  className?: string;
}

const MAX_DAYS_SHOWN = 4;

export const HomeWorkoutCard: React.FC<WorkoutCardProps> = ({
  activeSession,
  activePlan,
  completed,
  todayStatus,
  onNavigate,
  onResumeActiveSession,
  className
}) => {
  if (activeSession) {
    const exerciseCount = activeSession.exercises.length;
    const setsDone = completedSetCount(activeSession);
    return (
      <Card as="section" tone="accent" aria-labelledby="home-workout-heading" className={className}>
        <Badge tone="accent" icon={<Play className="w-3 h-3 fill-current" aria-hidden />}>
          Workout in progress
        </Badge>
        <h2 id="home-workout-heading" className="mt-3 text-xl sm:text-2xl font-bold tracking-tight text-white">
          {activeSession.dayName || 'Active workout'}
        </h2>
        <p className="mt-1 text-sm text-zinc-400 tabular">
          {plural(exerciseCount, 'exercise')} · {plural(setsDone, 'set')} logged
        </p>
        <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={onResumeActiveSession} icon={<Play className="w-4 h-4 fill-current" aria-hidden />}>
          Resume workout
        </Button>
      </Card>
    );
  }

  if (!activePlan) {
    return (
      <Card as="section" aria-labelledby="home-workout-heading" className={className}>
        <h2 id="home-workout-heading" className="sr-only">
          Workout
        </h2>
        <EmptyState
          icon={<Dumbbell className="w-5 h-5" />}
          title="No routine selected"
          description="Pick a starter routine or import your own, then start logging from here."
          action={
            <Button onClick={() => onNavigate('plans')} icon={<FileSpreadsheet className="w-4 h-4" aria-hidden />}>
              Choose a routine
            </Button>
          }
        />
      </Card>
    );
  }

  const days = [...activePlan.days].sort((a, b) => a.dayOrder - b.dayOrder);
  const shown = days.slice(0, MAX_DAYS_SHOWN);
  const lastDone = lastDoneByDay(completed, activePlan.id);

  return (
    <Card as="section" tone="accent" aria-labelledby="home-workout-heading" className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Active routine</Badge>
        {todayStatus === 'completed' && (
          <Badge tone="success" icon={<CheckCircle2 className="w-3 h-3" aria-hidden />}>
            Workout logged today
          </Badge>
        )}
      </div>
      <h2 id="home-workout-heading" className="mt-3 text-xl sm:text-2xl font-bold tracking-tight text-white">
        {activePlan.name}
      </h2>
      {activePlan.trainingSplit && <p className="mt-1 text-sm text-zinc-400">{activePlan.trainingSplit}</p>}

      {shown.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-control border border-line bg-surface-2/50" aria-label="Routine days">
          {shown.map((day) => (
            <li key={day.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-white truncate">{day.dayName}</p>
                <p className="text-xs text-zinc-400">{plural(day.exercises.length, 'exercise')}</p>
              </div>
              <span className="text-xs text-zinc-400 tabular shrink-0">
                {lastDone[day.id] ? `Last done ${shortDate(lastDone[day.id])}` : 'Not done yet'}
              </span>
            </li>
          ))}
          {days.length > shown.length && (
            <li className="px-3 py-2 text-xs text-zinc-500">+{days.length - shown.length} more in this routine</li>
          )}
        </ul>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <Button size="lg" className="w-full sm:w-auto" onClick={() => onNavigate('workouts')} icon={<Dumbbell className="w-4 h-4" aria-hidden />}>
          Start workout
        </Button>
        <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={() => onNavigate('plans')}>
          Manage routines
        </Button>
      </div>
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* C. Daily nutrition summary                                          */
/* ------------------------------------------------------------------ */

interface NutritionCardProps {
  summary: NutritionSummary;
  preferredUnit: 'kg' | 'lbs';
  onNavigate: Navigate;
  className?: string;
}

export const HomeNutritionCard: React.FC<NutritionCardProps> = ({ summary, preferredUnit, onNavigate, className }) => {
  const { calories, targets, waterMl, waterGoalMl, hasEntries } = summary;
  const calTarget = targets.calories;
  const remaining = calTarget !== null ? calTarget - calories : null;
  const waterReached = waterGoalMl !== null && waterMl >= waterGoalMl;

  return (
    <Card as="section" aria-label="Nutrition today" className={className}>
      <SectionHeading
        level={2}
        title="Nutrition today"
        description={calTarget !== null ? `Daily goal ${calTarget.toLocaleString()} kcal` : undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => onNavigate('nutrition')} icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden />}>
            Open
          </Button>
        }
      />

      {hasEntries ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="tabular">
                <span className="text-3xl font-bold tracking-tight text-white">{calories.toLocaleString()}</span>
                <span className="text-sm text-zinc-400">
                  {calTarget !== null ? ` / ${calTarget.toLocaleString()} kcal` : ' kcal'}
                </span>
              </p>
              {remaining !== null && (
                <span className="text-xs font-medium text-zinc-300 tabular">
                  {remaining >= 0
                    ? `${remaining.toLocaleString()} kcal left`
                    : `${Math.abs(remaining).toLocaleString()} kcal over`}
                </span>
              )}
            </div>
            {calTarget !== null ? (
              <ProgressBar
                className="mt-2"
                value={calories}
                max={calTarget}
                label={`Calories today, ${percentOf(calories, calTarget)}% of goal`}
                tone={remaining !== null && remaining < 0 ? 'warning' : 'accent'}
              />
            ) : (
              <p className="mt-2 text-xs text-zinc-400">
                No calorie goal set.{' '}
                <button type="button" className="underline underline-offset-2 text-white" onClick={() => onNavigate('nutrition')}>
                  Set targets
                </button>
              </p>
            )}
          </div>

          <div className="space-y-3">
            <MacroBar macro="protein" current={summary.protein} target={targets.protein ?? 0} />
            <MacroBar macro="carbs" current={summary.carbs} target={targets.carbs ?? 0} />
            <MacroBar macro="fat" current={summary.fat} target={targets.fat ?? 0} />
          </div>
        </div>
      ) : (
        <div className="rounded-control border border-dashed border-line px-4 py-5 text-center">
          <Apple className="w-5 h-5 mx-auto text-zinc-500" aria-hidden />
          <p className="mt-2 text-sm font-medium text-white">No meals logged yet today</p>
          <p className="mt-0.5 text-xs text-zinc-400">Your calories and macros appear here once you add a meal.</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => onNavigate('nutrition')}>
            Log a meal
          </Button>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-line">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-zinc-300">
            <Droplets className="w-3.5 h-3.5 text-info" aria-hidden />
            Water
          </span>
          <span className="text-zinc-400 tabular">
            {formatWater(waterMl, preferredUnit)}
            {waterGoalMl !== null && ` / ${formatWater(waterGoalMl, preferredUnit)}`}
            {waterReached && (
              <>
                {' · '}
                <span className="text-success font-medium">Goal reached</span>
              </>
            )}
          </span>
        </div>
        {waterGoalMl !== null && (
          <ProgressBar
            className="mt-2"
            value={waterMl}
            max={waterGoalMl}
            tone={waterReached ? 'success' : 'info'}
            label={`Water today, ${percentOf(waterMl, waterGoalMl)}% of goal`}
          />
        )}
      </div>
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* D. Progress and recent activity                                     */
/* ------------------------------------------------------------------ */

interface ProgressCardProps {
  profile: UserProfile;
  completedCount: number;
  weekSessions: number;
  latest: WorkoutSession[];
  trend: VolumePoint[];
  prs: RecentPr[];
  onNavigate: Navigate;
  className?: string;
}

export const HomeProgressCard: React.FC<ProgressCardProps> = ({
  profile,
  completedCount,
  weekSessions,
  latest,
  trend,
  prs,
  onNavigate,
  className
}) => {
  const unit = profile.preferredUnit || 'kg';
  const weekTarget = profile.trainingDaysPerWeek > 0 ? profile.trainingDaysPerWeek : null;

  return (
    <Card as="section" aria-label="Recent progress" className={className}>
      <SectionHeading
        title="Recent progress"
        description={completedCount > 0 ? `${plural(completedCount, 'session')} logged in total` : undefined}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onNavigate('progression')} icon={<TrendingUp className="w-3.5 h-3.5" aria-hidden />}>
              Progression
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('timeline')} icon={<History className="w-3.5 h-3.5" aria-hidden />}>
              Timeline
            </Button>
          </div>
        }
      />

      {completedCount === 0 ? (
        <EmptyState
          icon={<Calendar className="w-5 h-5" />}
          title="No workouts logged yet"
          description="Finish a session and your consistency, volume trend and records show up here."
          action={
            <Button variant="secondary" size="sm" onClick={() => onNavigate('workouts')}>
              Go to workouts
            </Button>
          }
          className="py-6"
        />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-zinc-300">This week</p>
              <p className="text-sm tabular text-zinc-400">
                <span className="font-bold text-white">{weekSessions}</span>
                {weekTarget !== null && ` / ${weekTarget} sessions`}
                {weekTarget === null && ` ${weekSessions === 1 ? 'session' : 'sessions'}`}
              </p>
            </div>
            {weekTarget !== null && (
              <ProgressBar
                className="mt-2"
                value={weekSessions}
                max={weekTarget}
                tone={weekSessions >= weekTarget ? 'success' : 'accent'}
                label={`${weekSessions} of ${weekTarget} planned sessions this week`}
              />
            )}
          </div>

          {trend.length >= 2 && (
            <div>
              <p className="text-xs font-medium text-zinc-300 mb-1">Volume per session</p>
              <BarChart data={trend} unit={` ${unit}`} height={140} maxLabels={6} />
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Latest sessions</p>
            <ul className="divide-y divide-line rounded-control border border-line">
              {latest.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{s.dayName || 'Workout'}</p>
                    <p className="text-xs text-zinc-400 tabular">
                      {shortDate(s.date)} · {plural(s.exercises.length, 'exercise')}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-300 tabular shrink-0">
                    {sessionVolume(s).toLocaleString()} {unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {prs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-300 mb-2">New records · last 30 days</p>
              <ul className="space-y-2">
                {prs.map((pr) => (
                  <li key={`${pr.exerciseName}-${pr.date}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-4 h-4 text-warning shrink-0" aria-hidden />
                      <span className="truncate text-white">{pr.exerciseName}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 text-xs tabular text-zinc-400">
                      <span className="text-white font-semibold">
                        {pr.weight} {unit}
                      </span>
                      <Badge tone="success">{formatDelta(pr.weight - pr.previousBest)} {unit}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* E. Coach Iron                                                       */
/* ------------------------------------------------------------------ */

interface CoachCardProps {
  recommendations: ProgressiveOverloadRecommendation[];
  unit: 'kg' | 'lbs';
  onNavigate: Navigate;
  className?: string;
}

/**
 * Restrained entry point. It only shows overload recommendations the progression engine already saved;
 * it never calls the AI service, so rendering Home costs nothing.
 */
export const HomeCoachCard: React.FC<CoachCardProps> = ({ recommendations, unit, onNavigate, className }) => {
  const top = recommendations.slice(0, 2);
  return (
    <Card as="section" aria-label="Coach Iron" className={className}>
      <SectionHeading title="Coach Iron" description="Guidance for your next sessions" />

      {recommendations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">
            {plural(recommendations.length, 'overload recommendation')} ready to review.
          </p>
          <ul className="space-y-2">
            {top.map((rec) => (
              <li key={rec.id}>
                <button
                  type="button"
                  onClick={() => onNavigate('progression')}
                  className="w-full min-h-11 flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2/50 px-3 py-2 text-left hover:border-line-strong transition-colors"
                >
                  <span className="text-sm font-medium text-white truncate">{rec.exerciseName}</span>
                  <Badge tone="accent" className="tabular shrink-0">
                    {formatDelta(rec.recommendedWeight - rec.currentWeight)} {unit}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
          {recommendations.length > top.length && (
            <button type="button" className="text-xs text-zinc-400 underline underline-offset-2" onClick={() => onNavigate('progression')}>
              See all {recommendations.length}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          Ask for form tips, a warm-up or a training review. Overload recommendations appear here after your sessions.
        </p>
      )}

      <Button variant="secondary" className="mt-4 w-full" onClick={() => onNavigate('trainer')} icon={<Bot className="w-4 h-4" aria-hidden />}>
        Open Coach Iron
      </Button>
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* F. Body summary                                                     */
/* ------------------------------------------------------------------ */

interface BodyCardProps {
  profile: UserProfile;
  latest: BodyMetricEntry | null;
  onNavigate: Navigate;
  className?: string;
}

/** Weight only: the latest weigh-in and the goal. Body Scan results and body-fat estimates stay on the Body screen. */
export const HomeBodyCard: React.FC<BodyCardProps> = ({ profile, latest, onNavigate, className }) => {
  const unit = profile.preferredUnit || 'kg';
  const show = (kg: number) => (unit === 'lbs' ? `${Math.round(kgToLbs(kg) * 10) / 10} lbs` : `${kg} kg`);

  return (
    <Card as="section" aria-label="Body weight" className={className}>
      <SectionHeading title="Body weight" />
      {latest ? (
        <div className="space-y-1">
          <p className="text-3xl font-bold tracking-tight text-white tabular">{show(latest.weightKg)}</p>
          <p className="text-xs text-zinc-400 tabular">Weighed in {shortDate(latest.date)}</p>
          {profile.goalWeightKg > 0 && (
            <p className="text-xs text-zinc-400 tabular">Goal {formatWeight(profile.goalWeightKg, unit)}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">No weigh-ins yet. Log your weight to track the trend.</p>
      )}
      <Button
        variant="secondary"
        className="mt-4 w-full"
        onClick={() => onNavigate('body')}
        icon={<Scale className="w-4 h-4" aria-hidden />}
      >
        {latest ? 'Open body metrics' : 'Log weight'}
      </Button>
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* Explore links                                                       */
/* ------------------------------------------------------------------ */

const EXPLORE: { tab: NavTab; label: string; hint: string; icon: React.ReactNode }[] = [
  { tab: 'dashboard', label: 'Overview', hint: 'Scorecard, recovery, muscle map', icon: <LayoutDashboard className="w-4 h-4" aria-hidden /> },
  { tab: 'plans', label: 'Routines', hint: 'Plans and imports', icon: <FileSpreadsheet className="w-4 h-4" aria-hidden /> },
  { tab: 'reports', label: 'Reports', hint: 'Weekly summary and records', icon: <BarChart3 className="w-4 h-4" aria-hidden /> },
  { tab: 'videos', label: 'Exercise videos', hint: 'Technique library', icon: <Video className="w-4 h-4" aria-hidden /> },
  { tab: 'settings', label: 'Settings', hint: 'Profile, units, data', icon: <Settings className="w-4 h-4" aria-hidden /> }
];

export const HomeExploreCard: React.FC<{ onNavigate: Navigate; className?: string }> = ({ onNavigate, className }) => (
  <Card as="section" aria-label="More in Iron Log" className={className}>
    <SectionHeading title="More in Iron Log" />
    <nav aria-label="Other screens">
      <ul className="-mx-2 space-y-0.5">
        {EXPLORE.map((item) => (
          <li key={item.tab}>
            <button
              type="button"
              onClick={() => onNavigate(item.tab)}
              className="w-full min-h-11 flex items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2 transition-colors"
            >
              <span className="text-zinc-400" aria-hidden>
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">{item.label}</span>
                <span className="block text-xs text-zinc-400 truncate">{item.hint}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  </Card>
);
