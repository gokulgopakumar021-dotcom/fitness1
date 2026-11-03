// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * IL-05. `npm audit` flags glob (GHSA-3g3m-2fjr-6pw4, fixed in 14.0.2) and minimatch (GHSA-g3hv-75wg-m249, fixed in
 * 11.0.1), reached only through @capacitor/cli -> rimraf -> glob -> minimatch (dev dependencies). No @capacitor/cli
 * release fixes the chain, so package.json carries `overrides` and the lockfile resolves the fixed versions.
 * This test is a tripwire for that decision: it fails if the overrides are removed or the lockfile goes back to a
 * vulnerable version. It does not replace `npm audit`; it needs no network. See docs/security/dependency-overrides.md.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { overrides?: Record<string, string> };
const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean }> };

const MIN_FIXED: Record<string, string> = { glob: '14.0.2', minimatch: '11.0.1' };
const parse = (v: string) => v.split('-')[0].split('.').map(Number);
const atLeast = (v: string, min: string) => {
  const a = parse(v);
  const b = parse(min);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
/** Every installed copy of a package in the lockfile (top-level and nested). */
const copies = (name: string) =>
  Object.entries(lock.packages)
    .filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`))
    .map(([k, v]) => ({ path: k, version: v.version ?? '0.0.0' }));

describe('IL-05 dev-dependency advisory overrides', () => {
  it('the version comparison helper behaves', () => {
    expect(atLeast('14.0.3', '14.0.2')).toBe(true);
    expect(atLeast('14.0.2', '14.0.2')).toBe(true);
    expect(atLeast('14.0.1', '14.0.2')).toBe(false);
    expect(atLeast('13.0.6', '14.0.2')).toBe(false);
    expect(atLeast('11.0.0', '11.0.1')).toBe(false);
    expect(atLeast('10.2.6', '11.0.1')).toBe(false);
    expect(atLeast('12.0.0', '11.0.1')).toBe(true);
  });

  it('package.json overrides glob and minimatch to a fixed range', () => {
    expect(pkg.overrides?.glob).toBeDefined();
    expect(pkg.overrides?.minimatch).toBeDefined();
    for (const name of Object.keys(MIN_FIXED)) {
      const floor = /^\^(\d+\.\d+\.\d+)$/.exec(pkg.overrides![name]);
      expect(floor, `${name} override must be a caret range such as ^14.0.3`).not.toBeNull();
      expect(atLeast(floor![1], MIN_FIXED[name]), `${name} override floor is below the fixed version`).toBe(true);
    }
  });

  it('every glob and minimatch copy in the lockfile is at or above the fixed version', () => {
    for (const [name, min] of Object.entries(MIN_FIXED)) {
      const found = copies(name);
      expect(found.length, `no ${name} in the lockfile (if the dependency chain was removed, delete this test and the override)`).toBeGreaterThan(0);
      for (const c of found) expect(atLeast(c.version, min), `${c.path} is ${c.version}, needs >= ${min}`).toBe(true);
    }
  });

  it('the overridden packages stay dev-only (a production dependency on them needs a fresh look)', () => {
    for (const name of Object.keys(MIN_FIXED)) for (const c of copies(name)) expect(lock.packages[c.path].dev, `${c.path} is no longer dev-only`).toBe(true);
  });
});
