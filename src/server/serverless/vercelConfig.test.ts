// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_EXTERNALS } from '../../../scripts/bundle-api.mjs';
import { LEGAL_ROUTE_LIST } from '../../legal/routes';

/**
 * Stage 3.8 guards. They pin what vercel.json and package.json are allowed to say so that nothing broad, invented or
 * environment-specific slips in: owner decisions are pinned here: Node 24.x, maxDuration 120 s. The region is hnd1 (Tokyo), matching Supabase
 * ap-northeast-1; the Upstash database must be created in the same AWS region.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const vercel = readJson('vercel.json');
const pkg = readJson('package.json');

describe('vercel.json (Stage 3.8)', () => {
  it('has only the keys this stage allows: no framework, build, output, install, header, redirect or routes override', () => {
    const allowed = ['rewrites', 'functions', 'regions', '$schema'];
    expect(Object.keys(vercel).filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('has exactly one API rewrite (/api and /api/* to the single api function, with the reserved parameter), listed first; no SPA fallback', () => {
    expect(vercel.rewrites[0]).toEqual({ source: '/api/:__ironlog_api_path*', destination: '/api' });
    expect(vercel.rewrites.filter((r: { source: string }) => r.source.startsWith('/api'))).toHaveLength(1);
  });

  it('the only other rewrites are the five exact legal-page paths (Stage 2B), each to /index.html, and they match the app route table', () => {
    const rest = vercel.rewrites.slice(1);
    expect(rest).toEqual(['/privacy', '/terms', '/refund-policy', '/cancellation-policy', '/contact'].map((source) => ({ source, destination: '/index.html' })));
    expect(LEGAL_ROUTE_LIST.map((r) => r.path)).toEqual(rest.map((r: { source: string }) => r.source));
    expect(vercel.rewrites.some((r: { source: string }) => /[*:()?+]/.test(r.source) && !r.source.startsWith('/api/'))).toBe(false);
  });

  it('configures only api/index.js, with the owner-decided maxDuration of 120 s and nothing else', () => {
    expect(vercel.functions).toEqual({ 'api/index.js': { maxDuration: 120 } });
  });

  it('runs the function in exactly one region, hnd1 (Tokyo), matching the Supabase project region ap-northeast-1; Upstash must be created in AWS ap-northeast-1 too', () => {
    expect(vercel.regions).toEqual(['hnd1']);
    expect(JSON.stringify(vercel.functions)).not.toMatch(/region|hnd1/i); // vercel.json takes regions at the top level only
  });

  it('the rewrite cannot capture the frontend: manifest, icons and the root are static files outside /api', () => {
    const src = String(vercel.rewrites[0].source);
    for (const p of ['/', '/manifest.webmanifest', '/brand/icon-512.png', '/favicon.ico', '/assets/index.js', '/some/spa/route']) {
      expect(p.startsWith('/api'), p).toBe(false);
    }
    expect(src.startsWith('/api')).toBe(true);
    for (const f of ['public/manifest.webmanifest', 'public/brand/icon-512.png', 'public/favicon.ico']) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
    }
  });
});

describe('package.json build settings (Stage 3.8)', () => {
  it('keeps the Vite build command unchanged and has no vercel-build script', () => {
    expect(pkg.scripts.build).toBe('vite build');
    expect(pkg.scripts['vercel-build']).toBeUndefined();
  });

  it('only api/index.js lives in api/, and VITE_API_BASE_URL stays unset in the repo (same-origin /api)', () => {
    const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/^#\s*VITE_API_BASE_URL=/m);
    expect(example).not.toMatch(/^VITE_API_BASE_URL=/m);
  });
});

describe('Node version floor (D-5 decided: 24.x)', () => {
  const BUNDLE_TARGET_MAJOR = 22; // scripts/bundle-api.mjs target: 'node22'

  const floorOf = (range: string | undefined): number => {
    const m = /(\d+)\./.exec(String(range ?? '').replace(/[^\d.]/g, ' ').trim());
    return m ? Number(m[1]) : 0;
  };

  it('no runtime package the function imports requires a newer Node major than the bundle target', () => {
    const floors: Record<string, number> = {};
    for (const name of ALLOWED_EXTERNALS as string[]) {
      const p = readJson(`node_modules/${name}/package.json`);
      floors[name] = floorOf(p.engines?.node);
    }
    expect(Math.max(...Object.values(floors))).toBeLessThanOrEqual(BUNDLE_TARGET_MAJOR);
    // supabase-js currently sets the floor: Node 20 is below it.
    expect(floors['@supabase/supabase-js']).toBeGreaterThanOrEqual(22);
  });

  it('package.json pins the owner-decided Node major (24.x), which is at or above the dependency floor', () => {
    expect(pkg.engines).toEqual({ node: '24.x' });
    expect(floorOf(pkg.engines.node)).toBeGreaterThanOrEqual(22);
  });
});
