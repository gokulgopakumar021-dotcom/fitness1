import React from 'react';
import { cn } from '../ui';

export type MacroKey = 'protein' | 'carbs' | 'fat';

/** One colour per macro, taken from the design-system chart palette so both themes stay legible. */
export const MACRO_META: Record<MacroKey, { label: string; short: string; color: string }> = {
  protein: { label: 'Protein', short: 'P', color: 'var(--chart-1)' },
  carbs: { label: 'Carbs', short: 'C', color: 'var(--chart-2)' },
  fat: { label: 'Fat', short: 'F', color: 'var(--chart-4)' }
};

/** Whole-number percentage of target. Zero or missing targets read as 0, never NaN or Infinity. */
export const percentOf = (current: number, target: number): number =>
  target > 0 && Number.isFinite(current) ? Math.round((current / target) * 100) : 0;

interface MacroBarProps {
  macro: MacroKey;
  current: number;
  target: number;
  className?: string;
}

/** Label, value-over-target, progress bar and a single "left / over" line for one macro. */
export const MacroBar: React.FC<MacroBarProps> = ({ macro, current, target, className }) => {
  const meta = MACRO_META[macro];
  const hasTarget = target > 0;
  const pct = percentOf(current, target);
  const diff = target - current;
  const status = !hasTarget
    ? 'No target set'
    : diff > 0
    ? `${diff}g left`
    : diff === 0
    ? 'Target reached'
    : `${Math.abs(diff)}g over`;

  return (
    <div className={cn('min-w-0 space-y-1.5', className)} data-macro={macro}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
          {meta.label}
        </span>
        <span className="text-label text-zinc-500 tabular-nums">{hasTarget ? `${pct}%` : '—'}</span>
      </div>
      <div className="text-lg font-semibold font-mono text-white tabular-nums leading-tight">
        {current}g <span className="text-xs font-normal text-zinc-500">/ {target}g</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${meta.label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: meta.color }}
        />
      </div>
      <div className={cn('text-label tabular-nums', diff < 0 && hasTarget ? 'text-warning' : 'text-zinc-400')}>{status}</div>
    </div>
  );
};
