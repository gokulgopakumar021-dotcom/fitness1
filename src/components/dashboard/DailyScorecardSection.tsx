import React, { useId, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Droplets, Dumbbell, HeartPulse, Info, Moon, Utensils } from 'lucide-react';
import { Badge, Button, Card, ProgressBar, SectionHeading, Skeleton } from '../ui';
import type { DailyNutritionLog, DailySleepLog, WorkoutPlan, WorkoutSession } from '../../types';
import {
  LOAD_DISCLAIMER,
  addDays,
  buildMuscleMapSummary,
  dayNumber,
  getRegionLabel,
  isValidDayKey,
  localDayKey,
  type MuscleMapSummary,
} from '../../utils/muscleMap';
import {
  CATEGORY_ORDER,
  SLEEP_GUIDELINE,
  evaluateDailyScorecard,
  type CategoryId,
  type CategoryResult,
  type CategoryStatus,
  type RawValue,
  type ScorecardProfile,
} from '../../utils/scorecard';

export interface DailyScorecardSectionProps {
  /** Source records, passed as loaded from storage. Dataset filtering is done by the scoring engine. */
  sessions: readonly WorkoutSession[];
  plans: readonly WorkoutPlan[];
  nutritionLogs: readonly DailyNutritionLog[];
  sleepLogs: readonly DailySleepLog[];
  profile: Partial<ScorecardProfile> | null | undefined;
  /** When true ONLY demo records are used and the section says so; otherwise ONLY real records. */
  isDemoMode?: boolean;
  /** Injectable clock for tests. Defaults to the current time at render. */
  now?: Date;
  /** Shows a loading placeholder instead of a score. */
  loading?: boolean;
  className?: string;
}

/* ───────────────────────── formatting ───────────────────────── */

