import React, { useState, useEffect, useRef } from 'react';
import {
  Flame,
  X,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  ShieldAlert,
  Zap,
  Activity,
  Award
} from 'lucide-react';

interface WarmupPhase {
  phase: 'Raise' | 'Activate' | 'Mobilize' | 'Potentiate';
  name: string;
  durationSeconds: number;
  purpose: string;
  cues: string[];
  musclesTargeted: string[];
}

interface WarmupRoutine {
  routineName: string;
  totalDurationSeconds: number;
  targetMuscles: string[];
  coachTip: string;
  phases: WarmupPhase[];
}

interface DynamicWarmupModalProps {
  isOpen: boolean;
  onClose: () => void;
  muscleGroups?: string[];
  exercises?: string[];
  workoutName?: string;
  onWarmupCompleted?: () => void;
}

export const DynamicWarmupModal: React.FC<DynamicWarmupModalProps> = ({
  isOpen,
  onClose,
  muscleGroups = ['Chest', 'Shoulders', 'Triceps'],
  exercises = ['Bench Press', 'Incline Press'],
  workoutName = 'Today Workout',
  onWarmupCompleted
}) => {
  const [routine, setRoutine] = useState<WarmupRoutine | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active workout state
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Audio synthesizer ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playBeep = (freq: number = 880, duration: number = 0.12) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // AudioContext unavailable
    }
  };

  // Fetch or regenerate warm-up
  const loadWarmupRoutine = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-warmup-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          muscleGroups,
          exercises,
          workoutName,
          intensity: 'High Hypertrophy'
        })
      });
      const data = await res.json();
      if (data.success && data.routine) {
        setRoutine(data.routine);
        setCurrentStepIndex(0);
        setSecondsRemaining(data.routine.phases[0]?.durationSeconds || 60);
        setIsPlaying(false);
        setIsCompleted(false);
      } else {
        throw new Error(data.error || 'Failed to generate warm-up routine');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Error generating routine');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadWarmupRoutine();
    } else {
      setIsPlaying(false);
    }
  }, [isOpen]);

  // Main countdown timer interval
  useEffect(() => {
    if (!isPlaying || isCompleted || !routine) return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Check if more steps remain
          if (currentStepIndex < routine.phases.length - 1) {
            playBeep(1046.5, 0.25); // Higher pitch transition chime
            const nextIdx = currentStepIndex + 1;
            setCurrentStepIndex(nextIdx);
            return routine.phases[nextIdx].durationSeconds;
          } else {
            // Finished!
            playBeep(1318.5, 0.4);
            setIsPlaying(false);
            setIsCompleted(true);
            onWarmupCompleted?.();
            return 0;
          }
        }
        if (prev <= 4 && prev > 1) {
          playBeep(587.33, 0.08); // Countdown bleep
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, currentStepIndex, routine, isCompleted, soundEnabled]);

  if (!isOpen) return null;

  const currentPhase = routine?.phases[currentStepIndex];
  const totalSteps = routine?.phases.length || 5;

  const getPhaseBadgeColor = (phase?: string) => {
    switch (phase) {
      case 'Raise':
        return 'bg-amber-400/15 text-amber-400 border-amber-400/30';
      case 'Activate':
        return 'bg-sky-400/15 text-sky-400 border-sky-400/30';
      case 'Mobilize':
        return 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30';
      case 'Potentiate':
        return 'bg-fuchsia-400/15 text-fuchsia-400 border-fuchsia-400/30';
      default:
        return 'bg-lime-400/15 text-lime-400 border-lime-400/30';
    }
  };

  const handleNextStep = () => {
    if (!routine) return;
    if (currentStepIndex < routine.phases.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      setSecondsRemaining(routine.phases[nextIdx].durationSeconds);
    } else {
      setIsCompleted(true);
      setIsPlaying(false);
      onWarmupCompleted?.();
    }
  };

  const handlePrevStep = () => {
    if (!routine) return;
    if (currentStepIndex > 0) {
      const prevIdx = currentStepIndex - 1;
      setCurrentStepIndex(prevIdx);
      setSecondsRemaining(routine.phases[prevIdx].durationSeconds);
      setIsCompleted(false);
    }
  };

  const handleReset = () => {
    if (!routine) return;
    setCurrentStepIndex(0);
    setSecondsRemaining(routine.phases[0].durationSeconds);
    setIsPlaying(false);
    setIsCompleted(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Dynamic warm-up" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-overlay backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* MODAL HEADER */}
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-canvas/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-lime-400/15 border border-lime-400/30 flex items-center justify-center text-lime-400 shadow-inner">
              <Flame className="w-5 h-5 fill-lime-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold tracking-wide px-2 py-0.5 rounded bg-lime-400/15 text-lime-400 border border-lime-400/30">
                  RAMP Protocol · 5-Min
                </span>
                <span className="text-xs text-zinc-400 hidden sm:inline">Pre-Workout Priming</span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2">
                Dynamic Warm-up Generator
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 bg-surface-2 border border-line transition-colors"
              title={soundEnabled ? 'Mute Audio Beeps' : 'Enable Audio Beeps'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-lime-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 bg-surface-2 border border-line transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* MODAL CONTENT BODY */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-lime-400/10 border border-lime-400/30 flex items-center justify-center text-lime-400 animate-pulse">
                <Activity className="w-7 h-7 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-200">
                  Generating 5-Minute RAMP Sequence...
                </p>
                <p className="text-xs text-zinc-400 max-w-sm mt-1">
                  Analyzing target muscle groups ({muscleGroups.join(', ')}) to compute optimal dynamic joint mobility & neural potentiation drills.
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-center space-y-3">
              <ShieldAlert className="w-6 h-6 text-rose-400 mx-auto" />
              <p className="text-xs text-rose-300">{error}</p>
              <button
                onClick={loadWarmupRoutine}
                className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-xl text-xs font-semibold"
              >
                Retry Generation
              </button>
            </div>
          ) : isCompleted ? (
            /* COMPLETION CARD */
            <div className="py-10 text-center space-y-5 animate-fade-in">
              <div className="w-20 h-20 rounded-full bg-lime-400/20 border-2 border-lime-400 flex items-center justify-center text-lime-400 mx-auto shadow-lg shadow-lime-950/40">
                <Award className="w-10 h-10 animate-bounce" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl sm:text-2xl font-bold text-zinc-100">
                  Body Primed & Ready to Lift!
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  You completed all 5 minutes of the RAMP warm-up. Core temperature is elevated, joint capsules are lubricated, and high-threshold motor units are potentiated.
                </p>
              </div>

              <div className="p-4 bg-surface-2/80 border border-line rounded-2xl max-w-md mx-auto text-left flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" />
                <div className="text-xs text-zinc-300">
                  <span className="font-bold text-lime-400">Coach Iron Tip:</span> Take 60 seconds of rest, load 50% of your first working set load for an easy 3-rep rehearsal, and then begin your official working sets!
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 border border-line rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restart Warm-up</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 bg-lime-400 hover:bg-lime-300 text-accent-ink font-extrabold rounded-xl text-xs shadow-lg shadow-lime-950/40 flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Enter Workout Session</span>
                </button>
              </div>
            </div>
          ) : (
            routine &&
            currentPhase && (
              <div className="space-y-5">
                {/* TARGET CONTEXT BANNER */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-surface-2/60 border border-line rounded-2xl text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <span className="text-zinc-500 font-mono">Muscles:</span>
                    <span className="font-bold text-zinc-200">
                      {routine.targetMuscles.join(', ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px]">
                    <span>Drill {currentStepIndex + 1} of {totalSteps}</span>
                    <span>·</span>
                    <span>Total: 5:00</span>
                  </div>
                </div>

                {/* PROGRESS BAR ACROSS THE 5 PHASES */}
                <div className="grid grid-cols-5 gap-1.5">
                  {routine.phases.map((p, idx) => {
                    const isPassed = idx < currentStepIndex;
                    const isCurrent = idx === currentStepIndex;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setCurrentStepIndex(idx);
                          setSecondsRemaining(p.durationSeconds);
                        }}
                        className={`text-left p-2 rounded-xl border transition-all text-[11px] font-mono flex flex-col justify-between h-14 ${
                          isCurrent
                            ? 'bg-lime-400/10 border-lime-400 text-lime-400 font-bold ring-1 ring-lime-400/50'
                            : isPassed
                            ? 'bg-surface-2/90 border-line text-zinc-400'
                            : 'bg-canvas/50 border-zinc-800/50 text-zinc-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{p.phase[0]}</span>
                          {isPassed && <CheckCircle2 className="w-2.5 h-2.5 text-lime-400" />}
                        </div>
                        <span className="truncate block font-sans text-[11px] leading-tight text-zinc-200">
                          {p.phase}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* ACTIVE DRILL HERO CARD */}
                <div className="bg-surface-2 border border-line rounded-2xl p-5 sm:p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 text-lime-400 pointer-events-none">
                    <Flame className="w-32 h-32" />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-[11px] font-mono font-extrabold px-2.5 py-0.5 rounded-lg border ${getPhaseBadgeColor(
                            currentPhase.phase
                          )}`}
                        >
                          Phase: {currentPhase.phase}
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          Target: {currentPhase.musclesTargeted.join(', ')}
                        </span>
                      </div>
                      <h3 className="text-lg sm:text-2xl font-bold text-zinc-100">
                        {currentPhase.name}
                      </h3>
                      <p className="text-xs text-zinc-400 mt-1 max-w-md">
                        {currentPhase.purpose}
                      </p>
                    </div>

                    {/* BIG TIMER CIRCLE */}
                    <div className="flex items-center justify-center shrink-0">
                      <div className="relative w-28 h-28 rounded-full border-4 border-line flex flex-col items-center justify-center bg-canvas shadow-inner">
                        <span className="text-3xl font-mono font-bold text-lime-400 tracking-tight">
                          {secondsRemaining}s
                        </span>
                        <span className="text-[11px] font-mono text-zinc-500 ">
                          Remaining
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* STEP-BY-STEP CUES */}
                  <div className="mt-5 pt-4 border-t border-line space-y-2">
                    <span className="text-[11px] font-mono tracking-wide text-lime-400 font-bold block">
                      Biomechanical Form & Movement Cues:
                    </span>
                    <ul className="space-y-1.5">
                      {currentPhase.cues.map((cue, cIdx) => (
                        <li key={cIdx} className="flex items-start gap-2 text-xs text-zinc-300">
                          <ChevronRight className="w-3.5 h-3.5 text-lime-400 shrink-0 mt-0.5" />
                          <span>{cue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* PLAYBACK CONTROLS */}
                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrevStep}
                      disabled={currentStepIndex === 0}
                      className="px-3 py-2.5 bg-surface-2 border border-line disabled:opacity-30 hover:border-line-strong text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={handleReset}
                      className="p-2.5 bg-surface-2 border border-line hover:border-line-strong text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors"
                      title="Restart Routine"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`touch-press px-6 py-3 rounded-2xl font-extrabold text-sm flex items-center gap-2 shadow-lg transition-all ${
                      isPlaying
                        ? 'bg-amber-400 hover:bg-amber-300 text-accent-ink shadow-amber-950/40'
                        : 'bg-lime-400 hover:bg-lime-300 text-accent-ink shadow-lime-950/40'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-4 h-4 fill-black" />
                        <span>Pause Timer</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-black" />
                        <span>Start Exercise ({secondsRemaining}s)</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleNextStep}
                    className="px-3.5 py-2.5 bg-surface-2 hover:bg-surface-3 border border-line text-zinc-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <span>{currentStepIndex === totalSteps - 1 ? 'Finish' : 'Next'}</span>
                    <SkipForward className="w-3.5 h-3.5 text-lime-400" />
                  </button>
                </div>

                {/* COACH TIP FOOTER */}
                {routine.coachTip && (
                  <div className="p-3 bg-surface-2/50 border border-line rounded-xl text-xs text-zinc-400 flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-lime-400 shrink-0 mt-0.5" />
                    <span>{routine.coachTip}</span>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
