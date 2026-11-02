import type { NextFunction, Request, Response } from 'express';
import { sendError } from './errors';

export interface RateHit {
  count: number;
  resetAt: number;
}

/**
 * Store abstraction so a shared backend (Redis, Postgres) can replace the in-process one without touching callers.
 * The in-memory store is per-process: with several instances each keeps its own counters and limits are only
 * approximate. See the remediation report ("Rate-limit and quota architecture").
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

export interface LimiterOptions {
  name: string;
  windowMs: number;
  max: number | ((req: Request) => number);
  /** Return undefined to skip limiting this request. */
  key: (req: Request) => string | undefined;
  store: RateStore;
  now?: () => number;
}

export function createRateLimiter(opts: LimiterOptions) {
  const now = opts.now ?? Date.now;
  return async function limiter(req: Request, res: Response, next: NextFunction) {
    try {
      const id = opts.key(req);
      if (!id) return next();
      const max = typeof opts.max === 'function' ? opts.max(req) : opts.max;
      const hit = await opts.store.hit(`${opts.name}:${id}`, opts.windowMs);
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
