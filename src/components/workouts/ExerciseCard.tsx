import React from 'react';
import { Check, Clock, Eye, Info, Plus, Sparkles, StickyNote, Trash2, Video } from 'lucide-react';
import type { LoggedExercise, LoggedSet } from '../../types';
import { calculateVolumeLoad } from '../../utils/calculations';
import { Badge, Button, Card, cn } from '../ui';
import { SET_GRID, SetRow } from './SetRow';

export interface LastSessionSummary {
  date: string;
  workingSets: Array<Pick<LoggedSet, 'weight' | 'reps'>>;
}

interface ExerciseCardProps {
  exercise: LoggedExercise;
  /** 0-based position, shown as the exercise number. */
  index: number;
  unit: string;
  lastSession: LastSessionSummary | null;
  onUpdateSet: (setIndex: number, updates: Partial<LoggedSet>) => void;
  onAddSet: (type: 'working' | 'warmup') => void;
  onRemoveSet: (setIndex: number) => void;
  onRemoveExercise: () => void;
  onCopyPreviousWeight: (weight: number) => void;
  onOpenForm: (showVideo: boolean) => void;
  onOpenCoach: () => void;
}

const ACTION_BTN = 'min-h-11 sm:min-h-0'; // 44px on phones, 36px (sm) on larger screens

