import React from 'react';
import { cn } from './cn';

interface Props {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Consistent page title block: title, supporting copy, primary action. */
export const PageHeader: React.FC<Props> = ({ title, description, eyebrow, actions, className }) => (
  <header className={cn('flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5 sm:mb-6', className)}>
    <div className="min-w-0">
      {eyebrow && <p className="text-xs font-medium text-accent mb-1">{eyebrow}</p>}
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight">{title}</h1>
      {description && <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
  </header>
);
