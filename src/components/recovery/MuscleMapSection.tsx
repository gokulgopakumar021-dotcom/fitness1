import React, { useMemo, useState } from 'react';
import { Badge, Card, SectionHeading } from '../ui';
import type { WorkoutSession } from '../../types';
import {
  LOAD_DISCLAIMER,
  buildMuscleMapSummary,
  dayNumber,
  viewsForRegion,
  type BodyView,
  type MuscleRegionId,
} from '../../utils/muscleMap';
import { MuscleMap } from './MuscleMap';
import { MuscleDetailPanel, formatDay } from './MuscleDetailPanel';

export interface MuscleMapSectionProps {
  /** Workout sessions from local storage. Filtering (completed, demo vs real, dates) is done by the data layer. */
  sessions: readonly WorkoutSession[];
  /** When true the map uses ONLY demo sessions and says so; otherwise it uses ONLY real sessions. */
  isDemoMode?: boolean;
  /** Injectable clock for tests. Defaults to the current time at render. */
  now?: Date;
  className?: string;
}

/**
 * Interactive muscle map: front/back figure, region list, legend and detail panel.
 *
 * Local only. It reads the sessions it is given and computes everything in the browser: no network
 * calls, no AI, no new storage, and it never reads the AI Recovery Insights state.
 */
export const MuscleMapSection: React.FC<MuscleMapSectionProps> = ({ sessions, isDemoMode = false, now, className }) => {
  const [view, setView] = useState<BodyView>('front');
  const [selected, setSelected] = useState<MuscleRegionId | null>(null);

  const summary = useMemo(
    () => buildMuscleMapSummary(sessions, now ?? new Date(), { dataset: isDemoMode ? 'demo' : 'real' }),
    [sessions, isDemoMode, now]
  );

  const handleSelect = (id: MuscleRegionId) => {
    setSelected(id);
    // Make sure the chosen region is actually visible on the figure.
    if (!viewsForRegion(id).includes(view)) setView(viewsForRegion(id)[0]);
  };

  const { history } = summary;
  const trackedDays = history.firstTrackedDay ? dayNumber(summary.today) - dayNumber(history.firstTrackedDay) : 0;

  return (
    <Card as="section" aria-label="Muscle training map" className={`space-y-4 ${className ?? ''}`.trim()} data-testid="muscle-map-section">
      <SectionHeading
        className="mb-0"
        title="Muscle training map"
        description={LOAD_DISCLAIMER}
        action={isDemoMode ? <Badge tone="info">Demo data</Badge> : undefined}
      />

      {!history.firstTrackedDay ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-zinc-300" data-testid="history-banner">
          {isDemoMode ? 'No demo workouts to show yet.' : 'No completed workouts logged yet.'} Log a few workouts and your training load will appear here.
        </p>
      ) : !history.sufficient ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-zinc-300" data-testid="history-banner">
          Your first logged workout is {formatDay(history.firstTrackedDay)} ({trackedDays} {trackedDays === 1 ? 'day' : 'days'} ago). Comparisons start once you have
          about 3 weeks of logged history, so every region shows “Insufficient data” for now.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <MuscleMap summary={summary} view={view} onViewChange={setView} selectedRegion={selected} onSelectRegion={handleSelect} />
        <MuscleDetailPanel summary={summary} region={selected} />
      </div>
    </Card>
  );
};
