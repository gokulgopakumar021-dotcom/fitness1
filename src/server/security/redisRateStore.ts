import { createHash } from 'node:crypto';
import { createClient, defineScript } from 'redis';
import { logger } from './logger';
import { RateStoreUnavailableError, type RateHit, type RateStore } from './rateLimit';

/**
 * Shared fixed-window rate-limit store on Redis, so per-IP / per-user / per-endpoint limits hold across several
 * Express instances.
 *
 * Atomicity: a window is advanced by ONE Lua script (INCR + guaranteed PEXPIRE + PTTL), which Redis executes without
 * interleaving any other command. Two instances can therefore never both read "9" and both write "10".
 * Expiry: every key gets a TTL in the same script as its first increment, so no key can outlive its window.
 * Time: the window length is enforced by Redis' own TTL, not by instance clocks, so clock skew between instances is
 * irrelevant. Only the returned `resetAt` (used for Retry-After) is derived from the local clock.
 * Failure: every failure mode (not connected, timeout, script/protocol error) becomes RateStoreUnavailableError.
 * This class never falls back to memory by itself; that is a separate, explicit wrapper (DegradingRateStore).
 */

const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if c == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {c, ttl}
`;

const PEEK_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return {0, -2} end
return {tonumber(v) or 0, redis.call('PTTL', KEYS[1])}
`;

const hitScript = defineScript({
  NUMBER_OF_KEYS: 1,
  SCRIPT: HIT_SCRIPT,
  parseCommand(parser: any, key: string, windowMs: number) {
    parser.pushKey(key);
    parser.push(String(windowMs));
  },
  transformReply: (reply: unknown) => reply as [number, number]
});

const peekScript = defineScript({
  NUMBER_OF_KEYS: 1,
  SCRIPT: PEEK_SCRIPT,
  parseCommand(parser: any, key: string) {
    parser.pushKey(key);
  },
  transformReply: (reply: unknown) => reply as [number, number]
});

export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREFIX_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export function isValidKeyPrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix);
}

/**
 * Safe, bounded key construction. The caller's key (which contains IPs, user ids, bucket names) is never used
 * verbatim: it is hashed, so hostile input (colons, newlines, glob characters, megabyte-long values, unicode) can
 * neither collide with another namespace nor grow the key beyond a fixed length. The readable label is restricted
 * to a fixed alphabet. Hashing also means raw IP addresses are not stored in Redis.
 */
export function buildRedisKey(prefix: string, rawKey: string): string {
  const sep = rawKey.indexOf(':');
  const label = (sep > 0 ? rawKey.slice(0, sep) : 'k').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 24) || 'k';
  const digest = createHash('sha256').update(rawKey, 'utf8').digest('base64url').slice(0, 32);
  return `${prefix}:rl:${label}:${digest}`;
}

/** Credentials and the host never go into logs: `redis://:secret@host:6379/0` -> `redis://***@host:6379`. */
export function redactRedisUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const auth = u.username || u.password ? '***@' : '';
    return `${u.protocol}//${auth}${u.host}`;
  } catch {
    return '[invalid redis url]';
  }
}

export interface RedisRateStoreOptions {
  url: string;
  keyPrefix?: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  now?: () => number;
  /** Throttle for repeated "unavailable" log lines. */
  logEveryMs?: number;
}

type ScriptClient = {
  hitScript(key: string, windowMs: number): Promise<[number, number]>;
  peekScript(key: string): Promise<[number, number]>;
};

export class RedisRateStore implements RateStore {
  private readonly client: ReturnType<typeof createClient> & ScriptClient;
  private readonly prefix: string;
  private readonly commandTimeoutMs: number;
  private readonly now: () => number;
  private readonly logEveryMs: number;
  private lastUnavailableLogAt = 0;
  private suppressed = 0;
  private wasDown = false;
  private closed = false;

