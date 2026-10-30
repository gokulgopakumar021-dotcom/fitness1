import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, X, Timer, Plus, Minus, SkipForward, Check } from 'lucide-react';
import { Button, ProgressBar, cn } from '../ui';

interface RestTimerProps {
  initialSeconds?: number;
  isOpen: boolean;
  onClose: () => void;
  onFinished?: () => void;
}

export function playTimerChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1); // D6 note

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio context may be restricted before user gesture
  }
}

export const RestTimer: React.FC<RestTimerProps> = ({
  initialSeconds = 90,
  isOpen,
  onClose,
  onFinished
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(initialSeconds);
  const [totalSeconds, setTotalSeconds] = useState<number>(initialSeconds);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSecondsLeft(initialSeconds);
    setTotalSeconds(initialSeconds);
    setIsRunning(true);
  }, [initialSeconds, isOpen]);

  useEffect(() => {
    if (!isOpen || !isRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          playTimerChime();
          if (onFinished) onFinished();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, isRunning, onFinished]);

  if (!isOpen) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - secondsLeft) / totalSeconds) * 100 : 0;
  const isFinished = secondsLeft === 0;

  const addTime = (delta: number) => {
    const next = Math.max(0, secondsLeft + delta);
    setSecondsLeft(next);
    if (next > totalSeconds) setTotalSeconds(next);
  };

  const presetTimes = [60, 90, 120, 180];

  return (
    <section
      aria-label="Rest timer"
      className={cn(
        'fixed z-50 left-3 right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))]',
        'md:left-auto md:right-8 md:bottom-6 md:w-80',
        'rounded-card bg-surface-2 border p-4 text-zinc-100 shadow-2xl il-sheet-up',
        isFinished ? 'border-accent/50' : 'border-line-strong'
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-label font-semibold text-zinc-400">
            <Timer className="w-3.5 h-3.5 text-volt-adaptive" aria-hidden />
            <span>Rest timer</span>
          </div>
          {/* role=timer is not announced every second; completion is announced in the status line. */}
          <div
            role="timer"
            aria-label={`${minutes} minutes ${seconds} seconds remaining`}
            className={cn(
              'text-4xl sm:text-5xl font-mono font-bold tracking-tight tabular leading-tight',
              isFinished ? 'text-volt-adaptive' : 'text-white'
            )}
          >
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 min-w-0">
          <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close Timer" className="-mr-2 -mt-2">
            <X className="w-4 h-4" aria-hidden />
          </Button>
          <div role="status" aria-live="polite" className="text-right">
            {isFinished && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-volt-adaptive">
                <Check className="w-3.5 h-3.5" aria-hidden />
                Rest finished. Time to lift.
              </span>
            )}
            {!isFinished && !isRunning && <span className="text-xs text-zinc-400">Paused</span>}
          </div>
        </div>
      </div>

      <ProgressBar value={progressPercent} tone={isFinished ? 'success' : 'accent'} label="Rest progress" />

      {/* Adjust, pause/resume, reset */}
      <div className="flex items-center gap-2 mt-3">
        <Button variant="secondary" iconOnly onClick={() => addTime(-15)} aria-label="Subtract 15 seconds" title="-15s">
          <Minus className="w-4 h-4" aria-hidden />
        </Button>

        <Button
          variant={isRunning ? 'secondary' : 'primary'}
          onClick={() => setIsRunning(!isRunning)}
          icon={isRunning ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
          className="flex-1"
        >
          {isRunning ? 'Pause' : 'Resume'}
        </Button>

        <Button variant="secondary" iconOnly onClick={() => addTime(15)} aria-label="Add 15 seconds" title="+15s">
          <Plus className="w-4 h-4" aria-hidden />
        </Button>

        <Button
          variant="secondary"
          iconOnly
          onClick={() => {
            setSecondsLeft(totalSeconds);
            setIsRunning(true);
          }}
          aria-label="Reset timer"
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" aria-hidden />
        </Button>
      </div>

      {/* Preset intervals + skip */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
        <div className="grid grid-cols-4 gap-1.5 flex-1 min-w-0" role="group" aria-label="Rest presets">
          {presetTimes.map((secs) => {
            const active = totalSeconds === secs && secondsLeft > 0;
            return (
              <button
                key={secs}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTotalSeconds(secs);
                  setSecondsLeft(secs);
                  setIsRunning(true);
                }}
                className={cn(
                  'h-11 sm:h-9 rounded-control border text-xs font-mono font-semibold tabular transition-colors touch-press',
                  active
                    ? 'bg-accent/10 text-volt-adaptive border-accent/40'
                    : 'bg-surface-3 text-zinc-300 border-line hover:text-white hover:border-line-strong'
                )}
              >
                {secs}s
              </button>
            );
          })}
        </div>
        <Button
          variant={isFinished ? 'primary' : 'ghost'}
          onClick={onClose}
          icon={isFinished ? <Check className="w-4 h-4" aria-hidden /> : <SkipForward className="w-4 h-4" aria-hidden />}
          className="shrink-0"
        >
          {isFinished ? 'Done' : 'Skip'}
        </Button>
      </div>
    </section>
  );
};
