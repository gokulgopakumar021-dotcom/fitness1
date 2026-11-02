import helmet from 'helmet';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { SecurityConfig } from './config';

function origins(url?: string): { https: string[]; wss: string[] } {
  try {
    if (!url) return { https: [], wss: [] };
    const u = new URL(url);
    return { https: [u.origin], wss: [`wss://${u.host}`] };
  } catch {
    return { https: [], wss: [] };
  }
}

/**
 * CSP for the production SPA. Derived from what the app actually loads:
 *  - scripts/styles/models/WASM are all self-hosted (MediaPipe WASM via Vite `?url`, model in /models), so script-src is
 *    'self' + 'wasm-unsafe-eval' (WASM compile only; no 'unsafe-eval').
 *  - style-src needs 'unsafe-inline' (React style attributes) and Google Fonts CSS until fonts are self-hosted.
 *  - connect/img/media allow the configured Supabase project (auth, REST, signed video URLs).
 * NOT verified in a real browser from this environment: see report, "requires live verification".
 */
export function buildCsp(config: Pick<SecurityConfig, 'supabaseUrl'>) {
  const sb = origins(config.supabaseUrl);
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'blob:', ...sb.https],
    mediaSrc: ["'self'", 'blob:', ...sb.https],
    connectSrc: ["'self'", ...sb.https, ...sb.wss],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
  };
}

/** camera is used by Body Scan and Workout Mirror; Web Bluetooth by the gadget modal; the microphone is never used. */
export const PERMISSIONS_POLICY = 'camera=(self), bluetooth=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

export function createSecurityHeaders(config: Pick<SecurityConfig, 'production' | 'supabaseUrl'>): RequestHandler[] {
  const helmetMw = helmet({
    // In dev, Vite injects inline scripts and an HMR websocket, so the CSP is enforced in production only.
    contentSecurityPolicy: config.production ? { useDefaults: false, directives: buildCsp(config) } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hsts: config.production ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false
  });
  const permissions = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  };
  const noStoreApi = (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
  return [helmetMw, permissions, noStoreApi];
}
