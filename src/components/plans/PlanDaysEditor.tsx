import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PlannedExercise, WorkoutDay } from '../../types';
import { Button, Card, EmptyState, Input } from '../ui';
import { pluralize, summarizeDay } from '../../utils/planPresentation';

interface Props {
  days: WorkoutDay[];
  onChange: (days: WorkoutDay[]) => void;
  /** The manual builder can add whole days; the import review only edits what was extracted. */
  allowAddDay?: boolean;
}

/** Blank exercise row. Same defaults the builder and the review step have always used. */
export const createBlankExercise = (): PlannedExercise => ({
  id: `ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
  name: 'New Exercise',
  muscleGroup: 'Chest',
  equipment: 'barbell',
  workingSets: 3,
  repRange: '8-12',
  targetRir: 2,
  restSeconds: 90
});

/**
 * Edits training days and the exercises inside them: name, muscle group, sets, reps, add and remove.
 * Controlled and immutable: every change hands a new `days` array to `onChange`.
 */
export const PlanDaysEditor: React.FC<Props> = ({ days, onChange, allowAddDay }) => {
  const updateDay = (dIdx: number, patch: Partial<WorkoutDay>) =>
    onChange(days.map((d, i) => (i === dIdx ? { ...d, ...patch } : d)));

  const updateExercise = (dIdx: number, exIdx: number, patch: Partial<PlannedExercise>) =>
    updateDay(dIdx, {
      exercises: days[dIdx].exercises.map((ex, i) => (i === exIdx ? { ...ex, ...patch } : ex))
    });

  const removeDay = (dIdx: number) => onChange(days.filter((_, i) => i !== dIdx));

  const removeExercise = (dIdx: number, exIdx: number) =>
    updateDay(dIdx, { exercises: days[dIdx].exercises.filter((_, i) => i !== exIdx) });

  const addExercise = (dIdx: number) =>
    updateDay(dIdx, { exercises: [...days[dIdx].exercises, createBlankExercise()] });

  const addDay = () =>
    onChange([
      ...days,
      { id: `day-${Date.now()}`, dayName: `Day ${days.length + 1}`, dayOrder: days.length + 1, exercises: [] }
    ]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {days.length === 0 && (
        <EmptyState
          title="No training days"
          description={allowAddDay ? 'Add a training day to start building this plan.' : 'All days were removed from this plan.'}
        />
      )}

      {days.map((day, dIdx) => {
        const { exerciseCount, setCount } = summarizeDay(day.exercises);
        return (
          <Card key={day.id} as="section" aria-label={day.dayName || `Day ${dIdx + 1}`} className="space-y-3">
            <div className="flex items-end gap-2">
              <Input
                label="Day name"
                value={day.dayName}
                onChange={(e) => updateDay(dIdx, { dayName: e.target.value })}
                wrapperClassName="flex-1"
                className="font-semibold"
              />
              <Button
                variant="ghost"
                iconOnly
                icon={<Trash2 className="w-4 h-4" />}
                aria-label={`Remove ${day.dayName || `day ${dIdx + 1}`}`}
                title="Remove day"
                onClick={() => removeDay(dIdx)}
              />
            </div>
            <p className="text-xs text-zinc-500 tabular">
              {pluralize(exerciseCount, 'exercise')} · {pluralize(setCount, 'set')}
            </p>

            <div className="space-y-2">
              {day.exercises.map((ex, exIdx) => (
                <div key={ex.id} className="rounded-control border border-line p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <Input
                      label="Exercise"
                      value={ex.name}
                      placeholder="Exercise name"
                      onChange={(e) => updateExercise(dIdx, exIdx, { name: e.target.value })}
                      wrapperClassName="flex-1"
                      className="font-semibold"
                    />
                    <Button
                      variant="ghost"
                      iconOnly
                      icon={<Trash2 className="w-4 h-4" />}
                      aria-label={`Remove ${ex.name || 'exercise'}`}
                      title="Remove exercise"
                      onClick={() => removeExercise(dIdx, exIdx)}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Input
                      label="Muscle group"
                      value={ex.muscleGroup}
                      placeholder="Muscle"
                      onChange={(e) => updateExercise(dIdx, exIdx, { muscleGroup: e.target.value })}
                      wrapperClassName="col-span-2 sm:col-span-1"
                    />
                    <Input
                      label="Sets"
                      type="number"
                      inputMode="numeric"
                      mono
                      value={ex.workingSets}
                      onChange={(e) =>
                        updateExercise(dIdx, exIdx, { workingSets: parseInt(e.target.value, 10) || 3 })
                      }
                    />
                    <Input
                      label="Reps"
                      mono
                      value={ex.repRange}
                      placeholder="8-12"
                      onChange={(e) => updateExercise(dIdx, exIdx, { repRange: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button variant="ghost" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => addExercise(dIdx)}>
              Add exercise
            </Button>
          </Card>
        );
      })}

      {allowAddDay && (
        <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={addDay} fullWidth className="sm:w-auto">
          Add training day
        </Button>
      )}
    </div>
  );
};
