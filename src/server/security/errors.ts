import type { NextFunction, Request, Response } from 'express';
import { logger, serializeError } from './logger';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Existing response convention is `{ success:false, error }`; `code` and `requestId` are additive. */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {}
) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  return res.status(status).json({ success: false, error: message, code, requestId: req.requestId, ...extra });
}

export interface RouteFallback {
  /** Safe, static, user-facing message (never derived from the caught error). */
  message: string;
  code?: string;
  status?: number;
  /** Extra static fields the existing client contract expects on failure (e.g. `found: false`, a fallback `reply`). */
  extra?: Record<string, unknown>;
}

const GENERIC_UPSTREAM = 'The AI service is temporarily unavailable. Please try again shortly.';
const INVALID_AI = 'The AI service returned an unusable response. Please try again.';

/** Classifies without ever forwarding the underlying message. */
export function classifyError(error: unknown, fallback: RouteFallback): { status: number; code: string; message: string; headers?: Record<string, string> } {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message, headers: error.headers };
  if (error instanceof SyntaxError) return { status: 502, code: 'ai_invalid_response', message: INVALID_AI };
  const upstreamStatus = (error as { status?: unknown } | null)?.status;
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'AbortError' || name === 'TimeoutError') return { status: 504, code: 'upstream_timeout', message: GENERIC_UPSTREAM };
  if (typeof upstreamStatus === 'number') {
    if (upstreamStatus === 429) return { status: 503, code: 'ai_busy', message: GENERIC_UPSTREAM, headers: { 'Retry-After': '30' } };
    return { status: 502, code: 'ai_upstream_error', message: GENERIC_UPSTREAM };
  }
  return { status: fallback.status ?? 500, code: fallback.code ?? 'internal_error', message: fallback.message };
}

/**
 * Use inside route catch blocks: logs the detail server-side (redacted, with request id) and sends a safe,
 * structured response. Replaces `res.status(500).json({ error: error.message })`.
 */
export function handleRouteError(req: Request, res: Response, error: unknown, fallback: RouteFallback, context?: string) {
  const c = classifyError(error, fallback);
  logger.error('route_error', { requestId: req.requestId, route: context ?? req.path, userId: req.user?.id, code: c.code, err: serializeError(error) });
  if (res.headersSent) return undefined;
  return sendError(req, res, c.status, c.code, c.message, c.headers, fallback.extra);
}

export function apiNotFound(req: Request, res: Response) {
  return sendError(req, res, 404, 'not_found', 'Endpoint not found.');
}

/** Terminal Express error handler: body-parser, CORS and any uncaught exception. Never leaks internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') return sendError(req, res, 413, 'payload_too_large', 'Request body is too large.');
  if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return sendError(req, res, 400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (err instanceof ApiError) return sendError(req, res, err.status, err.code, err.message, err.headers);
  logger.error('unhandled_error', { requestId: req.requestId, path: req.path, userId: req.user?.id, err: serializeError(err) });
  if (res.headersSent) return undefined;
  return sendError(req, res, 500, 'internal_error', 'Something went wrong. Please try again.');
}
