import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover font-semibold',
  secondary: 'bg-surface-2 text-zinc-100 border border-line-strong hover:bg-surface-3 hover:border-zinc-600 font-medium',
  ghost: 'text-zinc-300 hover:text-white hover:bg-surface-2 font-medium',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 font-medium',
};
// md/lg keep >=44px touch targets on phones
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex items-center justify-center rounded-xl transition-colors select-none touch-press',
      'disabled:opacity-50 disabled:pointer-events-none',
      VARIANTS[variant],
      SIZES[size],
      fullWidth && 'w-full',
      className
    )}
    {...rest}
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
    {children}
  </button>
);
