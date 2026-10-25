import React from 'react';
import { cn } from './cn';

type CardTone = 'default' | 'raised' | 'accent' | 'ghost';
type CardPad = 'none' | 'sm' | 'md' | 'lg';

const TONES: Record<CardTone, string> = {
  default: 'bg-surface border border-line',
  raised: 'bg-surface-2 border border-line-strong',
  accent: 'bg-surface border border-accent/30',
  ghost: 'bg-transparent border border-line border-dashed',
};
const PADS: Record<CardPad, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  pad?: CardPad;
  as?: 'div' | 'section' | 'article';
}

/** Standard surface. One radius, one border treatment, no decorative shadow. */
export const Card: React.FC<CardProps> = ({
  tone = 'default',
  pad = 'md',
  as: Tag = 'div',
  className,
  children,
  ...rest
}) => (
  <Tag className={cn('rounded-2xl min-w-0', TONES[tone], PADS[pad], className)} {...rest}>
    {children}
  </Tag>
);
