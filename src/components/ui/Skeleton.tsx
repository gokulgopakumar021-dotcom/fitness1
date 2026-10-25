import React from 'react';
import { cn } from './cn';

/** Loading placeholder. Shimmer is disabled automatically under reduced-motion. */
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden
    className={cn('relative overflow-hidden rounded-lg bg-surface-2', className)}
  >
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent" style={{ animation: 'il-shimmer 1.4s infinite' }} />
  </div>
);