const num = (v: RawValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtDec = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pctOf = (value: number, target: number): number => Math.round((value / target) * 100);

function formatDayLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<CategoryStatus, string> = {
  scored: 'Scored',
  no_data: 'No data',
  insufficient_data: 'Insufficient data',
  invalid_data: 'Invalid data',
  in_progress: 'In progress',
  informational: 'Information only',
};
const STATUS_TONE: Record<CategoryStatus, 'success' | 'neutral' | 'warning' | 'danger' | 'info'> = {
  scored: 'success',
  no_data: 'neutral',
  insufficient_data: 'warning',
  invalid_data: 'danger',
  in_progress: 'info',
  informational: 'info',
};
const STATUS_SHORT: Record<CategoryStatus, string> = {
  scored: 'scored',
  no_data: 'no data',
  insufficient_data: 'insufficient data',
  invalid_data: 'invalid data',
  in_progress: 'in progress',
  informational: 'information only',
};

const ICONS: Record<CategoryId, React.ReactNode> = {
  workout: <Dumbbell className="w-4 h-4" aria-hidden />,
  nutrition: <Utensils className="w-4 h-4" aria-hidden />,
  hydration: <Droplets className="w-4 h-4" aria-hidden />,
  sleep: <Moon className="w-4 h-4" aria-hidden />,
  recovery: <HeartPulse className="w-4 h-4" aria-hidden />,
};

/** What the points are for, shown when a category is not scored. Mirrors the approved weights. */
const NOT_SCORED_NOTE: Record<CategoryId, string> = {
  workout: 'Worth up to 20 pts once a workout with a known plan is logged.',
  nutrition: 'Worth up to 25 pts once food is logged and personal targets are set.',
  hydration: 'Not scored in this version: there is no hydration target.',
  sleep: 'Worth up to 25 pts once sleep is logged.',
  recovery: 'Not scored: shown for context only.',
};

interface Row {
  label: string;
  value: string;
}
interface Bar {
  label: string;
  value: number;
  max: number;
  caption: string;
}

function rowsAndBars(cat: CategoryResult): { rows: Row[]; bars: Bar[] } {
  const rows: Row[] = [];
  const bars: Bar[] = [];
  const { raw, target } = cat;

  if (cat.id === 'workout') {
    const done = num(raw.completedWorkingSets);
    const planned = num(target.plannedWorkingSets);
    const live = num(raw.inProgressSessions);
    if (done !== null) rows.push({ label: 'Working sets completed', value: String(done) });
    if (planned !== null) rows.push({ label: 'Planned working sets', value: String(planned) });
    if (live !== null) rows.push({ label: 'Sessions in progress', value: String(live) });
    if (cat.status === 'scored' && done !== null && planned !== null && planned > 0)
      bars.push({ label: 'Working sets completed vs plan', value: done, max: planned, caption: `${pctOf(done, planned)}% of planned sets` });
  }

  if (cat.id === 'nutrition') {
    const cal = num(raw.calories);
    const pro = num(raw.proteinG);
    const calT = num(target.calories);
    const proT = num(target.proteinG);
    if (cal !== null) rows.push({ label: 'Calories', value: calT !== null ? `${fmtInt(cal)} of ${fmtInt(calT)} kcal` : `${fmtInt(cal)} kcal` });
    if (pro !== null) rows.push({ label: 'Protein', value: proT !== null ? `${fmtInt(pro)} of ${fmtInt(proT)} g` : `${fmtInt(pro)} g` });
    const entries = num(raw.loggedEntries);
    if (entries !== null) rows.push({ label: 'Food entries logged', value: String(entries) });
    const c = num(raw.carbsG);
    const f = num(raw.fatG);
    const fi = num(raw.fiberG);
    if (c !== null && f !== null && fi !== null)
      rows.push({ label: 'Carbs / fat / fiber (information only)', value: `${fmtInt(c)} g / ${fmtInt(f)} g / ${fmtInt(fi)} g` });
    if (cat.status === 'scored' && cal !== null && calT !== null)
      bars.push({ label: 'Calories vs target', value: cal, max: calT, caption: `${pctOf(cal, calT)}% of calorie target` });
    if (cat.status === 'scored' && pro !== null && proT !== null)
      bars.push({ label: 'Protein vs target', value: pro, max: proT, caption: `${pctOf(pro, proT)}% of protein target` });
  }

  if (cat.id === 'hydration') {
    const water = num(raw.waterMl);
    if (water !== null) {
      rows.push({ label: 'Water logged', value: `${fmtInt(water)} ml` });
      rows.push({ label: 'Target', value: 'No target set' });
    }
  }

  if (cat.id === 'sleep') {
    const hours = num(raw.hoursSlept);
    if (hours !== null) rows.push({ label: 'Sleep logged', value: `${fmtDec(hours)} h` });
    rows.push({ label: 'Default guideline', value: `${SLEEP_GUIDELINE.minHours}–${SLEEP_GUIDELINE.maxHours} h (not personalized)` });
    const q = num(raw.quality);
    const rhr = num(raw.restingHeartRate);
    const hrv = num(raw.hrvMs);
    if (hours !== null && q !== null) rows.push({ label: 'Self-rated quality (information only)', value: `${fmtDec(q)} / 100` });
    if (hours !== null && rhr !== null) rows.push({ label: 'Resting heart rate (information only)', value: `${fmtDec(rhr)} bpm` });
    if (hours !== null && hrv !== null) rows.push({ label: 'HRV (information only)', value: `${fmtDec(hrv)} ms` });
    if (cat.status === 'scored' && hours !== null)
      bars.push({
        label: `Sleep vs ${SLEEP_GUIDELINE.minHours} h guideline minimum`,
        value: hours,
        max: SLEEP_GUIDELINE.minHours,
        caption: `${pctOf(hours, SLEEP_GUIDELINE.minHours)}% of the ${SLEEP_GUIDELINE.minHours} h minimum`,
      });
  }

  return { rows, bars };
}

/* ───────────────────────── pieces ───────────────────────── */

const RecoveryBody: React.FC<{ summary: MuscleMapSummary | null; dataset: 'real' | 'demo' }> = ({ summary, dataset }) => {
  if (!summary) return null;
  const { history } = summary;
  const regions = Object.values(summary.regions);
  const heavier = regions.filter((r) => r.status === 'heavier').map((r) => getRegionLabel(r.regionId));
  const lighter = regions.filter((r) => r.status === 'lighter').map((r) => getRegionLabel(r.regionId));
  const typical = regions.filter((r) => r.status === 'typical').length;

  return (
    <div className="space-y-2 text-xs text-[var(--text-secondary)]" data-testid="scorecard-recovery-load">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Logged training load (Muscle Map)</p>
      {!history.firstTrackedDay ? (
        <p>{dataset === 'demo' ? 'No demo workouts to compare yet.' : 'No completed workouts logged yet.'}</p>
      ) : !history.sufficient ? (
        <p>Not enough logged history yet to compare training load. Comparisons start after about 3 weeks of logged workouts.</p>
      ) : heavier.length + lighter.length + typical === 0 ? (
        <p>No region has enough recent logged work to compare.</p>
      ) : (
        <ul className="space-y-1">
          {heavier.length > 0 && <li className="break-words">Heavier than usual: {heavier.join(', ')}</li>}
          {lighter.length > 0 && <li className="break-words">Lighter than usual: {lighter.join(', ')}</li>}
          <li>Typical: {typical} {typical === 1 ? 'region' : 'regions'}</li>
        </ul>
      )}
      <p>{LOAD_DISCLAIMER}</p>
    </div>
  );
};

interface CategoryCardProps {
  cat: CategoryResult;
  recovery?: React.ReactNode;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ cat, recovery }) => {
  const uid = useId();
  const titleId = `${uid}-title`;
  const { rows, bars } = useMemo(() => rowsAndBars(cat), [cat]);
  const scored = cat.status === 'scored' && cat.points !== null;

  return (
    <Card as="article" aria-labelledby={titleId} className="space-y-3 flex flex-col" data-testid={`scorecard-card-${cat.id}`} data-status={cat.status}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-[var(--text-primary)]">
          {ICONS[cat.id]}
          <h3 id={titleId} className="text-sm font-semibold truncate">{cat.label}</h3>
        </div>
        <Badge tone={STATUS_TONE[cat.status]} className="shrink-0">
          {STATUS_LABEL[cat.status]}
          {scored && cat.partial ? ' · partial' : ''}
        </Badge>
      </div>

      <div data-testid={`scorecard-points-${cat.id}`}>
        {scored ? (
          <p className="text-[var(--text-primary)]">
            <span className="text-2xl font-bold tabular">{fmtDec(cat.points as number)}</span>
            <span className="text-sm text-[var(--text-secondary)]"> of {cat.eligibleMax} pts</span>
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Not scored</p>
            <p className="text-xs text-[var(--text-secondary)]">{NOT_SCORED_NOTE[cat.id]}</p>
          </>
        )}
      </div>

      {rows.length > 0 && (
        <dl className="space-y-1.5 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--text-secondary)] min-w-0 break-words">{r.label}</dt>
              <dd className="font-medium text-[var(--text-primary)] text-right tabular break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {bars.map((b) => (
        <div key={b.label} className="space-y-1">
          <ProgressBar value={b.value} max={b.max} label={b.label} />
          <p className="text-[11px] text-[var(--text-secondary)]">{b.caption}</p>
        </div>
      ))}

      {cat.explanation && <p className="text-xs text-[var(--text-secondary)] break-words">{cat.explanation}</p>}

      {cat.notes.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-[var(--text-secondary)] list-disc pl-4">
          {cat.notes.map((n) => (
            <li key={n} className="break-words">{n}</li>
          ))}
        </ul>
      )}

      {recovery}

      {cat.action && (
        <p className="mt-auto rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-[var(--text-primary)] break-words" data-testid={`scorecard-action-${cat.id}`}>
          <span className="font-semibold">Next: </span>
          {cat.action.message}
        </p>
      )}
    </Card>
  );
};

