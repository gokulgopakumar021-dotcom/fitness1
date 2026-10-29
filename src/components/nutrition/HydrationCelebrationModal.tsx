import React, { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Trophy, Droplets, Sparkles, CheckCircle2, Flame, X, ArrowRight } from 'lucide-react';
import { WaterUnit } from './WaterIntakeLogger';

export interface HydrationCelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  waterMl: number;
  goalMl: number;
  goalOz: number;
  unit: WaterUnit;
  streakCount: number;
}

// 40 particles with varying angles, colors, and speeds
const CONFETTI_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--success)',
  'var(--warning)'
];

const PARTICLES = Array.from({ length: 36 }).map((_, i) => {
  const angle = (i / 36) * 360;
  const distance = 80 + (i % 5) * 35;
  const rad = (angle * Math.PI) / 180;
  return {
    id: i,
    x: Math.cos(rad) * distance,
    y: Math.sin(rad) * distance,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 4 + (i % 4) * 2,
    rotate: (i * 25) % 360
  };
});

export const HydrationCelebrationModal: React.FC<HydrationCelebrationModalProps> = ({
  isOpen,
  onClose,
  waterMl,
  goalMl,
  goalOz,
  unit,
  streakCount
}) => {
  const reduceMotion = useReducedMotion();
  // Web Audio celebratory fanfare arpeggio
  useEffect(() => {
    if (!isOpen) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // C5 -> E5 -> G5 -> C6 fanfare
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + index * 0.12;
        const dur = 0.35;

        osc.type = index === 3 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.15, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });
    } catch {
      // Audio not supported or blocked
    }

    // Auto close after 6 seconds if not dismissed
    const timer = setTimeout(() => {
      onClose();
    }, 6000);

    return () => clearTimeout(timer);
  }, [isOpen, onClose]);

  const currentOz = Math.round(waterMl * 0.033814);
  const currentDisplay = unit === 'oz' ? `${currentOz} fl oz` : `${waterMl.toLocaleString()} ml`;
  const goalDisplay = unit === 'oz' ? `${goalOz} fl oz` : `${goalMl.toLocaleString()} ml`;
  const percentage = Math.round((waterMl / (goalMl || 1)) * 100);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-overlay backdrop-blur-sm"
          />

          {/* Central Animated Modal Card */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 18, stiffness: 220 }}
            role="dialog"
            aria-modal="true"
            aria-label="Hydration goal reached"
            className="relative z-10 w-full max-w-md p-6 sm:p-7 rounded-card bg-surface border border-success/40 shadow-2xl text-center overflow-hidden"
          >
            {/* Confetti Explosion Particles */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              {!reduceMotion && PARTICLES.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
                  animate={{
                    x: p.x * 1.5,
                    y: p.y * 1.5,
                    opacity: [1, 1, 0],
                    scale: [0, 1.4, 0.8],
                    rotate: p.rotate + 180
                  }}
                  transition={{ duration: 1.4, ease: 'easeOut', delay: 0.1 }}
                  style={{
                    backgroundColor: p.color,
                    width: p.size,
                    height: p.size,
                    borderRadius: p.id % 2 === 0 ? '50%' : '2px',
                    position: 'absolute'
                  }}
                />
              ))}
            </div>

            {/* Close X */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-control text-zinc-400 hover:text-white hover:bg-surface-2 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Glowing Icon Header */}
            <div className="relative my-3 flex justify-center">
              <motion.div
                initial={{ scale: 0, rotate: -25 }}
                animate={{ scale: [0, 1.35, 1], rotate: 0 }}
                transition={{ delay: 0.15, type: 'spring', damping: 12, stiffness: 200 }}
                className="w-20 h-20 rounded-card bg-accent/10 border border-accent/30 flex items-center justify-center"
              >
                <Trophy className="w-10 h-10 text-accent" aria-hidden />
              </motion.div>
            </div>

            {/* Badges & Titles */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="space-y-2"
            >
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-400/40">
                <Sparkles className="w-3.5 h-3.5" />
                <span>GOAL COMPLETED ({percentage}%)</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Daily Target Crushed!
              </h2>

              <p className="text-xs sm:text-sm text-[var(--text-secondary)] font-sans max-w-xs mx-auto leading-relaxed">
                You logged <strong className="text-white">{currentDisplay}</strong>, satisfying your full daily athletic target of <strong className="text-emerald-400">{goalDisplay}</strong>.
              </p>
            </motion.div>

            {/* Streak & XP Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.45 }}
              className="mt-5 p-3.5 rounded-2xl bg-[var(--bg-canvas)] border border-[var(--border-card)] flex items-center justify-around gap-2 text-left"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400">
                  <Flame className="w-5 h-5 fill-amber-400" />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Weekly Streak
                  </span>
                  <span className="text-base font-mono font-bold text-white">
                    {streakCount > 0 ? `${streakCount} Day Streak!` : '1st Day Hit!'}
                  </span>
                </div>
              </div>

              <div className="h-8 w-px bg-white/10" />

              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
                  <Droplets className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Cell Volume
                  </span>
                  <span className="text-base font-mono font-bold text-sky-400">
                    100% Primed
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Action Button */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-6"
            >
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-400 hover:to-sky-400 text-white font-mono font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2"
              >
                <span>Continue Training &amp; Tracking</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
