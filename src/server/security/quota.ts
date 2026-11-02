import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { getAccessToken } from './auth';
import type { SecurityConfig } from './config';
import { logger } from './logger';
import { sendError } from './errors';
import { ALWAYS_CLOSED_BUCKETS, type EndpointPolicy } from './endpoints';

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  /** True when the count came from the per-instance fallback (explicit degraded policy only). */
  degraded?: boolean;
}

export interface QuotaRequest {
  userId: string;
  bucket: string;
  limit: number;
  /** UTC calendar day, `YYYY-MM-DD`. The counter is keyed by it, so reset needs no cron job. */
  day: string;
  accessToken?: string;
  /** false for always-closed routes: a store failure must surface, never be counted in memory. */
  allowDegraded?: boolean;
}

export interface QuotaStore {
  consume(req: QuotaRequest): Promise<QuotaDecision>;
}

/** Check-and-increment happens synchronously, so simultaneous requests cannot both pass the last slot. */
export class MemoryQuotaStore implements QuotaStore {
  private readonly counts = new Map<string, number>();
  async consume({ userId, bucket, limit, day }: QuotaRequest): Promise<QuotaDecision> {
    for (const k of this.counts.keys()) if (!k.startsWith(`${day}|`)) this.counts.delete(k);
    const key = `${day}|${bucket}|${userId}`;
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) return { allowed: false, used, limit };
    this.counts.set(key, used + 1);
    return { allowed: true, used: used + 1, limit };
  }
}

/**
 * The shared quota store could not give a trustworthy answer (network, timeout, RPC error, missing migration, bad shape,
 * missing token). `reason` is a short fixed-vocabulary code that is safe to log and never contains DB error text.
 * The message is static so it can never leak upstream detail to a client.
 */
export class QuotaStoreUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super('Quota store unavailable');
    this.name = 'QuotaStoreUnavailableError';
  }
}

/**
 * Shared, restart-safe quota via the `consume_ai_quota` Postgres function (supabase/migrations/…ai_usage_quota.sql),
 * which does the check-and-increment in a single atomic upsert. Called with the caller's own JWT, so no service-role
 * key is needed on the server. The migration must be applied before QUOTA_STORE=supabase is used.
 * Every failure becomes QuotaStoreUnavailableError; there is no silent fallback here.
 */
export class SupabaseQuotaStore implements QuotaStore {
  private readonly timeoutMs: number;
  constructor(
    private readonly cfg: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>,
    opts: { timeoutMs?: number } = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? 3_000;
  }
  async consume({ bucket, limit, accessToken }: QuotaRequest): Promise<QuotaDecision> {
    if (!this.cfg.supabaseUrl || !this.cfg.supabaseKey) throw new QuotaStoreUnavailableError('not_configured');
    if (!accessToken) throw new QuotaStoreUnavailableError('no_token');
    let data: unknown;
    try {
      const client = createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
      });
      const res = await client.rpc('consume_ai_quota', { p_bucket: bucket, p_limit: limit }).abortSignal(AbortSignal.timeout(this.timeoutMs));
      if (res.error) {
        const name = (res.error as { name?: string }).name ?? '';
        if (name === 'AbortError' || name === 'TimeoutError' || /abort/i.test(res.error.message ?? '')) throw new QuotaStoreUnavailableError('timeout');
        const code = String(res.error.code ?? '');
        throw new QuotaStoreUnavailableError(/^[A-Za-z0-9_]{1,12}$/.test(code) ? `rpc_${code}` : 'rpc_error');
      }
      data = res.data;
    } catch (err) {
      if (err instanceof QuotaStoreUnavailableError) throw err;
      const name = (err as { name?: string } | null)?.name ?? '';
      throw new QuotaStoreUnavailableError(name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'transport');
    }
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; used?: unknown } | null | undefined;
    if (!row || typeof row.allowed !== 'boolean' || !Number.isFinite(Number(row.used))) throw new QuotaStoreUnavailableError('bad_shape');
    return { allowed: row.allowed, used: Number(row.used), limit };
  }
}

