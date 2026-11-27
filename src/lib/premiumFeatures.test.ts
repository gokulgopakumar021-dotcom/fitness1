import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS } from '../server/security/endpoints';
import { AI_ROUTES_WITHOUT_UI, isPremiumTab, PREMIUM_FEATURES, PREMIUM_TABS } from './premiumFeatures';

describe('premium feature registry', () => {
  const serverAiRoutes = Object.entries(ENDPOINTS)
    .filter(([, policy]) => policy.ai)
    .map(([key]) => '/api' + key.split(' ')[1])
    .sort();
  const listed = [...PREMIUM_FEATURES.flatMap((f) => f.routes), ...AI_ROUTES_WITHOUT_UI].sort();

  it('accounts for every server AI route exactly once, so a new gated route cannot ship without a UI decision', () => {
    expect(listed).toEqual(serverAiRoutes);
  });

  it('keeps the explicitly required premium features', () => {
    const routes = PREMIUM_FEATURES.flatMap((f) => f.routes);
    for (const r of ['/api/exercise-coach', '/api/ai-food-parser', '/api/generate-ai-routine', '/api/ai-generate-physique', '/api/ai-physique-analysis']) {
      expect(routes).toContain(r);
    }
  });

  it('treats only AI Coach, Workout Mirror and Video Library as premium tabs', () => {
    expect([...PREMIUM_TABS]).toEqual(['trainer', 'mirror', 'videos']);
    for (const premium of ['trainer', 'mirror', 'videos']) expect(isPremiumTab(premium)).toBe(true);
    for (const free of ['home', 'dashboard', 'workouts', 'nutrition', 'body', 'plans', 'progression', 'reports', 'timeline', 'settings']) expect(isPremiumTab(free)).toBe(false);
  });

  it('marks exactly the features no server route can enforce as ui-only (their lock is display only)', () => {
    const uiOnly = PREMIUM_FEATURES.filter((f) => f.enforcement === 'ui-only');
    expect(uiOnly.map((f) => f.id).sort()).toEqual(['body-scan', 'video-library', 'workout-mirror']);
    for (const f of uiOnly) expect(f.routes).toEqual([]);
    for (const f of PREMIUM_FEATURES.filter((x) => x.enforcement !== 'ui-only')) expect(f.routes.length).toBeGreaterThan(0);
  });
});

describe('free areas are never gated', () => {
  const walk = (path: string): string[] =>
    statSync(path).isDirectory()
      ? readdirSync(path).flatMap((n) => walk(join(path, n)))
      : /\.(ts|tsx)$/.test(path) && !/\.test\./.test(path)
        ? [path]
        : [];

  // Premium locks live only at entry points (tabs, buttons). The camera/pose capture code and services never reference them, and
  // neither does anything in Settings, so deleting your own stored data (including Body Scan data) can never be locked.
  it.each(['src/components/bodyscan', 'src/components/settings/DataControls.tsx', 'src/services'])('%s does not import premium locks', (dir) => {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/EntitlementContext|PremiumLock|premiumFeatures/);
    }
  });
});
