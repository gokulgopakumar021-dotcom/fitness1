// @vitest-environment node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createApp as createAppViaServerEntry } from '../../server';
import { MemoryRateStore } from './security/rateLimit';
import { testConfig } from './security/testUtils';

/**
 * Stage 3.1 acceptance: `src/server/app.ts` is the side-effect-free application module reused by the Vercel Function.
 * Importing it must not start a listener, timer, signal handler, Redis connection or Vite, and it must not pull the
 * local runner (`server.ts`) into its import graph.
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'src/server/app.ts');

/** Relative import specifiers (static `from '...'` and side-effect `import '...'`) of a TypeScript source file. */
function relativeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specs.filter((s) => s.startsWith('.'));
}

function bareImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specs.filter((s) => !s.startsWith('.') && !s.startsWith('node:'));
}

function resolveTs(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Every source file reachable from `entry` through relative imports. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of relativeImports(file)) {
      const resolved = resolveTs(file, spec);
      if (resolved && resolved.endsWith('.ts')) stack.push(resolved);
    }
  }
  return [...seen];
}

describe('src/server/app.ts import graph (static)', () => {
  const graph = importGraph(APP);
  const rel = (f: string) => path.relative(ROOT, f);

  it('does not import the local runner, Vite, dotenv or Node path/process helpers for serving', () => {
    expect(graph.map(rel)).not.toContain('server.ts');
    for (const file of graph) {
      const bare = bareImports(file);
      expect({ file: rel(file), vite: bare.some((s) => s === 'vite' || s.startsWith('vite/')) }).toEqual({ file: rel(file), vite: false });
      expect({ file: rel(file), dotenv: bare.includes('dotenv') }).toEqual({ file: rel(file), dotenv: false });
    }
  });

  it('contains no listener, signal handler, process exit or module-level timer in app.ts itself', () => {
    const src = readFileSync(APP, 'utf8');
    expect(src).not.toMatch(/\.listen\s*\(/);
    expect(src).not.toMatch(/process\.(exit|on|once)\s*\(/);
    expect(src).not.toMatch(/^\s*(setInterval|setTimeout)\s*\(/m);
    expect(src).not.toMatch(/prepareSecurityRuntime|createViteServer|dotenv/);
  });
});

describe('src/server/app.ts import (runtime)', () => {
  it('importing the module in a fresh Node process creates no listener or handle: the process exits by itself, with no signal handlers', async () => {
    const script = [
      `const before = { sigterm: process.listenerCount('SIGTERM'), sigint: process.listenerCount('SIGINT'), exit: process.listenerCount('exit') };`,
      `const m = await import(${JSON.stringify(pathToFileURL(APP).href)});`,
      `const after = { sigterm: process.listenerCount('SIGTERM'), sigint: process.listenerCount('SIGINT'), exit: process.listenerCount('exit') };`,
      `console.log('RESULT ' + JSON.stringify({ hasCreateApp: typeof m.createApp === 'function', before, after }));`
    ].join('\n');
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: ROOT,
      // No env at all: nothing may read a secret or connect somewhere at import time.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const outcome = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ code: null, timedOut: true });
      }, 25_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut: false });
      });
    });
    // A leaked listener/timer/socket would keep the process alive until the timeout.
    expect({ timedOut: outcome.timedOut, code: outcome.code, stderr }).toEqual({ timedOut: false, code: 0, stderr: '' });
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
    expect(line).toBeDefined();
    const result = JSON.parse(line!.slice('RESULT '.length));
    expect(result.hasCreateApp).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(stdout).not.toMatch(/listening/);
  }, 40_000);

  it('server.ts still re-exports the very same createApp (existing importers keep working)', () => {
    expect(createAppViaServerEntry).toBe(createApp);
  });
});

describe('createApp route inventory (all 17 routes preserved)', () => {
  const EXPECTED = [
    'GET /api/health',
    'POST /api/extract-plan',
    'POST /api/generate-plan',
    'POST /api/exercise-coach',
    'POST /api/generate-ai-routine',
    'GET /api/nutrition/barcode/:barcode',
    'POST /api/ai-food-parser',
    'POST /api/ai-workout-insights',
    'POST /api/ai-plan-overload-tuning',
    'POST /api/ai-nutrition-coach',
    'POST /api/ai-recovery-insights',
    'POST /api/ai-personal-trainer',
    'POST /api/adaptive-coach/explain',
    'POST /api/ai-form-analyzer',
    'POST /api/ai-warmup-generator',
    'POST /api/ai-generate-physique',
    'POST /api/ai-physique-analysis'
  ];

  it('registers exactly the 17 documented method+path pairs', () => {
    const app = createApp({ config: testConfig(), rateStore: new MemoryRateStore() });
    const stack: any[] = (app as any)._router.stack;
    const registered = stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));
    // The original 17 routes are unchanged. Billing routes (Stage 2) are added and pinned separately below.
    const original = registered.filter((r) => !r.includes('/api/billing/'));
    expect(original.sort()).toEqual([...EXPECTED].sort());
    expect(original).toHaveLength(17);
    expect(registered.filter((r) => r.includes('/api/billing/')).sort()).toEqual([
      'GET /api/billing/payments', 'GET /api/billing/status', 'POST /api/billing/subscriptions', 'POST /api/billing/subscriptions/cancel',
      'POST /api/billing/subscriptions/verify', 'POST /api/billing/webhook'
    ]);
  });
});
