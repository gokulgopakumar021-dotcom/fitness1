/**
 * Canonical regions for the Interactive Muscle Map (V1).
 *
 * IDs are stable and independent of display labels. The same IDs are used by the resolver,
 * the training-load utilities, the map and the detail panel.
 *
 * Granularity note: logged workouts do not reliably separate biceps from triceps or
 * hamstrings from glutes, so those pairs are single regions. Do not split them in the UI.
 */

export type BodyView = 'front' | 'back';

export const MUSCLE_REGION_IDS = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'core',
  'quadriceps',
  'hamstrings_glutes',
  'calves',
] as const;

export type MuscleRegionId = (typeof MUSCLE_REGION_IDS)[number];

export interface MuscleRegion {
  readonly id: MuscleRegionId;
  /** Human-readable label shown in the UI. */
  readonly label: string;
  /**
   * Stable SVG part keys that belong to this region, per body view. An empty array means the
   * region is not visible from that view (the UI should say which view shows it).
   */
  readonly svgParts: Readonly<Record<BodyView, readonly string[]>>;
}

export const MUSCLE_REGIONS: readonly MuscleRegion[] = [
  { id: 'chest', label: 'Chest', svgParts: { front: ['chest'], back: [] } },
  { id: 'back', label: 'Back / Lats', svgParts: { front: [], back: ['upper-back', 'lats'] } },
  { id: 'shoulders', label: 'Shoulders', svgParts: { front: ['front-delts'], back: ['rear-delts'] } },
  { id: 'arms', label: 'Arms', svgParts: { front: ['biceps', 'forearms'], back: ['triceps', 'forearms'] } },
  { id: 'core', label: 'Core / Lower Back', svgParts: { front: ['abs', 'obliques'], back: ['lower-back'] } },
  { id: 'quadriceps', label: 'Quadriceps', svgParts: { front: ['quads'], back: [] } },
  { id: 'hamstrings_glutes', label: 'Hamstrings / Glutes', svgParts: { front: [], back: ['glutes', 'hamstrings'] } },
  { id: 'calves', label: 'Calves', svgParts: { front: ['calves-front'], back: ['calves-back'] } },
];

const BY_ID: Readonly<Record<MuscleRegionId, MuscleRegion>> = Object.fromEntries(
  MUSCLE_REGIONS.map((r) => [r.id, r])
) as Record<MuscleRegionId, MuscleRegion>;

export function isMuscleRegionId(value: unknown): value is MuscleRegionId {
  return typeof value === 'string' && (MUSCLE_REGION_IDS as readonly string[]).includes(value);
}

export function getRegion(id: MuscleRegionId): MuscleRegion {
  return BY_ID[id];
}

export function getRegionLabel(id: MuscleRegionId): string {
  return BY_ID[id].label;
}

/** Regions that have at least one drawable part in the given view. */
export function regionsForView(view: BodyView): MuscleRegion[] {
  return MUSCLE_REGIONS.filter((r) => r.svgParts[view].length > 0);
}

/** The view(s) in which a region is visible, front first. */
export function viewsForRegion(id: MuscleRegionId): BodyView[] {
  const r = BY_ID[id];
  return (['front', 'back'] as const).filter((v) => r.svgParts[v].length > 0);
}
