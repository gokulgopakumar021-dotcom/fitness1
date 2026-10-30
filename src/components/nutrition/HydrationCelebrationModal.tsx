import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Trophy, Droplets, Sparkles, Flame, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Daily Target Crushed!"
      size="sm"
      footer={
        <Button type="button" size="lg" fullWidth onClick={onClose}>
          <span>Continue Training &amp; Tracking</span>
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Button>
      }
    >
      <div className="relative overflow-hidden text-center">
        {/* Confetti burst, clipped to the dialog body; skipped when the user prefers reduced motion */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center" aria-hidden>
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

        <div className="relative flex justify-center pt-1 pb-4">
          {/* Spring supports exactly two keyframes; the overshoot comes from the low damping. */}
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.15, type: 'spring', damping: 12, stiffness: 200 }}
            className="w-20 h-20 rounded-card bg-accent/10 border border-accent/30 flex items-center justify-center"
          >
            <Trophy className="w-10 h-10 text-accent" aria-hidden />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative space-y-3"
        >
          <Badge tone="success" icon={<Sparkles className="w-3.5 h-3.5" aria-hidden />} className="font-mono">
            GOAL COMPLETED ({percentage}%)
          </Badge>

          <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto leading-relaxed">
            You logged <strong className="text-white">{currentDisplay}</strong>, satisfying your full daily athletic target of <strong className="text-success">{goalDisplay}</strong>.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.45 }}
          className="relative mt-5 p-3.5 rounded-card bg-canvas border border-line flex items-center justify-around gap-2 text-left"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-control bg-warning/10 border border-warning/30 flex items-center justify-center text-warning">
              <Flame className="w-5 h-5 fill-current" aria-hidden />
            </div>
            <div>
              <span className="text-label font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                Weekly Streak
              </span>
              <span className="text-base font-mono font-bold text-white">
                {streakCount > 0 ? `${streakCount} Day Streak!` : '1st Day Hit!'}
              </span>
            </div>
          </div>

          <div className="h-8 w-px bg-line-strong" aria-hidden />

          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-control bg-info/10 border border-info/30 flex items-center justify-center text-info">
              <Droplets className="w-5 h-5" aria-hidden />
            </div>
            <div>
              <span className="text-label font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                Cell Volume
              </span>
              <span className="text-base font-mono font-bold text-info">
                100% Primed
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </Modal>
  );
};
