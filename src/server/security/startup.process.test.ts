// @vitest-environment node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireRedis, freePort, redisSuite, TcpProxy, urlViaProxy, type RedisTarget } from './redisTestHarness';

/**
 * Starts the REAL server entry point (`tsx server.ts`, NODE_ENV=production) as a child process and checks what an
 * operator would see: exit codes, stderr, and the live health endpoint. No mocks.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function launch(env: Record<string, string>) {
  const child = spawn(TSX, ['server.ts'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'production', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_not_real', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise<Run>((resolve) => child.once('exit', (code) => resolve({ code, stdout, stderr })));
  const waitFor = async (needle: string, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stdout.includes(needle)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  return { child, exited, waitFor, out: () => ({ stdout, stderr }) };
}

describe('real server process: configuration refusals (no Redis needed)', () => {
  it('production without REDIS_URL exits 1 with a clear, secret-free message and never listens', async () => {
    const p = launch({ APP_PORT: String(await freePort()) });
    const r = await p.exited;
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refused to start/);
    expect(r.stderr).toMatch(/REDIS_URL is required/);
    expect(r.stdout).not.toMatch(/listening/);
  }, 30_000);

  it('production with an invalid policy exits 1 naming the setting only', async () => {
    const p = launch({ APP_PORT: String(await freePort()), REDIS_URL: 'redis://:topsecret@127.0.0.1:1', RATE_LIMIT_FAILURE_POLICY: 'whatever' });
    const r = await p.exited;
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/RATE_LIMIT_FAILURE_POLICY/);
    expect(r.stderr + r.stdout).not.toContain('topsecret');
  }, 30_000);

  it('production with Redis configured but unreachable exits 1 instead of falling back to memory', async () => {
    const p = launch({ APP_PORT: String(await freePort()), REDIS_URL: 'redis://:topsecret@127.0.0.1:1' });
    const r = await p.exited;
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Redis is not reachable; refusing to start/);
    expect(r.stdout).not.toMatch(/listening/);
    expect(r.stderr + r.stdout).not.toContain('topsecret');
  }, 40_000);

  it('explicit RATE_LIMIT_STORE=memory in production starts, warns loudly, and serves the unchanged health response', async () => {
    const port = await freePort();
    const p = launch({ APP_PORT: String(port), RATE_LIMIT_STORE: 'memory' });
    try {
      expect(await p.waitFor('listening', 25_000)).toBe(true);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(Object.keys(await res.json()).sort()).toEqual(['status', 'time']);
      expect(p.out().stderr + p.out().stdout).toMatch(/not shared between instances/);
    } finally {
      p.child.kill('SIGTERM');
      await p.exited;
    }
  }, 40_000);

  it('production with no Supabase configuration exits 1 naming QUOTA_STORE (the production default is the shared quota)', async () => {
    const p = launch({ APP_PORT: String(await freePort()), RATE_LIMIT_STORE: 'memory', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' });
    const r = await p.exited;
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refused to start/);
    expect(r.stderr).toMatch(/QUOTA_STORE=supabase/);
    expect(r.stdout).not.toMatch(/listening/);
  }, 30_000);

  it('an invalid QUOTA_STORE or QUOTA_FAILURE_POLICY exits 1 instead of silently downgrading', async () => {
    const cases: Record<string, string>[] = [{ QUOTA_STORE: 'supabse' }, { QUOTA_FAILURE_POLICY: 'open' }];
    for (const env of cases) {
      const p = launch({ APP_PORT: String(await freePort()), RATE_LIMIT_STORE: 'memory', ...env });
      const r = await p.exited;
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(new RegExp(Object.keys(env)[0]));
      expect(r.stdout).not.toMatch(/listening/);
    }
  }, 60_000);

  it('explicit QUOTA_STORE=memory in production starts and warns that daily limits are not shared', async () => {
    const port = await freePort();
    const p = launch({ APP_PORT: String(port), RATE_LIMIT_STORE: 'memory', QUOTA_STORE: 'memory', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' });
    try {
      expect(await p.waitFor('listening', 25_000)).toBe(true);
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
      expect(p.out().stderr + p.out().stdout).toMatch(/per-process memory quota/);
    } finally {
      p.child.kill('SIGTERM');
      await p.exited;
    }
  }, 40_000);

  it('QUOTA_STORE=supabase with configuration starts (no quota call at boot); a protected AI call without a valid session is 401, never a quota error', async () => {
    const port = await freePort();
    const p = launch({ APP_PORT: String(port), RATE_LIMIT_STORE: 'memory' });
    try {
      expect(await p.waitFor('listening', 25_000)).toBe(true);
      const res = await fetch(`http://127.0.0.1:${port}/api/exercise-coach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
    } finally {
      p.child.kill('SIGTERM');
      await p.exited;
    }
  }, 40_000);
});

let target: RedisTarget | null = null;
let proxy: TcpProxy;
afterAll(async () => {
  await proxy?.close();
  await target?.stop();
});

// Registered lazily so the suite wrapper can see whether Redis exists.
redisSuite('real server process with Redis', await acquireRedisProbe(), () => {
  it('boots on Redis, keeps health public and unchanged, 503s protected calls during an outage and recovers', async () => {
    const port = await freePort();
    const p = launch({ APP_PORT: String(port), REDIS_URL: urlViaProxy(target!, proxy), RATE_LIMIT_STORE: 'redis' });
    try {
      expect(await p.waitFor('listening', 25_000)).toBe(true);
      const base = `http://127.0.0.1:${port}/api`;
      const secret = target!.password;
      expect((await fetch(`${base}/ai-food-parser`, { method: 'POST' })).status).toBe(401); // reaches auth => limiter works on Redis
      expect(p.out().stdout + p.out().stderr).toMatch(/security_runtime/);
      if (secret) expect(p.out().stdout + p.out().stderr).not.toContain(secret);

      await proxy.cut();
      const down = await fetch(`${base}/ai-food-parser`, { method: 'POST' });
      expect(down.status).toBe(503);
      expect((await down.json()).code).toBe('rate_limit_unavailable');
      const h = await fetch(`${base}/health`);
      expect(h.status).toBe(200);
      expect(Object.keys(await h.json()).sort()).toEqual(['status', 'time']);

      await proxy.restore();
      let status = 0;
      for (let i = 0; i < 80 && status !== 401; i++) {
        status = (await fetch(`${base}/ai-food-parser`, { method: 'POST' })).status;
        if (status !== 401) await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe(401);
      if (secret) expect(p.out().stdout + p.out().stderr).not.toContain(secret);
    } finally {
      p.child.kill('SIGTERM');
      await p.exited;
    }
  }, 60_000);
});

async function acquireRedisProbe(): Promise<RedisTarget | null> {
  // The suite wrapper needs the target at collection time; reuse the single instance for the proxy as well.
  target = await acquireRedis();
  if (target) {
    proxy = new TcpProxy(target.host, target.port);
    await proxy.start();
  }
  return target;
}
