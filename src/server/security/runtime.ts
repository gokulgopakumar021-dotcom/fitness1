import type { SecurityConfig } from './config';
import { logger } from './logger';
import { DegradingRateStore, MemoryRateStore, type RateStore } from './rateLimit';
import { RedisRateStore, redactRedisUrl } from './redisRateStore';

/** Thrown at startup only. Messages are static or list setting NAMES, never values, so they are safe to print. */
export class StartupConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid security configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'StartupConfigError';
  }
}

export interface SecurityRuntime {
  rateStore: RateStore;
  /** Releases connections. Safe to call more than once. */
  close(): Promise<void>;
  /** Credential-free description of what was selected (also what gets logged). */
  summary: { rateStore: 'memory' | 'redis'; rateFailurePolicy: 'closed' | 'degraded' | 'n/a'; redisTarget?: string };
}

export interface RuntimeOptions {
  /** How long to wait for the first Redis connection before refusing to start. */
  readyTimeoutMs?: number;
  /** Test seam. */
  redisFactory?: (url: string) => RedisRateStore;
}

/**
 * Builds everything that needs I/O before the server may accept traffic, and refuses to start (throws) rather than
 * silently running with weaker protection:
 *  - invalid configuration -> StartupConfigError
 *  - RATE_LIMIT_STORE=redis (the production default) but Redis unreachable within readyTimeoutMs -> throws
 * There is no code path from "Redis wanted" to "memory store" other than the explicit RATE_LIMIT_STORE=memory setting.
 */
export async function prepareSecurityRuntime(config: SecurityConfig, opts: RuntimeOptions = {}): Promise<SecurityRuntime> {
  if (config.problems.length) throw new StartupConfigError(config.problems);
  for (const w of config.warnings) logger.warn('security_config_warning', { warning: w });

  if (config.rateStore === 'memory') {
    const summary = { rateStore: 'memory' as const, rateFailurePolicy: 'n/a' as const };
    logger.info('security_runtime', { ...summary, distributed: false, production: config.production });
    return { rateStore: new MemoryRateStore(), close: async () => {}, summary };
  }

  const url = config.redisUrl!;
  const redis = (opts.redisFactory ?? ((u) => new RedisRateStore({ url: u })))(url);
  const target = redactRedisUrl(url);
  const ready = await redis.waitUntilReady(opts.readyTimeoutMs ?? 5_000);
  if (!ready) {
    await redis.close();
    logger.error('security_runtime_redis_unreachable', { target, policy: config.rateFailurePolicy });
    throw new Error('Rate-limit store is configured as Redis but Redis is not reachable; refusing to start. Check REDIS_URL and network access.');
  }

  const degraded = config.rateFailurePolicy === 'degraded';
  const rateStore: RateStore = degraded ? new DegradingRateStore(redis, new MemoryRateStore()) : redis;
  const summary = { rateStore: 'redis' as const, rateFailurePolicy: config.rateFailurePolicy, redisTarget: target };
  logger.info('security_runtime', {
    ...summary,
    distributed: true,
    production: config.production,
    ...(degraded ? { note: 'degraded mode: if Redis fails, limits count per instance; extract-plan and physique routes still fail closed' } : {})
  });
  return { rateStore, close: () => redis.close(), summary };
}
