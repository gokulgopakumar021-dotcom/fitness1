import React from 'react';
import { cn } from './cn';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<Props> = ({ icon, title, description, action, className }) => (
  <div className={cn('flex flex-col items-center text-center gap-3 py-10 px-6 rounded-card border border-dashed border-line', className)}>
    {icon && (
      <div className="w-11 h-11 rounded-control bg-surface-2 border border-line flex items-center justify-center text-zinc-400" aria-hidden>
        {icon}
      </div>
    )}
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">{description}</p>}
    </div>
    {action}
  </div>
);
