/** Tiny class-name joiner (no dependency). Falsy values are dropped. */
export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