/**
 * EXPLICIT degraded mode (QUOTA_FAILURE_POLICY=degraded). Only QuotaStoreUnavailableError is caught; anything else
 * propagates. Requests marked `allowDegraded: false` (the always-closed routes) are re-thrown, never counted in memory.
 * Every degraded count is announced: decision.degraded -> X-Quota-Mode header, plus a throttled `quota_store_degraded` log.
 */
export class DegradingQuotaStore implements QuotaStore {
  private lastLogAt = 0;
  private suppressed = 0;
  constructor(
    private readonly primary: QuotaStore,
    private readonly fallback: QuotaStore,
    private readonly now: () => number = Date.now,
    private readonly logEveryMs = 10_000
  ) {}
  async consume(req: QuotaRequest): Promise<QuotaDecision> {
    try {
      return await this.primary.consume(req);
    } catch (err) {
      if (!(err instanceof QuotaStoreUnavailableError)) throw err;
      if (req.allowDegraded === false) throw err;
      const t = this.now();
      if (t - this.lastLogAt >= this.logEveryMs) {
        logger.warn('quota_store_degraded', { bucket: req.bucket, reason: err.reason, suppressed: this.suppressed });
        this.lastLogAt = t;
        this.suppressed = 0;
      } else this.suppressed++;
      return { ...(await this.fallback.consume(req)), degraded: true };
    }
  }
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const secondsUntilUtcMidnight = (ms: number) => {
  const d = new Date(ms);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - ms) / 1000));
};

export function effectiveDailyLimit(policy: EndpointPolicy, cfg: Pick<SecurityConfig, 'quotaOverrides'>): number | undefined {
  if (!policy.ai) return undefined;
  const override = cfg.quotaOverrides[policy.bucket];
  return override !== undefined ? override : policy.dailyQuota;
}

export function createQuotaGate(opts: { store: QuotaStore; config: SecurityConfig; policyFor: (req: Request) => EndpointPolicy | undefined; now?: () => number }) {
  const now = opts.now ?? Date.now;
  return async function quotaGate(req: Request, res: Response, next: NextFunction) {
    try {
      const policy = opts.policyFor(req);
      const limit = policy && effectiveDailyLimit(policy, opts.config);
      if (!policy || limit === undefined || !req.user) return next();
      const t = now();
      const decision = await opts.store.consume({ userId: req.user.id, bucket: policy.bucket, limit, day: utcDay(t), accessToken: getAccessToken(req), allowDegraded: !ALWAYS_CLOSED_BUCKETS.has(policy.bucket) });
      res.setHeader('X-Quota-Limit', String(limit));
      res.setHeader('X-Quota-Remaining', String(Math.max(0, limit - decision.used)));
      if (decision.degraded) res.setHeader('X-Quota-Mode', 'degraded');
      if (!decision.allowed) {
        const retry = secondsUntilUtcMidnight(t);
        res.setHeader('Retry-After', String(retry));
        return res.status(429).json({
          success: false,
          error: 'You have reached today’s limit for this feature. It resets at 00:00 UTC.',
          code: 'quota_exceeded',
          requestId: req.requestId,
          quota: { feature: policy.bucket, limit, used: decision.used, resetsInSeconds: retry }
        });
      }
      next();
    } catch (err) {
      if (err instanceof QuotaStoreUnavailableError) {
        // Fail closed: nothing has reached the route handler, so no Gemini call is made and no usage goes untracked.
        logger.error('quota_unavailable', { requestId: req.requestId, userId: req.user?.id, bucket: opts.policyFor(req)?.bucket, reason: err.reason });
        return sendError(req, res, 503, 'quota_unavailable', 'Usage limits are temporarily unavailable. Please try again shortly.', { 'Retry-After': '5' });
      }
      next(err);
    }
  };
}
