import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExerciseSelector } from './ExerciseSelector';
import { PostWorkoutMirrorReport } from './PostWorkoutMirrorReport';
import { EXERCISE_CATALOG } from '../../services/workoutMirror/exerciseCatalog';
import { WorkoutMirrorSession } from '../../types/workoutMirror';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Workout Mirror Components', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders ExerciseSelector with all 8 exercises and filter chips', async () => {
    const handleSelect = vi.fn();
    await act(async () => {
      root.render(<ExerciseSelector onSelectExercise={handleSelect} />);
    });

    const text = container.textContent || '';
    expect(text).toContain('AI Workout Mirror');
    expect(text).toContain('Bodyweight Squat');
    expect(text).toContain('Standard Push-Up');
    expect(text).toContain('Forward Lunge');
    expect(text).toContain('Reverse Lunge');
    expect(text).toContain('Dumbbell Shoulder Press');
    expect(text).toContain('Bicep Curl');
    expect(text).toContain('Core Plank (Static Hold)');
    expect(text).toContain('Jumping Jack');
  });

  it('filters exercises by category click', async () => {
    const handleSelect = vi.fn();
    await act(async () => {
      root.render(<ExerciseSelector onSelectExercise={handleSelect} />);
    });

    const cardioBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'Cardio'
    );
    expect(cardioBtn).toBeTruthy();

    await act(async () => {
      cardioBtn?.click();
    });

    const text = container.textContent || '';
    expect(text).toContain('Jumping Jack');
    expect(text).not.toContain('Bodyweight Squat');
    expect(text).not.toContain('Standard Push-Up');
  });

  it('renders PostWorkoutMirrorReport with metrics and consistency score', async () => {
    const squatDef = EXERCISE_CATALOG['squat'];
    const mockSession: WorkoutMirrorSession = {
      id: 'test-session',
      userId: 'local-user',
      exerciseId: 'squat',
      exerciseName: 'Bodyweight Squat',
      startedAt: new Date().toISOString(),
      totalDurationSec: 65,
      overallConsistencyScore: 92,
      primaryObservations: [],
      feedbackNotes: [],
      sets: [
        {
          setNumber: 1,
          detectedReps: 12,
          userAdjustedReps: 12,
          activeDurationSec: 65,
          averageFormScore: 92,
          reps: [],
          observationsSummary: {
            'Knees caving inward! Push knees outward over your toes.': 1,
          },
        },
      ],
    };

    const handleAnotherSet = vi.fn();
    const handleSaveAndExit = vi.fn();
    const handleDiscard = vi.fn();

    await act(async () => {
      root.render(
        <PostWorkoutMirrorReport
          exercise={squatDef}
          session={mockSession}
          onLogAnotherSet={handleAnotherSet}
          onSaveAndExit={handleSaveAndExit}
          onDiscard={handleDiscard}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Workout Mirror Session Complete');
    expect(text).toContain('92%');
    expect(text).toContain('12');

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save & Finish')
    );
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
    });
    expect(handleSaveAndExit).toHaveBeenCalled();
  });
});
