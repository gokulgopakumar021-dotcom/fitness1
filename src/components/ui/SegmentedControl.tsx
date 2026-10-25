import React from 'react';
import { cn } from './cn';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, className }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex p-1 gap-1 rounded-xl bg-surface-2 border border-line max-w-full overflow-x-auto', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-9 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors',
              active ? 'bg-surface-3 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
