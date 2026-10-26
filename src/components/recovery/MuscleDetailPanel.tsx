import React from 'react';
import { Badge, Card } from '../ui';
import {
  CURRENT_PERIOD_DAYS,
  LOAD_STATUS_LABELS,
  dayNumber,
  formatAverage,
  formatLoadSummary,
  getRegionLabel,
  type LoadStatus,
  type MuscleMapSummary,
  type MuscleRegionId,
} from '../../utils/muscleMap';
import { DETAIL_DISCLAIMER, STATUS_EXPLANATIONS } from './muscleMapStyles';

const MAX_EXERCISES_SHOWN = 8;

const BADGE_TONE: Record<LoadStatus, 'neutral' | 'accent' | 'warning' | 'info'> = {
  insufficient_data: 'neutral',
  no_recent_work: 'neutral',
  no_baseline: 'accent',
  lighter: 'info',
  typical: 'accent',
  heavier: 'warning',
};

/** 'YYYY-MM-DD' (a local calendar day) -> "Tue, 20 Oct 2026". Built with local-time parts, so it never shifts a day. */
export function formatDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole calendar days between two day keys, as words. Never hours. */
export function daysAgoText(dayKey: string, today: string): string {
  const n = dayNumber(today) - dayNumber(dayKey);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

const setsText = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`;

export interface MuscleDetailPanelProps {
  summary: MuscleMapSummary;
  region: MuscleRegionId | null;
}

export const MuscleDetailPanel: React.FC<MuscleDetailPanelProps> = ({ summary, region }) => {
  const { unmapped } = summary;
  const hasUnmapped = unmapped.currentPeriodSets > 0 || unmapped.baselinePeriodSets > 0;
  const r = region ? summary.regions[region] : null;
  const hasAnyRecord = r ? r.currentPeriodSets > 0 || r.lastTrainedDay !== null : false;

  return (
    <Card tone="raised" pad="md" className="space-y-4" aria-live="polite" data-testid="muscle-detail-panel">
      {r && region ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight text-white">{getRegionLabel(region)}</h3>
            <Badge tone={BADGE_TONE[r.status]}>{LOAD_STATUS_LABELS[r.status]}</Badge>
          </div>

          <p className="text-sm text-zinc-300">{STATUS_EXPLANATIONS[r.status]}</p>

          {!hasAnyRecord ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-zinc-400">
              No training recorded for {getRegionLabel(region)} yet. Once you log completed working sets for it, they will appear here.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-white tabular">{formatLoadSummary(r)}</p>
              {r.baselineWeeklyAverage !== null && (
                <p className="text-xs text-zinc-400">
                  Usual weekly average: {formatAverage(r.baselineWeeklyAverage)} {Number(formatAverage(r.baselineWeeklyAverage)) === 1 ? 'set' : 'sets'}, from the{' '}
                  {r.baselineWeeksUsed} {r.baselineWeeksUsed === 1 ? 'week' : 'weeks'} before the last {CURRENT_PERIOD_DAYS} days.
                </p>
              )}
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm min-[420px]:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Last trained</dt>
                  <dd className="text-white">
                    {r.lastTrainedDay ? (
                      <>
                        {formatDay(r.lastTrainedDay)} <span className="text-zinc-400">({daysAgoText(r.lastTrainedDay, summary.today)})</span>
                        {r.lastTrainedDayPrecision === 'date-only' && <span className="block text-xs text-zinc-400">Date is approximate.</span>}
                      </>
                    ) : (
                      'No training recorded'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Sessions in last 7 days</dt>
                  <dd className="text-white tabular">{r.currentPeriodSessions}</dd>
                </div>
                {r.setsToday > 0 && (
                  <div className="min-[420px]:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Logged today</dt>
                    <dd className="text-white tabular">
                      {setsText(r.setsToday)} <span className="text-xs text-zinc-400">(today is not part of the 7-day comparison)</span>
                    </dd>
                  </div>
                )}
              </dl>
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Recent exercises (last 7 days)</h4>
                {r.recentExercises.length === 0 ? (
                  <p className="text-sm text-zinc-400">None in the last 7 days.</p>
                ) : (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {r.recentExercises.slice(0, MAX_EXERCISES_SHOWN).map((name) => (
                      <li key={name} className="max-w-full break-words rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-white">
                        {name}
                      </li>
                    ))}
                    {r.recentExercises.length > MAX_EXERCISES_SHOWN && (
                      <li className="px-1 py-1 text-xs text-zinc-400">+{r.recentExercises.length - MAX_EXERCISES_SHOWN} more</li>
                    )}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div>
          <h3 className="text-base font-semibold tracking-tight text-white">Select a muscle region</h3>
          <p className="mt-1 text-sm text-zinc-400">Tap the figure or pick a region from the list to see your logged training for it.</p>
        </div>
      )}

      {hasUnmapped && (
        <div className="rounded-xl border border-dashed border-line-strong px-3 py-3" data-testid="unmapped-block">
          <h4 className="text-sm font-semibold text-white">Not assigned to a muscle region</h4>
          <p className="mt-1 text-xs text-zinc-400">
            {setsText(unmapped.currentPeriodSets)} in the last 7 days
            {unmapped.baselinePeriodSets > 0 && ` and ${setsText(unmapped.baselinePeriodSets)} in the 4 weeks before`} came from exercises that could not be
            matched to a region reliably. They are not counted for any region, so region totals can be lower than your real training.
          </p>
          {unmapped.exerciseNames.length > 0 && (
            <p className="mt-1.5 break-words text-xs text-white">{unmapped.exerciseNames.join(', ')}</p>
          )}
        </div>
      )}

      <p className="text-xs text-zinc-400">{DETAIL_DISCLAIMER}</p>
    </Card>
  );
};
