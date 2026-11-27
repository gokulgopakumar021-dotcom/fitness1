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

  it('treats only the AI Coach tab as a premium tab', () => {
    expect([...PREMIUM_TABS]).toEqual(['trainer']);
    expect(isPremiumTab('trainer')).toBe(true);
    for (const free of ['home', 'dashboard', 'workouts', 'mirror', 'nutrition', 'body', 'plans', 'progression', 'videos', 'settings']) expect(isPremiumTab(free)).toBe(false);
  });
});

describe('free areas are never gated', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });

  // Local Body Scan camera/pose tracking, Workout Mirror and the camera/pose services must not reference the premium locks.
  it.each(['src/components/bodyscan', 'src/components/body', 'src/components/workoutMirror', 'src/services'])('%s does not import premium locks', (dir) => {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/EntitlementContext|PremiumLock|premiumFeatures/);
    }
  });
});
