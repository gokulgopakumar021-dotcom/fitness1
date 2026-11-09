import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { sendError } from '../security/errors';
import { logger } from '../security/logger';
import { createRateLimiter, MemoryRateStore, type RateStore } from '../security/rateLimit';
import { requestContext } from '../security/requestContext';
import { BillingUnavailableError, describeBillingFailure } from './diagnostics';
import { createEntitlementGate } from './entitlement';
import { loadBillingConfig, type BillingConfig } from './config';
import { createRazorpayGateway, type RazorpayGateway } from './gateway';
import { createBillingService, type BillingService } from './service';
import { createSupabaseBillingStore, type BillingStore } from './store';

export interface BillingDeps {
  config?: BillingConfig;
  store?: BillingStore;
  gateway?: RazorpayGateway;
  service?: BillingService;
  rateStore?: RateStore;
  now?: () => number;
}

/**
 * Built lazily, on the first billing request, and only when billing is configured. Importing this module reads nothing from the
 * environment and makes no connection, so an unconfigured deployment (every existing environment) behaves exactly as before.
 */
export function createLazyBilling(deps: BillingDeps = {}) {
  let cached: BillingService | undefined;
  return {
    get(req?: Request): BillingService | undefined {
      if (deps.service) return deps.service;
      if (cached) return cached;
      const config = deps.config ?? loadBillingConfig();
      if (!config.configured) {
        logger.error('billing_not_configured', { requestId: req?.requestId, reason: 'config', problems: config.problems });
        return undefined;
      }
      cached = createBillingService({
        config,
        store: deps.store ?? createSupabaseBillingStore(config),
        gateway: deps.gateway ?? createRazorpayGateway(config),
        now: deps.now
      });
      return cached;
    }
  };
}

const NOT_CONFIGURED = (req: Request, res: Response) => sendError(req, res, 503, 'billing_unavailable', 'Billing is temporarily unavailable. Please try again shortly.', { 'Retry-After': '10' });

/**
 * POST /api/billing/webhook: the one /api route that is not behind Supabase auth, because Razorpay cannot send a JWT. It is
 * registered BEFORE installSecurity and authenticates by HMAC over the exact raw bytes instead. Its own pipeline:
 * request id -> per-IP rate limit -> raw body (256 kb) -> signature -> idempotency -> work. Other methods and paths fall
 * through to the normal pipeline (and are refused there without a token).
 */
export function installBillingWebhook(app: Express, deps: BillingDeps & { rateStore: RateStore; ipPerMin?: number }) {
  const lazy = createLazyBilling(deps);
  const now = deps.now ?? Date.now;
  const path = '/api/billing/webhook';
  app.post(
    path,
    requestContext,
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
    createRateLimiter({ name: 'billing-webhook-ip', windowMs: 60_000, max: deps.ipPerMin ?? 120, key: (req) => req.ip ?? 'unknown', store: deps.rateStore, now, alwaysClosed: () => true }),
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Only a Buffer from express.raw is acceptable. If a platform layer already consumed or parsed the body, the exact bytes are
        // gone and the signature cannot be checked: fail closed rather than verify a re-serialised object.
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          logger.warn('billing_webhook_no_raw_body', { requestId: req.requestId, contentType: String(req.headers['content-type'] ?? '').slice(0, 40) });
          return sendError(req, res, 400, 'raw_body_unavailable', 'Webhook body could not be read.');
        }
        const svc = lazy.get(req);
        if (!svc) return NOT_CONFIGURED(req, res);
        const sig = req.get('x-razorpay-signature');
        const eventId = req.get('x-razorpay-event-id');
        const r = await svc.handleWebhook(req.body, sig, eventId);
        res.status(r.status).json({ success: r.body.received, result: r.body.result, requestId: req.requestId });
      } catch (err) {
        next(err);
      }
    }
  );
}

const handler = (fn: (svc: BillingService, req: Request, res: Response) => Promise<unknown>, lazy: ReturnType<typeof createLazyBilling>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const svc = lazy.get(req);
      if (!svc) return NOT_CONFIGURED(req, res);
      // req.user comes only from the auth middleware (verified Supabase token). The request body is never consulted for identity.
      if (!req.user) return sendError(req, res, 401, 'auth_required', 'Authentication required.');
      res.setHeader('Cache-Control', 'no-store');
      await fn(svc, req, res);
    } catch (err) {
      // The client only ever sees the generic 503; this line (same request id as the response body and X-Request-Id) says why.
      if (err instanceof BillingUnavailableError) logger.error('billing_unavailable', { requestId: req.requestId, method: req.method, path: req.path, userId: req.user?.id, ...describeBillingFailure(err) });
      next(err); // ApiError is rendered by the terminal error handler
    }
  };

/** Builds the AI-route gate. The mode is read once; the service is built lazily, so `off` (the default) touches nothing. */
export function createBillingEntitlementGate(deps: BillingDeps = {}) {
  const lazy = createLazyBilling(deps);
  const config = deps.config ?? loadBillingConfig();
  const mode = config.enforcement;
  // An unrecognised BILLING_ENFORCEMENT value leaves the gate OFF (a typo must never lock every user out), so it has to be loud:
  // otherwise an operator who meant "on" would believe AI routes are gated while nothing is.
  if (config.problems.some((p) => p.startsWith('BILLING_ENFORCEMENT'))) logger.error('billing_enforcement_invalid', { effectiveMode: mode });
  return createEntitlementGate({ mode, check: async (userId, req) => lazy.get(req)?.checkEntitlement(userId) });
}

/** JWT-protected billing routes. Register AFTER installSecurity so auth, rate limits, body limits and validation have run. */
export function registerBillingRoutes(app: Express, deps: BillingDeps = {}) {
  const lazy = createLazyBilling(deps);
  app.get('/api/billing/status', handler(async (s, req, res) => res.json({ success: true, ...(await s.getStatus(req.user!)) }), lazy));
  app.get('/api/billing/payments', handler(async (s, req, res) => res.json({ success: true, payments: await s.listPayments(req.user!) }), lazy));
  app.post('/api/billing/subscriptions', handler(async (s, req, res) => res.json({ success: true, ...(await s.createSubscription(req.user!, req.body.planKey)) }), lazy));
  app.post('/api/billing/subscriptions/verify', handler(async (s, req, res) => res.json({ success: true, ...(await s.verifyAuthorization(req.user!, req.body)) }), lazy));
  app.post('/api/billing/subscriptions/cancel', handler(async (s, req, res) => res.json({ success: true, ...(await s.cancel(req.user!)) }), lazy));
  app.post('/api/billing/subscriptions/recover', handler(async (s, req, res) => res.json({ success: true, ...(await s.startRecovery(req.user!)) }), lazy));
  app.get('/api/billing/account/deletion-check', handler(async (s, req, res) => res.json({ success: true, ...(await s.deletionCheck(req.user!)) }), lazy));
  // Consent comes only from the validated body (strict boolean), never from a query string or header.
  app.post('/api/billing/account/prepare-deletion', handler(async (s, req, res) => res.json({ success: true, ...(await s.prepareDeletion(req.user!, { confirmCancelPaidNow: req.body?.confirmCancelPaidNow === true })) }), lazy));
}

export { MemoryRateStore };
