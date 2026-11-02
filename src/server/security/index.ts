import type { Express, NextFunction, Request, Response } from 'express';
import { createAuthMiddleware, createSupabaseVerifier, type TokenVerifier } from './auth';
import { loadSecurityConfig, type SecurityConfig } from './config';
import { createCors } from './cors';
import { isAlwaysClosed, resolvePolicy } from './endpoints';
import { apiNotFound, errorHandler } from './errors';
import { createSecurityHeaders } from './headers';
import { createJsonBody } from './jsonBody';
import { createQuotaGate, DegradingQuotaStore, MemoryQuotaStore, SupabaseQuotaStore, type QuotaStore } from './quota';
import { createRateLimiter, MemoryRateStore, type RateStore } from './rateLimit';
import { requestContext } from './requestContext';
import { validateBody } from './validation';
import './types';

export interface SecurityDeps {
  config?: SecurityConfig;
  verifyToken?: TokenVerifier;
  rateStore?: RateStore;
  quotaStore?: QuotaStore;
  now?: () => number;
}

const isHealth = (req: Request) => (req.method === 'GET' || req.method === 'HEAD') && req.path === '/health';

/**
 * Installs the security pipeline. Must be called BEFORE any route is registered so that no `/api/*` handler can be
 * reached without passing through it:
 *   request-id → headers → CORS → per-IP limit → AUTH → per-user limit → endpoint policy (404 for unknown) +
 *   per-endpoint limit → body parse (route-specific size) → validation → daily AI quota → route handler
 */
export function installSecurity(app: Express, deps: SecurityDeps = {}): SecurityConfig {
  const config = deps.config ?? loadSecurityConfig();
  const now = deps.now ?? Date.now;
  if (!deps.rateStore && config.rateStore === 'redis') {
    // createApp() cannot connect on its own (it is synchronous). Booting without the shared store would silently mean
    // per-process limits, which is exactly what this configuration forbids: use prepareSecurityRuntime() in startServer().
    throw new Error('RATE_LIMIT_STORE=redis but no rate store was provided to the app.');
  }
  const rateStore = deps.rateStore ?? new MemoryRateStore(now);
  const closedRoute = (req: Request) => isAlwaysClosed(req.method, req.path);
  const buildQuotaStore = (): QuotaStore => {
    if (config.quotaStore !== 'supabase') return new MemoryQuotaStore();
    const shared = new SupabaseQuotaStore(config);
    return config.quotaFailurePolicy === 'degraded' ? new DegradingQuotaStore(shared, new MemoryQuotaStore(), now) : shared;
  };
  const quotaStore = deps.quotaStore ?? buildQuotaStore();
  const verify = deps.verifyToken ?? createSupabaseVerifier(config);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestContext);
  for (const mw of createSecurityHeaders(config)) app.use(mw);

  app.use('/api', createCors(config));

  app.use(
    '/api',
    createRateLimiter({
      name: 'ip',
      windowMs: 60_000,
      max: config.rateIpPerMin,
      key: (req) => req.ip ?? 'unknown',
      store: rateStore,
      now,
      alwaysClosed: closedRoute,
      failOpen: isHealth // the public probe must answer even if the shared store is down; it exposes nothing
    })
  );

  app.use('/api', createAuthMiddleware({ config, verify, failureStore: rateStore, now }));

  app.use(
    '/api',
    createRateLimiter({ name: 'user', windowMs: 60_000, max: config.rateUserPerMin, key: (req) => req.user?.id, store: rateStore, now, alwaysClosed: closedRoute })
  );

  // Endpoint policy: unknown paths 404 (after auth, so route existence is not revealed to anonymous callers).
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (isHealth(req)) return next();
    const policy = resolvePolicy(req.method, req.path);
    if (!policy) return apiNotFound(req, res);
    res.locals.policy = policy;
    next();
  });

  app.use(
    '/api',
    createRateLimiter({
      name: 'endpoint',
      windowMs: 60_000,
      max: (req) => (resolvePolicy(req.method, req.path)?.perMinute ?? 60),
      key: (req) => {
        const p = resolvePolicy(req.method, req.path);
        return req.user && p ? `${p.bucket}:${req.user.id}` : undefined;
      },
      store: rateStore,
      now,
      alwaysClosed: closedRoute
    })
  );

  app.use('/api', createJsonBody());
  app.use('/api', (req: Request, res: Response, next: NextFunction) => validateBody(res.locals.policy?.schema)(req, res, next));
  app.use('/api', createQuotaGate({ store: quotaStore, config, now, policyFor: (req) => resolvePolicy(req.method, req.path) }));

  return config;
}

/** Call after the last route: unmatched /api paths get a JSON 404 (never the SPA fallback), then the terminal error handler. */
export function installApiTail(app: Express) {
  app.use('/api', apiNotFound);
  app.use(errorHandler);
}

export { handleRouteError, ApiError } from './errors';
export { loadSecurityConfig } from './config';
