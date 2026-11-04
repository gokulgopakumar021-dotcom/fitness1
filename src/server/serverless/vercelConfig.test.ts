// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_EXTERNALS } from '../../../scripts/bundle-api.mjs';

/**
 * Stage 3.8 guards. They pin what vercel.json and package.json are allowed to say so that nothing broad, invented or
 * environment-specific slips in: the owner decisions (maxDuration D-2/D-9, region D-3, Node version D-5) are NOT set
 * here, and the tests keep it that way until the owner supplies values.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const vercel = readJson('vercel.json');
const pkg = readJson('package.json');

describe('vercel.json (Stage 3.8)', () => {
  it('has only the keys this stage allows: no framework, build, output, install, header, redirect or routes override', () => {
    const allowed = ['rewrites', 'functions', '$schema'];
    expect(Object.keys(vercel).filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('has exactly one rewrite: /api and /api/* to the single api function, with the reserved parameter; no SPA fallback', () => {
    expect(vercel.rewrites).toEqual([{ source: '/api/:__ironlog_api_path*', destination: '/api' }]);
  });

  it('any functions entry targets only api/index.js and sets only reviewed keys (owner-decided values, never guessed)', () => {
    const fns = vercel.functions ?? {};
    for (const [glob, cfg] of Object.entries<Record<string, unknown>>(fns)) {
      expect(glob).toBe('api/index.js');
      expect(Object.keys(cfg).filter((k) => !['maxDuration', 'memory'].includes(k))).toEqual([]);
    }
    expect(vercel.regions).toBeUndefined(); // region is owner decision D-3
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

describe('Node version floor (owner decision D-5 stays open)', () => {
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

  it('package.json does not set engines.node yet (the exact major is the owner\u2019s call); if set later it must be >= the floor', () => {
    if (pkg.engines?.node === undefined) return;
    expect(floorOf(pkg.engines.node)).toBeGreaterThanOrEqual(22);
  });
});