  constructor(opts: RedisRateStoreOptions) {
    this.prefix = opts.keyPrefix ?? 'ironlog';
    if (!isValidKeyPrefix(this.prefix)) throw new Error('Invalid Redis key prefix');
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 500;
    this.now = opts.now ?? Date.now;
    this.logEveryMs = opts.logEveryMs ?? 10_000;
    const connectTimeout = opts.connectTimeoutMs ?? 2_000;

    const client = createClient({
      url: opts.url,
      // Commands fail immediately while disconnected instead of queueing until reconnect: a request must get its
      // 503 (or its degraded decision) now, not after an unbounded wait.
      disableOfflineQueue: true,
      socket: {
        connectTimeout,
        // Reconnect forever with capped exponential back-off plus jitter, so recovery needs no restart.
        reconnectStrategy: (retries: number) => Math.min(2 ** Math.min(retries, 6) * 50, 2_000) + Math.floor(Math.random() * 100)
      },
      scripts: { hitScript, peekScript }
    } as any) as unknown as ReturnType<typeof createClient> & ScriptClient;

    // Without an 'error' listener node-redis would crash the process on a connection error.
    client.on('error', (err: unknown) => this.noteDown('connection_error', err));
    client.on('ready', () => {
      if (this.wasDown) logger.info('rate_store_recovered', { store: 'redis', target: redactRedisUrl(opts.url) });
      else logger.info('rate_store_connected', { store: 'redis', target: redactRedisUrl(opts.url) });
      this.wasDown = false;
    });
    this.client = client;
    // Connect in the background; requests are refused (not queued) until the client reports ready.
    void client.connect().catch((err: unknown) => this.noteDown('initial_connect_failed', err));
  }

  get isReady(): boolean {
    return !this.closed && this.client.isReady;
  }

  /** Resolves true once connected, false if not ready within the timeout. Never rejects. Used at startup only. */
  async waitUntilReady(timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.isReady) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.isReady;
  }

  async ping(): Promise<boolean> {
    try {
      await this.guard('ping', () => this.client.ping());
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      if (this.client.isOpen) await this.client.close();
    } catch {
      this.client.destroy();
    }
  }

  async hit(key: string, windowMs: number): Promise<RateHit> {
    if (!Number.isInteger(windowMs) || windowMs < 1 || windowMs > MAX_WINDOW_MS) throw new RangeError('windowMs out of range');
    const redisKey = buildRedisKey(this.prefix, key);
    const [count, ttl] = await this.guard('hit', () => this.client.hitScript(redisKey, windowMs));
    return { count: Number(count), resetAt: this.now() + Math.max(1, Number(ttl)) };
  }

  async peek(key: string): Promise<RateHit | undefined> {
    const redisKey = buildRedisKey(this.prefix, key);
    const [count, ttl] = await this.guard('peek', () => this.client.peekScript(redisKey));
    if (!count || Number(ttl) <= 0) return undefined;
    return { count: Number(count), resetAt: this.now() + Number(ttl) };
  }

  private async guard<T>(op: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isReady) {
      this.noteDown(`${op}_not_ready`);
      throw new RateStoreUnavailableError();
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('redis command timeout'), { code: 'COMMAND_TIMEOUT' })), this.commandTimeoutMs);
        })
      ]);
    } catch (err) {
      this.noteDown(`${op}_failed`, err);
      throw new RateStoreUnavailableError();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Logs error class/code only: never the message (could name a host) and never the URL or credentials. */
  private noteDown(reason: string, err?: unknown) {
    this.wasDown = true;
    const t = this.now();
    if (t - this.lastUnavailableLogAt < this.logEveryMs) {
      this.suppressed += 1;
      return;
    }
    this.lastUnavailableLogAt = t;
    const e = err as { name?: string; code?: string } | undefined;
    logger.error('rate_store_unavailable', {
      store: 'redis',
      reason, // NOT named `event`: that key would overwrite the logger's own event name
      errName: e?.name,
      errCode: e?.code,
      suppressedSinceLastLog: this.suppressed,
      distributed: false
    });
    this.suppressed = 0;
  }
}
