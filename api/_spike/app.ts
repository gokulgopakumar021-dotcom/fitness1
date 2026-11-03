// STAGE 1 SPIKE ONLY. Isolated diagnostic Express app for Vercel Preview.
// Does not import server.ts, Redis, Supabase, Gemini or any security runtime.
// No app.listen(), no timers, no signal handlers, no environment access.
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

export const SPIKE_SERVICE = 'ironlog-vercel-spike';
export const SPIKE_RUNTIME = 'vercel-function';
export const SPIKE_VERSION = 'stage1-spike-1';

const BODY_LIMIT = '2kb';

export function createSpikeApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: SPIKE_SERVICE,
      runtime: SPIKE_RUNTIME,
      version: SPIKE_VERSION,
    });
  });

  app.get('/api/__vercel_spike/path', (req: Request, res: Response) => {
    // Deliberately no headers, cookies, query values or env in the response.
    res.json({
      ok: true,
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      routeMatched: true,
    });
  });

  app.post(
    '/api/__vercel_spike/method',
    express.json({ limit: BODY_LIMIT, type: 'application/json' }),
    (req: Request, res: Response) => {
      res.json({
        ok: true,
        method: req.method,
        path: req.path,
        body: req.body ?? null,
      });
    },
  );

  // Controlled JSON 404 for anything else under the spike prefix.
  app.use('/api/__vercel_spike', (req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: 'spike_route_not_found',
      method: req.method,
      path: req.baseUrl + req.path,
      routeMatched: false,
    });
  });

  // Controlled JSON 404 for every other /api/* path reaching this function.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'not_found', method: req.method, path: req.path });
  });

  // Controlled errors: no stack traces, no internals.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { status?: number; type?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: 'payload_too_large' });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, error: 'invalid_json' });
      return;
    }
    res.status(500).json({ ok: false, error: 'internal_error' });
  });

  return app;
}
