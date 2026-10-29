import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

interface Props {
  label?: string;
  className?: string;
}

/** Centered pending indicator for a section. Use Skeleton when the layout is known. */
export const LoadingState: React.FC<Props> = ({ label = 'Loading…', className }) => (
  <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-zinc-400', className)}>
    <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
    <span>{label}</span>
  </div>
);
