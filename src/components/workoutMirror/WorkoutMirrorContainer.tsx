import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ExerciseDefinition,
  MirrorSetData,
  WorkoutMirrorExerciseId,
  WorkoutMirrorSession,
} from '../../types/workoutMirror';
import { EXERCISE_CATALOG } from '../../services/workoutMirror/exerciseCatalog';
import { CameraController } from '../../services/camera';
import { saveMirrorSession } from '../../services/workoutMirror/mirrorStorage';
import { ExerciseSelector } from './ExerciseSelector';
import { CameraSetupGuide } from './CameraSetupGuide';
import { LiveMirrorView } from './LiveMirrorView';
import { PostWorkoutMirrorReport } from './PostWorkoutMirrorReport';

type MirrorStage = 'select' | 'setup' | 'live' | 'report';

interface WorkoutMirrorContainerProps {
  initialExerciseId?: WorkoutMirrorExerciseId;
  onSetLoggedToWorkout?: (exerciseName: string, reps: number) => void;
  onExit?: () => void;
}

export const WorkoutMirrorContainer: React.FC<WorkoutMirrorContainerProps> = ({
  initialExerciseId,
  onSetLoggedToWorkout,
  onExit,
}) => {
  const cameraControllerRef = useRef<CameraController>(new CameraController());
  const cameraController = cameraControllerRef.current;

  const [stage, setStage] = useState<MirrorStage>(() =>
    initialExerciseId && EXERCISE_CATALOG[initialExerciseId] ? 'setup' : 'select'
  );

  const [selectedExercise, setSelectedExercise] = useState<ExerciseDefinition | null>(() =>
    initialExerciseId && EXERCISE_CATALOG[initialExerciseId]
      ? EXERCISE_CATALOG[initialExerciseId]
      : null
  );

  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [completedSets, setCompletedSets] = useState<MirrorSetData[]>([]);

  // Guarantee that camera stream is always released on unmount
  useEffect(() => {
    return () => {
      cameraController.stop();
    };
  }, [cameraController]);

  // Handler: Exercise chosen
  const handleSelectExercise = (exercise: ExerciseDefinition) => {
    setSelectedExercise(exercise);
    setCompletedSets([]);
    setCurrentSetNumber(1);
    setStage('setup');
  };

  // Handler: Ready to start from setup guide
  const handleReadyToStart = (facing: 'user' | 'environment') => {
    setStage('live');
  };

  // Handler: Set finished in live view
  const handleSetCompleted = (setData: MirrorSetData) => {
    const updatedSets = [...completedSets, setData];
    setCompletedSets(updatedSets);

    if (onSetLoggedToWorkout && selectedExercise) {
      onSetLoggedToWorkout(
        selectedExercise.name,
        setData.userAdjustedReps || setData.detectedReps
      );
    }

    setStage('report');
  };

  // Handler: Log another set
  const handleLogAnotherSet = () => {
    setCurrentSetNumber((prev) => prev + 1);
    setStage('setup');
  };

  // Handler: Discard
  const handleDiscard = () => {
    cameraController.stop();
    setCompletedSets([]);
    setCurrentSetNumber(1);
    if (onExit) onExit();
    else setStage('select');
  };

  // Handler: Save and finish
  const handleSaveAndExit = () => {
    if (selectedExercise && completedSets.length > 0) {
      const totalActiveTime = completedSets.reduce((sum, s) => sum + s.activeDurationSec, 0);
      const totalScore = completedSets.reduce((sum, s) => sum + s.averageFormScore, 0);
      const overallConsistency = Math.round(totalScore / completedSets.length);

      const session: WorkoutMirrorSession = {
        id: `mirror-${Date.now()}`,
        userId: 'local-user',
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        startedAt: new Date(Date.now() - totalActiveTime * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        totalDurationSec: totalActiveTime,
        sets: completedSets,
        overallConsistencyScore: overallConsistency,
        primaryObservations: [],
        feedbackNotes: [],
      };

      saveMirrorSession(session);
    }

    cameraController.stop();
    setCompletedSets([]);
    setCurrentSetNumber(1);
    if (onExit) onExit();
    else setStage('select');
  };

  // Current session object for report
  const currentSession: WorkoutMirrorSession | null = useMemo(() => {
    if (!selectedExercise || completedSets.length === 0) return null;
    const totalActiveTime = completedSets.reduce((sum, s) => sum + s.activeDurationSec, 0);
    const totalScore = completedSets.reduce((sum, s) => sum + s.averageFormScore, 0);
    const overallConsistency = Math.round(totalScore / completedSets.length);

    return {
      id: `current-mirror-${Date.now()}`,
      userId: 'local-user',
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      startedAt: new Date(Date.now() - totalActiveTime * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      totalDurationSec: totalActiveTime,
      sets: completedSets,
      overallConsistencyScore: overallConsistency,
      primaryObservations: [],
      feedbackNotes: [],
    };
  }, [selectedExercise, completedSets]);

  return (
    <div className="w-full">
      {stage === 'select' && (
        <ExerciseSelector onSelectExercise={handleSelectExercise} />
      )}

      {stage === 'setup' && selectedExercise && (
        <CameraSetupGuide
          exercise={selectedExercise}
          cameraController={cameraController}
          onReadyToStart={handleReadyToStart}
          onCancel={() => {
            cameraController.stop();
            setStage('select');
          }}
        />
      )}

      {stage === 'live' && selectedExercise && (
        <LiveMirrorView
          exercise={selectedExercise}
          cameraController={cameraController}
          initialSetNumber={currentSetNumber}
          onSetCompleted={handleSetCompleted}
          onCancelSession={() => {
            cameraController.stop();
            setStage('select');
          }}
        />
      )}

      {stage === 'report' && selectedExercise && currentSession && (
        <PostWorkoutMirrorReport
          exercise={selectedExercise}
          session={currentSession}
          onLogAnotherSet={handleLogAnotherSet}
          onSaveAndExit={handleSaveAndExit}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
};
