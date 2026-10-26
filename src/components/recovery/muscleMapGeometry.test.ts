import { describe, expect, it } from 'vitest';
import { MUSCLE_REGIONS, regionsForView, type BodyView } from '../../utils/muscleMap';
import { PARTS_BY_VIEW, SILHOUETTE, regionsInGeometry } from './muscleMapGeometry';
import { LEGEND_ORDER, STATUS_EXPLANATIONS, STATUS_VISUALS } from './muscleMapStyles';
import { LOAD_STATUS_LABELS } from '../../utils/muscleMap';

describe('muscle map geometry stays in sync with the canonical regions', () => {
  for (const view of ['front', 'back'] as BodyView[]) {
    it(`${view}: every svgPart of every region has a drawable path, and nothing else is drawn`, () => {
      for (const region of MUSCLE_REGIONS) {
        const expected = [...region.svgParts[view]].sort();
        const actual = PARTS_BY_VIEW[view].filter((p) => p.region === region.id).map((p) => p.key).sort();
        expect(actual, `${region.id} / ${view}`).toEqual(expected);
      }
    });
    it(`${view}: part keys are unique and paths are non-empty`, () => {
      const keys = PARTS_BY_VIEW[view].map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of PARTS_BY_VIEW[view]) expect(p.d.length).toBeGreaterThan(10);
    });
    it(`${view}: the set of drawn regions equals regionsForView`, () => {
      expect(regionsInGeometry(view).sort()).toEqual(regionsForView(view).map((r) => r.id).sort());
    });
  }
  it('has a non-interactive silhouette', () => {
    expect(SILHOUETTE.length).toBeGreaterThan(3);
  });
});

describe('status visuals', () => {
  const statuses = Object.keys(LOAD_STATUS_LABELS) as (keyof typeof STATUS_VISUALS)[];

  it('every status has a visual, an explanation and a legend entry', () => {
    for (const s of statuses) {
      expect(STATUS_VISUALS[s]).toBeDefined();
      expect(STATUS_EXPLANATIONS[s].length).toBeGreaterThan(20);
    }
    expect([...LEGEND_ORDER].sort()).toEqual([...statuses].sort());
  });

  it('colour is never the only signal: every status has a visually distinct combination of fill, outline and hatch', () => {
    const sig = statuses.map((s) => {
      const v = STATUS_VISUALS[s];
      return JSON.stringify([v.color, v.fillOpacity, v.strokeWidth, v.dash ?? 'solid', Boolean(v.hatch)]);
    });
    expect(new Set(sig).size).toBe(statuses.length);
    // statuses that share a hue still differ in texture (dash / hatch / opacity), not only in colour
    expect(STATUS_VISUALS.insufficient_data.hatch).toBe(true);
    expect(STATUS_VISUALS.insufficient_data.dash).toBeDefined();
  });

  it('never uses a green/"fresh" or red treatment for "no basis to compare", and never uses red anywhere', () => {
    const neutral = STATUS_VISUALS.insufficient_data;
    expect(neutral.color).not.toMatch(/accent|success|warning|danger|info/);
    expect(neutral.stroke).not.toMatch(/accent|success|warning|danger|info/);
    for (const s of statuses) {
      expect(JSON.stringify(STATUS_VISUALS[s])).not.toMatch(/danger|success|#ef4444|red/i);
    }
  });

  it('explanations use the real thresholds and avoid physiological-recovery wording', () => {
    expect(STATUS_EXPLANATIONS.lighter).toContain('75%');
    expect(STATUS_EXPLANATIONS.heavier).toContain('125%');
    expect(STATUS_EXPLANATIONS.typical).toContain('75%');
    for (const text of Object.values(STATUS_EXPLANATIONS)) {
      expect(text).not.toMatch(/recovered|fatigue|fresh|heal|injur|damage|risk|sore/i);
    }
  });
});
