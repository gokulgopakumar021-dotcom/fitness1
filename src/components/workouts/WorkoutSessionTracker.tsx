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
  }, [activeSession?.startTime, activeSession?.isPaused, activeSession?.pausedElapsedSeconds]);

  const handleTogglePause = () => {
    if (!activeSession) return;
    if (activeSession.isPaused) {
      // Resume workout
      const currentPausedSec = activeSession.pausedElapsedSeconds || elapsedSeconds;
      const newStartTime = new Date(Date.now() - currentPausedSec * 1000).toISOString();
      const updated: WorkoutSession = {
        ...activeSession,
        startTime: newStartTime,
        isPaused: false,
        pausedAt: undefined
      };
      saveSession(updated);
      setTimerNotice('Workout resumed! Clock is ticking.');
      setTimeout(() => setTimerNotice(null), 2500);
    } else {
      // Pause workout
      const updated: WorkoutSession = {
        ...activeSession,
        isPaused: true,
        pausedElapsedSeconds: elapsedSeconds,
        pausedAt: new Date().toISOString()
      };
      saveSession(updated);
      setTimerNotice('Workout paused. Timer is frozen.');
      setTimeout(() => setTimerNotice(null), 2500);
    }
  };

  const handleResetWorkoutTimer = () => {
    if (!activeSession) return;
    const now = new Date().toISOString();
    const updated: WorkoutSession = {
      ...activeSession,
      startTime: now,
      pausedElapsedSeconds: 0,
      pausedAt: activeSession.isPaused ? now : undefined
    };
    setElapsedSeconds(0);
    saveSession(updated);
    setShowResetTimerConfirm(false);
    setTimerNotice('Workout timer reset to 00:00.');
    setTimeout(() => setTimerNotice(null), 2500);
  };

  const handleOpenAiCoach = async (ex: LoggedExercise, index: number) => {
    setAiCoachExercise(ex);
    setAiCoachIndex(index);
    setAiCoachLoading(true);
    setAiCoachError(null);
    setAiCoachData(null);

    try {
      const res = await fetch('/api/exercise-coach', {
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

  const handleFetchAiInsights = async () => {
    if (!activeSession) return;
    setAiInsightsLoading(true);
    setAiInsightsError(null);
    try {
      const res = await fetch('/api/ai-workout-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: activeSession,
          profile
        })
      });
      const json = await res.json();
      if (json.success && json.insights) {
        setAiInsightsData(json.insights);
      } else {
        setAiInsightsError(json.error || 'AI Insights service temporarily unavailable');
      }
    } catch (e: any) {
      setAiInsightsError(e.message || 'Failed to fetch AI insights');
    } finally {
      setAiInsightsLoading(false);
    }
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
          // Check for previous performance to prefill realistic weights if available
          const history = extractExerciseHistory(allSessions, pEx.name);
          const lastWorkingWeight =
            history && history.sessions.length > 0 && history.sessions[history.sessions.length - 1].workingSets.length > 0
              ? history.sessions[history.sessions.length - 1].workingSets[0].weight
              : 0;

          const defaultSetsCount = pEx.workingSets || 3;
          const sets: LoggedSet[] = [];

          // Add 1 optional warmup set for heavy compound movements
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

  // Immediate auto-save handler
  const saveSession = (updated: WorkoutSession) => {
    db.saveActiveSession(updated);
    onSessionUpdated(updated);
  };

  // Set updates
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

    // If user just marked set as completed, trigger rest timer
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
    const sets = [...targetEx.sets];

    const lastSet = sets[sets.length - 1];
    const newSet: LoggedSet = {
      id: `set-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      setNumber: sets.length + 1,
      type,
      weight: lastSet ? lastSet.weight : 20,
      reps: lastSet ? lastSet.reps : 10,
      rir: lastSet ? lastSet.rir : 2,
      completed: false,
      timestamp: new Date().toISOString()
    };

    targetEx.sets = [...sets, newSet];
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleRemoveSet = (exIndex: number, setIndex: number) => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    const sets = targetEx.sets.filter((_, idx) => idx !== setIndex);
    // Re-index set numbers
    targetEx.sets = sets.map((s, idx) => ({ ...s, setNumber: idx + 1 }));
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleCopyPreviousWeightToAllSets = (exIndex: number, weightToCopy: number) => {
    if (!activeSession) return;
    const exercises = [...activeSession.exercises];
    const targetEx = { ...exercises[exIndex] };
    targetEx.sets = targetEx.sets.map((s) => ({
      ...s,
      weight: weightToCopy
    }));
    exercises[exIndex] = targetEx;
    saveSession({ ...activeSession, exercises });
  };

  const handleAddCustomExercise = () => {
    if (!newExName.trim() || !activeSession) return;
    const newEx: LoggedExercise = {
      id: `lex-custom-${Date.now()}`,
      name: newExName.trim(),
      muscleGroup: newExMuscle,
      equipment: newExEquipment,
      repRange: newExReps,
      targetRir: 2,
      restSeconds: 90,
      sets: [
        {
          id: `set-${Date.now()}-1`,
          setNumber: 1,
          type: 'working',
          weight: 20,
          reps: 10,
          rir: 2,
          completed: false,
          timestamp: new Date().toISOString()
        }
      ]
    };

    saveSession({
      ...activeSession,
      exercises: [...activeSession.exercises, newEx]
    });
    setNewExName('');
    setIsAddingExercise(false);
  };

  const handleRemoveExercise = (exIndex: number) => {
    if (!activeSession) return;
    const exercises = activeSession.exercises.filter((_, idx) => idx !== exIndex);
    saveSession({ ...activeSession, exercises });
  };

  // Complete session & archive
  const handleConfirmFinish = () => {
    if (!activeSession) return;
    const completedSession: WorkoutSession = {
      ...activeSession,
      endTime: new Date().toISOString(),
      status: 'completed',
      notes: finishNotes
    };

    db.addOrUpdateSession(completedSession);
    db.saveActiveSession(null);
    onSessionUpdated(null);
    setAllSessions(db.getSessions());
    setShowFinishModal(false);
    setFinishNotes('');
  };

  // Discard in-progress workout
  const handleConfirmDiscard = () => {
    db.saveActiveSession(null);
    onSessionUpdated(null);
    setShowDiscardModal(false);
  };

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const remSecs = secs % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${remSecs}s`;
    }
    return `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
  };

  // ==========================================
  // VIEW 1: NO ACTIVE WORKOUT (SELECTION SCREEN)
  // ==========================================
  if (!activeSession) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
            <div>
              <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
                <Dumbbell className="w-3.5 h-3.5" />
                <span>Training Session Logger</span>
              </div>
              <h1 className="text-xl lg:text-2xl font-bold text-zinc-100">
                Ready for Today&apos;s Workout
              </h1>
              <p className="text-xs text-zinc-400 mt-1">
                Log working sets, reps, load, and RIR. Instant previous session comparisons.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => setShowWarmupModal(true)}
                className="touch-press px-4 py-3.5 bg-gradient-to-r from-amber-500/15 to-orange-500/15 hover:from-amber-500/25 hover:to-orange-500/25 border border-amber-400/40 hover:border-amber-400 text-amber-300 font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Flame className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>5-Min Warm-up</span>
              </button>

              <button
                onClick={() => handleStartWorkout()}
                className="touch-press px-6 py-3.5 bg-lime-400 hover:bg-lime-300 text-black font-bold text-sm rounded-xl shadow-lg shadow-lime-950/40 flex items-center justify-center gap-2 transition-colors"
              >
                <Flame className="w-4 h-4 fill-black" />
                <span>Start Workout Now</span>
              </button>
            </div>
          </div>

          {/* Routine Day Selector */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Select Routine Day
              </span>
              {activePlan && (
                <span className="text-xs text-zinc-500 font-mono">
                  Plan: {activePlan.name}
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
                      onClick={() => setSelectedDayId(day.id)}
                      className={`cursor-pointer p-4 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-zinc-800/90 border-lime-400/80 shadow-md ring-1 ring-lime-400/30'
                          : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-zinc-400">
                          Day {day.dayOrder}
                        </span>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-lime-400" />
                        )}
                      </div>
                      <h4 className="font-bold text-zinc-100 text-sm mt-1 line-clamp-1">
                        {day.dayName}
                      </h4>
                      <p className="text-xs text-zinc-400 mt-1">
                        {day.exercises.length} exercises programmed
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 bg-zinc-900/40 border border-zinc-800 rounded-xl text-center">
                <p className="text-xs text-zinc-400 mb-3">No active workout routine configured.</p>
                <button
                  onClick={onNavigateToPlans}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                >
                  <span>Go to Plans &amp; Uploads</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Quick Custom Empty Session option */}
          <div className="mt-6 pt-5 border-t border-zinc-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
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
              className="text-lime-400 hover:underline font-medium"
            >
              Start Empty Freestyle Session &rarr;
            </button>
          </div>
        </div>

        {/* Recent Workout History preview */}
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
            Recent Completed Sessions ({allSessions.filter((s) => s.status === 'completed').length})
          </h3>
          {allSessions.filter((s) => s.status === 'completed').length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-xs">
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
                      className="p-3.5 bg-zinc-900/40 hover:bg-zinc-800/40 border border-zinc-800/80 rounded-xl flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-200">{sess.dayName}</span>
                          {sess.isDemo && (
                            <span className="text-[10px] text-amber-400 font-mono px-1.5 py-0.2 bg-amber-400/10 rounded">
                              DEMO
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-500 font-mono text-[11px] mt-0.5">
                          <span>{sess.date}</span>
                          <span className="mx-1.5">·</span>
                          <span>{sess.exercises.length} exercises</span>
                          <span className="mx-1.5">·</span>
                          <span>{completedWorkingSets.length} working sets</span>
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <span className="text-lime-400 font-bold">{totalVol.toLocaleString()}</span>
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
  // VIEW 2: LIVE WORKOUT IN-PROGRESS TRACKER
  // ==========================================
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      {/* Top Session Command Bar */}
      <div className="sticky top-14 z-30 bg-[#090b0e]/95 backdrop-blur-md border border-zinc-800 p-4 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              isPaused
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                : 'bg-lime-400/10 border border-lime-400/30 text-lime-400'
            }`}
          >
            {isPaused ? <Pause className="w-5 h-5" /> : <Timer className="w-5 h-5 animate-spin-slow" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPaused ? 'bg-amber-400 animate-pulse' : 'bg-lime-400 animate-ping'
                }`}
              />
              <h2 className="font-extrabold text-zinc-100 text-base sm:text-lg">
                {activeSession.dayName}
              </h2>
              {isPaused && (
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  PAUSED
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>Elapsed: {formatTime(elapsedSeconds)}</span>
              <button
                onClick={() => setShowResetTimerConfirm(true)}
                className="text-zinc-500 hover:text-lime-400 p-0.5 rounded transition-colors ml-0.5"
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
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
              isPaused
                ? 'bg-amber-400 text-black border-amber-400 hover:bg-amber-300 font-bold shadow-md shadow-amber-950/40'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
            }`}
            title={isPaused ? 'Resume active workout' : 'Pause workout timer'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-black" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isPaused ? 'Resume Workout' : 'Pause'}</span>
          </button>

          {/* 5-Min Warm-up Button */}
          <button
            onClick={() => setShowWarmupModal(true)}
            className="p-2 sm:px-3 sm:py-2 bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-400/40 hover:border-amber-400 text-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Launch 5-Minute Targeted Dynamic Pre-Workout Warm-up"
          >
            <Flame className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="hidden sm:inline">5-Min Warm-up</span>
          </button>

          {/* Reset Workout Timer Button */}
          <button
            onClick={() => setShowResetTimerConfirm(true)}
            className="p-2 sm:px-3 sm:py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl text-zinc-300 hover:text-zinc-100 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Reset workout session clock to 00:00"
          >
            <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Reset Timer</span>
          </button>

          <button
            onClick={() => setIsRestTimerOpen(true)}
            className="p-2 sm:px-3 sm:py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Open Rest Timer"
          >
            <Clock className="w-4 h-4 text-lime-400" />
            <span className="hidden sm:inline">Rest Timer</span>
          </button>

          <button
            onClick={() => setShowDiscardModal(true)}
            className="p-2.5 bg-zinc-900 border border-zinc-800 hover:border-rose-900/60 rounded-xl text-zinc-400 hover:text-rose-400 text-xs font-semibold transition-colors"
            title="Discard Workout"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowFinishModal(true)}
            className="touch-press px-4 py-2 bg-lime-400 hover:bg-lime-300 text-black font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-lime-950/40 flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Finish Session</span>
          </button>
        </div>
      </div>

      {/* Paused Alert Notification Banner */}
      {isPaused && (
        <div className="p-3.5 bg-amber-500/15 border border-amber-500/40 rounded-2xl flex items-center justify-between text-xs text-amber-200 shadow-md">
          <div className="flex items-center gap-2.5">
            <Pause className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold text-amber-300">Workout Paused:</span>
              <span className="ml-1 text-zinc-300">
                Elapsed clock is frozen at {formatTime(elapsedSeconds)}. You can still log sets, check rest timers, or modify exercises.
              </span>
            </div>
          </div>
          <button
            onClick={handleTogglePause}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-lg text-xs shrink-0 transition-colors"
          >
            Resume Workout
          </button>
        </div>
      )}

      {/* Live Bluetooth Fitness Gadget Telemetry Bar */}
      {isConnected ? (
        <div className="p-3 bg-zinc-900/90 border border-sky-500/30 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500 fill-rose-500 animate-pulse" />
              <span className="font-mono text-base font-extrabold text-zinc-100">
                {liveHeartRate ?? '--'}{' '}
                <span className="text-[11px] text-zinc-400 font-normal">BPM</span>
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${currentZone.color}`}>
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
        <div className="p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <Bluetooth className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px]">
              Pair a Bluetooth fitness gadget (HR strap / smart band) for live heart rate pacing
            </span>
          </div>
          <button
            onClick={() => setIsGadgetModalOpen(true)}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-sky-300 rounded-lg text-xs font-semibold shrink-0 transition-colors"
          >
            Connect Gadget
          </button>
        </div>
      )}

      {/* Toast Notice */}
      {timerNotice && (
        <div className="p-3 bg-zinc-900/90 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 flex items-center gap-2 font-mono shadow-md animate-in fade-in duration-200">
          <Clock className="w-3.5 h-3.5 text-lime-400" />
          <span>{timerNotice}</span>
        </div>
      )}

      {/* Exercises List */}
      <div className="space-y-5">
        {activeSession.exercises.map((exercise, exIndex) => {
          // Look up previous performance for this exercise
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
              className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4"
            >
              {/* Exercise Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-lime-400/90 uppercase tracking-wider">
                      #{exIndex + 1}
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-zinc-100">
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
                    className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="Preview correct posture, joint angles, and workout form"
                  >
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    <span>Form &amp; Posture</span>
                  </button>

                  {/* AI Coach & Substitutions Button */}
                  <button
                    onClick={() => handleOpenAiCoach(exercise, exIndex)}
                    className="px-2.5 py-1 bg-lime-400/10 hover:bg-lime-400/20 text-lime-400 border border-lime-400/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="Get AI Form Cues, Warmup Ramp, and Substitutions"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Coach &amp; Subs</span>
                  </button>

                  <div className="font-mono text-zinc-400 ml-1">
                    Volume:{' '}
                    <span className="font-bold text-zinc-200">
                      {currentVolume.toLocaleString()} {profile.preferredUnit}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveExercise(exIndex)}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded transition-colors ml-1"
                    title="Remove Exercise"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Previous Performance Banner */}
              {lastSessionData ? (
                <div className="flex items-center justify-between p-3 bg-zinc-900/80 border border-zinc-800/90 rounded-xl text-xs">
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
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors shrink-0 text-[11px]"
                    title="Copy weight to all sets"
                  >
                    Use {lastWorkingWeight} {profile.preferredUnit}
                  </button>
                </div>
              ) : (
                <div className="p-2.5 bg-zinc-900/40 rounded-xl text-zinc-500 text-xs flex items-center gap-2">
                  <Info className="w-3.5 h-3.5" />
                  <span>First logged session for this exercise. Establishing baseline calibration.</span>
                </div>
              )}

              {/* Sets Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                      <th className="py-2 px-2 w-12 text-center">Set</th>
                      <th className="py-2 px-2 min-w-[90px]">Weight ({profile.preferredUnit})</th>
                      <th className="py-2 px-2 min-w-[70px]">Reps</th>
                      <th className="py-2 px-2 min-w-[65px]">RIR</th>
                      <th className="py-2 px-2 w-14 text-center">Done</th>
                      <th className="py-2 px-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {exercise.sets.map((set, setIndex) => {
                      const isCompleted = set.completed;
                      const isWarmup = set.type === 'warmup';

                      return (
                        <tr
                          key={set.id}
                          className={`transition-colors ${
                            isCompleted ? 'bg-lime-950/15' : 'hover:bg-zinc-850/30'
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
                                  : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                              }`}
                              title={isWarmup ? 'Warmup Set (click to toggle to Working)' : 'Working Set (click to toggle to Warmup)'}
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
                                className="w-16 sm:w-20 px-2 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-zinc-100 font-bold text-sm focus:outline-none focus:border-lime-400"
                              />
                              <div className="hidden sm:flex flex-col gap-0.5">
                                <button
                                  onClick={() =>
                                    handleUpdateSet(exIndex, setIndex, {
                                      weight: Number((set.weight + 2.5).toFixed(1))
                                    })
                                  }
                                  className="px-1 text-[9px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
                                >
                                  +2.5
                                </button>
                                <button
                                  onClick={() =>
                                    handleUpdateSet(exIndex, setIndex, {
                                      weight: Math.max(0, Number((set.weight - 2.5).toFixed(1)))
                                    })
                                  }
                                  className="px-1 text-[9px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
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
                              className="w-14 sm:w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-zinc-100 font-bold text-sm focus:outline-none focus:border-lime-400"
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
                              className="px-1.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-zinc-200 text-xs focus:outline-none focus:border-lime-400"
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
                              className={`touch-press w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                                isCompleted
                                  ? 'bg-lime-400 text-black shadow-md shadow-lime-950/40'
                                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 border border-zinc-700/60'
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddSet(exIndex, 'working')}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-lime-400" />
                    <span>Add Set</span>
                  </button>

                  <button
                    onClick={() => handleAddSet(exIndex, 'warmup')}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    <span>+ Warmup Set</span>
                  </button>
                </div>

                {/* Rest duration chip */}
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
          <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-lg space-y-4">
            <h4 className="font-bold text-zinc-100 text-sm">Add Exercise to Workout</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Exercise Name</label>
                <input
                  type="text"
                  value={newExName}
                  onChange={(e) => setNewExName(e.target.value)}
                  placeholder="e.g. Bulgarian Split Squat"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-lime-400"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Muscle Group</label>
                <select
                  value={newExMuscle}
                  onChange={(e) => setNewExMuscle(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-lime-400"
                >
                  <option value="Chest">Chest</option>
                  <option value="Back">Back</option>
                  <option value="Quads">Quads</option>
                  <option value="Hamstrings">Hamstrings</option>
                  <option value="Shoulders">Shoulders</option>
                  <option value="Arms">Arms</option>
                  <option value="Calves">Calves</option>
                  <option value="Core">Core</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Equipment</label>
                <select
                  value={newExEquipment}
                  onChange={(e) => setNewExEquipment(e.target.value as EquipmentType)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-lime-400"
                >
                  <option value="barbell">Barbell</option>
                  <option value="dumbbell">Dumbbell</option>
                  <option value="machine">Machine</option>
                  <option value="cable">Cable</option>
                  <option value="bodyweight">Bodyweight</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Rep Range</label>
                <input
                  type="text"
                  value={newExReps}
                  onChange={(e) => setNewExReps(e.target.value)}
                  placeholder="e.g. 8-12"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-lime-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsAddingExercise(false)}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomExercise}
                className="px-4 py-2 bg-lime-400 hover:bg-lime-300 text-black text-xs font-bold rounded-lg"
              >
                Insert Exercise
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingExercise(true)}
            className="w-full py-4 border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-2xl text-zinc-400 hover:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors bg-zinc-900/30"
          >
            <Plus className="w-4 h-4 text-lime-400" />
            <span>Add Additional Exercise</span>
          </button>
        )}
      </div>

      {/* Floating Rest Timer */}
      <RestTimer
        initialSeconds={restTimerSeconds}
        isOpen={isRestTimerOpen}
        onClose={() => setIsRestTimerOpen(false)}
      />

      {/* Finish Session Modal */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-lime-400">
              <Flame className="w-6 h-6 fill-lime-400" />
              <h3 className="font-extrabold text-lg text-zinc-100">Finish Today&apos;s Session</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Great work! This workout will be stored to your training log and used to update your
              progressive overload calculations and volume reports.
            </p>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Workout Session Notes (optional)
              </label>
              <textarea
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                placeholder="Energy levels, pump, sleep quality, adjustments..."
                rows={3}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:border-lime-400"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFinishModal(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg"
              >
                Back to Workout
              </button>
              <button
                onClick={handleConfirmFinish}
                className="px-5 py-2 bg-lime-400 hover:bg-lime-300 text-black text-xs font-bold rounded-lg shadow-md"
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
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-lg text-zinc-100">Discard In-Progress Workout?</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Are you sure you want to discard this workout? Recorded sets for this session will not
              be saved to your permanent training history.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg"
              >
                Keep Workout
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg"
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
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-lime-400">
              <RotateCcw className="w-6 h-6" />
              <h3 className="font-bold text-lg text-zinc-100">Reset Workout Timer</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Reset the session clock back to <strong className="text-zinc-200">00:00</strong>?
              Your logged sets, weights, and repetitions will <strong className="text-lime-400">NOT</strong> be lost.
            </p>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-300 flex items-center justify-between">
              <span>Current elapsed time:</span>
              <span className="font-mono font-bold text-zinc-100">{formatTime(elapsedSeconds)}</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowResetTimerConfirm(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleResetWorkoutTimer}
                className="px-4 py-2 bg-lime-400 hover:bg-lime-300 text-black text-xs font-bold rounded-lg shadow-md flex items-center gap-1.5"
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
