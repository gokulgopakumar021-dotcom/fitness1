import React from 'react';
import { cn } from './cn';
import { Card } from './Card';

interface Props {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  emphasis?: boolean;
  className?: string;
}

/** A single headline number with label. Tabular numerals for alignment. */
export const MetricCard: React.FC<Props> = ({ label, value, unit, hint, icon, emphasis, className }) => (
  <Card tone={emphasis ? 'accent' : 'default'} pad="md" className={cn('flex flex-col gap-2', className)}>
    <div className="flex items-center justify-between gap-2 text-zinc-400">
      <span className="text-xs font-medium truncate">{label}</span>
      {icon && <span className="shrink-0 text-zinc-500" aria-hidden>{icon}</span>}
    </div>
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular truncate">{value}</span>
      {unit && <span className="text-xs font-medium text-zinc-500">{unit}</span>}
    </div>
    {hint && <div className="text-xs text-zinc-400">{hint}</div>}
  </Card>
);
