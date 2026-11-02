import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ExerciseDefinition,
  MirrorSetData,
  WorkoutMirrorExerciseId,
  WorkoutMirrorSession,
} from '../../types/workoutMirror';
import { EXERCISE_CATALOG } from '../../services/workoutMirror/exerciseCatalog';
import { CameraController } from '../../services/camera';
import { mirrorPoseService } from '../../services/workoutMirror/mirrorPoseService';
import { saveMirrorSession } from '../../services/workoutMirror/mirrorStorage';
import { getStorageScope } from '../../storage/storageScope';
import { ExerciseSelector } from './ExerciseSelector';
import { PreWorkoutCalibration } from './PreWorkoutCalibration';
import { LiveMirrorView } from './LiveMirrorView';
import { PostWorkoutMirrorReport } from './PostWorkoutMirrorReport';

type MirrorStage = 'select' | 'calibrate' | 'setup' | 'live' | 'report';

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
    initialExerciseId && EXERCISE_CATALOG[initialExerciseId] ? 'calibrate' : 'select'
  );

  const [selectedExercise, setSelectedExercise] = useState<ExerciseDefinition | null>(() =>
    initialExerciseId && EXERCISE_CATALOG[initialExerciseId]
      ? EXERCISE_CATALOG[initialExerciseId]
      : null
  );

  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [completedSets, setCompletedSets] = useState<MirrorSetData[]>([]);

  // Guarantee that camera stream and pose model are released on unmount
  useEffect(() => {
    return () => {
      cameraController.stop();
      mirrorPoseService.dispose();
    };
  }, [cameraController]);

  // Handler: Exercise chosen
  const handleSelectExercise = (exercise: ExerciseDefinition) => {
    setSelectedExercise(exercise);
    setCompletedSets([]);
    setCurrentSetNumber(1);
    setStage('calibrate');
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
    setStage('calibrate');
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

      // Aggregate observations across sets
      const obsMap = new Map<string, number>();
      completedSets.forEach((s) => {
        if (s.observationsSummary) {
          Object.entries(s.observationsSummary).forEach(([code, count]) => {
            obsMap.set(code, (obsMap.get(code) || 0) + count);
          });
        }
      });
      const primaryObservations = Array.from(obsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([code]) => code);

      const feedbackNotes =
        primaryObservations.length > 0
          ? primaryObservations
          : selectedExercise.techniquePoints || [];

      const session: WorkoutMirrorSession = {
        id: `mirror-${Date.now()}`,
        userId: getStorageScope() || 'local-user',
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        startedAt: new Date(Date.now() - totalActiveTime * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        totalDurationSec: totalActiveTime,
        sets: completedSets,
        overallConsistencyScore: overallConsistency,
        primaryObservations,
        feedbackNotes,
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

    const obsMap = new Map<string, number>();
    completedSets.forEach((s) => {
      if (s.observationsSummary) {
        Object.entries(s.observationsSummary).forEach(([code, count]) => {
          obsMap.set(code, (obsMap.get(code) || 0) + count);
        });
      }
    });
    const primaryObservations = Array.from(obsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code]) => code);

    const feedbackNotes =
      primaryObservations.length > 0
        ? primaryObservations
        : selectedExercise.techniquePoints || [];

    return {
      id: `current-mirror-${Date.now()}`,
      userId: getStorageScope() || 'local-user',
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      startedAt: new Date(Date.now() - totalActiveTime * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      totalDurationSec: totalActiveTime,
      sets: completedSets,
      overallConsistencyScore: overallConsistency,
      primaryObservations,
      feedbackNotes,
    };
  }, [selectedExercise, completedSets]);

  return (
    <div className="w-full">
      {stage === 'select' && (
        <ExerciseSelector onSelectExercise={handleSelectExercise} />
      )}

      {(stage === 'calibrate' || stage === 'setup') && selectedExercise && (
        <PreWorkoutCalibration
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
