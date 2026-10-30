import React from 'react';
import { ArrowLeft, Check, Copy, Trash2, TrendingUp } from 'lucide-react';
import type { PlannedExercise, WorkoutPlan } from '../../types';
import { Badge, Button, Card, EmptyState, MetricCard, PageHeader, SectionHeading } from '../ui';
import {
  formatRest,
  humanize,
  pluralize,
  strategyLabel,
  summarizeDay,
  summarizePlan
} from '../../utils/planPresentation';

interface Props {
  plan: WorkoutPlan;
  isActive: boolean;
  onBack: () => void;
  onActivate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenOverloadRules?: () => void;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const ExerciseRow: React.FC<{ exercise: PlannedExercise; order: number }> = ({ exercise: ex, order }) => {
  const rest = formatRest(ex.restSeconds);
  const meta = [
    rest && `Rest ${rest}`,
    Number.isFinite(ex.targetRir) && `RIR ${ex.targetRir}`,
    ex.tempo && `Tempo ${ex.tempo}`,
    ex.isUnilateral && 'Unilateral'
  ].filter(Boolean) as string[];

  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className="w-7 h-7 shrink-0 rounded-full bg-surface-2 border border-line flex items-center justify-center text-xs font-semibold text-zinc-300 tabular"
        aria-label={`Exercise ${order}`}
      >
        {order}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white break-words">{ex.name}</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {[ex.muscleGroup, humanize(ex.equipment)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <p className="text-sm font-semibold text-white tabular shrink-0">
            {ex.workingSets} × {ex.repRange}
          </p>
        </div>
        {meta.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {meta.map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
          </div>
        )}
        {ex.notes && <p className="text-xs text-zinc-400 mt-2 break-words">{ex.notes}</p>}
      </div>
    </li>
  );
};

/** One plan, shown the way it is stored: days in order, each with its exercises and targets. */
export const PlanDetail: React.FC<Props> = ({
  plan,
  isActive,
  onBack,
  onActivate,
  onDuplicate,
  onDelete,
  onOpenOverloadRules
}) => {
  const summary = summarizePlan(plan);
  const created = formatDate(plan.createdAt);
  const updated = formatDate(plan.updatedAt);

  const info: Array<[string, string]> = [
    ['Training split', plan.trainingSplit],
    plan.progressionPhase ? ['Training phase', humanize(plan.progressionPhase)] : null,
    plan.defaultStrategy ? ['Overload strategy', strategyLabel(plan.defaultStrategy)] : null,
    summary.muscleGroups.length ? ['Muscle groups', summary.muscleGroups.join(', ')] : null,
    created ? ['Created', created] : null,
    updated && updated !== created ? ['Updated', updated] : null
  ].filter((row): row is [string, string] => Boolean(row && row[1]));

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack} className="-ml-3 mb-2">
          All plans
        </Button>
        <PageHeader
          title={plan.name}
          description={plan.description || `${plan.trainingSplit} split`}
          eyebrow={isActive ? 'Active plan' : plan.isStarter ? 'Template' : undefined}
          className="mb-0"
          actions={
            <>
              {!isActive && (
                <Button icon={<Check className="w-4 h-4" />} onClick={onActivate}>
                  Set active
                </Button>
              )}
              {onOpenOverloadRules && (
                <Button variant="secondary" icon={<TrendingUp className="w-4 h-4" />} onClick={onOpenOverloadRules}>
                  Overload rules
                </Button>
              )}
              <Button
                variant="secondary"
                iconOnly
                icon={<Copy className="w-4 h-4" />}
                aria-label={`Duplicate ${plan.name}`}
                title="Duplicate plan"
                onClick={onDuplicate}
              />
              <Button
                variant="danger"
                iconOnly
                icon={<Trash2 className="w-4 h-4" />}
                aria-label={`Delete ${plan.name}`}
                title="Delete plan"
                onClick={onDelete}
              />
            </>
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <MetricCard label="Days" value={summary.dayCount} />
        <MetricCard label="Exercises" value={summary.exerciseCount} />
        <MetricCard label="Sets" value={summary.setCount} hint="working sets" />
      </div>

      {info.length > 0 && (
        <Card as="section" aria-label="Plan overview">
          <SectionHeading title="Overview" />
          <dl className="divide-y divide-line">
            {info.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0 text-sm">
                <dt className="text-zinc-400 shrink-0">{label}</dt>
                <dd className="text-white text-right break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          {plan.planNotes && <p className="text-xs text-zinc-400 mt-3 pt-3 border-t border-line break-words">{plan.planNotes}</p>}
        </Card>
      )}

      <section aria-label="Weekly structure" className="space-y-3 sm:space-y-4">
        <SectionHeading title="Training days" description="In the order they are stored in the plan." />
        {plan.days.length === 0 ? (
          <EmptyState title="No training days" description="This plan has no days yet." />
        ) : (
          plan.days.map((day) => {
            const d = summarizeDay(day.exercises);
            return (
              <Card key={day.id} as="article">
                <SectionHeading
                  level={3}
                  title={day.dayName}
                  description={`${pluralize(d.exerciseCount, 'exercise')} · ${pluralize(d.setCount, 'set')}`}
                />
                {day.exercises.length === 0 ? (
                  <p className="text-xs text-zinc-500">No exercises in this day.</p>
                ) : (
                  <ol className="divide-y divide-line">
                    {day.exercises.map((ex, i) => (
                      <ExerciseRow key={ex.id} exercise={ex} order={i + 1} />
                    ))}
                  </ol>
                )}
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
};
