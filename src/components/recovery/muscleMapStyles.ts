import {
  HEAVIER_ABOVE_RATIO,
  LIGHTER_BELOW_RATIO,
  MIN_USABLE_BASELINE_WEEKS,
  CURRENT_PERIOD_DAYS,
  type LoadStatus,
} from '../../utils/muscleMap';

/**
 * Visual encoding per training-load status. Colour is NEVER the only signal: every status also has a
 * distinct fill treatment (hatch / hollow / light / medium / solid) and stroke style, and the text label
 * is always shown next to it (region list, legend, accessible names, detail panel).
 *
 * Colour choices: neutral grey for "no basis to compare", cool (info) for lighter, accent for typical,
 * amber (warning) for heavier. Red is deliberately not used (this is not a warning).
 */
export interface StatusVisual {
  /** CSS colour (a design-token reference) used for the fill. */
  color: string;
  fillOpacity: number;
  /** CSS colour for the outline. */
  stroke: string;
  strokeWidth: number;
  /** SVG stroke-dasharray, or undefined for a solid outline. */
  dash?: string;
  /** Overlay the diagonal-hatch pattern (used to say "not enough data" without a colour). */
  hatch?: boolean;
}

export const STATUS_VISUALS: Readonly<Record<LoadStatus, StatusVisual>> = {
  insufficient_data: { color: 'var(--bg-surface-3)', fillOpacity: 1, stroke: 'var(--text-muted)', strokeWidth: 1.25, dash: '3 2', hatch: true },
  no_recent_work: { color: 'var(--text-muted)', fillOpacity: 0.1, stroke: 'var(--text-muted)', strokeWidth: 1.25 },
  no_baseline: { color: 'var(--accent)', fillOpacity: 0.18, stroke: 'var(--accent)', strokeWidth: 1.5, dash: '1 2' },
  lighter: { color: 'var(--info)', fillOpacity: 0.4, stroke: 'var(--info)', strokeWidth: 1.25 },
  typical: { color: 'var(--accent)', fillOpacity: 0.55, stroke: 'var(--accent)', strokeWidth: 1.25 },
  heavier: { color: 'var(--warning)', fillOpacity: 0.75, stroke: 'var(--warning)', strokeWidth: 2 },
};

const pct = (r: number) => Math.round(r * 100);

/** One-sentence plain-language meaning of each status. Derived from the same constants the maths uses. */
export const STATUS_EXPLANATIONS: Readonly<Record<LoadStatus, string>> = {
  insufficient_data: `Not enough logged history yet to compare. A comparison needs about 3 weeks of logged workouts (the last ${CURRENT_PERIOD_DAYS} days plus ${MIN_USABLE_BASELINE_WEEKS} earlier weeks).`,
  no_recent_work: `No working sets logged for this region in the last ${CURRENT_PERIOD_DAYS} days.`,
  no_baseline: 'You logged work here recently, but there are no earlier weeks of work for this region to compare it with.',
  lighter: `Fewer working sets than your usual week (under ${pct(LIGHTER_BELOW_RATIO)}% of your recent weekly average).`,
  typical: `In line with your usual week (${pct(LIGHTER_BELOW_RATIO)}% to ${pct(HEAVIER_ABOVE_RATIO)}% of your recent weekly average).`,
  heavier: `More working sets than your usual week (over ${pct(HEAVIER_ABOVE_RATIO)}% of your recent weekly average).`,
};

/** Order used by the legend. */
export const LEGEND_ORDER: readonly LoadStatus[] = ['lighter', 'typical', 'heavier', 'no_recent_work', 'no_baseline', 'insufficient_data'];

/** The wording requested for the detail panel. */
export const DETAIL_DISCLAIMER = 'Training load reflects your logged workouts. It does not measure muscle recovery or diagnose injury.';