/* ───────────────────────── section ───────────────────────── */

export const DailyScorecardSection: React.FC<DailyScorecardSectionProps> = ({
  sessions,
  plans,
  nutritionLogs,
  sleepLogs,
  profile,
  isDemoMode = false,
  now,
  loading = false,
  className,
}) => {
  const clock = now ?? new Date();
  const today = localDayKey(clock);
  const [selected, setSelected] = useState<string | null>(null);

  // A selected day is only honoured while it is a real day that is not in the future.
  const date = today && selected && isValidDayKey(selected) && dayNumber(selected) <= dayNumber(today) ? selected : today;
  const dataset = isDemoMode ? 'demo' : 'real';

  const result = useMemo(
    () =>
      date && today
        ? evaluateDailyScorecard({ evaluationDate: date, today, dataset, sessions, plans, nutritionLogs, sleepLogs, profile })
        : null,
    [date, today, dataset, sessions, plans, nutritionLogs, sleepLogs, profile]
  );

  const muscleSummary = useMemo(() => {
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number);
    // Local noon of the selected day: only the local calendar day of this instant is used.
    return buildMuscleMapSummary(sessions, new Date(y, m - 1, d, 12), { dataset });
  }, [date, dataset, sessions]);

  const shell = `space-y-4 ${className ?? ''}`.trim();

  if (loading) {
    return (
      <Card as="section" aria-label="Daily health scorecard" aria-busy="true" className={shell} data-testid="daily-scorecard-section">
        <SectionHeading className="mb-0" title="Daily health scorecard" description="Loading your scorecard…" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Card>
    );
  }

  if (!date || !today || !result) {
    return (
      <Card as="section" aria-label="Daily health scorecard" className={shell} data-testid="daily-scorecard-section">
        <SectionHeading className="mb-0" title="Daily health scorecard" />
        <p className="text-sm text-[var(--text-secondary)]">The scorecard cannot be shown because today’s date could not be determined.</p>
      </Card>
    );
  }

  const isToday = date === today;
  const relative = isToday ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : null;
  const scoredNames = result.scoredCategories.map((id) => result.categories[id].label);
  const unscored = result.unscoredCategories.map((id) => `${result.categories[id].label} (${STATUS_SHORT[result.categories[id].status]})`);
  const nothingLogged = (['workout', 'nutrition', 'hydration', 'sleep'] as CategoryId[]).every((id) => result.categories[id].status === 'no_data');

  return (
    <Card as="section" aria-label="Daily health scorecard" className={shell} data-testid="daily-scorecard-section">
      <SectionHeading
        className="mb-0"
        title="Daily health scorecard"
        description="A transparent, rules-based summary of what you logged. It is not medical advice."
        action={isDemoMode ? <Badge tone="info">Demo data</Badge> : undefined}
      />

      {/* Date navigation */}
      <div role="group" aria-label="Choose day" className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label="Previous day"
          onClick={() => setSelected(addDays(date, -1))}
          icon={<ChevronLeft className="w-4 h-4" aria-hidden />}
        />
        <div className="min-w-0 flex-1 sm:flex-none sm:min-w-[13rem] text-center" aria-live="polite" data-testid="scorecard-date">
          {relative && <p className="text-sm font-semibold text-[var(--text-primary)]">{relative}</p>}
          <p className={relative ? 'text-xs text-[var(--text-secondary)]' : 'text-sm font-semibold text-[var(--text-primary)]'}>
            <time dateTime={date}>{formatDayLong(date)}</time>
          </p>
        </div>
        <Button
          variant="secondary"
          aria-label="Next day"
          disabled={isToday}
          onClick={() => setSelected(addDays(date, 1))}
          icon={<ChevronRight className="w-4 h-4" aria-hidden />}
        />
        {!isToday && (
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Back to today
          </Button>
        )}
      </div>

      {/* Overview */}
      <div className="rounded-xl border border-line bg-surface-2 p-4 space-y-3" data-testid="scorecard-overview">
        {result.status === 'scored' && result.percent !== null ? (
          <>
            <p className="text-xs font-medium text-[var(--text-secondary)]">Daily score</p>
            <p className="text-[var(--text-primary)]" data-testid="scorecard-score">
              <span className="text-4xl font-bold tracking-tight tabular">{fmtDec(result.earnedPoints)}</span>
              <span className="text-lg text-[var(--text-secondary)]"> / {result.eligibleMax} pts</span>
            </p>
            <p className="text-sm text-[var(--text-primary)]" data-testid="scorecard-coverage">
              {fmtDec(result.percent)}% of eligible points · {result.scoredCount} of {result.totalCategories} categories scored
            </p>
            <ProgressBar value={result.percent} max={100} label="Share of eligible points earned" />
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight text-[var(--text-primary)]" data-testid="scorecard-insufficient">Insufficient data</p>
            <p className="text-sm text-[var(--text-secondary)]">
              {nothingLogged
                ? 'Nothing is logged for this day yet.'
                : `A score needs at least 2 scored categories worth 40 or more points. This day has ${result.scoredCount} scored (${result.eligibleMax} eligible pts).`}
            </p>
          </>
        )}
        <p className="text-xs text-[var(--text-secondary)]">
          This score is the share of the points available from your logged data that you earned: workout completion, nutrition against your own targets, and sleep
          duration against a default guideline. Categories without usable data are left out, never counted as zero. Hydration and recovery are for information only.
        </p>
        <dl className="space-y-1 text-xs" data-testid="scorecard-completeness">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--text-primary)]">Scored:</dt>
            <dd className="text-[var(--text-secondary)] break-words">{scoredNames.length > 0 ? scoredNames.join(', ') : 'none'}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--text-primary)]">Not scored:</dt>
            <dd className="text-[var(--text-secondary)] break-words">{unscored.length > 0 ? unscored.join(', ') : 'none'}</dd>
          </div>
        </dl>
        {result.limitations.map((l) => (
          <p key={l} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]" data-testid="scorecard-limitation">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            <span className="break-words">{l}</span>
          </p>
        ))}
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CATEGORY_ORDER.map((id) => (
          <CategoryCard
            key={id}
            cat={result.categories[id]}
            recovery={id === 'recovery' ? <RecoveryBody summary={muscleSummary} dataset={dataset} /> : undefined}
          />
        ))}
      </div>
    </Card>
  );
};
