import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name (and tooltip) of the close button. */
  closeLabel?: string;
}

const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/**
 * Accessible dialog. Bottom sheet on phones, centered panel on larger screens.
 * Closes on Escape and backdrop click, locks body scroll, restores focus.
 */
export const Modal: React.FC<Props> = ({ open, onClose, title, description, children, footer, size = 'md', closeLabel = 'Close' }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-running the focus/scroll-lock effect: callers often pass an
  // inline arrow, and re-running on every parent render would steal focus from inputs mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm il-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative w-full max-h-[90dvh] flex flex-col bg-surface border border-line-strong shadow-2xl il-sheet-up',
          'rounded-t-sheet sm:rounded-card outline-none',
          SIZES[size]
        )}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-white tracking-tight">{title}</h2>
            {description && <p className="text-sm text-zinc-400 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel === 'Close' ? undefined : closeLabel}
            className="w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-control text-zinc-400 hover:text-white hover:bg-surface-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div className="p-4 border-t border-line flex gap-2 justify-end" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
