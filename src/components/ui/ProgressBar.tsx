import React from 'react';
import { cn } from './cn';

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info';
const FILL: Record<Tone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

interface Props {
  value: number;
  max?: number;
  tone?: Tone;
  label?: string;
  className?: string;
}

/** Accessible linear progress. Value is clamped to 0..max for display only. */
export const ProgressBar: React.FC<Props> = ({ value, max = 100, tone = 'accent', label, className }) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(Math.min(value, safeMax))}
      aria-label={label}
      className={cn('h-1.5 w-full rounded-full bg-surface-3 overflow-hidden', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};
