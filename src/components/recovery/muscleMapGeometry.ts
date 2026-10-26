import type { BodyView, MuscleRegionId } from '../../utils/muscleMap';

/**
 * SVG geometry for the muscle map (viewBox 0 0 160 300).
 *
 * Proportions are adapted from the older, unmounted AnatomicalHeatmap, used as a visual reference only.
 * The figure is a simplified illustration: it makes no claim of anatomical precision. Every drawable
 * part has a stable key that matches `MUSCLE_REGIONS[].svgParts` in the data layer, so a region and its
 * parts cannot drift apart (this is enforced by a test).
 */

export const VIEWBOX = '0 0 160 300';
/** Mirrors a left-side path onto the right side of the figure. */
export const MIRROR_TRANSFORM = 'translate(160 0) scale(-1 1)';

export interface GeometryPart {
  /** Matches an entry of `svgParts` for the region in this view. */
  key: string;
  region: MuscleRegionId;
  /** Path data. For `mirror: true` this is the figure's LEFT side; the right side is rendered mirrored. */
  d: string;
  mirror: boolean;
}

const DELT = 'M56 56 Q48 60 46 72 Q54 75 58 66 Z';
const UPPER_ARM = 'M45 74 Q42 88 44 102 Q50 102 52 88 Z';
const FOREARM = 'M43 104 Q39 122 41 140 Q47 140 48 122 Z';
const CALF = 'M64 224 Q60 250 65 278 Q73 278 74 250 Z';

export const FRONT_PARTS: readonly GeometryPart[] = [
  { key: 'front-delts', region: 'shoulders', d: DELT, mirror: true },
  { key: 'chest', region: 'chest', d: 'M58 58 L78 60 L78 82 Q66 84 58 74 Z', mirror: true },
  { key: 'biceps', region: 'arms', d: UPPER_ARM, mirror: true },
  { key: 'forearms', region: 'arms', d: FOREARM, mirror: true },
  { key: 'abs', region: 'core', d: 'M66 86 L94 86 L92 128 L68 128 Z', mirror: false },
  { key: 'obliques', region: 'core', d: 'M59 88 L65 88 L67 126 L62 118 Z', mirror: true },
  { key: 'quads', region: 'quadriceps', d: 'M64 144 Q60 178 64 210 Q76 210 78 178 Q78 152 74 144 Z', mirror: true },
  { key: 'calves-front', region: 'calves', d: CALF, mirror: true },
];

export const BACK_PARTS: readonly GeometryPart[] = [
  { key: 'upper-back', region: 'back', d: 'M60 52 L100 52 L92 84 L68 84 Z', mirror: false },
  { key: 'lats', region: 'back', d: 'M64 80 L96 80 L88 116 L72 116 Z', mirror: false },
  { key: 'rear-delts', region: 'shoulders', d: DELT, mirror: true },
  { key: 'triceps', region: 'arms', d: UPPER_ARM, mirror: true },
  { key: 'forearms', region: 'arms', d: FOREARM, mirror: true },
  { key: 'lower-back', region: 'core', d: 'M72 116 L88 116 L86 134 L74 134 Z', mirror: false },
  { key: 'glutes', region: 'hamstrings_glutes', d: 'M64 134 L96 134 Q98 158 80 162 Q62 158 64 134 Z', mirror: false },
  { key: 'hamstrings', region: 'hamstrings_glutes', d: 'M64 164 Q60 188 66 210 Q76 210 78 188 Q76 168 74 164 Z', mirror: true },
  { key: 'calves-back', region: 'calves', d: CALF, mirror: true },
];

export const PARTS_BY_VIEW: Readonly<Record<BodyView, readonly GeometryPart[]>> = {
  front: FRONT_PARTS,
  back: BACK_PARTS,
};

/** Non-interactive body outline pieces (head, neck, pelvis, joints, hands, feet). */
export const SILHOUETTE: readonly { d: string; mirror: boolean }[] = [
  { d: 'M80 15 C87 15 92 20 92 28 C92 36 86 42 80 42 C74 42 68 36 68 28 C68 20 73 15 80 15 Z', mirror: false },
  { d: 'M76 42 L84 42 L84 52 L76 52 Z', mirror: false },
  { d: 'M66 128 L94 128 L96 142 L64 142 Z', mirror: false },
  { d: 'M64 211 Q64 222 69 223 Q74 222 74 211 Z', mirror: true },
  { d: 'M40 141 Q38 150 42 153 Q47 151 47 141 Z', mirror: true },
  { d: 'M64 279 Q62 290 70 291 Q76 290 74 279 Z', mirror: true },
];

/** Distinct region ids that have at least one part in the view. */
export function regionsInGeometry(view: BodyView): MuscleRegionId[] {
  return [...new Set(PARTS_BY_VIEW[view].map((p) => p.region))];
}
