import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { getAccessToken } from './auth';
import type { SecurityConfig } from './config';
import { logger, serializeError } from './logger';
import { sendError } from './errors';
import type { EndpointPolicy } from './endpoints';

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
}

export interface QuotaRequest {
  userId: string;
  bucket: string;
  limit: number;
  /** UTC calendar day, `YYYY-MM-DD`. The counter is keyed by it, so reset needs no cron job. */
  day: string;
  accessToken?: string;
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
 * Shared, restart-safe quota via the `consume_ai_quota` Postgres function (supabase/migrations/…ai_usage_quota.sql),
 * which does the check-and-increment in a single atomic upsert. Called with the caller's own JWT, so no service-role
 * key is needed on the server. The migration must be applied before QUOTA_STORE=supabase is used.
 */
export class SupabaseQuotaStore implements QuotaStore {
  constructor(private readonly cfg: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>) {}
  async consume({ bucket, limit, accessToken }: QuotaRequest): Promise<QuotaDecision> {
    if (!this.cfg.supabaseUrl || !this.cfg.supabaseKey || !accessToken) throw new Error('quota store not configured');
    const client = createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
    const { data, error } = await client.rpc('consume_ai_quota', { p_bucket: bucket, p_limit: limit });
    if (error) throw new Error(`consume_ai_quota failed: ${error.code ?? error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') throw new Error('consume_ai_quota returned an unexpected shape');
    return { allowed: row.allowed, used: Number(row.used), limit };
  }
}

/** If the shared store errors, fall back to the per-process counter (degraded, not distributed) and say so in logs. */
export class ResilientQuotaStore implements QuotaStore {
  constructor(
    private readonly primary: QuotaStore,
    private readonly fallback: QuotaStore
  ) {}
  async consume(req: QuotaRequest): Promise<QuotaDecision> {
    try {
      return await this.primary.consume(req);
    } catch (err) {
      logger.warn('quota_store_degraded', { bucket: req.bucket, err: serializeError(err) });
      return this.fallback.consume(req);
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
      const decision = await opts.store.consume({ userId: req.user.id, bucket: policy.bucket, limit, day: utcDay(t), accessToken: getAccessToken(req) });
      res.setHeader('X-Quota-Limit', String(limit));
      res.setHeader('X-Quota-Remaining', String(Math.max(0, limit - decision.used)));
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
      next(err);
    }
  };
}
