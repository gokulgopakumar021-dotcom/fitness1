import React from 'react';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import type { LoggedSet } from '../../types';
import { Button, Input, Select, cn } from '../ui';

/**
 * Column template shared by the set header and every set row so they stay aligned.
 * Phones: set | weight | reps | RIR | done | delete.
 * sm+: adds a "Previous" column and weight steppers.
 */
export const SET_GRID =
  'grid items-center gap-1.5 grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_3.25rem_2.75rem_1.75rem] ' +
  'sm:gap-2 sm:grid-cols-[2.5rem_4.5rem_minmax(9rem,1.4fr)_minmax(0,1fr)_4.5rem_2.75rem_2rem]';

const WEIGHT_STEP = 2.5;

// Fine weight steppers: sm+ only (phones use the numeric keypad), 44px tall, narrow.
const STEPPER =
  'hidden sm:flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-zinc-400 ' +
  'hover:text-white hover:bg-surface-2 transition-colors touch-press ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

interface SetRowProps {
  set: LoggedSet;
  /** Display number (1-based position within the exercise). */
  number: number;
  unit: string;
  /** Same-position working set from the last session, when one exists. */
  previous?: Pick<LoggedSet, 'weight' | 'reps'> | null;
  onUpdate: (updates: Partial<LoggedSet>) => void;
  onRemove: () => void;
}

/** One logged set: number/type, weight, reps, RIR, completion and delete. */
export const SetRow: React.FC<SetRowProps> = ({ set, number, unit, previous, onUpdate, onRemove }) => {
  const isCompleted = set.completed;
  const isWarmup = set.type === 'warmup';

  // Shown, never enforced: stored values follow the existing parsing rules.
  const weightError = set.weight < 0 ? 'Min 0' : undefined;
  const repsError = set.reps < 0 ? 'Min 0' : set.reps > 100 ? 'Max 100' : undefined;

  return (
    <li
      className={cn(
        SET_GRID,
        'rounded-control border px-1 py-1 transition-colors',
        isCompleted ? 'bg-accent/10 border-accent/25' : 'border-transparent'
      )}
      data-completed={isCompleted ? 'true' : 'false'}
    >
      {/* Set number; tap to switch between working and warm-up */}
      <button
        type="button"
        onClick={() => onUpdate({ type: isWarmup ? 'working' : 'warmup' })}
        className="h-11 w-full flex items-center justify-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title={isWarmup ? 'Warm-up set (tap to make it a working set)' : 'Working set (tap to make it a warm-up set)'}
        aria-label={isWarmup ? `Set ${number}, warm-up. Switch to working set` : `Set ${number}, working. Switch to warm-up set`}
      >
        <span
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-control border text-xs font-bold tabular',
            isWarmup ? 'bg-warning/10 text-warning border-warning/30' : 'bg-surface-3 text-zinc-300 border-line'
          )}
        >
          {isWarmup ? 'W' : number}
        </span>
      </button>

      {/* Previous performance for this set position (sm+; phones use the exercise summary line) */}
      <div className="hidden sm:flex items-center justify-center text-xs font-mono text-zinc-400 tabular truncate">
        {previous && !isWarmup ? `${previous.weight} × ${previous.reps}` : '—'}
      </div>

      {/* Weight, with fine steppers on larger screens */}
      <div className="flex items-center gap-1 min-w-0">
        <button
          type="button"
          className={STEPPER}
          onClick={() => onUpdate({ weight: Math.max(0, Number((set.weight - WEIGHT_STEP).toFixed(1))) })}
          aria-label={`Set ${number}: decrease weight by ${WEIGHT_STEP} ${unit}`}
          title={`-${WEIGHT_STEP}`}
        >
          <Minus className="w-3.5 h-3.5" aria-hidden />
        </button>
        <Input
          type="number"
          inputMode="decimal"
          step="0.5"
          mono
          compact
          value={set.weight || ''}
          onChange={(e) => onUpdate({ weight: parseFloat(e.target.value) || 0 })}
          placeholder="0"
          aria-label={`Set ${number} weight (${unit})`}
          error={weightError}
          wrapperClassName="flex-1"
        />
        <button
          type="button"
          className={STEPPER}
          onClick={() => onUpdate({ weight: Number((set.weight + WEIGHT_STEP).toFixed(1)) })}
          aria-label={`Set ${number}: increase weight by ${WEIGHT_STEP} ${unit}`}
          title={`+${WEIGHT_STEP}`}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      {/* Reps */}
      <Input
        type="number"
        inputMode="numeric"
        min="0"
        max="100"
        mono
        compact
        value={set.reps || ''}
        onChange={(e) => onUpdate({ reps: parseInt(e.target.value, 10) || 0 })}
        placeholder="0"
        aria-label={`Set ${number} reps`}
        error={repsError}
      />

      {/* Reps in reserve */}
      <Select
        mono
        compact
        value={set.rir !== undefined ? set.rir : 2}
        onChange={(e) => onUpdate({ rir: parseInt(e.target.value, 10) })}
        aria-label={`Set ${number} reps in reserve`}
        title="Reps in reserve (0 = to failure)"
      >
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4+</option>
      </Select>

      {/* Completion */}
      <Button
        variant={isCompleted ? 'primary' : 'secondary'}
        iconOnly
        onClick={() => onUpdate({ completed: !isCompleted })}
        aria-pressed={isCompleted}
        aria-label={isCompleted ? `Set ${number} complete. Mark incomplete` : `Complete set ${number}`}
        title={isCompleted ? 'Mark incomplete' : 'Complete set'}
      >
        <Check className={cn('w-5 h-5', isCompleted ? 'stroke-[3]' : 'stroke-2 text-zinc-400')} aria-hidden />
      </Button>

      {/* Delete: deliberately quiet and narrow so it is hard to hit by accident next to the check */}
      <button
        type="button"
        onClick={onRemove}
        className="h-11 w-full flex items-center justify-center rounded-control text-zinc-500 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
        title="Delete set"
        aria-label={`Delete set ${number}`}
      >
        <Trash2 className="w-4 h-4" aria-hidden />
      </button>
    </li>
  );
};
