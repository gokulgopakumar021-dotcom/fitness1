import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Propagates a well-formed inbound X-Request-Id, otherwise generates one. Echoed on every response. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
