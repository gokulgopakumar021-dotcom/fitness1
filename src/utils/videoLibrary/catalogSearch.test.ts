import { describe, expect, it } from 'vitest';
import type { ExerciseVideo } from '../../types/video';
import { buildCatalogIndex, searchCatalog } from './catalogSearch';

const EQUIP = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
const MOVES = ['curl', 'press', 'row', 'squat', 'raise', 'fly', 'extension', 'pulldown', 'lunge', 'deadlift'];
const MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'arms'];

function make(n: number): ExerciseVideo[] {
  return Array.from({ length: n }, (_, i) => {
    const equipment = EQUIP[i % EQUIP.length];
    const move = MOVES[(i >> 2) % MOVES.length];
    return {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      contentSha256: i.toString(16).padStart(64, '0'),
      originalFilename: `${equipment}_${move}_${i}.mp4`,
      title: `${equipment} ${move} variation ${i}`,
      exerciseKey: i % 7 === 0 ? `key-${i % 50}` : null,
      storageKey: `videos/x/${i}.mp4`,
      sizeBytes: 1_000_000 + i,
      durationSeconds: 5, width: 640, height: 360,
      equipment: [equipment], muscleGroups: [MUSCLES[i % MUSCLES.length]], tags: i % 3 === 0 ? ['compound'] : [],
      matchMethod: 'none', matchConfidence: 0, reviewStatus: i % 7 === 0 ? 'matched' : 'unmatched', status: 'uploaded', sortOrder: 0
    } as ExerciseVideo;
  });
}

describe('searchCatalog at library scale', () => {
  const N = 20_000;
  const records = make(N);
  const index = buildCatalogIndex(records);

  it('builds and answers text, prefix, key and attribute filters correctly', () => {
    const exact = searchCatalog(index, { text: 'barbell curl', limit: 100 });
    expect(exact.items.length).toBeGreaterThan(0);
    for (const v of exact.items) expect(v.title).toMatch(/barbell curl/);

    const prefix = searchCatalog(index, { text: 'barbell cu', limit: 100 });
    expect(prefix.items.map((v) => v.id)).toEqual(exact.items.map((v) => v.id));

    const byKey = searchCatalog(index, { exerciseKey: 'key-0', limit: 100 });
    for (const v of byKey.items) expect(v.exerciseKey).toBe('key-0');
    expect(byKey.items.length).toBe(records.filter((v) => v.exerciseKey === 'key-0').length);

    const combo = searchCatalog(index, { equipment: 'cable', muscleGroup: 'chest', tag: 'compound', limit: 100 });
    for (const v of combo.items) {
      expect(v.equipment).toContain('cable');
      expect(v.muscleGroups).toContain('chest');
      expect(v.tags).toContain('compound');
    }
    expect(searchCatalog(index, { text: 'zzzznothing' }).items).toEqual([]);
  });

  it('pages through every match exactly once, in order, with no duplicates', () => {
    const expected = records.filter((v) => v.equipment.includes('machine')).length;
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = searchCatalog(index, { equipment: 'machine', limit: 100, cursor });
      for (const v of page.items) { expect(seen.has(v.id)).toBe(false); seen.add(v.id); }
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen.size).toBe(expected);
    expect(pages).toBe(Math.ceil(expected / 100));
  });

  it('clamps the page size and stays fast across many queries', () => {
    expect(searchCatalog(index, { limit: 100000 }).items).toHaveLength(100);
    expect(searchCatalog(index, { limit: 0 }).items).toHaveLength(1);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) searchCatalog(index, { text: MOVES[i % MOVES.length], equipment: EQUIP[i % EQUIP.length], limit: 24 });
    expect(performance.now() - t0).toBeLessThan(3000); // generous bound; guards against accidental O(n^2) behaviour
  });
});
