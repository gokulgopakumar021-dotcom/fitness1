import type { NextFunction, Request, Response } from 'express';
import { ApiError, sendError } from './errors';
import { logger } from './logger';

export interface RateHit {
  count: number;
  resetAt: number;
  /** Set only by DegradingRateStore: this count came from the per-process fallback, NOT the shared store. */
  degraded?: boolean;
}

/**
 * The shared rate-limit backend could not be used (connection down, timeout, script error). Thrown by shared stores;
 * the terminal error handler turns it into a safe 503, which is the fail-closed behaviour. The message is static:
 * it never carries connection details, hostnames or credentials.
 */
export class RateStoreUnavailableError extends ApiError {
  constructor() {
    super(503, 'rate_limit_unavailable', 'Request protection is temporarily unavailable. Please try again shortly.', { 'Retry-After': '5' });
    this.name = 'RateStoreUnavailableError';
  }
}

/**
 * Store abstraction so a shared backend (Redis, Postgres) can replace the in-process one without touching callers.
 * The in-memory store is per-process: with several instances each keeps its own counters and limits are only
 * approximate. RedisRateStore (redisRateStore.ts) is the shared implementation. See the remediation report.
 */
export interface RateStore {
  hit(key: string, windowMs: number): Promise<RateHit>;
  peek(key: string): Promise<RateHit | undefined>;
}

export class MemoryRateStore implements RateStore {
  private readonly entries = new Map<string, RateHit>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000
  ) {}

  private purge() {
    const t = this.now();
    for (const [k, v] of this.entries) if (v.resetAt <= t) this.entries.delete(k);
    // Hard cap against key-flooding: drop oldest entries first.
    while (this.entries.size > this.maxKeys) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }

  async hit(key: string, windowMs: number): Promise<RateHit> {
    const t = this.now();
    if (this.entries.size >= this.maxKeys) this.purge();
    const cur = this.entries.get(key);
    if (!cur || cur.resetAt <= t) {
      const fresh = { count: 1, resetAt: t + windowMs };
      this.entries.set(key, fresh);
      return { ...fresh };
    }
    cur.count += 1; // synchronous read-modify-write: atomic within the process
    return { ...cur };
  }

  async peek(key: string): Promise<RateHit | undefined> {
    const cur = this.entries.get(key);
    return cur && cur.resetAt > this.now() ? { ...cur } : undefined;
  }
}

/**
 * EXPLICIT degraded mode (RATE_LIMIT_FAILURE_POLICY=degraded). Tries the shared store first on every call, so it
 * recovers on its own. When the shared store fails it counts in this process instead and marks the result
 * `degraded`, which the limiter surfaces as `X-RateLimit-Mode: degraded`. This is NOT distributed protection:
 * each instance counts alone. Never constructed unless the operator asked for it.
 */
export class DegradingRateStore implements RateStore {
  private lastLogAt = 0;
  private degradedCalls = 0;
  constructor(
    private readonly primary: RateStore,
    private readonly fallback: RateStore,
    private readonly now: () => number = Date.now,
    private readonly logEveryMs = 10_000
  ) {}

  private note() {
    this.degradedCalls += 1;
    const t = this.now();
    if (t - this.lastLogAt >= this.logEveryMs) {
      logger.error('rate_limit_degraded', {
        mode: 'degraded',
        distributed: false,
        callsSinceLastLog: this.degradedCalls,
        note: 'shared rate-limit store unavailable; counting per-instance only'
      });
      this.lastLogAt = t;
      this.degradedCalls = 0;
    }
  }

  async hit(key: string, windowMs: number): Promise<RateHit> {
    try {
      return await this.primary.hit(key, windowMs);
    } catch (err) {
      if (!(err instanceof RateStoreUnavailableError)) throw err; // programming errors must not be masked as an outage
      this.note();
      return { ...(await this.fallback.hit(key, windowMs)), degraded: true };
    }
  }

  async peek(key: string): Promise<RateHit | undefined> {
    try {
      return await this.primary.peek(key);
    } catch (err) {
      if (!(err instanceof RateStoreUnavailableError)) throw err;
      this.note();
      const r = await this.fallback.peek(key);
      return r ? { ...r, degraded: true } : undefined;
    }
  }
}

export interface LimiterOptions {
  name: string;
  windowMs: number;
  max: number | ((req: Request) => number);
  /** Return undefined to skip limiting this request. */
  key: (req: Request) => string | undefined;
  store: RateStore;
  now?: () => number;
  /** Requests for which a degraded (per-instance) count is not acceptable: they get a 503 instead. */
  alwaysClosed?: (req: Request) => boolean;
  /**
   * Requests that must keep working when the shared store is down (the public health probe only). The limiter lets
   * them through uncounted. Only ever true for endpoints that expose nothing and spend nothing.
   */
  failOpen?: (req: Request) => boolean;
}

export function createRateLimiter(opts: LimiterOptions) {
  const now = opts.now ?? Date.now;
  return async function limiter(req: Request, res: Response, next: NextFunction) {
    try {
      const id = opts.key(req);
      if (!id) return next();
      const max = typeof opts.max === 'function' ? opts.max(req) : opts.max;
      let hit: RateHit;
      try {
        hit = await opts.store.hit(`${opts.name}:${id}`, opts.windowMs);
      } catch (err) {
        if (err instanceof RateStoreUnavailableError && opts.failOpen?.(req)) return next();
        throw err;
      }
      if (hit.degraded) {
        // Not on fail-open (public health) responses: the probe stays byte-for-byte what it was and reveals nothing.
        if (!opts.failOpen?.(req)) res.setHeader('X-RateLimit-Mode', 'degraded');
        if (opts.alwaysClosed?.(req)) throw new RateStoreUnavailableError();
      }
      const retryAfter = Math.max(1, Math.ceil((hit.resetAt - now()) / 1000));
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, max - hit.count)));
      res.setHeader('RateLimit-Reset', String(retryAfter));
      if (hit.count > max) {
        return sendError(req, res, 429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.', { 'Retry-After': String(retryAfter) });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
