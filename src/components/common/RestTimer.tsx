import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, X, Volume2, Plus, Minus } from 'lucide-react';

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

  const addTime = (delta: number) => {
    const next = Math.max(0, secondsLeft + delta);
    setSecondsLeft(next);
    if (next > totalSeconds) setTotalSeconds(next);
  };

  const presetTimes = [60, 90, 120, 180];

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-8 z-50 w-72 bg-surface-2 border border-line rounded-xl shadow-2xl p-4 text-zinc-100 backdrop-blur-md">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-line">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-lime-400">
          <Volume2 className="w-3.5 h-3.5" />
          <span>Rest Interval Timer</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md transition-colors"
          aria-label="Close Timer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Timer Display */}
      <div className="text-center py-2">
        <div
          className={`text-4xl font-mono font-bold tracking-tight ${
            secondsLeft === 0 ? 'text-lime-400 animate-pulse' : 'text-zinc-100'
          }`}
        >
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
        {secondsLeft === 0 && (
          <p className="text-xs font-semibold text-lime-400 mt-1">REST PERIOD FINISHED! TIME TO LIFT.</p>
        )}
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-surface-3 h-1.5 rounded-full overflow-hidden my-2">
        <div
          className="bg-lime-400 h-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Quick Add / Subtract & Controls */}
      <div className="flex items-center justify-center gap-2 mt-3">
        <button
          onClick={() => addTime(-15)}
          className="p-2 bg-surface-3/80 hover:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
          title="-15s"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setIsRunning(!isRunning)}
          className={`px-4 py-2 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors ${
            isRunning
              ? 'bg-surface-3 hover:bg-zinc-700 text-zinc-200'
              : 'bg-lime-400 text-accent-ink hover:bg-lime-300'
          }`}
        >
          {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isRunning ? 'Pause' : 'Resume'}</span>
        </button>

        <button
          onClick={() => {
            setSecondsLeft(totalSeconds);
            setIsRunning(true);
          }}
          className="p-2 bg-surface-3/80 hover:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
          title="Reset"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => addTime(15)}
          className="p-2 bg-surface-3/80 hover:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
          title="+15s"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Preset intervals */}
      <div className="grid grid-cols-4 gap-1 mt-3 pt-2 border-t border-zinc-800/60">
        {presetTimes.map((secs) => (
          <button
            key={secs}
            onClick={() => {
              setTotalSeconds(secs);
              setSecondsLeft(secs);
              setIsRunning(true);
            }}
            className={`py-1 rounded text-[11px] font-mono font-medium transition-colors ${
              totalSeconds === secs && secondsLeft > 0
                ? 'bg-lime-400/20 text-lime-400 border border-lime-400/40'
                : 'bg-surface-3/40 hover:bg-surface-3 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {secs}s
          </button>
        ))}
      </div>
    </div>
  );
};
