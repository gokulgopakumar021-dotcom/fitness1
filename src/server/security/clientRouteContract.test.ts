import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS, resolvePolicy } from './endpoints';

/**
 * Contract: every `/api/...` path the client calls must be a route that server.ts registers AND a path the
 * security layer has a policy for (unlisted paths are rejected with 404 after authentication).
 * Regression guard for FN-01 (client called /api/ai-exercise-coach; server only had /api/exercise-coach).
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const root = process.cwd();
const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8');
const serverRoutes = [...serverSrc.matchAll(/app\.(get|post|put|delete|patch)\(\s*'(\/api\/[^']*)'/g)].map((m) => ({
  method: m[1].toUpperCase(),
  path: m[2]
}));

const clientCalls: { file: string; path: string }[] = [];
for (const file of walk(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/apiFetch\(\s*(['`])(\/api\/[^'`$?]*)/g)) {
    clientCalls.push({ file: file.replace(root, ''), path: m[2] });
  }
}

// A trailing slash means the call was a template literal cut at `${...}`: treat it as one dynamic segment.
const concrete = (path: string) => (path.endsWith('/') ? path + 'x' : path);

const matchesServerRoute = (path: string) =>
  serverRoutes.some((r) => new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$').test(concrete(path)));

describe('client → server route contract', () => {
  it('finds client call sites and server routes (guards against the scan silently matching nothing)', () => {
    expect(clientCalls.length).toBeGreaterThanOrEqual(14);
    expect(serverRoutes.length).toBeGreaterThanOrEqual(17);
  });

  it.each(clientCalls)('$file calls $path which server.ts registers', ({ path }) => {
    expect(matchesServerRoute(path)).toBe(true);
  });

  it.each(clientCalls)('$path has a security policy ($file)', ({ path }) => {
    const apiPath = concrete(path).replace(/^\/api/, '');
    const method = apiPath.startsWith('/nutrition/barcode/') ? 'GET' : 'POST';
    expect(resolvePolicy(method, apiPath)).toBeDefined();
  });

  it('every AI endpoint with a policy is registered in server.ts', () => {
    for (const key of Object.keys(ENDPOINTS)) {
      const [method, path] = key.split(' ');
      expect(serverRoutes.some((r) => r.method === method && r.path === `/api${path}`), key).toBe(true);
    }
  });
});