/** One exercise in the live workout: identity, previous performance, set list and set controls. */
export const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  index,
  unit,
  lastSession,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onRemoveExercise,
  onCopyPreviousWeight,
  onOpenForm,
  onOpenCoach
}) => {
  const totalSets = exercise.sets.length;
  const doneSets = exercise.sets.filter((s) => s.completed).length;
  const allDone = totalSets > 0 && doneSets === totalSets;

  const completedWorkingSets = exercise.sets.filter((s) => s.completed && s.type === 'working');
  const currentVolume = calculateVolumeLoad(completedWorkingSets, false);

  const lastWorkingSets = lastSession ? lastSession.workingSets : [];
  const lastWorkingWeight = lastWorkingSets.length > 0 ? lastWorkingSets[0].weight : 0;
  const lastRepsString = lastWorkingSets.map((s) => s.reps).join(', ');

  // Position of each working set among the exercise's working sets, to line it up with last session.
  let workingSeen = 0;
  const previousFor = exercise.sets.map((s) => {
    if (s.type !== 'working') return null;
    const prev = lastWorkingSets[workingSeen] ?? null;
    workingSeen += 1;
    return prev;
  });

  const notes = exercise.notes?.trim();

  return (
    <Card as="article" pad="none" tone={allDone ? 'accent' : 'default'} aria-label={exercise.name} data-complete={allDone ? 'true' : 'false'}>
      {/* Identity */}
      <div className="p-4 sm:p-5 pb-3 sm:pb-3 flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular border',
            allDone ? 'bg-accent text-accent-ink border-accent' : 'bg-surface-3 text-zinc-300 border-line'
          )}
          aria-hidden
        >
          {allDone ? <Check className="w-4 h-4 stroke-[3]" /> : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-white leading-snug break-words">{exercise.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {exercise.muscleGroup && <Badge className="capitalize">{exercise.muscleGroup}</Badge>}
            {exercise.equipment && <Badge className="capitalize">{exercise.equipment}</Badge>}
            {exercise.repRange && (
              <span className="text-xs text-zinc-400">
                Target: {exercise.repRange} reps @ {exercise.targetRir} RIR
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge tone={allDone ? 'accent' : 'neutral'} aria-label={`${doneSets} of ${totalSets} sets complete`}>
            <span className="tabular">{doneSets}/{totalSets}</span> sets
          </Badge>
          <span className="text-label text-zinc-400 font-mono tabular">
            Vol {currentVolume.toLocaleString()} {unit}
          </span>
        </div>
      </div>

      <div className="px-4 sm:px-5 space-y-3">
        {/* Form guidance and coaching */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className={ACTION_BTN}
            onClick={() => onOpenForm(false)}
            title="Preview correct posture, joint angles, and workout form"
            icon={<Eye className="w-3.5 h-3.5 text-info" aria-hidden />}
          >
            Biomechanics
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={ACTION_BTN}
            onClick={() => onOpenForm(true)}
            title="Watch an exercise demonstration video"
            icon={<Video className="w-3.5 h-3.5 text-info" aria-hidden />}
          >
            Watch video
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={ACTION_BTN}
            onClick={onOpenCoach}
            title="Get AI form cues, warm-up ramp, and substitutions"
            icon={<Sparkles className="w-3.5 h-3.5 text-volt-adaptive" aria-hidden />}
          >
            AI Coach &amp; Subs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(ACTION_BTN, 'ml-auto text-zinc-400 hover:text-danger')}
            onClick={onRemoveExercise}
            title="Remove exercise"
            aria-label={`Remove ${exercise.name}`}
            icon={<Trash2 className="w-3.5 h-3.5" aria-hidden />}
          >
            <span className="hidden sm:inline">Remove</span>
          </Button>
        </div>

        {notes && (
          <p className="flex items-start gap-2 text-xs text-zinc-400">
            <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" aria-hidden />
            <span className="min-w-0 break-words">{notes}</span>
          </p>
        )}

        {/* Previous performance */}
        {lastSession ? (
          <div className="flex items-center justify-between gap-3 rounded-control bg-surface-2 border border-line px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Info className="w-4 h-4 text-info shrink-0" aria-hidden />
              <span className="text-zinc-300 min-w-0">
                Last session ({lastSession.date}):{' '}
                <span className="font-mono font-semibold text-white tabular whitespace-nowrap">
                  {lastWorkingWeight} {unit}
                </span>{' '}
                &times; [{lastRepsString}] reps
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className={cn(ACTION_BTN, 'shrink-0')}
              onClick={() => onCopyPreviousWeight(lastWorkingWeight)}
              title="Copy weight to all sets"
            >
              Use {lastWorkingWeight} {unit}
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span>First logged session for this movement. Establishing baseline.</span>
          </p>
        )}
      </div>

      {/* Sets */}
      <div className="px-3 sm:px-4 pt-3">
        <div
          className={cn(SET_GRID, 'px-1 pb-1.5 text-label font-semibold text-zinc-500 text-center border-b border-line')}
          aria-hidden
        >
          <span>Set</span>
          <span className="hidden sm:block">Previous</span>
          <span>{unit}</span>
          <span>Reps</span>
          <span>RIR</span>
          <span>
            <Check className="w-3.5 h-3.5 mx-auto" />
          </span>
          <span />
        </div>
        {totalSets > 0 ? (
          <ul className="space-y-1 pt-1.5" aria-label={`${exercise.name} sets`}>
            {exercise.sets.map((set, setIndex) => (
              <SetRow
                key={set.id}
                set={set}
                number={set.setNumber}
                unit={unit}
                previous={previousFor[setIndex]}
                onUpdate={(updates) => onUpdateSet(setIndex, updates)}
                onRemove={() => onRemoveSet(setIndex)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-xs text-zinc-500">No sets yet. Add a set to start logging.</p>
        )}
      </div>

      {/* Set controls */}
      <div className="p-4 sm:p-5 pt-3 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => onAddSet('working')}
          icon={<Plus className="w-4 h-4 text-volt-adaptive" aria-hidden />}
          className="whitespace-nowrap"
        >
          Add Set
        </Button>
        <Button
          variant="ghost"
          onClick={() => onAddSet('warmup')}
          icon={<Plus className="w-4 h-4" aria-hidden />}
          className="whitespace-nowrap"
        >
          Warmup Set
        </Button>
        <span className="col-span-2 sm:col-span-1 sm:ml-auto inline-flex items-center justify-center sm:justify-end gap-1 text-label font-mono text-zinc-400 tabular">
          <Clock className="w-3 h-3 text-zinc-500" aria-hidden />
          Rest: {exercise.restSeconds}s
        </span>
      </div>
    </Card>
  );
};
