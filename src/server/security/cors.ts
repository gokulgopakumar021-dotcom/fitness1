import type { NextFunction, Request, Response } from 'express';
import type { SecurityConfig } from './config';
import { sendError } from './errors';

const METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Accept, X-Request-Id';
const EXPOSED_HEADERS = 'X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-Quota-Limit, X-Quota-Remaining';

function sameHost(origin: string, req: Request): boolean {
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/**
 * Explicit allow-list, no wildcard, no credentials (the API authenticates with a Bearer header, never cookies).
 * - No Origin header (curl, server-to-server, same-origin GET): not a CORS request; authentication still applies.
 * - Allow-listed origin, or same host as this server: CORS headers are returned.
 * - Anything else: 403 for preflights and for the request itself (so a foreign page cannot trigger side effects).
 */
export function createCors(config: Pick<SecurityConfig, 'corsOrigins'>) {
  const allowed = new Set(config.corsOrigins);
  return function cors(req: Request, res: Response, next: NextFunction) {
    res.vary('Origin');
    const origin = req.get('origin');
    if (!origin) {
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }
    if (!allowed.has(origin) && !sameHost(origin, req)) {
      return sendError(req, res, 403, 'origin_not_allowed', 'Origin not allowed.');
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    next();
  };
}
