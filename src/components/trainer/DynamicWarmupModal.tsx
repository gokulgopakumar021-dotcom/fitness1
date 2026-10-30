import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  Zap,
  Award
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorState } from '../ui/ErrorState';
import { LoadingState } from '../ui/LoadingState';

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

  const currentPhase = routine?.phases[currentStepIndex];
  const totalSteps = routine?.phases.length || 5;

  const getPhaseBadgeColor = (phase?: string) => {
    switch (phase) {
      case 'Raise':
        return 'bg-warning/10 text-warning border-warning/30';
      case 'Activate':
        return 'bg-info/10 text-info border-info/30';
      case 'Mobilize':
        return 'bg-success/10 text-success border-success/30';
      case 'Potentiate':
        return 'bg-chart-3/10 text-chart-3 border-chart-3/30';
      default:
        return 'bg-accent/10 text-accent border-accent/30';
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Dynamic Warm-up Generator"
      description="Pre-workout priming"
      size="lg"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label font-mono font-bold tracking-wide px-2 py-1 rounded-control bg-accent/10 text-accent border border-accent/30">
            RAMP Protocol · 5-Min
          </span>
          <Button
            variant="secondary"
            iconOnly
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Mute Audio Beeps' : 'Enable Audio Beeps'}
            title={soundEnabled ? 'Mute Audio Beeps' : 'Enable Audio Beeps'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-accent" aria-hidden /> : <VolumeX className="w-4 h-4 text-zinc-500" aria-hidden />}
          </Button>
        </div>

        {isLoading ? (
          <div className="py-6 space-y-1">
            <LoadingState label="Generating 5-Minute RAMP Sequence..." />
            <p className="text-xs text-zinc-400 max-w-sm mx-auto text-center">
              Analyzing target muscle groups ({muscleGroups.join(', ')}) to compute optimal dynamic joint mobility & neural potentiation drills.
            </p>
          </div>
        ) : error ? (
          <ErrorState
            title="Could not generate the warm-up"
            description={error}
            action={
              <Button variant="secondary" onClick={loadWarmupRoutine}>
                Retry Generation
              </Button>
            }
          />
        ) : isCompleted ? (
          /* COMPLETION CARD */
          <div className="py-6 text-center space-y-5 il-fade-in">
            <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center text-accent mx-auto">
              <Award className="w-10 h-10" aria-hidden />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl sm:text-2xl font-bold text-zinc-100">
                Body Primed & Ready to Lift!
              </h3>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">
                You completed all 5 minutes of the RAMP warm-up. Core temperature is elevated, joint capsules are lubricated, and high-threshold motor units are potentiated.
              </p>
            </div>

            <Card tone="raised" pad="sm" className="max-w-md mx-auto text-left flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden />
              <div className="text-sm text-zinc-300">
                <span className="font-bold text-accent">Coach Iron Tip:</span> Take 60 seconds of rest, load 50% of your first working set load for an easy 3-rep rehearsal, and then begin your official working sets!
              </div>
            </Card>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
              <Button variant="secondary" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" aria-hidden />}>
                Restart Warm-up
              </Button>
              <Button onClick={onClose} icon={<CheckCircle2 className="w-4 h-4" aria-hidden />}>
                Enter Workout Session
              </Button>
            </div>
          </div>
        ) : (
          routine &&
          currentPhase && (
            <div className="space-y-5">
              {/* TARGET CONTEXT BANNER */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-surface-2 border border-line rounded-card text-xs">
                <div className="flex items-center gap-2 text-zinc-400 min-w-0">
                  <span className="text-zinc-500 font-mono">Muscles:</span>
                  <span className="font-bold text-zinc-200">
                    {routine.targetMuscles.join(', ')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-label">
                  <span>Drill {currentStepIndex + 1} of {totalSteps}</span>
                  <span>·</span>
                  <span>Total: 5:00</span>
                </div>
              </div>

              {/* PROGRESS ACROSS THE PHASES */}
              <div className="grid grid-cols-5 gap-1.5">
                {routine.phases.map((p, idx) => {
                  const isPassed = idx < currentStepIndex;
                  const isCurrent = idx === currentStepIndex;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCurrentStepIndex(idx);
                        setSecondsRemaining(p.durationSeconds);
                      }}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`Drill ${idx + 1}: ${p.phase}`}
                      title={p.phase}
                      className={`text-left p-2 rounded-control border transition-colors text-label font-mono flex flex-col justify-between min-h-14 ${
                        isCurrent
                          ? 'bg-accent/10 border-accent text-accent font-bold'
                          : isPassed
                          ? 'bg-surface-2 border-line text-zinc-400'
                          : 'bg-canvas border-line text-zinc-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{p.phase[0]}</span>
                        {isPassed && <CheckCircle2 className="w-3 h-3 text-accent" aria-hidden />}
                      </div>
                      <span className="truncate block font-sans text-label leading-tight text-zinc-200">
                        {p.phase}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ACTIVE DRILL */}
              <Card tone="raised" pad="lg">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-label font-mono font-extrabold px-2.5 py-0.5 rounded-control border ${getPhaseBadgeColor(
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
                    <p className="text-sm text-zinc-400 mt-1 max-w-md">
                      {currentPhase.purpose}
                    </p>
                  </div>

                  {/* TIMER */}
                  <div className="flex items-center justify-center shrink-0">
                    <div
                      role="timer"
                      aria-label={`${secondsRemaining} seconds remaining`}
                      className="w-28 h-28 rounded-full border-4 border-line flex flex-col items-center justify-center bg-canvas"
                    >
                      <span className="text-3xl font-mono font-bold text-accent tracking-tight">
                        {secondsRemaining}s
                      </span>
                      <span className="text-label font-mono text-zinc-500">
                        Remaining
                      </span>
                    </div>
                  </div>
                </div>

                {/* STEP-BY-STEP CUES */}
                <div className="mt-5 pt-4 border-t border-line space-y-2">
                  <span className="text-label font-mono tracking-wide text-accent font-bold block">
                    Biomechanical Form & Movement Cues:
                  </span>
                  <ul className="space-y-1.5">
                    {currentPhase.cues.map((cue, cIdx) => (
                      <li key={cIdx} className="flex items-start gap-2 text-sm text-zinc-300">
                        <ChevronRight className="w-3.5 h-3.5 text-accent shrink-0 mt-1" aria-hidden />
                        <span>{cue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              {/* PLAYBACK CONTROLS: primary action on its own row so nothing overflows on phones */}
              <div className="space-y-3">
                <Button
                  size="lg"
                  fullWidth
                  variant={isPlaying ? 'secondary' : 'primary'}
                  onClick={() => setIsPlaying(!isPlaying)}
                  icon={isPlaying ? <Pause className="w-4 h-4 fill-current" aria-hidden /> : <Play className="w-4 h-4 fill-current" aria-hidden />}
                >
                  {isPlaying ? 'Pause Timer' : `Start Exercise (${secondsRemaining}s)`}
                </Button>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
                  <Button variant="secondary" onClick={handlePrevStep} disabled={currentStepIndex === 0}>
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    iconOnly
                    onClick={handleReset}
                    aria-label="Restart Routine"
                    title="Restart Routine"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden />
                  </Button>
                  <Button variant="secondary" onClick={handleNextStep}>
                    <span>{currentStepIndex === totalSteps - 1 ? 'Finish' : 'Next'}</span>
                    <SkipForward className="w-4 h-4 text-accent" aria-hidden />
                  </Button>
                </div>
              </div>

              {/* COACH TIP */}
              {routine.coachTip && (
                <div className="p-3 bg-surface-2 border border-line rounded-card text-xs text-zinc-400 flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" aria-hidden />
                  <span>{routine.coachTip}</span>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </Modal>
  );
};
