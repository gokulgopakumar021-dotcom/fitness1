import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { resolvePolicy } from '../security/endpoints';
import { sendError } from '../security/errors';
import { logger } from '../security/logger';
import { describeBillingFailure } from './diagnostics';
import type { EnforcementMode } from './config';

export interface EntitlementDecision {
  state: string;
  hasAccess: boolean;
}
export type EntitlementCheck = (userId: string, req?: Request) => Promise<EntitlementDecision | undefined>;

/**
 * Server-authoritative gate for every `ai: true` route. Runs after authentication and validation and BEFORE the daily AI quota
 * gate, so a refused request consumes no quota. The decision comes from billing_get_entitlement() (database clock and stored,
 * Razorpay-verified state); nothing the browser sends is consulted.
 *   off    : no database call, nothing changes (the default, so merging cannot lock anyone out)
 *   shadow : computes the decision and logs would-be denials, gates nothing, never fails a request
 *   on     : 402 subscription_required when there is no access; 503 billing_unavailable (fail closed) if it cannot be determined
 * Non-AI routes, including every billing route, are never gated.
 */
export function createEntitlementGate(opts: { mode: EnforcementMode; check: EntitlementCheck }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (opts.mode === 'off') return next();
      const policy = resolvePolicy(req.method, req.path);
      if (!policy?.ai || !req.user) return next();

      let decision: EntitlementDecision | undefined;
      try {
        decision = await opts.check(req.user.id, req);
      } catch (err) {
        // Fail closed exactly as before, but say why (static labels only) under the same request id as the 503 body.
        logger.error('entitlement_check_failed', { requestId: req.requestId, bucket: policy.bucket, ...describeBillingFailure(err) });
        decision = undefined;
      }
      if (opts.mode === 'shadow') {
        if (!decision) logger.warn('entitlement_shadow_unavailable', { requestId: req.requestId, bucket: policy.bucket });
        else if (!decision.hasAccess) logger.warn('entitlement_shadow_would_deny', { requestId: req.requestId, userId: req.user.id, bucket: policy.bucket, state: decision.state });
        return next();
      }
      if (!decision) {
        logger.error('entitlement_unavailable', { requestId: req.requestId, bucket: policy.bucket });
        return sendError(req, res, 503, 'billing_unavailable', 'Subscription status could not be checked. Please try again shortly.', { 'Retry-After': '5' });
      }
      if (!decision.hasAccess) {
        return sendError(req, res, 402, 'subscription_required', 'An active trial or subscription is required to use this feature.', {}, { entitlement: { state: decision.state } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
