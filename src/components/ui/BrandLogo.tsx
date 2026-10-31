import React from 'react';
import { BRAND } from '../../brand';
import { cn } from './cn';

/**
 * Official IRONLOG AI logo.
 *
 * Variants (all derived from the supplied logo, never redrawn):
 *  - `full`     emblem + wordmark + tagline  — hero / auth / splash / landing
 *  - `lockup`   emblem + wordmark            — mid-size headers and footers
 *  - `wordmark` wordmark only                — wide, short slots
 *  - `emblem`   emblem only                  — compact slots (nav, badges)
 *
 * Aspect ratio is always preserved: size it with a height class (e.g. `h-8`) and the width follows.
 * The artwork has white/silver parts, so on the light theme it sits on a dark brand plate
 * (see `.brand-logo` in index.css).
 */
export type BrandLogoVariant = 'full' | 'lockup' | 'wordmark' | 'emblem';

const ASSETS: Record<BrandLogoVariant, { src: string; width: number; height: number }> = {
  full: { src: '/brand/ironlog-ai-logo-full-transparent.png', width: 1280, height: 665 },
  lockup: { src: '/brand/ironlog-ai-logo-lockup-transparent.png', width: 1280, height: 602 },
  wordmark: { src: '/brand/ironlog-ai-wordmark-transparent.png', width: 1264, height: 172 },
  emblem: { src: '/brand/ironlog-ai-emblem-transparent.png', width: 648, height: 370 },
};

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  /** Decorative use (the brand name is already in adjacent text). */
  decorative?: boolean;
  /** Load eagerly (above the fold). */
  eager?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'full', className, decorative = false, eager = false }) => {
  const a = ASSETS[variant];
  return (
    <img
      src={a.src}
      width={a.width}
      height={a.height}
      alt={decorative ? '' : `${BRAND.name} — ${BRAND.tagline}`}
      aria-hidden={decorative || undefined}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={cn('brand-logo block w-auto max-w-full object-contain select-none', className)}
    />
  );
};

/** Compact square-ish brand mark for nav bars and badges. */
export const BrandEmblem: React.FC<{ className?: string }> = ({ className }) => (
  <BrandLogo variant="emblem" decorative className={cn('h-8', className)} />
);

export default BrandLogo;
