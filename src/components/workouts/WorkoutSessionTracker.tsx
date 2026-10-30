import React, { useState, useEffect, useCallback } from 'react';
import {
  Check,
  Plus,
  Trash2,
  Clock,
  RotateCcw,
  Dumbbell,
  Timer,
  ArrowRight,
  Flame,
  Pause,
  Play,
  Bluetooth,
  Heart
} from 'lucide-react';
import {
  EquipmentType,
  LoggedExercise,
  LoggedSet,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { calculateVolumeLoad } from '../../utils/calculations';
import { extractExerciseHistory } from '../../utils/progressionEngine';
import { RestTimer, playTimerChime } from '../common/RestTimer';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from '../trainer/DynamicWarmupModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Select,
  Textarea,
  cn
} from '../ui';
import { ExerciseCard } from './ExerciseCard';

interface WorkoutTrackerProps {
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  onSessionUpdated: (session: WorkoutSession | null) => void;
  onNavigateToPlans: () => void;
}

export const WorkoutSessionTracker: React.FC<WorkoutTrackerProps> = ({
  profile,
  activeSession,
  onSessionUpdated,
  onNavigateToPlans
}) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string>('');
  const [allSessions, setAllSessions] = useState<WorkoutSession[]>([]);

  // Rest timer modal state
  const [isRestTimerOpen, setIsRestTimerOpen] = useState<boolean>(false);
  const [restTimerSeconds, setRestTimerSeconds] = useState<number>(90);

  // New exercise modal
  const [isAddingExercise, setIsAddingExercise] = useState<boolean>(false);
  const [newExName, setNewExName] = useState<string>('');
  const [newExMuscle, setNewExMuscle] = useState<string>('Chest');
  const [newExEquipment, setNewExEquipment] = useState<EquipmentType>('barbell');
  const [newExReps, setNewExReps] = useState<string>('8-12');

  // Finish confirmation modal
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [finishNotes, setFinishNotes] = useState<string>('');

  // Discard confirmation modal
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);

  // Remove-exercise confirmation (only asked when the exercise already has completed sets)
  const [exerciseToRemove, setExerciseToRemove] = useState<number | null>(null);

  // Show the "movement name required" message only after a submit attempt
  const [addExTouched, setAddExTouched] = useState<boolean>(false);

  // Posture & Form Preview modal state
  const [posturePreviewExercise, setPosturePreviewExercise] = useState<string | null>(null);
  const [posturePreviewShowVideo, setPosturePreviewShowVideo] = useState<boolean>(false);

  // Bluetooth Gadget hook
  const { isConnected, liveHeartRate, currentZone, activeCaloriesBurned, setIsGadgetModalOpen } = useBluetoothGadget();

  // Load plans & past sessions for previous performance comparison
  useEffect(() => {
    const loadedPlans = db.getPlans();
    setPlans(loadedPlans);
    const activeId = db.getActivePlanId() || (loadedPlans.length > 0 ? loadedPlans[0].id : null);
    setActivePlanId(activeId);
    setAllSessions(db.getSessions());
  }, []);

  // Update selected day when active plan changes
  useEffect(() => {
    if (activePlanId) {
      const activePlan = plans.find((p) => p.id === activePlanId);
      if (activePlan && activePlan.days.length > 0) {
        setSelectedDayId(activePlan.days[0].id);
      }
    }
  }, [activePlanId, plans]);

  // Timer Pause & Reset state
  const isPaused = Boolean(activeSession?.isPaused);
  const [showResetTimerConfirm, setShowResetTimerConfirm] = useState<boolean>(false);
  const [timerNotice, setTimerNotice] = useState<string | null>(null);

  // AI Coach modal state
  const [aiCoachExercise, setAiCoachExercise] = useState<LoggedExercise | null>(null);
  const [aiCoachIndex, setAiCoachIndex] = useState<number | null>(null);
  const [aiCoachLoading, setAiCoachLoading] = useState<boolean>(false);
  const [aiCoachData, setAiCoachData] = useState<any>(null);
  const [aiCoachError, setAiCoachError] = useState<string | null>(null);

  // AI Post-Workout Insights state
  const [aiInsightsLoading, setAiInsightsLoading] = useState<boolean>(false);
  const [aiInsightsData, setAiInsightsData] = useState<any>(null);
  const [aiInsightsError, setAiInsightsError] = useState<string | null>(null);

  // Dynamic Warm-up Generator state
  const [showWarmupModal, setShowWarmupModal] = useState<boolean>(false);

  // Elapsed workout time (respects pause and reset)
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0);
      return;
    }

    if (activeSession.isPaused) {
      setElapsedSeconds(activeSession.pausedElapsedSeconds || 0);
      return;
    }

    const startMs = new Date(activeSession.startTime).getTime();
    const updateElapsed = () => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startMs) / 1000)));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.startTime, activeSession?.isPaused, activeSession?.pausedElapsedSeconds, activeSession]);

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle Pause/Resume
  const handleTogglePause = () => {
    if (!activeSession) return;
    if (activeSession.isPaused) {
      const prevPausedSec = activeSession.pausedElapsedSeconds || elapsedSeconds;
      const newStartTime = new Date(Date.now() - prevPausedSec * 1000).toISOString();
      const updated: WorkoutSession = {
        ...activeSession,
        isPaused: false,
        startTime: newStartTime,
        pausedElapsedSeconds: undefined
      };
      saveSession(updated);
      setTimerNotice('Workout Resumed. Timer is running.');
      setTimeout(() => setTimerNotice(null), 3000);
    } else {
      const updated: WorkoutSession = {
        ...activeSession,
        isPaused: true,
        pausedElapsedSeconds: elapsedSeconds
      };
      saveSession(updated);
      setTimerNotice(`Workout Paused at ${formatTime(elapsedSeconds)}.`);
      setTimeout(() => setTimerNotice(null), 3000);
    }
  };

  // Reset Workout Timer to 00:00
  const handleResetWorkoutTimer = () => {
    if (!activeSession) return;
    const nowIso = new Date().toISOString();
    const updated: WorkoutSession = {
      ...activeSession,
      startTime: nowIso,
      pausedElapsedSeconds: activeSession.isPaused ? 0 : undefined
    };
    saveSession(updated);
    setElapsedSeconds(0);
    setShowResetTimerConfirm(false);
    setTimerNotice('Session timer reset to 00:00.');
    setTimeout(() => setTimerNotice(null), 3000);
  };

  // AI Coach trigger
  const handleOpenAiCoach = async (ex: LoggedExercise, index: number) => {
    setAiCoachExercise(ex);
    setAiCoachIndex(index);
    setAiCoachData(null);
    setAiCoachError(null);
    setAiCoachLoading(true);

    try {
      const res = await fetch('/api/ai-exercise-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseName: ex.name,
          equipment: ex.equipment,
          targetReps: ex.repRange,
          targetRir: ex.targetRir,
          notes: ex.notes
        })
      });
      const json = await res.json();
      if (json.success && json.data) {
        setAiCoachData(json.data);
      } else {
        setAiCoachError(json.error || 'Failed to retrieve coaching analysis');
      }
    } catch (e: any) {
      setAiCoachError(e.message || 'Network error fetching coaching data');
    } finally {
      setAiCoachLoading(false);
    }
  };

  const handleApplySubstitution = (sub: { name: string; equipment: string }) => {
    if (!activeSession || aiCoachIndex === null) return;
    const exercises = [...activeSession.exercises];
    exercises[aiCoachIndex] = {
      ...exercises[aiCoachIndex],
      name: sub.name,
      equipment: (sub.equipment.toLowerCase() as EquipmentType) || 'dumbbell',
      notes: `Substituted via AI Coach: was ${exercises[aiCoachIndex].name}`
    };
    saveSession({ ...activeSession, exercises });
    setAiCoachExercise(null);
    setAiCoachIndex(null);
  };

  const activePlan = plans.find((p) => p.id === activePlanId);

  // Start new workout session from chosen routine day
  const handleStartWorkout = (dayIdToStart?: string) => {
    const targetDayId = dayIdToStart || selectedDayId;
    let chosenDay = activePlan?.days.find((d) => d.id === targetDayId);

    if (!chosenDay && plans.length > 0 && plans[0].days.length > 0) {
      chosenDay = plans[0].days[0];
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const initialExercises: LoggedExercise[] = chosenDay
      ? chosenDay.exercises.map((pEx) => {
          const history = extractExerciseHistory(allSessions, pEx.name);
          const lastWorkingWeight =
            history && history.sessions.length > 0 && history.sessions[history.sessions.length - 1].workingSets.length > 0
              ? history.sessions[history.sessions.length - 1].workingSets[0].weight
              : 0;

          const defaultSetsCount = pEx.workingSets || 3;
          const sets: LoggedSet[] = [];

          if (pEx.equipment === 'barbell' && lastWorkingWeight >= 40) {
            sets.push({
              id: `set-${Date.now()}-w`,
              setNumber: 1,
              type: 'warmup',
              weight: Math.round((lastWorkingWeight * 0.5) / 2.5) * 2.5,
              reps: 10,
              completed: false,
              timestamp: new Date().toISOString()
            });
          }

          for (let i = 1; i <= defaultSetsCount; i++) {
            sets.push({
              id: `set-${Date.now()}-${pEx.id}-${i}`,
              setNumber: sets.length + 1,
              type: 'working',
              weight: lastWorkingWeight,
              reps: parseInt(pEx.repRange?.split('-')[0] || '10', 10),
              rir: pEx.targetRir ?? 2,
              completed: false,
              timestamp: new Date().toISOString()
            });
          }

          return {
            id: `lex-${Date.now()}-${pEx.id}`,
            exercisePlanId: pEx.id,
            name: pEx.name,
            muscleGroup: pEx.muscleGroup,
            equipment: pEx.equipment,
            repRange: pEx.repRange,
            targetRir: pEx.targetRir ?? 2,
            restSeconds: pEx.restSeconds || 90,
            notes: pEx.notes || '',
            isUnilateral: pEx.isUnilateral || false,
            sets
          };
        })
      : [];

    const newSession: WorkoutSession = {
      id: `session-${Date.now()}`,
      planId: activePlan?.id,
      dayId: chosenDay?.id,
      dayName: chosenDay ? chosenDay.dayName : 'Custom Workout Session',
      date: todayStr,
      startTime: new Date().toISOString(),
      status: 'in_progress',
      exercises: initialExercises
    };

    db.saveActiveSession(newSession);
    onSessionUpdated(newSession);
  };

  const saveSession = (updated: WorkoutSession) => {
    db.saveActiveSession(updated);
    onSessionUpdated(updated);
  };

  const handleUpdateSet = (exIndex: number, setIndex: number, updates: Partial<LoggedSet>) => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    const sets = [...targetEx.sets];
    const prevSet = sets[setIndex];

    const isNewlyCompleted = updates.completed === true && !prevSet.completed;

    sets[setIndex] = {
      ...prevSet,
      ...updates,
      timestamp: new Date().toISOString()
    };
    targetEx.sets = sets;
    exercises[exIndex] = targetEx;

    const updatedSession = { ...activeSession, exercises };
    saveSession(updatedSession);

    if (isNewlyCompleted) {
      playTimerChime();
      setRestTimerSeconds(targetEx.restSeconds || 90);
      setIsRestTimerOpen(true);
    }
  };

  const handleAddSet = (exIndex: number, type: 'working' | 'warmup' = 'working') => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    const lastSet = targetEx.sets[targetEx.sets.length - 1];

    const newSet: LoggedSet = {
      id: `set-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      setNumber: targetEx.sets.length + 1,
      type,
      weight: lastSet ? lastSet.weight : 0,
      reps: lastSet ? lastSet.reps : 10,
      rir: lastSet ? lastSet.rir : 2,
      completed: false,
      timestamp: new Date().toISOString()
    };

    targetEx.sets = [...targetEx.sets, newSet];
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleRemoveSet = (exIndex: number, setIndex: number) => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    targetEx.sets = targetEx.sets.filter((_, idx) => idx !== setIndex);
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleRemoveExercise = (exIndex: number) => {
    if (!activeSession) return;
    const exercises = activeSession.exercises.filter((_, idx) => idx !== exIndex);
    saveSession({ ...activeSession, exercises });
  };

  const handleCopyPreviousWeightToAllSets = (exIndex: number, weight: number) => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    targetEx.sets = targetEx.sets.map((s) => ({ ...s, weight }));
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleConfirmFinish = () => {
    if (!activeSession) return;
    const finalSession: WorkoutSession = {
      ...activeSession,
      status: 'completed',
      endTime: new Date().toISOString(),
      notes: finishNotes.trim() || undefined
    };

    db.addOrUpdateSession(finalSession);
    db.saveActiveSession(null);
    onSessionUpdated(null);
    setShowFinishModal(false);
    setAllSessions(db.getSessions());
  };

  const handleConfirmDiscard = () => {
    db.saveActiveSession(null);
    onSessionUpdated(null);
    setShowDiscardModal(false);
  };

  const handleAddNewExerciseToSession = () => {
    if (!activeSession || !newExName.trim()) return;
    const newEx: LoggedExercise = {
      id: `lex-custom-${Date.now()}`,
      name: newExName.trim(),
      muscleGroup: newExMuscle,
      equipment: newExEquipment,
      repRange: newExReps,
      targetRir: 2,
      restSeconds: 90,
      notes: 'Added during session',
      isUnilateral: false,
      sets: [
        {
          id: `set-${Date.now()}-1`,
          setNumber: 1,
          type: 'working',
          weight: 0,
          reps: 10,
          rir: 2,
          completed: false,
          timestamp: new Date().toISOString()
        }
      ]
    };

    const exercises = [...activeSession.exercises, newEx];
    saveSession({ ...activeSession, exercises });
    setIsAddingExercise(false);
    setNewExName('');
  };

  // ---- Display-only values derived from the live session (no new data is stored) ----
  const allSessionSets = activeSession ? activeSession.exercises.flatMap((e) => e.sets) : [];
  const totalSets = allSessionSets.length;
  const completedSetCount = allSessionSets.filter((s) => s.completed).length;
  const sessionVolume = calculateVolumeLoad(
    allSessionSets.filter((s) => s.completed && s.type === 'working'),
    false
  );
  const exercisesWithLoggedSets = activeSession
    ? activeSession.exercises.filter((e) => e.sets.some((s) => s.completed)).length
    : 0;

  // Close handlers for the shared Modals.
  const closeFinish = useCallback(() => setShowFinishModal(false), []);
  const closeDiscard = useCallback(() => setShowDiscardModal(false), []);
  const closeResetTimer = useCallback(() => setShowResetTimerConfirm(false), []);
  const closeAiCoach = useCallback(() => setAiCoachExercise(null), []);
  const closeRemoveExercise = useCallback(() => setExerciseToRemove(null), []);
  const closeAddExercise = useCallback(() => {
    setIsAddingExercise(false);
    setAddExTouched(false);
  }, []);

  // Confirm before removing an exercise that already has logged sets; empty ones remove immediately.
  const requestRemoveExercise = (exIndex: number) => {
    const target = activeSession?.exercises[exIndex];
    if (!target) return;
    if (target.sets.some((s) => s.completed)) {
      setExerciseToRemove(exIndex);
    } else {
      handleRemoveExercise(exIndex);
    }
  };

  const submitNewExercise = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newExName.trim()) {
      setAddExTouched(true);
      return;
    }
    handleAddNewExerciseToSession();
    setAddExTouched(false);
  };

  // ==========================================
  // VIEW 1: PRE-WORKOUT SPLIT SELECTOR
  // ==========================================
  if (!activeSession) {
    const completedSessions = allSessions.filter((s) => s.status === 'completed');
    return (
      <div className="max-w-5xl mx-auto">
        <PageHeader
          eyebrow="Training command & session logger"
          title="Session Deck"
          description="Real-time working sets, reps, weight, and RIR. Instant previous session comparisons."
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowWarmupModal(true)}
                icon={<Flame className="w-4 h-4 text-warning" aria-hidden />}
              >
                5-Min Warm-up
              </Button>
              <Button onClick={() => handleStartWorkout()} icon={<Flame className="w-4 h-4" aria-hidden />}>
                Start Workout Now
              </Button>
            </>
          }
        />

        <div className="space-y-6">
        {/* Routine Day Selector */}
        <section aria-label="Routine day">
          <SectionHeading
            title="Select Routine Day"
            action={
              activePlan && (
                <span className="text-xs text-zinc-400">
                  Plan: <strong className="text-white font-semibold">{activePlan.name}</strong>
                </span>
              )
            }
          />

          {activePlan && activePlan.days.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {activePlan.days.map((day) => {
                const isSelected = selectedDayId === day.id;
                return (
                  <Card
                    key={day.id}
                    interactive
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    tone={isSelected ? 'accent' : 'default'}
                    onClick={() => setSelectedDayId(day.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDayId(day.id);
                      }
                    }}
                    className={cn(
                      'text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isSelected && 'ring-1 ring-accent'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-400">Day {day.dayOrder}</span>
                      {isSelected && <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />}
                    </div>
                    <h3 className="font-semibold text-white text-sm mt-1 line-clamp-2">{day.dayName}</h3>
                    <p className="text-xs text-zinc-400 mt-1">{day.exercises.length} movements programmed</p>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Dumbbell className="w-5 h-5" />}
              title="No active workout routine configured."
              description="Add or activate a plan, or start a freestyle session below."
              action={
                <Button variant="secondary" onClick={onNavigateToPlans} icon={<ArrowRight className="w-4 h-4" aria-hidden />}>
                  Go to Plans &amp; Uploads
                </Button>
              }
            />
          )}
        </section>

        {/* Quick Custom Empty Session option */}
        <Card tone="ghost" pad="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-sm text-zinc-400">Want to train outside your split today?</span>
          <Button
            variant="secondary"
            onClick={() => {
              const todayStr = new Date().toISOString().split('T')[0];
              const customSession: WorkoutSession = {
                id: `session-${Date.now()}`,
                dayName: 'Open Gym / Freestyle Session',
                date: todayStr,
                startTime: new Date().toISOString(),
                status: 'in_progress',
                exercises: []
              };
              db.saveActiveSession(customSession);
              onSessionUpdated(customSession);
            }}
            icon={<ArrowRight className="w-4 h-4" aria-hidden />}
          >
            Start Empty Freestyle Session
          </Button>
        </Card>

        {/* Recent Workout History preview */}
        <section aria-label="Recent sessions">
          <SectionHeading title={`Recent Completed Sessions (${completedSessions.length})`} />
          {completedSessions.length === 0 ? (
            <EmptyState
              title="No previous workout sessions recorded yet."
              description="Start your first session above!"
            />
          ) : (
            <ul className="space-y-2">
              {completedSessions
                .slice(-5)
                .reverse()
                .map((sess) => {
                  const completedWorkingSets = sess.exercises.flatMap((e) =>
                    e.sets.filter((s) => s.completed && s.type === 'working')
                  );
                  const totalVol = calculateVolumeLoad(completedWorkingSets, false);
                  return (
                    <li key={sess.id}>
                      <Card pad="sm" className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white truncate">{sess.dayName}</span>
                            {sess.isDemo && <Badge tone="warning">DEMO</Badge>}
                          </div>
                          <div className="text-zinc-400 text-xs mt-0.5">
                            <span>{sess.date}</span>
                            <span className="mx-1.5" aria-hidden>·</span>
                            <span>{sess.exercises.length} movements</span>
                            <span className="mx-1.5" aria-hidden>·</span>
                            <span>{completedWorkingSets.length} working sets</span>
                          </div>
                        </div>
                        <div className="text-right font-mono text-sm shrink-0 tabular">
                          <span className="text-volt-adaptive font-semibold">{totalVol.toLocaleString()}</span>
                          <span className="text-zinc-500 ml-1">{profile.preferredUnit}</span>
                        </div>
                      </Card>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
        </div>

        <DynamicWarmupModal
          isOpen={showWarmupModal}
          onClose={() => setShowWarmupModal(false)}
          muscleGroups={(() => {
            const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
            return currentDay
              ? Array.from(new Set(currentDay.exercises.map((e) => e.muscleGroup).filter(Boolean)))
              : ['Chest', 'Shoulders', 'Triceps'];
          })()}
          exercises={(() => {
            const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
            return currentDay ? currentDay.exercises.map((e) => e.name) : ['Barbell Bench Press', 'Incline Press'];
          })()}
          workoutName={(() => {
            const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
            return currentDay ? currentDay.dayName : 'Pre-Workout Routine';
          })()}
        />
      </div>
    );
  }

  // ==========================================
  // VIEW 2: LIVE WORKOUT IN-PROGRESS GYM HUD
  // ==========================================
  const allDone = totalSets > 0 && completedSetCount === totalSets;

  return (
    <div className={cn('space-y-4 max-w-5xl mx-auto', isRestTimerOpen ? 'pb-56 md:pb-16' : 'pb-16')}>
      {/* Sticky session header: name, clock, progress and the primary action */}
      <Card
        as="section"
        pad="sm"
        aria-label="Workout summary"
        className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 sm:p-4"
      >
        <div className="flex items-center gap-3">
          <span
            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', isPaused ? 'bg-warning' : 'bg-accent motion-safe:animate-pulse')}
            aria-hidden
          />
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight truncate">{activeSession.dayName}</h2>
            {isPaused && <Badge tone="warning">Paused</Badge>}
          </div>
          <Button
            onClick={() => setShowFinishModal(true)}
            icon={<Check className="w-4 h-4 stroke-[3]" aria-hidden />}
            className="shrink-0"
          >
            <span>Finish<span className="hidden sm:inline"> Session</span></span>
          </Button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Clock className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
            <span
              role="timer"
              aria-label="Elapsed workout time"
              className="text-2xl font-mono font-bold text-white tabular leading-none"
            >
              {formatTime(elapsedSeconds)}
            </span>
          </div>
          <p className="text-xs text-zinc-400 tabular text-right">
            {activeSession.exercises.length} {activeSession.exercises.length === 1 ? 'exercise' : 'exercises'}
            <span className="mx-1.5" aria-hidden>·</span>
            <span className={allDone ? 'text-volt-adaptive font-semibold' : undefined}>
              {completedSetCount}/{totalSets} sets
            </span>
          </p>
        </div>

        {totalSets > 0 && (
          <ProgressBar
            className="mt-2.5"
            value={completedSetCount}
            max={totalSets}
            tone={allDone ? 'success' : 'accent'}
            label="Workout progress"
          />
        )}
      </Card>

      {/* Workout controls */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Workout controls">
        <Button
          variant={isPaused ? 'primary' : 'secondary'}
          onClick={handleTogglePause}
          title={isPaused ? 'Resume active workout' : 'Pause workout timer'}
          icon={
            isPaused ? <Play className="w-4 h-4" aria-hidden /> : <Pause className="w-4 h-4 text-warning" aria-hidden />
          }
          className="flex-1 sm:flex-none"
        >
          {isPaused ? 'Resume' : 'Pause'}
        </Button>

        <Button
          variant="secondary"
          onClick={() => setIsRestTimerOpen(true)}
          title="Open Rest Timer"
          aria-label="Open rest timer"
          icon={<Timer className="w-4 h-4 text-info" aria-hidden />}
          className="max-sm:w-11 max-sm:px-0"
        >
          <span className="hidden sm:inline">Rest Timer</span>
        </Button>

        <Button
          variant="secondary"
          onClick={() => setShowWarmupModal(true)}
          title="Launch 5-minute targeted dynamic pre-workout warm-up"
          aria-label="5-minute warm-up"
          icon={<Flame className="w-4 h-4 text-warning" aria-hidden />}
          className="max-sm:w-11 max-sm:px-0"
        >
          <span className="hidden sm:inline">5-Min Warm-up</span>
        </Button>

        <Button
          variant="secondary"
          onClick={() => setShowResetTimerConfirm(true)}
          title="Reset workout session clock to 00:00"
          aria-label="Reset workout clock"
          icon={<RotateCcw className="w-4 h-4 text-zinc-400" aria-hidden />}
          className="max-sm:w-11 max-sm:px-0"
        >
          <span className="hidden sm:inline">Reset</span>
        </Button>

        <Button
          variant="ghost"
          onClick={() => setShowDiscardModal(true)}
          title="Discard workout"
          aria-label="Discard workout"
          icon={<Trash2 className="w-4 h-4" aria-hidden />}
          className="ml-auto text-zinc-400 hover:text-danger max-sm:w-11 max-sm:px-0"
        >
          <span className="hidden sm:inline">Discard</span>
        </Button>
      </div>

      {/* Paused notice */}
      {isPaused && (
        <div
          role="status"
          className="rounded-card border border-warning/30 bg-warning/10 p-3 flex items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Pause className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
            <p className="text-zinc-300">
              <span className="font-semibold text-warning">Workout paused.</span> Elapsed clock is frozen at{' '}
              <span className="font-mono tabular">{formatTime(elapsedSeconds)}</span>. Sets, notes, and timers stay active.
            </p>
          </div>
          <Button size="sm" className="shrink-0 min-h-11 sm:min-h-0" onClick={handleTogglePause}>
            Resume
          </Button>
        </div>
      )}

      {/* Live Bluetooth Fitness Gadget Telemetry */}
      {isConnected ? (
        <div className="rounded-card border border-info/30 bg-surface p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-danger fill-danger motion-safe:animate-pulse" aria-hidden />
              <span className="font-mono text-base font-bold text-white tabular">
                {liveHeartRate ?? '--'} <span className="text-label text-zinc-400 font-normal">BPM</span>
              </span>
            </div>
            <span className={cn('px-2 py-0.5 rounded-full text-label font-semibold border', currentZone.color)}>
              {currentZone.name}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-zinc-400 flex items-center gap-1 tabular">
              <Flame className="w-3.5 h-3.5 text-warning" aria-hidden />
              <span>{Math.round(activeCaloriesBurned)} kcal</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-0 text-info"
              onClick={() => setIsGadgetModalOpen(true)}
              icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden />}
            >
              Gadget Hub
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface p-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-400 min-w-0">
            <Bluetooth className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
            <span>Pair a Bluetooth fitness gadget (HR strap / smart band) for live heart rate pacing</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 min-h-11 sm:min-h-0"
            onClick={() => setIsGadgetModalOpen(true)}
          >
            Connect Gadget
          </Button>
        </div>
      )}

      {/* Toast Notice */}
      {timerNotice && (
        <div
          role="status"
          className="rounded-control border border-line-strong bg-surface-2 px-3 py-2.5 text-xs text-white flex items-center gap-2 il-fade-in"
        >
          <Clock className="w-3.5 h-3.5 text-volt-adaptive shrink-0" aria-hidden />
          <span>{timerNotice}</span>
        </div>
      )}

      {/* Exercises List */}
      {activeSession.exercises.length === 0 ? (
        <EmptyState
          icon={<Dumbbell className="w-5 h-5" />}
          title="No exercises in this workout yet"
          description="Add your first movement to start logging sets."
        />
      ) : (
        <div className="space-y-4">
          {activeSession.exercises.map((exercise, exIndex) => {
            const history = extractExerciseHistory(allSessions, exercise.name);
            const lastSessionData =
              history && history.sessions.length > 0 ? history.sessions[history.sessions.length - 1] : null;

            return (
              <ExerciseCard
                key={exercise.id}
                exercise={exercise}
                index={exIndex}
                unit={profile.preferredUnit}
                lastSession={
                  lastSessionData ? { date: lastSessionData.date, workingSets: lastSessionData.workingSets } : null
                }
                onUpdateSet={(setIndex, updates) => handleUpdateSet(exIndex, setIndex, updates)}
                onAddSet={(type) => handleAddSet(exIndex, type)}
                onRemoveSet={(setIndex) => handleRemoveSet(exIndex, setIndex)}
                onRemoveExercise={() => requestRemoveExercise(exIndex)}
                onCopyPreviousWeight={(weight) => handleCopyPreviousWeightToAllSets(exIndex, weight)}
                onOpenForm={(showVideo) => {
                  setPosturePreviewShowVideo(showVideo);
                  setPosturePreviewExercise(exercise.name);
                }}
                onOpenCoach={() => handleOpenAiCoach(exercise, exIndex)}
              />
            );
          })}
        </div>
      )}

      {/* Add exercise */}
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={() => setIsAddingExercise(true)}
        icon={<Plus className="w-4 h-4 text-volt-adaptive" aria-hidden />}
      >
        Add Exercise
      </Button>

      {/* Rest Timer */}
      <RestTimer
        isOpen={isRestTimerOpen}
        initialSeconds={restTimerSeconds}
        onClose={() => setIsRestTimerOpen(false)}
      />

      {/* Add exercise */}
      <Modal
        open={isAddingExercise}
        onClose={closeAddExercise}
        title="Add Movement to Workout"
        footer={
          <>
            <Button variant="secondary" onClick={closeAddExercise}>
              Cancel
            </Button>
            <Button type="submit" form="add-exercise-form">
              Insert Movement
            </Button>
          </>
        }
      >
        <form id="add-exercise-form" onSubmit={submitNewExercise} className="grid grid-cols-1 sm:grid-cols-2 gap-3" noValidate>
          <Input
            label="Movement Name"
            type="text"
            value={newExName}
            onChange={(e) => setNewExName(e.target.value)}
            placeholder="e.g. Incline Dumbbell Curl"
            error={addExTouched && !newExName.trim() ? 'Enter a movement name.' : undefined}
            wrapperClassName="sm:col-span-2"
            autoComplete="off"
          />
          <Select label="Muscle Group" value={newExMuscle} onChange={(e) => setNewExMuscle(e.target.value)}>
            <option value="Chest">Chest</option>
            <option value="Back">Back</option>
            <option value="Shoulders">Shoulders</option>
            <option value="Quads">Quads</option>
            <option value="Hamstrings">Hamstrings</option>
            <option value="Glutes">Glutes</option>
            <option value="Biceps">Biceps</option>
            <option value="Triceps">Triceps</option>
            <option value="Calves">Calves</option>
            <option value="Abs">Abs</option>
          </Select>
          <Select
            label="Equipment"
            value={newExEquipment}
            onChange={(e) => setNewExEquipment(e.target.value as EquipmentType)}
          >
            <option value="barbell">Barbell</option>
            <option value="dumbbell">Dumbbell</option>
            <option value="cable">Cable</option>
            <option value="machine">Machine</option>
            <option value="bodyweight">Bodyweight</option>
          </Select>
          <Input
            label="Target Reps"
            type="text"
            value={newExReps}
            onChange={(e) => setNewExReps(e.target.value)}
            placeholder="e.g. 8-12"
            wrapperClassName="sm:col-span-2"
          />
        </form>
      </Modal>

      {/* Remove an exercise that already has logged sets */}
      <Modal
        open={exerciseToRemove !== null}
        onClose={closeRemoveExercise}
        title="Remove this exercise?"
        size="sm"
        description={
          exerciseToRemove !== null && activeSession.exercises[exerciseToRemove]
            ? `${activeSession.exercises[exerciseToRemove].name} has ${
                activeSession.exercises[exerciseToRemove].sets.filter((s) => s.completed).length
              } completed set(s). Removing it deletes them from this workout.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeRemoveExercise}>
              Keep Exercise
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (exerciseToRemove !== null) handleRemoveExercise(exerciseToRemove);
                setExerciseToRemove(null);
              }}
            >
              Remove Exercise
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">This only affects the workout in progress.</p>
      </Modal>

      {/* AI Exercise Coach & Substitutions */}
      <Modal
        open={aiCoachExercise !== null}
        onClose={closeAiCoach}
        title="Coach Iron Intelligence"
        description={aiCoachExercise?.name}
      >
        {aiCoachLoading && <LoadingState label="Analyzing biomechanics, cues, and equipment substitutions…" />}

        {aiCoachError && (
          <ErrorState title="Coaching unavailable" description={aiCoachError} className="py-6" />
        )}

        {aiCoachData && (
          <div className="space-y-4 text-sm">
            {aiCoachData.cues && (
              <Card tone="raised" pad="sm" className="space-y-2">
                <h3 className="text-xs font-semibold text-volt-adaptive">Execution &amp; Form Cues</h3>
                <ul className="space-y-1.5 text-zinc-300">
                  {aiCoachData.cues.map((cue: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-volt-adaptive shrink-0 mt-0.5" aria-hidden />
                      <span>{cue}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {aiCoachData.substitutions && aiCoachData.substitutions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-zinc-400">Equipment busy? Smart substitutions</h3>
                <ul className="space-y-2">
                  {aiCoachData.substitutions.map((sub: any, idx: number) => (
                    <li key={idx}>
                      <Card tone="raised" pad="sm" className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-semibold text-white block break-words">{sub.name}</span>
                          <span className="text-xs text-zinc-400">{sub.reason || sub.equipment}</span>
                        </div>
                        <Button variant="secondary" size="sm" className="shrink-0 min-h-11 sm:min-h-0" onClick={() => handleApplySubstitution(sub)}>
                          Use Swap
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Finish: summary of what was actually logged, then confirm */}
      <Modal
        open={showFinishModal}
        onClose={closeFinish}
        title="Finish today's session"
        description="This workout will be stored to your training log and used for your progressive overload calculations and volume reports."
        footer={
          <>
            <Button variant="secondary" onClick={closeFinish}>
              Back to Workout
            </Button>
            <Button onClick={handleConfirmFinish} icon={<Check className="w-4 h-4 stroke-[3]" aria-hidden />}>
              Confirm &amp; Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2">
            {[
              { label: 'Duration', value: formatTime(elapsedSeconds) },
              {
                label: 'Exercises logged',
                value: `${exercisesWithLoggedSets}/${activeSession.exercises.length}`
              },
              { label: 'Sets completed', value: `${completedSetCount}/${totalSets}` },
              { label: `Volume (${profile.preferredUnit})`, value: sessionVolume.toLocaleString() }
            ].map((m) => (
              <div key={m.label} className="rounded-control bg-surface-2 border border-line px-3 py-2.5">
                <dt className="text-label text-zinc-400">{m.label}</dt>
                <dd className="text-lg font-mono font-bold text-white tabular mt-0.5">{m.value}</dd>
              </div>
            ))}
          </dl>

          {totalSets > completedSetCount && (
            <p role="status" className="rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-zinc-300">
              <span className="font-semibold text-warning">{totalSets - completedSetCount}</span> set
              {totalSets - completedSetCount === 1 ? ' is' : 's are'} still unchecked.
            </p>
          )}

          <Textarea
            label="Workout session notes (optional)"
            value={finishNotes}
            onChange={(e) => setFinishNotes(e.target.value)}
            placeholder="Energy levels, pump, sleep quality, adjustments..."
            rows={3}
          />
        </div>
      </Modal>

      {/* Discard: always confirmed */}
      <Modal
        open={showDiscardModal}
        onClose={closeDiscard}
        title="Discard in-progress workout?"
        size="sm"
        description="Recorded sets for this session will not be saved to your permanent training history."
        footer={
          <>
            <Button variant="secondary" onClick={closeDiscard}>
              Keep Workout
            </Button>
            <Button variant="danger" onClick={handleConfirmDiscard} icon={<Trash2 className="w-4 h-4" aria-hidden />}>
              Yes, Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">
          {completedSetCount > 0
            ? `${completedSetCount} completed set${completedSetCount === 1 ? '' : 's'} will be lost.`
            : 'No sets have been completed yet.'}
        </p>
      </Modal>

      {/* Reset Workout Timer */}
      <Modal
        open={showResetTimerConfirm}
        onClose={closeResetTimer}
        title="Reset workout timer"
        size="sm"
        description="Reset the session clock back to 00:00? Your logged sets, weights, and repetitions will not be lost."
        footer={
          <>
            <Button variant="secondary" onClick={closeResetTimer}>
              Cancel
            </Button>
            <Button onClick={handleResetWorkoutTimer} icon={<RotateCcw className="w-4 h-4" aria-hidden />}>
              Reset to 00:00
            </Button>
          </>
        }
      >
        <div className="rounded-control bg-surface-2 border border-line px-3 py-2.5 text-sm text-zinc-300 flex items-center justify-between">
          <span>Current elapsed time</span>
          <span className="font-mono font-bold text-white tabular">{formatTime(elapsedSeconds)}</span>
        </div>
      </Modal>

      {/* Posture & Form Preview Modal */}
      {posturePreviewExercise && (
        <ExercisePostureModal
          exerciseName={posturePreviewExercise}
          isOpen={Boolean(posturePreviewExercise)}
          onClose={() => setPosturePreviewExercise(null)}
          profile={profile}
          openVideoFirst={posturePreviewShowVideo}
        />
      )}

      {/* Dynamic 5-Minute Warm-up Generator Modal */}
      <DynamicWarmupModal
        isOpen={showWarmupModal}
        onClose={() => setShowWarmupModal(false)}
        muscleGroups={Array.from(new Set(activeSession.exercises.map((e) => e.muscleGroup).filter(Boolean)))}
        exercises={activeSession.exercises.map((e) => e.name)}
        workoutName={activeSession.dayName}
      />
    </div>
  );
};
