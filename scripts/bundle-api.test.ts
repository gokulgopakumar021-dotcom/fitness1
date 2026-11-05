// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT, OUTFILE, buildApiBundle, inspectBundle, externalImports } from './bundle-api.mjs';

const BUNDLE = path.join(ROOT as string, OUTFILE as string);
// A clean child environment: no inherited secrets, no Redis, so the function must fail closed.
const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };
if (process.env.SystemRoot) cleanEnv.SystemRoot = process.env.SystemRoot; // Windows needs it for networking; it is not a secret
const readBundle = () => readFileSync(BUNDLE, 'utf8').replace(/\r\n/g, '\n');

function runNode(args: string[], timeoutMs = 20000) {
  return spawnSync(process.execPath, args, { cwd: ROOT as string, env: cleanEnv, encoding: 'utf8', timeout: timeoutMs });
}

describe('API bundle (Stage 3.7, esbuild B2)', () => {
  it('the committed api/index.js is up to date with its source (deterministic rebuild is byte-identical)', async () => {
    const a = await buildApiBundle();
    const b = await buildApiBundle();
    expect(a.code).toBe(b.code);
    expect(readBundle()).toBe(a.code);
  });

  it('passes inspection: no Vite, dotenv, local runner, UI code or test code; only runtime packages external', async () => {
    const built = await buildApiBundle();
    expect(inspectBundle(built)).toEqual([]);
    expect(externalImports(built.code)).toEqual(['@google/genai', '@supabase/supabase-js', 'express', 'helmet', 'node:crypto', 'redis']);
    expect(Object.keys(built.metafile.inputs).some((i) => /(^|\/)(vite|dotenv)(\/|$)/.test(i) || i === 'server.ts')).toBe(false);
  });

  it('inspection rejects a bundle that would pull in Vite, listen, handle signals or carry credentials', async () => {
    const built = await buildApiBundle();
    const bad = (extra: string) => inspectBundle({ code: `${built.code}\n${extra}\n`, metafile: built.metafile });
    expect(bad('import { createServer } from "vite";')).toContain('unexpected external import: vite');
    expect(bad('import "dotenv/config";')).toContain('unexpected external import: dotenv/config');
    expect(bad('app.listen(3000);')).toContain('calls .listen()');
    expect(bad("process.on('SIGTERM', f);")).toContain('process exit or signal handler');
    expect(bad('const k = "rediss://default:hunter2secret@host:6379";')).toContain('credential-looking string');
    const withServer = inspectBundle({ code: built.code, metafile: { inputs: { ...built.metafile.inputs, 'server.ts': {} } } });
    expect(withServer).toContain('forbidden source in bundle: server.ts');
  });

  it('does not embed environment values: a build with sentinel secrets in the environment is identical', async () => {
    const SENTINEL = 'sentinel-secret-value-9f3a1c';
    const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GEMINI_API_KEY', 'REDIS_URL'];
    const saved = keys.map((k) => process.env[k]);
    try {
      for (const k of keys) process.env[k] = SENTINEL;
      const built = await buildApiBundle();
      expect(built.code).not.toContain(SENTINEL);
      expect(built.code).toBe(readBundle());
    } finally {
      keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
    }
  });

  it('`node scripts/bundle-api.mjs --check` passes on the committed bundle', () => {
    const r = runNode(['scripts/bundle-api.mjs', '--check']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^api bundle OK: api\/index\.js \d+ bytes/);
  });

  it('plain Node ESM can import the built bundle (extensionless imports resolved), with no listener, signal handler or lingering handle', () => {
    const script = `
      const before = ['SIGINT','SIGTERM','SIGHUP','uncaughtException','unhandledRejection'].map((e) => process.listenerCount(e));
      const mod = await import(${JSON.stringify(pathToFileURL(BUNDLE).href)});
      const after = ['SIGINT','SIGTERM','SIGHUP','uncaughtException','unhandledRejection'].map((e) => process.listenerCount(e));
      console.log(JSON.stringify({ exports: Object.keys(mod), type: typeof mod.default, same: before.join() === after.join(), handles: process.getActiveResourcesInfo().filter((r) => !['CloseReq', 'PipeWrap', 'TTYWrap', 'FSReqCallback'].includes(r)) }));
    `;
    const r = runNode(['--input-type=module', '-e', script]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0); // the process ended by itself: nothing keeps the event loop alive
    expect(JSON.parse(r.stdout.trim())).toEqual({ exports: ['default'], type: 'function', same: true, handles: [] });
  }, 30_000); // spawnSync blocks on a cold import of express/supabase/genai/redis; must outlast runNode's own 20s limit, not Vitest's 5s default

  it('the built bundle serves a controlled JSON 503 (no secrets, Retry-After set) when Redis is not configured, and never answers from memory', () => {
    const script = `
      import http from 'node:http';
      const { default: handler } = await import(${JSON.stringify(pathToFileURL(BUNDLE).href)});
      const srv = http.createServer(handler);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const res = await fetch('http://127.0.0.1:' + port + '/api/health?__ironlog_api_path=health');
      const text = await res.text();
      console.log(JSON.stringify({ status: res.status, retryAfter: res.headers.get('retry-after'), body: text }));
      srv.close();
    `;
    const r = runNode(['--input-type=module', '-e', script]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').pop() as string);
    expect(out.status).toBe(503);
    expect(out.retryAfter).toBeTruthy();
    expect(JSON.parse(out.body)).toMatchObject({ success: false, code: 'service_unavailable' });
    expect(out.body).not.toMatch(/redis:\/\/|stack|at \S+ \(/i);
  });
});
