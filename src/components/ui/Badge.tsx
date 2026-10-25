import React from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-zinc-300 border-line-strong',
  accent: 'bg-accent/10 text-accent border-accent/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  info: 'bg-info/10 text-info border-info/30',
};

export const Badge: React.FC<
  React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: React.ReactNode }
> = ({ tone = 'neutral', icon, className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5',
      TONES[tone],
      className
    )}
    {...rest}
  >
    {icon}
    {children}
  </span>
);
