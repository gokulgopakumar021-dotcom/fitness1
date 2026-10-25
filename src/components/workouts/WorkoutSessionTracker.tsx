import React, { useState, useEffect } from 'react';
import {
  Check,
  Plus,
  Trash2,
  Clock,
  RotateCcw,
  Sparkles,
  Info,
  ChevronDown,
  Dumbbell,
  Timer,
  AlertTriangle,
  ArrowRight,
  Flame,
  Pause,
  Play,
  RefreshCw,
  Zap,
  Eye,
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
import { calculateVolumeLoad, formatWeight } from '../../utils/calculations';
import { extractExerciseHistory } from '../../utils/progressionEngine';
import { RestTimer, playTimerChime } from '../common/RestTimer';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from '../trainer/DynamicWarmupModal';

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

  // Posture & Form Preview modal state
  const [posturePreviewExercise, setPosturePreviewExercise] = useState<string | null>(null);

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

  // ==========================================
  // VIEW 1: PRE-WORKOUT SPLIT SELECTOR
  // ==========================================
  if (!activeSession) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="reshape-card p-6 lg:p-7 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line">
            <div>
              <div className="flex items-center gap-2 text-accent text-xs font-mono font-bold tracking-wide mb-1">
                <Dumbbell className="w-4 h-4 stroke-[2.5]" />
                <span>Training Command &amp; Session Logger</span>
              </div>
              <h1 className="text-2xl lg:text-3xl font-nrc font-bold text-white tracking-tight">
                Session Deck · Overload Logger
              </h1>
              <p className="text-xs text-zinc-400 mt-1 font-sans">
                Real-time working sets, reps, weight, and RIR. Instant previous session comparisons.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => setShowWarmupModal(true)}
                className="touch-press px-4 py-3 bg-canvas hover:bg-surface-2 border border-amber-400/30 text-amber-300 font-bold text-xs sm:text-sm rounded-2xl flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Flame className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>5-Min Warm-up</span>
              </button>

              <button
                onClick={() => handleStartWorkout()}
                className="touch-press px-6 py-3 bg-accent hover:bg-accent text-accent-ink font-nrc font-bold text-sm sm:text-base rounded-2xl flex items-center justify-center gap-2 transition-all"
              >
                <Flame className="w-4 h-4 fill-black" />
                <span>Start Workout Now</span>
              </button>
            </div>
          </div>

          {/* Routine Day Selector */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold text-zinc-300 tracking-wide">
                Select Routine Day
              </span>
              {activePlan && (
                <span className="text-xs text-zinc-400 font-mono">
                  Plan: <strong className="text-white">{activePlan.name}</strong>
                </span>
              )}
            </div>

            {activePlan && activePlan.days.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {activePlan.days.map((day) => {
                  const isSelected = selectedDayId === day.id;
                  return (
                    <div
                      key={day.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDayId(day.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedDayId(day.id);
                        }
                      }}
                      className={`cursor-pointer p-4 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? 'bg-canvas border-accent ring-1 ring-accent'
                          : 'bg-canvas/60 border-line hover:border-white/20 hover:bg-surface-2/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-zinc-400">
                          Day {day.dayOrder}
                        </span>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-accent" />
                        )}
                      </div>
                      <h4 className="font-bold text-white text-sm mt-1 line-clamp-2">
                        {day.dayName}
                      </h4>
                      <p className="text-xs text-zinc-400 mt-1 font-sans">
                        {day.exercises.length} movements programmed
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 bg-canvas/40 border border-line rounded-2xl text-center">
                <p className="text-xs text-zinc-400 mb-3 font-sans">No active workout routine configured.</p>
                <button
                  onClick={onNavigateToPlans}
                  className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-1.5 border border-line"
                >
                  <span>Go to Plans &amp; Uploads</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Quick Custom Empty Session option */}
          <div className="mt-6 pt-5 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400 font-sans">
            <span>Want to train outside your split today?</span>
            <button
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
              className="text-accent hover:underline font-bold"
            >
              Start Empty Freestyle Session &rarr;
            </button>
          </div>
        </div>

        {/* Recent Workout History preview */}
        <div className="reshape-card p-6 lg:p-7">
          <h3 className="text-xs font-mono font-bold tracking-wide text-zinc-400 mb-4">
            Recent Completed Sessions ({allSessions.filter((s) => s.status === 'completed').length})
          </h3>
          {allSessions.filter((s) => s.status === 'completed').length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-xs font-sans">
              No previous workout sessions recorded yet. Start your first session above!
            </div>
          ) : (
            <div className="space-y-2.5">
              {allSessions
                .filter((s) => s.status === 'completed')
                .slice(-5)
                .reverse()
                .map((sess) => {
                  const completedWorkingSets = sess.exercises.flatMap((e) =>
                    e.sets.filter((s) => s.completed && s.type === 'working')
                  );
                  const totalVol = calculateVolumeLoad(completedWorkingSets, false);
                  return (
                    <div
                      key={sess.id}
                      className="p-3.5 bg-surface hover:bg-surface-2 border border-line rounded-2xl flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{sess.dayName}</span>
                          {sess.isDemo && (
                            <span className="text-[11px] text-amber-400 font-mono px-1.5 py-0.5 bg-amber-400/10 rounded">
                              DEMO
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-400 font-mono text-[11px] mt-0.5">
                          <span>{sess.date}</span>
                          <span className="mx-1.5">·</span>
                          <span>{sess.exercises.length} movements</span>
                          <span className="mx-1.5">·</span>
                          <span>{completedWorkingSets.length} working sets</span>
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <span className="text-accent font-bold">{totalVol.toLocaleString()}</span>
                        <span className="text-zinc-500 ml-1">{profile.preferredUnit}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: LIVE WORKOUT IN-PROGRESS GYM HUD
  // ==========================================
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Top Session Command Bar */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 reshape-card p-4 flex flex-wrap items-center justify-between gap-3 shadow-[0_16px_40px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
              isPaused
                ? 'bg-danger/15 border border-danger/30 text-danger'
                : 'bg-accent/15 border border-accent/30 text-accent'
            }`}
          >
            {isPaused ? <Pause className="w-5 h-5" /> : <Timer className="w-5 h-5 animate-spin-slow" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPaused ? 'bg-danger animate-pulse' : 'bg-accent animate-ping'
                }`}
              />
              <h2 className="font-nrc font-bold text-white text-lg sm:text-xl tracking-tight">
                {activeSession.dayName}
              </h2>
              {isPaused && (
                <span className="text-[11px] font-mono font-bold tracking-wide px-2 py-0.5 rounded bg-danger/15 text-danger border border-danger/30">
                  PAUSED
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>Elapsed: <strong className="text-white tabular-nums">{formatTime(elapsedSeconds)}</strong></span>
              <button
                onClick={() => setShowResetTimerConfirm(true)}
                className="text-zinc-500 hover:text-accent p-0.5 rounded transition-colors ml-0.5"
                title="Reset Workout Elapsed Timer to 00:00"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <span>·</span>
              <span>{activeSession.exercises.length} Exercises</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Pause / Resume Button */}
          <button
            onClick={handleTogglePause}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
              isPaused
                ? 'bg-danger text-white border-danger hover:bg-rose-600 font-bold shadow-md'
                : 'bg-canvas border-line hover:border-white/20 text-zinc-300'
            }`}
            title={isPaused ? 'Resume active workout' : 'Pause workout timer'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-white" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>

          {/* 5-Min Warm-up Button */}
          <button
            onClick={() => setShowWarmupModal(true)}
            className="p-2 sm:px-3 sm:py-2 bg-canvas border border-amber-400/30 hover:border-amber-400 text-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            title="Launch 5-Minute Targeted Dynamic Pre-Workout Warm-up"
          >
            <Flame className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="hidden sm:inline">5-Min Warm-up</span>
          </button>

          {/* Reset Timer */}
          <button
            onClick={() => setShowResetTimerConfirm(true)}
            className="p-2 sm:px-3 sm:py-2 bg-canvas border border-line hover:border-white/20 rounded-xl text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Reset workout session clock to 00:00"
          >
            <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          {/* Rest Timer */}
          <button
            onClick={() => setIsRestTimerOpen(true)}
            className="p-2 sm:px-3 sm:py-2 bg-canvas border border-line hover:border-white/20 rounded-xl text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Open Rest Timer"
          >
            <Clock className="w-4 h-4 text-info" />
            <span className="hidden sm:inline">Rest Timer</span>
          </button>

          {/* Discard Workout */}
          <button
            onClick={() => setShowDiscardModal(true)}
            className="p-2.5 bg-canvas border border-line hover:border-rose-900/60 rounded-xl text-zinc-400 hover:text-rose-400 text-xs font-semibold transition-colors"
            title="Discard Workout"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Finish Session */}
          <button
            onClick={() => setShowFinishModal(true)}
            className="touch-press px-4 py-2 bg-accent hover:bg-accent text-accent-ink font-nrc font-bold text-xs sm:text-sm rounded-xl shadow-md flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Finish Session</span>
          </button>
        </div>
      </div>

      {/* Paused Alert Notification Banner */}
      {isPaused && (
        <div className="p-3.5 bg-danger/15 border border-danger/30 rounded-2xl flex items-center justify-between text-xs text-rose-200 shadow-md">
          <div className="flex items-center gap-2.5">
            <Pause className="w-4 h-4 text-danger shrink-0" />
            <div>
              <span className="font-bold text-danger">Workout Paused:</span>
              <span className="ml-1 text-zinc-300">
                Elapsed clock is frozen at {formatTime(elapsedSeconds)}. Sets, notes, and timers are active.
              </span>
            </div>
          </div>
          <button
            onClick={handleTogglePause}
            className="px-3 py-1.5 bg-danger hover:bg-rose-600 text-white font-bold rounded-xl text-xs shrink-0 transition-colors"
          >
            Resume
          </button>
        </div>
      )}

      {/* Live Bluetooth Fitness Gadget Telemetry Bar */}
      {isConnected ? (
        <div className="p-3.5 bg-canvas/90 border border-sky-400/30 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500 fill-rose-500 animate-pulse" />
              <span className="font-mono text-base font-extrabold text-white">
                {liveHeartRate ?? '--'}{' '}
                <span className="text-[11px] text-zinc-400 font-normal">BPM</span>
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${currentZone.color}`}>
              {currentZone.name}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-zinc-400 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>{Math.round(activeCaloriesBurned)} kcal</span>
            </span>
            <button
              onClick={() => setIsGadgetModalOpen(true)}
              className="text-sky-400 hover:underline font-semibold text-[11px]"
            >
              Gadget Hub &rarr;
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-canvas/60 border border-line rounded-2xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <Bluetooth className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px]">
              Pair a Bluetooth fitness gadget (HR strap / smart band) for live heart rate pacing
            </span>
          </div>
          <button
            onClick={() => setIsGadgetModalOpen(true)}
            className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-sky-300 rounded-xl text-xs font-semibold shrink-0 transition-colors border border-sky-400/20"
          >
            Connect Gadget
          </button>
        </div>
      )}

      {/* Toast Notice */}
      {timerNotice && (
        <div className="p-3 bg-canvas border border-line rounded-2xl text-xs text-white flex items-center gap-2 font-mono shadow-md animate-in fade-in duration-200">
          <Clock className="w-3.5 h-3.5 text-accent" />
          <span>{timerNotice}</span>
        </div>
      )}

      {/* Exercises List */}
      <div className="space-y-5">
        {activeSession.exercises.map((exercise, exIndex) => {
          const history = extractExerciseHistory(allSessions, exercise.name);
          const lastSessionData =
            history && history.sessions.length > 0
              ? history.sessions[history.sessions.length - 1]
              : null;

          const lastWorkingSets = lastSessionData ? lastSessionData.workingSets : [];
          const lastWorkingWeight = lastWorkingSets.length > 0 ? lastWorkingSets[0].weight : 0;
          const lastRepsString = lastWorkingSets.map((s) => s.reps).join(', ');

          const completedWorkingSets = exercise.sets.filter((s) => s.completed && s.type === 'working');
          const currentVolume = calculateVolumeLoad(completedWorkingSets, false);

          return (
            <div
              key={exercise.id}
              className="bg-surface border border-line rounded-2xl p-4 sm:p-5 space-y-4"
            >
              {/* Exercise Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-accent tracking-wide">
                      #{exIndex + 1}
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-white">
                      {exercise.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
                    <span className="capitalize">{exercise.muscleGroup}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{exercise.equipment}</span>
                    <span aria-hidden="true">·</span>
                    <span>Target: {exercise.repRange} reps @ {exercise.targetRir} RIR</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Form & Posture Preview Button */}
                  <button
                    onClick={() => setPosturePreviewExercise(exercise.name)}
                    className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="Preview correct posture, joint angles, and workout form"
                  >
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    <span>Biomechanics</span>
                  </button>

                  {/* AI Coach & Substitutions Button */}
                  <button
                    onClick={() => handleOpenAiCoach(exercise, exIndex)}
                    className="px-2.5 py-1 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="Get AI Form Cues, Warmup Ramp, and Substitutions"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Coach &amp; Subs</span>
                  </button>

                  <div className="font-mono text-zinc-400 ml-1">
                    Vol:{' '}
                    <span className="font-bold text-white tabular-nums">
                      {currentVolume.toLocaleString()} {profile.preferredUnit}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveExercise(exIndex)}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg transition-colors ml-1"
                    title="Remove Exercise"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Previous Performance Banner */}
              {lastSessionData ? (
                <div className="flex items-center justify-between p-3 bg-canvas/80 border border-line rounded-2xl text-xs">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="text-zinc-300">
                      Last session ({lastSessionData.date}):{' '}
                      <span className="font-mono font-bold text-sky-300">
                        {lastWorkingWeight} {profile.preferredUnit}
                      </span>{' '}
                      &times; [{lastRepsString}] reps
                    </span>
                  </div>
                  <button
                    onClick={() => handleCopyPreviousWeightToAllSets(exIndex, lastWorkingWeight)}
                    className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 text-zinc-200 font-medium rounded-xl transition-colors shrink-0 text-[11px] border border-line"
                    title="Copy weight to all sets"
                  >
                    Use {lastWorkingWeight} {profile.preferredUnit}
                  </button>
                </div>
              ) : (
                <div className="p-2.5 bg-canvas/40 rounded-2xl text-zinc-500 text-xs flex items-center gap-2">
                  <Info className="w-3.5 h-3.5" />
                  <span>First logged session for this movement. Establishing baseline.</span>
                </div>
              )}

              {/* Sets Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[11px] font-mono text-zinc-400 tracking-wide">
                      <th className="py-2.5 px-2 w-12 text-center">Set</th>
                      <th className="py-2.5 px-2 min-w-[90px]">Weight ({profile.preferredUnit})</th>
                      <th className="py-2.5 px-2 min-w-[70px]">Reps</th>
                      <th className="py-2.5 px-2 min-w-[65px]">RIR</th>
                      <th className="py-2.5 px-2 w-14 text-center">Done</th>
                      <th className="py-2.5 px-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] font-mono">
                    {exercise.sets.map((set, setIndex) => {
                      const isCompleted = set.completed;
                      const isWarmup = set.type === 'warmup';

                      return (
                        <tr
                          key={set.id}
                          className={`transition-colors ${
                            isCompleted ? 'bg-accent/[0.05]' : 'hover:bg-surface-2/40'
                          }`}
                        >
                          {/* Set Badge */}
                          <td className="py-2 px-2 text-center">
                            <button
                              onClick={() =>
                                handleUpdateSet(exIndex, setIndex, {
                                  type: isWarmup ? 'working' : 'warmup'
                                })
                              }
                              className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                                isWarmup
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-surface-2 text-zinc-300 hover:bg-surface-3 border border-line'
                              }`}
                              title={isWarmup ? 'Warmup Set (toggle to Working)' : 'Working Set (toggle to Warmup)'}
                            >
                              {isWarmup ? 'W' : set.setNumber}
                            </button>
                          </td>

                          {/* Weight Input with micro-increments */}
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.5"
                                value={set.weight || ''}
                                onChange={(e) =>
                                  handleUpdateSet(exIndex, setIndex, {
                                    weight: parseFloat(e.target.value) || 0
                                  })
                                }
                                placeholder="0"
                                className="w-16 sm:w-20 px-2 py-1.5 bg-canvas border border-line rounded-xl text-white font-bold text-sm focus:outline-none focus:border-accent tabular-nums"
                              />
                              <div className="hidden sm:flex flex-col gap-0.5">
                                <button
                                  onClick={() =>
                                    handleUpdateSet(exIndex, setIndex, {
                                      weight: Number((set.weight + 2.5).toFixed(1))
                                    })
                                  }
                                  className="px-1.5 py-0.5 text-[11px] bg-surface-2 hover:bg-surface-3 text-zinc-300 rounded border border-line"
                                >
                                  +2.5
                                </button>
                                <button
                                  onClick={() =>
                                    handleUpdateSet(exIndex, setIndex, {
                                      weight: Math.max(0, Number((set.weight - 2.5).toFixed(1)))
                                    })
                                  }
                                  className="px-1.5 py-0.5 text-[11px] bg-surface-2 hover:bg-surface-3 text-zinc-300 rounded border border-line"
                                >
                                  -2.5
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* Reps Input */}
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={set.reps || ''}
                              onChange={(e) =>
                                handleUpdateSet(exIndex, setIndex, {
                                  reps: parseInt(e.target.value, 10) || 0
                                })
                              }
                              placeholder="0"
                              className="w-14 sm:w-16 px-2 py-1.5 bg-canvas border border-line rounded-xl text-white font-bold text-sm focus:outline-none focus:border-accent tabular-nums"
                            />
                          </td>

                          {/* RIR Input */}
                          <td className="py-2 px-2">
                            <select
                              value={set.rir !== undefined ? set.rir : 2}
                              onChange={(e) =>
                                handleUpdateSet(exIndex, setIndex, {
                                  rir: parseInt(e.target.value, 10)
                                })
                              }
                              className="px-2 py-1.5 bg-canvas border border-line rounded-xl text-zinc-200 text-xs focus:outline-none focus:border-accent"
                            >
                              <option value="0">0 (Fail)</option>
                              <option value="1">1 RIR</option>
                              <option value="2">2 RIR</option>
                              <option value="3">3 RIR</option>
                              <option value="4">4+ RIR</option>
                            </select>
                          </td>

                          {/* Large Checkmark Completion Button (>= 44px touch target) */}
                          <td className="py-2 px-2 text-center">
                            <button
                              onClick={() =>
                                handleUpdateSet(exIndex, setIndex, {
                                  completed: !isCompleted
                                })
                              }
                              className={`touch-press w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
                                isCompleted
                                  ? 'bg-accent text-accent-ink'
                                  : 'bg-surface-2 text-zinc-500 hover:text-white hover:bg-surface-3 border border-line'
                              }`}
                              title={isCompleted ? 'Mark incomplete' : 'Complete set'}
                            >
                              <Check className={`w-5 h-5 ${isCompleted ? 'stroke-[3.5]' : 'stroke-2'}`} />
                            </button>
                          </td>

                          {/* Delete Set */}
                          <td className="py-2 px-1 text-center">
                            <button
                              onClick={() => handleRemoveSet(exIndex, setIndex)}
                              className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
                              title="Delete set"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Set Actions & Notes */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddSet(exIndex, 'working')}
                    className="px-3.5 py-1.5 bg-surface-2 hover:bg-surface-3 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors border border-line"
                  >
                    <Plus className="w-3.5 h-3.5 text-accent" />
                    <span>Add Set</span>
                  </button>

                  <button
                    onClick={() => handleAddSet(exIndex, 'warmup')}
                    className="px-3 py-1.5 bg-canvas hover:bg-surface-2 border border-line text-zinc-400 hover:text-white text-xs font-medium rounded-xl transition-colors"
                  >
                    <span>+ Warmup Set</span>
                  </button>
                </div>

                <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-500" />
                  <span>Rest: {exercise.restSeconds}s</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Exercise to this workout button */}
      <div className="pt-2">
        {isAddingExercise ? (
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h4 className="font-bold text-white text-sm">Add Movement to Workout</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Movement Name</label>
                <input
                  type="text"
                  value={newExName}
                  onChange={(e) => setNewExName(e.target.value)}
                  placeholder="e.g. Incline Dumbbell Curl"
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-white focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Muscle Group</label>
                <select
                  value={newExMuscle}
                  onChange={(e) => setNewExMuscle(e.target.value)}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-zinc-200 focus:outline-none focus:border-accent"
                >
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
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Equipment</label>
                <select
                  value={newExEquipment}
                  onChange={(e) => setNewExEquipment(e.target.value as EquipmentType)}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-zinc-200 focus:outline-none focus:border-accent"
                >
                  <option value="barbell">Barbell</option>
                  <option value="dumbbell">Dumbbell</option>
                  <option value="cable">Cable</option>
                  <option value="machine">Machine</option>
                  <option value="bodyweight">Bodyweight</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Target Reps</label>
                <input
                  type="text"
                  value={newExReps}
                  onChange={(e) => setNewExReps(e.target.value)}
                  placeholder="e.g. 8-12"
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-white focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsAddingExercise(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleAddNewExerciseToSession}
                className="px-5 py-2 bg-accent hover:bg-accent text-accent-ink text-xs font-bold rounded-xl shadow-md"
              >
                Insert Movement
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingExercise(true)}
            className="w-full py-4 border-2 border-dashed border-line hover:border-accent/50 rounded-2xl text-xs font-bold text-zinc-400 hover:text-white transition-all flex items-center justify-center gap-2 bg-canvas/30"
          >
            <Plus className="w-4 h-4 text-accent" />
            <span>Add Additional Exercise</span>
          </button>
        )}
      </div>

      {/* Rest Timer Modal */}
      <RestTimer
        isOpen={isRestTimerOpen}
        initialSeconds={restTimerSeconds}
        onClose={() => setIsRestTimerOpen(false)}
      />

      {/* AI Exercise Coach & Substitutions Modal */}
      {aiCoachExercise && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Coach Iron Intelligence</h3>
                  <p className="text-xs text-zinc-400">{aiCoachExercise.name}</p>
                </div>
              </div>
              <button
                onClick={() => setAiCoachExercise(null)}
                className="text-zinc-500 hover:text-white text-xs px-2 py-1 rounded"
              >
                &times; Close
              </button>
            </div>

            {aiCoachLoading && (
              <div className="py-8 flex flex-col items-center justify-center text-xs text-zinc-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                <span>Analyzing biomechanics, cues, and gym equipment substitutions...</span>
              </div>
            )}

            {aiCoachError && (
              <div className="p-3 bg-canvas border border-amber-500/30 rounded-2xl text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{aiCoachError}</span>
              </div>
            )}

            {aiCoachData && (
              <div className="space-y-4 text-xs">
                {/* Form Cues */}
                {aiCoachData.cues && (
                  <div className="p-3.5 bg-canvas/80 border border-line rounded-2xl space-y-2">
                    <span className="font-mono text-accent font-bold text-[11px] block">
                      Execution &amp; Form Cues
                    </span>
                    <ul className="space-y-1 text-zinc-300">
                      {aiCoachData.cues.map((cue: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                          <span>{cue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Gym Substitutions */}
                {aiCoachData.substitutions && aiCoachData.substitutions.length > 0 && (
                  <div className="space-y-2">
                    <span className="font-mono text-zinc-400 font-bold text-[11px] block">
                      Equipment Busy? Smart Substitutions
                    </span>
                    <div className="space-y-2">
                      {aiCoachData.substitutions.map((sub: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-3 bg-canvas/80 border border-line rounded-2xl flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-bold text-white block">{sub.name}</span>
                            <span className="text-[11px] text-zinc-400">{sub.reason || sub.equipment}</span>
                          </div>
                          <button
                            onClick={() => handleApplySubstitution(sub)}
                            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-accent border border-accent/30 font-bold rounded-xl text-xs shrink-0 transition-colors"
                          >
                            Use Swap
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Finish Session Modal */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-accent">
              <Flame className="w-6 h-6 fill-accent" />
              <h3 className="font-nrc font-bold text-xl text-white">Finish Today&apos;s Session</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Great work! This workout will be stored to your training log and used to update your
              progressive overload calculations and volume reports.
            </p>

            <div>
              <label className="block text-xs font-mono text-zinc-300 mb-1">
                Workout Session Notes (optional)
              </label>
              <textarea
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                placeholder="Energy levels, pump, sleep quality, adjustments..."
                rows={3}
                className="w-full px-3 py-2 bg-canvas border border-line rounded-2xl text-white text-xs focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFinishModal(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs font-semibold rounded-xl"
              >
                Back to Workout
              </button>
              <button
                onClick={handleConfirmFinish}
                className="px-5 py-2 bg-accent hover:bg-accent text-accent-ink text-xs font-bold rounded-xl shadow-md font-nrc text-sm"
              >
                Confirm &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard Session Modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-danger">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-lg text-white">Discard In-Progress Workout?</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Are you sure you want to discard this workout? Recorded sets for this session will not
              be saved to your permanent training history.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs font-semibold rounded-xl"
              >
                Keep Workout
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="px-4 py-2 bg-danger hover:bg-rose-600 text-white text-xs font-bold rounded-xl"
              >
                Yes, Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Workout Timer Modal */}
      {showResetTimerConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-accent">
              <RotateCcw className="w-6 h-6" />
              <h3 className="font-bold text-lg text-white">Reset Workout Timer</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Reset the session clock back to <strong className="text-white">00:00</strong>?
              Your logged sets, weights, and repetitions will <strong className="text-accent">NOT</strong> be lost.
            </p>
            <div className="bg-canvas border border-line rounded-2xl p-3 text-xs text-zinc-300 flex items-center justify-between">
              <span>Current elapsed time:</span>
              <span className="font-mono font-bold text-white">{formatTime(elapsedSeconds)}</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowResetTimerConfirm(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleResetWorkoutTimer}
                className="px-4 py-2 bg-accent hover:bg-accent text-accent-ink text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 font-nrc "
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to 00:00</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posture & Form Preview Modal */}
      {posturePreviewExercise && (
        <ExercisePostureModal
          exerciseName={posturePreviewExercise}
          isOpen={Boolean(posturePreviewExercise)}
          onClose={() => setPosturePreviewExercise(null)}
          profile={profile}
        />
      )}

      {/* Dynamic 5-Minute Warm-up Generator Modal */}
      <DynamicWarmupModal
        isOpen={showWarmupModal}
        onClose={() => setShowWarmupModal(false)}
        muscleGroups={
          activeSession
            ? Array.from(new Set(activeSession.exercises.map((e) => e.muscleGroup).filter(Boolean)))
            : (() => {
                const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
                return currentDay
                  ? Array.from(new Set(currentDay.exercises.map((e) => e.muscleGroup).filter(Boolean)))
                  : ['Chest', 'Shoulders', 'Triceps'];
              })()
        }
        exercises={
          activeSession
            ? activeSession.exercises.map((e) => e.name)
            : (() => {
                const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
                return currentDay ? currentDay.exercises.map((e) => e.name) : ['Barbell Bench Press', 'Incline Press'];
              })()
        }
        workoutName={
          activeSession
            ? activeSession.dayName
            : (() => {
                const currentDay = activePlan?.days.find((d) => d.id === selectedDayId);
                return currentDay ? currentDay.dayName : 'Pre-Workout Routine';
              })()
        }
      />
    </div>
  );
};
