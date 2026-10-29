import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from './cn';

interface Props {
  title?: string;
  description?: string;
  /** Typically a <Button variant="secondary"> retry. */
  action?: React.ReactNode;
  className?: string;
}

/** Recoverable-failure block. Pairs with EmptyState (no data) and LoadingState (pending). */
export const ErrorState: React.FC<Props> = ({ title = 'Something went wrong', description, action, className }) => (
  <div
    role="alert"
    className={cn('flex flex-col items-center text-center gap-3 py-10 px-6 rounded-card border border-danger/30 bg-danger/5', className)}
  >
    <div className="w-11 h-11 rounded-control bg-danger/10 border border-danger/30 flex items-center justify-center text-danger" aria-hidden>
      <AlertTriangle className="w-5 h-5" />
    </div>
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">{description}</p>}
    </div>
    {action}
  </div>
);
