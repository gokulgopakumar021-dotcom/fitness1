import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { describe, it } from 'vitest';

/**
 * Test harness for the Redis integration tests.
 *  - Redis comes from REDIS_TEST_URL (CI service container) or a throw-away local `redis-server` on a free port.
 *  - A TCP proxy sits between the app and Redis so tests can cut, restore and stall the connection deterministically,
 *    against either kind of Redis, without needing to kill the server.
 *  - REQUIRE_REDIS_TESTS=1 turns "no Redis available" from a reported skip into a failing test (use it in CI).
 */
export const STRICT = process.env.REQUIRE_REDIS_TESTS === '1';

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

function ping(host: string, port: number, password?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(port, host);
    let buf = '';
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(800, () => done(false));
    sock.on('error', () => done(false));
    sock.on('connect', () => {
      if (password) sock.write(`*2\r\n$4\r\nAUTH\r\n$${password.length}\r\n${password}\r\n`);
      sock.write('*1\r\n$4\r\nPING\r\n');
    });
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('+PONG')) done(true);
    });
  });
}

export interface RedisTarget {
  host: string;
  port: number;
  password?: string;
  /** Direct URL (no proxy). */
  url: string;
  stop(): Promise<void>;
}

export async function acquireRedis(): Promise<RedisTarget | null> {
  const ext = process.env.REDIS_TEST_URL;
  if (ext) {
    const u = new URL(ext);
    const port = Number(u.port || 6379);
    if (!(await ping(u.hostname, port, u.password ? decodeURIComponent(u.password) : undefined))) return null;
    return { host: u.hostname, port, password: u.password ? decodeURIComponent(u.password) : undefined, url: ext, stop: async () => {} };
  }
  if (spawnSync('redis-server', ['--version']).status !== 0) return null;
  const port = await freePort();
  const password = `test-pw-${Math.random().toString(36).slice(2)}`;
  const child: ChildProcess = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--requirepass', password], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await ping('127.0.0.1', port, password)) {
      return {
        host: '127.0.0.1',
        port,
        password,
        url: `redis://:${password}@127.0.0.1:${port}`,
        stop: async () => {
          child.kill('SIGTERM');
          await new Promise((r) => child.once('exit', r));
        }
      };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill('SIGKILL');
  return null;
}

/** Controllable TCP forwarder. `cut()` refuses/drops everything; `stall()` keeps sockets open but holds client bytes. */
export class TcpProxy {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  private stalled = false;
  private held: Array<() => void> = [];
  port = 0;
  constructor(private readonly host: string, private readonly targetPort: number) {}

  async start(port = 0) {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.targetPort, this.host);
      this.sockets.add(client).add(upstream);
      const drop = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', drop).on('close', drop);
      upstream.on('error', drop).on('close', drop);
      client.on('data', (d) => {
        const send = () => upstream.write(d);
        if (this.stalled) this.held.push(send);
        else send();
      });
      upstream.pipe(client);
    });
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async cut() {
    const s = this.server;
    this.server = null;
    this.sockets.forEach((x) => x.destroy());
    this.sockets.clear();
    this.held = [];
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  async restore() {
    if (!this.server) await this.start(this.port);
  }

  stall() {
    this.stalled = true;
  }

  unstall() {
    this.stalled = false;
    const h = this.held;
    this.held = [];
    h.forEach((f) => f());
  }

  async close() {
    this.unstall();
    await this.cut();
  }
}

export const urlViaProxy = (target: RedisTarget, proxy: TcpProxy) => `redis://${target.password ? `:${encodeURIComponent(target.password)}@` : ''}127.0.0.1:${proxy.port}`;

/**
 * Registers a describe block that runs only with a reachable Redis. Without one: strict mode -> a failing test that
 * says why; otherwise the whole block is reported as SKIPPED with a console notice (never silently green).
 */
export function redisSuite(name: string, target: RedisTarget | null, body: () => void) {
  if (!target && STRICT) {
    describe(name, () => {
      it('REQUIRE_REDIS_TESTS=1 but no Redis is available (set REDIS_TEST_URL or install redis-server)', () => {
        throw new Error('Redis integration tests cannot run: no Redis reachable and strict mode is on.');
      });
    });
    return;
  }
  if (!target) console.warn(`[redis-tests] SKIPPED "${name}": no Redis available (set REDIS_TEST_URL or install redis-server; REQUIRE_REDIS_TESTS=1 makes this a failure).`);
  (target ? describe : describe.skip)(name, body);
}
