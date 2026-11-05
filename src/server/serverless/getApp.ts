import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from '../app';
import { loadSecurityConfig, type SecurityConfig } from '../security/config';
import { logger } from '../security/logger';
import { RedisRateStore } from '../security/redisRateStore';
import { prepareSecurityRuntime, StartupConfigError, type SecurityRuntime } from '../security/runtime';

/**
 * Serverless initialisation layer (Stage 3.3).
 *
 * A Vercel Function instance may serve many requests, and many cold-start requests can arrive at once. This module
 * builds the REAL Express application (config -> Redis connect + readiness wait -> createApp) exactly once per
 * instance, and decides what callers see while that is not possible.
 *
 * Guarantees (each one is covered by getApp.test.ts):
 *  - single flight: concurrent callers share one initialisation, so one Redis client per instance;
 *  - no permanently cached rejection: a failure is remembered only as a timestamp for a short cooldown (so a broken
 *    Redis is not hammered by every request); after the cooldown a fresh attempt is made, so recovery needs no redeploy;
 *  - fail closed: there is no path to an in-memory rate store. A configuration that would select one (explicit
 *    RATE_LIMIT_STORE=memory, a non-production default, or the `degraded` failure policy that falls back to
 *    per-instance counters) is refused here, because per-instance counters multiply limits across instances;
 *  - clean-up: a half-initialised Redis client is closed exactly once when initialisation fails;
 *  - no secrets: failures are logged by category only, and callers get a fixed message (never URLs, hosts, stacks);
 *  - no process control: no signal handlers, no process.exit, no listeners, no timers of its own.
 *
 * Importing this module has no side effects: nothing is read from the environment and nothing connects until the
 * first call to `getApp()`.
 */

export type InitFailureReason =
  | 'invalid_configuration'
  | 'memory_rate_store_not_allowed'
  | 'degraded_rate_policy_not_allowed'
  | 'redis_unavailable'
  | 'init_error';

/** Thrown by `getApp()` when the application cannot be built. The message is static and carries no detail. */
export class AppInitError extends Error {
  constructor(
    public readonly reason: InitFailureReason,
    public readonly retryAfterSec: number
  ) {
    super(`Application initialization failed (${reason}).`);
    this.name = 'AppInitError';
  }
}

/** Same value the rate limiter uses for `Retry-After` when its store is unavailable. */
export const DEFAULT_RETRY_COOLDOWN_MS = 5_000;
/** How long to wait for the first Redis connection (the same default the local runner uses). */
export const DEFAULT_READY_TIMEOUT_MS = 5_000;

export interface AppProviderOptions {
  /** Test seam. Defaults to reading process.env at the time of the first attempt (never at import time). */
  loadConfig?: () => SecurityConfig;
  /** Test seam. Defaults to the real `prepareSecurityRuntime`. */
  prepareRuntime?: typeof prepareSecurityRuntime;
  /** Test seam. Defaults to the real `createApp`. */
  buildApp?: typeof createApp;
  /** Test seam for the Redis client. Defaults to the real `RedisRateStore`. */
  redisFactory?: (url: string) => RedisRateStore;
  readyTimeoutMs?: number;
  retryCooldownMs?: number;
  now?: () => number;
}

export interface AppProvider {
  getApp(): Promise<Express>;
}

