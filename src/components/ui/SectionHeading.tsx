import React from 'react';
import { cn } from './cn';

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  level?: 2 | 3;
}

/** Heading for a section inside a page. */
export const SectionHeading: React.FC<Props> = ({ title, description, action, className, level = 2 }) => {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('flex items-end justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <H className="text-base font-semibold text-white tracking-tight">{title}</H>
        {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
