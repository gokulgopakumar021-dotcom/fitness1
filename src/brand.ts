/**
 * IRONLOG AI brand constants. Single source of truth for user-facing brand copy.
 * Internal identifiers (localStorage / IndexedDB keys `ironlog_*`, class names, file names)
 * intentionally keep the `ironlog` prefix so existing user data keeps loading.
 */
export const BRAND = {
  name: 'IRONLOG AI',
  /** Title-case form for running prose, e.g. "IronLog AI needs camera access". */
  proseName: 'IronLog AI',
  shortName: 'IronLog',
  tagline: 'TRAIN SMARTER. BUILD STRONGER.',
  description: 'AI-Powered Fitness & Personal Training Platform',
  metaDescription:
    'IRONLOG AI is an AI-powered fitness and personal training platform: strength tracking, progressive overload, nutrition, recovery, Workout Mirror and Body Scan.',
} as const;