export function createAppProvider(opts: AppProviderOptions = {}): AppProvider {
  const now = opts.now ?? Date.now;
  const cooldownMs = opts.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const retryAfterSec = Math.max(1, Math.ceil(cooldownMs / 1000));
  const loadConfig = opts.loadConfig ?? (() => loadSecurityConfig(process.env));
  const prepare = opts.prepareRuntime ?? prepareSecurityRuntime;
  const build = opts.buildApp ?? createApp;
  const newRedis = opts.redisFactory ?? ((url: string) => new RedisRateStore({ url }));

  let ready: Express | undefined;
  let inflight: Promise<Express> | undefined;
  let failure: { at: number; reason: InitFailureReason } | undefined;

  async function initialize(): Promise<Express> {
    let created = undefined as RedisRateStore | undefined; // assigned inside the factory closure below
    let runtime: SecurityRuntime | undefined;

    try {
      const config = loadConfig();
      if (config.problems.length === 0) {
        // Never serve with per-instance counters. These checks run before anything connects.
        if (config.rateStore !== 'redis') throw new AppInitError('memory_rate_store_not_allowed', retryAfterSec);
        if (config.rateFailurePolicy !== 'closed') throw new AppInitError('degraded_rate_policy_not_allowed', retryAfterSec);
      }

      // Track the client prepareSecurityRuntime creates so a failure anywhere below can release it. Its close() is
      // memoised: prepareSecurityRuntime closes an unreachable client itself, and our clean-up (or a later shutdown)
      // must not close it a second time.
      const factory = (url: string) => {
        const store = newRedis(url);
        const close = store.close.bind(store);
        let closing: Promise<void> | undefined;
        store.close = () => (closing ??= close());
        created = store;
        return store;
      };

      runtime = await prepare(config, { readyTimeoutMs: opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, redisFactory: factory });
      return build({ config, rateStore: runtime.rateStore });
    } catch (err) {
      await created?.close().catch(() => undefined);
      throw toInitError(err, { redisCreated: created !== undefined, runtimeReady: runtime !== undefined });
    }
  }

  function toInitError(err: unknown, state: { redisCreated: boolean; runtimeReady: boolean }): AppInitError {
    if (err instanceof AppInitError) {
      logger.error('serverless_init_failed', { reason: err.reason });
      return err;
    }
    let reason: InitFailureReason = 'init_error';
    const fields: Record<string, unknown> = {};
    if (err instanceof StartupConfigError) {
      reason = 'invalid_configuration';
      fields.problems = err.problems; // static text naming settings, never values
    } else if (state.redisCreated && !state.runtimeReady) {
      reason = 'redis_unavailable'; // prepareSecurityRuntime gave up waiting for Redis
    }
    // Error class only: messages from clients or the platform could contain hosts or credentials.
    logger.error('serverless_init_failed', { reason, errName: err instanceof Error ? err.name : typeof err, ...fields });
    return new AppInitError(reason, retryAfterSec);
  }

  async function getApp(): Promise<Express> {
    if (ready) return ready;
    if (inflight) return inflight;

    if (failure) {
      const elapsed = now() - failure.at;
      if (elapsed < cooldownMs) throw new AppInitError(failure.reason, Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)));
    }

    const attempt: Promise<Express> = initialize()
      .then(
        (app) => {
          ready = app;
          failure = undefined;
          return app;
        },
        (err: AppInitError) => {
          // Remember THAT it failed (for the cooldown), never the rejected promise itself.
          failure = { at: now(), reason: err.reason };
          throw err;
        }
      )
      .finally(() => {
        inflight = undefined;
      });
    inflight = attempt;
    return attempt;
  }

  return { getApp };
}

/** The per-instance provider used by the Vercel Function entry point. */
export const getApp: () => Promise<Express> = createAppProvider().getApp;

// --- Controlled failure response -------------------------------------------------------------------------------

/** Same alphabet and length rule as `requestContext` (a parity test keeps them identical). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function resolveRequestId(inbound: string | string[] | undefined): string {
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  return value && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

export const INIT_FAILURE_MESSAGE = 'The service is temporarily unavailable. Please try again shortly.';

/**
 * Sends the controlled JSON 503 used while the application cannot be built. Same envelope as the app's own errors
 * (`success`, `error`, `code`, `requestId`). The body is fixed text: the reason is logged, never sent.
 */
export function sendInitFailure(req: IncomingMessage, res: ServerResponse, err: unknown): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const retryAfter = err instanceof AppInitError ? err.retryAfterSec : Math.ceil(DEFAULT_RETRY_COOLDOWN_MS / 1000);
  if (!(err instanceof AppInitError)) {
    logger.error('serverless_init_failed', { reason: 'init_error', errName: err instanceof Error ? err.name : typeof err });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify({ success: false, error: INIT_FAILURE_MESSAGE, code: 'service_unavailable', requestId });
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(req.method === 'HEAD' ? undefined : body);
}
