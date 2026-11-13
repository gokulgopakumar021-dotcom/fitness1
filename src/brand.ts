/**
 * Iron Log AI brand constants. Single source of truth for user-facing brand copy.
 * Approved public spelling (owner decision, Stage 2D): "Iron Log AI" (three words, title case).
 * `wordmark` is the same spelling in capitals, for styled logo/eyebrow text only.
 * Internal identifiers (localStorage / IndexedDB keys `ironlog_*`, the ironlog.app domain, class names, file names)
 * intentionally keep the `ironlog` prefix so existing user data keeps loading.
 */
export const BRAND = {
  name: 'Iron Log AI',
  /** Title-case form for running prose, e.g. "Iron Log AI needs camera access". */
  proseName: 'Iron Log AI',
  /** Capitals form for styled wordmarks and eyebrow labels. Same spelling as `name`. */
  wordmark: 'IRON LOG AI',
  /** Home-screen label (11 characters). */
  shortName: 'Iron Log AI',
  tagline: 'TRAIN SMARTER. BUILD STRONGER.',
  description: 'AI-Powered Fitness & Personal Training Platform',
  metaDescription:
    'Iron Log AI is an AI-powered fitness and personal training platform: strength tracking, progressive overload, nutrition, recovery, Workout Mirror and Body Scan.',
} as const;
