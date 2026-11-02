import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { resolvePolicy } from './endpoints';

/**
 * Route-specific JSON parsing: small default, 25 MB global limit removed. Runs after authentication and rate
 * limiting, so unauthenticated traffic is never body-parsed.
 */
export function createJsonBody(): RequestHandler {
  const parsers = new Map<string, RequestHandler>();
  return (req: Request, res: Response, next: NextFunction) => {
    const policy = resolvePolicy(req.method, req.path);
    const limit = policy?.bodyLimit ?? '16kb';
    let parser = parsers.get(limit);
    if (!parser) {
      parser = express.json({ limit, strict: true, type: 'application/json' });
      parsers.set(limit, parser);
    }
    parser(req, res, next);
  };
}
