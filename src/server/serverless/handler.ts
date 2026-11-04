import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { resolveRequestId, sendInitFailure } from './getApp';
import { normalizeRewrittenUrl } from './normalizeUrl';
import { logger } from '../security/logger';

/**
 * Request handler behind the Vercel Function entry point `api/index.ts` (Stage 3.6).
 *
 * Per request it does exactly three things, in this order:
 *  1. strips the reserved rewrite parameter from `req.url` (see normalizeUrl.ts), so Express and everything behind it
 *     only ever see client-sent parameters;
 *  2. obtains the initialised Express application (single-flight, Redis-ready, fail-closed: see getApp.ts);
 *  3. hands the untouched request and response to that application, which runs the full existing security pipeline
 *     (request id, headers, CORS, rate limits, auth, policy, body limits, validation, quota) and the route handler.
 *
 * If the application cannot be built it answers with the controlled JSON 503 from `sendInitFailure` and never reaches
 * Express. It does not serve static files, listen on a port, import the local runner or Vite, register signal handlers
 * or start background work. The method and body are never read or modified here.
 */
export type AppSource = () => Promise<Express>;
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createHandler(getApp: AppSource): RequestHandler {
  return async function handler(req, res) {
    req.url = normalizeRewrittenUrl(req.url ?? '/');

    let app: Express;
    try {
      app = await getApp();
    } catch (err) {
      sendInitFailure(req, res, err);
      return;
    }

    // Resolve when the response is done so the invocation stays open for the whole request.
    const done = new Promise<void>((resolve) => {
      res.once('finish', resolve);
      res.once('close', resolve);
    });
    try {
      app(req as never, res as never);
    } catch (err) {
      // Express catches errors thrown by its own middleware and routes; this only guards against something escaping it.
      logger.error('serverless_handler_error', { errName: err instanceof Error ? err.name : typeof err });
      sendUnexpectedFailure(req, res);
      return;
    }
    await done;
  };
}

function sendUnexpectedFailure(req: IncomingMessage, res: ServerResponse): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const body = JSON.stringify({ success: false, error: 'Internal server error.', code: 'internal_error', requestId });
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(req.method === 'HEAD' ? undefined : body);
}

