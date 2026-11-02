import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { SecurityConfig } from './config';
import { logger, serializeError } from './logger';
import { sendError } from './errors';
import type { RateStore } from './rateLimit';
import type { AuthUser } from './types';

export type VerifyResult = { ok: true; user: AuthUser } | { ok: false; reason: 'invalid' | 'unavailable' | 'not_configured' };
export type TokenVerifier = (token: string) => Promise<VerifyResult>;

/** Tokens are kept off `req` (which loggers and error serialisers may touch). Only quota/RPC code reads this. */
const accessTokens = new WeakMap<Request, string>();
export const getAccessToken = (req: Request): string | undefined => accessTokens.get(req);

/** Trusted server-side verification: Supabase Auth validates signature, expiry and revocation (`auth.getUser`). */
export function createSupabaseVerifier(cfg: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>): TokenVerifier {
  let client: ReturnType<typeof createClient> | null = null;
  return async (token) => {
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return { ok: false, reason: 'not_configured' };
    client ??= createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        const status = (error as { status?: number }).status;
        const retryable = error.name === 'AuthRetryableFetchError' || status === 0 || (typeof status === 'number' && status >= 500);
        if (retryable) {
          logger.warn('auth_upstream_unavailable', { err: serializeError(error) });
          return { ok: false, reason: 'unavailable' };
        }
        return { ok: false, reason: 'invalid' };
      }
      if (!data.user?.id) return { ok: false, reason: 'invalid' };
      return {
        ok: true,
        user: { id: data.user.id, email: data.user.email ?? undefined, emailVerified: Boolean(data.user.email_confirmed_at) }
      };
    } catch (err) {
      logger.warn('auth_upstream_unavailable', { err: serializeError(err) });
      return { ok: false, reason: 'unavailable' };
    }
  };
}

const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/;
const MAX_TOKEN_LENGTH = 4096;

/** Exact allow-list of public endpoints. Everything else under /api requires a verified user. */
const PUBLIC = new Set(['GET /health', 'HEAD /health']);

function isExpired(token: string, nowMs: number): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= nowMs;
  } catch {
    return false; // undecodable: let the verifier decide
  }
}

export interface AuthDeps {
  config: SecurityConfig;
  verify: TokenVerifier;
  failureStore: RateStore;
  now?: () => number;
}

export function createAuthMiddleware({ config, verify, failureStore, now = Date.now }: AuthDeps) {
  const failKey = (req: Request) => `authfail:${req.ip ?? 'unknown'}`;

  const recordFailure = async (req: Request) => {
    await failureStore.hit(failKey(req), config.authFailWindowMs);
  };

  return async function authenticate(req: Request, res: Response, next: NextFunction) {
    if (req.method === 'OPTIONS' || PUBLIC.has(`${req.method} ${req.path}`)) return next();

    try {
      // Repeated failures from one address: stop before doing any more verification work.
      const prior = await failureStore.peek(failKey(req));
      if (prior && prior.count >= config.authFailMax) {
        const retry = Math.max(1, Math.ceil((prior.resetAt - now()) / 1000));
        return sendError(req, res, 429, 'too_many_auth_failures', 'Too many failed authentication attempts. Try again later.', { 'Retry-After': String(retry) });
      }

      const header = req.get('authorization');
      if (!header) {
        await recordFailure(req);
        return sendError(req, res, 401, 'auth_required', 'Authentication required.', { 'WWW-Authenticate': 'Bearer' });
      }
      const match = BEARER.exec(header);
      const token = match?.[1];
      if (!token || token.length > MAX_TOKEN_LENGTH || token.split('.').length !== 3) {
        await recordFailure(req);
        return sendError(req, res, 401, 'invalid_token', 'Invalid authentication token.', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      }
      if (isExpired(token, now())) {
        await recordFailure(req);
        return sendError(req, res, 401, 'token_expired', 'Your session has expired. Please sign in again.', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      }

      let result: VerifyResult;
      try {
        result = await verify(token);
      } catch (err) {
        logger.warn('auth_verifier_threw', { requestId: req.requestId, err: serializeError(err) });
        result = { ok: false, reason: 'unavailable' };
      }
      if (!result.ok) {
        if (result.reason === 'not_configured') {
          logger.error('auth_not_configured', { requestId: req.requestId });
          return sendError(req, res, 503, 'auth_unavailable', 'Authentication is temporarily unavailable.');
        }
        if (result.reason === 'unavailable') {
          return sendError(req, res, 503, 'auth_unavailable', 'Authentication is temporarily unavailable. Please try again.', { 'Retry-After': '5' });
        }
        await recordFailure(req);
        return sendError(req, res, 401, 'invalid_token', 'Invalid authentication token.', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      }

      if (config.requireVerifiedEmail && !result.user.emailVerified) {
        return sendError(req, res, 403, 'email_not_verified', 'Please verify your email address to use this feature.');
      }

      req.user = result.user;
      accessTokens.set(req, token);
      next();
    } catch (err) {
      next(err);
    }
  };
}
