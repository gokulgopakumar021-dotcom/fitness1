import { describe, expect, it } from 'vitest';
import {
  MUSCLE_REGIONS,
  MUSCLE_REGION_IDS,
  getRegion,
  getRegionLabel,
  isMuscleRegionId,
  regionsForView,
  viewsForRegion,
  type BodyView,
} from './regions';

describe('canonical muscle regions', () => {
  it('defines exactly the eight V1 regions with stable ids and the specified labels', () => {
    expect(MUSCLE_REGION_IDS).toEqual([
      'chest', 'back', 'shoulders', 'arms', 'core', 'quadriceps', 'hamstrings_glutes', 'calves',
    ]);
    expect(MUSCLE_REGIONS.map((r) => r.label)).toEqual([
      'Chest', 'Back / Lats', 'Shoulders', 'Arms', 'Core / Lower Back', 'Quadriceps', 'Hamstrings / Glutes', 'Calves',
    ]);
    expect(new Set(MUSCLE_REGION_IDS).size).toBe(8);
  });

  it('keeps ids independent of labels and in the same order as the region list', () => {
    expect(MUSCLE_REGIONS.map((r) => r.id)).toEqual([...MUSCLE_REGION_IDS]);
    for (const id of MUSCLE_REGION_IDS) {
      expect(getRegion(id).id).toBe(id);
      expect(getRegionLabel(id)).toBe(getRegion(id).label);
      expect(id).not.toBe(getRegionLabel(id));
    }
  });

  it('validates ids', () => {
    for (const id of MUSCLE_REGION_IDS) expect(isMuscleRegionId(id)).toBe(true);
    for (const bad of ['Chest', 'legs', '', null, undefined, 3, {}]) expect(isMuscleRegionId(bad)).toBe(false);
  });

  it('gives every region at least one drawable part in some view, and calves in both', () => {
    for (const r of MUSCLE_REGIONS) {
      expect(r.svgParts.front.length + r.svgParts.back.length).toBeGreaterThan(0);
      expect(viewsForRegion(r.id).length).toBeGreaterThan(0);
    }
    expect(viewsForRegion('calves')).toEqual(['front', 'back']);
  });

  it('never assigns one svg part key to two different regions within a view', () => {
    for (const view of ['front', 'back'] as BodyView[]) {
      const owner = new Map<string, string>();
      for (const r of MUSCLE_REGIONS) {
        for (const part of r.svgParts[view]) {
          expect(owner.get(part) ?? r.id).toBe(r.id);
          owner.set(part, r.id);
        }
      }
    }
  });

  it('lists which regions are visible per view (so the UI can say where to find the rest)', () => {
    expect(regionsForView('front').map((r) => r.id)).toEqual(['chest', 'shoulders', 'arms', 'core', 'quadriceps', 'calves']);
    expect(regionsForView('back').map((r) => r.id)).toEqual(['back', 'shoulders', 'arms', 'core', 'hamstrings_glutes', 'calves']);
    // every region is reachable from at least one view
    const all = new Set([...regionsForView('front'), ...regionsForView('back')].map((r) => r.id));
    expect(all.size).toBe(8);
  });
});
