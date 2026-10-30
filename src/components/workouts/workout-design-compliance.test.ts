import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guard for the workout tracker redesign: these files must stay on design-system tokens.
 * (No hex colours, no raw Tailwind palette colours, no one-off radii, no hard-coded shadows.)
 */
const FILES = [
  'src/components/workouts/WorkoutSessionTracker.tsx',
  'src/components/workouts/ExerciseCard.tsx',
  'src/components/workouts/SetRow.tsx',
  'src/components/common/RestTimer.tsx'
];
const read = (f: string) => readFileSync(f, 'utf8');

describe('workout tracker design-system compliance', () => {
  it.each(FILES)('%s has no hard-coded hex colours', (f) => {
    expect(read(f).match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it.each(FILES)('%s uses no raw palette colours (amber, sky, rose, lime, red, blue...)', (f) => {
    const raw = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline)-(?:amber|sky|rose|lime|emerald|red|blue|green|yellow|orange|purple|pink|slate|gray|neutral|cyan|teal|indigo|violet|fuchsia)-\d{2,3}/g;
    expect(read(f).match(raw)).toBeNull();
  });

  it.each(FILES)('%s uses only token radii (rounded-card / rounded-control / full)', (f) => {
    expect(read(f).match(/\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/g)).toBeNull();
  });

  it.each(FILES)('%s has no hard-coded rgba shadows or colours', (f) => {
    expect(read(f).match(/rgba?\(/g)).toBeNull();
  });

  it.each(FILES)('%s gates looping animations on motion preference', (f) => {
    const src = read(f);
    for (const m of src.matchAll(/(?<!motion-safe:)\banimate-(?:pulse|ping|spin|spin-slow|bounce)\b/g)) {
      // spinner components from the shared set are allowed elsewhere; none belong in these files
      throw new Error(`${f}: ungated animation "${m[0]}"`);
    }
  });
});
