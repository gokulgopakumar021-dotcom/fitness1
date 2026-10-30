import React, { useEffect, useRef } from 'react';
import { cn } from './cn';

export interface SectionNavItem<T extends string> {
  id: T;
  label: string;
  /** Shown on desktop only, where the nav is a vertical list. */
  icon?: React.ReactNode;
}

interface Props<T extends string> {
  items: SectionNavItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * In-page category navigation. A horizontally scrollable pill row on phones (the active pill is kept in view),
 * a vertical list from `lg` up. Buttons only switch the visible panel; they never change the URL.
 */
export function SectionNav<T extends string>({ items, value, onChange, ariaLabel, className }: Props<T>) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [value]);

  return (
    <nav aria-label={ariaLabel} className={cn('min-w-0', className)}>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:flex-col lg:gap-1 lg:overflow-visible">
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onChange(item.id)}
              className={cn(
                'shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full border text-sm font-medium whitespace-nowrap transition-colors touch-press',
                'lg:w-full lg:h-11 lg:px-3 lg:rounded-control lg:border-transparent lg:justify-start',
                active
                  ? 'bg-surface-3 text-white border-line-strong lg:bg-surface-2'
                  : 'text-zinc-400 border-line hover:text-white lg:hover:bg-surface-2'
              )}
            >
              {item.icon && (
                <span className={cn('hidden lg:inline-flex', active ? 'text-volt-adaptive' : 'text-zinc-500')} aria-hidden>
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
